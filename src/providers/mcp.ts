import { z } from 'zod';
import { Connection, EtymonError, Request, Value, validName, valueSchema } from '../core/model.js';
import { fetchText } from '../core/fs.js';

const inputSchema = z
  .object({
    name: z.string().optional(),
    valueHint: z.string().optional(),
    type: z.enum(['named', 'positional']).optional(),
    value: z.string().optional(),
    default: z.string().optional(),
    isRequired: z.boolean().optional(),
    isSecret: z.boolean().optional(),
    variables: z
      .record(
        z.string(),
        z.lazy(() => inputSchema),
      )
      .optional(),
  })
  .passthrough() as z.ZodType<Input>;
type Input = {
  name?: string;
  valueHint?: string;
  type?: 'named' | 'positional';
  value?: string;
  default?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  variables?: Record<string, Input>;
};
const transport = z
  .object({
    type: z.enum(['stdio', 'streamable-http', 'sse']),
    url: z.string().optional(),
    headers: z.array(inputSchema).optional(),
    variables: z.record(z.string(), inputSchema).optional(),
  })
  .passthrough();
const packageSchema = z
  .object({
    registryType: z.string(),
    identifier: z.string(),
    version: z.string().optional(),
    runtimeHint: z.string().optional(),
    registryBaseUrl: z.string().optional(),
    fileSha256: z.string().optional(),
    transport,
    runtimeArguments: z.array(inputSchema).optional(),
    packageArguments: z.array(inputSchema).optional(),
    environmentVariables: z.array(inputSchema).optional(),
  })
  .passthrough();
export const serverSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    version: z.string().min(1),
    packages: z.array(packageSchema).optional(),
    remotes: z.array(transport).optional(),
  })
  .passthrough();
