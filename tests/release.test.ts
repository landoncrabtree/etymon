import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { nextVersion } from '../scripts/release.mjs';

const directories: string[] = [];
afterEach(async () => {
  for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'etymon-release-test-')));
  directories.push(root);
  await fs.mkdir(join(root, 'scripts'));
  const fakeBin = join(root, 'fake-bin');
  await fs.mkdir(fakeBin);
  for (const name of ['release.mjs', 'npm_build.sh', 'npm_publish'])
    await fs.copyFile(resolve('scripts', name), join(root, 'scripts', name));
  const pkg = { name: 'etymon', version: '0.1.0', type: 'module' };
  await fs.writeFile(join(root, 'package.json'), JSON.stringify(pkg));
  await fs.writeFile(
    join(root, 'package-lock.json'),
    JSON.stringify({ version: pkg.version, packages: { '': pkg } }),
  );
  // Stub npm in an isolated PATH. Tests never authenticate or publish to a registry.
  await fs.writeFile(
    join(fakeBin, 'npm'),
    `#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const args = process.argv.slice(2), root = process.cwd();
appendFileSync(join(root, 'commands.jsonl'), JSON.stringify(args) + '\\n');
if (args[0] === 'view') {
  if (process.env.FAKE_NPM_ERROR) { console.log(JSON.stringify({ error: { code: process.env.FAKE_NPM_ERROR } })); process.exit(1); }
  console.log(process.env.FAKE_NPM_VERSIONS);
} else if (args[0] === 'run') {
  if (process.env.FAKE_CHECK_FAILURE) process.exit(1);
} else if (args[0] === 'version') {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  pkg.version = lock.version = lock.packages[''].version = args[1];
  writeFileSync('package.json', JSON.stringify(pkg)); writeFileSync('package-lock.json', JSON.stringify(lock));
} else if (args[0] === 'pack') {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')), filename = 'etymon-' + pkg.version + '.tgz';
  const stage = join(root, 'packed'); mkdirSync(join(stage, 'package'), { recursive: true });
  writeFileSync(join(stage, 'package', 'package.json'), JSON.stringify(pkg));
  execFileSync('tar', ['-czf', join(root, filename), '-C', stage, 'package']);
  console.log(JSON.stringify([{ name: pkg.name, version: pkg.version, filename }]));
} else if (args[0] === 'publish') {
  if (!args.includes('--dry-run')) throw new Error('Tests only preview publication');
} else throw new Error('Unexpected npm command');
`,
    { mode: 0o755 },
  );
  const invoke = (script: string, args: string[] = [], extra: Record<string, string> = {}) =>
    spawnSync('bash', [join(root, 'scripts', script), ...args], {
      cwd: root,
      env: {
        ...process.env,
        PATH: fakeBin + ':' + process.env.PATH,
        FAKE_NPM_VERSIONS: JSON.stringify(['0.1.0']),
        ...extra,
      },
      encoding: 'utf8',
      timeout: 20000,
    });
  const commands = async () =>
    (await fs.readFile(join(root, 'commands.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  return { root, invoke, commands };
}

describe('npm release workflow', () => {
  it('increments the highest published stable version and reuses pending local releases', () => {
    const published = ['0.1.2', '0.1.0', '2.0.0-beta.1', '0.1.1'];
    expect(nextVersion('0.1.0', published)).toBe('0.1.3');
    expect(nextVersion('0.1.3', published)).toBe('0.1.3');
    expect(nextVersion('0.1.0', published, 'minor')).toBe('0.2.0');
    expect(nextVersion('0.2.0', published, 'minor')).toBe('0.2.0');
    expect(nextVersion('0.1.0', published, 'major')).toBe('1.0.0');
    expect(nextVersion('0.1.0', [])).toBe('0.1.0');
    expect(() => nextVersion('1.0.0-beta.1', published)).toThrow(/stable/);
  });
  it('builds and previews the exact tarball with synchronized metadata and no extra bumps', async () => {
    const { root, invoke, commands } = await fixture();
    const built = invoke('npm_build.sh');
    expect(built.status, built.stderr).toBe(0);
    expect(built.stdout).toContain('etymon-0.1.1.tgz');
    const lock = JSON.parse(await fs.readFile(join(root, 'package-lock.json'), 'utf8'));
    expect(lock.version).toBe('0.1.1');
    expect(lock.packages[''].version).toBe('0.1.1');
    const second = invoke('npm_build.sh');
    expect(second.status, second.stderr).toBe(0);
    expect((await commands()).filter((args) => args[0] === 'version')).toHaveLength(1);
    const preview = invoke('npm_publish', ['--dry-run']);
    expect(preview.status, preview.stderr).toBe(0);
    const recorded = await commands();
    expect(recorded.filter((args) => args[0] === 'publish')[0]).toEqual([
      'publish',
      join(root, 'etymon-0.1.1.tgz'),
      '--access',
      'public',
      '--tag',
      'latest',
      '--registry',
      'https://registry.npmjs.org/',
      '--dry-run',
    ]);
    expect(recorded.find((args) => args[0] === 'version')).toContain('--no-git-tag-version');
    expect(await fs.readdir(root)).not.toContain('.npm-release.lock');
  }, 30000);
  it('refuses published versions and mismatched archives without rebuilding', async () => {
    const { root, invoke, commands } = await fixture();
    expect(invoke('npm_build.sh').status).toBe(0);
    const duplicate = invoke('npm_publish', ['--dry-run'], {
      FAKE_NPM_VERSIONS: JSON.stringify(['0.1.0', '0.1.1']),
    });
    expect(duplicate.status).toBe(1);
    expect(duplicate.stderr).toContain('already published');
    await fs.writeFile(
      join(root, 'package.json'),
      JSON.stringify({ name: 'etymon', version: '0.1.2' }),
    );
    const mismatched = invoke('npm_publish', ['etymon-0.1.1.tgz', '--dry-run']);
    expect(mismatched.status).toBe(1);
    expect(mismatched.stderr).toContain('differs from package.json');
    expect((await commands()).some((args) => args[0] === 'publish')).toBe(false);
    expect((await commands()).filter((args) => args[0] === 'run')).toHaveLength(1);
  }, 30000);
  it('fails closed on registry and check errors before changing versions or packing', async () => {
    const { root, invoke, commands } = await fixture();
    expect(invoke('npm_build.sh', [], { FAKE_NPM_ERROR: 'ENOTFOUND' }).status).toBe(1);
    expect(invoke('npm_build.sh', [], { FAKE_CHECK_FAILURE: '1' }).status).toBe(1);
    expect(JSON.parse(await fs.readFile(join(root, 'package.json'), 'utf8')).version).toBe('0.1.0');
    expect(
      (await commands()).some((args) => ['version', 'pack', 'publish'].includes(args[0])),
    ).toBe(false);
    expect(await fs.readdir(root)).not.toContain('.npm-release.lock');
  }, 30000);
});
