import { promises as fs } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { digest, exists, fileArtifact, jsonArtifact, stable, textFile } from '../core/fs.js';
import { Artifact, Dependency, EtymonError, Kind, Request } from '../core/model.js';
import { Workspace } from '../core/workspace.js';
import { discoverAgents } from './agents.js';
import { McpRegistry, resolveServer, sanitizeRegistry, serverName } from './mcp.js';
import { stageRepositorySkills } from './skills.js';
import { parseSource, Source, withGit, withSource } from './source.js';
import { discoverRules } from './rules.js';
import { discoverCommands } from './commands.js';

export async function resolveDependency(
  kind: Kind,
  request: Request,
  workspace: Workspace,
): Promise<Dependency> {
  if (workspace.offline)
    throw new EtymonError(
      'OFFLINE_RESOLUTION',
      'Adding or updating an external dependency needs network access',
    );
  const id = `${kind}:external/${digest(stable({ kind, source: request.source, names: request.names, ref: request.ref, package: request.package, remote: request.remote, destDir: request.destDir, commandFormat: request.commandFormat })).slice(7, 23)}`;
  if (kind === 'mcp') {
    const registry = new McpRegistry(request.registry);
    const server = await registry.get(request.source, request.version);
    const connection = resolveServer(server, request);
    const name = serverName(server);
    const artifact = jsonArtifact({ connection, metadata: sanitizeRegistry(server) });
    return {
      id,
      kind,
      request,
      resolved: {
        provider: 'mcp-registry',
        registry: registry.base,
        version: server.version,
        metadata: sanitizeRegistry(server) as Record<string, unknown>,
      },
      artifacts: [{ name, digest: await workspace.cache.put(artifact), path: 'resource.json' }],
    };
  }
  const source = await parseSource(request.source, workspace.cwd, request.ref, workspace.home);
  if (source.type === 'local')
    throw new EtymonError('LOCAL_SOURCE', 'Local sources belong in the authored manifest');
  return withSource(source, workspace, async (root, commit) => {
    const artifacts = await sourceArtifacts(kind, root, request, workspace);
    return {
      id,
      kind,
      request,
      resolved: {
        provider: source.type === 'git' ? 'git' : 'url',
        ...(source.type === 'git'
          ? { repository: source.repository, commit, subpath: source.subpath }
          : {}),
        ...(kind === 'skill' && !request.commandFormat
          ? { skillsCli: (await workspace.lock()).toolchain.skills }
          : {}),
      },
      artifacts,
    };
  });
}
async function sourceArtifacts(
  kind: Kind,
  root: string,
  request: Request,
  workspace: Workspace,
  skillsVersion?: string,
): Promise<Dependency['artifacts']> {
  if (kind === 'skill') {
    const staged = request.commandFormat
      ? await discoverCommands(root, request.names, request.commandFormat, {
          repository: (await fs.stat(root)).isDirectory() && (await exists(join(root, '.git'))),
        })
      : await stageRepositorySkills(root, request.names, workspace, skillsVersion);
    return await Promise.all(
      staged.map(async (s) => ({
        name: s.name,
        digest: await workspace.cache.put(s.artifact),
        path: relative(root, s.path) || '.',
      })),
    );
  }
  if (kind === 'rule') {
    const rules = await discoverRules(root, request.names);
    return Promise.all(
      rules.map(async ({ path, rule }) => ({
        name: rule.name,
        digest: await workspace.cache.put(
          jsonArtifact({ ...rule, base: request.destDir ?? rule.base }),
        ),
        path: (await fs.stat(root)).isFile()
          ? basename(path)
          : relative(root, path).replaceAll('\\', '/'),
      })),
    );
  }
  const agents = await discoverAgents(root, request.names);
  const isFile = (await fs.stat(root)).isFile();
  return await Promise.all(
    agents.map(async ({ path, agent }) => ({
      name: agent.name,
      digest: await workspace.cache.put(
        fileArtifact(basename(path), await fs.readFile(path, 'utf8')),
      ),
      path: isFile ? basename(path) : relative(root, path).replaceAll('\\', '/'),
    })),
  );
}
export async function restoreDependency(
  dependency: Dependency,
  workspace: Workspace,
): Promise<Map<string, Artifact>> {
  const result = new Map<string, Artifact>();
  for (const artifact of dependency.artifacts) {
    const cached = await workspace.cache.get(artifact.digest);
    if (cached) result.set(artifact.name, cached);
  }
  if (result.size === dependency.artifacts.length) return result;
  if (workspace.offline)
    throw new EtymonError('OFFLINE_CACHE_MISS', `Missing cached artifact for ${dependency.id}`);
  if (dependency.resolved.provider === 'mcp-registry') {
    const server = await new McpRegistry(dependency.resolved.registry).get(
      dependency.request.source,
      dependency.resolved.version,
    );
    const artifact = jsonArtifact({
      connection: resolveServer(server, dependency.request),
      metadata: sanitizeRegistry(server),
    });
    const hash = await workspace.cache.put(artifact);
    if (hash !== dependency.artifacts[0].digest)
      throw new EtymonError(
        'INTEGRITY_MISMATCH',
        'Locked registry metadata changed; run update to review a new resolution',
      );
    result.set(dependency.artifacts[0].name, artifact);
  } else {
    const source: Source =
      dependency.resolved.provider === 'git'
        ? {
            type: 'git',
            repository: dependency.resolved.repository!,
            subpath: dependency.resolved.subpath,
          }
        : { type: 'url', url: dependency.request.source };
    const restore = async (root: string) => {
      const artifacts = await sourceArtifacts(
        dependency.kind,
        root,
        dependency.request,
        workspace,
        dependency.resolved.skillsCli,
      );
      for (const expected of dependency.artifacts) {
        const actual = artifacts.find((x) => x.name === expected.name);
        if (!actual || actual.digest !== expected.digest)
          throw new EtymonError('INTEGRITY_MISMATCH', `Restored bytes differ for ${expected.name}`);
        result.set(expected.name, (await workspace.cache.get(actual.digest))!);
      }
    };
    if (source.type === 'git')
      await withGit(source, workspace, restore, dependency.resolved.commit);
    else await withSource(source, workspace, restore);
  }
  return result;
}
export function mcpArtifact(artifact: Artifact): { connection: unknown; metadata: unknown } {
  return JSON.parse(textFile(artifact, 'resource.json'));
}
