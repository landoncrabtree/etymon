import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { parseDocument, stringify as yaml } from 'yaml';
import {
  Agent,
  agentSchema,
  Artifact,
  Connection,
  Diagnostic,
  EtymonError,
  json,
  McpDefinition,
  Resource,
  Value,
  validName,
} from '../core/model.js';
import { exists, readOptional, walk } from '../core/fs.js';
import { readDocument } from '../core/documents.js';
import { Workspace } from '../core/workspace.js';
import { parseAgent } from '../providers/agents.js';
import { discoverNativeSkills } from '../providers/skills.js';
import { agentExtension, location, Profile } from './profiles.js';
import { readLocations } from './discovery.js';
import { importRules, ImportedRule } from './rule-import.js';
import { bundleIdentity, resourceIdentity } from '../core/dedup.js';
import { stable } from '../core/fs.js';
import { skillMetadata } from '../providers/skills.js';
import { canonicalRuleText } from '../providers/rules.js';

export type Imported =
  | ImportedRule
  | ({ name: string; origin: string; origins?: string[] } & (
      | { kind: 'skill'; artifact: Artifact }
      | { kind: 'agent'; text: string; extension: string }
      | { kind: 'mcp'; definition: McpDefinition }
    ));

export function importedResource(resource: Imported): Resource {
  const common = { id: '', kind: resource.kind, name: resource.name };
  switch (resource.kind) {
    case 'rule':
      return { ...common, kind: 'rule', rule: resource.rule };
    case 'skill':
      return {
        ...common,
        kind: 'skill',
        files: resource.artifact.files,
        metadata: skillMetadata(resource.artifact),
      };
    case 'agent':
      return { ...common, kind: 'agent', agent: agentSchema.parse(JSON.parse(resource.text)) };
    case 'mcp':
      return { ...common, kind: 'mcp', ...resource.definition };
  }
}

