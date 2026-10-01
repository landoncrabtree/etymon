import { dirname, join, relative } from 'node:path';
import { Diagnostic, EtymonError, Resource, Rule } from '../core/model.js';
import { deduplicateResources, ruleIdentity } from '../core/dedup.js';
import { exists, readOptional } from '../core/fs.js';
import { readDocument } from '../core/documents.js';
import { Workspace } from '../core/workspace.js';
import {
  instructionText,
  parseInstructionFile,
  scopedRuleText,
  RuleDialect,
} from '../providers/rules.js';
import type { Profile } from './profiles.js';
import type { RenderOptions, RenderResult, Unit } from './render.js';
import { ruleLocation } from './rule-profiles.js';
import { isConversionLimit, omittedResource } from './loss.js';

function patterns(rule: Rule): string[] {
  if (rule.activation === 'always') return [rule.base + '/**'];
  return rule.patterns.map((pattern) => {
    const negated = pattern.startsWith('!'),
      value = negated ? pattern.slice(1) : pattern;
    return (
      (negated ? '!' : '') +
      (rule.base === '.' ? value : rule.base + '/' + value.replace(/^\.\//, ''))
    );
  });
}
function nativeText(rule: Rule, dialect: RuleDialect, globs: string[]): string {
  const native = { ...rule.native };
  delete native.mode;
  const description = rule.description ? { description: rule.description } : {};
  let metadata: Record<string, unknown>;
  if (rule.activation === 'native') {
    if (dialect !== rule.format || rule.base !== '.')
      throw new EtymonError(
        'RULE_NATIVE_FIELDS_BLOCKED',
        'Native rule conditions cannot be translated or rebased without a verified mapping',
      );
    return scopedRuleText(rule, { ...native, name: rule.name, ...description });
  }
  switch (dialect) {
    case 'claude':
    case 'cline':
      if (!['always', 'glob', 'never'].includes(rule.activation))
        throw new EtymonError(
          'RULE_ACTIVATION_UNSUPPORTED',
          `${dialect} cannot express ${rule.activation} rule activation`,
        );
      metadata = {
        ...native,
        ...description,
        ...(rule.activation === 'always' && rule.base === '.'
          ? {}
          : { paths: rule.activation === 'never' ? [] : globs }),
      };
      break;
    case 'copilot':
      if (rule.activation === 'never')
        throw new EtymonError(
          'RULE_ACTIVATION_UNSUPPORTED',
          'Copilot has no verified disabled-rule representation',
        );
      metadata = {
        ...native,
        ...(rule.activation === 'model' ? description : {}),
        ...(rule.activation === 'always' || rule.activation === 'glob'
          ? { applyTo: rule.activation === 'always' && rule.base === '.' ? '**' : globs.join(',') }
          : {}),
      };
      break;
    case 'cursor':
    case 'continue':
      if (rule.activation === 'never')
        throw new EtymonError(
          'RULE_ACTIVATION_UNSUPPORTED',
          `${dialect} has no verified disabled-rule representation`,
        );
      if (dialect === 'continue' && rule.activation === 'manual')
        throw new EtymonError(
          'RULE_ACTIVATION_UNSUPPORTED',
          'Continue has no verified manual-only rule activation; use a native prompt',
        );
      metadata = {
        ...native,
        name: rule.name,
        ...(rule.activation === 'model' ? description : {}),
        alwaysApply: rule.activation === 'always' && rule.base === '.',
        ...(rule.activation === 'glob' || rule.base !== '.'
          ? { globs: dialect === 'cursor' ? globs.join(',') : globs }
          : {}),
      };
      break;
    case 'kiro':
      if (rule.activation === 'never')
        throw new EtymonError(
          'RULE_ACTIVATION_UNSUPPORTED',
          'Kiro has no verified disabled steering representation',
        );
      metadata = {
        ...native,
        name: rule.name,
        ...description,
        inclusion:
          rule.activation === 'always' && rule.base === '.'
            ? 'always'
            : rule.activation === 'glob' || rule.base !== '.'
              ? 'fileMatch'
              : rule.activation === 'model'
                ? 'auto'
                : 'manual',
        ...(rule.activation === 'glob' || rule.base !== '.' ? { fileMatchPattern: globs } : {}),
      };
      break;
    case 'trigger':
      if (rule.activation === 'never')
        throw new EtymonError(
          'RULE_ACTIVATION_UNSUPPORTED',
          'This trigger format has no disabled-rule representation',
        );
      metadata = {
        ...native,
        ...description,
        trigger:
          rule.activation === 'always' && rule.base === '.'
            ? 'always_on'
            : rule.activation === 'glob' || rule.base !== '.'
              ? 'glob'
              : rule.activation === 'model'
                ? 'model_decision'
                : 'manual',
        ...(rule.activation === 'glob' || rule.base !== '.' ? { globs: globs.join(', ') } : {}),
      };
      break;
    case 'amp':
      if (rule.activation !== 'glob')
        throw new EtymonError(
          'RULE_ACTIVATION_UNSUPPORTED',
          'Amp conditional references support file globs only',
        );
      metadata = { globs };
      break;
    default:
      if (rule.activation !== 'always' || rule.base !== '.')
        throw new EtymonError(
          'RULE_SCOPE_UNSUPPORTED',
          'This harness supports unconditional rule text only',
        );
      if (Object.keys(native).length)
        throw new EtymonError(
          'RULE_NATIVE_FIELDS_BLOCKED',
          'This harness has no metadata-bearing rule format',
        );
      return rule.prompt + '\n';
  }
  return scopedRuleText(rule, metadata);
}
function compatibleNative(rule: Rule, p: Profile, dialect?: RuleDialect): boolean {
  if (!Object.keys(rule.native).length) return true;
  if (rule.format === 'roo') return p.id === 'roo';
  return rule.format === p.id || rule.format === dialect;
}
export async function renderRules(
  input: Resource[],
  p: Profile,
  workspace: Workspace,
  options: RenderOptions,
): Promise<RenderResult> {
  if (!options.allowLossy) return renderStrictRules(input, p, workspace, options);
  // Adapt copies only. Recompose the complete batch after each change so shared
  // instruction files and native loader checks follow the ordinary renderer.
  let projected = structuredClone(input);
  const losses: Diagnostic[] = [];
  for (;;) {
    const result = await renderStrictRules(projected, p, workspace, options);
    let changed = false;
    for (const diagnostic of result.diagnostics) {
      if (diagnostic.severity !== 'error' || !isConversionLimit(diagnostic.code)) continue;
      const resource = projected.find((item) => item.id === diagnostic.resource);
      if (!resource || resource.kind !== 'rule') continue;
      const rule = resource.rule;
      let loss: Diagnostic | undefined;
      if (
        rule.activation !== 'never' &&
        diagnostic.code !== 'RULE_SIZE_LIMIT' &&
        diagnostic.code !== 'CAPABILITY_UNSUPPORTED' &&
        !workspace.global
      ) {
        if (Object.keys(rule.native).length) {
          loss = {
            ...diagnostic,
            code: 'RULE_NATIVE_FIELDS_OMITTED',
            severity: 'warning',
            message: `${rule.name}: omitted ${rule.format} fields ${Object.keys(rule.native).join(', ')} from ${p.id}; their conditions and behavior no longer apply`,
          };
          rule.native = {};
          if (rule.activation === 'native') {
            loss.message += `; native activation becomes always-on within ${rule.base}`;
            rule.activation = 'always';
            rule.patterns = [];
          }
        } else if (rule.activation !== 'always') {
          loss = {
            ...diagnostic,
            code: 'RULE_CONDITIONS_DROPPED',
            severity: 'warning',
            message: `${rule.name}: ${rule.activation} activation${rule.patterns.length ? ` (${rule.patterns.join(', ')})` : ''} becomes always-on within ${rule.base} for ${p.id}`,
          };
          rule.activation = 'always';
          rule.patterns = [];
        } else if (rule.base !== '.') {
          loss = {
            ...diagnostic,
            code: 'RULE_SCOPE_BROADENED',
            severity: 'warning',
            message: `${rule.name}: directory scope ${rule.base} becomes project-wide guidance for ${p.id}`,
          };
          rule.base = '.';
        }
      }
      if (!loss) {
        projected = projected.filter((item) => item.id !== resource.id);
        loss = omittedResource(diagnostic);
      }
      losses.push(loss);
      changed = true;
    }
    // Each retry clears native fields, broadens activation/base, or removes a
    // resource. No retry can restore an earlier state.
    if (!changed) return { units: result.units, diagnostics: [...losses, ...result.diagnostics] };
  }
}
async function renderStrictRules(
  input: Resource[],
  p: Profile,
  workspace: Workspace,
  options: RenderOptions,
): Promise<RenderResult> {
  const units: Unit[] = [],
    diagnostics: Diagnostic[] = [];
  const resources = deduplicateResources(
    input.filter((resource) => resource.kind === 'rule'),
    diagnostics,
  );
  if (!resources.length) return { units, diagnostics };
  const spec = p.rule,
    scope = workspace.global ? 1 : 0;
  const groups = new Map<string, { rules: Rule[]; ids: string[]; suffix: string[] }>();
  const addStanding = (path: string, rule: Rule | undefined, id: string, suffix?: string) => {
    const group = groups.get(path) ?? { rules: [], ids: [], suffix: [] };
    if (rule) group.rules.push(rule);
    group.ids.push(id);
    if (suffix) group.suffix.push(suffix);
    groups.set(path, group);
  };
  for (const resource of resources) {
    if (resource.kind !== 'rule') continue;
    const rule = resource.rule;
    try {
      if (!spec || (workspace.global && p.projectOnly))
        throw new EtymonError(
          'CAPABILITY_UNSUPPORTED',
          `${p.label} has no rule writer at this scope`,
        );
      if (
        workspace.global &&
        (rule.base !== '.' || rule.activation !== 'always' || Object.keys(rule.native).length)
      )
        throw new EtymonError(
          'GLOBAL_RULE_SCOPE_UNSUPPORTED',
          'Global rules must be unscoped, always-on user guidance. Use a project environment for destDir, file patterns, conditional activation, or harness-specific rule conditions',
        );
      const native = compatibleNative(rule, p, spec.dialect);
      if (!native)
        throw new EtymonError(
          'RULE_NATIVE_FIELDS_BLOCKED',
          `${rule.name} has unmapped ${rule.format} fields: ${Object.keys(rule.native).join(', ')}. Use --allow-lossy to review omitting them`,
        );
      if (rule.base !== '.' && ['manual', 'model', 'never'].includes(rule.activation))
        throw new EtymonError(
          'RULE_SCOPE_UNSUPPORTED',
          `${p.label} cannot express ${rule.activation} activation AND directory scope ${rule.base} without changing its conditions`,
        );
      if (typeof rule.native.mode === 'string') {
        if (rule.base !== '.' || rule.activation !== 'always')
          throw new EtymonError(
            'RULE_SCOPE_UNSUPPORTED',
            'Roo mode rules cannot also express file conditions',
          );
        if (!/^[a-z0-9_-]+$/.test(rule.native.mode))
          throw new EtymonError('INVALID_RULE', 'Unsafe Roo mode name');
        units.push({
          path: ruleLocation(`.roo/rules-${rule.native.mode}/${rule.name}.md`, workspace, p.id),
          content: Buffer.from(rule.prompt + '\n'),
          resources: [resource.id],
          harnesses: [p.id],
          mode: 0o644,
        });
        continue;
      }
      const standing = spec.file?.[scope];
      if (
        rule.activation === 'always' &&
        standing &&
        !Object.keys(rule.native).length &&
        (rule.base === '.' || (!workspace.global && spec.nested))
      ) {
        const path = workspace.global
          ? ruleLocation(standing, workspace, p.id)
          : join(workspace.root, rule.base, standing);
        addStanding(path, rule, resource.id);
        continue;
      }
      const modular = options.rulesPath ?? spec.modular?.[scope];
      if (workspace.global)
        throw new EtymonError(
          'RULE_SCOPE_UNSUPPORTED',
          `${p.label} has no verified standalone user instruction file; global modular rules are excluded by Etymon's scope policy`,
        );
      if (!modular || !spec.dialect)
        throw new EtymonError(
          'RULE_SCOPE_UNSUPPORTED',
          `${p.label} has no verified ${workspace.global ? 'global' : 'project'} writer for ${rule.activation} rules at ${rule.base}. ${spec.notes?.join(' ') ?? ''}`,
        );
      const path = join(
        ruleLocation(modular, workspace, p.id),
        rule.name +
          (spec.dialect === 'cursor'
            ? '.mdc'
            : spec.dialect === 'copilot'
              ? '.instructions.md'
              : '.md'),
      );
      const scopedPatterns = patterns(rule);
      if (spec.dialect === 'amp') {
        const prefix = relative(dirname(path), workspace.root).replaceAll('\\', '/') || '.';
        const explicit = scopedPatterns.map((pattern) =>
          pattern.startsWith('!') ? '!' + prefix + '/' + pattern.slice(1) : prefix + '/' + pattern,
        );
        units.push({
          path,
          content: Buffer.from(nativeText(rule, 'amp', explicit)),
          resources: [resource.id],
          harnesses: [p.id],
          mode: 0o644,
        });
        const anchor = ruleLocation(standing!, workspace, p.id);
        addStanding(
          anchor,
          undefined,
          resource.id,
          '@' + relative(dirname(anchor), path).replaceAll('\\', '/'),
        );
      } else {
        const text = nativeText(rule, spec.dialect, scopedPatterns);
        if (p.id === 'windsurf' && text.length > 12000)
          throw new EtymonError(
            'RULE_SIZE_LIMIT',
            'Cascade workspace rules cannot exceed 12000 characters',
          );
        units.push({
          path,
          content: Buffer.from(text),
          resources: [resource.id],
          harnesses: [p.id],
          mode: 0o644,
        });
      }
    } catch (error) {
      if (!(error instanceof EtymonError)) throw error;
      diagnostics.push({
        code: error.code,
        severity: 'error',
        message: error.message,
        harness: p.id,
        resource: resource.id,
      });
    }
  }
  for (const [path, group] of groups) {
    const sorted = group.rules.sort((a, b) => a.name.localeCompare(b.name));
    const content =
      instructionText(sorted) +
      (group.suffix.length ? '\n' + [...new Set(group.suffix)].sort().join('\n') + '\n' : '');
    if (p.id === 'windsurf' && content.length > (workspace.global ? 6000 : 12000)) {
      for (const id of new Set(group.ids))
        diagnostics.push({
          code: 'RULE_SIZE_LIMIT',
          severity: 'error',
          harness: p.id,
          resource: id,
          message: `Cascade ${workspace.global ? 'global' : 'project'} guidance exceeds its character limit at ${path}; this instruction group cannot be written`,
        });
      continue;
    }
    units.push({
      path,
      content: Buffer.from(content),
      resources: [...new Set(group.ids)],
      harnesses: [p.id],
      mode: workspace.global ? 0o600 : 0o644,
    });
    await inspectStanding(path, sorted, group.ids, p, workspace, units, diagnostics);
  }
  if (p.id === 'gemini' && groups.size) {
    const path = ruleLocation('.gemini/settings.json', workspace, p.id),
      raw = await readOptional(path);
    const config = raw ? readDocument(raw, 'json') : {};
    const current = (config.context as Record<string, unknown> | undefined)?.fileName;
    if (
      current !== undefined &&
      typeof current !== 'string' &&
      (!Array.isArray(current) || !current.every((item) => typeof item === 'string'))
    )
      diagnostics.push({
        code: 'INVALID_RULE_CONFIG',
        severity: 'error',
        harness: p.id,
        message: `${path}: context.fileName must be a string or string array`,
      });
    else
      units.push({
        path,
        key: ['context', 'fileName'],
        value: [
          ...new Set([
            'AGENTS.md',
            ...(typeof current === 'string'
              ? [current]
              : ((current as string[] | undefined) ?? ['GEMINI.md'])),
          ]),
        ],
        resources: resources.map((resource) => resource.id),
        harnesses: [p.id],
      });
  }
  if (p.id === 'kilo' && workspace.global && groups.size) {
    let path = ruleLocation('.config/kilo/kilo.json', workspace, p.id);
    if (await exists(path.replace(/\.json$/, '.jsonc'))) path = path.replace(/\.json$/, '.jsonc');
    const raw = await readOptional(path),
      config = raw ? readDocument(raw, 'json') : {};
    if (
      config.instructions !== undefined &&
      (!Array.isArray(config.instructions) ||
        !config.instructions.every((value) => typeof value === 'string'))
    )
      diagnostics.push({
        code: 'INVALID_RULE_CONFIG',
        severity: 'error',
        harness: p.id,
        message: `${path}: instructions must be a string array`,
      });
    else
      units.push({
        path,
        key: ['instructions'],
        value: [
          ...new Set([...((config.instructions as string[] | undefined) ?? []), 'AGENTS.md']),
        ],
        resources: resources.map((resource) => resource.id),
        harnesses: [p.id],
      });
  }
  diagnostics.push(
    ...(spec?.notes ?? []).map((message) => ({
      code: 'NATIVE_RULE_PREREQUISITE',
      severity: 'info' as const,
      message,
      harness: p.id,
    })),
  );
  return { units, diagnostics };
}
async function inspectStanding(
  path: string,
  rules: Rule[],
  ids: string[],
  p: Profile,
  workspace: Workspace,
  units: Unit[],
  diagnostics: Diagnostic[],
) {
  if (p.id === 'claude' && !workspace.global) {
    const settings = ruleLocation(
      '.claude/settings.json',
      new Workspace({ global: true, ...(workspace.homeOverride ? { home: workspace.home } : {}) }),
      p.id,
    );
    const raw = await readOptional(settings),
      config = raw ? readDocument(raw, 'json') : {};
    const option = (
      (config.pluginConfigs as Record<string, unknown> | undefined)?.['agents-md@builtin'] as
        { options?: { instructionFiles?: string } } | undefined
    )?.options?.instructionFiles;
    if (option === 'managed-only') {
      diagnostics.push({
        code: 'RULES_DISABLED',
        severity: 'error',
        harness: p.id,
        message:
          'Claude Project instructions is managed-only; generated project rules will not load',
      });
      return;
    }
    for (const alias of ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md']) {
      const full = join(dirname(path), alias),
        content = await readOptional(full);
      if (!content?.trim()) continue;
      const reference = '@' + relative(dirname(full), path).replaceAll('\\', '/');
      if (content.trim() === reference) {
        units.push({
          path: full,
          content: Buffer.from(reference + '\n'),
          resources: ids,
          harnesses: [p.id],
          mode: 0o644,
        });
        continue;
      }
      const parsed = parseInstructionFile(content, full, rules[0]?.base ?? '.');
      const covered = parsed.every((rule) =>
        rules.some((candidate) => ruleIdentity(candidate) === ruleIdentity(rule)),
      );
      if (covered && alias !== 'CLAUDE.local.md') {
        units.push({
          path: full,
          content: Buffer.from(reference + '\n'),
          resources: ids,
          harnesses: [p.id],
          mode: 0o644,
        });
        diagnostics.push({
          code: 'RULE_ALIAS_BRIDGE',
          severity: 'info',
          harness: p.id,
          message: `${full} is fully represented in AGENTS.md; sync will replace the duplicate with ${reference}. Existing files require --adopt`,
        });
      } else if (option !== 'claude-md-and-agents-md')
        diagnostics.push({
          code: 'RULE_SHADOWED',
          severity: 'error',
          harness: p.id,
          message: `${full} suppresses ${path}; convert its guidance first, remove the alias, or set user Project instructions to claude-md-and-agents-md`,
        });
    }
    if (option === 'claude-md')
      diagnostics.push({
        code: 'RULE_SHADOWED',
        severity: 'error',
        harness: p.id,
        message:
          'Claude is configured to read CLAUDE.md only; enable AGENTS.md in the user Project instructions setting',
      });
  }
  const sources = workspace.global ? p.rule?.global : p.rule?.project;
  const preferred = p.rule?.file?.[workspace.global ? 1 : 0];
  if (!preferred) return;
  const group = sources?.find((source) => source.path === preferred)?.group;
  if (!group) return;
  for (const source of sources ?? []) {
    if (source.path === preferred) break;
    if (source.group !== group || source.directory) continue;
    const alias = workspace.global
      ? ruleLocation(source.path, workspace, p.id)
      : join(dirname(path), source.path);
    const content = await readOptional(alias);
    if (content?.trim())
      diagnostics.push({
        code: 'RULE_SHADOWED',
        severity: 'error',
        harness: p.id,
        message: `${alias} has native precedence over ${path}; remove or rename that alias before activating the standardized file`,
      });
  }
}
