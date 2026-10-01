import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { run } from '../src/core/fs.js';
import { VERSION } from '../src/core/model.js';
const directories: string[] = [];
afterEach(async () => {
  for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});
const cli = resolve('src/cli.ts');
it('runs scriptable commands, accepts options after subcommands, and keeps the TUI opt-in without a terminal', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'etymon-cli-test-'));
  directories.push(root);
  const invoke = (args: string[]) => run(process.execPath, ['--import', 'tsx', cli, ...args]);
  expect(await invoke(['--version'])).toBe(VERSION);
  const initialized = JSON.parse(await invoke(['init', '--cwd', root, '--json']));
  expect(initialized.lock).toBe(join(root, '.agents/etymon.lock'));
  const harnesses = JSON.parse(await invoke(['harnesses', '--json']));
  expect(harnesses).toHaveLength(19);
  const doctor = JSON.parse(await invoke(['doctor', '--cwd', root, '--json']));
  expect(doctor.ok).toBe(true);
  const empty = await invoke([]);
  expect(empty).toContain('Usage: etymon');
  await expect(invoke(['tui', '--cwd', root])).rejects.toThrow(/TTY_REQUIRED/);
}, 30000);
it.each(['skills', 'agents', 'rules'])(
  'accepts the documented %s commands',
  async (plural) => {
    const root = await fs.mkdtemp(join(tmpdir(), 'etymon-cli-alias-'));
    directories.push(root);
    const source = plural === 'skills' ? 'fixture/SKILL.md' : 'fixture.md';
    await fs.mkdir(join(root, 'fixture'), { recursive: true });
    await fs.writeFile(
      join(root, source),
      plural === 'rules'
        ? 'Keep public interfaces stable.\n'
        : '---\nname: fixture\ndescription: Fixture guidance\n---\nKeep public interfaces stable.\n',
    );
    const invoke = async (args: string[]) =>
      JSON.parse(
        await run(process.execPath, [
          '--import',
          'tsx',
          cli,
          '--cwd',
          root,
          '--home',
          root,
          '--json',
          '--yes',
          ...args,
        ]),
      );
    const added = await invoke([plural, 'add', plural === 'skills' ? './fixture' : './fixture.md']);
    expect(added.names).toEqual(['fixture']);
    expect((await invoke([plural, 'list'])).resolved).toHaveLength(1);
    await invoke([plural, 'remove', 'fixture']);
    expect((await invoke([plural, 'list'])).resolved).toHaveLength(0);
  },
  30000,
);