export type Server = z.infer<typeof serverSchema>;
export const DEFAULT_REGISTRY = 'https://registry.modelcontextprotocol.io';
export class McpRegistry {
  constructor(public base = DEFAULT_REGISTRY) {
    const url = new URL(base);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      throw new EtymonError(
        'INVALID_REGISTRY',
        'Use an HTTP(S) registry without embedded credentials',
      );
  }
  async get(name: string, version = 'latest'): Promise<Server> {
    const result = JSON.parse(
      await fetchText(
        `${this.base.replace(/\/$/, '')}/v0.1/servers/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`,
      ),
    );
    const status = result._meta?.['io.modelcontextprotocol.registry/official']?.status;
    if (status && status !== 'active')
      throw new EtymonError('REGISTRY_STATUS', `${name} is ${status} in the registry`);
    const server = serverSchema.parse(result.server ?? result);
    if (server.name !== name)
      throw new EtymonError('REGISTRY_ID_MISMATCH', 'Registry returned a different server name');
    return server;
  }
  async search(
    query: string,
    limit = 20,
    cursor?: string,
  ): Promise<{ servers: Server[]; nextCursor?: string }> {
    const url = new URL(`${this.base.replace(/\/$/, '')}/v0.1/servers`);
    url.searchParams.set('search', query);
    url.searchParams.set('version', 'latest');
    url.searchParams.set('limit', String(limit));
    if (cursor) url.searchParams.set('cursor', cursor);
    const result = JSON.parse(await fetchText(url.href));
    return {
      servers: (result.servers ?? [])
        .filter((r: Record<string, unknown>) => {
          const meta = r._meta as Record<string, { status?: string }> | undefined;
          return (
            !meta?.['io.modelcontextprotocol.registry/official']?.status ||
            meta['io.modelcontextprotocol.registry/official'].status === 'active'
          );
        })
        .map((r: { server: unknown }) => serverSchema.parse(r.server)),
      nextCursor: result.metadata?.nextCursor,
    };
  }
}
function variableName(input: Input, key: string): string {
  return (input.name ?? input.valueHint ?? key)
    .replace(/^-+/, '')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .toUpperCase();
}
function inputValue(input: Input, key: string, values: Record<string, Value>): Value | undefined {
  const supplied = values[key];
  const secretTemplate =
    input.isSecret &&
    supplied === undefined &&
    input.value &&
    input.variables &&
    /\{[^{}]+\}/.test(input.value);
  if (input.isSecret && !secretTemplate) {
    if (supplied !== undefined && typeof supplied === 'string')
      throw new EtymonError(
        'SECRET_LITERAL',
        `Use --input '${key}=env:VARIABLE' for secret inputs; secret values are never written to the lock`,
      );
    return supplied ?? (input.isRequired ? { env: variableName(input, key) } : undefined);
  }
  let value: Value | undefined = supplied ?? input.value ?? input.default;
  if (value !== undefined && typeof value === 'string' && input.variables) {
    value = value.replace(/\{([^{}]+)\}/g, (original, name) => {
      const entry = input.variables?.[name];
      if (!entry) return original;
      const replacement = inputValue(
        { ...entry, isRequired: true, isSecret: input.isSecret || entry.isSecret },
        name,
        values,
      );
      if (replacement === undefined)
        throw new EtymonError(
          'MCP_INPUT_REQUIRED',
          `Missing input ${name}; pass --input '${name}=value'`,
        );
      return typeof replacement === 'string' ? replacement : `\${env:${replacement.env}}`;
    });
  }
  if (value === undefined && input.isRequired)
    throw new EtymonError(
      'MCP_INPUT_REQUIRED',
      `Missing input ${key}; pass --input '${key}=value' or '${key}=env:VARIABLE'`,
    );
  return value;
}
function argumentValues(inputs: Input[] | undefined, values: Record<string, Value>): Value[] {
  const args: Value[] = [];
  for (const [index, input] of (inputs ?? []).entries()) {
    const key = input.name ?? input.valueHint ?? String(index),
      value = inputValue(input, key, values);
    if (value === undefined) continue;
    if (input.type === 'named') {
      if (!input.name?.startsWith('-'))
        throw new EtymonError('INVALID_ARGUMENT', 'Registry named argument must start with a dash');
      args.push(input.name);
    }
    args.push(value);
  }
  return args;
}
function remoteConnection(
  remote: z.infer<typeof transport>,
  values: Record<string, Value>,
): Connection {
  if (remote.type === 'stdio' || !remote.url)
    throw new EtymonError('UNSUPPORTED_TRANSPORT', 'Remote server must specify an HTTP or SSE URL');
  const url = remote.url.replace(/\{([^{}]+)\}/g, (original, name) => {
    const entry = remote.variables?.[name];
    if (!entry) return original;
    const value = inputValue(entry, name, values);
    if (typeof value !== 'string')
      throw new EtymonError('MCP_URL_INPUT', `URL input ${name} needs a non-secret literal`);
    return encodeURIComponent(value);
  });
  if (/\{[^{}]+\}/.test(url))
    throw new EtymonError('MCP_URL_INPUT', 'Remote URL has unresolved variables');
  const headers: Record<string, Value> = {};
  for (const header of remote.headers ?? []) {
    if (!header.name) throw new EtymonError('INVALID_HEADER', 'Registry header lacks a name');
    const value = inputValue(header, header.name, values);
    if (value !== undefined) headers[header.name] = value;
  }
  return { transport: remote.type, url, headers };
}
export function resolveServer(server: Server, request: Request): Connection {
  const values = request.inputs ?? {};
  Object.values(values).forEach((v) => valueSchema.parse(v));
  const packages = server.packages ?? [],
    remotes = server.remotes ?? [];
  if (request.remote !== undefined) {
    if (!remotes[request.remote])
      throw new EtymonError('REMOTE_NOT_FOUND', `Remote index ${request.remote} does not exist`);
    return remoteConnection(remotes[request.remote], values);
  }
  let selected: z.infer<typeof packageSchema> | undefined;
  if (request.package) {
    const matching = packages.filter(
      (p) => p.registryType === request.package || p.identifier === request.package,
    );
    if (matching.length !== 1)
      throw new EtymonError(
        'PACKAGE_SELECTION',
        `--package ${request.package} must identify one package`,
      );
    selected = matching[0];
  } else if (packages.length + remotes.length !== 1)
    throw new EtymonError(
      'MCP_SELECTION_REQUIRED',
      `Choose an implementation with --package <identifier|npm|pypi|oci|nuget> or --remote <index>`,
      {
        packages: packages.map((p) => ({ type: p.registryType, identifier: p.identifier })),
        remotes: remotes.map((r, index) => ({ index, type: r.type, url: r.url })),
      },
    );
  else if (remotes.length) return remoteConnection(remotes[0], values);
  else selected = packages[0];
  if (!selected)
    throw new EtymonError('NO_IMPLEMENTATION', 'Registry entry has no runnable implementation');
  if (selected.transport.type !== 'stdio')
    throw new EtymonError(
      'PACKAGE_TRANSPORT_UNSUPPORTED',
      'MVP package launch supports stdio; choose a hosted --remote or supply a custom connection',
    );
  const version = selected.version;
  if (!version || version === 'latest' || /[~^*<>\s]/.test(version))
    throw new EtymonError(
      'UNPINNED_PACKAGE',
      `Registry package ${selected.identifier} needs an exact version`,
    );
  if (selected.identifier.startsWith('-'))
    throw new EtymonError('INVALID_PACKAGE', 'Package identifier cannot be an option');
  const runtimes: Record<string, { command: string; args: Value[] }> = {
    npm: { command: 'npx', args: ['--yes', `${selected.identifier}@${version}`] },
    pypi: {
      command: 'uvx',
      args: ['--from', `${selected.identifier}==${version}`, selected.identifier],
    },
    oci: { command: 'docker', args: ['run', '--rm', '-i', `${selected.identifier}:${version}`] },
    nuget: { command: 'dnx', args: [`${selected.identifier}@${version}`, '--yes'] },
  };
  const runtime = runtimes[selected.registryType];
  if (!runtime)
    throw new EtymonError(
      'PACKAGE_RUNTIME_UNSUPPORTED',
      `No MVP launcher for ${selected.registryType}; select another implementation`,
    );
  if (selected.runtimeHint && selected.runtimeHint !== runtime.command)
    throw new EtymonError(
      'RUNTIME_HINT_UNSUPPORTED',
      `Runtime ${selected.runtimeHint} differs from the verified ${runtime.command} mapping`,
    );
  if (selected.fileSha256)
    throw new EtymonError(
      'PACKAGE_HASH_UNSUPPORTED',
      'This package requires file-hash verification; the MVP does not download runtime packages. Select another implementation.',
    );
  const runtimeArgs = argumentValues(selected.runtimeArguments, values),
    packageArgs = argumentValues(selected.packageArguments, values);
  if (selected.registryBaseUrl) {
    if (
      selected.registryType === 'npm' &&
      selected.registryBaseUrl.replace(/\/$/, '') !== 'https://registry.npmjs.org'
    )
      runtimeArgs.unshift('--registry', selected.registryBaseUrl);
    else if (
      selected.registryType === 'pypi' &&
      selected.registryBaseUrl.replace(/\/$/, '') !== 'https://pypi.org'
    )
      runtimeArgs.unshift('--index-url', selected.registryBaseUrl);
  }
  const env: Record<string, Value> = {};
  for (const input of selected.environmentVariables ?? []) {
    if (!input.name)
      throw new EtymonError('INVALID_ENV', 'Registry environment variable needs a name');
    const value = inputValue(input, input.name, values);
    if (value !== undefined) env[input.name] = value;
  }
  if (selected.registryType === 'oci')
    for (const name of Object.keys(env)) runtimeArgs.push('-e', name);
  return {
    transport: 'stdio',
    command: runtime.command,
    args:
      selected.registryType === 'oci'
        ? [...runtime.args.slice(0, 3), ...runtimeArgs, ...runtime.args.slice(3), ...packageArgs]
        : selected.registryType === 'npm'
          ? ['--yes', ...runtimeArgs, ...runtime.args.slice(1), ...packageArgs]
          : [...runtimeArgs, ...runtime.args, ...packageArgs],
    env,
  };
}
export function sanitizeRegistry(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeRegistry);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(object)
        .filter(([key]) => !(object.isSecret === true && ['value', 'default'].includes(key)))
        .map(([key, v]) => [key, sanitizeRegistry(v)]),
    );
  }
  return value;
}
export function serverName(server: Server): string {
  return validName(server.name.split('/').at(-1) ?? server.name);
}
