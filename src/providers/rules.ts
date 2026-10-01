import { promises as fs } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { stringify as yaml } from 'yaml';
import { EtymonError, Rule, ruleSchema, validName } from '../core/model.js';
import { digest, stable, walk } from '../core/fs.js';
import { ruleIdentity } from '../core/dedup.js';
import { frontmatter } from './agents.js';

export type RuleDialect =
  'plain' | 'claude' | 'copilot' | 'cursor' | 'kiro' | 'trigger' | 'cline' | 'continue' | 'amp';
export function splitGlobs(value: unknown): string[] {
  if (Array.isArray(value)) {
    if (!value.every((v) => typeof v === 'string' && v.trim()))
      throw new EtymonError('INVALID_RULE', 'Rule patterns must be nonempty strings');
    return value.map((v) => v.trim());
  }
  if (typeof value !== 'string')
    throw new EtymonError('INVALID_RULE', 'Rule patterns must be a string or array');
  const parts: string[] = [];
  let depth = 0,
    start = 0;
  for (let i = 0; i < value.length; i++) {
    if ('{['.includes(value[i])) depth++;
    else if ('}]'.includes(value[i])) depth--;
    else if (value[i] === ',' && depth === 0) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
    if (depth < 0) throw new EtymonError('INVALID_RULE', 'Unbalanced rule glob');
  }
  if (depth) throw new EtymonError('INVALID_RULE', 'Unbalanced rule glob');
  parts.push(value.slice(start).trim());
  if (parts.some((v) => !v)) throw new EtymonError('INVALID_RULE', 'Rule contains an empty glob');
  return parts;
}
export function detectRuleDialect(path: string, metadata: Record<string, unknown>): RuleDialect {
  const normalized = path.replaceAll('\\', '/');
  if (/(?:AGENTS(?:\.override)?|AGENT|CLAUDE(?:\.local)?|GEMINI)\.md$/i.test(normalized))
    return 'plain';
  if (normalized.endsWith('.mdc') || normalized.includes('.cursor/rules/')) return 'cursor';
  if (normalized.endsWith('.instructions.md') || 'applyTo' in metadata) return 'copilot';
  if ('trigger' in metadata) return 'trigger';
  if ('inclusion' in metadata || normalized.includes('.kiro/steering/')) return 'kiro';
  if (normalized.includes('.continue/rules/') || 'regex' in metadata) return 'continue';
  if (normalized.includes('.claude/rules/')) return 'claude';
  if (
    'paths' in metadata ||
    normalized.includes('.clinerules/') ||
    normalized.includes('.cline/rules/')
  )
    return 'cline';
  if ('globs' in metadata || 'alwaysApply' in metadata) return 'cursor';
  return 'plain';
}
export function parseRule(
  text: string,
  path: string,
  dialect?: RuleDialect,
  base = '.',
  layout?: Rule['layout'],
): Rule {
  // Canonical files remain human-editable Markdown; native context files are
  // plain text even when their contents happen to look like YAML frontmatter.
  const canonical = /^\uFEFF?---\r?\n(?:[^\n]*\n)*?etymon:\s*rule\s*\r?\n/.test(text);
  const body = (value: string) => value.replace(/^(?:\r?\n)+/, '').replace(/(?:\r?\n)+$/, '');
  const parsed =
    dialect === 'plain' && !canonical ? { metadata: {}, body: body(text) } : frontmatter(text);
  if (!(dialect === 'plain' && !canonical)) {
    const match = /^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(text);
    parsed.body = body(match ? match[1] : text);
  }
  const metadata = parsed.metadata;
  if (metadata.etymon === 'rule') {
    const { etymon: _marker, ...definition } = metadata;
    void _marker;
    return ruleSchema.parse({ ...definition, prompt: parsed.body });
  }
  const marker = /^<!-- etymon:scope ([A-Za-z0-9_-]+) -->\r?\n/.exec(parsed.body);
  if (marker) {
    const prompt = parsed.body.slice(marker[0].length);
    try {
      const saved = JSON.parse(Buffer.from(marker[1], 'base64url').toString('utf8'));
      if (saved.metadataHash === digest(stable(metadata)))
        return ruleSchema.parse({ ...saved.rule, prompt });
    } catch {
      throw new EtymonError('INVALID_RULE', `Invalid generated scope in ${path}`);
    }
    // A native frontmatter edit takes precedence over the saved portable scope.
    parsed.body = prompt;
  }
  const format = dialect ?? detectRuleDialect(path, metadata);
  const instructionFile =
    /^(?:AGENTS(?:\.override)?|AGENT|CLAUDE(?:\.local)?|GEMINI|copilot-instructions)\.md$/i.test(
      basename(path),
    );
  const defaultName = /^(?:AGENTS(?:\.override)?|AGENT|CLAUDE(?:\.local)?|GEMINI)\.md$/i.test(
    basename(path),
  )
    ? base === '.'
      ? 'instructions'
      : base + '-instructions'
    : basename(path).replace(/\.(?:instructions\.md|mdc|md|txt|ya?ml)$/, '');
  let activation: Rule['activation'] = 'always',
    patterns: string[] = [];
  const patternValue =
    format === 'copilot'
      ? (metadata.applyTo ?? metadata.paths)
      : ['claude', 'cline'].includes(format)
        ? metadata.paths
        : format === 'kiro'
          ? metadata.fileMatchPattern
          : (metadata.globs ?? metadata.glob);
  const setPatterns = () => {
    patterns = splitGlobs(patternValue);
    activation = patterns.length ? 'glob' : 'never';
  };
  if (['claude', 'cline', 'amp'].includes(format) && patternValue !== undefined) setPatterns();
  else if (format === 'copilot') {
    if (patternValue !== undefined) setPatterns();
    else activation = metadata.description ? 'model' : 'manual';
  } else if (format === 'cursor' || format === 'continue') {
    if (metadata.alwaysApply !== undefined && typeof metadata.alwaysApply !== 'boolean')
      throw new EtymonError('INVALID_RULE', 'alwaysApply must be a boolean');
    if (metadata.alwaysApply === true) activation = 'always';
    else if (patternValue !== undefined) setPatterns();
    else if (metadata.description && metadata.alwaysApply === false) activation = 'model';
    else
      activation =
        format === 'continue' && metadata.alwaysApply === undefined ? 'always' : 'manual';
  } else if (format === 'kiro') {
    const modes = { always: 'always', fileMatch: 'glob', manual: 'manual', auto: 'model' } as const;
    const mode = metadata.inclusion ?? 'always';
    if (typeof mode !== 'string' || !(mode in modes))
      throw new EtymonError('INVALID_RULE', `Unknown Kiro inclusion ${mode}`);
    activation = modes[mode as keyof typeof modes];
    if (activation === 'glob') setPatterns();
  } else if (format === 'trigger') {
    const modes = {
      always_on: 'always',
      glob: 'glob',
      model_decision: 'model',
      manual: 'manual',
    } as const;
    if (typeof metadata.trigger !== 'string' || !(metadata.trigger in modes))
      throw new EtymonError('INVALID_RULE', 'Rules in this directory require a valid trigger');
    activation = modes[metadata.trigger as keyof typeof modes];
    if (activation === 'glob') setPatterns();
  }
  const fields: Record<RuleDialect, string[]> = {
    plain: [],
    claude: ['paths'],
    cline: ['paths'],
    amp: ['globs'],
    copilot: ['applyTo', 'paths'],
    cursor: ['alwaysApply', 'globs'],
    continue: ['alwaysApply', 'globs'],
    kiro: ['inclusion', 'fileMatchPattern'],
    trigger: ['trigger', 'globs', 'glob'],
  };
  const known = ['name', 'description', ...fields[format]];
  const native = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !known.includes(key)),
  );
  // Continue can combine regex, glob, and model selection. Keep the source
  // conditions intact until an adapter has a verified portable mapping.
  if (
    format === 'continue' &&
    metadata.alwaysApply !== true &&
    (metadata.regex !== undefined ||
      (activation === 'glob' && metadata.alwaysApply === false && metadata.description))
  ) {
    activation = 'native';
    for (const key of ['regex', 'globs', 'alwaysApply'])
      if (key in metadata) native[key] = metadata[key];
  }
  return ruleSchema.parse({
    name: validName(typeof metadata.name === 'string' ? metadata.name : defaultName),
    prompt: parsed.body,
    base,
    layout:
      layout ??
      (instructionFile
        ? 'standing'
        : format !== 'plain' || knownDirectory.test(path.replaceAll('\\', '/'))
          ? 'modular'
          : 'standing'),
    activation,
    patterns,
    description: metadata.description,
    format,
    native,
  });
}
export function canonicalRuleText(rule: Rule): string {
  const { prompt, ...metadata } = rule;
  return `---\n${yaml({ etymon: 'rule', ...metadata })}---\n\n${prompt}\n`;
}
/** Retain directory scope across native formats without overriding later edits. */
export function scopedRuleText(rule: Rule, metadata: Record<string, unknown>): string {
  const { prompt, ...definition } = rule;
  const marker = Buffer.from(
    JSON.stringify({
      metadataHash: digest(stable(metadata)),
      rule: definition,
    }),
  ).toString('base64url');
  return `---\n${yaml(metadata)}---\n\n<!-- etymon:scope ${marker} -->\n${prompt}\n`;
}
/** Generated standing instruction files retain fragment boundaries for re-import. */
export function instructionText(rules: Rule[]): string {
  return (
    rules
      .map(
        ({ prompt, ...metadata }) =>
          `<!-- etymon:rule ${Buffer.from(JSON.stringify(metadata)).toString('base64url')} -->\n${prompt}\n<!-- /etymon:rule -->`,
      )
      .join('\n\n') + '\n'
  );
}
export function parseInstructionFile(
  text: string,
  path: string,
  base = '.',
  layout?: Rule['layout'],
): Rule[] {
  const regex =
    /^<!-- etymon:rule ([A-Za-z0-9_-]+) -->\r?\n([\s\S]*?)\r?\n<!-- \/etymon:rule -->$/gm;
  const result: Rule[] = [];
  for (const match of text.matchAll(regex)) {
    try {
      result.push(
        ruleSchema.parse({
          ...JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')),
          prompt: match[2],
          base,
        }),
      );
    } catch {
      throw new EtymonError('INVALID_RULE', `Invalid generated rule fragment in ${path}`);
    }
  }
  const remaining = text
    .replace(regex, '')
    .replace(/^(?:\r?\n)+/, '')
    .replace(/(?:\r?\n)+$/, '');
  if (remaining.includes('<!-- etymon:rule') || remaining.includes('<!-- /etymon:rule'))
    throw new EtymonError('INVALID_RULE', `Incomplete rule fragment in ${path}`);
  if (remaining.trim()) result.push(parseRule(remaining, path, 'plain', base, layout));
  return result;
}
function inferredBase(path: string, root: string): string {
  const rel = relative(root, path).replaceAll('\\', '/');
  const match =
    /^(.*?)\/?\.(?:claude|cursor|kiro|github|agents|agent|devin|windsurf|continue|cline)\/(?:rules|steering|instructions)\//.exec(
      rel,
    );
  if (match) return match[1] || '.';
  const alias = /^(.*?)\/?\.claude\/CLAUDE\.md$/.exec(rel);
  if (alias) return alias[1] || '.';
  if (/(?:AGENTS(?:\.override)?|AGENT|CLAUDE(?:\.local)?|GEMINI)\.md$/i.test(basename(path)))
    return dirname(rel) === '.' ? '.' : dirname(rel);
  return '.';
}
const knownFile =
  /(?:^|\/)(?:AGENTS(?:\.override)?\.md|AGENT\.md|CLAUDE\.md|GEMINI\.md|[^/]+\.instructions\.md|[^/]+\.mdc)$/;
