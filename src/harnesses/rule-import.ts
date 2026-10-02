import { promises as fs } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { Diagnostic, EtymonError, Rule, validName } from '../core/model.js';
import { exists, readOptional, inside } from '../core/fs.js';
import { ruleIdentity } from '../core/dedup.js';
import { readDocument } from '../core/documents.js';
import { Workspace } from '../core/workspace.js';
import { canonicalRuleText, parseInstructionFile, parseRule } from '../providers/rules.js';
import type { Profile } from './profiles.js';
import { ruleLocation, RuleSource } from './rule-profiles.js';
import { NativeDiscovery } from './native-discovery.js';

export type ImportedRule = {
  kind: 'rule';
  name: string;
  origin: string;
  origins: string[];
  text: string;
  extension: '.md';
  rule: Rule;
};
export async function importRules(
  p: Profile,
  workspace: Workspace,
  rulesPath?: string,
  importedPaths?: Map<string, ImportedRule[]>,
  discovery = new NativeDiscovery(workspace),
): Promise<{ resources: ImportedRule[]; diagnostics: Diagnostic[] }> {
  const resources: ImportedRule[] = [],
    diagnostics: Diagnostic[] = [];
  if (!p.rule || (workspace.global && p.projectOnly)) return { resources, diagnostics };
  const sources: RuleSource[] = [
    ...(workspace.global ? p.rule.global.filter((source) => !source.directory) : p.rule.project),
  ];
  if (rulesPath && !workspace.global)
    sources.push({ path: rulesPath, directory: true, dialect: p.rule.dialect ?? 'plain' });
  const all =
    !workspace.global && sources.some((source) => source.tree)
      ? await discovery.tree(workspace.root)
      : [];
  const winners = new Map<string, { source: string; resources: ImportedRule[] }>();
  const seenPaths = new Set<string>(),
    claimedPaths = new Map<string, ImportedRule[]>();
  let claudeMode = 'claude-md-or-agents-md';
  if (p.id === 'claude' && !workspace.global) {
    const user = new Workspace({
      global: true,
      ...(workspace.homeOverride ? { home: workspace.home } : {}),
    });
    const settings = await readOptional(ruleLocation('.claude/settings.json', user, p.id));
    if (settings)
      claudeMode =
        (
          readDocument(settings, 'json').pluginConfigs as
            Record<string, { options?: { instructionFiles?: string } }> | undefined
        )?.['agents-md@builtin']?.options?.instructionFiles ?? claudeMode;
  }
  async function addFile(
    path: string,
    source: RuleSource,
    base: string,
    sourceRoot: string,
    included = false,
    explicitScope = false,
  ) {
    const instructions =
      source.dialect === 'plain' || /^(?:AGENTS|AGENT)\.md$/.test(basename(path));
    // Read aliases reuse the first native interpretation. Explicit includes
    // can load that same file at another scope or as unconditional guidance.
    const identity = JSON.stringify([
      path,
      explicitScope ? base : null,
      instructions ? 'plain' : 'native',
    ]);
    if (discovery.excluded(path)) return;
    if (seenPaths.has(identity) || importedPaths?.has(identity)) return;
    seenPaths.add(identity);
    const stat = await fs.lstat(path);
    const real = stat.isSymbolicLink() ? await discovery.instructionFile(path) : path;
    if (!real) return;
    const fileStat = await fs.stat(real);
    if (!fileStat.isFile()) return;
    if (fileStat.size > 1024 * 1024)
      throw new EtymonError('SOURCE_LIMIT', `Rule file exceeds 1 MiB: ${path}`);
    let text = await fs.readFile(real, 'utf8');
    if (!text.trim()) return;
    // An Etymon-compatible include bridge contributes its target, not a second
    // rule containing the literal @path. Target discovery happens separately.
    const bridge =
      /^@([^\r\n]+)\s*$/.exec(text) ??
      /^\s*All working instructions live in @([^\s]+)\s*[-–]\s*follow it\.\s*$/i.exec(text);
    if (
      bridge &&
      basename(bridge[1]) === 'AGENTS.md' &&
      (await exists(join(dirname(path), bridge[1])))
    ) {
      diagnostics.push({
        code: 'RULE_INCLUDE_BRIDGE',
        severity: 'info',
        harness: p.id,
        message: `${path} references AGENTS.md; importing the shared instructions once`,
      });
      const included = inside(
        workspace.root,
        relative(workspace.root, join(dirname(path), bridge[1])),
      );
      if (discovery.excluded(included)) return;
      await addFile(
        included,
        { dialect: 'plain', path: included },
        base,
        sourceRoot,
        true,
        explicitScope || dirname(path) !== dirname(included),
      );
      for (const prior of [...resources, ...[...(importedPaths?.values() ?? [])].flat()]) {
        if (prior.origins.includes(included) && prior.rule.base === base)
          prior.origins = [...new Set([...prior.origins, path])];
      }
      claimedPaths.set(
        identity,
        resources.filter((prior) => prior.origins.includes(path)),
      );
      return;
    }
    if (p.id === 'amp' && source.dialect === 'plain') {
      for (const match of text.matchAll(/^@([^\r\n]+)$/gm)) {
        const target = inside(
          workspace.root,
          relative(workspace.root, join(dirname(path), match[1])),
        );
        if (!(await exists(target))) {
          diagnostics.push({
            code: 'RULE_INCLUDE_UNSUPPORTED',
            severity: 'error',
            harness: p.id,
            message: `${path}: missing instruction reference ${match[1]}`,
          });
          return;
        }
        await addFile(target, { path: target, dialect: 'amp' }, base, target, true, true);
      }
      text = text.replace(/^@[^\r\n]+\r?\n?/gm, '');
      if (!text.trim()) return;
    } else if (/^@[^\s]+\s*$/m.test(text) || /@\[[^\]]+\]\([^)]+\)/.test(text)) {
      diagnostics.push({
        code: 'RULE_INCLUDE_UNSUPPORTED',
        severity: 'error',
        harness: p.id,
        message: `${path}: instruction references need explicit expansion before portable import; inline their content or import each rule with its own scope`,
      });
      return;
    }
    let rules: Rule[];
    try {
      rules = instructions
        ? parseInstructionFile(text, path, base, source.directory ? 'modular' : undefined)
        : [parseRule(text, path, source.dialect, base, source.directory ? 'modular' : undefined)];
    } catch (error) {
      diagnostics.push({
        code: error instanceof EtymonError ? error.code : 'INVALID_RULE',
        severity: 'error',
        harness: p.id,
        message: `${path}: ${error instanceof Error ? error.message : error}`,
      });
      return;
    }
    if (source.mode)
      rules = rules.map((rule) => ({
        ...rule,
        format: 'roo',
        native: { ...rule.native, mode: source.mode },
      }));
    const origins = [
      ...new Set([
        path,
        stat.isSymbolicLink()
          ? join(workspace.root, relative(await fs.realpath(workspace.root), real))
          : path,
      ]),
    ];
    const candidates = rules.map((rule) => ({
      kind: 'rule' as const,
      name: rule.name,
      origin: path,
      origins,
      text: canonicalRuleText(rule),
      extension: '.md' as const,
      rule,
    }));
    if (
      p.id === 'claude' &&
      !workspace.global &&
      basename(path) === 'AGENTS.md' &&
      !included &&
      claudeMode !== 'claude-md-and-agents-md'
    ) {
      let current = dirname(path),
        shadowed = ['claude-md', 'managed-only'].includes(claudeMode);
      while (!shadowed) {
        for (const alias of ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'])
          if (await exists(join(current, alias))) {
            shadowed = true;
            break;
          }
        if (current === workspace.root || dirname(current) === current) break;
        current = dirname(current);
      }
      if (shadowed) {
        for (const candidate of candidates) {
          const duplicate = resources.find(
            (prior) => ruleIdentity(prior.rule) === ruleIdentity(candidate.rule),
          );
          if (duplicate) duplicate.origins.push(path);
          diagnostics.push({
            code: duplicate ? 'RESOURCE_DUPLICATE' : 'NATIVE_SHADOWING',
            severity: duplicate ? 'info' : 'warning',
            harness: p.id,
            message: duplicate
              ? `${path} duplicates ${duplicate.origin}; imported once`
              : `${path} is inactive under Claude's instruction-file selection; excluded from import`,
          });
        }
        return;
      }
    }
    const group = source.group ? `${source.group}:${base}` : undefined;
    const winner = group ? winners.get(group) : undefined;
    if (winner && winner.source !== sourceRoot) {
      for (const candidate of candidates) {
        const duplicate = winner.resources.find(
          (prior) => ruleIdentity(prior.rule) === ruleIdentity(candidate.rule),
        );
        if (duplicate) {
          duplicate.origins.push(path);
          diagnostics.push({
            code: 'RESOURCE_DUPLICATE',
            severity: 'info',
            harness: p.id,
            message: `${path} duplicates ${duplicate.origin}; imported once`,
          });
        } else
          diagnostics.push({
            code: 'NATIVE_SHADOWING',
            severity: 'warning',
            harness: p.id,
            message: `${path} is shadowed by ${winner.source}; retained in the native setup and excluded from import`,
          });
      }
      return;
    }
    if (group) {
      if (winner) winner.resources.push(...candidates);
      else winners.set(group, { source: sourceRoot, resources: candidates });
    }
    resources.push(...candidates);
    claimedPaths.set(identity, candidates);
  }
  for (const source of sources) {
    const root = ruleLocation(source.path, workspace, p.id);
    const roots =
      source.tree && !workspace.global
        ? [
            ...new Set(
              all.flatMap((path) => {
                const marker = source.directory ? source.path + '/' : source.path;
                const index =
                  path === marker || path.startsWith(marker)
                    ? 0
                    : path.lastIndexOf('/' + marker) + 1;
                if ((index === 0 && !(path === marker || path.startsWith(marker))) || index < 0)
                  return [];
                if (!source.directory && path.slice(index) !== marker) return [];
                // A declared config-directory alias belongs to its parent
                // project scope. Let its specific source handle it before a
                // generic nested filename can consume the same physical file.
                if (
                  !source.directory &&
                  sources.some(
                    (other) =>
                      !other.directory &&
                      other.path.length > source.path.length &&
                      (path === other.path || (other.tree && path.endsWith('/' + other.path))),
                  )
                )
                  return [];
                return [join(workspace.root, path.slice(0, index), source.path)];
              }),
            ),
          ]
        : [root];
    for (const candidateRoot of roots) {
      if (!(await exists(candidateRoot))) continue;
      let base =
        workspace.global || source.directoryScope === false
          ? '.'
          : relative(
              workspace.root,
              source.path.includes('/')
                ? candidateRoot.slice(0, -source.path.length)
                : dirname(candidateRoot),
            ).replaceAll('\\', '/') || '.';
      if (source.directory) {
        base =
          workspace.global || source.directoryScope === false
            ? '.'
            : relative(workspace.root, candidateRoot.slice(0, -source.path.length)).replaceAll(
                '\\',
                '/',
              ) || '.';
        if (!(await fs.lstat(candidateRoot)).isDirectory()) {
          await addFile(candidateRoot, source, base, candidateRoot);
          continue;
        }
        const files = await discovery.tree(candidateRoot);
        for (const child of files) {
          if (source.flat && child.includes('/')) continue;
          if (
            source.dialect === 'cursor'
              ? !child.endsWith('.mdc')
              : source.dialect === 'copilot'
                ? !child.endsWith('.instructions.md')
                : !/\.(?:md|txt)$/.test(child)
          )
            continue;
          await addFile(join(candidateRoot, child), source, base, candidateRoot);
        }
      } else await addFile(candidateRoot, source, base, candidateRoot);
    }
  }
  // Roo mode scopes are independent of directory/file patterns.
  if (p.id === 'roo' && !workspace.global) {
    const root = ruleLocation('.roo', workspace, p.id);
    if (await exists(root))
      for (const entry of await fs.readdir(root)) {
        if (!/^rules-[a-z0-9_-]+$/.test(entry)) continue;
        const directory = join(root, entry);
        if (!(await fs.lstat(directory)).isDirectory()) continue;
        for (const path of await discovery.tree(directory))
          if (/\.(?:md|txt)$/.test(path))
            await addFile(
              join(directory, path),
              { path: directory, dialect: 'plain', mode: entry.slice(6) },
              '.',
              directory,
            );
      }
  }
  if (['opencode', 'kilo', 'gemini', 'codex'].includes(p.id)) {
    const settings =
      p.id === 'gemini'
        ? ruleLocation('.gemini/settings.json', workspace, p.id)
        : p.id === 'codex'
          ? ruleLocation('.codex/config.toml', workspace, p.id)
          : ruleLocation(
              workspace.global ? `.config/${p.id}/${p.id}.json` : `${p.id}.json`,
              workspace,
              p.id,
            );
    const configPath = (await exists(settings.replace(/\.json$/, '.jsonc')))
      ? settings.replace(/\.json$/, '.jsonc')
      : settings;
    const raw = discovery.excluded(configPath) ? undefined : await readOptional(configPath);
    if (raw) {
      const config = readDocument(raw, configPath.endsWith('.toml') ? 'toml' : 'json');
      const configured =
        p.id === 'gemini'
          ? (config.context as Record<string, unknown> | undefined)?.fileName
          : p.id === 'codex'
            ? config.project_doc_fallback_filenames
            : config.instructions;
      const values =
        typeof configured === 'string' ? [configured] : Array.isArray(configured) ? configured : [];
      for (const value of values) {
        if (typeof value !== 'string') continue;
        if (/^https?:/.test(value)) {
          diagnostics.push({
            code: 'REMOTE_RULE_REFERENCE',
            severity: 'warning',
            harness: p.id,
            message: `${configPath} references ${value}; use rule add <URL> to pin its contents`,
          });
          continue;
        }
        if (['gemini', 'codex'].includes(p.id)) {
          if (basename(value) !== value)
            throw new EtymonError(
              'INVALID_RULE_CONFIG',
              'Context filenames must not contain directories',
            );
          const paths = workspace.global
            ? [join(dirname(settings), value)]
            : all
                .filter((path) => basename(path) === value)
                .map((path) => join(workspace.root, path));
          for (const path of paths)
            if (await exists(path))
              await addFile(
                path,
                {
                  path: value,
                  dialect: 'plain',
                  ...(p.id === 'codex' ? { group: 'context' } : {}),
                },
                workspace.global ? '.' : relative(workspace.root, dirname(path)) || '.',
                path,
              );
        } else {
          const configRoot = workspace.global ? dirname(configPath) : workspace.root;
          inside(configRoot, value);
          for await (const path of fs.glob(value, { cwd: configRoot })) {
            const full = inside(configRoot, path);
            // instructions globs select source files; the loader reads their
            // entire contents unconditionally, regardless of frontmatter.
            await addFile(full, { path: value, dialect: 'plain' }, '.', full, false, true);
          }
        }
      }
    }
  }
  const unique: ImportedRule[] = [],
    identities = new Map<string, ImportedRule>();
  for (const resource of resources) {
    const hash = ruleIdentity(resource.rule),
      duplicate = identities.get(hash);
    if (duplicate) {
      duplicate.origins = [...new Set([...duplicate.origins, ...resource.origins])];
      diagnostics.push({
        code: 'RESOURCE_DUPLICATE',
        severity: 'info',
        harness: p.id,
        message: `${resource.origin} duplicates ${duplicate.origin}; scope and contents are equal`,
      });
      continue;
    }
    if (unique.some((prior) => prior.name === resource.name)) {
      resource.name = validName(resource.name.slice(0, 53) + '-' + hash.slice(7, 15));
      resource.rule.name = resource.name;
      resource.text = canonicalRuleText(resource.rule);
    }
    identities.set(hash, resource);
    unique.push(resource);
  }
  for (const [path, candidates] of claimedPaths)
    importedPaths?.set(
      path,
      candidates.map((candidate) => identities.get(ruleIdentity(candidate.rule)) ?? candidate),
    );
  return { resources: unique, diagnostics: [...diagnostics, ...discovery.diagnostics] };
}
