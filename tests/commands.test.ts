import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, Server } from 'node:http';
import {
  add,
  convert,
  create,
  discoverCommands,
  parseCommand,
  remove,
  resources,
  skillPolicy,
  sync,
  update,
  Workspace,
} from '../src/index.js';
import { exists, fileArtifact, run, textFile } from '../src/core/fs.js';
import { skillMetadata } from '../src/providers/skills.js';
import { frontmatter } from '../src/providers/agents.js';
import { commandProfiles } from '../src/harnesses/command-profiles.js';

const directories: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((done) => server.close(() => done()));
  for (const directory of directories.splice(0))
    await fs.rm(directory, { recursive: true, force: true });
});
async function fixture(global = false) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'etymon-commands-'));
  directories.push(directory);
  const root = join(directory, 'project'),
    home = join(directory, 'home');
  await fs.mkdir(root);
  await fs.mkdir(home);
  return new Workspace({ cwd: root, home, global, cache: join(directory, 'cache') });
}
async function write(path: string, text: string) {
  await fs.mkdir(join(path, '..'), { recursive: true });
  await fs.writeFile(path, text);
}
const manual = '---\ndescription: Run checks\n---\nRun tests.';

it('parses command dialects into standard skill frontmatter and retains native requirements', () => {
  for (const format of [
    'markdown',
    'codex',
    'cursor',
    'opencode',
    'kilo',
    'amp',
    'roo',
    'cline',
    'windsurf',
    'pi',
    'omp',
    'kiro',
    'continue',
  ] as const) {
    const artifact = parseCommand(manual, 'Checks', format);
    const metadata = skillMetadata(artifact);
    expect(metadata).toMatchObject({
      name: 'checks',
      description: 'Run checks',
      metadata: { 'etymon.invocation': 'manual' },
    });
    expect(Object.keys(metadata).sort()).toEqual(['description', 'metadata', 'name']);
    expect(artifact.files.map((file) => file.path)).toEqual(['SKILL.md', 'agents/openai.yaml']);
    expect(frontmatter(textFile(artifact, 'SKILL.md')).body).toBe('Run tests.');
  }
  expect(skillPolicy(skillMetadata(parseCommand(manual, 'checks', 'claude'))).invocation).toBe(
    'auto',
  );
  const gemini = parseCommand(
    'description = "Run checks"\nprompt = "Check {{args}} !{git diff}"',
    'git:checks',
    'gemini',
  );
  expect(skillMetadata(gemini).name).toBe('git-checks');
  expect(skillPolicy(skillMetadata(gemini)).command).toMatchObject({
    format: 'gemini',
    features: ['arguments', 'context'],
  });
  const native = parseCommand(
    '---\ndescription: Review\nmodel: opus\nallowed-tools: Read\ncontext: fork\ndisable-model-invocation: true\n---\nReview $ARGUMENTS with !`git diff`.',
    'review',
    'claude',
  );
  expect(skillPolicy(skillMetadata(native)).command).toMatchObject({
    format: 'claude',
    native: { model: 'opus', 'allowed-tools': 'Read', context: 'fork' },
    features: ['arguments', 'context'],
  });
});

it('discovers every declared project command dialect without treating workflows as rules or VS Code prompts as commands', async () => {
  const ws = await fixture();
  for (const [id, profile] of Object.entries(commandProfiles)) {
    if (id === 'copilot-cli') continue;
    const source = profile.project.find((source) => !source.config);
    if (!source) continue;
    await write(
      join(ws.root, source.path, id + (source.format === 'gemini' ? '.toml' : '.md')),
      source.format === 'gemini'
        ? `description = "${id} checks"\nprompt = "Run ${id} checks."`
        : `---\ndescription: ${id} checks\n---\nRun ${id} checks.`,
    );
  }
  await write(
    join(ws.root, '.continue/config.json'),
    JSON.stringify({
      customCommands: [
        { name: 'legacy-continue', description: 'Continue checks', prompt: 'Run Continue checks.' },
      ],
    }),
  );
  await write(
    join(ws.root, '.github/prompts/ignored.prompt.md'),
    'VS Code prompt is outside scope.',
  );
  await write(
    join(ws.root, '.codex/prompts/project-only.md'),
    'Codex does not load project custom prompts.',
  );
  const report = await convert(ws);
  const authored = await ws.manifest();
  expect(Object.keys(authored.skill)).toHaveLength(14);
  expect(Object.keys(authored.rule)).toEqual([]);
  expect(authored.skill['project-only']).toBeUndefined();
  expect(authored.skill.ignored).toBeUndefined();
  expect(report.diagnostics.filter((d) => d.code === 'COMMAND_MODERNIZED')).toHaveLength(15);
  const before = await fs.readFile(ws.manifestPath, 'utf8');
  await convert(ws, 'codex');
  await convert(ws);
  await convert(ws, 'claude');
  expect(await fs.readFile(ws.manifestPath, 'utf8')).toBe(before);
});

