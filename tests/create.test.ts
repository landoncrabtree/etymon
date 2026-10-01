import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  create,
  creationSchema,
  creationValues,
  resources,
  sync,
  Workspace,
} from '../src/index.js';
import { readState } from '../src/core/transaction.js';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await fs.rm(directory, { recursive: true, force: true });
});
async function fixture(global = false) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'etymon-create-test-'));
  directories.push(directory);
  const root = join(directory, 'project');
  await fs.mkdir(root);
  return new Workspace({ cwd: root, home: join(directory, 'home'), global });
}

it('creates editable skill sources with metadata and includes subsequently authored assets in sync', async () => {
  const ws = await fixture();
  const result = await create(ws, {
    kind: 'skill',
    name: 'checks',
    description: 'Run project checks',
    body: '    npm test\n\nExplain failures.',
    license: 'MIT',
    compatibility: 'Node.js 22+',
  });
  expect(result.path).toBe(join(ws.agents, 'etymon/skills/checks/SKILL.md'));
  expect((await ws.manifest()).skill.checks.path).toBe('etymon/skills/checks');
  expect((await ws.lock()).dependencies).toEqual([]);
  expect((await readState(ws)).units.some((unit) => unit.path === result.path)).toBe(false);
  await fs.mkdir(join(result.path, '../assets'));
  await fs.writeFile(join(result.path, '../assets/data.bin'), Buffer.from([0, 255, 1]));
  await sync(ws, ['codex', 'copilot-cli']);
  expect(await fs.readFile(join(ws.root, '.agents/skills/checks/assets/data.bin'))).toEqual(
    Buffer.from([0, 255, 1]),
  );
  const original = await fs.readFile(result.path, 'utf8');
  await fs.writeFile(
    result.path,
    original.replace('Explain failures.', 'Explain and fix failures.'),
  );
  await sync(ws, ['codex', 'copilot-cli']);
  expect(await fs.readFile(join(ws.root, '.agents/skills/checks/SKILL.md'), 'utf8')).toContain(
    'Explain and fix failures.',
  );
  expect((await sync(ws, ['codex', 'copilot-cli'])).summary).toEqual([]);
});

it('creates universal agents and preserves multiline instructions across native formats', async () => {
  const ws = await fixture();
  const prompt = 'Find correctness bugs.\n\n    Keep code indentation.\n';
  const result = await create(ws, {
    kind: 'agent',
    name: 'reviewer',
    description: 'Review changes',
    body: prompt,
  });
  const source = JSON.parse(await fs.readFile(result.path, 'utf8'));
  expect(source).toMatchObject({ prompt, format: 'etymon', native: {} });
  expect((await ws.manifest()).agent.reviewer.path).toBe('etymon/agents/reviewer.json');
  await sync(ws, ['claude', 'codex', 'opencode', 'copilot-cli']);
  expect(await fs.readFile(join(ws.root, '.codex/agents/reviewer.toml'), 'utf8')).toContain(
    'Keep code indentation.',
  );
  expect(await fs.readFile(join(ws.root, '.github/agents/reviewer.agent.md'), 'utf8')).toContain(
    'Find correctness bugs.',
  );
  source.prompt = 'Updated by the author.';
  await fs.writeFile(result.path, JSON.stringify(source));
  await sync(ws, ['claude', 'codex', 'opencode', 'copilot-cli']);
  expect(await fs.readFile(join(ws.root, '.claude/agents/reviewer.md'), 'utf8')).toContain(
    source.prompt,
  );
  expect((await ws.lock()).dependencies).toEqual([]);
});

