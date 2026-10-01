import { Command } from 'commander';
import * as prompts from '@clack/prompts';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  EtymonError,
  errorMessage,
  json,
  Kind,
  kinds,
  Request,
  Value,
  VERSION,
} from './core/model.js';
import { run } from './core/fs.js';
import { Workspace } from './core/workspace.js';
import { readState, recover } from './core/transaction.js';
import { profiles, profile } from './harnesses/profiles.js';
import { add, convert, doctor, remove, resources, sync, update } from './services/environment.js';
import { discoverRules } from './providers/rules.js';
import { McpRegistry } from './providers/mcp.js';
import { discoverAgents } from './providers/agents.js';
import { discoverSkills, stageRepositorySkills } from './providers/skills.js';
import { parseResourceSource, withSource } from './providers/source.js';
import { inspectUninstall, uninstall } from './services/uninstall.js';
import { create, creationValues, CreationDraft } from './services/create.js';

type Options = {
  cwd?: string;
  global?: boolean;
  cache?: string;
  home?: string;
  debug?: boolean;
  offline?: boolean;
  json?: boolean;
  yes?: boolean;
  harness?: string[];
  configPath?: string;
  rulesPath?: string;
  dryRun?: boolean;
  adopt?: boolean;
  force?: boolean;
  allowLossy?: boolean;
  locked?: boolean;
  skill?: string[];
  agent?: string[];
  rule?: string[];
  destDir?: string;
  ref?: string;
  version?: string;
  registry?: string;
  package?: string;
  remote?: string;
  input?: string[];
  list?: boolean;
  cursor?: string;
  limit?: string;
  removeUserConfig?: boolean;
  keepUserConfig?: boolean;
  name?: string;
  description?: string;
  body?: string;
  bodyFile?: string;
  license?: string;
  compatibility?: string;
  model?: string;
  tools?: string[];
  transport?: string;
  url?: string;
  command?: string;
  serverCwd?: string;
  arg?: string[];
  env?: string[];
  header?: string[];
  activation?: string;
  layout?: string;
  pattern?: string[];
};
const program = new Command()
  .name('etymon')
  .description(
    'Install, convert, and sync skills, MCP servers, agents, and rules across coding tools.',
  )
  .version(VERSION)
  .option('--cwd <path>', 'project directory', process.cwd())
  .option('-g, --global', 'use your personal environment')
  .option('--cache <path>', 'artifact cache directory')
  .option('--home <path>', 'home directory for isolated profiles')
  .option('--offline', 'use cached locked artifacts only')
  .option('--json', 'machine-readable output')
  .option('--debug', 'provider commands and error stack traces')
  .option('-y, --yes', 'use noninteractive defaults')
  .option('-H, --harness <targets...>', 'harness IDs (comma-separated or space-separated)')
  .option('--config-path <path>', 'explicit native MCP configuration path (one harness)')
  .option('--rules-path <path>', 'explicit project instruction directory (one harness)');