const knownDirectory =
  /(?:^|\/)\.(?:claude\/rules|cursor\/rules|kiro\/steering|github\/instructions|agents\/rules|agent\/rules|devin\/rules|windsurf\/rules|continue\/rules|cline\/rules|clinerules|roo\/rules(?:-[^/]+)?|kilo\/rules|kilocode\/rules)(?:\/|$)/;
export async function discoverRules(
  root: string,
  names: string[] = [],
): Promise<{ path: string; rule: Rule }[]> {
  const isFile = (await fs.lstat(root)).isFile();
  const directory = isFile ? dirname(root) : root;
  const paths = isFile
    ? [root]
    : (await walk(root))
        .filter(
          (path) =>
            !path.startsWith('.agents/etymon/') &&
            (knownFile.test(path) || (knownDirectory.test(path) && /\.(?:md|txt)$/.test(path))),
        )
        .map((path) => join(root, path));
  const found: { path: string; rule: Rule }[] = [],
    identities = new Set<string>();
  for (const path of paths) {
    const text = await fs.readFile(path, 'utf8'),
      base = inferredBase(path, directory);
    const candidates = /^(?:AGENTS(?:\.override)?|AGENT|CLAUDE|GEMINI)\.md$/.test(basename(path))
      ? parseInstructionFile(text, path, base)
      : [parseRule(text, path, undefined, base)];
    for (const rule of candidates) {
      if (names.length && !names.includes('*') && !names.includes(rule.name)) continue;
      const hash = ruleIdentity(rule);
      if (identities.has(hash)) continue;
      const prior = found.find((value) => value.rule.name === rule.name);
      if (prior) rule.name = validName(rule.name.slice(0, 53) + '-' + hash.slice(7, 15));
      identities.add(hash);
      found.push({ path, rule });
    }
  }
  for (const name of names)
    if (name !== '*' && !found.some((value) => value.rule.name === name))
      throw new EtymonError('RULE_NOT_FOUND', `No rule named ${name} in source`);
  if (!found.length)
    throw new EtymonError(
      'NO_RULES',
      'No recognized rule files found; select a Markdown file explicitly for a standalone rule',
    );
  return found;
}
