import { join, relative } from 'node:path';
import { promises as fs } from 'node:fs';
import { Diagnostic, EtymonError } from '../core/model.js';
import { exists, inside } from '../core/fs.js';
import { Workspace } from '../core/workspace.js';
import {
  CommandSkill,
  readCommandConfig,
  readCommandFile,
  applyCommandOverrides,
} from '../providers/commands.js';
import { commandLocation, commandProfiles } from './command-profiles.js';
import { NativeDiscovery } from './native-discovery.js';
import type { Profile } from './profiles.js';
import type { Imported } from './import.js';

export async function importCommands(
  p: Profile,
  workspace: Workspace,
  discovery: NativeDiscovery,
): Promise<{ resources: Imported[]; diagnostics: Diagnostic[] }> {
  const resources: Imported[] = [],
    diagnostics: Diagnostic[] = [];
  const spec = commandProfiles[p.id];
  const commands: CommandSkill[] = [];
  if (!spec || (workspace.global && p.projectOnly)) return { resources, diagnostics };
  for (const source of workspace.global ? spec.global : spec.project) {
    const root = commandLocation(source, workspace, p.id);
    const roots = [root];
    if (source.tree && !workspace.global) {
      const marker = '/' + source.path + '/';
      for (const path of await discovery.tree(workspace.root)) {
        const index = path.indexOf(marker);
        if (index >= 0) roots.push(join(workspace.root, path.slice(0, index), source.path));
      }
    }
    for (const directory of new Set(roots)) {
      if (discovery.excluded(directory) || !(await exists(directory))) continue;
      if ((await fs.lstat(directory)).isSymbolicLink())
        throw new EtymonError('SOURCE_SYMLINK', `Command directory is a symlink: ${directory}`);
      if (!workspace.global) {
        const realRoot = await fs.realpath(workspace.root);
        inside(realRoot, relative(realRoot, await fs.realpath(directory)));
      }
      if (source.config)
        applyCommandOverrides(commands, await readCommandConfig(directory, source, commands));
      else
        for (const path of await commandFiles(
          directory,
          source.recursive !== false,
          discovery,
          diagnostics,
        )) {
          const command = await readCommandFile(path, source, directory, commands);
          if (command) {
            if (source.format === 'opencode') applyCommandOverrides(commands, [command]);
            else commands.push(command);
          }
        }
    }
  }
  for (const command of commands) {
    resources.push({
      kind: 'skill',
      name: command.name,
      artifact: command.artifact,
      origin: command.path,
      origins: command.origins,
    });
    diagnostics.push({
      code: 'COMMAND_MODERNIZED',
      severity: 'info',
      harness: p.id,
      resource: command.name,
      message: `${command.path} imports as skill ${command.name}; sync writes SKILL.md instead of legacy commands`,
    });
  }
  return { resources, diagnostics };
}

async function commandFiles(
  root: string,
  recursive: boolean,
  discovery: NativeDiscovery,
  diagnostics: Diagnostic[],
): Promise<string[]> {
  const result: string[] = [],
    pending = [{ path: root, depth: 0 }];
  let entries = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (current.depth > 128)
      throw new EtymonError('SOURCE_LIMIT', 'Command discovery exceeds 128 directory levels');
    for (const entry of (await fs.readdir(current.path, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(current.path, entry.name);
      if (discovery.excluded(path) || ['.git', 'node_modules', '.etymon'].includes(entry.name))
        continue;
      if (++entries > 5000)
        throw new EtymonError('SOURCE_LIMIT', 'Command discovery exceeds 5000 entries');
      if (entry.isSymbolicLink())
        diagnostics.push({
          code: 'COMMAND_SYMLINK_SKIPPED',
          severity: 'warning',
          message: `Skipped command alias ${path}; import its source explicitly to review it`,
        });
      else if (entry.isDirectory() && recursive) pending.push({ path, depth: current.depth + 1 });
      else if (entry.isFile()) result.push(path);
    }
  }
  return result;
}