/** Read every selected profile before committing one deduplicated import. */
export async function importHarnesses(
  profiles: Profile[],
  workspace: Workspace,
  configPath?: string,
  rulesPath?: string,
): Promise<{ resources: Imported[]; diagnostics: Diagnostic[] }> {
  if ((configPath || rulesPath) && profiles.length !== 1)
    throw new EtymonError(
      'CONFIG_PATH_SCOPE',
      '--config-path and --rules-path require exactly one harness',
    );
  const resources: Imported[] = [],
    diagnostics: Diagnostic[] = [],
    names = new Map<string, Imported>(),
    rules = new Map<string, Imported>(),
    importedRulePaths = new Set<string>();
  for (const p of profiles) {
    // Profile order gives a native format its first interpretation. In
    // particular, .claude/rules must not also become Copilot manual rules.
    const imported = await importHarness(p, workspace, configPath, rulesPath, importedRulePaths);
    diagnostics.push(...imported.diagnostics);
    for (let resource of imported.resources) {
      const identity = resourceIdentity(importedResource(resource));
      const named = names.get(resource.kind + ':' + resource.name);
      const duplicate =
        resource.kind === 'rule'
          ? rules.get(identity)
          : named && resourceIdentity(importedResource(named)) === identity
            ? named
            : undefined;
      if (duplicate) {
        duplicate.origins = [
          ...new Set([
            ...(duplicate.origins ?? [duplicate.origin]),
            ...(resource.origins ?? [resource.origin]),
          ]),
        ];
        diagnostics.push({
          code: 'RESOURCE_DUPLICATE',
          severity: 'info',
          harness: p.id,
          message: `${resource.origin} duplicates ${duplicate.origin}; imported ${resource.kind}:${duplicate.name} once`,
        });
        continue;
      }
      if (named) {
        if (resource.kind !== 'rule')
          throw new EtymonError(
            'IMPORT_COLLISION',
            `Different imported definitions share ${resource.kind}:${resource.name}: ${named.origin} and ${resource.origin}`,
          );
        const name = validName(resource.name.slice(0, 53) + '-' + identity.slice(7, 15));
        const rule = { ...resource.rule, name };
        resource = { ...resource, name, rule, text: canonicalRuleText(rule) };
      }
      names.set(resource.kind + ':' + resource.name, resource);
      if (resource.kind === 'rule') rules.set(identity, resource);
      resources.push(resource);
    }
  }
  return { resources, diagnostics };
}
function assertNoCredentials(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoCredentials);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item === 'string' &&
      /token|password|credential|secret|authorization|api.?key/i.test(key) &&
      !/_env_var$/.test(key) &&
      item
    )
      throw new EtymonError(
        'NATIVE_CREDENTIALS_BLOCKED',
        `Native field ${key} may contain credentials; externalize it before conversion`,
      );
    assertNoCredentials(item);
  }
}
function reference(
  value: unknown,
  name: string,
  diagnostics: Diagnostic[],
  sensitive = false,
): Value {
  if (typeof value !== 'string')
    throw new EtymonError('INVALID_NATIVE_VALUE', `MCP ${name} value must be a string`);
  const env = /^(?:\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}|\{env:([A-Za-z_][A-Za-z0-9_]*)\})$/.exec(
    value,
  );
  if (env) return { env: env[1] ?? env[2] };
  if (sensitive && value !== '') {
    const key = name.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();
    diagnostics.push({
      code: 'SECRET_EXTERNALIZED',
      severity: 'warning',
      message: `Literal ${name} was replaced with environment reference ${key}; set it outside the project`,
    });
    return { env: key };
  }
  return value;
}
export function importMcp(
  value: unknown,
  p: Profile,
  diagnostics: Diagnostic[],
): { connection: Connection; native: Record<string, unknown>; format: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new EtymonError('INVALID_NATIVE_MCP', 'MCP entry must be an object');
  const object = value as Record<string, unknown>;
  const known = new Set([
    'command',
    'args',
    'env',
    'environment',
    'cwd',
    'url',
    'httpUrl',
    'serverUrl',
    'type',
    'headers',
    'http_headers',
    'env_http_headers',
    'bearer_token_env_var',
    'enabled',
  ]);
  const native = Object.fromEntries(Object.entries(object).filter(([key]) => !known.has(key)));
  assertNoCredentials(native);
  // Copilot tools select exposure. Preserve non-default filters as native requirements.
  if (Array.isArray(native.tools) && native.tools.length === 1 && native.tools[0] === '*')
    delete native.tools;
  if (object.enabled === false)
    throw new EtymonError(
      'DISABLED_MCP',
      'Disabled MCP server is reported and not imported for activation',
    );
  if (object.command) {
    const command = Array.isArray(object.command)
      ? String(object.command[0])
      : String(object.command);
    const args = Array.isArray(object.command) ? object.command.slice(1) : (object.args ?? []);
    if (!Array.isArray(args))
      throw new EtymonError('INVALID_NATIVE_MCP', 'MCP args must be an array');
    const rawEnv = object.env ?? object.environment ?? {};
    if (!rawEnv || typeof rawEnv !== 'object' || Array.isArray(rawEnv))
      throw new EtymonError('INVALID_NATIVE_MCP', 'MCP env must be an object');
    const env = Object.fromEntries(
      Object.entries(rawEnv).map(([key, v]) => [
        key,
        reference(v, key, diagnostics, Boolean(/key|token|secret|password|credential/i.test(key))),
      ]),
    );
    return {
      connection: {
        transport: 'stdio',
        command,
        args: args.map((v, index) =>
          reference(
            v,
            `ARG_${index}`,
            diagnostics,
            index > 0 &&
              typeof args[index - 1] === 'string' &&
              /^--?(?:api[-_]?key|token|password|secret|authorization)$/i.test(
                String(args[index - 1]),
              ),
          ),
        ),
        env,
        ...(typeof object.cwd === 'string' ? { cwd: object.cwd } : {}),
      },
      native,
      format: p.id,
    };
  }
  const url = object.httpUrl ?? object.url ?? object.serverUrl;
  if (typeof url !== 'string') throw new EtymonError('INVALID_NATIVE_MCP', 'No MCP command or URL');
  if (/^[a-z]+:\/\/[^/]*@/.test(url) || /[?&](?:token|key|password|secret)=/i.test(url))
    throw new EtymonError(
      'SECRET_URL_BLOCKED',
      'MCP URL contains credentials; remove them and use environment header references before conversion',
    );
  const rawHeaders = object.http_headers ?? object.headers ?? {};
  if (!rawHeaders || typeof rawHeaders !== 'object' || Array.isArray(rawHeaders))
    throw new EtymonError('INVALID_NATIVE_MCP', 'MCP headers must be an object');
  const headers: Record<string, Value> = Object.fromEntries(
    Object.entries(rawHeaders).map(([key, v]) => [key, reference(v, key, diagnostics, true)]),
  );
  if (object.env_http_headers && typeof object.env_http_headers === 'object')
    for (const [key, v] of Object.entries(object.env_http_headers))
      headers[key] = { env: String(v) };
  if (typeof object.bearer_token_env_var === 'string') {
    native.bearer_token_env_var = object.bearer_token_env_var;
  }
  const transport =
    object.type === 'sse' || (p.mcpDialect === 'gemini' && !object.httpUrl)
      ? 'sse'
      : 'streamable-http';
  return { connection: { transport, url, headers }, native, format: p.id };
}
function safeAgent(agent: Agent): Agent {
  assertNoCredentials(agent.native);
  const text = JSON.stringify(agent.native);
  if (/"(?:env|headers|mcpServers|mcp_servers|mcp-servers)"\s*:/.test(text))
    throw new EtymonError(
      'AGENT_SECRET_REVIEW',
      'Agent has embedded MCP/header/environment configuration; externalize it before import',
    );
  return agent;
}
export async function importHarness(
  p: Profile,
  workspace: Workspace,
  configPath?: string,
  rulesPath?: string,
  importedRulePaths?: Set<string>,
): Promise<{ resources: Imported[]; diagnostics: Diagnostic[] }> {
  const resources: Imported[] = [],
    diagnostics: Diagnostic[] = [];
  for (const skills of readLocations(p, 'skill', workspace))
    if (await exists(skills)) {
      for (const skill of await discoverNativeSkills(skills, workspace.root))
        resources.push({
          kind: 'skill',
          name: skill.name,
          artifact: skill.artifact,
          origin: skill.path,
        });
    }
  const agents = location(p, 'agent', workspace);
  if (agents && (await exists(agents))) {
    for (const path of await walk(agents))
      if (path.endsWith(agentExtension(p))) {
        const full = join(agents, path);
        const text = await fs.readFile(full, 'utf8');
        const agent = safeAgent(parseAgent(text, full, p.agentDialect));
        resources.push({
          kind: 'agent',
          name: agent.name,
          text: json(agent),
          extension: '.json',
          origin: full,
        });
      }
  }
  let config = location(p, 'mcp', workspace, configPath);
  if (
    config &&
    p.mcpDialect === 'opencode' &&
    !configPath &&
    (await exists(config.replace(/\.json$/, '.jsonc')))
  )
    config = config.replace(/\.json$/, '.jsonc');
  if (config && (await exists(config))) {
    if (p.mcpDialect === 'continue') {
      for (const path of await walk(config))
        if (/\.ya?ml$/.test(path)) {
          const full = join(config, path),
            doc = parseDocument(await fs.readFile(full, 'utf8'));
          if (doc.errors.length)
            throw new EtymonError('INVALID_NATIVE_CONFIG', 'Invalid Continue YAML');
          for (const entry of doc.toJSON()?.mcpServers ?? []) {
            const { name, ...value } = entry;
            const imported = importMcp(value, p, diagnostics);
            resources.push({
              kind: 'mcp',
              name: validName(String(name)),
              definition: imported,
              origin: full,
            });
          }
        }
    } else {
      const doc = readDocument(
        (await readOptional(config))!,
        p.mcpDialect === 'codex' ? 'toml' : 'json',
      );
      const map =
        doc[p.map ?? 'mcpServers'] ??
        (p.id === 'copilot-cli' && Object.values(doc).every((v) => v && typeof v === 'object')
          ? doc
          : {});
      if (!map || typeof map !== 'object' || Array.isArray(map))
        throw new EtymonError('INVALID_NATIVE_MCP', `Invalid MCP map in ${config}`);
      for (const [name, value] of Object.entries(map)) {
        try {
          resources.push({
            kind: 'mcp',
            name: validName(name),
            definition: importMcp(value, p, diagnostics),
            origin: config + ':' + name,
          });
        } catch (e) {
          if (!(e instanceof EtymonError)) throw e;
          diagnostics.push({
            code: e.code,
            severity: 'error',
            message: e.message,
            resource: name,
            harness: p.id,
          });
        }
      }
      for (const key of ['hooks', 'plugins', 'extensions'])
        if (key in doc)
          diagnostics.push({
            code: 'OUTSIDE_MVP',
            severity: 'warning',
            message: `Detected ${key} in ${config}; retained in the native setup`,
            harness: p.id,
          });
    }
  }
  const root = workspace.global ? workspace.home : workspace.root;
  for (const candidate of ['.claude/settings.json', '.github/hooks', '.codex/hooks.json'])
    if (await exists(join(root, candidate)))
      diagnostics.push({
        code: 'OUTSIDE_MVP',
        severity: 'warning',
        message: `Detected ${candidate}; retained in native setup and excluded from this P0 import`,
        harness: p.id,
      });
  const rules = await importRules(p, workspace, rulesPath, importedRulePaths);
  resources.push(...rules.resources);
  diagnostics.push(...rules.diagnostics);
  const seen = new Map<string, Imported>();
  const unique: Imported[] = [];
  for (const resource of resources) {
    const id = resource.kind + ':' + resource.name;
    const prior = seen.get(id);
    if (prior) {
      const identity = (value: Imported) =>
        value.kind === 'skill'
          ? bundleIdentity(value.artifact)
          : value.kind === 'mcp'
            ? stable({
                connection: value.definition.connection,
                native: value.definition.native,
                ...(Object.keys(value.definition.native).length
                  ? { format: value.definition.format }
                  : {}),
              })
            : value.text;
      if (identity(prior) !== identity(resource))
        throw new EtymonError(
          'IMPORT_COLLISION',
          `Different imported definitions share ${id}: ${prior.origin} and ${resource.origin}`,
        );
      prior.origins = [
        ...new Set([
          ...(prior.origins ?? [prior.origin]),
          ...(resource.origins ?? [resource.origin]),
        ]),
      ];
      diagnostics.push({
        code: 'RESOURCE_DUPLICATE',
        severity: 'info',
        harness: p.id,
        message: `${resource.origin} duplicates ${prior.origin}; imported ${id} once`,
      });
      continue;
    }
    seen.set(id, resource);
    unique.push(resource);
  }
  return { resources: unique, diagnostics };
}
export function canonicalAgentText(agent: Agent): string {
  return `---\n${yaml({ name: agent.name, description: agent.description })}---\n\n${agent.prompt}\n`;
}
