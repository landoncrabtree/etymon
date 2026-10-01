import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeChecks } from './native.mjs';

const rules = async (c) => (await c.list()).authored.rule;
const lockText = (c) => c.read('.agents/etymon.lock');
export const handlers = {
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
    assert.equal(await c.read('.agents/etymon.toml'), before);
    for (const mode of [
      'create-skill',
      'create-agent',
      'create-mcp-stdio',
      'create-mcp-http',
      'create-mcp-sse',
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
    await c.sync('claude');
    await c.idempotent('claude');
    await ui('host-create');
    assert((await c.list()).authored.skill['host-checks']);
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
    const server = createServer((req, res) => {
      assert.match(req.url, /^\/v0\.1\/servers\//);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload));
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
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
    const blocked = await c.cli(['sync', '--harness', 'codex', '--allow-lossy'], {
      expectedCode: 1,
    });
    assert.equal(blocked.error.code, 'PLAN_BLOCKED');
    assert(blocked.error.details.some((d) => d.code === 'RULE_SCOPE_UNSUPPORTED'));
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
    const blocked = await c.cli(['sync', '--harness', 'cursor', '--allow-lossy', '--dry-run'], {
      expectedCode: 1,
    });
    assert(blocked.diagnostics.some((d) => d.code === 'RULE_NATIVE_FIELDS_BLOCKED'));
    assert.deepEqual(blocked.changes, []);
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
