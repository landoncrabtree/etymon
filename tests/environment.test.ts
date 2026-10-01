import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, Server as HttpServer } from 'node:http';
import {
  Workspace,
  add,
  sync,
  convert,
  remove,
  doctor,
  update,
  profiles,
  renderMcp,
  renderAgent,
  parseAgent,
  parseSource,
  recover,
  resources,
} from '../src/index.js';
import { emptyManifest, EtymonError, json, manifestSchema } from '../src/core/model.js';
import { exists, readOptional, run } from '../src/core/fs.js';
import { readDocument, editDocument } from '../src/core/documents.js';
import { importMcp } from '../src/harnesses/import.js';
import { planUnits, apply } from '../src/core/transaction.js';
import { launcher } from '../src/harnesses/render.js';
import { resolveServer } from '../src/providers/mcp.js';

const directories: string[] = [];
afterEach(async () => {
  for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const dir = await fs.mkdtemp(join(tmpdir(), 'etymon-test-'));
  directories.push(dir);
  const root = join(dir, 'project'),
    home = join(dir, 'home');
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(home, { recursive: true });
  return { dir, root, home, ws: new Workspace({ cwd: root, home, cache: join(dir, 'cache') }) };
}
async function write(path: string, text: string | Buffer) {
  await fs.mkdir(join(path, '..'), { recursive: true });
  await fs.writeFile(path, text);
}
async function localEnvironment(ws: Workspace) {
  await write(
    join(ws.root, 'source', 'reviewer.md'),
    '---\nname: reviewer\ndescription: Review code\n---\n\nFind correctness problems.\n',
  );
  await write(
    join(ws.root, 'source', 'skill', 'SKILL.md'),
    '---\nname: checks\ndescription: Run project checks\n---\nRun tests.\n',
  );
  await write(
    join(ws.root, 'source', 'skill', 'assets', 'data.bin'),
    Buffer.from([0, 1, 255, 128]),
  );
  await write(
    join(ws.root, 'source', 'service.json'),
    json({
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { TOKEN: { env: 'EXAMPLE_TOKEN' } },
    }),
  );
  for (const [kind, source] of [
    ['agent', './source/reviewer.md'],
    ['skill', './source/skill'],
    ['mcp', './source/service.json'],
  ] as const)
    await add(ws, kind, { source, names: [] });
}
describe('native environment lifecycle', () => {
  it('syncs full skill assets, native agents and MCP while preserving config, and is idempotent', async () => {
    const { ws } = await fixture();
    await localEnvironment(ws);
    await write(
      join(ws.root, '.codex/config.toml'),
      '# User comment\nmodel = "my-model"\n\n[mcp_servers.personal]\ncommand = "personal-command"\n',
    );
    await write(
      join(ws.root, 'opencode.jsonc'),
      '{\n // User comment\n "theme": "my-theme",\n "mcp": {"personal": {"type":"local","command":["echo","ok"]}}\n}\n',
    );
    const plan = await sync(ws, ['claude', 'codex', 'opencode', 'copilot-cli']);
    expect(plan.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(await fs.readFile(join(ws.root, '.claude/skills/checks/assets/data.bin'))).toEqual(
      Buffer.from([0, 1, 255, 128]),
    );
    const codex = await fs.readFile(join(ws.root, '.codex/config.toml'), 'utf8');
    expect(codex).toContain('# User comment');
    expect(readDocument(codex, 'toml').model).toBe('my-model');
    const open = await fs.readFile(join(ws.root, 'opencode.jsonc'), 'utf8');
    expect(open).toContain('// User comment');
    expect(readDocument(open, 'json').theme).toBe('my-theme');
    expect(await exists(join(ws.root, 'opencode.json'))).toBe(false);
    expect(
      readDocument(await fs.readFile(join(ws.root, '.codex/agents/reviewer.toml'), 'utf8'), 'toml')
        .developer_instructions,
    ).toBe('Find correctness problems.');
    const second = await sync(ws, ['claude', 'codex', 'opencode', 'copilot-cli']);
    expect(second.summary).toEqual([]);
  });
  it('rejects unmanaged files and managed edits; explicit adoption records ownership', async () => {
    const { ws } = await fixture();
    await localEnvironment(ws);
    await write(join(ws.root, '.claude/agents/reviewer.md'), 'User authored agent\n');
    await expect(sync(ws, ['claude'])).rejects.toMatchObject({ code: 'UNMANAGED_CONFLICT' });
    await sync(ws, ['claude'], { adopt: true });
    await write(join(ws.root, '.claude/agents/reviewer.md'), 'Edited generated agent\n');
    await expect(sync(ws, ['claude'])).rejects.toMatchObject({ code: 'MANAGED_DRIFT' });
    expect((await doctor(ws, ['claude'])).ok).toBe(false);
    await sync(ws, ['claude'], { force: true });
  });
  it('dry-run does not activate anything or create ownership state', async () => {
    const { ws } = await fixture();
    await localEnvironment(ws);
    const result = await sync(ws, ['claude'], { dryRun: true });
    expect(result.summary.length).toBeGreaterThan(0);
    expect(await exists(join(ws.root, '.claude'))).toBe(false);
    expect(await exists(ws.statePath)).toBe(false);
  });
  it('conversion leaves originals unchanged, externalizes credentials, and imports editable sources', async () => {
    const { ws } = await fixture();
    const agent = '---\nname: audit\ndescription: Audit changes\n---\nLook for bugs.\n';
    await write(join(ws.root, '.claude/agents/audit.md'), agent);
    const config = json({
      mcpServers: {
        remote: {
          type: 'http',
          url: 'https://example.com/mcp',
          headers: { Authorization: 'fixture-token' },
        },
      },
      sessionState: { credential: 'outside-import' },
    });
    await write(join(ws.root, '.mcp.json'), config);
    const preview = await convert(ws, 'claude', { dryRun: true });
    expect(preview.resources).toHaveLength(2);
    expect(preview.resources.find((r) => r.kind === 'mcp')?.destination).toBe(ws.manifestPath);
    expect(await exists(ws.manifestPath)).toBe(false);
    await convert(ws, 'claude');
    expect(await readOptional(join(ws.root, '.mcp.json'))).toBe(config);
    expect(await readOptional(join(ws.root, '.claude/agents/audit.md'))).toBe(agent);
    const imported = await readOptional(ws.manifestPath);
    expect(imported).not.toContain('fixture-token');
    expect(imported).not.toContain('outside-import');
    expect((await ws.manifest()).mcp.remote).toMatchObject({
      connection: {
        transport: 'streamable-http',
        headers: { Authorization: { env: 'AUTHORIZATION' } },
      },
    });
    expect((await ws.manifest()).mcp.remote).not.toHaveProperty('path');
    expect(await exists(join(ws.agents, 'etymon/mcps'))).toBe(false);
    await sync(ws, ['codex']);
    const output = await readOptional(join(ws.root, '.codex/config.toml'));
    expect(output).toContain('env_http_headers');
    expect(output).not.toContain('fixture-token');
    const authored = join(ws.agents, 'etymon/agents/audit.json');
    const editable = JSON.parse((await readOptional(authored))!);
    editable.prompt = 'Updated by author';
    await fs.writeFile(authored, json(editable));
    const lockBefore = await readOptional(ws.lockPath);
    await sync(ws, ['codex']);
    expect(await readOptional(ws.lockPath)).toBe(lockBefore);
    expect(await readOptional(join(ws.root, '.codex/agents/audit.toml'))).toContain(
      'Updated by author',
    );
    await expect(convert(ws, 'claude')).rejects.toMatchObject({ code: 'IMPORT_CONFLICT' });
  });
  it('embeds local MCP definitions and preserves native fields without depending on the input file', async () => {
    const { ws } = await fixture();
    const source = join(ws.root, 'service.json');
    await write(
      source,
      json({
        connection: {
          transport: 'stdio',
          command: 'node',
          args: ['server.js'],
          env: { TOKEN: { env: 'SERVICE_TOKEN' } },
        },
        native: { timeout: 5000 },
        format: 'claude',
      }),
    );
    await add(ws, 'mcp', { source: './service.json', names: [] });
    await add(ws, 'mcp', { source: './service.json', names: [] });
    expect((await ws.manifest()).mcp.service).not.toHaveProperty('path');
    await fs.rm(source);
    const resource = (await resources(ws))[0];
    expect(resource).toMatchObject({ kind: 'mcp', native: { timeout: 5000 }, format: 'claude' });
    await sync(ws, ['claude']);
    const native = JSON.parse((await readOptional(join(ws.root, '.mcp.json')))!);
    expect(native.mcpServers.service.timeout).toBe(5000);
    expect(await exists(join(ws.agents, 'etymon/mcps'))).toBe(false);
  });
  it('reimports inline MCPs idempotently and protects authored edits', async () => {
    const { ws } = await fixture();
    const original = json({
      mcpServers: { local: { command: 'node', args: ['server.js'], timeout: 5000 } },
    });
    await write(join(ws.root, '.mcp.json'), original);
    await convert(ws, 'claude');
    const before = await readOptional(ws.manifestPath);
    await convert(ws, 'claude');
    expect(await readOptional(ws.manifestPath)).toBe(before);
    const manifest = await ws.manifest();
    expect((await resources(ws))[0]).toMatchObject({ kind: 'mcp', native: { timeout: 5000 } });
    expect(manifest.mcp.local.native).toEqual({ timeout: 5000 });
    manifest.mcp.local.connection = {
      transport: 'stdio',
      command: 'my-custom-command',
      args: [],
      env: {},
    };
    await ws.saveManifest(manifest);
    const edited = await readOptional(ws.manifestPath);
    await expect(convert(ws, 'claude')).rejects.toMatchObject({ code: 'IMPORT_CONFLICT' });
    expect(await readOptional(ws.manifestPath)).toBe(edited);
    expect(await readOptional(join(ws.root, '.mcp.json'))).toBe(original);
  });
  it('requires inline MCP connections and rejects file-backed entries in the manifest', async () => {
    const { ws } = await fixture();
    const connection = { transport: 'streamable-http', url: 'https://example.com/mcp' };
    expect(() =>
      manifestSchema.parse({
        ...emptyManifest(),
        mcp: { docs: { path: '../docs.json', connection } },
      }),
    ).toThrow();
    expect(() => manifestSchema.parse({ ...emptyManifest(), mcp: { docs: {} } })).toThrow();
    await write(
      ws.manifestPath,
      'version = 1\n\n[mcp.docs]\npath = "../docs.json"\n\n[mcp.docs.connection]\ntransport = "streamable-http"\nurl = "https://example.com/mcp"\n',
    );
    await expect(resources(ws)).rejects.toMatchObject({ code: 'INVALID_MANIFEST' });
    expect(await exists(join(ws.root, '.codex'))).toBe(false);
  });
  it('removes only unchanged managed units and preserves unrelated config/source', async () => {
    const { ws } = await fixture();
    await localEnvironment(ws);
    await write(
      join(ws.root, '.mcp.json'),
      json({ mcpServers: { personal: { command: 'my-command' } } }),
    );
    await sync(ws, ['claude']);
    await remove(ws, 'mcp', 'service');
    const config = JSON.parse((await readOptional(join(ws.root, '.mcp.json')))!);
    expect(config.mcpServers.personal.command).toBe('my-command');
    expect(config.mcpServers.service).toBeUndefined();
    expect(await exists(join(ws.root, 'source/service.json'))).toBe(true);
    await write(join(ws.root, '.claude/agents/reviewer.md'), 'User edits');
    await expect(remove(ws, 'agent', 'reviewer')).rejects.toMatchObject({ code: 'PLAN_BLOCKED' });
    expect((await ws.manifest()).agent.reviewer).toBeDefined();
  });
  it('blocks unsupported capabilities and required restrictions without partial output', async () => {
    const { ws } = await fixture();
    await localEnvironment(ws);
    const plan = await sync(ws, ['amp'], { dryRun: true });
    expect(plan.diagnostics.some((d) => d.code === 'CAPABILITY_UNSUPPORTED')).toBe(true);
    expect(plan.summary).toEqual([]);
    const agent = parseAgent(
      '---\nname: limited\ndescription: Limited agent\ntools: Read\n---\nRead only.',
      'limited.md',
    );
    expect(() =>
      renderAgent(
        agent,
        profiles.find((p) => p.id === 'codex')!,
      ),
    ).toThrow(/allowlist/);
    const lossy = renderAgent(
      agent,
      profiles.find((p) => p.id === 'codex')!,
      { allowLossy: true },
    );
    expect(lossy.text).toContain('Read only.');
    expect(lossy.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'TOOL_RESTRICTION_OMITTED',
        severity: 'warning',
        message: expect.stringContaining('default tool permissions'),
      }),
    );
    const hooks = parseAgent(
      '---\nname: gate\ndescription: Gate\nhooks: {}\n---\nCheck.',
      'gate.md',
    );
    expect(() =>
      renderAgent(
        hooks,
        profiles.find((p) => p.id === 'opencode')!,
      ),
    ).toThrow(/hooks/);
    expect(
      renderAgent(
        hooks,
        profiles.find((p) => p.id === 'opencode')!,
        { allowLossy: true },
      ).diagnostics,
    ).toContainEqual(
      expect.objectContaining({
        code: 'NATIVE_FIELD_OMITTED',
        severity: 'warning',
        message: expect.stringContaining('hooks'),
      }),
    );
  });
  it('keeps project and global environments separate', async () => {
    const { ws, home, dir } = await fixture();
    const global = new Workspace({ global: true, home, cache: join(dir, 'cache') });
    const manifest = emptyManifest();
    manifest.mcp.personal = {
      connection: { transport: 'stdio', command: 'node', args: [], env: {} },
    };
    await global.saveManifest(manifest);
    await sync(global, ['codex']);
    expect(await exists(join(home, '.codex/config.toml'))).toBe(true);
    expect(await exists(join(ws.root, '.codex/config.toml'))).toBe(false);
    expect((await ws.manifest()).mcp).toEqual({});
  });
  it('resolves global local sources from cwd and keeps explicit home isolated from native overrides', async () => {
    const { root, home, dir } = await fixture();
    const previous = process.env.CODEX_HOME;
    process.env.CODEX_HOME = join(dir, 'other-codex-home');
    try {
      await write(
        join(root, 'helper.md'),
        '---\nname: helper\ndescription: Help with changes\n---\nReview the changes.\n',
      );
      const global = new Workspace({ cwd: root, global: true, home, cache: join(dir, 'cache') });
      await add(global, 'agent', { source: './helper.md', names: [] });
      await sync(global, ['codex']);
      expect(await readOptional(join(home, '.codex/agents/helper.toml'))).toContain(
        'Review the changes.',
      );
      expect(await exists(join(process.env.CODEX_HOME, 'agents/helper.toml'))).toBe(false);
      expect(await exists(join(root, '.agents/etymon.toml'))).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previous;
    }
  });
});
describe('transaction integrity', () => {
  it('refuses symlink activation and multi-target collisions', async () => {
    const { ws, dir } = await fixture();
    const elsewhere = join(dir, 'elsewhere');
    await fs.mkdir(elsewhere);
    await fs.symlink(elsewhere, join(ws.root, '.claude'));
    await expect(
      planUnits(
        ws,
        [
          {
            path: join(ws.root, '.claude/a.md'),
            content: Buffer.from('x'),
            resources: ['a'],
            harnesses: ['claude'],
          },
        ],
        ['claude'],
      ),
    ).rejects.toMatchObject({ code: 'SYMLINK_CONFLICT' });
    await expect(
      planUnits(
        ws,
        [
          {
            path: join(ws.root, 'same'),
            content: Buffer.from('a'),
            resources: ['a'],
            harnesses: ['a'],
          },
          {
            path: join(ws.root, 'same'),
            content: Buffer.from('b'),
            resources: ['b'],
            harnesses: ['b'],
          },
        ],
        ['a', 'b'],
      ),
    ).rejects.toMatchObject({ code: 'MULTI_TARGET_COLLISION' });
  });
  it('rolls back previous writes if a later file changed after planning', async () => {
    const { ws } = await fixture();
    const a = join(ws.root, 'a'),
      b = join(ws.root, 'b');
    await write(a, 'old-a');
    await write(b, 'old-b');
    const plan = await planUnits(
      ws,
      [
        { path: a, content: Buffer.from('new-a'), resources: ['a'], harnesses: ['test'] },
        { path: b, content: Buffer.from('new-b'), resources: ['b'], harnesses: ['test'] },
      ],
      ['test'],
      { adopt: true },
    );
    await write(b, 'concurrent-b');
    await expect(apply(ws, plan)).rejects.toBeInstanceOf(EtymonError);
    expect(await readOptional(a)).toBe('old-a');
    expect(await readOptional(b)).toBe('concurrent-b');
  });
  it('recovers interrupted writes and rejects subsequent edits', async () => {
    const { ws } = await fixture();
    const path = join(ws.root, 'output');
    await write(path, 'after');
    await write(
      join(ws.runtime, 'journal.json'),
      json({
        version: 1,
        status: 'applying',
        changes: [
          {
            path,
            before: Buffer.from('before').toString('base64'),
            after: Buffer.from('after').toString('base64'),
            mode: 0o644,
          },
        ],
      }),
    );
    expect(await recover(ws)).toBe(true);
    expect(await readOptional(path)).toBe('before');
  });
  it('detects duplicate JSON/TOML keys and preserves unrelated comments', () => {
    expect(() => readDocument('{"x":1,"x":2}', 'json')).toThrow(/Duplicate/);
    expect(() => readDocument('x=1\nx=2\n', 'toml')).toThrow();
    const input =
      '# header\nmodel="mine"\n\n[mcp_servers.a]\ncommand="old"\n\n[projects."/path"]\ntrust_level="trusted"\n';
    const result = editDocument(
      input,
      ['mcp_servers', 'a'],
      { command: 'new', env: { X: 'Y' } },
      'toml',
    );
    expect(result).toContain('# header');
    expect(result).toContain('trust_level="trusted"');
    expect(
      (readDocument(result, 'toml').mcp_servers as Record<string, { command: string }>).a.command,
    ).toBe('new');
    const multiline =
      'developer_instructions="""\n[mcp_servers.a]\nThis is prompt text.\n"""\n\n[mcp_servers.a]\ncommand="old"\n';
    const preserved = editDocument(multiline, ['mcp_servers', 'a'], { command: 'new' }, 'toml');
    expect(readDocument(preserved, 'toml').developer_instructions).toBe(
      readDocument(multiline, 'toml').developer_instructions,
    );
  });
});
describe('locked Git agent provider', () => {
  it('restores a historical commit in a fresh cache, and changes resolution only on update', async () => {
    const { ws, dir, home } = await fixture();
    const repo = join(dir, 'upstream');
    await fs.mkdir(repo);
    await run('git', ['init', '--initial-branch=main', repo]);
    await write(
      join(repo, 'agents', 'helper.md'),
      '---\nname: helper\ndescription: A helper\n---\nOriginal prompt.\n',
    );
    await run('git', ['-C', repo, 'add', '.']);
    await run('git', [
      '-c',
      'user.name=Etymon Test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-C',
      repo,
      'commit',
      '-m',
      'original',
    ]);
    await add(ws, 'agent', { source: `git+file://${repo}#main:agents`, names: [] });
    const original = (await ws.lock()).dependencies[0].resolved.commit;
    await write(
      join(repo, 'agents', 'helper.md'),
      '---\nname: helper\ndescription: A helper\n---\nUpdated upstream prompt.\n',
    );
    await run('git', ['-C', repo, 'add', '.']);
    await run('git', [
      '-c',
      'user.name=Etymon Test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-C',
      repo,
      'commit',
      '-m',
      'updated',
    ]);
    const clone = join(dir, 'cloned-project');
    await fs.mkdir(join(clone, '.agents'), { recursive: true });
    await fs.copyFile(ws.lockPath, join(clone, '.agents/etymon.lock'));
    const restored = new Workspace({ cwd: clone, home, cache: join(dir, 'empty-cache') });
    await sync(restored, ['codex']);
    expect(await readOptional(join(clone, '.codex/agents/helper.toml'))).toContain(
      'Original prompt.',
    );
    expect((await restored.lock()).dependencies[0].resolved.commit).toBe(original);
    expect((await update(restored)).updated).toHaveLength(1);
    await sync(restored, ['codex']);
    expect(await readOptional(join(clone, '.codex/agents/helper.toml'))).toContain(
      'Updated upstream prompt.',
    );
  });
  it('rejects a selected Git symlink before reading a file outside the source', async () => {
    const { ws, dir } = await fixture();
    const repo = join(dir, 'repo');
    await fs.mkdir(repo);
    await run('git', ['init', repo]);
    await write(join(dir, 'outside.md'), 'Private file');
    await fs.symlink(join(dir, 'outside.md'), join(repo, 'agent.md'));
    await run('git', ['-C', repo, 'add', '.']);
    await run('git', [
      '-c',
      'user.name=Etymon Test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-C',
      repo,
      'commit',
      '-m',
      'symlink',
    ]);
    await expect(
      add(ws, 'agent', { source: `git+file://${repo}#HEAD:agent.md`, names: [] }),
    ).rejects.toMatchObject({ code: 'SYMLINK_CONFLICT' });
  });
});
describe('source and harness formats', () => {
  it('normalizes GitHub, GitLab, Azure, SSH and direct file sources', async () => {
    const { ws } = await fixture();
    expect(await parseSource('augmnt/agents/api-designer.md', ws.root)).toMatchObject({
      type: 'git',
      repository: 'https://github.com/augmnt/agents.git',
      subpath: 'api-designer.md',
    });
    expect(
      await parseSource('https://github.com/augmnt/agents/tree/main/api-designer.md', ws.root),
    ).toMatchObject({ type: 'git', ref: 'main', subpath: 'api-designer.md' });
    expect(
      await parseSource('https://gitlab.com/group/subgroup/repo/-/tree/main/agents/a.md', ws.root),
    ).toMatchObject({
      repository: 'https://gitlab.com/group/subgroup/repo.git',
      subpath: 'agents/a.md',
    });
    expect(
      await parseSource(
        'https://dev.azure.com/org/project/_git/repo?path=/agents/a.md&version=GBmain',
        ws.root,
      ),
    ).toMatchObject({ ref: 'main', subpath: 'agents/a.md' });
    expect(await parseSource('git@github.com:org/repo.git#main:agents', ws.root)).toMatchObject({
      type: 'git',
      ref: 'main',
      subpath: 'agents',
    });
    expect(
      await parseSource(
        'https://raw.githubusercontent.com/augmnt/agents/main/api-designer.md',
        ws.root,
      ),
    ).toMatchObject({ type: 'url' });
    await expect(parseSource('owner/repo/../../escape', ws.root)).rejects.toMatchObject({
      code: 'UNSAFE_PATH',
    });
    for (const source of [
      'https://example.com/agent.md?token=never-store',
      'git+https://user:password@example.com/repo.git',
    ])
      await expect(parseSource(source, ws.root)).rejects.toMatchObject({ code: 'INVALID_SOURCE' });
    const spaced = join(ws.root, 'my agent.md');
    await write(spaced, 'Review changes.');
    expect(await parseSource(`file://${spaced.replaceAll(' ', '%20')}`, ws.root)).toEqual({
      type: 'local',
      path: spaced,
    });
  });
  it('round-trips stdio MCP across all declared config dialects', () => {
    const connection = {
      transport: 'stdio' as const,
      command: 'node',
      args: ['server.js'],
      env: {},
      cwd: '/work',
    };
    for (const p of profiles.filter((p) => p.mcpDialect)) {
      const out = renderMcp(connection, p);
      const back = importMcp(out, p, []);
      expect(back.connection.command).toBe('node');
      expect(back.connection.args).toEqual(['server.js']);
    }
  });
  it('detects agent formats and round-trips a portable prompt into every native agent dialect', () => {
    const agent = parseAgent(
      '---\nname: simple\ndescription: Simple prompt\n---\nDo a narrow job.',
      'simple.md',
    );
    for (const p of profiles.filter((p) => p.agentDialect)) {
      const { text } = renderAgent(agent, p);
      const extension =
        p.agentDialect === 'codex'
          ? '.toml'
          : p.agentDialect === 'kiro'
            ? '.json'
            : p.agentDialect === 'copilot'
              ? '.agent.md'
              : '.md';
      const back = parseAgent(text, 'simple' + extension, p.agentDialect);
      expect(back.prompt).toBe(agent.prompt);
      expect(back.description).toBe(agent.description);
    }
  });
  it('launches stdio with runtime environment references and no shell interpretation', async () => {
    const { dir } = await fixture();
    const script = join(dir, 'launcher.mjs');
    await write(
      script,
      launcher({
        transport: 'stdio',
        command: process.execPath,
        args: [
          '-e',
          'process.stdout.write(JSON.stringify([process.env.TEST_KEY, process.argv[1]]))',
          '$(touch NEVER_CREATED)',
        ],
        env: { TEST_KEY: { env: 'ETYMON_TEST_VALUE' } },
      }),
    );
    const output = await run(process.execPath, [script], {
      env: { ETYMON_TEST_VALUE: 'runtime-only-fixture' },
    });
    expect(JSON.parse(output)).toEqual(['runtime-only-fixture', '$(touch NEVER_CREATED)']);
    expect(await readOptional(script)).not.toContain('runtime-only-fixture');
  });
});
describe('official MCP registry provider', () => {
  let server: HttpServer;
  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  async function registry(metadata: Record<string, unknown>) {
    server = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url?.includes('/versions/'))
        res.end(
          json({
            server: metadata,
            _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active' } },
          }),
        );
      else res.end(json({ servers: [{ server: metadata }], metadata: { count: 1 } }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }
  it('locks metadata, configuration and secrets, and restores exact artifacts in a clean cache', async () => {
    const { ws, dir, root, home } = await fixture();
    const url = await registry({
      name: 'io.example/testing',
      version: '1.0.0',
      packages: [
        {
          registryType: 'npm',
          identifier: '@example/mcp',
          version: '2.3.4',
          transport: { type: 'stdio' },
          environmentVariables: [{ name: 'API_KEY', isRequired: true, isSecret: true }],
        },
      ],
    });
    await add(ws, 'mcp', { source: 'io.example/testing', names: [], registry: url });
    const lock = await ws.lock();
    expect(lock.dependencies[0].resolved.version).toBe('1.0.0');
    expect(JSON.stringify(lock)).toContain('2.3.4');
    expect(JSON.stringify(lock)).toContain('API_KEY');
    await sync(ws, ['codex']);
    const restored = new Workspace({ cwd: root, home, cache: join(dir, 'new-cache') });
    const result = await resources(restored);
    expect(result[0].kind).toBe('mcp');
    const offline = new Workspace({
      cwd: root,
      home,
      cache: join(dir, 'missing-cache'),
      offline: true,
    });
    await expect(resources(offline)).rejects.toMatchObject({ code: 'OFFLINE_CACHE_MISS' });
    expect(lock.dependencies[0].request.destDir).toBeUndefined();
    expect((await update(ws)).updated).toEqual([]);
    expect((await ws.lock()).dependencies[0].id).toBe(lock.dependencies[0].id);
  });
  it('requires explicit implementation selection, exact package versions and secret references', () => {
    const metadata = {
      name: 'io.example/a',
      version: '1',
      remotes: [
        { type: 'streamable-http' as const, url: 'https://one.example/mcp' },
        { type: 'streamable-http' as const, url: 'https://two.example/mcp' },
      ],
    };
    expect(() => resolveServer(metadata, { source: metadata.name, names: [] })).toThrow(/Choose/);
    expect(resolveServer(metadata, { source: metadata.name, names: [], remote: 1 })).toMatchObject({
      url: 'https://two.example/mcp',
    });
    expect(() =>
      resolveServer(
        {
          name: 'io.example/a',
          version: '1',
          packages: [
            {
              registryType: 'npm',
              identifier: 'x',
              version: 'latest',
              transport: { type: 'stdio' },
            },
          ],
        },
        { source: 'x', names: [] },
      ),
    ).toThrow(/exact version/);
    expect(() =>
      resolveServer(
        {
          name: 'io.example/a',
          version: '1',
          packages: [
            {
              registryType: 'npm',
              identifier: 'x',
              version: '1.0.0',
              transport: { type: 'stdio' },
              environmentVariables: [{ name: 'TOKEN', isSecret: true }],
            },
          ],
        },
        { source: 'x', names: [], inputs: { TOKEN: 'never-store' } },
      ),
    ).toThrow(/secret inputs/);
  });
  it('externalizes secret header templates and maps bearer authorization without storing credentials', () => {
    const metadata = {
      name: 'io.example/headers',
      version: '1',
      remotes: [
        {
          type: 'streamable-http' as const,
          url: 'https://example.com/mcp',
          headers: [
            {
              name: 'Authorization',
              value: 'Bearer {TOKEN}',
              isSecret: true,
              isRequired: true,
              variables: { TOKEN: {} },
            },
          ],
        },
      ],
    };
    const request = { source: metadata.name, names: [] };
    const connection = resolveServer(metadata, request);
    expect(connection).toMatchObject({ headers: { Authorization: 'Bearer ${env:TOKEN}' } });
    expect(
      renderMcp(
        connection,
        profiles.find((p) => p.id === 'codex')!,
      ),
    ).toEqual({ url: 'https://example.com/mcp', bearer_token_env_var: 'TOKEN' });
    expect(
      renderMcp(
        connection,
        profiles.find((p) => p.id === 'opencode')!,
      ),
    ).toMatchObject({ headers: { Authorization: 'Bearer {env:TOKEN}' } });
    expect(
      renderMcp(
        connection,
        profiles.find((p) => p.id === 'claude')!,
      ),
    ).toMatchObject({ headers: { Authorization: 'Bearer ${TOKEN}' } });
    expect(() =>
      resolveServer(metadata, { ...request, inputs: { TOKEN: 'literal-secret' } }),
    ).toThrow(/secret inputs/);
  });
});
