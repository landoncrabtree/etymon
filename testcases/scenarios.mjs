import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeChecks, nativeCommandCheck } from './native.mjs';

const rules = async (c) => (await c.list()).authored.rule;
const lockText = (c) => c.read('.agents/etymon.lock');
export const handlers = {
  async commandMigration(c) {
    const preview = await c.cli(['convert', '--dry-run']);
    assert.equal(preview.resources.length, 3);
    await assert.rejects(c.read('.agents/etymon.toml'), { code: 'ENOENT' });
    await c.cli(['convert', '--harness', 'cursor']);
    await c.cli(['convert']);
    await c.cli(['convert', '--harness', 'claude']);
    const manifest = await c.read('.agents/etymon.toml');
    const authored = (await c.list()).authored;
    assert.deepEqual(Object.keys(authored.skill).sort(), ['checks', 'cleanup', 'inspect']);
    assert.deepEqual(authored.rule, {});
    assert.equal(authored.skill.checks.origins.length, 2);
    assert.equal((await c.list()).lock.dependencies.length, 0);
    await c.cli(['convert']);
    assert.equal(await c.read('.agents/etymon.toml'), manifest);
    await c.clear([
      '.claude/commands',
      '.cursor/commands',
      '.clinerules/workflows',
      'opencode.json',
    ]);
    await c.sync('claude,codex,copilot-cli,pi,omp,cursor');
    assert.match(await c.read('.claude/skills/checks/SKILL.md'), /disable-model-invocation: true/);
    assert.match(
      await c.read('.agents/skills/checks/agents/openai.yaml'),
      /allow_implicit_invocation: false/,
    );
    await assert.rejects(c.read('.claude/commands/checks.md'), { code: 'ENOENT' });
    await c.cli(['convert', '--harness', 'codex']);
    await c.cli(['convert']);
    await c.cli(['convert', '--harness', 'claude']);
    assert.equal((await c.cli(['commands', 'list'])).resolved.length, 3);
    await c.idempotent('claude,codex,copilot-cli,pi,omp,cursor');
    const native = [];
    for (const target of c.options.native) native.push(await nativeCommandCheck(c, target));
    await c.cli([
      'commands',
      'create',
      '--name',
      'manual-checks',
      '--description',
      'Run manual checks',
      '--body',
      'Run checks when explicitly requested.',
    ]);
    assert.match(
      await c.read('.agents/etymon/skills/manual-checks/SKILL.md'),
      /etymon.invocation: manual/,
    );
    await c.exec('python3', [
      fileURLToPath(new URL('./tui.py', import.meta.url)),
      process.execPath,
      fileURLToPath(new URL('../bin/etymon.js', import.meta.url)),
      c.project,
      c.home,
      join(c.directory, 'cache'),
      'host-create-command',
    ]);
    assert.match(
      await c.read('.agents/etymon/skills/host-checks/SKILL.md'),
      /etymon.invocation: manual/,
    );
    const personal = join(c.home, '.codex/prompts/checks.md');
    await fs.mkdir(join(personal, '..'), { recursive: true });
    await fs.writeFile(personal, '---\ndescription: Personal checks\n---\nRun personal checks.');
    await c.cli(['convert', '--global', '--harness', 'codex']);
    await c.cli(['sync', '--global', '--harness', 'codex']);
    assert.match(
      await fs.readFile(join(c.home, '.agents/skills/checks/agents/openai.yaml'), 'utf8'),
      /allow_implicit_invocation: false/,
    );
    await c.cli(['commands', 'remove', 'manual-checks', '--allow-lossy']);
    assert.equal((await c.cli(['commands', 'list'])).resolved.length, 4);
    return { native };
  },
  async commandSemantics(c) {
    await c.cli(['convert']);
    assert.deepEqual(Object.keys((await c.list()).authored.skill).sort(), ['git-review', 'review']);
    const canonical = await c.read('.agents/etymon/skills/review/SKILL.md');
    const strict = await c.cli(['sync', '--harness', 'codex,opencode', '--dry-run'], {
      expectedCode: 1,
    });
    assert.deepEqual(strict.changes, []);
    assert(strict.diagnostics.some((d) => d.code === 'SKILL_INVOCATION_UNSUPPORTED'));
    const lossy = await c.sync('codex,opencode', ['--allow-lossy']);
    assert(lossy.diagnostics.some((d) => d.code === 'COMMAND_TEMPLATE_OMITTED'));
    assert(lossy.diagnostics.some((d) => d.code === 'SKILL_COMMAND_FIELDS_OMITTED'));
    assert.equal(await c.read('.agents/etymon/skills/review/SKILL.md'), canonical);
    await assert.rejects(c.read('must-not-exist'), { code: 'ENOENT' });
    await c.idempotent('codex,opencode', ['--allow-lossy']);
    const listing = await c.cli(['commands', 'add', 'owner/repo/local.md', '--list']);
    assert.deepEqual(
      listing.map((command) => command.name),
      ['local'],
    );
    await c.cli(['commands', 'add', 'owner/repo/local.md']);
    assert.equal((await c.list()).lock.dependencies.length, 0);
    const missing = await c.cli(['commands', 'add', './absent.md'], { expectedCode: 1 });
    assert.equal(missing.error.code, 'SOURCE_NOT_FOUND');
    let content = '---\ndescription: External command\n---\nRun locked checks.';
    const server = createServer((_request, response) => response.end(content));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const url = `http://127.0.0.1:${server.address().port}/external.md`;
      await c.cli(['commands', 'add', url, '--format', 'cursor']);
      const lock = (await c.list()).lock;
      assert.equal(lock.dependencies[0].kind, 'skill');
      assert.equal(lock.dependencies[0].request.commandFormat, 'cursor');
      const cached = join(
        c.directory,
        'cache',
        lock.dependencies[0].artifacts[0].digest.slice(7) + '.json',
      );
      await fs.rm(cached);
      await c.cli(['commands', 'list']);
      content = content.replace('locked checks', 'updated checks');
      await fs.rm(cached);
      const corrupt = await c.cli(['commands', 'list'], { expectedCode: 1 });
      assert.equal(corrupt.error.code, 'INTEGRITY_MISMATCH');
      await c.cli(['update']);
      await c.sync('codex,opencode', ['--allow-lossy']);
      assert.match(await c.read('.agents/skills/external/SKILL.md'), /updated checks/);
      await c.cli(['commands', 'remove', 'external', '--allow-lossy']);
      await assert.rejects(c.read('.agents/skills/external/SKILL.md'), { code: 'ENOENT' });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  },
  async nativeImportGaps(c) {
    const deep = Array.from({ length: 24 }, (_, i) => 'level' + i).join('/');
    await c.write(`${deep}/AGENTS.md`, 'Deep guidance.');
    await fs.symlink('AGENTS.md', join(c.project, 'CLAUDE.md'));
    await fs.symlink('missing', join(c.project, '.claude/skills/broken'));
    const blocked = await c.cli(['convert', '--exclude', 'product/templates/**'], {
      expectedCode: 1,
    });
    assert.equal(blocked.error.code, 'IMPORT_COLLISION');
    await assert.rejects(c.read('.agents/etymon.toml'), { code: 'ENOENT' });
    await c.exec('python3', [
      fileURLToPath(new URL('./tui.py', import.meta.url)),
      process.execPath,
      fileURLToPath(new URL('../bin/etymon.js', import.meta.url)),
      c.project,
      c.home,
      join(c.directory, 'cache'),
      'host-import-conflict',
    ]);
    const report = await c.cli([
      'convert',
      '--exclude',
      'product/templates/**',
      '--on-conflict',
      'rename',
    ]);
    assert(report.diagnostics.some((d) => d.code === 'SKILL_SYMLINK_SKIPPED'));
    assert(report.diagnostics.some((d) => d.code === 'IMPORT_RESOURCE_RENAMED'));
    const authored = (await c.list()).authored;
    assert.equal(Object.keys(authored.rule).length, 3);
    assert.equal(Object.keys(authored.mcp).length, 2);
    for (const rule of Object.values(authored.rule).filter((r) => r.destDir !== deep))
      assert.equal(rule.origins.length, 2);
    const before = await c.read('.agents/etymon.toml');
    await c.cli([
      'convert',
      '--harness',
      'codex',
      '--exclude',
      'product/templates/**',
      '--on-conflict',
      'rename',
    ]);
    await c.cli(['convert', '--exclude', 'product/templates/**', '--on-conflict', 'rename']);
    assert.equal(await c.read('.agents/etymon.toml'), before);
    assert.equal((await c.list()).lock.dependencies.length, 0);
    await c.clear([
      'AGENTS.md',
      'CLAUDE.md',
      'packages/api/AGENTS.md',
      'packages/api/CLAUDE.md',
      '.mcp.json',
      '.codex',
      '.claude',
      `${deep}/AGENTS.md`,
    ]);
    await c.sync('codex');
    assert.match(await c.read(`${deep}/AGENTS.md`), /Deep guidance/);
    assert.match(await c.read('packages/api/AGENTS.md'), /API guidance/);
    assert.match(await c.read('.codex/config.toml'), /old\/checkout/);
    assert.match(await c.read('product/templates/.cursor/rules/bad.mdc'), /Product template/);
    await c.idempotent('codex');
  },
  async agnosticConvert(c) {
    const nativePaths = [
      'AGENTS.md',
      'CLAUDE.md',
      'packages/api/AGENTS.md',
      '.claude/rules/general.md',
      '.cursor/rules/types.mdc',
      '.claude/agents/reviewer.md',
      '.codex/config.toml',
      '.mcp.json',
      'opencode.json',
      ...['.agents', '.codex', '.claude'].flatMap((directory) => [
        `${directory}/skills/checks/SKILL.md`,
        `${directory}/skills/checks/assets/check.txt`,
      ]),
    ];
    const originals = new Map(
      await Promise.all(nativePaths.map(async (path) => [path, await c.read(path)])),
    );
    const preview = await c.cli(['convert', '--dry-run']);
    assert.equal(preview.resources.filter((resource) => resource.kind === 'rule').length, 4);
    await assert.rejects(c.read('.agents/etymon.toml'), { code: 'ENOENT' });

    await c.cli(['convert', '--harness', 'codex']);
    let authored = (await c.list()).authored;
    assert.equal(Object.keys(authored.rule).length, 2);
    assert.deepEqual(Object.keys(authored.skill), ['checks']);
    assert.deepEqual(Object.keys(authored.mcp), ['fixture']);
    assert.deepEqual(Object.keys(authored.agent), []);

    await c.cli(['convert']);
    authored = (await c.list()).authored;
    assert.equal(Object.keys(authored.rule).length, 4);
    assert.deepEqual(Object.keys(authored.agent), ['reviewer']);
    assert.equal(authored.skill.checks.origins.length, 3);
    assert.equal(authored.mcp.fixture.origins.length, 3);
    assert.equal(authored.rule.instructions.origins.length, 2);
    const rootRules = Object.values(authored.rule).filter(
      (registration) => registration.destDir === '.',
    );
    assert.equal(rootRules.length, 3);
    assert.equal(
      Object.values(authored.rule).filter((registration) => registration.destDir === 'packages/api')
        .length,
      1,
    );
    assert.match(await c.read('.agents/etymon/rules/general.md'), /activation: always/);
    assert.match(await c.read('.agents/etymon/rules/types.md'), /activation: glob/);
    const manifest = await c.read('.agents/etymon.toml'),
      lock = await lockText(c);
    const sources = new Map(
      await Promise.all(
        Object.values(authored.rule).map(async (registration) => [
          registration.path,
          await c.read('.agents/' + registration.path),
        ]),
      ),
    );

    await c.cli(['convert', '--harness', 'claude']);
    await c.cli(['convert']);
    assert.equal(await c.read('.agents/etymon.toml'), manifest);
    assert.equal(await lockText(c), lock);
    assert.equal((await c.list()).lock.dependencies.length, 0);
    for (const [path, text] of sources) assert.equal(await c.read('.agents/' + path), text);
    for (const [path, text] of originals) assert.equal(await c.read(path), text);

    const executable = fileURLToPath(new URL('../bin/etymon.js', import.meta.url));
    await c.exec('python3', [
      fileURLToPath(new URL('./tui.py', import.meta.url)),
      process.execPath,
      executable,
      c.project,
      c.home,
      join(c.directory, 'cache'),
      'host-import',
    ]);
    assert.equal(await c.read('.agents/etymon.toml'), manifest);

    const invalid = await c.cli(['convert', '--config-path', '.mcp.json'], { expectedCode: 1 });
    assert.equal(invalid.error.code, 'CONFIG_PATH_SCOPE');
    const ambiguous = await c.cli(['convert', 'codex', '--harness', 'claude'], { expectedCode: 1 });
    assert.equal(ambiguous.error.code, 'INVALID_OPTIONS');
    await c.clear([
      'AGENTS.md',
      'CLAUDE.md',
      'packages/api/AGENTS.md',
      '.claude',
      '.codex',
      '.cursor',
      '.mcp.json',
      'opencode.json',
      '.agents/skills',
    ]);
    await c.sync('claude');
    assert.equal(
      (await c.read('AGENTS.md')).split('Run checks and preserve public API behavior.').length - 1,
      1,
    );
    assert.match(
      await c.read('packages/api/AGENTS.md'),
      /Run checks and preserve public API behavior/,
    );
    assert.equal(
      await c.read('.claude/skills/checks/assets/check.txt'),
      originals.get('.agents/skills/checks/assets/check.txt'),
    );
    assert.match(await c.read('.claude/rules/types.md'), /src\/\*\*\/\*\.ts/);
    await c.idempotent('claude');
  },
  async mixedCursorRules(c) {
    const converted = await c.cli(['convert', 'cursor']);
    assert.equal(converted.resources.filter((resource) => resource.kind === 'rule').length, 4);
    const registrations = await rules(c),
      original = new Map();
    assert.deepEqual(Object.keys(registrations).sort(), ['docs', 'general', 'tests', 'types']);
    assert.equal((await c.list()).lock.dependencies.length, 0);
    for (const [name, registration] of Object.entries(registrations)) {
      assert.equal(registration.destDir, '.');
      assert.equal(registration.path, `etymon/rules/${name}.md`);
      const text = await c.read('.agents/' + registration.path);
      assert.match(text, /layout: modular/);
      assert.match(
        text,
        new RegExp(`activation: ${['general', 'docs'].includes(name) ? 'always' : 'glob'}`),
      );
      original.set(name, text);
    }
    // The editable Etymon source must suffice after native originals are removed.
    await c.clear(['.cursor/rules']);
    const preview = await c.sync('claude', ['--dry-run']);
    assert.equal(preview.changes.length, 4);
    assert(preview.changes.every((change) => change.path.includes('/.claude/rules/')));
    await assert.rejects(c.read('.claude/rules/general.md'), { code: 'ENOENT' });
    await c.sync('claude');
    assert.deepEqual((await fs.readdir(join(c.project, '.claude/rules'))).sort(), [
      'docs.md',
      'general.md',
      'tests.md',
      'types.md',
    ]);
    for (const name of ['general', 'docs']) {
      const native = await c.read(`.claude/rules/${name}.md`);
      assert(!/^paths:/m.test(native), `${name} must stay unconditional`);
    }
    assert.match(await c.read('.claude/rules/types.md'), /paths:\n\s+- src\/\*\*\/\*\.\{ts,tsx\}/);
    assert.match(await c.read('.claude/rules/tests.md'), /paths:\n\s+- tests\/\*\*/);
    await assert.rejects(c.read('AGENTS.md'), { code: 'ENOENT' });
    await c.idempotent('claude');
    await c.cli(['convert', 'claude']);
    assert.equal(Object.keys(await rules(c)).length, 4);
    for (const [name, text] of original)
      assert.equal(await c.read(`.agents/etymon/rules/${name}.md`), text);
    await c.idempotent('claude');
    // Restore Cursor directly from the same source, then compose for a
    // standing-only destination with explicit glob losses.
    await c.sync('cursor');
    await c.idempotent('cursor');
    await c.sync('codex', ['--allow-lossy']);
    const composed = await c.read('AGENTS.md');
    for (const phrase of [
      'Run checks',
      'Use explicit types',
      'Keep test data',
      'Update command examples',
    ])
      assert(composed.includes(phrase));
    await c.idempotent('codex', ['--allow-lossy']);
    await c.cli(['rules', 'remove', 'general', '--allow-lossy']);
    await assert.rejects(c.read('.claude/rules/general.md'), { code: 'ENOENT' });
    assert(!(await c.read('AGENTS.md')).includes('Run checks before'));
    assert.match(await c.read('.claude/rules/types.md'), /Use explicit types/);
    await c.idempotent('claude,cursor,codex', ['--allow-lossy']);
  },
  async standaloneClaudeInstructions(c) {
    await c.cli(['convert', 'claude']);
    const manifest = await rules(c);
    assert.deepEqual(Object.keys(manifest), ['instructions']);
    assert.equal(manifest.instructions.destDir, '.');
    const source = await c.read('.agents/etymon/rules/instructions.md');
    assert.match(source, /layout: standing/);
    assert.match(source, /activation: always/);
    assert.equal((await c.list()).lock.dependencies.length, 0);
    await c.clear(['.claude/CLAUDE.md']);
    for (const target of ['copilot-cli', 'codex']) {
      await c.sync(target);
      assert.match(await c.read('AGENTS.md'), /Keep public API behavior stable/);
      await c.idempotent(target);
      await c.cli(['convert', target]);
      assert.deepEqual(Object.keys(await rules(c)), ['instructions']);
    }
    // Clear the owned file to prove Continue does not recreate it.
    await c.clear(['AGENTS.md']);
    await c.sync('continue');
    await assert.rejects(c.read('AGENTS.md'), { code: 'ENOENT' });
    const native = await c.read('.continue/rules/instructions.md');
    assert.match(native, /alwaysApply: true/);
    assert.match(native, /Run the full checks/);
    await c.idempotent('continue');
    await c.cli(['convert', 'continue']);
    assert.deepEqual(Object.keys(await rules(c)), ['instructions']);
    assert.equal(await c.read('.agents/etymon/rules/instructions.md'), source);
    await c.sync('codex,copilot-cli');
    assert.match(await c.read('AGENTS.md'), /Keep public API behavior stable/);
    await c.idempotent('codex,copilot-cli');
  },
  async lossyConversions(c) {
    await c.write(
      'checks/SKILL.md',
      '---\nname: checks\ndescription: Run checks\nargument-hint: "[file]"\n---\nRun tests.\n',
    );
    await c.write(
      'reviewer.md',
      '---\nname: reviewer\ndescription: Review code\ntools: Read\nhooks: {}\n---\nReview changes.\n',
    );
    await c.cli(['skills', 'add', './checks']);
    await c.cli(['agents', 'add', './reviewer.md']);
    await c.cli([
      'rules',
      'create',
      '--name',
      'types',
      '--body',
      'Keep types stable.',
      '--dest-dir',
      'packages/api',
      '--activation',
      'glob',
      '--pattern',
      '**/*.ts',
    ]);
    await c.write(
      'mcp.json',
      JSON.stringify({
        connection: { transport: 'streamable-http', url: 'https://example.com/mcp', headers: {} },
        format: 'copilot-cli',
        native: { tools: ['read'] },
      }),
    );
    await c.cli(['mcp', 'add', './mcp.json']);
    const manifest = await c.read('.agents/etymon.toml'),
      lock = await lockText(c),
      rule = await c.read('.agents/etymon/rules/types.md');
    const strict = await c.cli(['sync', '--harness', 'codex'], { expectedCode: 1 });
    assert.equal(strict.error.code, 'PLAN_BLOCKED');
    await assert.rejects(c.read('.codex/config.toml'), { code: 'ENOENT' });
    const preview = await c.sync('codex', ['--allow-lossy', '--dry-run']);
    for (const code of [
      'SKILL_FIELDS_OMITTED',
      'NATIVE_FIELD_OMITTED',
      'TOOL_RESTRICTION_OMITTED',
      'MCP_FIELDS_OMITTED',
      'RULE_CONDITIONS_DROPPED',
    ])
      assert(
        preview.diagnostics.some((d) => d.code === code && d.severity === 'warning'),
        code,
      );
    await assert.rejects(c.read('packages/api/AGENTS.md'), { code: 'ENOENT' });
    await c.sync('codex', ['--allow-lossy']);
    assert.match(await c.read('packages/api/AGENTS.md'), /Keep types stable/);
    assert(!(await c.read('.agents/skills/checks/SKILL.md')).includes('argument-hint'));
    assert.equal(await c.read('.agents/etymon.toml'), manifest);
    assert.equal(await lockText(c), lock);
    assert.equal(await c.read('.agents/etymon/rules/types.md'), rule);
    await c.idempotent('codex', ['--allow-lossy']);
    await c.cli(['doctor', '--harness', 'codex', '--allow-lossy']);
    const pi = await c.sync('pi', ['--allow-lossy']);
    assert(
      pi.diagnostics.some((d) => d.code === 'RESOURCE_OMITTED' && d.resource.startsWith('agent:')),
    );
    const zed = await c.sync('zed', ['--allow-lossy']);
    assert(zed.diagnostics.some((d) => d.code === 'RULE_SCOPE_BROADENED'));
    await c.write('AGENTS.md', (await c.read('AGENTS.md')) + '\nManual edit.\n');
    const drift = await c.cli(['sync', '--harness', 'zed', '--allow-lossy'], { expectedCode: 1 });
    assert.equal(drift.error.code, 'MANAGED_DRIFT');
    // A separate project proves real keyboard review of losses before activation.
    for (const mode of ['lossy-sync', 'lossy-sync-adopt']) {
      const terminalProject = join(c.directory, mode);
      await fs.mkdir(terminalProject);
      await c.cli([
        'rules',
        'create',
        '--name',
        'conditional',
        '--body',
        'Terminal rule.',
        '--activation',
        'glob',
        '--pattern',
        'src/**',
        '--cwd',
        terminalProject,
      ]);
      if (mode.endsWith('adopt'))
        await fs.writeFile(join(terminalProject, 'AGENTS.md'), 'Unmanaged instructions.');
      await c.exec('python3', [
        fileURLToPath(new URL('./tui.py', import.meta.url)),
        process.execPath,
        fileURLToPath(new URL('../bin/etymon.js', import.meta.url)),
        terminalProject,
        c.home,
        join(c.directory, 'cache'),
        mode,
      ]);
      assert.match(await fs.readFile(join(terminalProject, 'AGENTS.md'), 'utf8'), /Terminal rule/);
      if (mode === 'lossy-sync') {
        await c.cli([
          'rules',
          'create',
          '--name',
          'remaining',
          '--body',
          'Remaining rule.',
          '--activation',
          'glob',
          '--pattern',
          'src/**',
          '--cwd',
          terminalProject,
        ]);
        await c.cli(['sync', '--harness', 'codex', '--allow-lossy', '--cwd', terminalProject]);
        await c.exec('python3', [
          fileURLToPath(new URL('./tui.py', import.meta.url)),
          process.execPath,
          fileURLToPath(new URL('../bin/etymon.js', import.meta.url)),
          terminalProject,
          c.home,
          join(c.directory, 'cache'),
          'lossy-remove',
        ]);
        const content = await fs.readFile(join(terminalProject, 'AGENTS.md'), 'utf8');
        assert.match(content, /Remaining rule/);
        assert(!content.includes('Terminal rule'));
      }
    }
  },
  async repositorySkillVariants(c) {
    const source = join(c.project, 'source'),
      uri = 'git+file://' + source;
    await c.exec('git', ['init', '-q'], { cwd: source });
    await c.gitCommit(source);
    const inspected = await c.cli(['skills', 'add', uri, '--list']);
    assert.equal(inspected.length, 1);
    assert.match(inspected[0].path, /\.agents\/skills\/palette$/);
    await c.cli(['skills', 'add', uri]);
    const before = await lockText(c),
      dependency = (await c.list()).lock.dependencies[0];
    assert.equal(dependency.artifacts[0].path, '.agents/skills/palette');
    await c.sync('codex,copilot-cli');
    assert.equal(await c.read('.agents/skills/palette/assets/palette.txt'), 'SHARED_PALETTE_v1\n');
    // New upstream commits and an empty cache must not change locked bytes.
    await c.write('source/.agents/skills/palette/assets/palette.txt', 'SHARED_PALETTE_v2\n');
    await c.gitCommit(source);
    await c.clear(['.agents/skills/palette', '.github/skills/palette']);
    await c.cli([
      'sync',
      '--harness',
      'codex,copilot-cli',
      '--cache',
      join(c.directory, 'fresh-cache'),
    ]);
    assert.equal(await c.read('.agents/skills/palette/assets/palette.txt'), 'SHARED_PALETTE_v1\n');
    assert.equal(await lockText(c), before);
    await c.idempotent('codex,copilot-cli');
    // The external-provider policy must not hide conflicting local imports.
    const invalid = await c.cli(['skills', 'add', './source', '--offline'], { expectedCode: 1 });
    assert.equal(invalid.error.code, 'SKILL_NAME_COLLISION');
    assert.equal(await lockText(c), before);
  },
  async localSources(c) {
    const body = '---\nname: local-checks\ndescription: Run local checks\n---\nRun tests.\n';
    for (const [kind, source, file, text] of [
      ['skill', 'skills/checks', 'skills/checks/SKILL.md', body],
      [
        'agent',
        'augmnt/agents/api-designer.md',
        'augmnt/agents/api-designer.md',
        body.replace('local-checks', 'local-reviewer'),
      ],
      ['rule', 'abc/abc/abc', 'abc/abc/abc/AGENTS.md', 'Keep public interfaces stable.\n'],
      [
        'mcp',
        'io.example/server',
        'io.example/server',
        JSON.stringify({ transport: 'stdio', command: 'node', args: ['server.js'], env: {} }),
      ],
    ]) {
      await c.write(file, text);
      await c.cli([kind, 'add', source, '--list', '--offline']);
      await c.cli([kind, 'add', source, '--offline']);
      assert.equal((await c.cli([kind, 'list'])).resolved.length, 1);
      assert.equal((await c.list()).lock.dependencies.length, 0);
      const before = await c.read('.agents/etymon.toml');
      for (const missing of ['./missing/source', '~/missing/source']) {
        const result = await c.cli([kind, 'add', missing, '--offline'], { expectedCode: 1 });
        assert.equal(result.error.code, 'SOURCE_NOT_FOUND');
        assert.equal(await c.read('.agents/etymon.toml'), before);
      }
    }
    await c.sync('codex,copilot-cli,opencode');
    await c.idempotent('codex,copilot-cli,opencode');
    assert.match(await c.read('.codex/config.toml'), /server\.js/);
    // Inline MCP settings no longer depend on their imported JSON.
    await c.clear(['io.example/server']);
    await c.idempotent('codex,copilot-cli,opencode');
  },
  async initializedTracking(c) {
    await c.cli(['init']);
    const first = await c.read('.gitignore');
    await c.cli(['init']);
    assert.equal(await c.read('.gitignore'), first);
    assert.match(first, /Existing project ignores/);
    await c.cli([
      'skill',
      'create',
      '--name',
      'checks',
      '--description',
      'Run checks',
      '--body',
      'Run tests.',
    ]);
    await c.cli([
      'agent',
      'create',
      '--name',
      'reviewer',
      '--description',
      'Review changes',
      '--body',
      'Review correctness.',
    ]);
    await c.cli(['mcp', 'create', '--name', 'docs', '--url', 'https://example.com/mcp']);
    await c.cli([
      'rule',
      'create',
      '--name',
      'api',
      '--body',
      'Preserve APIs.',
      '--dest-dir',
      'packages/api',
    ]);
    await c.sync('claude,codex,copilot-cli,opencode');
    await c.idempotent('claude,codex,copilot-cli,opencode');
    await c.write('.github/workflows/ci.yml', 'name: checks\n');
    await c.write('src/index.ts', 'export const value = 1;\n');
    const tracked = (await c.exec('git', ['ls-files', '--others', '--exclude-standard']))
      .trim()
      .split('\n');
    for (const path of [
      '.agents/etymon.toml',
      '.agents/etymon.lock',
      '.agents/etymon/agents/reviewer.json',
      '.agents/etymon/skills/checks/SKILL.md',
      '.agents/etymon/rules/api.md',
      '.github/workflows/ci.yml',
      'src/index.ts',
    ])
      assert(tracked.includes(path), `${path} should be trackable`);
    for (const path of [
      '.mcp.json',
      '.codex/config.toml',
      '.codex/agents/reviewer.toml',
      '.agents/skills/checks/SKILL.md',
      'packages/api/AGENTS.md',
      'packages/api/CLAUDE.md',
      'opencode.json',
      '.github/agents/reviewer.agent.md',
      '.agents/.etymon/state.json',
    ])
      assert(!tracked.includes(path), `${path} should be ignored`);
  },
  async customCreation(c) {
    await c.cli([
      'skill',
      'add',
      '--name',
      'checks',
      '--description',
      'Run checks',
      '--body',
      'Run tests.',
    ]);
    const body = 'Review changes.\n\n    Keep indentation.\n';
    const repository = fileURLToPath(new URL('..', import.meta.url));
    // Pipe the actual CLI's input without making a temporary body file.
    await c.exec(process.execPath, [
      '--input-type=module',
      '-e',
      `import {spawnSync} from 'node:child_process'; const result=spawnSync(process.execPath, ${JSON.stringify([join(repository, 'bin/etymon.js'), '--cwd', c.project, '--home', c.home, '--cache', join(c.directory, 'cache'), '--json', 'agent', 'create', '--name', 'reviewer', '--description', 'Review changes', '--body-file', '-'])}, {input:${JSON.stringify(body)},encoding:'utf8',env:process.env}); process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exit(result.status ?? 1);`,
    ]);
    assert.equal(JSON.parse(await c.read('.agents/etymon/agents/reviewer.json')).prompt, body);
    await c.cli([
      'mcp',
      'add',
      '--name',
      'process',
      '--transport',
      'stdio',
      '--command',
      'node',
      '--arg=server.js',
      '--arg=two words',
      '--env',
      'TOKEN=env:MCP_TOKEN',
      '--server-cwd',
      '.',
    ]);
    await c.cli([
      'mcp',
      'create',
      '--name',
      'web',
      '--url',
      'https://example.com/mcp',
      '--header',
      'Authorization=env:MCP_AUTH',
    ]);
    await c.cli([
      'mcp',
      'create',
      '--name',
      'events',
      '--transport',
      'sse',
      '--url',
      'https://example.com/sse',
    ]);
    await c.cli([
      'rule',
      'create',
      '--name',
      'api',
      '--body',
      'Preserve APIs.',
      '--dest-dir',
      'packages/api',
      '--layout',
      'modular',
    ]);
    const authored = (await c.list()).authored;
    assert.deepEqual(authored.mcp.process.connection.args, ['server.js', 'two words']);
    assert.equal(authored.mcp.process.connection.cwd, '.');
    assert.deepEqual(authored.mcp.web.connection.headers.Authorization, { env: 'MCP_AUTH' });
    assert.equal((await c.list()).lock.dependencies.length, 0);
    const rejected = await c.cli(
      ['skill', 'create', '--name', 'checks', '--description', 'Overwrite', '--body', 'Overwrite'],
      { expectedCode: 1 },
    );
    assert.equal(rejected.error.code, 'LOCAL_NAME_COLLISION');
    const before = await c.read('.agents/etymon.toml');
    const ui = async (mode) => {
      const result = JSON.parse(
        await c.exec('python3', [
          join(repository, 'testcases/tui.py'),
          process.execPath,
          join(repository, 'bin/etymon.js'),
          c.project,
          c.home,
          join(c.directory, 'cache'),
          mode,
        ]),
      );
      assert.equal(result.exitCode, mode.endsWith('cancel') ? 130 : 0);
    };
    await ui('create-agent-cancel');
    await ui('create-rule-cancel');
    assert.equal(await c.read('.agents/etymon.toml'), before);
    await c.write(
      'local-server.json',
      JSON.stringify({ transport: 'stdio', command: 'node', args: [], env: {} }),
    );
    await ui('add-local-mcp');
    await ui('host-add-mcp');
    assert.equal((await c.list()).authored.mcp['local-server'].connection.command, 'node');
    for (const mode of [
      'create-skill',
      'create-agent',
      'create-mcp-stdio',
      'create-mcp-http',
      'create-mcp-sse',
      'create-rule',
      'create-rule-glob',
      'create-rule-modular',
      'create-rule-global',
    ])
      await ui(mode);
    const list = await c.list();
    assert.equal(list.authored.mcp['form-stdio'].connection.transport, 'stdio');
    assert.equal(list.authored.mcp['form-http'].connection.transport, 'streamable-http');
    assert.equal(list.authored.mcp['form-sse'].connection.transport, 'sse');
    assert.deepEqual(list.authored.mcp['form-stdio'].connection.args, ['server.js', 'two words']);
    assert.equal(
      (await c.cli(['agent', 'list'])).resolved.find(
        (resource) => resource.name === 'form-reviewer',
      ).agent.prompt,
      'Review carefully.\n\n    Preserve indentation.',
    );
    const createdRules = (await c.cli(['rule', 'list'])).resolved;
    assert.equal(
      createdRules.find((resource) => resource.name === 'form-rule').rule.base,
      'packages/tui',
    );
    const scoped = createdRules.find((resource) => resource.name === 'form-glob').rule;
    assert.equal(scoped.base, 'packages/tui');
    assert.equal(scoped.activation, 'glob');
    assert.deepEqual(scoped.patterns, ['**/*.ts']);
    assert.equal(
      createdRules.find((resource) => resource.name === 'form-modular').rule.layout,
      'modular',
    );
    const personal = (await c.cli(['rule', 'list', '--global'])).resolved;
    assert.equal(personal.length, 1);
    assert.equal(personal[0].rule.base, '.');
    assert.equal(personal[0].rule.activation, 'always');
    assert.deepEqual(personal[0].rule.patterns, []);
    await c.sync('claude');
    assert.match(await c.read('.claude/rules/form-modular.md'), /packages\/tui\/\*\*/);
    assert.match(await c.read('.claude/rules/api.md'), /packages\/api\/\*\*/);
    await c.idempotent('claude');
    await ui('host-create');
    await ui('host-create-rule');
    assert((await c.list()).authored.skill['host-checks']);
    assert((await c.list()).authored.rule['host-rule']);
    await c.sync('claude');
    await c.idempotent('claude');
  },
  async uninstallFlow(c) {
    const prefix = join(c.directory, 'npm-global');
    const env = { npm_config_prefix: prefix };
    const [{ filename }] = JSON.parse(
      await c.exec(
        'npm',
        [
          'pack',
          './npm-package',
          '--ignore-scripts',
          '--offline',
          '--pack-destination',
          c.directory,
          '--json',
        ],
        { env },
      ),
    );
    const root = (await c.exec('npm', ['root', '--global'], { env })).trim();
    const repository = fileURLToPath(new URL('..', import.meta.url));
    const personalPaths = ['.agents/etymon.toml', '.agents/etymon.lock'];
    const personalExists = async () =>
      Promise.all(
        personalPaths.map(async (path) =>
          fs.access(join(c.home, path)).then(
            () => true,
            () => false,
          ),
        ),
      );
    const install = async () => {
      await c.exec(
        'npm',
        [
          'install',
          '--global',
          '--prefix',
          prefix,
          join(c.directory, filename),
          '--offline',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
        ],
        { env },
      );
      // Run the actual built CLI from the installed package being removed.
      // Dependencies are already available locally; no download or model setup.
      const packageRoot = join(root, 'etymon');
      for (const directory of ['bin', 'dist'])
        await fs.cp(join(repository, directory), join(packageRoot, directory), { recursive: true });
      await fs.symlink(join(repository, 'node_modules'), join(packageRoot, 'node_modules'), 'dir');
      await c.cli(['init']);
      await c.cli(['init', '--global']);
      await fs.writeFile(join(c.home, '.agents/etymon.toml'), 'version = 1\n');
      await c.write('AGENTS.md', 'Project rules stay here.\n');
      await fs.writeFile(join(c.home, '.agents/AGENTS.md'), 'Personal native rules stay here.\n');
    };
    const installed = () =>
      fs.access(join(root, 'etymon/package.json')).then(
        () => true,
        () => false,
      );
    const ui = async (mode) => {
      const script = fileURLToPath(new URL('./tui.py', import.meta.url));
      const executable = join(root, 'etymon/bin/etymon.js');
      return JSON.parse(
        await c.exec(
          'python3',
          [
            script,
            process.execPath,
            executable,
            c.project,
            c.home,
            join(c.directory, 'cache'),
            mode,
          ],
          { env },
        ),
      );
    };
    await install();
    const preview = await c.cli(['uninstall', '--dry-run', '--remove-user-config'], { env });
    assert.equal(preview.installation.path, join(root, 'etymon'));
    assert.equal(preview.personalFiles.length, 2);
    assert.equal(await installed(), true);
    assert.deepEqual(await personalExists(), [true, true]);
    await ui('uninstall-cancel');
    assert.equal(await installed(), true);
    assert.deepEqual(await personalExists(), [true, true]);
    await ui('uninstall-keep');
    assert.equal(await installed(), false);
    assert.deepEqual(await personalExists(), [true, true]);
    await install();
    await ui('uninstall-remove');
    assert.equal(await installed(), false);
    assert.deepEqual(await personalExists(), [false, false]);
    assert.equal(await c.read('AGENTS.md'), 'Project rules stay here.\n');
    assert.match(await c.read('.agents/etymon.lock'), /toolchain/);
    assert.equal(
      await fs.readFile(join(c.home, '.agents/AGENTS.md'), 'utf8'),
      'Personal native rules stay here.\n',
    );
    await install();
    const kept = await c.cli(['uninstall'], { env });
    assert.equal(kept.uninstalled, true);
    assert.deepEqual(kept.removedFiles, []);
    assert.deepEqual(await personalExists(), [true, true]);
    const cleaned = await c.cli(['uninstall', '--remove-user-config'], { env });
    assert.equal(cleaned.uninstalled, false);
    assert.equal(cleaned.removedFiles.length, 2);
    assert.deepEqual(await personalExists(), [false, false]);
  },
  async tuiFlow(c) {
    const script = fileURLToPath(new URL('./tui.py', import.meta.url));
    const executable = fileURLToPath(new URL('../bin/etymon.js', import.meta.url));
    const result = JSON.parse(
      await c.exec('python3', [
        script,
        process.execPath,
        executable,
        c.project,
        c.home,
        join(c.directory, 'cache'),
      ]),
    );
    assert.equal(result.exitCode, 0);
    assert.equal((await rules(c)).style.destDir, 'src');
    await c.sync('codex');
    assert.match(await c.read('src/AGENTS.md'), /Use explicit types/);
  },
  async existingMcp(c) {
    const original = await c.read('opencode.json');
    const preview = await c.cli(['convert', 'opencode', '--dry-run']);
    assert.equal(preview.resources.length, 1);
    await c.cli(['convert', 'opencode']);
    assert.equal((await c.list()).authored.mcp.fixture.connection.transport, 'stdio');
    assert.equal(await c.read('opencode.json'), original);
    await c.sync('claude,codex');
    assert.equal(JSON.parse(await c.read('.mcp.json')).mcpServers.fixture.command, 'node');
    assert.match(await c.read('.codex/config.toml'), /mcp_servers\.fixture/);
    await c.idempotent('claude,codex');
    await c.cli(['convert', 'claude']);
    await c.cli(['convert', 'codex']);
    assert.deepEqual(Object.keys((await c.list()).authored.mcp), ['fixture']);
  },
  async nestedRules(c) {
    const paths = ['AGENTS.md', 'packages/api/AGENTS.md', 'packages/api/src/AGENTS.md'];
    const original = await Promise.all(paths.map((path) => c.read(path)));
    await c.cli(['convert', 'codex']);
    assert.equal(Object.keys(await rules(c)).length, 3);
    assert.deepEqual(
      Object.values(await rules(c))
        .map((rule) => rule.destDir)
        .sort(),
      ['.', 'packages/api', 'packages/api/src'],
    );
    await c.clear(paths);
    await c.restore(paths);
    assert.deepEqual(await Promise.all(paths.map((path) => c.read(path))), original);
    await c.clear(paths);
    await c.sync('codex');
    for (let i = 0; i < paths.length; i++)
      assert((await c.read(paths[i])).includes(original[i].trim()));
    await c.idempotent('codex');
    await c.clear(paths);
    await c.sync('continue');
    const contents = await Promise.all(
      (await fs.readdir(join(c.project, '.continue/rules'))).map((file) =>
        c.read('.continue/rules/' + file),
      ),
    );
    assert.equal(contents.length, 3);
    assert(contents.some((text) => text.includes('packages/api/**')));
    assert(contents.some((text) => text.includes('packages/api/src/**')));
    await c.idempotent('continue');
    const rejected = await c.cli(['sync', '--harness', 'zed', '--dry-run'], { expectedCode: 1 });
    assert(rejected.diagnostics.some((d) => d.code === 'RULE_SCOPE_UNSUPPORTED'));
    assert.deepEqual(rejected.changes, []);
  },
  async lockedSkill(c) {
    const source = join(c.project, 'source');
    await c.exec('git', ['init', '-q'], { cwd: source });
    await c.gitCommit(source);
    await c.cli(['skill', 'add', 'git+file://' + source, '--skill', 'fixture-checks']);
    const lock = (await c.list()).lock,
      dependency = lock.dependencies[0];
    assert.equal(dependency.kind, 'skill');
    assert.match(dependency.resolved.commit, /^[a-f0-9]{40}$/);
    assert.equal(dependency.resolved.skillsCli, lock.toolchain.skills);
    assert.match(dependency.artifacts[0].digest, /^sha256:[a-f0-9]{64}$/);
    const before = await lockText(c);
    await c.sync('codex,copilot-cli');
    for (const root of ['.agents/skills', '.github/skills'])
      assert.match(
        await c.read(root + '/fixture-checks/assets/checks.txt'),
        /ETYMON_FIXTURE_ASSET_v1/,
      );
    await c.cli(['convert', 'codex']);
    await c.cli(['convert', 'copilot-cli']);
    assert.equal((await c.cli(['skill', 'list'])).resolved.length, 1);
    await c.clear(['.agents/skills/fixture-checks', '.github/skills/fixture-checks']);
    await c.cli(['sync', '--harness', 'codex,copilot-cli', '--offline', '--locked']);
    assert.equal(await lockText(c), before);
    await c.idempotent('codex,copilot-cli');
  },
  async registryMcp(c) {
    if (c.options.skipRegistry)
      return { skip: 'localhost sockets unavailable; registry scenario explicitly excluded' };
    const payload = JSON.parse(await c.read('registry.json'));
    const searches = [];
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/v0.1/servers') {
        searches.push(Object.fromEntries(url.searchParams));
        res.end(JSON.stringify({ servers: [payload], metadata: { nextCursor: 'next' } }));
        return;
      }
      assert.match(req.url, /^\/v0\.1\/servers\//);
      res.end(JSON.stringify(payload));
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      for (const command of ['find', 'search']) {
        const found = await c.cli([
          'mcp',
          command,
          'local fixture',
          '--registry',
          `http://127.0.0.1:${server.address().port}`,
          '--cursor',
          'current',
          '--limit',
          '3',
        ]);
        assert.equal(found.servers[0].name, payload.server.name);
        assert.equal(found.nextCursor, 'next');
      }
      assert.deepEqual(
        searches,
        Array(2).fill({
          search: 'local fixture',
          version: 'latest',
          limit: '3',
          cursor: 'current',
        }),
      );
      await c.cli([
        'mcp',
        'add',
        payload.server.name,
        '--registry',
        `http://127.0.0.1:${server.address().port}`,
        '--remote',
        '0',
      ]);
      const dependency = (await c.list()).lock.dependencies[0];
      assert.equal(dependency.kind, 'mcp');
      assert.equal(dependency.resolved.version, '1.2.3');
      assert.match(dependency.artifacts[0].digest, /^sha256:[a-f0-9]{64}$/);
      const locked = await lockText(c);
      await c.sync('copilot-cli');
      const config = await c.read('.github/mcp.json');
      await c.cli(['convert', 'copilot-cli']);
      await c.idempotent('copilot-cli');
      assert.equal(await c.read('.github/mcp.json'), config);
      assert.equal(await lockText(c), locked);
      await c.sync('pi');
      assert.match(await c.read('.pi/mcp.json'), /https:\/\/example\.invalid\/mcp/);
      await c.idempotent('copilot-cli,pi');
      const noNative = await c.cli(['convert', 'pi']);
      assert.equal(noNative.resources.length, 0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    await c.cli(['sync', '--harness', 'copilot-cli', '--offline', '--locked']);
  },
  async dedupAliases(c) {
    await c.cli(['convert', 'claude']);
    await c.cli(['convert', 'codex']);
    const authored = (await c.list()).authored;
    assert.equal(Object.keys(authored.rule).length, 1);
    assert.equal(Object.keys(authored.skill).length, 1);
    assert.equal(authored.rule.instructions.origins.length, 2);
    assert.equal(authored.skill['fixture-checks'].origins.length, 2);
    await c.sync('claude,codex', ['--adopt']);
    await c.idempotent('claude,codex');
    assert.equal(await c.read('CLAUDE.md'), '@AGENTS.md\n');
  },
  async globalRules(c) {
    const args = ['--global'];
    await c.cli(['rule', 'add', './personal.md', ...args]);
    await c.cli(['sync', '--harness', 'claude,codex', ...args]);
    assert.match(
      await fs.readFile(join(c.home, '.claude/CLAUDE.md'), 'utf8'),
      /Keep responses concise/,
    );
    assert.match(
      await fs.readFile(join(c.home, '.codex/AGENTS.md'), 'utf8'),
      /Keep responses concise/,
    );
    const rejected = await c.cli(['rule', 'add', './.claude/rules/scoped.md', ...args], {
      expectedCode: 1,
    });
    assert.equal(rejected.error.code, 'GLOBAL_RULE_SCOPE_UNSUPPORTED');
    await fs.mkdir(join(c.home, '.claude/rules'), { recursive: true });
    await fs.copyFile(
      join(c.project, '.claude/rules/scoped.md'),
      join(c.home, '.claude/rules/scoped.md'),
    );
    await c.cli(['convert', 'claude', ...args]);
    assert.equal(Object.keys((await c.cli(['list', ...args])).authored.rule).length, 1);
    const cursor = await c.cli(['sync', '--harness', 'cursor', ...args], { expectedCode: 1 });
    assert.equal(cursor.error.code, 'PLAN_BLOCKED');
    assert(cursor.error.details.some((d) => d.code === 'RULE_SCOPE_UNSUPPORTED'));
  },
  async conditionalRules(c) {
    await c.cli(['convert', 'cursor']);
    await c.sync('claude,copilot-cli');
    assert.match(await c.read('.claude/rules/types.md'), /src\/\*\*\/\*\.\{ts,tsx\}/);
    assert.match(await c.read('.github/instructions/types.instructions.md'), /applyTo:/);
    await c.idempotent('claude,copilot-cli');
    const blocked = await c.cli(['sync', '--harness', 'codex'], {
      expectedCode: 1,
    });
    assert.equal(blocked.error.code, 'PLAN_BLOCKED');
    assert(blocked.error.details.some((d) => d.code === 'RULE_SCOPE_UNSUPPORTED'));
    const source = await c.read('.agents/etymon/rules/types.md');
    const lossy = await c.sync('codex', ['--allow-lossy']);
    assert(
      lossy.diagnostics.some(
        (d) => d.code === 'RULE_CONDITIONS_DROPPED' && d.severity === 'warning',
      ),
    );
    assert.match(await c.read('AGENTS.md'), /Use explicit types/);
    assert.equal(await c.read('.agents/etymon/rules/types.md'), source);
    await c.idempotent('codex', ['--allow-lossy']);
  },
  async sharedRemoval(c) {
    await c.cli(['rule', 'add', './checks.md']);
    await c.cli(['rule', 'add', './style.md']);
    await c.sync('codex,cursor');
    await c.cli(['rule', 'remove', 'checks']);
    const text = await c.read('AGENTS.md');
    assert.match(text, /Prefer explicit types/);
    assert(!text.includes('Run checks before'));
    await c.write('AGENTS.md', text + '\nManual edit.\n');
    const blocked = await c.cli(['rule', 'remove', 'style'], { expectedCode: 1 });
    assert.equal(blocked.error.code, 'PLAN_BLOCKED');
    assert((await rules(c)).style);
  },
  async nativeLoaders(c) {
    if (!c.options.native.length)
      return { skip: 'enable installed loaders with --native codex,opencode,copilot,claude' };
    await c.cli(['convert', 'codex']);
    await c.cli(['skill', 'add', './source/fixture-checks']);
    await c.write(
      'source/fixture.json',
      JSON.stringify({
        transport: 'stdio',
        command: process.execPath,
        args: [join(c.project, 'source/fixture-server.mjs')],
        env: {},
      }),
    );
    await c.cli(['mcp', 'add', './source/fixture.json']);
    for (const target of c.options.native) {
      const authored = (await c.list()).authored;
      if (target === 'pi' && authored.agent['fixture-reviewer'])
        await c.cli(['agent', 'remove', 'fixture-reviewer']);
      else if (target !== 'pi' && !authored.agent['fixture-reviewer'])
        await c.cli(['agent', 'add', './source/fixture-reviewer.md']);
      const harness = target === 'copilot' ? 'copilot-cli' : target;
      await c.sync(harness, ['--adopt']);
      await c.idempotent(harness);
      await nativeChecks[target](c);
    }
  },
  async nativeConditions(c) {
    await c.cli(['convert', 'continue']);
    await c.sync('continue', ['--adopt']);
    await c.idempotent('continue');
    assert.match(await c.read('.continue/rules/compound.md'), /regex: TODO/);
    const blocked = await c.cli(['sync', '--harness', 'cursor', '--dry-run'], {
      expectedCode: 1,
    });
    assert(blocked.diagnostics.some((d) => d.code === 'RULE_NATIVE_FIELDS_BLOCKED'));
    assert.deepEqual(blocked.changes, []);
    const source = await c.read('.agents/etymon/rules/compound.md');
    const lossy = await c.sync('cursor', ['--allow-lossy']);
    assert(
      lossy.diagnostics.some(
        (d) => d.code === 'RULE_NATIVE_FIELDS_OMITTED' && d.severity === 'warning',
      ),
    );
    assert.match(await c.read('.cursor/rules/compound.mdc'), /TODO/);
    assert.equal(await c.read('.agents/etymon/rules/compound.md'), source);
    await c.idempotent('cursor', ['--allow-lossy']);
  },
  async relocatedRules(c) {
    await c.cli(['rule', 'add', './style.md', '--dest-dir', 'packages/api']);
    await c.sync('codex');
    assert.match(await c.read('packages/api/AGENTS.md'), /Use explicit types/);
    const path = '.agents/etymon.toml';
    await c.write(
      path,
      (await c.read(path)).replace('destDir = "packages/api"', 'destDir = "packages/web"'),
    );
    await c.sync('codex');
    await assert.rejects(c.read('packages/api/AGENTS.md'), { code: 'ENOENT' });
    assert.match(await c.read('packages/web/AGENTS.md'), /Use explicit types/);
    await c.idempotent('codex');
    await c.clear(['style.md']);
    assert.equal((await c.cli(['rule', 'list'])).resolved[0].rule.base, 'packages/web');
  },
  async lockedAgent(c) {
    const source = join(c.project, 'source');
    await c.exec('git', ['init', '-q'], { cwd: source });
    await c.gitCommit(source);
    await c.cli(['agent', 'add', 'git+file://' + source]);
    const original = await lockText(c),
      dependency = (await c.list()).lock.dependencies[0];
    assert.equal(dependency.kind, 'agent');
    assert.match(dependency.resolved.commit, /^[a-f0-9]{40}$/);
    await c.write(
      'source/reviewer.md',
      (await c.read('source/reviewer.md')).replace('Original prompt.', 'Updated prompt.'),
    );
    await c.gitCommit(source);
    await c.cli(['sync', '--harness', 'codex,opencode,copilot-cli', '--offline']);
    assert.match(await c.read('.codex/agents/reviewer.toml'), /Original prompt/);
    assert.equal(await lockText(c), original);
    await c.cli(['update']);
    assert.notEqual(await lockText(c), original);
    await c.sync('codex,opencode,copilot-cli');
    assert.match(await c.read('.opencode/agents/reviewer.md'), /Updated prompt/);
    await c.cli(['agent', 'remove', 'reviewer']);
    assert.equal((await c.list()).lock.dependencies.length, 0);
  },
  async conflictingSkills(c) {
    const result = await c.cli(['convert', 'codex'], { expectedCode: 1 });
    assert.equal(result.error.code, 'IMPORT_COLLISION');
    await assert.rejects(c.read('.agents/etymon.toml'), { code: 'ENOENT' });
    assert.equal(await c.read('.agents/skills/checks/assets/data.txt'), 'shared\n');
    assert.equal(await c.read('.codex/skills/checks/assets/data.txt'), 'different\n');
  },
  async configAndSecrets(c) {
    const original = await c.read('opencode.jsonc');
    await c.cli(['convert', 'opencode']);
    const manifest = await c.read('.agents/etymon.toml');
    assert(!manifest.includes('fixture-secret'));
    assert.match(manifest, /SERVICE_TOKEN/);
    assert.equal(await c.read('opencode.jsonc'), original);
    await c.sync('codex,claude');
    assert(!(await c.read('.codex/config.toml')).includes('fixture-secret'));
    const runtime = await fs.readdir(join(c.project, '.agents/.etymon/runtime/mcp'));
    assert.match(await c.read('.agents/.etymon/runtime/mcp/' + runtime[0]), /ETYMON_SERVICE_TOKEN/);
    await c.sync('opencode', ['--adopt']);
    assert.match(await c.read('opencode.jsonc'), /User comment/);
    assert.match(await c.read('opencode.jsonc'), /my-theme/);
    await c.idempotent('opencode');
  },
  async harnessMatrix(c) {
    await c.cli(['rule', 'add', './checks.md']);
    const harnesses = await c.cli(['harnesses']);
    const targets = harnesses.map((harness) => harness.id).join(',');
    assert.equal(harnesses.length, 19);
    await c.sync(targets);
    await c.idempotent(targets);
    assert.match(await c.read('AGENTS.md'), /Run checks/);
    assert.match(await c.read('.continue/rules/checks.md'), /alwaysApply: true/);
    assert(
      JSON.parse(await c.read('.gemini/settings.json')).context.fileName.includes('AGENTS.md'),
    );
  },
};
