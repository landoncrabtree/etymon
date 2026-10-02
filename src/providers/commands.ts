import { promises as fs } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { parse as toml } from 'smol-toml';
import { Artifact, EtymonError } from '../core/model.js';
import {
  CommandFormat,
  commandFormatSchema,
  CommandSemantics,
  SkillPolicy,
  skillPolicy,
} from '../core/commands.js';
import { bundleIdentity } from '../core/dedup.js';
import { exists, fileArtifact, safeRelative, textFile, walk } from '../core/fs.js';
import { frontmatter } from './agents.js';
import { invocationFiles, policyMetadata, skillText } from './skill-policy.js';
import { commandProfiles, CommandSource } from '../harnesses/command-profiles.js';
import { readDocument } from '../core/documents.js';

export type CommandSkill = {
  path: string;
  name: string;
  artifact: Artifact;
  format: CommandFormat;
  nativeName: string;
  origins?: string[];
};
export function commandName(value: string): string {
  const name = value
    .replace(/^\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (!name || name.length > 64)
    throw new EtymonError(
      'INVALID_COMMAND',
      `Command name cannot become a valid skill name: ${value}`,
    );
  return name;
}

function features(body: string, format: CommandFormat): CommandSemantics['features'] {
  const result: CommandSemantics['features'] = [];
  const dollarTemplates = ['claude', 'copilot', 'codex', 'opencode', 'kilo', 'pi', 'omp'];
  if (
    (dollarTemplates.includes(format) &&
      /\$(?:ARGUMENTS(?:\[\d+\])?|\d|@|\{(?:\d|@)[^}]*\})/.test(body)) ||
    (format === 'codex' && /(?<!\$)\$[A-Z][A-Z0-9_]*/.test(body)) ||
    (format === 'gemini' && /\{\{\s*args\s*\}\}/.test(body)) ||
    (format === 'omp' && /\{\{[\s\S]*?\}\}/.test(body))
  )
    result.push('arguments');
  if (
    (['claude', 'copilot', 'opencode', 'kilo'].includes(format) && /!`|^```!/m.test(body)) ||
    (format === 'gemini' && /[!@]\{/.test(body)) ||
    (['opencode', 'kilo'].includes(format) && /(?:^|\s)@[^\s`]+|\{(?:env|file):/.test(body)) ||
    (['claude', 'copilot'].includes(format) && /\$\{CLAUDE_(?:SESSION_ID|SKILL_DIR)\}/.test(body))
  )
    result.push('context');
  if (['windsurf', 'antigravity'].includes(format) && /\/\/\s*turbo(?:-all)?\b/.test(body))
    result.push('execution');
  if (
    ['windsurf', 'antigravity', 'cline', 'kilo'].includes(format) &&
    /\b(?:call|invoke|run|use)\b[^\n]*`?\/[a-z][\w:-]*/i.test(body)
  )
    result.push('workflow');
  return result;
}

function commandBody(text: string): string {
  return text
    .replace(/^\uFEFF?---\s*\r?\n[\s\S]*?\r?\n---[^\S\r\n]*(?:\r?\n|$)/, '')
    .replace(/^(?:\r?\n)+|(?:\r?\n)+$/g, '');
}
function sourceFields(artifact: Artifact): Record<string, unknown> {
  const metadata = frontmatter(textFile(artifact, 'SKILL.md')).metadata;
  const policy = skillPolicy(metadata);
  return {
    description: metadata.description,
    ...(metadata.license ? { license: metadata.license } : {}),
    ...(metadata.compatibility ? { compatibility: metadata.compatibility } : {}),
    ...policy.command?.native,
    ...(policy.argumentHint ? { 'argument-hint': policy.argumentHint } : {}),
    'disable-model-invocation': policy.invocation === 'manual' || policy.invocation === 'never',
    'user-invocable': policy.invocation !== 'model' && policy.invocation !== 'never',
    ...(metadata.metadata && typeof metadata.metadata === 'object'
      ? {
          metadata: Object.fromEntries(
            Object.entries(metadata.metadata).filter(([key]) => !key.startsWith('etymon.')),
          ),
        }
      : {}),
  };
}

/** Parsing is deliberately inert: templates, shell substitutions and hooks are data. */
export function parseCommand(
  text: string,
  name: string,
  format: CommandFormat = 'markdown',
): Artifact {
  commandFormatSchema.parse(format);
  let metadata: Record<string, unknown>, body: string;
  try {
    if (format === 'gemini') {
      metadata = { ...toml(text) };
      if (typeof metadata.prompt !== 'string')
        throw new Error('Gemini command requires a prompt string');
      body = metadata.prompt;
      delete metadata.prompt;
    } else {
      metadata = frontmatter(text).metadata;
      body = commandBody(text);
    }
  } catch (error) {
    throw new EtymonError(
      'INVALID_COMMAND',
      `Invalid ${format} command ${name}: ${(error as Error).message}`,
    );
  }
  if (!body.trim())
    throw new EtymonError('INVALID_COMMAND', `Command ${name} has empty instructions`);
  if (metadata.name !== undefined && typeof metadata.name !== 'string')
    throw new EtymonError('INVALID_COMMAND', 'Command name must be a string');
  if (
    metadata.description !== undefined &&
    (typeof metadata.description !== 'string' ||
      !metadata.description.trim() ||
      metadata.description.length > 1024)
  )
    throw new EtymonError(
      'INVALID_COMMAND',
      `Command ${name} description must be a nonempty string of at most 1024 characters`,
    );
  for (const key of ['disable-model-invocation', 'user-invocable'])
    if (metadata[key] !== undefined && typeof metadata[key] !== 'boolean')
      throw new EtymonError('INVALID_COMMAND', `Command ${name} ${key} must be boolean`);
  if (metadata['argument-hint'] !== undefined && typeof metadata['argument-hint'] !== 'string')
    throw new EtymonError('INVALID_COMMAND', 'argument-hint must be a string');
  const native = { ...metadata };
  const extra = metadata.metadata;
  if (
    extra !== undefined &&
    (!extra ||
      typeof extra !== 'object' ||
      Array.isArray(extra) ||
      Object.entries(extra).some(
        ([key, value]) => typeof value !== 'string' || key.startsWith('etymon.'),
      ))
  )
    throw new EtymonError(
      'INVALID_COMMAND',
      'Command metadata must contain string values and cannot set reserved Etymon keys',
    );
  for (const key of ['license', 'compatibility'])
    if (metadata[key] !== undefined && typeof metadata[key] !== 'string')
      throw new EtymonError('INVALID_COMMAND', `${key} must be a string`);
  for (const key of ['__proto__', 'constructor', 'prototype'])
    if (Object.hasOwn(native, key))
      throw new EtymonError('INVALID_COMMAND', `Unsafe command field ${key}`);
  for (const key of [
    'name',
    'description',
    'license',
    'compatibility',
    'argument-hint',
    'disable-model-invocation',
    'user-invocable',
    'metadata',
  ])
    delete native[key];
  const implicit =
    metadata['disable-model-invocation'] === false ||
    (metadata['disable-model-invocation'] === undefined &&
      ['claude', 'copilot', 'antigravity'].includes(format));
  const user = metadata['user-invocable'] !== false;
  const policy: SkillPolicy = {
    invocation: implicit ? (user ? 'auto' : 'model') : user ? 'manual' : 'never',
    ...(metadata['argument-hint'] ? { argumentHint: String(metadata['argument-hint']) } : {}),
  };
  const required = features(body, format);
  if (required.length || Object.keys(native).length)
    policy.command = { version: 1, format, native, features: required };
  const normalized = commandName(String(metadata.name ?? name));
  const output = {
    name: normalized,
    description:
      metadata.description ??
      body
        .split(/\r?\n/)
        .find((line) => line.trim())!
        .replace(/^#+\s*/, '')
        .trim()
        .slice(0, 1024),
    ...(metadata.license !== undefined ? { license: metadata.license } : {}),
    ...(metadata.compatibility !== undefined ? { compatibility: metadata.compatibility } : {}),
    metadata: { ...(extra as Record<string, string> | undefined), ...policyMetadata(policy) },
  };
  return {
    version: 1,
    files: [...fileArtifact('SKILL.md', skillText(output, body)).files, ...invocationFiles(policy)],
  };
}

export async function readCommandFile(
  path: string,
  source: CommandSource,
  root: string,
  previous: CommandSkill[] = [],
): Promise<CommandSkill | undefined> {
  const stat = await fs.lstat(path);
  if (stat.isSymbolicLink())
    throw new EtymonError('SOURCE_SYMLINK', `Command source is a symlink: ${path}`);
  if (!stat.isFile()) return undefined;
  const extension = extname(path);
  const executable = source.format === 'amp' && Boolean(stat.mode & 0o111) && extension !== '.md';
  if (
    !executable &&
    !(source.format === 'gemini'
      ? extension === '.toml'
      : source.format === 'kiro'
        ? !extension || /\.(?:md|markdown|txt)$/.test(extension)
        : source.format === 'cline'
          ? /\.(?:md|markdown|txt)$/.test(extension)
          : extension === '.md')
  )
    return undefined;
  if (stat.size > 1024 * 1024)
    throw new EtymonError('SOURCE_LIMIT', `Command exceeds 1 MiB: ${path}`);
  const nativeName = source.namespace
    ? relative(root, path)
        .replaceAll('\\', '/')
        .replace(/\.[^.]+$/, '')
        .replaceAll('/', ':')
    : basename(path, extension);
  let artifact: Artifact;
  if (executable) {
    const filename = basename(path);
    safeRelative(filename);
    artifact = parseCommand(
      `---\ndescription: Run the ${commandName(nativeName)} command\n---\nInspect scripts/${filename}, then run it with the user's arguments.`,
      nativeName,
      'amp',
    );
    const parsed = frontmatter(Buffer.from(artifact.files[0].content, 'base64').toString('utf8'));
    (parsed.metadata.metadata as Record<string, string>)['etymon.command'] = JSON.stringify({
      version: 1,
      format: 'amp',
      native: {},
      features: ['execution'],
    });
    artifact.files[0] = fileArtifact('SKILL.md', skillText(parsed.metadata, parsed.body)).files[0];
    artifact.files.push({
      path: 'scripts/' + filename,
      content: (await fs.readFile(path)).toString('base64'),
      executable: true,
    });
  } else {
    const text = await fs.readFile(path, 'utf8');
    const prior =
      source.format === 'opencode'
        ? previous.find(
            (command) => command.format === source.format && command.nativeName === nativeName,
          )
        : undefined;
    artifact = parseCommand(
      prior
        ? skillText(
            { ...sourceFields(prior.artifact), ...frontmatter(text).metadata },
            commandBody(text),
          )
        : text,
      nativeName,
      source.format,
    );
  }
  return {
    path,
    format: source.format,
    nativeName,
    name: String(
      frontmatter(Buffer.from(artifact.files[0].content, 'base64').toString('utf8')).metadata.name,
    ),
    artifact,
  };
}

export async function readCommandConfig(
  path: string,
  source: CommandSource,
  previous: CommandSkill[] = [],
): Promise<CommandSkill[]> {
  const doc = readDocument(await fs.readFile(path, 'utf8'), 'json');
  let entries: unknown;
  if (source.format === 'continue') entries = doc.customCommands ?? [];
  else {
    const map = doc.command ?? {};
    if (!map || typeof map !== 'object' || Array.isArray(map))
      throw new EtymonError('INVALID_COMMAND', `Invalid command map in ${path}`);
    entries = Object.entries(map).map(([name, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new EtymonError('INVALID_COMMAND', `Invalid command ${name} in ${path}`);
      return { ...value, name };
    });
  }
  if (!Array.isArray(entries))
    throw new EtymonError('INVALID_COMMAND', `Invalid command collection in ${path}`);
  return entries.map((entry: Record<string, unknown>) => {
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string')
      throw new EtymonError('INVALID_COMMAND', `Invalid command entry in ${path}`);
    const { name, template, prompt, ...metadata } = entry;
    const prior = previous.find(
      (command) => command.format === source.format && command.nativeName === name,
    );
    let base: Record<string, unknown> = {},
      body: string | undefined;
    if (prior) {
      base = sourceFields(prior.artifact);
      body = commandBody(textFile(prior.artifact, 'SKILL.md'));
    }
    const instructions = template ?? prompt ?? body;
    if (typeof instructions !== 'string')
      throw new EtymonError(
        'INVALID_COMMAND',
        `Command ${name} in ${path} requires a template or an existing command file`,
      );
    const artifact = parseCommand(
      skillText({ ...base, ...metadata }, instructions),
      name,
      source.format,
    );
    return {
      path: path + ':' + name,
      name: commandName(name),
      nativeName: name,
      format: source.format,
      artifact,
      ...(prior ? { origins: [...(prior.origins ?? [prior.path]), path + ':' + name] } : {}),
    };
  });
}

export function applyCommandOverrides(found: CommandSkill[], overrides: CommandSkill[]): void {
  for (const command of overrides) {
    for (let index = found.length - 1; index >= 0; index--)
      if (found[index].format === command.format && found[index].nativeName === command.nativeName)
        found.splice(index, 1);
    found.push(command);
  }
}

export function selectCommands(found: CommandSkill[], names: string[]): CommandSkill[] {
  const unique = new Map<string, CommandSkill>();
  for (const command of found) {
    if (
      names.length &&
      !names.includes('*') &&
      !names.some((name) => commandName(name) === command.name)
    )
      continue;
    const prior = unique.get(command.name);
    if (prior && bundleIdentity(prior.artifact) !== bundleIdentity(command.artifact))
      throw new EtymonError(
        'COMMAND_NAME_COLLISION',
        `Different commands normalize to skill ${command.name}: ${prior.path} and ${command.path}`,
      );
    if (!prior) unique.set(command.name, command);
  }
  for (const name of names)
    if (name !== '*' && !unique.has(commandName(name)))
      throw new EtymonError('COMMAND_NOT_FOUND', `No command named ${name} in source`);
  if (!unique.size)
    throw new EtymonError(
      'NO_COMMANDS',
      'No command definitions found; select a native command directory or --format',
    );
  return [...unique.values()];
}

export async function discoverCommands(
  root: string,
  names: string[] = [],
  format: CommandFormat | 'auto' = 'auto',
  options: { repository?: boolean } = {},
): Promise<CommandSkill[]> {
  const found: CommandSkill[] = [];
  const stat = await fs.lstat(root);
  if (stat.isSymbolicLink())
    throw new EtymonError('SOURCE_SYMLINK', `Command source is a symlink: ${root}`);
  if (format !== 'auto' && !commandFormatSchema.safeParse(format).success)
    throw new EtymonError('INVALID_COMMAND', `Unknown command source format ${format}`);
  const infer = (path: string): CommandFormat =>
    Object.values(commandProfiles)
      .flatMap((p) => [...p.project, ...p.global])
      .find((s) => {
        const normalized = path.replaceAll('\\', '/');
        return normalized.includes('/' + s.path + '/') || normalized.endsWith('/' + s.path);
      })?.format ?? (path.endsWith('.toml') ? 'gemini' : 'markdown');
  if (stat.isFile()) {
    const selected = format === 'auto' ? infer(root) : format;
    if (['.json', '.jsonc'].includes(extname(root)))
      found.push(
        ...(await readCommandConfig(root, {
          path: root,
          format: selected === 'markdown' ? 'opencode' : selected,
          config: true,
        })),
      );
    else {
      const command = await readCommandFile(root, { path: root, format: selected }, root);
      if (command) found.push(command);
    }
  } else {
    const declared = [
      ...new Map(
        Object.values(commandProfiles)
          .flatMap((p) => p.project)
          .filter((source) => format === 'auto' || source.format === format)
          .map((source) => [source.path, source]),
      ).values(),
    ];
    const existing: CommandSource[] = [];
    for (const source of declared) if (await exists(join(root, source.path))) existing.push(source);
    if (!existing.length && options.repository)
      throw new EtymonError(
        'NO_COMMANDS',
        'Repository contains no recognized command directories or configurations; select a subpath',
      );
    const sources = existing.length
      ? existing
      : [{ path: '.', format: format === 'auto' ? infer(root + '/') : format, recursive: true }];
    for (const source of sources) {
      const directory = join(root, source.path);
      if (source.config) {
        applyCommandOverrides(found, await readCommandConfig(directory, source, found));
        continue;
      }
      for (const child of await walk(directory, 128)) {
        if (!source.recursive && child.includes('/')) continue;
        const command = await readCommandFile(join(directory, child), source, directory, found);
        if (command) {
          if (source.format === 'opencode') applyCommandOverrides(found, [command]);
          else found.push(command);
        }
      }
    }
  }
  return selectCommands(found, names);
}
