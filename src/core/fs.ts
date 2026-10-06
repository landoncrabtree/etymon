import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { Artifact, artifactSchema, ArtifactFile, EtymonError, json } from './model.js';

export function digest(data: string | Buffer): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}
export function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ':' + stable(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export async function exists(path: string): Promise<boolean> {
  try {
    await fs.lstat(path);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
}
export async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await fs.readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}
export function inside(root: string, path: string): string {
  if (path.includes('\0') || path.includes('\\'))
    throw new EtymonError('UNSAFE_PATH', `Unsafe path: ${path}`);
  const result = resolve(root, path),
    rel = relative(resolve(root), result);
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))
    throw new EtymonError('UNSAFE_PATH', `Path escapes its root: ${path}`);
  return result;
}
export function safeRelative(path: string): void {
  if (
    !path ||
    isAbsolute(path) ||
    path.split('/').some((x) => x === '..' || x === '.git') ||
    path.includes('\\') ||
    path.includes('\0')
  )
    throw new EtymonError('UNSAFE_PATH', `Unsafe artifact path: ${path}`);
}
export async function noSymlink(path: string, boundary: string): Promise<void> {
  const rel = relative(resolve(boundary), resolve(path));
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))
    throw new EtymonError('UNSAFE_PATH', `Path escapes its root: ${path}`);
  let current = resolve(path);
  while (true) {
    try {
      if ((await fs.lstat(current)).isSymbolicLink())
        throw new EtymonError('SYMLINK_CONFLICT', `Refusing to write through symlink: ${current}`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    if (current === resolve(boundary)) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
export async function atomicWrite(
  path: string,
  data: string | Buffer,
  mode?: number,
): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, data, { mode: mode ?? 0o600 });
    await fs.rename(temporary, path);
    if (mode !== undefined) await fs.chmod(path, mode);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
export async function temporary<T>(fn: (path: string) => Promise<T>): Promise<T> {
  const path = await fs.mkdtemp(join(tmpdir(), 'etymon-'));
  try {
    return await fn(path);
  } finally {
    await fs.rm(path, { recursive: true, force: true });
  }
}
export async function walk(root: string, depth = 16): Promise<string[]> {
  if (!depth) throw new EtymonError('SOURCE_LIMIT', 'Source exceeds the maximum directory depth');
  const result: string[] = [];
  for (const entry of (await fs.readdir(root, { withFileTypes: true })).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    if (['.git', 'node_modules', '.etymon'].includes(entry.name)) continue;
    if (entry.isSymbolicLink())
      throw new EtymonError(
        'SOURCE_SYMLINK',
        `Source contains a symlink: ${join(root, entry.name)}`,
      );
    if (entry.isDirectory())
      result.push(
        ...(await walk(join(root, entry.name), depth - 1)).map((p) => entry.name + '/' + p),
      );
    else if (entry.isFile()) result.push(entry.name);
    if (result.length > 5000) throw new EtymonError('SOURCE_LIMIT', 'Source exceeds 5000 files');
  }
  return result;
}
export async function bundle(root: string): Promise<Artifact> {
  const files: ArtifactFile[] = [];
  let bytes = 0;
  for (const path of await walk(root)) {
    const data = await fs.readFile(join(root, path));
    bytes += data.length;
    if (bytes > 25 * 1024 * 1024) throw new EtymonError('SOURCE_LIMIT', 'Artifact exceeds 25 MiB');
    files.push({
      path,
      content: data.toString('base64'),
      executable: Boolean((await fs.stat(join(root, path))).mode & 0o111),
    });
  }
  return { version: 1, files };
}
export async function unpack(artifact: Artifact, root: string): Promise<void> {
  for (const file of artifact.files) {
    safeRelative(file.path);
    await atomicWrite(
      inside(root, file.path),
      Buffer.from(file.content, 'base64'),
      file.executable ? 0o755 : 0o644,
    );
  }
}
export class Cache {
  constructor(public root: string) {}
  path(hash: string): string {
    if (!/^sha256:[a-f0-9]{64}$/.test(hash))
      throw new EtymonError('INVALID_DIGEST', 'Invalid cache digest');
    return join(this.root, hash.slice(7) + '.json');
  }
  async put(artifact: Artifact): Promise<string> {
    const bytes = stable(artifact);
    const hash = digest(bytes);
    await atomicWrite(this.path(hash), bytes);
    return hash;
  }
  async get(hash: string): Promise<Artifact | undefined> {
    const bytes = await readOptional(this.path(hash));
    if (bytes === undefined) return undefined;
    if (digest(bytes) !== hash)
      throw new EtymonError('INTEGRITY_MISMATCH', `Cached artifact is corrupt: ${hash}`);
    const artifact = artifactSchema.parse(JSON.parse(bytes));
    artifact.files.forEach((f) => safeRelative(f.path));
    return artifact;
  }
}
export async function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number; debug?: boolean } = {},
): Promise<string> {
  if (options.debug)
    process.stderr.write(`[etymon] ${command} ${args.map((a) => JSON.stringify(a)).join(' ')}\n`);
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '',
      limit = false;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1000).unref();
      reject(new EtymonError('PROCESS_TIMEOUT', `${command} exceeded its timeout`));
    }, options.timeout ?? 120000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 8e6) {
        limit = true;
        child.kill();
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-20000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new EtymonError('PROCESS_FAILED', `Cannot run ${command}: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (limit || code !== 0)
        reject(
          new EtymonError(
            'PROCESS_FAILED',
            `${command} failed (${code}): ${stderr.trim() || stdout.slice(-2000)}`,
          ),
        );
      else resolvePromise(stdout.trim());
    });
  });
}
export async function fetchText(url: string, maxBytes = 10 * 1024 * 1024): Promise<string> {
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password)
    throw new EtymonError('INVALID_URL', 'Use an HTTP(S) source without embedded credentials');
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30000),
    headers: { 'User-Agent': 'etymon/0.1', Accept: 'application/json, text/plain, */*' },
  });
  if (!response.ok)
    throw new EtymonError(
      'FETCH_FAILED',
      `HTTP ${response.status} from ${parsed.origin}${parsed.pathname}`,
    );
  const reader = response.body?.getReader();
  if (!reader) throw new EtymonError('FETCH_FAILED', 'Empty response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new EtymonError('SOURCE_LIMIT', 'Download exceeds the size limit');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
export function fileArtifact(path: string, text: string): Artifact {
  return {
    version: 1,
    files: [{ path, content: Buffer.from(text).toString('base64'), executable: false }],
  };
}
export function textFile(artifact: Artifact, path: string): string {
  const file = artifact.files.find((f) => f.path === path);
  if (!file) throw new EtymonError('MISSING_FILE', `Missing artifact file ${path}`);
  return Buffer.from(file.content, 'base64').toString('utf8');
}
export const jsonArtifact = (value: unknown): Artifact =>
  fileArtifact('resource.json', json(value));