function options(command: Command): Options {
  return command.optsWithGlobals() as Options;
}
function workspace(opts: Options): Workspace {
  return new Workspace(opts);
}
function checked<T>(value: T): Exclude<T, symbol> {
  if (prompts.isCancel(value)) throw new EtymonError('CANCELLED', 'Cancelled');
  return value as Exclude<T, symbol>;
}
function interactive(opts: Options): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && !opts.yes && !opts.json);
}
function output(value: unknown, opts: Options, text?: string): void {
  if (opts.json) process.stdout.write(json(value));
  else process.stdout.write((text ?? format(value)) + '\n');
}
function format(value: unknown): string {
  if (Array.isArray(value)) return value.map(format).join('\n');
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}
function reportPlan(plan: Awaited<ReturnType<typeof sync>>, opts: Options): void {
  if (opts.json)
    output(
      { dryRun: Boolean(opts.dryRun), changes: plan.summary, diagnostics: plan.diagnostics },
      opts,
    );
  else {
    const changes = plan.summary.map((c) => `${c.action.padEnd(6)} ${c.path}`);
    const diagnostics = plan.diagnostics.map((d) => `${d.severity}: [${d.code}] ${d.message}`);
    output([...changes, ...diagnostics].join('\n') || 'Already in sync.', opts);
  }
  if (plan.diagnostics.some((d) => d.severity === 'error')) process.exitCode = 1;
}
async function targets(opts: Options, ws: Workspace): Promise<string[]> {
  let ids =
    opts.harness?.flatMap((s) => s.split(',')).filter(Boolean) ?? (await readState(ws)).targets;
  if (!ids.length && interactive(opts))
    ids = checked(
      await prompts.multiselect({
        message: 'Select harnesses',
        options: profiles.map((p) => ({ value: p.id, label: p.label })),
        required: true,
      }),
    );
  if (!ids.length)
    throw new EtymonError(
      'HARNESS_REQUIRED',
      'Select a target with --harness claude,codex,opencode (or run in an interactive terminal)',
    );
  ids = [...new Set(ids.map((id) => profile(id).id))];
  if ((opts.configPath || opts.rulesPath) && ids.length !== 1)
    throw new EtymonError(
      'CONFIG_PATH_SCOPE',
      '--config-path and --rules-path require exactly one harness',
    );
  return ids;
}
async function mutate<T>(
  ws: Workspace,
  dryRun: boolean | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return dryRun
    ? fn()
    : ws.exclusive(async () => {
        await recover(ws);
        return fn();
      });
}
function syncOptions(opts: Options) {
  return {
    ...opts,
    configPath: opts.configPath ? resolve(opts.cwd ?? process.cwd(), opts.configPath) : undefined,
    rulesPath: opts.rulesPath ? resolve(opts.cwd ?? process.cwd(), opts.rulesPath) : undefined,
  };
}
function request(source: string, opts: Options, kind: Kind): Request {
  const inputs: Record<string, Value> = {};
  for (const input of opts.input ?? []) {
    const split = input.indexOf('=');
    if (split < 1)
      throw new EtymonError('INVALID_INPUT', 'Use --input name=value or name=env:VARIABLE');
    const key = input.slice(0, split),
      value = input.slice(split + 1);
    if (Object.hasOwn(inputs, key))
      throw new EtymonError('DUPLICATE_INPUT', `Duplicate input ${key}`);
    inputs[key] = value.startsWith('env:') ? { env: value.slice(4) } : value;
  }
  const remote = opts.remote === undefined ? undefined : Number(opts.remote);
  if (remote !== undefined && (!Number.isInteger(remote) || remote < 0))
    throw new EtymonError('INVALID_REMOTE', '--remote must be a nonnegative integer');
  return {
    source,
    ...(kind === 'rule' && opts.destDir !== undefined ? { destDir: opts.destDir } : {}),
    names:
      kind === 'skill'
        ? (opts.skill ?? [])
        : kind === 'agent'
          ? (opts.agent ?? [])
          : kind === 'rule'
            ? (opts.rule ?? [])
            : [],
    ref: opts.ref,
    version: opts.version,
    registry: opts.registry,
    package: opts.package,
    remote,
    ...(Object.keys(inputs).length ? { inputs } : {}),
  };
}
function creationFlags(command: Command, kind: Kind): Command {
  command.option('--name <name>', 'custom resource name');
  if (kind === 'mcp')
    return command
      .option('--transport <type>', 'stdio, streamable-http, or sse')
      .option('--url <url>', 'HTTP/SSE endpoint')
      .option('--command <executable>', 'STDIO executable')
      .option('--server-cwd <directory>', 'STDIO server working directory')
      .option(
        '--arg <value>',
        'STDIO argument (repeatable)',
        (value, prior: string[]) => [...prior, value],
        [],
      )
      .option('--env <values...>', 'NAME=value or NAME=env:VARIABLE')
      .option('--header <values...>', 'HTTP headers as NAME=value or NAME=env:VARIABLE');
  command
    .option('--description <text>', 'when to use this resource')
    .option('--body <text>', 'instructions')
    .option('--body-file <path>', 'read instructions from a file, or - for stdin');
  if (kind === 'skill')
    command
      .option('--license <name>', 'optional license')
      .option('--compatibility <text>', 'optional requirements');
  if (kind === 'agent')
    command
      .option('--model <name>', 'optional model preference')
      .option('--tools <names...>', 'optional tool allowlist');
  if (kind === 'rule')
    command
      .option('--activation <mode>', 'always, glob, model, manual, or never')
      .option('--layout <layout>', 'preferred rule output: standing or modular')
      .option(
        '--pattern <glob>',
        'file pattern (repeatable)',
        (value, prior: string[]) => [...prior, value],
        [],
      );
  return command;
}
async function createResource(kind: Kind, opts: Options): Promise<void> {
  if (opts.body !== undefined && opts.bodyFile !== undefined)
    throw new EtymonError('INVALID_OPTIONS', 'Choose --body or --body-file');
  let body = opts.body;
  if (opts.bodyFile === '-') {
    if (process.stdin.isTTY)
      throw new EtymonError('STDIN_REQUIRED', 'Pipe instructions into --body-file -');
    body = '';
    for await (const chunk of process.stdin) body += chunk.toString();
  } else if (opts.bodyFile)
    body = await readFile(resolve(opts.cwd ?? process.cwd(), opts.bodyFile), 'utf8');
  const initial: Record<string, unknown> = {};
  if (opts.name !== undefined) initial.name = opts.name;
  if (kind === 'mcp') {
    if (opts.transport || opts.command || opts.url)
      initial.connection =
        opts.transport === 'stdio' || (!opts.transport && opts.command)
          ? {
              transport: 'stdio',
              command: opts.command,
              args: opts.arg ?? [],
              env: creationValues(opts.env ?? []),
              ...(opts.serverCwd !== undefined ? { cwd: opts.serverCwd } : {}),
            }
          : {
              transport: opts.transport ?? 'streamable-http',
              url: opts.url,
              headers: creationValues(opts.header ?? []),
            };
  } else {
    if (body !== undefined) initial.body = body;
    if (opts.description !== undefined) initial.description = opts.description;
    if (kind === 'agent') {
      if (opts.model) initial.model = opts.model;
      if (opts.tools)
        initial.tools = opts.tools.flatMap((value) => value.split(',')).filter(Boolean);
    }
    if (kind === 'skill') {
      if (opts.license) initial.license = opts.license;
      if (opts.compatibility) initial.compatibility = opts.compatibility;
    }
    if (kind === 'rule') {
      if (opts.destDir) initial.destDir = opts.destDir;
      if (opts.activation) initial.activation = opts.activation;
      if (opts.layout) initial.layout = opts.layout;
      if (opts.pattern?.length) initial.patterns = opts.pattern;
    }
  }
  const ws = workspace(opts);
  const draft = interactive(opts)
    ? await (
        await import('./tui/create.js')
      ).promptCreation(kind, initial as CreationDraft, undefined, { global: ws.global })
    : { kind, ...initial };
  const result = await mutate(ws, false, () => create(ws, draft));
  output(
    result,
    opts,
    `Created ${result.names.join(', ')}\n${result.path}\nRun etymon sync to activate.`,
  );
}
const init = program
  .command('init')
  .description('Create authoritative files and ignore generated harness output')
  .action(async (_options, command: Command) => {
    const opts = options(command),
      ws = workspace(opts);
    await mutate(ws, false, () => ws.init());
    output(
      { manifest: ws.manifestPath, lock: ws.lockPath },
      opts,
      `Initialized ${ws.manifestPath}\n${ws.lockPath}`,
    );
  });
