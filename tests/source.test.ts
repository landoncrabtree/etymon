import { afterEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Workspace } from '../src/core/workspace.js';
import { kinds } from '../src/core/model.js';
import { parseResourceSource } from '../src/providers/source.js';
import { add, resources } from '../src/services/environment.js';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const path of directories.splice(0)) await fs.rm(path, { recursive: true, force: true });
});
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'etymon-sources-'));
  directories.push(root);
  const cwd = join(root, 'project'),
    home = join(root, 'home');
  await fs.mkdir(cwd);
  await fs.mkdir(home);
  return new Workspace({ cwd, home, cache: join(root, 'cache'), offline: true });
}

it.each(kinds)(
  'chooses an existing bare path before remote interpretation for %s',
  async (kind) => {
    const ws = await fixture();
    const source = 'abc/abc/abc',
      path = join(ws.cwd, source);
    const body = '---\nname: checks\ndescription: Run checks\n---\nRun tests.\n';
    const file =
      kind === 'skill'
        ? join(path, 'SKILL.md')
        : kind === 'agent'
          ? join(path, 'reviewer.md')
          : kind === 'rule'
            ? join(path, 'AGENTS.md')
            : path;
    await fs.mkdir(dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      kind === 'mcp'
        ? JSON.stringify({ transport: 'stdio', command: 'node', args: [], env: {} })
        : kind === 'rule'
          ? 'Keep APIs stable.\n'
          : body,
    );
    const network = vi.spyOn(globalThis, 'fetch');
    expect(await parseResourceSource(kind, source, ws.cwd, undefined, ws.home)).toEqual({
      type: 'local',
      path,
    });
    await add(ws, kind, { source, names: [] });
    expect((await resources(ws)).filter((resource) => resource.kind === kind)).toHaveLength(1);
    expect((await ws.lock()).dependencies).toEqual([]);
    expect(network).not.toHaveBeenCalled();
  },
);

it.each(kinds)(
  'stops missing explicit local %s paths before initialization or network',
  async (kind) => {
    const ws = await fixture(),
      network = vi.spyOn(globalThis, 'fetch');
    for (const source of [
      './missing',
      '../missing',
      join(ws.cwd, 'missing'),
      '~/missing',
      pathToFileURL(join(ws.cwd, 'missing')).href,
    ]) {
      await expect(add(ws, kind, { source, names: [] })).rejects.toMatchObject({
        code: 'SOURCE_NOT_FOUND',
      });
    }
    await expect(fs.stat(ws.manifestPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(network).not.toHaveBeenCalled();
  },
);

it.each(kinds)('expands user-home %s paths using the workspace home', async (kind) => {
  const ws = await fixture(),
    path = join(ws.home, 'source');
  await fs.writeFile(path, 'source');
  expect(await parseResourceSource(kind, '~/source', ws.cwd, undefined, ws.home)).toEqual({
    type: 'local',
    path,
  });
  expect(
    await parseResourceSource(kind, pathToFileURL(path).href, ws.cwd, undefined, ws.home),
  ).toEqual({ type: 'local', path });
});

it.each(kinds)(
  'rejects invalid existing %s content without trying another source',
  async (kind) => {
    const ws = await fixture(),
      source = 'owner/repository/invalid',
      path = join(ws.cwd, source);
    await fs.mkdir(dirname(path), { recursive: true });
    if (kind === 'mcp') await fs.writeFile(path, '{broken json');
    else await fs.mkdir(path);
    const network = vi.spyOn(globalThis, 'fetch');
    const attempt = add(ws, kind, { source, names: [] });
    if (kind === 'mcp') await expect(attempt).rejects.toBeInstanceOf(SyntaxError);
    else
      await expect(attempt).rejects.toMatchObject({
        code: kind === 'skill' ? 'NO_SKILLS' : kind === 'agent' ? 'NO_AGENTS' : 'NO_RULES',
      });
    expect((await ws.lock()).dependencies).toEqual([]);
    expect(network).not.toHaveBeenCalled();
  },
);

it.each(['skill', 'agent', 'rule'] as const)(
  'uses Git shorthand only when the bare %s path is absent',
  async (kind) => {
    const ws = await fixture();
    expect(
      await parseResourceSource(kind, 'augmnt/agents/api-designer.md', ws.cwd, 'main'),
    ).toEqual({
      type: 'git',
      repository: 'https://github.com/augmnt/agents.git',
      ref: 'main',
      subpath: 'api-designer.md',
    });
  },
);

it('chooses an MCP registry ID only when its matching local path is absent', async () => {
  const ws = await fixture(),
    input = 'io.example/server';
  expect(await parseResourceSource('mcp', input, ws.cwd)).toEqual({ type: 'registry', id: input });
  await fs.mkdir(join(ws.cwd, 'io.example'));
  await fs.writeFile(join(ws.cwd, input), '{}');
  expect(await parseResourceSource('mcp', input, ws.cwd)).toEqual({
    type: 'local',
    path: join(ws.cwd, input),
  });
  await expect(parseResourceSource('mcp', 'https://example.com/mcp', ws.cwd)).rejects.toMatchObject(
    { code: 'INVALID_SOURCE' },
  );
});

it('keeps explicit remote URLs remote even if a URL-shaped local directory exists', async () => {
  const ws = await fixture(),
    input = 'https://github.com/owner/repo';
  await fs.mkdir(join(ws.cwd, input), { recursive: true });
  expect(await parseResourceSource('agent', input, ws.cwd)).toMatchObject({
    type: 'git',
    repository: input,
  });
});

it('does not turn a broken local symlink into a registry request', async () => {
  const ws = await fixture(),
    input = 'io.example/server',
    path = join(ws.cwd, input);
  await fs.mkdir(dirname(path));
  await fs.symlink(join(ws.cwd, 'absent'), path);
  const network = vi.spyOn(globalThis, 'fetch');
  expect(await parseResourceSource('mcp', input, ws.cwd)).toEqual({ type: 'local', path });
  await expect(add(ws, 'mcp', { source: input, names: [] })).rejects.toMatchObject({
    code: 'ENOENT',
  });
  expect(network).not.toHaveBeenCalled();
});
