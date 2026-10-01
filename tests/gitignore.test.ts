import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../src/core/workspace.js';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await fs.rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const directory = await fs.mkdtemp(join(tmpdir(), 'etymon-ignore-test-'));
  directories.push(directory);
  expect(spawnSync('git', ['init', '-q'], { cwd: directory }).status).toBe(0);
  const ws = new Workspace({ cwd: directory, home: join(directory, 'home') });
  const ignored = (path: string) =>
    spawnSync('git', ['check-ignore', '--no-index', '--quiet', '--', path], { cwd: directory })
      .status === 0;
  return { ws, directory, ignored };
}
it('ignores native outputs and keeps authoritative files and unrelated source trackable', async () => {
  const { ws, directory, ignored } = await fixture();
  await fs.writeFile(
    join(directory, '.gitignore'),
    '# Keep this comment\nnode_modules/\n.agents/**\n',
  );
  await ws.init();
  for (const path of [
    'AGENTS.md',
    'packages/api/AGENTS.md',
    'src/CLAUDE.md',
    '.agents/skills/checks/SKILL.md',
    '.agents/.etymon/state.json',
    '.codex/config.toml',
    '.codex/agents/reviewer.toml',
    '.claude/skills/checks/SKILL.md',
    '.github/agents/reviewer.agent.md',
    '.github/instructions/types.instructions.md',
    '.cursor/rules/types.mdc',
    '.gemini/settings.json',
    '.vscode/mcp.json',
    'opencode.jsonc',
    'kilo.json',
    '.continue/mcpServers/docs.yaml',
    '.roo/rules-review/checks.md',
    '.agents/etymon-output/amp/rules/types.md',
  ])
    expect(ignored(path), path).toBe(true);
  for (const path of [
    '.agents/etymon.toml',
    '.agents/etymon.lock',
    '.agents/etymon/rules/AGENTS.md',
    '.agents/etymon/skills/checks/SKILL.md',
    '.agents/etymon/skills/checks/assets/data.bin',
    '.github/workflows/ci.yml',
    'src/index.ts',
    '.gitignore',
  ])
    expect(ignored(path), path).toBe(false);
  expect(await fs.readFile(join(directory, '.gitignore'), 'utf8')).toContain('# Keep this comment');
  expect(await ws.manifest()).toMatchObject({ version: 1, mcp: {} });
  expect((await ws.lock()).dependencies).toEqual([]);
});
it('is idempotent and preserves later user entries while keeping authoritative exceptions last', async () => {
  const { ws, directory, ignored } = await fixture();
  await ws.init();
  const path = join(directory, '.gitignore');
  const first = await fs.readFile(path, 'utf8');
  await ws.init();
  expect(await fs.readFile(path, 'utf8')).toBe(first);
  await fs.appendFile(path, '\n# Later user settings\nlocal-data/\n.agents/**\n');
  await ws.init();
  expect(await fs.readFile(path, 'utf8')).toContain('# Later user settings\nlocal-data/');
  expect(ignored('local-data/private.txt')).toBe(true);
  expect(ignored('.agents/etymon/agents/reviewer.md')).toBe(false);
  const updated = await fs.readFile(path, 'utf8');
  await ws.init();
  expect(await fs.readFile(path, 'utf8')).toBe(updated);
});
it('does not write a gitignore for personal initialization', async () => {
  const { ws, directory } = await fixture();
  const personal = new Workspace({ cwd: directory, home: ws.home, global: true });
  await fs.writeFile(join(directory, '.gitignore'), 'project-only/\n');
  await personal.init();
  await expect(fs.access(join(ws.home, '.gitignore'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await fs.readFile(join(directory, '.gitignore'), 'utf8')).toBe('project-only/\n');
  expect(await personal.manifest()).toMatchObject({ version: 1 });
});
