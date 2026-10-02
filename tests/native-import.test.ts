import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace, convert, sync, resources } from '../src/index.js';
import { exists, readOptional } from '../src/core/fs.js';
import { NativeDiscovery } from '../src/harnesses/native-discovery.js';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await fs.rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const dir = await fs.mkdtemp(join(tmpdir(), 'etymon-native-import-'));
  directories.push(dir);
  const root = join(dir, 'project'),
    home = join(dir, 'home');
  await fs.mkdir(root);
  await fs.mkdir(home);
  return { dir, ws: new Workspace({ cwd: root, home, cache: join(dir, 'cache') }) };
}
async function write(path: string, text: string) {
  await fs.mkdir(join(path, '..'), { recursive: true });
  await fs.writeFile(path, text);
}
const skill = '---\nname: checks\ndescription: Run checks\n---\nRun tests.\n';

it('imports deep monorepo instructions without being stopped by unrelated directories', async () => {
  const { ws } = await fixture();
  const base = Array.from({ length: 24 }, (_, i) => 'level' + i).join('/');
  await write(join(ws.root, base, 'AGENTS.md'), 'Keep deep scope.');
  await write(join(ws.root, base, 'unrelated/deeper/file.ts'), 'export {};');
  await write(join(ws.root, 'AGENTS.md'), 'Root guidance.');
  await convert(ws);
  expect(
    Object.values((await ws.manifest()).rule)
      .map((entry) => entry.destDir)
      .sort(),
  ).toEqual(['.', base]);
  await fs.rm(join(ws.root, base, 'AGENTS.md'));
  await sync(ws, ['codex'], { adopt: true });
  expect(await readOptional(join(ws.root, base, 'AGENTS.md'))).toContain('Keep deep scope.');
  expect((await sync(ws, ['codex'])).summary).toHaveLength(0);
});
it('retains a hard discovery bound and allows an explicit exclusion to narrow it', async () => {
  const { ws } = await fixture();
  await fs.mkdir(join(ws.root, 'fixtures', ...Array(129).fill('nested')), { recursive: true });
  await write(join(ws.root, 'AGENTS.md'), 'Root guidance.');
  await expect(convert(ws)).rejects.toMatchObject({ code: 'SOURCE_LIMIT' });
  expect(await exists(ws.manifestPath)).toBe(false);
  const report = await convert(ws, undefined, { exclude: ['fixtures/**'] });
  expect(report.diagnostics.filter((d) => d.code === 'IMPORT_PATH_EXCLUDED')).toHaveLength(1);
  expect(Object.keys((await ws.manifest()).rule)).toHaveLength(1);
});
it('skips dangling and cyclic native skill aliases without dropping healthy bundles', async () => {
  const { ws } = await fixture();
  await write(join(ws.root, '.claude/skills/checks/SKILL.md'), skill);
  await fs.symlink('absent', join(ws.root, '.claude/skills/missing'));
  await fs.symlink('loop', join(ws.root, '.claude/skills/loop'));
  const report = await convert(ws, 'claude');
  expect(Object.keys((await ws.manifest()).skill)).toEqual(['checks']);
  expect(report.diagnostics.filter((d) => d.code === 'SKILL_SYMLINK_SKIPPED')).toHaveLength(2);
});
it('records a whole skill-directory alias and retains assets and executable modes', async () => {
  const { ws } = await fixture();
  await write(join(ws.root, '.agents/skills/checks/SKILL.md'), skill);
  await write(join(ws.root, '.agents/skills/checks/scripts/check.sh'), 'exit 0\n');
  await fs.chmod(join(ws.root, '.agents/skills/checks/scripts/check.sh'), 0o755);
  await fs.mkdir(join(ws.root, '.claude'));
  await fs.symlink('../.agents/skills', join(ws.root, '.claude/skills'));
  await convert(ws, 'claude');
  expect((await ws.manifest()).skill.checks.origins).toEqual(
    expect.arrayContaining([
      join(ws.root, '.claude/skills'),
      join(ws.root, '.claude/skills/checks'),
      join(ws.root, '.agents/skills/checks'),
    ]),
  );
  const environment = await resources(ws);
  expect(environment[0]).toMatchObject({
    kind: 'skill',
    files: expect.arrayContaining([
      expect.objectContaining({ path: 'scripts/check.sh', executable: true }),
    ]),
  });
});
it('keeps out-of-bound skill symlinks blocking and excludes resolved template aliases', async () => {
  const { ws, dir } = await fixture();
  await write(join(dir, 'outside/checks/SKILL.md'), skill);
  await fs.mkdir(join(ws.root, '.claude/skills'), { recursive: true });
  await fs.symlink(join(dir, 'outside/checks'), join(ws.root, '.claude/skills/checks'));
  await expect(convert(ws, 'claude')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
  expect(await exists(ws.manifestPath)).toBe(false);
  await fs.rm(join(ws.root, '.claude/skills/checks'));
  await write(join(ws.root, 'templates/checks/SKILL.md'), skill);
  await fs.symlink('../../templates/checks', join(ws.root, '.claude/skills/checks'));
  await convert(ws, 'claude', { exclude: ['templates/**'] });
  expect(Object.keys((await ws.manifest()).skill)).toEqual([]);
});
it('merges symlink and include bridges into scoped provenance across repeated conversions', async () => {
  const { ws } = await fixture();
  await write(join(ws.root, 'AGENTS.md'), 'Root instructions.');
  await fs.symlink('AGENTS.md', join(ws.root, 'CLAUDE.md'));
  await write(join(ws.root, 'apps/web/AGENTS.md'), 'Web instructions.');
  await write(join(ws.root, 'apps/web/CLAUDE.md'), '@AGENTS.md\n');
  await convert(ws, 'codex');
  await convert(ws);
  const manifest = await ws.manifest();
  expect(Object.keys(manifest.rule)).toHaveLength(2);
  for (const registration of Object.values(manifest.rule))
    expect(registration.origins).toHaveLength(2);
  const text = await readOptional(ws.manifestPath);
  await convert(ws, 'claude');
  await convert(ws);
  expect(await readOptional(ws.manifestPath)).toBe(text);
});
it('recognizes an instructions-only prose bridge and preserves additional guidance', async () => {
  const { ws } = await fixture();
  await write(join(ws.root, 'AGENTS.md'), 'Shared instructions.');
  await write(
    join(ws.root, 'CLAUDE.md'),
    'All working instructions live in @AGENTS.md - follow it.\n',
  );
  await convert(ws);
  expect(Object.keys((await ws.manifest()).rule)).toHaveLength(1);
  expect((await ws.manifest()).rule.instructions.origins).toHaveLength(2);
  await write(
    join(ws.root, 'apps/web/CLAUDE.md'),
    'All working instructions live in @AGENTS.md - follow it.\nAlso preserve web behavior.',
  );
  await write(join(ws.root, 'apps/web/AGENTS.md'), 'Web guidance.');
  const preview = await convert(ws, 'claude', { dryRun: true });
  expect(preview.resources.some((r) => r.origin.endsWith('apps/web/CLAUDE.md'))).toBe(true);
});
it('excludes templates before parsing while preserving real nested scope', async () => {
  const { ws } = await fixture();
  await write(join(ws.root, 'AGENTS.md'), 'Root.');
  await write(
    join(ws.root, 'templates/.cursor/rules/bad.mdc'),
    '---\ninvalid: [\n---\nNot project guidance.',
  );
  await write(join(ws.root, 'templates/AGENTS.md'), 'Product template.');
  await write(join(ws.root, 'packages/api/AGENTS.md'), 'Real API guidance.');
  const report = await convert(ws, undefined, { exclude: ['templates/**'] });
  expect(report.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  expect(
    Object.values((await ws.manifest()).rule)
      .map((r) => r.destDir)
      .sort(),
  ).toEqual(['.', 'packages/api']);
});
it('excludes explicit native resource locations and validates exclusion and collision policies', async () => {
  const { ws } = await fixture();
  await write(join(ws.root, '.claude/skills/checks/SKILL.md'), skill);
  await write(
    join(ws.root, '.claude/agents/reviewer.md'),
    '---\ndescription: Review\n---\nReview code.',
  );
  await write(join(ws.root, '.mcp.json'), '{ invalid JSON');
  const report = await convert(ws, 'claude', { exclude: ['.claude/**', '.mcp.json'] });
  expect(report.resources).toEqual([]);
  expect(report.diagnostics.some((d) => d.code === 'IMPORT_PATH_EXCLUDED')).toBe(true);
  await write(join(ws.root, 'opencode.json'), '{ invalid JSON');
  expect(
    (await convert(ws, 'opencode', { exclude: ['opencode.json', '.claude/**'] })).resources,
  ).toEqual([]);
  expect(() => new NativeDiscovery(ws, { exclude: ['../outside'] })).toThrow();
  await expect(convert(ws, undefined, { onConflict: 'ignore' as 'error' })).rejects.toMatchObject({
    code: 'INVALID_OPTIONS',
  });
});
it('preserves conflicting MCP definitions under explicit stable names without merging cwd', async () => {
  const { ws } = await fixture();
  await write(
    join(ws.root, '.mcp.json'),
    JSON.stringify({ mcpServers: { fixture: { command: 'node', args: ['server.js'] } } }),
  );
  await write(
    join(ws.root, '.codex/config.toml'),
    '[mcp_servers.fixture]\ncommand = "node"\nargs = ["server.js"]\ncwd = "/old/checkout"\n',
  );
  await expect(convert(ws)).rejects.toMatchObject({ code: 'IMPORT_COLLISION' });
  expect(await exists(ws.manifestPath)).toBe(false);
  const report = await convert(ws, undefined, { onConflict: 'rename' });
  expect(report.diagnostics.some((d) => d.code === 'IMPORT_RESOURCE_RENAMED')).toBe(true);
  const manifest = await ws.manifest();
  expect(Object.keys(manifest.mcp)).toHaveLength(2);
  const renamed = Object.keys(manifest.mcp).find((key) => key !== 'fixture')!;
  expect(manifest.mcp[renamed].connection).toMatchObject({ cwd: '/old/checkout' });
  expect(manifest.mcp.fixture.connection).not.toHaveProperty('cwd');
  const text = await readOptional(ws.manifestPath);
  await convert(ws, 'codex', { onConflict: 'rename' });
  await convert(ws, undefined, { onConflict: 'rename' });
  expect(await readOptional(ws.manifestPath)).toBe(text);
  expect((await ws.lock()).dependencies).toEqual([]);
});