void init;
program
  .command('uninstall')
  .description('Uninstall the global npm package; optionally remove personal config and lockfile')
  .option('--dry-run', 'show the installation and personal files without changing them')
  .option('--keep-user-config', 'keep personal config and lockfile without prompting')
  .option('--remove-user-config', 'remove personal config and lockfile without prompting')
  .action(async (_options, command: Command) => {
    const opts = options(command);
    if (opts.keepUserConfig && opts.removeUserConfig)
      throw new EtymonError(
        'INVALID_OPTIONS',
        'Choose either --keep-user-config or --remove-user-config',
      );
    const personal = new Workspace({ ...opts, global: true });
    const plan = await inspectUninstall(personal);
    if (opts.dryRun) {
      output({ dryRun: true, ...plan, removeUserConfig: Boolean(opts.removeUserConfig) }, opts);
      return;
    }
    let removeUserConfig =
      opts.removeUserConfig ?? (opts.keepUserConfig || opts.yes ? false : undefined);
    if (removeUserConfig === undefined) {
      if (!interactive(opts))
        throw new EtymonError(
          'TTY_REQUIRED',
          'Run etymon uninstall in a terminal, or choose --keep-user-config or --remove-user-config. --yes keeps personal files.',
        );
      const { chooseUninstall } = await import('./tui/uninstall.js');
      removeUserConfig = await chooseUninstall(plan);
      if (removeUserConfig === undefined) throw new EtymonError('CANCELLED', 'Uninstall cancelled');
    }
    const result = await uninstall(personal, removeUserConfig);
    output(
      result,
      opts,
      [
        result.uninstalled
          ? 'Uninstalled the global etymon package.'
          : 'No global npm installation was found.',
        result.removedFiles.length
          ? `Removed:\n${result.removedFiles.join('\n')}`
          : plan.personalFiles.length
            ? 'Personal config and lockfile kept.'
            : 'No personal config or lockfile was found.',
      ].join('\n'),
    );
  });
