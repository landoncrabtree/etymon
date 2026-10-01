import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parse, stringify } from 'smol-toml';
import { Cache, atomicWrite, exists, noSymlink, readOptional } from './fs.js';
import { projectGitignore } from '../harnesses/gitignore.js';
import {
  emptyLock,
  emptyManifest,
  EtymonError,
  json,
  Lock,
  lockSchema,
  Manifest,
  manifestSchema,
} from './model.js';

export type ContextOptions = {
  cwd?: string;
  global?: boolean;
  home?: string;
  cache?: string;
  debug?: boolean;
  offline?: boolean;
};
export class Workspace {
  cwd: string;
  root: string;
  home: string;
  agents: string;
  lockPath: string;
  manifestPath: string;
  statePath: string;
  runtime: string;
  cache: Cache;
  global: boolean;
  homeOverride: boolean;
  debug: boolean;
  offline: boolean;
  constructor(options: ContextOptions = {}) {
    this.cwd = resolve(options.cwd ?? process.cwd());
    this.homeOverride = options.home !== undefined;
    this.home = resolve(options.home ?? homedir());
    this.global = options.global ?? false;
    this.root = this.global ? this.home : this.cwd;
    this.agents = join(this.root, '.agents');
    this.lockPath = join(this.agents, 'etymon.lock');
    this.manifestPath = join(this.agents, 'etymon.toml');
    this.runtime = join(this.agents, '.etymon');
    this.statePath = join(this.runtime, 'state.json');
    this.cache = new Cache(
      resolve(
        options.cache ??
          process.env.ETYMON_CACHE_DIR ??
          join(this.home, '.cache', 'etymon', 'artifacts'),
      ),
    );
    this.debug = options.debug ?? false;
    this.offline = options.offline ?? false;
  }
  boundary(path: string): string {
    const rel = relative(this.root, path);
    return rel !== '..' && !rel.startsWith('..' + sep) ? this.root : dirname(path);
  }
  async lock(): Promise<Lock> {
    const text = await readOptional(this.lockPath);
    if (!text) return emptyLock();
    try {
      return lockSchema.parse(JSON.parse(text));
    } catch (e) {
      throw new EtymonError('INVALID_LOCK', `Invalid ${this.lockPath}: ${e}`);
    }
  }
  async manifest(): Promise<Manifest> {
    const text = await readOptional(this.manifestPath);
    if (!text) return emptyManifest();
    try {
      return manifestSchema.parse(parse(text));
    } catch (e) {
      throw new EtymonError('INVALID_MANIFEST', `Invalid ${this.manifestPath}: ${e}`);
    }
  }
  async saveLock(lock: Lock): Promise<void> {
    await noSymlink(this.lockPath, this.root);
    await atomicWrite(this.lockPath, json(lockSchema.parse(lock)));
  }
  async saveManifest(manifest: Manifest): Promise<void> {
    await noSymlink(this.manifestPath, this.root);
    await atomicWrite(this.manifestPath, stringify(manifestSchema.parse(manifest)));
  }
  async init(): Promise<void> {
    if (!(await exists(this.lockPath))) await this.saveLock(emptyLock());
    if (!(await exists(this.manifestPath))) await this.saveManifest(emptyManifest());
    if (!this.global) {
      const path = join(this.root, '.gitignore');
      await noSymlink(path, this.root);
      const text = (await readOptional(path)) ?? '';
      const next = projectGitignore(text, this);
      if (next !== text) await atomicWrite(path, next, 0o644);
    }
  }
  async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    await noSymlink(this.runtime, this.root);
    await fs.mkdir(this.runtime, { recursive: true });
    const guard = join(this.runtime, 'operation.lock');
    let handle;
    try {
      handle = await fs.open(guard, 'wx', 0o600);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST')
        throw new EtymonError(
          'WORKSPACE_BUSY',
          `Another etymon operation is running. If it crashed, remove ${guard} after verifying no operation is active.`,
        );
      throw e;
    }
    try {
      await handle.writeFile(json({ pid: process.pid, startedAt: new Date().toISOString() }));
      return await fn();
    } finally {
      await handle.close();
      await fs.rm(guard, { force: true });
    }
  }
}
