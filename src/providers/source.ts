import { promises as fs } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists, fetchText, inside, noSymlink, run, safeRelative, temporary } from '../core/fs.js';
import { EtymonError } from '../core/model.js';
import { Workspace } from '../core/workspace.js';

export type Source =
  | { type: 'local'; path: string }
  | { type: 'url'; url: string }
  | { type: 'git'; repository: string; ref?: string; subpath?: string };
export async function parseSource(input: string, cwd: string, ref?: string): Promise<Source> {
  if (!input || input.startsWith('-'))
    throw new EtymonError('INVALID_SOURCE', 'A non-option source is required');
  if (/^(?:git\+)?https?:\/\//.test(input)) {
    const url = new URL(input.replace(/^git\+/, ''));
    if (
      url.username ||
      url.password ||
      [...url.searchParams.keys()].some((key) =>
        /token|password|secret|credential|api.?key|signature/i.test(key),
      )
    )
      throw new EtymonError(
        'INVALID_SOURCE',
        'Use credential helpers or environment variables instead of credentials in source URLs',
      );
  }
  const local = input.startsWith('file://') ? fileURLToPath(input) : resolve(cwd, input);
  if (await exists(local)) return { type: 'local', path: local };
  if (/^(\.{1,2}\/|\/|~\/|[A-Za-z]:[\\/])/.test(input))
    throw new EtymonError('SOURCE_NOT_FOUND', `Local source does not exist: ${input}`);
  if (/^(git@|ssh:\/\/|git:\/\/|git\+(?:https?|file):\/\/)/.test(input)) {
    const [repo, fragment] = input.replace(/^git\+/, '').split('#');
    const [gitRef, subpath] = (fragment ?? '').split(':');
    if (subpath) safeRelative(subpath);
    return { type: 'git', repository: repo, ref: ref ?? (gitRef || undefined), subpath };
  }
  if (/^https?:\/\//.test(input)) {
    const url = new URL(input);
    if (url.username || url.password)
      throw new EtymonError(
        'INVALID_SOURCE',
        'Use Git credential helpers instead of credentials in source URLs',
      );
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (
      url.hostname === 'raw.githubusercontent.com' ||
      (/\.(md|toml|json|ya?ml)$/.test(url.pathname) &&
        !parts.includes('tree') &&
        !parts.includes('blob'))
    )
      return { type: 'url', url: input };
    const marker = parts.findIndex((p) => p === 'tree' || p === 'blob');
    if (marker >= 0) {
      const repoParts = parts.slice(0, marker);
      if (repoParts.at(-1) === '-') repoParts.pop();
      const subpath = parts.slice(marker + 2).join('/');
      if (subpath) safeRelative(subpath);
      return {
        type: 'git',
        repository: `${url.origin}/${repoParts.join('/')}.git`,
        ref: ref ?? parts[marker + 1],
        subpath: subpath || undefined,
      };
    }
    if (parts.includes('_git')) {
      const subpath = url.searchParams.get('path')?.replace(/^\//, '');
      if (subpath) safeRelative(subpath);
      const version = url.searchParams.get('version')?.replace(/^(GB|GC|GT)/, '');
      return {
        type: 'git',
        repository: `${url.origin}${url.pathname}`,
        ref: ref ?? version,
        subpath,
      };
    }
    if (url.hostname === 'github.com' && parts.length > 2) {
      const subpath = parts.slice(2).join('/');
      safeRelative(subpath);
      return {
        type: 'git',
        repository: `${url.origin}/${parts.slice(0, 2).join('/')}.git`,
        ref,
        subpath,
      };
    }
    const [gitRef, subpath] = url.hash.slice(1).split(':');
    if (subpath) safeRelative(subpath);
    url.hash = '';
    return {
      type: 'git',
      repository: url.href.replace(/\/$/, ''),
      ref: ref ?? (gitRef || undefined),
      subpath,
    };
  }
  const match = /^([^/\s]+)\/([^/\s]+)(?:\/(.+))?$/.exec(input);
  if (!match)
    throw new EtymonError(
      'INVALID_SOURCE',
      `Use owner/repo[/path], a Git URL, a direct file URL, or a local path: ${input}`,
    );
  const subpath = match[3];
  if (subpath) safeRelative(subpath);
  return {
    type: 'git',
    repository: `https://github.com/${match[1]}/${match[2].replace(/\.git$/, '')}.git`,
    ref,
    subpath,
  };
}
export async function withGit<T>(
  source: Extract<Source, { type: 'git' }>,
  workspace: Workspace,
  fn: (root: string, commit: string) => Promise<T>,
  commit?: string,
): Promise<T> {
  if (workspace.offline)
    throw new EtymonError(
      'OFFLINE_CACHE_MISS',
      'This artifact is not cached; retry without --offline',
    );
  return temporary(async (temp) => {
    const root = join(temp, 'repository');
    const env = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
    const opts = { env, debug: workspace.debug, timeout: 120000 };
    // No checkout during clone: do not activate source hooks or submodules.
    await run(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        'clone',
        '--no-checkout',
        '--depth',
        '1',
        '--',
        source.repository,
        root,
      ],
      opts,
    );
    const revision = commit ?? source.ref;
    if (revision) {
      if (revision.startsWith('-'))
        throw new EtymonError('INVALID_REF', 'A Git ref cannot begin with a dash');
      await run(
        'git',
        ['-c', 'core.hooksPath=/dev/null', '-C', root, 'fetch', '--depth', '1', 'origin', revision],
        opts,
      );
      await run(
        'git',
        ['-c', 'core.hooksPath=/dev/null', '-C', root, 'checkout', '--detach', 'FETCH_HEAD'],
        opts,
      );
    } else
      await run(
        'git',
        ['-c', 'core.hooksPath=/dev/null', '-C', root, 'checkout', '--detach'],
        opts,
      );
    const actual = await run('git', ['-C', root, 'rev-parse', 'HEAD'], opts);
    if (commit && actual !== commit)
      throw new EtymonError('INTEGRITY_MISMATCH', 'Git did not resolve to the locked commit');
    const selected = source.subpath ? inside(root, source.subpath) : root;
    await noSymlink(selected, root);
    if (!(await exists(selected)))
      throw new EtymonError(
        'SOURCE_NOT_FOUND',
        `No ${source.subpath} at ${actual}. Use --ref for branch names containing slashes.`,
      );
    return fn(selected, actual);
  });
}
export async function withSource<T>(
  source: Source,
  workspace: Workspace,
  fn: (root: string, commit?: string) => Promise<T>,
): Promise<T> {
  if (source.type === 'local') return fn(source.path);
  if (source.type === 'git') return withGit(source, workspace, fn);
  if (workspace.offline)
    throw new EtymonError('OFFLINE_CACHE_MISS', 'Cannot download a source in offline mode');
  return temporary(async (root) => {
    const path = join(root, basename(new URL(source.url).pathname) || 'agent.md');
    await fs.writeFile(path, await fetchText(source.url));
    return fn(path);
  });
}