for (const kind of kinds) {
  const group = program.command(kind).description(`Manage ${kind} resources`);
  if (kind !== 'mcp') group.alias(kind + 's');
  const adding = group
    .command('add [source]')
    .description(`Register a local ${kind} or lock an external source`)
    .option('--ref <revision>', 'Git branch, tag, or commit')
    .option('--list', 'inspect source without registering');
  if (kind === 'skill')
    adding.option('-s, --skill <names...>', 'skill names (default: all source skills)');
  if (kind === 'agent')
    adding.option('-a, --agent <names...>', 'agent names (default: all source agents)');
  if (kind === 'rule')
    adding
      .option('-r, --rule <names...>', 'rule names (default: all recognized source rules)')
      .option(
        '--dest-dir <directory>',
        'project-relative instruction scope (default: detected source scope)',
      );
  if (kind === 'mcp')
    adding
      .option('--version <version>', 'registry metadata version (default: latest)')
      .option('--registry <url>', 'MCP registry base URL')
      .option('--package <identifier>', 'select package identifier or registry type')
      .option('--remote <index>', 'select hosted connection index')
      .option('--input <values...>', 'metadata inputs as NAME=value or NAME=env:VARIABLE');
  creationFlags(adding, kind);
  const creating = creationFlags(
    group
      .command('create')
      .description(`Author a custom ${kind}; opens a form in interactive terminals`),
    kind,
  );
  if (kind === 'rule')
    creating.option('--dest-dir <directory>', 'project-relative directory scope');
  creating.action(async (_options, command: Command) => createResource(kind, options(command)));
  adding.action(async (source: string | undefined, _options, command: Command) => {
    const opts = options(command),
      ws = workspace(opts);
    if (source === undefined) {
      await createResource(kind, opts);
      return;
    }
    let req = request(source, opts, kind);
    const parsed = await parseResourceSource(kind, source, ws.cwd, opts.ref, ws.home);
    if (parsed.type === 'local') req.source = parsed.path;
    if (opts.list) {
      if (parsed.type === 'registry') {
        output(await new McpRegistry(opts.registry).get(parsed.id, opts.version), opts);
        return;
      }
      if (kind === 'mcp' && parsed.type === 'local') {
        output(JSON.parse(await readFile(parsed.path, 'utf8')), opts);
        return;
      }
      const listing = await withSource(parsed, ws, async (root) =>
        kind === 'skill'
          ? (
              await (parsed.type === 'local'
                ? discoverSkills(root, req.names)
                : stageRepositorySkills(root, req.names, ws))
            ).map((s) => ({ name: s.name, path: s.path }))
          : kind === 'rule'
            ? (await discoverRules(root, req.names)).map(({ rule }) => ({
                name: rule.name,
                base: rule.base,
                activation: rule.activation,
                layout: rule.layout,
                patterns: rule.patterns,
                format: rule.format,
              }))
            : (await discoverAgents(root, req.names)).map((a) => ({
                name: a.agent.name,
                description: a.agent.description,
                format: a.agent.format,
              })),
      );
      output(listing, opts);
      return;
    }
    if (
      parsed.type === 'registry' &&
      !req.package &&
      req.remote === undefined &&
      interactive(opts)
    ) {
      const server = await new McpRegistry(opts.registry).get(source, opts.version);
      const choices = [
        ...(server.packages ?? []).map((p) => ({
          value: 'package:' + p.identifier,
          label: `${p.registryType}: ${p.identifier}@${p.version}`,
        })),
        ...(server.remotes ?? []).map((r, index) => ({
          value: 'remote:' + index,
          label: `${r.type}: ${r.url}`,
        })),
      ];
      if (choices.length > 1) {
        const selection = checked(
          await prompts.select({ message: 'Select server implementation', options: choices }),
        );
        req = selection.startsWith('package:')
          ? { ...req, package: selection.slice(8) }
          : { ...req, remote: Number(selection.slice(7)) };
      }
    }
    const result = await mutate(ws, false, () => add(ws, kind, req));
    output(
      result,
      opts,
      `Added ${result.names.join(', ')}\n${result.ids.join('\n')}\nRun etymon sync --harness <target> to activate.`,
    );
  });
  group
    .command('remove <id-or-name>')
    .alias('rm')
    .description('Remove a registration and unchanged owned native output; keep authored source')
    .option('--dry-run', 'preview removal')
    .option('--allow-lossy', 'allow lossy conversion when rebuilding remaining rule output')
    .action(async (selector: string, _options, command: Command) => {
      const opts = options(command),
        ws = workspace(opts);
      const result = await mutate(ws, opts.dryRun, () => remove(ws, kind, selector, opts));
      reportPlan(result.plan, opts);
    });
  group
    .command('list')
    .alias('ls')
    .description('List registered resources')
    .action(async (_options, command: Command) => {
      const opts = options(command),
        ws = workspace(opts);
      const lock = await ws.lock(),
        manifest = await ws.manifest();
      output(
        {
          external: lock.dependencies.filter((d) => d.kind === kind),
          authored: manifest[kind],
          resolved: (await resources(ws)).filter((resource) => resource.kind === kind),
        },
        opts,
      );
    });
  if (kind === 'mcp') {
    group
      .command('find <query>')
      .alias('search')
      .description('Search the official MCP registry')
      .option('--registry <url>', 'registry base URL')
      .option('--cursor <cursor>', 'next-page cursor')
      .option('--limit <count>', 'page size', '20')
      .action(async (query: string, _options, command: Command) => {
        const opts = options(command);
        if (opts.offline)
          throw new EtymonError('OFFLINE_SEARCH', 'Registry search requires network');
        const limit = Number(opts.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100)
          throw new EtymonError('INVALID_LIMIT', '--limit must be 1–100');
        output(await new McpRegistry(opts.registry).search(query, limit, opts.cursor), opts);
      });
    group
      .command('info <id>')
      .description('Inspect server metadata and implementation options')
      .option('--registry <url>', 'registry base URL')
      .option('--version <version>', 'metadata version')
      .action(async (id: string, _options, command: Command) => {
        const opts = options(command);
        if (opts.offline)
          throw new EtymonError('OFFLINE_SEARCH', 'Registry inspection requires network');
        output(await new McpRegistry(opts.registry).get(id, opts.version), opts);
      });
  }
  if (kind === 'skill')
    group
      .command('find <query>')
      .description('Search skills.sh through the pinned skills CLI')
      .action(async (query: string, _options, command: Command) => {
        const opts = options(command);
        if (opts.json)
          throw new EtymonError(
            'JSON_UNSUPPORTED',
            'skills find does not provide a stable JSON interface',
          );
        if (opts.offline) throw new EtymonError('OFFLINE_SEARCH', 'Skills search requires network');
        output(
          await run(
            process.platform === 'win32' ? 'npx.cmd' : 'npx',
            ['--yes', `skills@${(await workspace(opts).lock()).toolchain.skills}`, 'find', query],
            { env: { DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1' }, debug: opts.debug },
          ),
          opts,
        );
      });
}
program
  .command('sync')
  .description('Restore exact locked artifacts and generate native output')
  .option('--dry-run', 'show write plan without applying')
  .option('--locked', 'require matching toolchain versions')
  .option('--adopt', 'take ownership of existing output')
  .option('--force', 'replace edits to already-owned output')
  .option(
    '--allow-lossy',
    'allow behavior changes or omitted resources with explicit conversion warnings',
  )
  .action(async (_options, command: Command) => {
    const opts = options(command),
      ws = workspace(opts),
      ids = await targets(opts, ws);
    reportPlan(await mutate(ws, opts.dryRun, () => sync(ws, ids, syncOptions(opts))), opts);
  });
program
  .command('convert [harness]')
  .description(
    'Import all detected native resources, or filter with --harness; leave originals untouched',
  )
  .option('--dry-run', 'inspect import without writing source')
  .action(async (target: string | undefined, _options, command: Command) => {
    const opts = options(command),
      ws = workspace(opts);
    if (target && opts.harness?.length)
      throw new EtymonError(
        'INVALID_OPTIONS',
        'Choose a positional harness or --harness, not both',
      );
    const result = await mutate(ws, opts.dryRun, () =>
      convert(ws, target ?? opts.harness, syncOptions(opts)),
    );
    output(result, opts);
    if (result.diagnostics.some((d) => d.severity === 'error')) process.exitCode = 1;
  });
program
  .command('update [ids...]')
  .description('Re-resolve external dependencies; sync separately to activate')
  .action(async (ids: string[], _options, command: Command) => {
    const opts = options(command),
      ws = workspace(opts);
    output(await mutate(ws, false, () => update(ws, ids)), opts);
  });
program
  .command('list')
  .alias('ls')
  .description('List authored references and locked external dependencies')
  .action(async (_options, command: Command) => {
    const opts = options(command),
      ws = workspace(opts);
    output(
      {
        scope: ws.global ? 'global' : 'project',
        lock: await ws.lock(),
        authored: await ws.manifest(),
      },
      opts,
    );
  });
program
  .command('doctor')
  .description('Inspect ownership, compatibility, environment references, and prerequisites')
  .option('--allow-lossy', 'assess conversion with behavior changes or omitted resources')
  .action(async (_options, command: Command) => {
    const opts = options(command),
      ws = workspace(opts);
    const ids = opts.harness ? await targets(opts, ws) : (await readState(ws)).targets;
    const result = await doctor(ws, ids, syncOptions(opts));
    output(
      result,
      opts,
      `${result.ok ? 'OK' : 'Needs attention'}\n${result.diagnostics.map((d) => `${d.severity}: [${d.code}] ${d.message}`).join('\n')}`,
    );
    if (!result.ok) process.exitCode = 1;
  });
program
  .command('recover')
  .description('Roll back an interrupted transaction without overwriting later edits')
  .action(async (_options, command: Command) => {
    const opts = options(command),
      ws = workspace(opts);
    output({ recovered: await ws.exclusive(() => recover(ws)) }, opts);
  });
program
  .command('harnesses')
  .description('Show every harness profile and its capability gates')
  .action((_options, command: Command) => {
    const opts = options(command);
    output(
      profiles.map((p) => ({
        id: p.id,
        label: p.label,
        skills: Boolean(p.skill),
        agents: Boolean(p.agent),
        mcp: Boolean(p.mcp || ['cline', 'zed'].includes(p.id)),
        rules: p.rule,
        notes: p.notes,
        sources: p.sources,
      })),
      opts,
      profiles
        .map(
          (p) =>
            `${p.id.padEnd(16)} skills:${p.skill ? 'yes' : '—'} agents:${p.agent ? 'yes' : '—'} mcp:${p.mcp ? 'yes' : p.id === 'zed' || p.id === 'cline' ? 'config-path' : '—'} rules:${p.rule ? 'yes' : '—'}  ${p.label}`,
        )
        .join('\n'),
    );
  });
async function tui(): Promise<void> {
  const opts = options(program);
  if (opts.json)
    throw new EtymonError(
      'TUI_JSON_UNSUPPORTED',
      'Use subcommands with --json; the TUI is interactive.',
    );
  const { launchTui } = await import('./tui/app.js');
  await launchTui(workspace(opts), {
    harness: opts.harness,
    configPath: opts.configPath ? resolve(opts.cwd ?? process.cwd(), opts.configPath) : undefined,
    rulesPath: opts.rulesPath ? resolve(opts.cwd ?? process.cwd(), opts.rulesPath) : undefined,
    debug: opts.debug,
  });
}
program.command('tui').description('Open the terminal application').action(tui);
async function menu(): Promise<void> {
  const opts = options(program);
  if (!interactive(opts)) {
    program.outputHelp();
    return;
  }
  await tui();
}
program.action(menu);
try {
  await program.parseAsync(process.argv);
} catch (error) {
  const opts = options(program);
  const code = error instanceof EtymonError ? error.code : 'UNEXPECTED_ERROR';
  if (opts.json)
    process.stdout.write(
      json({
        error: {
          code,
          message: errorMessage(error),
          ...(error instanceof EtymonError && error.details ? { details: error.details } : {}),
        },
      }),
    );
  else {
    process.stderr.write(`etymon: [${code}] ${errorMessage(error)}\n`);
    if (error instanceof EtymonError && error.details) process.stderr.write(json(error.details));
  }
  if (opts.debug && error instanceof Error) process.stderr.write(error.stack + '\n');
  process.exitCode = code === 'CANCELLED' ? 130 : 1;
}