it.each([
  {
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
    env: { TOKEN: { env: 'MCP_TOKEN' } },
    cwd: '.',
  },
  {
    transport: 'streamable-http',
    url: 'https://example.com/mcp',
    headers: { Authorization: { env: 'MCP_AUTH' } },
  },
  { transport: 'sse', url: 'https://example.com/sse', headers: {} },
])(
  'stores custom $transport MCP connections inline without MCP source files',
  async (connection) => {
    const ws = await fixture();
    const result = await create(ws, { kind: 'mcp', name: 'docs', connection });
    expect(result.path).toBe(ws.manifestPath);
    expect((await ws.manifest()).mcp.docs).toMatchObject({
      connection,
      format: 'etymon',
      native: {},
    });
    expect((await resources(ws))[0]).toMatchObject({ kind: 'mcp', connection });
    await expect(fs.access(join(ws.agents, 'etymon/mcps'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const targets =
      connection.transport === 'streamable-http' ? ['claude'] : ['claude', 'copilot-cli'];
    await sync(ws, targets);
    expect((await sync(ws, targets)).summary).toEqual([]);
    expect((await ws.lock()).dependencies).toEqual([]);
  },
);

it('creates scoped rules, deduplicates equivalent rules, and rejects global project scope', async () => {
  const ws = await fixture();
  const draft = {
    kind: 'rule',
    name: 'api',
    body: 'Preserve API compatibility.',
    destDir: 'packages/api',
  };
  const original = await create(ws, draft);
  const duplicate = await create(ws, { ...draft, name: 'other-name' });
  expect(duplicate.ids).toEqual(original.ids);
  expect(Object.keys((await ws.manifest()).rule)).toEqual(['api']);
  await sync(ws, ['codex']);
  expect(await fs.readFile(join(ws.root, 'packages/api/AGENTS.md'), 'utf8')).toContain(draft.body);
  const personal = await fixture(true);
  await expect(create(personal, draft)).rejects.toMatchObject({
    code: 'GLOBAL_RULE_SCOPE_UNSUPPORTED',
  });
  await expect(fs.access(personal.manifestPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await create(personal, { ...draft, destDir: '.' });
  await sync(personal, ['claude']);
  expect(await fs.readFile(join(personal.home, '.claude/CLAUDE.md'), 'utf8')).toContain(draft.body);
});

it('rejects invalid creation before writing and never overwrites an authored destination', async () => {
  const ws = await fixture();
  const draft = { kind: 'skill', name: 'checks', description: 'Run checks', body: 'Run tests.' };
  for (const invalid of [
    { ...draft, name: '../outside' },
    { ...draft, name: 'invalid_name' },
    { ...draft, body: ' \n' },
    { ...draft, description: '' },
    { kind: 'rule', name: 'api', body: 'Test', destDir: '../private' },
    { kind: 'rule', name: 'api', body: 'Test', activation: 'glob' },
    { kind: 'mcp', name: 'docs', connection: { transport: 'stdio', command: '' } },
  ])
    await expect(create(ws, invalid)).rejects.toMatchObject({ code: 'INVALID_CREATION' });
  await expect(fs.access(ws.manifestPath)).rejects.toMatchObject({ code: 'ENOENT' });
  const path = join(ws.agents, 'etymon/skills/checks/SKILL.md');
  await fs.mkdir(join(path, '..'), { recursive: true });
  await fs.writeFile(path, 'Existing authored file.\n');
  await expect(create(ws, draft)).rejects.toMatchObject({ code: 'LOCAL_NAME_COLLISION' });
  expect(await fs.readFile(path, 'utf8')).toBe('Existing authored file.\n');
  await expect(fs.access(ws.manifestPath)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('rejects duplicate registered names without changing files or the manifest', async () => {
  const ws = await fixture();
  const draft = { kind: 'agent', name: 'reviewer', description: 'Review', body: 'Check code.' };
  const result = await create(ws, draft);
  const before = await fs.readFile(ws.manifestPath, 'utf8');
  await expect(create(ws, { ...draft, body: 'Overwrite' })).rejects.toMatchObject({
    code: 'LOCAL_NAME_COLLISION',
  });
  expect(await fs.readFile(ws.manifestPath, 'utf8')).toBe(before);
  expect(JSON.parse(await fs.readFile(result.path, 'utf8')).prompt).toBe(draft.body);
});

it('validates MCP input references and conditional rule forms before saving', () => {
  expect(creationValues(['TOKEN=env:MCP_TOKEN', 'DEBUG=true', 'QUERY=a=b'])).toEqual({
    TOKEN: { env: 'MCP_TOKEN' },
    DEBUG: 'true',
    QUERY: 'a=b',
  });
  expect(() => creationValues(['TOKEN=x', 'TOKEN=y'])).toThrow();
  expect(() => creationValues(['invalid'])).toThrow();
  expect(
    creationSchema.safeParse({ kind: 'rule', name: 'api', body: 'Test', activation: 'model' })
      .success,
  ).toBe(false);
  expect(
    creationSchema.safeParse({
      kind: 'mcp',
      name: 'docs',
      connection: { transport: 'stdio', command: 'node', env: { TOKEN: { env: '' } } },
    }).success,
  ).toBe(false);
});
