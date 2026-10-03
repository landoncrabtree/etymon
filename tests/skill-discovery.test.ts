import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Workspace, add } from '../src/index.js';
import { discoverSkills, stageRepositorySkills } from '../src/providers/skills.js';
import { textFile } from '../src/core/fs.js';

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await fs.rm(path, { recursive: true, force: true });
});
async function write(path: string, text: string) {
  await fs.mkdir(join(path, '..'), { recursive: true });
  await fs.writeFile(path, text);
}
const skill = '---\nname: checks\ndescription: Run checks\n---\nRun project tests.\n';
async function fixture() {
  const directory = await fs.mkdtemp(join(tmpdir(), 'etymon-skill-discovery-'));
  directories.push(directory);
  const source = join(directory, 'source'),
    outside = join(directory, 'outside');
  await write(join(source, 'skills/checks/SKILL.md'), skill);
  await write(join(outside, 'SKILL.md'), skill.replace('checks', 'private'));
  return {
    source,
    outside,
    ws: new Workspace({
      cwd: join(directory, 'project'),
      home: join(directory, 'home'),
      cache: join(directory, 'cache'),
      offline: true,
    }),
  };
}

it('ignores unrelated instruction, broken, cyclic and external aliases without reading them into skill bundles', async () => {
  const { source, outside } = await fixture();
  await write(join(source, 'AGENTS.md'), 'Repository contributor instructions.');
  await fs.symlink('AGENTS.md', join(source, 'CLAUDE.md'));
  await fs.symlink('missing', join(source, 'broken'));
  await fs.symlink('cycle', join(source, 'cycle'));
  await fs.symlink(join(outside, 'SKILL.md'), join(source, 'outside-file'));
  await fs.symlink(outside, join(source, 'outside-directory'));
  await write(join(source, 'skills/checks/scripts/check.sh'), '#!/bin/sh\nprintf checks');
  await fs.chmod(join(source, 'skills/checks/scripts/check.sh'), 0o755);
  const found = await discoverSkills(source);
  expect(found.map((item) => item.name)).toEqual(['checks']);
  expect(textFile(found[0].artifact, 'SKILL.md')).toBe(skill);
  expect(found[0].artifact.files.map((file) => file.path)).toEqual([
    'SKILL.md',
    'scripts/check.sh',
  ]);
  expect(found[0].artifact.files[1].executable).toBe(true);
});

it.each(['SKILL.md', 'assets/file', 'assets/directory'])(
  'rejects a linked %s inside a skill before registering any resources',
  async (path) => {
    const { source, outside, ws } = await fixture();
    const link = join(source, 'skills/checks', path);
    await fs.mkdir(join(link, '..'), { recursive: true });
    if (path === 'SKILL.md') await fs.rm(link);
    await fs.symlink(path === 'assets/directory' ? outside : join(outside, 'SKILL.md'), link);
    await expect(add(ws, 'skill', { source, names: [] })).rejects.toMatchObject({
      code: 'SOURCE_SYMLINK',
    });
    expect((await ws.manifest()).skill).toEqual({});
    expect((await ws.lock()).dependencies).toEqual([]);
  },
);

it.each(['.claude-plugin/marketplace.json', '.claude-plugin/plugin.json', 'skills-lock.json'])(
  'rejects linked discovery metadata %s before upstream staging',
  async (path) => {
    const { source, outside, ws } = await fixture();
    await write(join(outside, 'metadata.json'), '{}');
    await fs.mkdir(join(source, path, '..'), { recursive: true });
    await fs.symlink(join(outside, 'metadata.json'), join(source, path));
    await expect(stageRepositorySkills(source, [], ws)).rejects.toMatchObject({
      code: 'SYMLINK_CONFLICT',
    });
  },
);

it('only discovers exact SKILL.md definitions and rejects an explicitly selected source alias', async () => {
  const { source } = await fixture();
  await fs.rename(
    join(source, 'skills/checks/SKILL.md'),
    join(source, 'skills/checks/NOTSKILL.md'),
  );
  await expect(discoverSkills(source)).rejects.toMatchObject({ code: 'NO_SKILLS' });
  const alias = source + '-alias';
  await fs.symlink(source, alias);
  await expect(discoverSkills(alias)).rejects.toMatchObject({ code: 'SOURCE_SYMLINK' });
});