it('modernizes filtered commands, preserves strict policy, deduplicates projections and retains complete bundle conflicts', async () => {
  const ws = await fixture();
  await write(join(ws.root, '.cursor/commands/checks.md'), manual);
  await convert(ws, 'cursor');
  const source = join(ws.agents, 'etymon/skills/checks/SKILL.md');
  const canonical = await fs.readFile(source, 'utf8');
  await fs.rm(join(ws.root, '.cursor/commands'), { recursive: true });
  await sync(ws, ['claude', 'codex', 'copilot-cli', 'vscode-local', 'cursor', 'pi', 'omp', 'zed']);
  expect(await fs.readFile(join(ws.root, '.claude/skills/checks/SKILL.md'), 'utf8')).toContain(
    'disable-model-invocation: true',
  );
  expect(
    await fs.readFile(join(ws.root, '.agents/skills/checks/agents/openai.yaml'), 'utf8'),
  ).toContain('allow_implicit_invocation: false');
  expect(await exists(join(ws.root, '.claude/commands'))).toBe(false);
  expect(await exists(join(ws.root, '.codex/prompts'))).toBe(false);
  await convert(ws, 'codex');
  await convert(ws);
  await convert(ws, 'claude');
  expect(Object.keys((await ws.manifest()).skill)).toEqual(['checks']);
  expect(await fs.readFile(source, 'utf8')).toBe(canonical);
  expect(
    (
      await sync(ws, [
        'claude',
        'codex',
        'copilot-cli',
        'vscode-local',
        'cursor',
        'pi',
        'omp',
        'zed',
      ])
    ).summary,
  ).toEqual([]);
  await write(join(ws.root, '.claude/skills/checks/assets/changed.txt'), 'Extra native asset');
  await expect(convert(ws, 'claude')).rejects.toMatchObject({ code: 'IMPORT_CONFLICT' });
  expect(await fs.readFile(source, 'utf8')).toBe(canonical);
});

it('keeps native argument, tool and context semantics, never runs substitutions, and warns before lossy projection', async () => {
  const ws = await fixture();
  const marker = join(ws.root, 'must-not-exist');
  await write(
    join(ws.root, '.claude/commands/review.md'),
    `---\ndescription: Review changes\ndisable-model-invocation: true\nmodel: opus\nallowed-tools: Read\nargument-hint: <file>\n---\nReview $ARGUMENTS after !\`touch ${marker}\`.`,
  );
  await convert(ws, 'claude');
  expect(await exists(marker)).toBe(false);
  const canonical = await fs.readFile(join(ws.agents, 'etymon/skills/review/SKILL.md'), 'utf8');
  await sync(ws, ['claude']);
  expect(await fs.readFile(join(ws.root, '.claude/skills/review/SKILL.md'), 'utf8')).toContain(
    'allowed-tools: Read',
  );
  await convert(ws, 'claude');
  const strict = await sync(ws, ['codex', 'opencode'], { dryRun: true });
  expect(strict.summary).toEqual([]);
  expect(strict.diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'SKILL_INVOCATION_UNSUPPORTED',
      harness: 'opencode',
      severity: 'error',
    }),
  );
  const lossy = await sync(ws, ['codex', 'opencode'], { allowLossy: true });
  expect(lossy.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'COMMAND_TEMPLATE_OMITTED', severity: 'warning' }),
  );
  expect(lossy.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'SKILL_INVOCATION_OMITTED', harness: 'opencode' }),
  );
  expect(
    lossy.diagnostics.filter((d) => d.severity === 'warning').every((d) => d.resource && d.harness),
  ).toBe(true);
  expect(await fs.readFile(join(ws.agents, 'etymon/skills/review/SKILL.md'), 'utf8')).toBe(
    canonical,
  );
  expect(await exists(marker)).toBe(false);
});

