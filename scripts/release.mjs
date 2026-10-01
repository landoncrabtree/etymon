import { spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const registry = 'https://registry.npmjs.org/';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const usage = `Usage:
  scripts/npm_build.sh [patch|minor|major]
  scripts/npm_publish [tarball.tgz] [--dry-run]

Build checks npm's published versions, chooses the next stable release, runs
checks, updates package.json/package-lock.json, and creates a tarball.
An unpublished higher local version is reused. Publish never builds or bumps.`;

function stableParts(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) return undefined;
  const parts = version.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : undefined;
}
function compare(a, b) {
  const left = stableParts(a),
    right = stableParts(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
export function nextVersion(local, published, bump = 'patch') {
  if (!stableParts(local))
    throw new Error('Release scripts require a stable major.minor.patch local version.');
  if (!['patch', 'minor', 'major'].includes(bump))
    throw new Error('Choose patch, minor, or major.');
  const stable = published.filter((version) => stableParts(version)).sort(compare);
  const latest = stable.at(-1);
  if (!latest) return local;
  const parts = stableParts(latest);
  const index = { major: 0, minor: 1, patch: 2 }[bump];
  parts[index]++;
  for (let i = index + 1; i < 3; i++) parts[i] = 0;
  if (!parts.every(Number.isSafeInteger)) throw new Error('Version exceeds safe numeric limits.');
  const candidate = parts.join('.');
  return compare(local, candidate) > 0 ? local : candidate;
}
function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    ...(capture ? { timeout: 30000 } : {}),
  });
  if (result.error) throw result.error;
  return result;
}
function requireSuccess(result, action) {
  if (result.status !== 0)
    throw new Error(`${action} failed${result.stderr ? `:\n${result.stderr.trim()}` : '.'}`);
}
function publishedVersions(name) {
  const result = run(
    npm,
    [
      'view',
      name,
      'versions',
      '--json',
      '--registry',
      registry,
      '--fetch-retries=0',
      '--fetch-timeout=15000',
    ],
    true,
  );
  let data;
  try {
    data = JSON.parse(result.stdout);
  } catch {
    /* npm errors can have no JSON output */
  }
  if (result.status !== 0 && data?.error?.code === 'E404') return [];
  requireSuccess(result, 'Reading npm published versions');
  if (typeof data === 'string') data = [data];
  if (!Array.isArray(data) || data.some((version) => typeof version !== 'string'))
    throw new Error('Unexpected npm versions response.');
  return data;
}
function metadata() {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
}
function build(pkg, args) {
  const bump = args[0] ?? 'patch';
  if (args.length > 1 || !['patch', 'minor', 'major'].includes(bump)) throw new Error(usage);
  const version = nextVersion(pkg.version, publishedVersions(pkg.name), bump);
  console.log(`Preparing ${pkg.name}@${version}`);
  requireSuccess(run(npm, ['run', 'check']), 'Release checks');
  if (version !== pkg.version)
    requireSuccess(
      run(npm, ['version', version, '--no-git-tag-version', '--ignore-scripts']),
      'Version update',
    );
  // Checks include the production build; pack those checked files without rerunning hooks.
  const packed = run(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', root], true);
  requireSuccess(packed, 'Packing release');
  const [item] = JSON.parse(packed.stdout);
  if (item.name !== pkg.name || item.version !== version)
    throw new Error('Packed metadata differs from the requested release.');
  console.log(`Built ${join(root, item.filename)}`);
}
function publish(pkg, args) {
  const dryRun = args.includes('--dry-run');
  const paths = args.filter((arg) => arg !== '--dry-run');
  if (paths.length > 1 || paths.some((arg) => arg.startsWith('-'))) throw new Error(usage);
  const filename = pkg.name.replace(/^@/, '').replaceAll('/', '-') + '-' + pkg.version + '.tgz';
  const tarball = paths[0] ? resolve(paths[0]) : join(root, filename);
  if (!existsSync(tarball))
    throw new Error(`Missing tarball ${tarball}; run scripts/npm_build.sh first.`);
  const archive = run('tar', ['-xOf', tarball, 'package/package.json'], true);
  requireSuccess(archive, 'Reading tarball metadata');
  const packed = JSON.parse(archive.stdout);
  if (packed.name !== pkg.name || packed.version !== pkg.version)
    throw new Error('Tarball name/version differs from package.json; rebuild before publishing.');
  if (!stableParts(packed.version))
    throw new Error('Release scripts publish stable versions only.');
  if (publishedVersions(pkg.name).includes(packed.version))
    throw new Error(
      `${pkg.name}@${packed.version} is already published; run scripts/npm_build.sh for the next release.`,
    );
  console.log(
    `${dryRun ? 'Previewing' : 'Publishing'} ${pkg.name}@${packed.version} from ${tarball}`,
  );
  requireSuccess(
    run(npm, [
      'publish',
      tarball,
      '--access',
      'public',
      '--tag',
      'latest',
      '--registry',
      registry,
      ...(dryRun ? ['--dry-run'] : []),
    ]),
    'npm publish',
  );
}
export function main(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage);
    return;
  }
  const [command, ...options] = args;
  if (!['build', 'publish'].includes(command)) throw new Error(usage);
  const lock = join(root, '.npm-release.lock');
  let handle;
  try {
    handle = openSync(lock, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error(
        `Another release operation holds ${lock}. After a crash, remove it only after confirming no release is running.`,
      );
    throw error;
  }
  try {
    writeFileSync(handle, JSON.stringify({ pid: process.pid, command }));
    const pkg = metadata();
    if (command === 'build') build(pkg, options);
    else publish(pkg, options);
  } finally {
    closeSync(handle);
    unlinkSync(lock);
  }
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Release failed: ${error.message}`);
    process.exitCode = 1;
  }
}
