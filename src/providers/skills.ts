import { promises as fs } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { bundle, exists, inside, run, temporary, walk } from '../core/fs.js';
import { Artifact, Diagnostic, EtymonError, SKILLS_VERSION } from '../core/model.js';
import { Workspace } from '../core/workspace.js';
import { bundleIdentity } from '../core/dedup.js';
import { frontmatter } from './agents.js';

export function skillMetadata(artifact: Artifact): Record<string, unknown> {
  const file = artifact.files.find((f) => f.path === 'SKILL.md');
  if (!file) throw new EtymonError('INVALID_SKILL', 'Skill must contain SKILL.md');
  const { metadata } = frontmatter(Buffer.from(file.content, 'base64').toString('utf8'));
  const name = metadata.name;
  if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64)
    throw new EtymonError(
      'INVALID_SKILL',
      'Skill name must be 1–64 lowercase alphanumeric characters with single hyphens',
    );
  if (
    typeof metadata.description !== 'string' ||
    !metadata.description.trim() ||
    metadata.description.length > 1024
  )
    throw new EtymonError(
      'INVALID_SKILL',
      'Skill description is required and must be at most 1024 characters',
    );
  return metadata;
}
/** Native installers often link an alias directory to the shared skill bundle. */
export async function discoverNativeSkills(
  root: string,
  boundary: string,
  options: { diagnostics?: Diagnostic[]; excluded?: (path: string) => boolean } = {},
): Promise<{ path: string; origins: string[]; name: string; artifact: Artifact }[]> {
  const result: { path: string; origins: string[]; name: string; artifact: Artifact }[] = [],
    seen = new Set<string>();
  const realBoundary = await fs.realpath(boundary);
  async function visit(path: string, depth: number, aliases: string[] = []) {
    if (options.excluded?.(path)) return;
    if (!depth)
      throw new EtymonError('SOURCE_LIMIT', 'Skill discovery exceeds 16 directory levels');
    let real: string;
    try {
      real = await fs.realpath(path);
    } catch (error) {
      if (['ENOENT', 'ELOOP'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        options.diagnostics?.push({
          code: 'SKILL_SYMLINK_SKIPPED',
          severity: 'warning',
          message: `Skipped broken skill alias ${path}`,
        });
        return;
      }
      throw error;
    }
    inside(realBoundary, relative(realBoundary, real));
    if (options.excluded?.(join(boundary, relative(realBoundary, real)))) return;
    if ((await fs.lstat(path)).isSymbolicLink()) aliases = [...aliases, path];
    if (seen.has(real)) {
      const prior = result.find((skill) =>
        skill.origins.includes(join(boundary, relative(realBoundary, real))),
      );
      if (prior) prior.origins = [...new Set([...prior.origins, path, ...aliases])];
      return;
    }
    seen.add(real);
    if (await exists(join(real, 'SKILL.md'))) {
      const artifact = await bundle(real);
      result.push({
        path,
        origins: [...new Set([path, join(boundary, relative(realBoundary, real)), ...aliases])],
        name: String(skillMetadata(artifact).name),
        artifact,
      });
      return;
    }
    for (const entry of await fs.readdir(real, { withFileTypes: true })) {
      if (['.git', 'node_modules', '.etymon'].includes(entry.name)) continue;
      const child = join(path, entry.name);
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        if (entry.isSymbolicLink()) {
          try {
            if (!(await fs.stat(child)).isDirectory()) continue;
          } catch (error) {
            if (['ENOENT', 'ELOOP'].includes((error as NodeJS.ErrnoException).code ?? '')) {
              options.diagnostics?.push({
                code: 'SKILL_SYMLINK_SKIPPED',
                severity: 'warning',
                message: `Skipped broken skill alias ${child}`,
              });
              continue;
            }
            throw error;
          }
        }
        await visit(child, depth - 1, aliases);
      }
    }
  }
  await visit(root, 16);
  return result;
}
export async function discoverSkills(
  root: string,
  names: string[] = [],
  options: { keepVariants?: boolean } = {},
): Promise<{ path: string; name: string; artifact: Artifact }[]> {
  const isFile = (await fs.stat(root)).isFile();
  const directory = isFile ? dirname(root) : root;
  const paths = isFile
    ? [root]
    : (await walk(directory)).filter((p) => p.endsWith('SKILL.md')).map((p) => join(directory, p));
  const found = [];
  for (const path of paths) {
    const artifact = await bundle(dirname(path));
    const metadata = skillMetadata(artifact);
    const name = String(metadata.name);
    if (!names.length || names.includes('*') || names.includes(name))
      found.push({ path: dirname(path), name, artifact });
  }
  for (const name of names)
    if (name !== '*' && !found.some((f) => f.name === name))
      throw new EtymonError('SKILL_NOT_FOUND', `No skill named ${name} in source`);
  if (!found.length) throw new EtymonError('NO_SKILLS', 'No SKILL.md definitions found');
  if (options.keepVariants) return found;
  const unique = new Map<string, (typeof found)[number]>();
  for (const skill of found) {
    const prior = unique.get(skill.name);
    if (prior && bundleIdentity(prior.artifact) !== bundleIdentity(skill.artifact))
      throw new EtymonError(
        'SKILL_NAME_COLLISION',
        `Different skill bundles share ${skill.name}: ${prior.path} and ${skill.path}`,
      );
    if (!prior) unique.set(skill.name, skill);
  }
  return [...unique.values()];
}

/** Let the pinned upstream CLI select repository variants, then verify their origin. */
export async function stageRepositorySkills(
  root: string,
  names: string[],
  workspace: Workspace,
  version?: string,
): Promise<{ path: string; name: string; artifact: Artifact }[]> {
  // Bound and validate source before the upstream copier can follow any links.
  const candidates = await discoverSkills(root, names, { keepVariants: true });
  const staged = await stageWithSkills(root, names, workspace, version);
  return staged.map((skill) => {
    const paths = new Set(skill.artifact.files.map((file) => file.path));
    const identity = bundleIdentity(skill.artifact);
    const source = candidates.find(
      (candidate) =>
        candidate.name === skill.name &&
        bundleIdentity({
          version: 1,
          files: candidate.artifact.files.filter((file) => paths.has(file.path)),
        }) === identity,
    );
    // Upstream excludes documentation/build files; every installed byte and mode
    // must still match a validated source bundle from this immutable checkout.
    if (!source)
      throw new EtymonError(
        'SKILL_STAGING_MISMATCH',
        `Staged skill ${skill.name} does not match a source bundle`,
      );
    return { ...skill, path: source.path };
  });
}
export async function stageWithSkills(
  root: string,
  names: string[],
  workspace: Workspace,
  version = SKILLS_VERSION,
): Promise<{ name: string; artifact: Artifact }[]> {
  return temporary(async (stage) => {
    await run(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      [
        '--yes',
        `skills@${version}`,
        'add',
        root,
        '--agent',
        'universal',
        '--copy',
        '--yes',
        '--skill',
        ...(names.length ? names : ['*']),
      ],
      {
        cwd: stage,
        env: { DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1', CI: '1' },
        debug: workspace.debug,
      },
    );
    return await discoverSkills(join(stage, '.agents', 'skills'));
  });
}