it('imports global command locations and top-level Codex prompts without project leakage', async () => {
  const ws = await fixture(true);
  await write(join(ws.root, '.codex/prompts/checks.md'), manual);
  await write(join(ws.root, '.codex/prompts/nested/ignored.md'), manual);
  await write(join(ws.cwd, '.cursor/commands/project.md'), manual);
  await convert(ws, 'codex');
  expect(Object.keys((await ws.manifest()).skill)).toEqual(['checks']);
  await sync(ws, ['codex', 'claude']);
  expect(await exists(join(ws.root, '.agents/skills/checks/SKILL.md'))).toBe(true);
  expect(await exists(join(ws.cwd, '.agents/skills/checks/SKILL.md'))).toBe(false);
});

it('locks Git commands at immutable commits and restores their skill bundles after upstream changes', async () => {
  const ws = await fixture();
  const repository = join(ws.root, 'source');
  await fs.mkdir(repository);
  await run('git', ['init', '-q', repository]);
  await write(join(repository, '.cursor/commands/checks.md'), manual);
  await write(join(repository, 'README.md'), 'Ordinary repository documentation.');
  const commit = async () => {
    await run('git', ['add', '.'], { cwd: repository });
    await run(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '-qm',
        'fixture',
      ],
      { cwd: repository },
    );
  };
  await commit();
  await add(ws, 'skill', {
    source: 'git+file://' + repository,
    names: ['checks'],
    commandFormat: 'cursor',
  });
  const first = (await ws.lock()).dependencies[0];
  expect(first.kind).toBe('skill');
  expect(first.resolved.skillsCli).toBeUndefined();
  expect(first.artifacts[0].path).toBe('.cursor/commands/checks.md');
  await write(
    join(repository, '.cursor/commands/checks.md'),
    manual.replace('Run tests.', 'Run updated tests.'),
  );
  await commit();
  await fs.rm(ws.cache.root, { recursive: true, force: true });
  await sync(ws, ['codex']);
  expect(await fs.readFile(join(ws.root, '.agents/skills/checks/SKILL.md'), 'utf8')).not.toContain(
    'updated',
  );
  expect((await ws.lock()).dependencies[0].resolved.commit).toBe(first.resolved.commit);
  await update(ws);
  expect((await ws.lock()).dependencies[0].resolved.commit).not.toBe(first.resolved.commit);
  await sync(ws, ['codex']);
  expect(await fs.readFile(join(ws.root, '.agents/skills/checks/SKILL.md'), 'utf8')).toContain(
    'Run updated tests.',
  );
});

it('uses local sources first, registers commands transactionally and removes only modern owned output', async () => {
  const ws = await fixture();
  await write(join(ws.cwd, 'owner/repo/checks.md'), manual);
  const added = await add(ws, 'skill', {
    source: 'owner/repo/checks.md',
    names: [],
    commandFormat: 'auto',
  });
  expect(added.ids).toEqual(['skill:local/checks']);
  expect((await ws.manifest()).skill.checks.path).toBe('etymon/skills/checks');
  expect((await ws.lock()).dependencies).toEqual([]);
  expect(
    await add(ws, 'skill', { source: 'owner/repo/checks.md', names: [], commandFormat: 'auto' }),
  ).toEqual(added);
  await sync(ws, ['codex']);
  await remove(ws, 'skill', 'checks');
  expect(await exists(join(ws.root, '.agents/skills/checks/SKILL.md'))).toBe(false);
  expect(await exists(join(ws.root, '.agents/etymon/skills/checks/SKILL.md'))).toBe(true);
  expect(await exists(join(ws.root, 'owner/repo/checks.md'))).toBe(true);
  await expect(
    add(ws, 'skill', { source: './absent.md', names: [], commandFormat: 'auto' }),
  ).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
});

