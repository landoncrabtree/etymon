import { promises as fs } from 'node:fs';
import { basename, join, matchesGlob, relative } from 'node:path';
import { Diagnostic, EtymonError } from '../core/model.js';
import { inside } from '../core/fs.js';
import { Workspace } from '../core/workspace.js';

export type ImportOptions = {
  exclude?: string[];
  onConflict?: 'error' | 'rename';
};

/** One bounded inventory per conversion, shared by native instruction readers. */
export class NativeDiscovery {
  private trees = new Map<string, Promise<string[]>>();
  private excludedPaths = new Set<string>();
  readonly diagnostics: Diagnostic[] = [];
  constructor(
    readonly workspace: Workspace,
    readonly options: ImportOptions = {},
  ) {
    for (const pattern of options.exclude ?? []) {
      if (
        !pattern ||
        pattern.startsWith('/') ||
        pattern.includes('\\') ||
        pattern.split('/').includes('..') ||
        /[\x00-\x1f]/.test(pattern)
      )
        throw new EtymonError(
          'INVALID_IMPORT_EXCLUDE',
          'Import exclusions must be project-relative globs',
        );
    }
    if (options.onConflict && !['error', 'rename'].includes(options.onConflict))
      throw new EtymonError('INVALID_OPTIONS', '--on-conflict must be error or rename');
  }
  excluded(path: string): boolean {
    const rel = relative(this.workspace.root, path).replaceAll('\\', '/');
    const excluded = (this.options.exclude ?? []).some((pattern) => {
      const glob = pattern.replace(/^\.\//, '').replace(/\/$/, '');
      const directoryGlob = glob.replace(/\/\*\*$/, '');
      const ancestors = rel
        .split('/')
        .map((_, index, parts) => parts.slice(0, index + 1).join('/'));
      return (
        matchesGlob(rel, glob) || ancestors.some((ancestor) => matchesGlob(ancestor, directoryGlob))
      );
    });
    if (excluded && !this.excludedPaths.has(path)) {
      this.excludedPaths.add(path);
      this.diagnostics.push({
        code: 'IMPORT_PATH_EXCLUDED',
        severity: 'info',
        message: `Excluded ${rel} from native import`,
      });
    }
    return excluded;
  }
  async instructionFile(path: string): Promise<string | undefined> {
    try {
      const real = await fs.realpath(path);
      const root = await fs.realpath(this.workspace.root);
      inside(root, relative(root, real));
      if (this.excluded(join(this.workspace.root, relative(root, real)))) return undefined;
      return (await fs.stat(real)).isFile() ? real : undefined;
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === 'ENOENT' ||
        (error as NodeJS.ErrnoException).code === 'ELOOP' ||
        (error instanceof EtymonError && error.code === 'UNSAFE_PATH')
      ) {
        this.diagnostics.push({
          code: 'RULE_SYMLINK_SKIPPED',
          severity: 'warning',
          message: `Skipped broken or out-of-scope instruction alias ${path}`,
        });
        return undefined;
      }
      throw error;
    }
  }
  tree(root: string): Promise<string[]> {
    let pending = this.trees.get(root);
    if (!pending) {
      pending = this.scan(root);
      this.trees.set(root, pending);
    }
    return pending;
  }
  private async scan(root: string): Promise<string[]> {
    const result: string[] = [],
      stack = [{ path: root, depth: 0 }];
    let count = 0;
    while (stack.length) {
      const { path, depth } = stack.pop()!;
      for (const item of (await fs.readdir(path, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (
          ['.git', 'node_modules', '.etymon', 'dist', 'build', 'vendor', '.cache'].includes(
            item.name,
          )
        )
          continue;
        const full = join(path, item.name),
          rel = relative(root, full).replaceAll('\\', '/');
        if (
          relative(this.workspace.root, full).replaceAll('\\', '/') === '.agents/etymon' ||
          relative(this.workspace.root, full).replaceAll('\\', '/') === '.agents/etymon-output' ||
          this.excluded(full)
        )
          continue;
        if (++count > 100000)
          throw new EtymonError(
            'SOURCE_LIMIT',
            'Native discovery exceeds 100000 entries; use --exclude to narrow import',
          );
        if (item.isSymbolicLink()) {
          if (
            /^(?:AGENTS(?:\.override)?|AGENT|CLAUDE(?:\.local)?|GEMINI)\.md$/.test(
              basename(full),
            ) &&
            (await this.instructionFile(full))
          )
            result.push(rel);
        } else if (item.isDirectory()) {
          if (depth >= 127)
            throw new EtymonError(
              'SOURCE_LIMIT',
              'Native discovery exceeds 128 directory levels; use --exclude to narrow import',
            );
          stack.push({ path: full, depth: depth + 1 });
        } else if (item.isFile()) result.push(rel);
      }
    }
    return result.sort();
  }
}
