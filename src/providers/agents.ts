import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { parseDocument } from 'yaml';
import { agentSchema, Agent, EtymonError, validName } from '../core/model.js';
import { walk } from '../core/fs.js';

export function frontmatter(text: string): { metadata: Record<string, unknown>; body: string } {
  const match = /^\uFEFF?---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)([\s\S]*)$/.exec(text);
  if (!match) return { metadata: {}, body: text.trim() };
  const doc = parseDocument(match[1], { uniqueKeys: true });
  if (doc.errors.length)
    throw new EtymonError('INVALID_FRONTMATTER', doc.errors.map((e) => e.message).join('; '));
  const metadata = doc.toJSON();
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    throw new EtymonError('INVALID_FRONTMATTER', 'Expected a YAML metadata mapping');
  return { metadata, body: match[2].trim() };
}
export function detectFormat(metadata: Record<string, unknown>, path: string): string {
  if ('developer_instructions' in metadata) return 'codex';
  if (path.endsWith('.json') && 'prompt' in metadata) return 'kiro';
  if ('mode' in metadata || 'permission' in metadata || path.includes('.opencode/'))
    return 'opencode';
  if (path.includes('.kilo/')) return 'kilo';
  if ('kind' in metadata || 'max_turns' in metadata || path.includes('.gemini/')) return 'gemini';
  if ('handoffs' in metadata || path.endsWith('.agent.md') || path.includes('.github/agents'))
    return 'copilot';
  if (path.includes('.cursor/')) return 'cursor';
  if (path.includes('.omp/')) return 'omp';
  if (path.includes('.kiro/')) return 'kiro';
  if (path.includes('.agents/agents')) return 'antigravity';
  if ('tools' in metadata || 'permissionMode' in metadata || 'name' in metadata) return 'claude';
  return 'prompt';
}
export function parseAgent(text: string, path: string, format?: string): Agent {
  let metadata: Record<string, unknown>, body: string;
  if (path.endsWith('.toml')) {
    metadata = parseToml(text);
    body = String(metadata.developer_instructions ?? '');
  } else if (path.endsWith('.json')) {
    metadata = JSON.parse(text);
    if (metadata.format && metadata.prompt) return agentSchema.parse(metadata);
    body = String(metadata.prompt ?? metadata.systemPrompt ?? '');
    if (body.startsWith('file://'))
      throw new EtymonError(
        'UNRESOLVED_PROMPT',
        'Agent file references a separate prompt; inline it or register the Markdown agent',
      );
  } else {
    const parsed = frontmatter(text);
    metadata = parsed.metadata;
    body = parsed.body;
  }
  const tools = metadata.tools;
  const native = Object.fromEntries(
    Object.entries(metadata).filter(
      ([k]) =>
        !['name', 'description', 'developer_instructions', 'prompt', 'tools', 'model'].includes(k),
    ),
  );
  if (tools && typeof tools === 'object' && !Array.isArray(tools)) native.tools = tools;
  return agentSchema.parse({
    name: validName(String(metadata.name ?? basename(path))),
    description: String(
      metadata.description ??
        body
          .split('\n')
          .find((x) => x.trim())
          ?.replace(/^#+\s*/, '') ??
        'Custom agent',
    ),
    prompt: body,
    format: format ?? detectFormat(metadata, path),
    ...(Array.isArray(tools)
      ? { tools: tools.map(String) }
      : typeof tools === 'string'
        ? {
            tools: tools
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
          }
        : {}),
    ...(metadata.model ? { model: String(metadata.model) } : {}),
    native,
  });
}
export async function discoverAgents(
  root: string,
  names: string[] = [],
): Promise<{ path: string; agent: Agent }[]> {
  const isFile = (await fs.stat(root)).isFile();
  const paths = isFile
    ? [root]
    : (await walk(root))
        .filter(
          (p) =>
            /\.(md|toml|json)$/.test(p) &&
            !/(^|\/)(README|AGENTS|CLAUDE|GEMINI|SKILL|LICENSE|CHANGELOG|CONTRIBUTING)\b/i.test(p),
        )
        .map((p) => join(root, p));
  const found: { path: string; agent: Agent }[] = [];
  for (const path of paths) {
    const text = await fs.readFile(path, 'utf8');
    // Repo-wide discovery excludes ordinary documentation; explicit files may be plain prompts.
    if (
      !isFile &&
      !/^---\s*\r?\n/.test(text) &&
      !/developer_instructions\s*=/.test(text) &&
      !(path.endsWith('.json') && /"prompt"\s*:/.test(text))
    )
      continue;
    const agent = parseAgent(text, path);
    if (!names.length || names.includes('*') || names.includes(agent.name))
      found.push({ path, agent });
  }
  for (const name of names)
    if (name !== '*' && !found.some((x) => x.agent.name === name))
      throw new EtymonError('AGENT_NOT_FOUND', `No agent named ${name} in the source`);
  if (!found.length)
    throw new EtymonError(
      'NO_AGENTS',
      'No agent definitions found. Select a specific Markdown prompt file or a directory containing agent frontmatter.',
    );
  const seen = new Set<string>();
  for (const { agent } of found) {
    if (seen.has(agent.name))
      throw new EtymonError(
        'NAME_COLLISION',
        `Source contains multiple agents named ${agent.name}; select a narrower path`,
      );
    seen.add(agent.name);
  }
  return found;
}
