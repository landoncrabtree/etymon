import { join } from 'node:path';
import { stringify as toml } from 'smol-toml';
import { stringify as yaml } from 'yaml';
import {
  Agent,
  Connection,
  Diagnostic,
  EtymonError,
  json,
  Resource,
  Value,
} from '../core/model.js';
import { digest, exists, fileArtifact, textFile } from '../core/fs.js';
import { Workspace } from '../core/workspace.js';
import { AgentDialect, agentExtension, location, Profile } from './profiles.js';
import { renderRules } from './rule-render.js';
import { renderSkill } from './skill-render.js';
import { isConversionLimit, omittedResource } from './loss.js';

export type Unit = {
  path: string;
  key?: string[];
  value?: unknown;
  content?: Buffer;
  mode?: number;
  resources: string[];
  harnesses: string[];
};
export type RenderResult = { units: Unit[]; diagnostics: Diagnostic[] };
export type RenderOptions = { allowLossy?: boolean; configPath?: string; rulesPath?: string };
const toolCapabilities: Record<string, string[]> = {
  Read: ['read'],
  Grep: ['search'],
  Glob: ['search'],
  LS: ['read'],
  Write: ['edit'],
  Edit: ['edit'],
  MultiEdit: ['edit'],
  Bash: ['shell'],
  WebSearch: ['websearch'],
  WebFetch: ['webfetch'],
  read: ['read', 'search'],
  search: ['search'],
  edit: ['edit'],
  execute: ['shell'],
  web: ['websearch', 'webfetch'],
  read_file: ['read'],
  list_directory: ['read'],
  grep_search: ['search'],
  glob: ['search'],
  write_file: ['edit'],
  replace: ['edit'],
  run_shell_command: ['shell'],
  google_web_search: ['websearch'],
  web_fetch: ['webfetch'],
};
function translateTools(agent: Agent, dialect: AgentDialect): unknown {
  if (agent.tools === undefined) return undefined;
  if (agent.format === dialect) return agent.tools;
  const capabilities = new Set<string>();
  for (const tool of agent.tools) {
    const mapping = toolCapabilities[tool];
    if (!mapping)
      throw new EtymonError(
        'TOOL_MAPPING_BLOCKED',
        `Cannot map tool ${tool} from ${agent.format} to ${dialect}`,
      );
    mapping.forEach((c) => capabilities.add(c));
  }
  const caps = [...capabilities];
  if (dialect === 'codex' || dialect === 'cursor' || dialect === 'antigravity')
    throw new EtymonError(
      'TOOL_RESTRICTION_BLOCKED',
      `${dialect} has no verified writer for this tool allowlist; preserve it on its source harness or author a target-specific agent`,
    );
  if (dialect === 'opencode')
    return Object.fromEntries([
      ['*', 'deny'],
      ...caps.flatMap((c) =>
        (c === 'search'
          ? ['grep', 'glob']
          : c === 'shell'
            ? ['bash']
            : c === 'edit'
              ? ['edit', 'write']
              : c === 'websearch'
                ? ['websearch']
                : c === 'webfetch'
                  ? ['webfetch']
                  : ['read']
        ).map((t) => [t, 'allow']),
      ),
    ]);
  const mappings: Record<string, Record<string, string[]>> = {
    claude: {
      read: ['Read'],
      search: ['Grep', 'Glob'],
      edit: ['Write', 'Edit'],
      shell: ['Bash'],
      websearch: ['WebSearch'],
      webfetch: ['WebFetch'],
    },
    omp: {
      read: ['read'],
      search: ['grep', 'find'],
      edit: ['write', 'edit'],
      shell: ['bash'],
      websearch: ['web_search'],
      webfetch: ['fetch'],
    },
    copilot: {
      read: ['read'],
      search: ['search'],
      edit: ['edit'],
      shell: ['execute'],
      websearch: ['web'],
      webfetch: ['web'],
    },
    gemini: {
      read: ['read_file', 'list_directory'],
      search: ['grep_search', 'glob'],
      edit: ['write_file', 'replace'],
      shell: ['run_shell_command'],
      websearch: ['google_web_search'],
      webfetch: ['web_fetch'],
    },
    kiro: {
      read: ['read'],
      search: ['read'],
      edit: ['write'],
      shell: ['shell'],
      websearch: ['web'],
      webfetch: ['web'],
    },
  };
  return [...new Set(caps.flatMap((c) => mappings[dialect]?.[c] ?? []))];
}
export function renderAgent(
  agent: Agent,
  p: Profile,
  options: RenderOptions = {},
): { text: string; diagnostics: Diagnostic[] } {
  const dialect = p.agentDialect!;
  const diagnostics: Diagnostic[] = [];
  const same = agent.format === dialect || (agent.format === 'kilo' && dialect === 'opencode');
  const dangerous = [
    'hooks',
    'permissionMode',
    'disallowedTools',
    'permissions',
    'permission',
    'sandbox_mode',
    'mcp_servers',
    'mcpServers',
    'mcp-servers',
    'skills',
    'resources',
    'includeMcpJson',
    'includePowers',
    'tools',
    'toolsSettings',
    'allowedTools',
    'excludedTools',
    'execution',
    'requirements',
  ];
  if (!same)
    for (const key of Object.keys(agent.native)) {
      if (dangerous.includes(key) && !options.allowLossy)
        throw new EtymonError(
          'REQUIRED_SEMANTICS_BLOCKED',
          `Agent ${agent.name} has ${agent.format} field ${key}; no verified mapping to ${p.id}`,
        );
      if (['category', 'color'].includes(key)) {
        diagnostics.push({
          code: 'METADATA_ADAPTED',
          severity: 'info',
          message: `${key} is retained in source and omitted from ${p.id} output`,
        });
        continue;
      }
      if (!options.allowLossy)
        throw new EtymonError(
          'NATIVE_FIELD_UNMAPPED',
          `Agent ${agent.name} field ${key} is native to ${agent.format}; review with --allow-lossy to omit it`,
        );
      diagnostics.push({
        code: 'NATIVE_FIELD_OMITTED',
        severity: 'warning',
        message: `Agent ${agent.name}: omitted ${agent.format} field ${key} for ${p.id}; its behavior and restrictions no longer apply`,
      });
    }
  let model = agent.model;
  if (!same && model && model !== 'inherit') {
    if (!options.allowLossy)
      throw new EtymonError(
        'MODEL_MAPPING_REQUIRED',
        `Model ${model} is native to ${agent.format}; author a target model or use --allow-lossy to inherit`,
      );
    diagnostics.push({
      code: 'MODEL_INHERITED',
      severity: 'warning',
      message: `${p.id} will inherit its model instead of ${model}`,
    });
    model = undefined;
  }
  const metadata: Record<string, unknown> = {
    ...(same ? agent.native : {}),
    name: agent.name,
    description: agent.description,
  };
  if (model && model !== 'inherit') metadata.model = model;
  let tools: unknown;
  try {
    tools = translateTools(agent, dialect);
  } catch (error) {
    if (!(error instanceof EtymonError) || !options.allowLossy || !isConversionLimit(error.code))
      throw error;
    diagnostics.push({
      code: 'TOOL_RESTRICTION_OMITTED',
      severity: 'warning',
      message: `Agent ${agent.name}: omitted tool allowlist ${JSON.stringify(agent.tools)} for ${p.id}; the destination's default tool permissions apply (${error.code}: ${error.message})`,
    });
  }
  if (dialect === 'codex')
    return { text: toml({ ...metadata, developer_instructions: agent.prompt }), diagnostics };
  if (dialect === 'kiro')
    return {
      text: json({
        ...metadata,
        prompt: agent.prompt,
        ...(tools !== undefined ? { tools } : {}),
        ...(same ? {} : { includeMcpJson: false, includePowers: false }),
      }),
      diagnostics,
    };
  if (dialect === 'opencode') {
    metadata.mode = metadata.mode ?? 'subagent';
    if (tools !== undefined) metadata.permission = tools;
  } else if (tools !== undefined) metadata.tools = tools;
  if (dialect === 'gemini') metadata.kind = metadata.kind ?? 'local';
  return { text: `---\n${yaml(metadata, { lineWidth: 0 })}---\n\n${agent.prompt}\n`, diagnostics };
}
function reference(value: Value, dialect: string): string {
  if (typeof value === 'string')
    return value.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, env) =>
      reference({ env }, dialect),
    );
  if (dialect === 'opencode') return `{env:${value.env}}`;
  if (dialect === 'vscode' || dialect === 'cursor') return `\${env:${value.env}}`;
  if (dialect === 'standard') return `\${${value.env}}`;
  if (dialect === 'gemini') return `\${${value.env}}`;
  throw new EtymonError(
    'SECRET_REFERENCE_UNSUPPORTED',
    `No verified remote environment interpolation for ${dialect}`,
  );
}
export function renderMcp(connection: Connection, p: Profile): Record<string, unknown> {
  const dialect = p.mcpDialect ?? 'standard';
  if (connection.transport === 'stdio') {
    const args = connection.args.map((v) => reference(v, dialect));
    const env = Object.fromEntries(
      Object.entries(connection.env).map(([k, v]) => [k, reference(v, dialect)]),
    );
    if (dialect === 'opencode')
      return {
        type: 'local',
        command: [connection.command, ...args],
        environment: env,
        enabled: true,
      };
    if (dialect === 'zed') return { command: connection.command, args, env };
    return {
      command: connection.command,
      args,
      env,
      ...(connection.cwd ? { cwd: connection.cwd } : {}),
      ...(dialect === 'copilot'
        ? { type: 'local', tools: ['*'] }
        : dialect === 'vscode'
          ? { type: 'stdio' }
          : {}),
    };
  }
  if (connection.transport === 'sse' && ['codex', 'pi', 'opencode', 'kilo', 'zed'].includes(p.id))
    throw new EtymonError(
      'TRANSPORT_UNSUPPORTED',
      `${p.id} has no verified legacy SSE output mapping`,
    );
  if (dialect === 'codex') {
    const headers: Record<string, string> = {},
      envHeaders: Record<string, string> = {};
    let bearer: string | undefined;
    for (const [key, value] of Object.entries(connection.headers)) {
      if (typeof value === 'string') {
        const direct = /^\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value);
        const token = /^Bearer \$\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value);
        if (direct) envHeaders[key] = direct[1];
        else if (token && key.toLowerCase() === 'authorization') bearer = token[1];
        else if (/\$\{env:/.test(value))
          throw new EtymonError(
            'SECRET_REFERENCE_UNSUPPORTED',
            'Codex supports full environment headers or a bearer token reference, not arbitrary header templates',
          );
        else headers[key] = value;
      } else envHeaders[key] = value.env;
    }
    return {
      url: connection.url,
      ...(Object.keys(headers).length ? { http_headers: headers } : {}),
      ...(Object.keys(envHeaders).length ? { env_http_headers: envHeaders } : {}),
      ...(bearer ? { bearer_token_env_var: bearer } : {}),
    };
  }
  const headers = Object.fromEntries(
    Object.entries(connection.headers).map(([k, v]) => [
      k,
      reference(v, p.id === 'cursor' ? 'cursor' : dialect),
    ]),
  );
  if (dialect === 'opencode')
    return { type: 'remote', url: connection.url, headers, enabled: true };
  if (dialect === 'gemini')
    return {
      [connection.transport === 'streamable-http' ? 'httpUrl' : 'url']: connection.url,
      headers,
    };
  if (dialect === 'antigravity') return { serverUrl: connection.url, headers };
  if (dialect === 'amp' || dialect === 'zed') return { url: connection.url, headers };
  return {
    type: connection.transport === 'sse' ? 'sse' : dialect === 'cline' ? 'streamableHttp' : 'http',
    url: connection.url,
    headers,
    ...(dialect === 'copilot' ? { tools: ['*'] } : {}),
  };
}
function runtimeNeeded(connection: Connection): boolean {
  return (
    connection.transport === 'stdio' &&
    [...connection.args, ...Object.values(connection.env)].some(
      (v) => typeof v !== 'string' || /\$\{env:/.test(v),
    )
  );
}
export function launcher(connection: Extract<Connection, { transport: 'stdio' }>): string {
  return `// Generated by etymon. Values are resolved at execution time, never stored here.\nimport { spawn } from 'node:child_process';\nconst spec = ${JSON.stringify(connection)};\nfunction expand(value) {\n  if (typeof value === 'object') { const v = process.env[value.env]; if (v === undefined) throw new Error('Missing environment variable: ' + value.env); return v; }\n  return value.replace(/\\$\\{env:([A-Za-z_][A-Za-z0-9_]*)\\}/g, (_, name) => { const v = process.env[name]; if (v === undefined) throw new Error('Missing environment variable: ' + name); return v; });\n}\ntry {\n  const child = spawn(spec.command, spec.args.map(expand), { shell: false, stdio: 'inherit', cwd: spec.cwd, env: { ...process.env, ...Object.fromEntries(Object.entries(spec.env).map(([k,v]) => [k,expand(v)])) } });\n  child.on('error', e => { process.stderr.write(e.message + '\\n'); process.exitCode = 1; });\n  child.on('exit', (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exitCode = code ?? 1; });\n  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));\n} catch (e) { process.stderr.write(e.message + '\\n'); process.exitCode = 1; }\n`;
}
export async function render(
  resources: Resource[],
  p: Profile,
  workspace: Workspace,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const units: Unit[] = [],
    diagnostics: Diagnostic[] = [];
  const rules = await renderRules(resources, p, workspace, options);
  units.push(...rules.units);
  diagnostics.push(...rules.diagnostics);
  for (const resource of resources) {
    if (resource.kind === 'rule') continue;
    const destination = location(p, resource.kind, workspace, options.configPath);
    const owner = { resources: [resource.id], harnesses: [p.id] };
    if (!destination) {
      const diagnostic: Diagnostic = {
        code: 'CAPABILITY_UNSUPPORTED',
        severity: 'error',
        message: `${p.label} has no verified ${workspace.global ? 'global' : 'project'} ${resource.kind} writer. ${p.notes?.join(' ') ?? ''}`,
        resource: resource.id,
        harness: p.id,
      };
      diagnostics.push(options.allowLossy ? omittedResource(diagnostic) : diagnostic);
      continue;
    }
    const start = units.length;
    try {
      if (resource.kind === 'skill') {
        const result = renderSkill(resource, p, options);
        diagnostics.push(...result.diagnostics);
        for (const file of result.artifact.files) {
          units.push({
            path: join(destination, resource.name, file.path),
            content: Buffer.from(file.content, 'base64'),
            mode: file.executable ? 0o755 : 0o644,
            ...owner,
          });
        }
      } else if (resource.kind === 'agent') {
        const result = renderAgent(resource.agent, p, options);
        diagnostics.push(
          ...result.diagnostics.map((d) => ({ ...d, resource: resource.id, harness: p.id })),
        );
        units.push({
          path: join(destination, resource.name + agentExtension(p)),
          content: Buffer.from(result.text),
          mode: 0o644,
          ...owner,
        });
      } else {
        if (
          resource.connection.transport === 'stdio' &&
          ['npx', 'uvx', 'docker', 'dnx'].includes(resource.connection.command)
        )
          diagnostics.push({
            code: 'RUNTIME_CONFIGURATION_ONLY',
            severity: 'warning',
            message: `${resource.name} pins its top-level package/version; its runtime dependencies are installed by ${resource.connection.command} when the harness starts it`,
            resource: resource.id,
            harness: p.id,
          });
        if (resource.native && Object.keys(resource.native).length && resource.format !== p.id) {
          if (!options.allowLossy)
            throw new EtymonError(
              'MCP_NATIVE_FIELDS_BLOCKED',
              `MCP ${resource.name} has unmapped ${resource.format} configuration fields: ${Object.keys(resource.native).join(', ')}`,
            );
          diagnostics.push({
            code: 'MCP_FIELDS_OMITTED',
            severity: 'warning',
            message: `MCP ${resource.name}: omitted ${resource.format} fields ${Object.keys(resource.native).join(', ')} from ${p.id}; their behavior and restrictions no longer apply`,
            resource: resource.id,
            harness: p.id,
          });
        }
        let connection = resource.connection;
        if (runtimeNeeded(connection) && connection.transport === 'stdio') {
          const path = join(
            workspace.runtime,
            'runtime',
            'mcp',
            digest(resource.id).slice(7, 23) + '.mjs',
          );
          units.push({ path, content: Buffer.from(launcher(connection)), mode: 0o600, ...owner });
          connection = { transport: 'stdio', command: process.execPath, args: [path], env: {} };
        }
        if (p.id === 'pi' && connection.transport === 'sse')
          throw new EtymonError('TRANSPORT_UNSUPPORTED', 'Pi rejects legacy SSE connections');
        if (p.mcpDialect === 'continue') {
          const native = renderMcp(connection, { ...p, mcpDialect: 'standard' });
          delete native.type;
          if (connection.transport !== 'stdio') native.type = connection.transport;
          units.push({
            path: join(destination, `etymon-${resource.name}.yaml`),
            content: Buffer.from(
              yaml({
                name: resource.name,
                version: '1.0.0',
                schema: 'v1',
                mcpServers: [{ name: resource.name, ...native }],
              }),
            ),
            mode: 0o644,
            ...owner,
          });
        } else {
          let path = destination;
          if (
            p.mcpDialect === 'opencode' &&
            !options.configPath &&
            (await exists(path.replace(/\.json$/, '.jsonc')))
          )
            path = path.replace(/\.json$/, '.jsonc');
          const native = {
            ...renderMcp(connection, p),
            ...(resource.format === p.id ? (resource.native ?? {}) : {}),
          };
          units.push({
            path,
            key: [p.map ?? 'mcpServers', resource.name],
            value: native,
            ...owner,
          });
        }
      }
    } catch (e) {
      if (!(e instanceof EtymonError)) throw e;
      units.splice(start);
      const diagnostic: Diagnostic = {
        code: e.code,
        severity: 'error',
        message: e.message,
        resource: resource.id,
        harness: p.id,
      };
      diagnostics.push(
        options.allowLossy && isConversionLimit(e.code) ? omittedResource(diagnostic) : diagnostic,
      );
    }
  }
  diagnostics.push(
    ...(p.notes ?? []).map((message) => ({
      code: 'NATIVE_PREREQUISITE',
      severity: 'info' as const,
      message,
      harness: p.id,
    })),
  );
  return { units, diagnostics };
}
export function agentArtifact(agent: Agent): string {
  return textFile(fileArtifact('agent.json', json(agent)), 'agent.json');
}