it('locks external commands as skills, restores exact bytes, detects tampering and updates deliberately', async () => {
  const ws = await fixture();
  let content = manual;
  const server = createServer((_req, response) => response.end(content));
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/checks.md`;
  await add(ws, 'skill', { source: url, names: [], commandFormat: 'cursor' });
  const dependency = (await ws.lock()).dependencies[0];
  expect(dependency).toMatchObject({ kind: 'skill', request: { commandFormat: 'cursor' } });
  expect(dependency.resolved.skillsCli).toBeUndefined();
  await fs.rm(ws.cache.root, { recursive: true });
  expect((await resources(ws))[0]).toMatchObject({ kind: 'skill', name: 'checks' });
  content = manual.replace('Run tests.', 'Run changed tests.');
  await fs.rm(ws.cache.root, { recursive: true });
  await expect(resources(ws)).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' });
  await update(ws);
  await sync(ws, ['codex']);
  expect(await fs.readFile(join(ws.root, '.agents/skills/checks/SKILL.md'), 'utf8')).toContain(
    'Run changed tests.',
  );
});

it('preserves executable Amp commands without running them and honors source exclusions', async () => {
  const ws = await fixture();
  const script = join(ws.root, '.agents/commands/checks.sh');
  await write(script, '#!/bin/sh\ntouch must-not-exist\n');
  await fs.chmod(script, 0o755);
  await write(
    join(ws.root, '.gemini/commands/git/review.toml'),
    'description = "Review"\nprompt = "Review changes."',
  );
  await convert(ws, undefined, { exclude: ['.gemini/commands/**'] });
  expect(Object.keys((await ws.manifest()).skill)).toEqual(['checks']);
  expect(await exists(join(ws.root, 'must-not-exist'))).toBe(false);
  expect((await sync(ws, ['codex'], { dryRun: true })).diagnostics).toContainEqual(
    expect.objectContaining({ code: 'COMMAND_TEMPLATE_UNSUPPORTED', severity: 'error' }),
  );
  await sync(ws, ['codex'], { allowLossy: true });
  const output = join(ws.root, '.agents/skills/checks/scripts/checks.sh');
  expect(await fs.readFile(output, 'utf8')).toBe('#!/bin/sh\ntouch must-not-exist\n');
  expect((await fs.stat(output)).mode & 0o111).toBe(0o111);
  expect(await exists(join(ws.root, 'must-not-exist'))).toBe(false);
});

it('rejects malformed commands, unsafe aliases, colliding normalized names and invalid reserved metadata', async () => {
  const ws = await fixture();
  for (const text of [
    '---\ndescription: []\n---\nBody',
    '---\ndisable-model-invocation: "false"\n---\nBody',
    '---\nargument-hint: []\n---\nBody',
    '---\ndescription: Review\n---\n',
    '---\nname: ../..\n---\nBody',
  ])
    expect(() => parseCommand(text, 'checks', 'claude')).toThrow();
  expect(() => parseCommand('prompt = []', 'checks', 'gemini')).toThrow();
  await write(join(ws.root, 'commands/api:review.md'), manual);
  await write(join(ws.root, 'commands/api-review.md'), manual.replace('Run tests.', 'Different.'));
  await expect(discoverCommands(join(ws.root, 'commands'))).rejects.toMatchObject({
    code: 'COMMAND_NAME_COLLISION',
  });
  await fs.symlink('api-review.md', join(ws.root, 'commands/alias.md'));
  await expect(discoverCommands(join(ws.root, 'commands'))).rejects.toMatchObject({
    code: 'SOURCE_SYMLINK',
  });
  expect(() =>
    skillMetadata(
      fileArtifact(
        'SKILL.md',
        '---\nname: checks\ndescription: Run checks\nmetadata:\n  etymon.command: "invalid json"\n---\nBody',
      ),
    ),
  ).toThrow();
  await expect(discoverCommands(ws.root, [], 'cursor', { repository: true })).rejects.toMatchObject(
    { code: 'NO_COMMANDS' },
  );
});

it('authors commands using the skill schema and validates policy conflicts independently of lossy permissions', async () => {
  const ws = await fixture();
  const made = await create(ws, {
    kind: 'skill',
    name: 'checks',
    description: 'Run checks',
    body: 'Run tests.',
    invocation: 'manual',
  });
  expect(made.kind).toBe('skill');
  const resource = (await resources(ws))[0];
  expect(resource.kind).toBe('skill');
  if (resource.kind !== 'skill') throw new Error('Expected skill');
  expect(skillPolicy(resource.metadata).invocation).toBe('manual');
  await write(
    join(made.path, '../agents/openai.yaml'),
    'policy:\n  allow_implicit_invocation: true\n',
  );
  await expect(sync(ws, ['codex'], { allowLossy: true })).rejects.toMatchObject({
    code: 'PLAN_BLOCKED',
  });
});

it('merges native command configuration with the documented file precedence and preserves scopes and namespaces', async () => {
  const ws = await fixture();
  await write(
    join(ws.root, 'opencode.json'),
    JSON.stringify({
      command: {
        review: {
          description: 'Config description',
          template: 'Old config body.',
          agent: 'plan',
          model: 'provider/model',
        },
        configOnly: { template: 'Config only.' },
      },
    }),
  );
  await write(
    join(ws.root, 'opencode.jsonc'),
    '{ "command": { "review": { "template": "JSONC body.", "subtask": true } } }',
  );
  await write(
    join(ws.root, '.opencode/commands/review.md'),
    '---\ndescription: File description\nagent: build\n---\n    Preserve file indentation.',
  );
  await write(join(ws.root, '.opencode/command/git/review.md'), manual);
  const explicit = await discoverCommands(ws.root, ['git-review'], 'opencode', {
    repository: true,
  });
  expect(explicit.map((command) => command.name)).toEqual(['git-review']);
  await write(
    join(ws.root, '.kilo/commands/build.md'),
    '---\ndescription: Build\nmodel: first\n---\nBuild project.',
  );
  await write(
    join(ws.root, 'kilo.jsonc'),
    '{ "command": { "build": { "model": "second", "variant": "fast" } } }',
  );
  await write(join(ws.root, 'packages/web/.windsurf/workflows/web.md'), manual);
  await fs.symlink('missing.md', join(ws.root, '.opencode/commands/broken.md'));
  const report = await convert(ws, ['opencode', 'kilo', 'windsurf']);
  expect(Object.keys((await ws.manifest()).skill).sort()).toEqual([
    'build',
    'configonly',
    'git-review',
    'review',
    'web',
  ]);
  const resolved = await resources(ws);
  const review = resolved.find((resource) => resource.name === 'review');
  if (!review || review.kind !== 'skill') throw new Error('Expected review skill');
  expect(skillPolicy(review.metadata).command?.native).toEqual({
    agent: 'build',
    model: 'provider/model',
    subtask: true,
  });
  expect(textFile({ version: 1, files: review.files }, 'SKILL.md')).toContain(
    '    Preserve file indentation.',
  );
  const build = resolved.find((resource) => resource.name === 'build');
  if (!build || build.kind !== 'skill') throw new Error('Expected build skill');
  expect(skillPolicy(build.metadata).command?.native).toEqual({ model: 'second', variant: 'fast' });
  expect(report.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'COMMAND_SYMLINK_SKIPPED' }),
  );
  const before = await fs.readFile(ws.manifestPath, 'utf8');
  await convert(ws, ['opencode', 'kilo', 'windsurf']);
  expect(await fs.readFile(ws.manifestPath, 'utf8')).toBe(before);
});

it('infers command dialects for explicit configuration files instead of treating them as Markdown', async () => {
  const ws = await fixture();
  const config = join(ws.root, '.continue/config.json');
  await write(
    config,
    JSON.stringify({
      customCommands: [{ name: 'checks', description: 'Run checks', prompt: 'Run tests.' }],
    }),
  );
  expect((await discoverCommands(config)).map((command) => command.name)).toEqual(['checks']);
  await add(ws, 'skill', { source: config, names: [], commandFormat: 'auto' });
  expect(Object.keys((await ws.manifest()).skill)).toEqual(['checks']);
});

it('retains user-only policy and refuses ambiguous reserved metadata without lossy bypass', async () => {
  const ws = await fixture();
  const created = await create(ws, {
    kind: 'skill',
    name: 'background',
    description: 'Background guidance',
    body: 'Use automatically.',
    invocation: 'model',
  });
  await sync(ws, ['claude', 'copilot-cli', 'vscode-local']);
  expect(await fs.readFile(join(ws.root, '.claude/skills/background/SKILL.md'), 'utf8')).toContain(
    'user-invocable: false',
  );
  const strict = await sync(ws, ['codex'], { dryRun: true });
  expect(strict.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'SKILL_INVOCATION_UNSUPPORTED', severity: 'error' }),
  );
  const lossy = await sync(ws, ['codex'], { allowLossy: true });
  expect(lossy.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'SKILL_INVOCATION_OMITTED' }),
  );
  const canonical = await fs.readFile(created.path, 'utf8');
  await fs.writeFile(
    created.path,
    canonical
      .replace('etymon.invocation: model', 'etymon.invocation: manual')
      .replace('---\n\n', 'disable-model-invocation: false\n---\n\n'),
  );
  await expect(sync(ws, ['claude'], { allowLossy: true })).rejects.toMatchObject({
    code: 'INVALID_SKILL',
  });
  const metadata = frontmatter(await fs.readFile(created.path, 'utf8')).metadata;
  expect(() => skillPolicy({ ...metadata, 'disable-model-invocation': false })).toThrow(
    /Invalid reserved/,
  );
  expect(() =>
    skillPolicy({
      ...metadata,
      metadata: {
        'etymon.command':
          '{"version":1,"format":"claude","native":{"name":"override"},"features":[]}',
      },
    }),
  ).toThrow(/Invalid reserved/);
});
