import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handlers } from './scenarios.mjs';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2),
  selected = [],
  options = { native: [] };
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  const value = () => {
    const next = args[++i];
    assert(next && !next.startsWith('--'), `${arg} requires a value`);
    return next;
  };
  if (/^\d+$/.test(arg)) selected.push(arg);
  else if (arg === '--keep') options.keep = true;
  else if (arg === '--skip-registry') options.skipRegistry = true;
  else if (arg === '--report-dir') options.reportDir = resolve(value());
  else if (arg === '--skills-cli') options.skillsCli = resolve(value());
  else if (arg === '--native') options.native = value().split(',').filter(Boolean);
  else if (arg === '--help') {
    console.log(
      'Usage: ./test_harness.sh [scenario numbers] [--native codex,opencode,copilot,claude,gemini,pi,kilo] [--keep] [--report-dir path] [--skills-cli path] [--skip-registry]',
    );
    process.exit(0);
  } else throw new Error(`Unknown argument: ${arg}`);
}
for (const target of options.native)
  assert(
    ['codex', 'opencode', 'copilot', 'claude', 'gemini', 'pi', 'kilo'].includes(target),
    `Unknown native target ${target}`,
  );
const sandbox = await fs.mkdtemp(join(tmpdir(), 'etymon-scenarios-'));
const reports = [];
const childEnv = (home) => ({
  PATH: process.env.PATH,
  ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  HOME: home,
  USERPROFILE: home,
  XDG_CONFIG_HOME: join(home, '.config'),
  XDG_DATA_HOME: join(home, '.local/share'),
  XDG_CACHE_HOME: join(home, '.cache'),
  XDG_STATE_HOME: join(home, '.local/state'),
  CODEX_HOME: join(home, '.codex'),
  CLAUDE_CONFIG_DIR: join(home, '.claude'),
  COPILOT_HOME: join(home, '.copilot'),
  OPENCODE_DISABLE_AUTOUPDATE: 'true',
  OPENCODE_DISABLE_MODELS_FETCH: 'true',
  OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true',
  DISABLE_TELEMETRY: '1',
  DO_NOT_TRACK: '1',
  CI: '1',
  NO_COLOR: '1',
  npm_config_cache: join(sandbox, 'npm-cache'),
  ...(process.env.NODE_V8_COVERAGE ? { NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE } : {}),
  PI_CODING_AGENT_DIR: join(home, '.pi/agent'),
  KILO_DISABLE_AUTOUPDATE: 'true',
  KILO_DISABLE_MODELS_FETCH: 'true',
  KILO_DISABLE_DEFAULT_PLUGINS: 'true',
});
async function execute(command, argv, cwd, env, timeout = 45000) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '',
      stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1000).unref();
      reject(new Error(`${command} timed out`));
    }, timeout);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 8e6) child.kill();
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-100000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveResult({ code, stdout, stderr });
    });
  });
}
try {
  const numbers = (await fs.readdir(join(repo, 'testcases')))
    .filter((name) => /^\d+$/.test(name))
    .sort((a, b) => Number(a) - Number(b));
  for (const number of selected) assert(numbers.includes(number), `No scenario ${number}`);
  for (const number of numbers.filter((number) => !selected.length || selected.includes(number))) {
    const source = join(repo, 'testcases', number),
      metadata = JSON.parse(await fs.readFile(join(source, 'scenario.json'), 'utf8'));
    const directory = join(sandbox, number),
      project = join(directory, 'project'),
      home = join(directory, 'home'),
      transcript = [];
    await fs.mkdir(home, { recursive: true });
    await fs.cp(source, project, {
      recursive: true,
      filter: (path) => !['scenario.json', 'README.md'].includes(path.split('/').at(-1)),
    });
    const env = childEnv(home);
    if (options.skillsCli) {
      const shim = join(directory, 'bin');
      await fs.mkdir(shim);
      // This executes the real preinstalled skills CLI, never a staged fake.
      const text = `#!${process.execPath}\nimport { spawnSync } from 'node:child_process';\nconst args = process.argv.slice(2);\nif (args[0] !== '--yes' || args[1] !== 'skills@1.7.0') process.exit(64);\nconst result = spawnSync(process.execPath, [${JSON.stringify(options.skillsCli)}, ...args.slice(2)], {stdio:'inherit',env:process.env});\nprocess.exit(result.status ?? 1);\n`;
      await fs.writeFile(join(shim, 'npx'), text, { mode: 0o755 });
      env.PATH = shim + ':' + env.PATH;
    }
    const context = {
      number,
      directory,
      project,
      home,
      options,
      env,
      transcript,
      async exec(command, argv, settings = {}) {
        const result = await execute(
          command,
          argv,
          settings.cwd ?? project,
          { ...env, ...settings.env },
          settings.timeout,
        );
        transcript.push({ command, args: argv, ...result });
        assert.equal(
          result.code,
          settings.expectedCode ?? 0,
          `${command} ${argv.join(' ')}\n${result.stderr}\n${result.stdout}`,
        );
        return settings.combineOutput ? result.stdout + '\n' + result.stderr : result.stdout;
      },
      async cli(argv, settings = {}) {
        const text = await context.exec(
          process.execPath,
          [
            join(repo, 'bin/etymon.js'),
            '--cwd',
            project,
            '--home',
            home,
            '--cache',
            join(directory, 'cache'),
            '--json',
            '--yes',
            ...argv,
          ],
          settings,
        );
        return JSON.parse(text);
      },
      async read(path) {
        return fs.readFile(join(project, path), 'utf8');
      },
      async write(path, text) {
        const full = join(project, path);
        await fs.mkdir(dirname(full), { recursive: true });
        await fs.writeFile(full, text);
      },
      async clear(paths) {
        for (const path of paths)
          await fs.rm(join(project, path), { recursive: true, force: true });
      },
      async restore(paths) {
        await context.exec('git', ['restore', '--source=HEAD', '--', ...paths]);
      },
      async list() {
        return context.cli(['list']);
      },
      async sync(targets, extra = []) {
        return context.cli(['sync', '--harness', targets, ...extra]);
      },
      async idempotent(targets) {
        const plan = await context.sync(targets);
        assert.deepEqual(plan.changes, [], 'Repeated sync changed native files');
      },
      async gitCommit(cwd = project) {
        await context.exec('git', ['add', '.'], { cwd });
        await context.exec(
          'git',
          [
            '-c',
            'user.name=Etymon Fixture',
            '-c',
            'user.email=fixture@example.invalid',
            'commit',
            '-qm',
            'fixture baseline',
          ],
          { cwd },
        );
      },
    };
    const report = { number, title: metadata.title, status: 'passed' };
    try {
      await context.exec('git', ['init', '-q']);
      await context.gitCommit();
      const result = await handlers[metadata.handler](context);
      if (result?.skip) {
        report.status = 'skipped';
        report.reason = result.skip;
      }
      console.log(
        `${report.status.toUpperCase()} ${number}: ${metadata.title}${report.reason ? ' (' + report.reason + ')' : ''}`,
      );
    } catch (error) {
      report.status = 'failed';
      report.reason = error.stack ?? String(error);
      process.exitCode = 1;
      console.error(`FAILED ${number}: ${metadata.title}\n${report.reason}`);
    }
    reports.push(report);
    await fs.writeFile(
      join(directory, 'transcript.json'),
      JSON.stringify(transcript, null, 2) + '\n',
    );
    await fs.writeFile(join(directory, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  }
} finally {
  const summary = {
    native: options.native,
    scenarios: reports,
    passed: reports.filter((r) => r.status === 'passed').length,
    failed: reports.filter((r) => r.status === 'failed').length,
    skipped: reports.filter((r) => r.status === 'skipped').length,
  };
  await fs.writeFile(join(sandbox, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  if (options.reportDir) {
    await fs.mkdir(options.reportDir, { recursive: true });
    await fs.cp(sandbox, options.reportDir, { recursive: true });
  }
  if (options.keep || summary.failed) console.log(`Scenario workspace: ${sandbox}`);
  else await fs.rm(sandbox, { recursive: true, force: true });
  console.log(`${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped.`);
}
