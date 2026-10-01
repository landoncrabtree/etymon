import { relative } from 'node:path';
import type { Workspace } from '../core/workspace.js';
import { profiles } from './profiles.js';
import { readLocations } from './discovery.js';

const start = '# >>> etymon generated outputs';
const end = '# <<< etymon generated outputs';

/** Derive ignored build destinations from the same profiles used by sync. */
export function projectIgnorePatterns(workspace: Workspace): string[] {
  const patterns = new Set<string>(['/.agents/*']);
  const add = (path: string | undefined, directory = false, nested = false) => {
    if (!path) return;
    patterns.add(`${nested ? '/**/' : '/'}${path}${directory ? '/' : ''}`);
  };
  for (const profile of profiles) {
    for (const kind of ['skill', 'agent'] as const)
      for (const path of readLocations(profile, kind, workspace))
        add(relative(workspace.root, path).replaceAll('\\', '/'), true);
    const mcp = profile.mcp?.[0];
    add(mcp, profile.mcpDialect === 'continue');
    if (mcp?.endsWith('.json')) add(mcp.replace(/\.json$/, '.jsonc'));
    add(profile.rule?.file?.[0], false, profile.rule?.nested);
    add(profile.rule?.modular?.[0], true);
    for (const source of profile.rule?.project ?? [])
      add(source.path, source.directory, source.tree);
  }
  // Roo's mode-specific rule directories are generated separately.
  add('.roo/rules-*', true);
  return [
    ...[...patterns].sort(),
    '!/.agents/',
    '!/.agents/etymon.toml',
    '!/.agents/etymon.lock',
    '!/.agents/etymon/',
    '!/.agents/etymon/**',
  ];
}

export function projectGitignore(existing: string, workspace: Workspace): string {
  const unmanaged = existing
    .replace(
      /^# >>> etymon generated outputs\r?\n[\s\S]*?^# <<< etymon generated outputs(?:\r?\n|$)/gm,
      '',
    )
    .replace(/\n+$/, '');
  const block = [start, ...projectIgnorePatterns(workspace), end, ''].join('\n');
  return unmanaged ? unmanaged + '\n\n' + block : block;
}
