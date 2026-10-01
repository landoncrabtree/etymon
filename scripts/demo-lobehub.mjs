import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { format } from 'prettier';

// Uses the public npm release, never the working tree's Etymon executable.
const source = 'https://github.com/lobehub/lobehub.git';
const commit = '4bcb808c608ed79497713ab20bcd03ac6d8713da';
const version = '0.1.1';
const demo = realpathSync(mkdtempSync(join(tmpdir(), 'etymon-lobehub-case-')));
const repo = join(demo, 'lobehub');
const home = join(demo, 'home');
const receiptPath = new URL('../docs/demos/lobehub.json', import.meta.url);
const commands = [];
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  XDG_CONFIG_HOME: join(home, '.config'),
  CODEX_HOME: join(home, '.codex'),
  npm_config_cache: join(demo, 'npm-cache'),
  DISABLE_TELEMETRY: '1',
  DO_NOT_TRACK: '1',
};

function run(command, args, cwd = repo) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 240000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

function git(...args) {
  const result = run('git', ['-c', 'core.hooksPath=/dev/null', ...args]);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function count(values, field) {
  const result = {};
  for (const value of values) result[value[field]] = (result[value[field]] ?? 0) + 1;
  return result;
}

function cli(step, args, expectedStatus = 0) {
  console.log(`npx --yes etymon@${version} ${args.join(' ')}`);
  const argv = [
    '--yes',
    `etymon@${version}`,
    ...args,
    '--json',
    '--home',
    home,
    '--cache',
    join(demo, 'cache'),
  ];
  const result = run('npx', argv);
  const data = JSON.parse(result.stdout);
  commands.push({
    step,
    argv: ['npx', ...argv.map((arg) => arg.replaceAll(demo, '$DEMO'))],
    exitCode: result.status,
    ...(data.resources ? { resources: count(data.resources, 'kind') } : {}),
    ...(data.changes ? { changes: data.changes.length } : {}),
    ...(data.diagnostics
      ? {
          diagnostics: count(data.diagnostics, 'code'),
          severities: count(data.diagnostics, 'severity'),
        }
      : {}),
    ...(data.ok !== undefined ? { ok: data.ok } : {}),
  });
  assert.equal(result.status, expectedStatus, JSON.stringify(data.error ?? data.diagnostics));
  return data;
}

function tree(path) {
  const result = [];
  for (const name of readdirSync(path).sort()) {
    const file = join(path, name);
    const stat = lstatSync(file);
    assert(!stat.isSymbolicLink(), `Unexpected bundle symlink: ${file}`);
    if (stat.isDirectory()) {
      result.push(...tree(file).map((entry) => ({ ...entry, path: `${name}/${entry.path}` })));
    } else {
      assert(stat.isFile());
      result.push({
        path: name,
        executable: Boolean(stat.mode & 0o111),
        sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
      });
    }
  }
  return result;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function index() {
  return new Map(
    git('ls-files', '--stage', '-z')
      .split('\0')
      .filter(Boolean)
      .map((line) => {
        const [metadata, path] = line.split('\t');
        return [path, metadata];
      }),
  );
}

try {
  mkdirSync(home, { recursive: true });
  mkdirSync(repo);
  git('init', '--quiet');
  git('remote', 'add', 'origin', source);
  console.log(`Cloning LobeHub at ${commit}`);
  git('fetch', '--quiet', '--depth', '1', '--filter=blob:none', 'origin', commit);
  git('checkout', '--quiet', '--detach', 'FETCH_HEAD');
  assert.equal(git('rev-parse', 'HEAD'), commit);
  const before = index();
  const aliases = ['.claude/skills', '.codex/skills', '.cursor/skills', '.gemini/skills'];
  const symlinks = Object.fromEntries(
    aliases.map((path) => [path, readlinkSync(join(repo, path))]),
  );
  const upstreamSkills = tree(join(repo, '.agents/skills'));
  cli('initialize', ['init']);
  const preview = cli('preview-import', ['convert', '--dry-run']);
  assert.deepEqual(count(preview.resources, 'kind'), { skill: 50, rule: 5 });
  const imported = cli('import', ['convert']);
  const converted = digest(tree(join(repo, '.agents/etymon')));
  const manifest = readFileSync(join(repo, '.agents/etymon.toml'));
  const lock = readFileSync(join(repo, '.agents/etymon.lock'));
  cli('repeat-import', ['convert']);
  assert.equal(digest(tree(join(repo, '.agents/etymon'))), converted);
  assert.deepEqual(readFileSync(join(repo, '.agents/etymon.toml')), manifest);
  assert.deepEqual(readFileSync(join(repo, '.agents/etymon.lock')), lock);
  assert.deepEqual(tree(join(repo, '.agents/skills')), upstreamSkills);
  const bundles = imported.resources
    .filter((resource) => resource.kind === 'skill')
    .map((resource) => {
      const original = tree(join(repo, '.agents/skills', resource.name));
      const canonical = tree(resource.destination);
      assert.deepEqual(canonical, original, `Skill bundle changed: ${resource.name}`);
      return { name: resource.name, files: original.length, sha256: digest(original) };
    });

  // This AGENTS.md is application data imported by agent.ts, not contributor guidance.
  const template = 'packages/agent-templates/src/templates/claw/AGENTS.md';
  const excluded = imported.resources.find(
    (resource) => relative(repo, resource.origin) === template,
  );
  assert(excluded);
  cli('keep-application-template', ['rules', 'remove', excluded.name]);
  const rules = imported.resources.filter(
    (resource) => resource.kind === 'rule' && resource.name !== excluded.name,
  );
  const retired = ['.agents/skills', ...aliases, ...rules.map((r) => relative(repo, r.origin))];
  // Explicit migration cleanup happens after the canonical copies are verified.
  git('rm', '--quiet', '-r', '--cached', '--', ...retired);
  for (const path of retired) rmSync(join(repo, path), { recursive: true });
  commands.push({
    step: 'retire-imported-originals',
    argv: ['git', 'rm', '-r', '--cached', '--', ...retired],
    exitCode: 0,
    removedWorkingPaths: retired,
  });
  const manifestBeforeSync = readFileSync(join(repo, '.agents/etymon.toml'));
  const lockBeforeSync = readFileSync(join(repo, '.agents/etymon.lock'));

  cli('sync-claude', ['sync', '--harness', 'claude']);
  cli('strict-portability-review', ['sync', '--harness', 'codex,opencode', '--dry-run'], 1);
  const lossReview = cli('review-lossy-sync', [
    'sync',
    '--harness',
    'codex,opencode',
    '--dry-run',
    '--allow-lossy',
  ]);
  assert(lossReview.diagnostics.some((d) => d.severity === 'warning'));
  cli('sync-codex-opencode', ['sync', '--harness', 'codex,opencode', '--allow-lossy']);
  const repeat = cli('repeat-sync', ['sync', '--harness', 'codex,opencode', '--allow-lossy']);
  assert.equal(repeat.changes.length, 0);
  const doctor = cli('doctor', ['doctor', '--harness', 'claude,codex,opencode', '--allow-lossy']);
  assert(doctor.ok);
  assert.equal(digest(tree(join(repo, '.agents/etymon'))), converted);
  assert.deepEqual(readFileSync(join(repo, '.agents/etymon.toml')), manifestBeforeSync);
  assert.deepEqual(readFileSync(join(repo, '.agents/etymon.lock')), lockBeforeSync);
  const inventory = cli('inventory', ['list']);
  assert.equal(Object.keys(inventory.authored.skill).length, 50);
  assert.equal(Object.keys(inventory.authored.rule).length, 4);
  assert.equal(inventory.lock.dependencies.length, 0);
  git('add', '--', '.gitignore', '.agents/etymon.toml', '.agents/etymon.lock', '.agents/etymon');
  const after = index();
  const wasRetired = (path) => retired.some((root) => path === root || path.startsWith(root + '/'));
  for (const [path, entry] of before) {
    if (path === '.gitignore' || wasRetired(path)) continue;
    assert.equal(after.get(path), entry, `Unrelated tracked file changed: ${path}`);
  }
  assert.equal(git('diff', '--name-only'), '', 'Unrelated working-tree edits');
  const names = [
    '.agents',
    '.claude',
    '.codex',
    '.cursor',
    '.gemini',
    '.github',
    'AGENTS.md',
    'GEMINI.md',
  ];
  const roots = (files) =>
    names.filter((name) =>
      [...files.keys()].some((path) => path === name || path.startsWith(name + '/')),
    );
  const receipt = {
    repository: 'https://github.com/lobehub/lobehub',
    commit,
    etymon: version,
    imported: { skills: bundles.length, rules: 5 },
    registered: { skills: 50, rules: 4 },
    lockDependencies: inventory.lock.dependencies.length,
    beforeRoots: roots(before),
    afterRoots: roots(after),
    sourceSymlinks: symlinks,
    skillBundles: bundles,
    rules: rules.map((resource) => ({
      name: resource.name,
      source: relative(repo, resource.origin),
      canonical: relative(repo, resource.destination),
      destDir: inventory.authored.rule[resource.name].destDir,
    })),
    excluded: { path: template, reason: 'Application prompt template imported by agent.ts' },
    retired,
    checks: {
      completeSkillBundlesUnchanged: true,
      repeatImportUnchanged: true,
      canonicalSourceUnchangedBySync: true,
      unrelatedTrackedFilesUnchanged: true,
      claudeSync: 'strict',
      codexOpencodeSync: 'allow-lossy',
      repeatSyncChanges: repeat.changes.length,
      doctor: doctor.ok,
    },
    commands,
  };
  mkdirSync(new URL('../docs/demos/', import.meta.url), { recursive: true });
  writeFileSync(
    receiptPath,
    await format(JSON.stringify(receipt), { parser: 'json', printWidth: 100 }),
  );
  console.log(`Verified LobeHub: ${bundles.length} skills, ${rules.length} rules, stable sync.`);
} finally {
  if (process.argv.includes('--keep')) console.log(`Demo checkout retained: ${demo}`);
  else rmSync(demo, { recursive: true, force: true });
}
