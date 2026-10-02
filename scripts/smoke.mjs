import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const root = await mkdtemp(join(tmpdir(), 'etymon-pack-test-'));
const repo = process.cwd();
const extracted = process.argv.includes('--offline-extracted');
const packageVersion = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8')).version;
const run = (command, args, cwd = repo) =>
  execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000,
    maxBuffer: 2e6,
    env: { ...process.env, npm_config_cache: join(root, 'npm-cache') },
  });
try {
  run(npm, ['run', 'build']);
  const [{ filename, files }] = JSON.parse(
    run(npm, ['pack', '--ignore-scripts', '--pack-destination', root, '--json']),
  );
  assert(files.some((f) => f.path === 'bin/etymon.js'));
  assert(files.some((f) => f.path === 'docs/ARCHITECTURE.md'));
  assert(!files.some((f) => f.path.startsWith('tests/') || f.path.startsWith('node_modules/')));
  const tarball = join(root, filename),
    project = join(root, 'project');
  await mkdir(project);
  if (extracted) {
    run('tar', ['-xzf', tarball, '-C', root]);
    await symlink(join(repo, 'node_modules'), join(root, 'package/node_modules'), 'dir');
  }
  const etymon = (args) =>
    extracted
      ? run(
          process.execPath,
          [join(root, 'package/bin/etymon.js'), '--home', join(root, 'home'), ...args],
          project,
        )
      : run(
          npm,
          [
            'exec',
            '--yes',
            '--package',
            tarball,
            '--',
            'etymon',
            '--home',
            join(root, 'home'),
            ...args,
          ],
          project,
        );
  assert.equal(etymon(['--version']).trim(), packageVersion);
  JSON.parse(etymon(['init', '--json']));
  await writeFile(
    join(project, 'reviewer.md'),
    '---\nname: reviewer\ndescription: Review changes\n---\nFind correctness issues.\n',
  );
  JSON.parse(etymon(['agent', 'add', './reviewer.md', '--json']));
  await writeFile(
    join(project, 'docs.json'),
    JSON.stringify({ transport: 'streamable-http', url: 'https://example.com/mcp', headers: {} }),
  );
  JSON.parse(etymon(['mcp', 'add', './docs.json', '--json']));
  await writeFile(join(project, 'guidance.md'), 'Keep public interfaces stable.\n');
  JSON.parse(etymon(['rules', 'add', './guidance.md', '--dest-dir', 'src', '--json']));
  await rm(join(project, 'guidance.md'));
  const manifest = await readFile(join(project, '.agents/etymon.toml'), 'utf8');
  assert(manifest.includes('[mcp.docs.connection]'));
  assert(!manifest.includes('docs.json'));
  await rm(join(project, 'docs.json'));
  const plan = JSON.parse(etymon(['sync', '--harness', 'codex,opencode', '--dry-run', '--json']));
  assert.equal(plan.changes.length, 5);
  JSON.parse(etymon(['sync', '--harness', 'codex,opencode', '--json']));
  assert(
    (await readFile(join(project, '.codex/agents/reviewer.toml'), 'utf8')).includes(
      'developer_instructions',
    ),
  );
  assert(
    (await readFile(join(project, 'src/AGENTS.md'), 'utf8')).includes(
      'Keep public interfaces stable.',
    ),
  );
  assert.equal(
    JSON.parse(etymon(['sync', '--harness', 'codex,opencode', '--json'])).changes.length,
    0,
  );
  assert.equal(JSON.parse(etymon(['doctor', '--harness', 'codex,opencode', '--json'])).ok, true);
  JSON.parse(
    etymon([
      'commands',
      'create',
      '--name',
      'checks',
      '--description',
      'Run checks',
      '--body',
      'Run project tests.',
      '--json',
    ]),
  );
  JSON.parse(etymon(['sync', '--harness', 'codex', '--json']));
  assert.match(
    await readFile(join(project, '.agents/skills/checks/agents/openai.yaml'), 'utf8'),
    /allow_implicit_invocation: false/,
  );
  const commands = JSON.parse(etymon(['command', 'list', '--json']));
  assert(
    commands.resolved.some((resource) => resource.name === 'checks' && resource.kind === 'skill'),
  );
  JSON.parse(etymon(['commands', 'remove', 'checks', '--json']));
  console.log(
    `Packed ${extracted ? 'extracted execution (existing dependencies)' : 'npx execution'} passed: init → agent + inline MCP + nested rule → native sync → doctor → command skill creation/removal.`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
