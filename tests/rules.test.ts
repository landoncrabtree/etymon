import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Workspace,
  add,
  convert,
  sync,
  remove,
  resources,
  profiles,
  profile,
  renderRules,
  ruleSchema,
  ruleIdentity,
  canonicalRuleText,
  parseRule,
  update,
} from '../src/index.js';
import { exists, readOptional, run } from '../src/core/fs.js';
import { parseInstructionFile, RuleDialect, splitGlobs } from '../src/providers/rules.js';
import { importRules } from '../src/harnesses/rule-import.js';
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await fs.rm(directory, { recursive: true, force: true });
});
async function fixture(global = false) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'etymon-rule-test-'));
  directories.push(dir);
  const root = join(dir, 'project'),
    home = join(dir, 'home');
  await fs.mkdir(root);
  await fs.mkdir(home);
  const ws = new Workspace({ cwd: root, home, global, cache: join(dir, 'cache') });
  return { dir, root, home, ws };
}
async function write(path: string, text: string) {
  await fs.mkdir(join(path, '..'), { recursive: true });
  await fs.writeFile(path, text);
}
const standing = ruleSchema.parse({ name: 'checks', prompt: 'Run the tests.' });
const resource = (rule = standing) => ({
  id: 'rule:local/' + rule.name,
  name: rule.name,
  kind: 'rule' as const,
  rule,
});
describe('rule formats and scope', () => {
  it('preserves authored directory scope when the manifest omits destDir', async () => {
    const { ws } = await fixture();
    const rule = ruleSchema.parse({
      name: 'api',
      prompt: 'Keep API responses stable.',
      base: 'packages/api',
    });
    await write(join(ws.agents, 'etymon/rules/api.md'), canonicalRuleText(rule));
    await ws.saveManifest({
      version: 1,
      skill: {},
      agent: {},
      mcp: {},
      rule: { api: { path: 'etymon/rules/api.md' } },
    });
    expect((await ws.manifest()).rule.api.destDir).toBeUndefined();
    const environment = await resources(ws);
    expect(environment[0]).toMatchObject({ kind: 'rule', rule: { base: 'packages/api' } });
    await sync(ws, ['codex']);
    expect(await readOptional(join(ws.root, 'AGENTS.md'))).toBeUndefined();
    expect(await readOptional(join(ws.root, 'packages/api/AGENTS.md'))).toContain(
      'Keep API responses stable.',
    );
  });
  it.each<[RuleDialect, string, string, string[]]>([
    ['claude', 'paths: ["src/**/*.ts"]', 'glob', ['src/**/*.ts']],
    ['cline', 'paths: []', 'never', []],
    ['copilot', 'applyTo: "src/**/*.{ts,tsx},tests/**"', 'glob', ['src/**/*.{ts,tsx}', 'tests/**']],
    ['cursor', 'alwaysApply: true\nglobs: "src/**"', 'always', []],
    ['cursor', 'alwaysApply: false\ndescription: Use for reviews', 'model', []],
    ['cursor', 'alwaysApply: false', 'manual', []],
    ['kiro', 'inclusion: fileMatch\nfileMatchPattern: "src/**"', 'glob', ['src/**']],
    ['trigger', 'trigger: glob\nglobs: "src/**, tests/**"', 'glob', ['src/**', 'tests/**']],
    ['continue', 'globs: ["src/**"]', 'glob', ['src/**']],
    ['amp', 'globs: "src/**"', 'glob', ['src/**']],
  ])(
    'parses %s activation without broadening conditions (%s)',
    (dialect, metadata, activation, patterns) => {
      expect(
        parseRule(`---\n${metadata}\n---\n\nRun checks.\n`, 'checks.md', dialect),
      ).toMatchObject({ activation, patterns });
    },
  );
  it('preserves compound native conditions and blocks cross-harness mapping', async () => {
    const { ws } = await fixture();
    const rule = parseRule(
      '---\nglobs: "src/**"\nregex: "TODO"\nalwaysApply: false\ndescription: For reviews\n---\nCheck carefully.',
      'checks.md',
      'continue',
    );
    expect(rule.activation).toBe('native');
    expect(rule.native).toMatchObject({ regex: 'TODO', alwaysApply: false, globs: 'src/**' });
    const native = await renderRules([resource(rule)], profile('continue'), ws, {});
    expect(native.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(
      parseRule(native.units[0].content!.toString(), native.units[0].path, 'continue'),
    ).toEqual(rule);
    expect(
      (await renderRules([resource(rule)], profile('claude'), ws, {})).diagnostics,
    ).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'RULE_NATIVE_FIELDS_BLOCKED' }),
    );
    const lossy = await renderRules([resource(rule)], profile('claude'), ws, { allowLossy: true });
    expect(lossy.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        code: 'RULE_NATIVE_FIELDS_OMITTED',
        message: expect.stringContaining('regex'),
      }),
    );
    expect(lossy.units[0].path).toBe(join(ws.root, 'AGENTS.md'));
    expect(rule.activation).toBe('native');
    expect(rule.native.regex).toBe('TODO');
  });
  it('rejects malformed, unsafe, and ambiguous conditions', () => {
    for (const text of [
      'paths: ["../private/**"]',
      'paths: ["!/private/**"]',
      'paths: [3]',
      'paths: ""',
      'paths: ["a"]\npaths: ["b"]',
    ])
      expect(() => parseRule(`---\n${text}\n---\nBody`, 'x.md', 'claude')).toThrow();
    expect(() => parseRule('---\nalwaysApply: "false"\n---\nBody', 'x.mdc')).toThrow();
    expect(() => parseRule('---\ntrigger: unknown\n---\nBody', 'x.md', 'trigger')).toThrow();
    expect(() => ruleSchema.parse({ ...standing, base: '../src' })).toThrow();
    expect(splitGlobs('src/**/*.{js,ts},[ab]/**')).toEqual(['src/**/*.{js,ts}', '[ab]/**']);
  });
  it('compares effective scope and preserves distinct directory and activation semantics', () => {
    const nested = ruleSchema.parse({
      ...standing,
      base: 'src',
      activation: 'glob',
      patterns: ['**/*.ts'],
    });
    const root = ruleSchema.parse({ ...nested, base: '.', patterns: ['src/**/*.ts'] });
    expect(ruleIdentity(nested)).toBe(ruleIdentity(root));
    expect(ruleIdentity(standing)).not.toBe(ruleIdentity({ ...standing, base: 'src' }));
    expect(ruleIdentity(nested)).not.toBe(
      ruleIdentity({ ...nested, activation: 'always', patterns: [] }),
    );
  });
  it('preserves Markdown code indentation in canonical and native rule files', () => {
    const rule = { ...standing, prompt: '    const x = 1;\n    return x;' };
    expect(parseRule(canonicalRuleText(rule), 'checks.md').prompt).toBe(rule.prompt);
    expect(parseRule(rule.prompt + '\n', 'AGENTS.md', 'plain').prompt).toBe(rule.prompt);
  });
  it.each(profiles.map((p) => [p.id]))('writes always-on project guidance for %s', async (id) => {
    const { ws } = await fixture();
    const result = await renderRules([resource()], profile(id), ws, {});
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.units.some((unit) => unit.content?.toString().includes(standing.prompt))).toBe(
      true,
    );
  });
  it('retains normalized directory scope on native round trips and honors later frontmatter edits', async () => {
    const { ws } = await fixture();
    const rule = { ...standing, base: 'packages/api' };
    const result = await renderRules([resource(rule)], profile('vscode-local'), ws, {});
    const unit = result.units[0],
      text = unit.content!.toString();
    expect(text).toContain('applyTo: packages/api/**');
    expect(parseRule(text, unit.path, 'copilot')).toEqual(rule);
    const edited = parseRule(text.replace('packages/api/**', 'tests/**'), unit.path, 'copilot');
    expect(edited).toMatchObject({ base: '.', activation: 'glob', patterns: ['tests/**'] });
    expect(edited.prompt).not.toContain('etymon:scope');
    expect(
      (await renderRules([resource(rule)], profile('zed'), ws, {})).diagnostics,
    ).toContainEqual(
      expect.objectContaining({ code: 'RULE_SCOPE_UNSUPPORTED', severity: 'error' }),
    );
  });
  it.each([
    'claude',
    'copilot-cli',
    'vscode-local',
    'cursor',
    'kiro',
    'antigravity',
    'cline',
    'continue',
    'windsurf',
    'amp',
  ])('preserves file-glob activation through %s native output', async (id) => {
    const { ws } = await fixture();
    const rule = ruleSchema.parse({
      ...standing,
      base: 'packages/api',
      activation: 'glob',
      patterns: ['**/*.{ts,tsx}'],
    });
    const result = await renderRules([resource(rule)], profile(id), ws, {});
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const unit = result.units.find((unit) => unit.content?.toString().includes('etymon:scope'))!;
    expect(parseRule(unit.content!.toString(), unit.path, profile(id).rule!.dialect)).toEqual(rule);
  });
  it('keeps Roo mode conditions and refuses to translate them into ordinary guidance', async () => {
    const { ws } = await fixture();
    await write(join(ws.root, '.roo/rules-code/types.md'), 'Use explicit types.');
    const imported = await importRules(profile('roo'), ws);
    expect(imported.resources[0].rule.native).toEqual({ mode: 'code' });
    const native = await renderRules(
      [resource(imported.resources[0].rule)],
      profile('roo'),
      ws,
      {},
    );
    expect(native.units[0].path).toContain('.roo/rules-code/');
    expect(
      (await renderRules([resource(imported.resources[0].rule)], profile('cursor'), ws, {}))
        .diagnostics,
    ).toContainEqual(
      expect.objectContaining({ code: 'RULE_NATIVE_FIELDS_BLOCKED', severity: 'error' }),
    );
  });
  it('blocks manual/model guidance on harnesses that only load unconditional instructions', async () => {
    const { ws } = await fixture();
    for (const activation of ['model', 'manual'] as const) {
      const rule = { ...standing, activation, description: 'When reviewing code' };
      const result = await renderRules([resource(rule)], profile('codex'), ws, {});
      expect(result.units).toEqual([]);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'RULE_SCOPE_UNSUPPORTED', severity: 'error' }),
      );
      const lossy = await renderRules([resource(rule)], profile('codex'), ws, { allowLossy: true });
      expect(lossy.units[0].content!.toString()).toContain(rule.prompt);
      expect(lossy.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'RULE_CONDITIONS_DROPPED',
          severity: 'warning',
          message: expect.stringContaining(activation),
        }),
      );
      expect(rule.activation).toBe(activation);
    }
  });
});
describe('rule lifecycle and aliases', () => {
  it('reimports Amp references with their conditions and rejects unresolved native includes', async () => {
    const { ws } = await fixture();
    const rule = { ...standing, activation: 'glob' as const, patterns: ['src/**/*.ts'] };
    await write(join(ws.root, 'checks.md'), canonicalRuleText(rule));
    await add(ws, 'rule', { source: './checks.md', names: [] });
    await sync(ws, ['amp']);
    const report = await importRules(profile('amp'), ws);
    expect(report.resources).toHaveLength(1);
    expect(report.resources[0].rule).toEqual(rule);
    await write(join(ws.root, 'CLAUDE.md'), '@docs/team.md\n');
    const unsupported = await importRules(profile('claude'), ws);
    expect(unsupported.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'RULE_INCLUDE_UNSUPPORTED', severity: 'error' }),
    );
  });
  it('deduplicates aliases, retains nested guidance, and keeps Claude include bridges idempotent', async () => {
    const { ws } = await fixture();
    for (const path of ['AGENTS.md', 'CLAUDE.md', 'src/CLAUDE.md'])
      await write(join(ws.root, path), standing.prompt + '\n');
    await convert(ws, 'claude');
    const manifest = await ws.manifest();
    expect(Object.keys(manifest.rule)).toHaveLength(2);
    expect(manifest.rule.instructions.origins).toHaveLength(2);
    expect(manifest.rule['src-instructions'].destDir).toBe('src');
    await sync(ws, ['claude', 'codex'], { adopt: true });
    expect(await readOptional(join(ws.root, 'CLAUDE.md'))).toBe('@AGENTS.md\n');
    expect(await readOptional(join(ws.root, 'src/CLAUDE.md'))).toBe('@AGENTS.md\n');
    expect((await sync(ws, ['claude', 'codex'])).summary).toHaveLength(0);
    const reimport = await importRules(profile('claude'), ws);
    expect(reimport.resources).toHaveLength(2);
    await fs.rm(join(ws.root, 'AGENTS.md'));
    await fs.rm(join(ws.root, 'src/AGENTS.md'));
    await sync(ws, ['claude', 'codex']);
    expect(await exists(join(ws.root, 'src/AGENTS.md'))).toBe(true);
  });
  it('excludes guidance shadowed by native instruction-file precedence', async () => {
    const { ws } = await fixture();
    await write(join(ws.root, 'CLAUDE.md'), 'Active Claude guidance.');
    await write(join(ws.root, 'AGENTS.md'), 'Inactive guidance.');
    const report = await importRules(profile('claude'), ws);
    expect(report.resources.map((item) => item.rule.prompt)).toEqual(['Active Claude guidance.']);
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'NATIVE_SHADOWING' }),
    );
    await write(join(ws.root, 'AGENTS.override.md'), 'Override guidance.');
    expect(
      (await importRules(profile('codex'), ws)).resources.map((item) => item.rule.prompt),
    ).toEqual(['Override guidance.']);
  });
  it('uses editable destDir registrations and removes stale native placement on resync', async () => {
    const { ws } = await fixture();
    await write(join(ws.root, 'style.md'), 'Use explicit types.');
    await add(ws, 'rule', { source: './style.md', names: [], destDir: 'src' });
    await fs.rm(join(ws.root, 'style.md'));
    await sync(ws, ['codex']);
    expect(await exists(join(ws.root, 'src/AGENTS.md'))).toBe(true);
    const manifest = await ws.manifest();
    manifest.rule.style.destDir = 'lib';
    await ws.saveManifest(manifest);
    await sync(ws, ['codex']);
    expect(await exists(join(ws.root, 'src/AGENTS.md'))).toBe(false);
    expect(await exists(join(ws.root, 'lib/AGENTS.md'))).toBe(true);
    expect((await ws.lock()).dependencies).toEqual([]);
  });
  it('removes one fragment without deleting shared guidance, and protects edited output', async () => {
    const { ws } = await fixture();
    await write(join(ws.root, 'checks.md'), canonicalRuleText(standing));
    await write(
      join(ws.root, 'style.md'),
      canonicalRuleText({ ...standing, name: 'style', prompt: 'Use explicit types.' }),
    );
    await add(ws, 'rule', { source: './checks.md', names: [] });
    await add(ws, 'rule', { source: './style.md', names: [] });
    await sync(ws, ['codex', 'cursor']);
    await remove(ws, 'rule', 'checks');
    const text = (await readOptional(join(ws.root, 'AGENTS.md')))!;
    expect(text).not.toContain(standing.prompt);
    expect(text).toContain('Use explicit types.');
    expect(parseInstructionFile(text, 'AGENTS.md')).toHaveLength(1);
    await write(join(ws.root, 'AGENTS.md'), text + '\nUser edits.');
    await expect(remove(ws, 'rule', 'style')).rejects.toMatchObject({ code: 'PLAN_BLOCKED' });
    expect((await ws.manifest()).rule.style).toBeDefined();
  });
  it('preserves Gemini user filenames when the last rule is removed', async () => {
    const { ws } = await fixture();
    await write(
      join(ws.root, '.gemini/settings.json'),
      JSON.stringify({ context: { fileName: ['GEMINI.md', 'TEAM.md'] }, theme: 'dark' }),
    );
    await write(join(ws.root, 'checks.md'), canonicalRuleText(standing));
    await add(ws, 'rule', { source: './checks.md', names: [] });
    await sync(ws, ['gemini'], { adopt: true });
    await remove(ws, 'rule', 'checks');
    const config = JSON.parse((await readOptional(join(ws.root, '.gemini/settings.json')))!);
    expect(config.context.fileName).toContain('TEAM.md');
    expect(config.theme).toBe('dark');
    expect(await exists(join(ws.root, 'AGENTS.md'))).toBe(false);
  });
  it('locks Git rules, restores offline, and changes commits only on update', async () => {
    const { ws, dir } = await fixture();
    const repository = join(dir, 'source');
    await fs.mkdir(repository);
    await run('git', ['init', '-q', repository]);
    await write(join(repository, 'AGENTS.md'), 'Original guidance.');
    const commit = async () => {
      await run('git', ['add', '.'], { cwd: repository });
      await run(
        'git',
        ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture'],
        { cwd: repository },
      );
    };
    await commit();
    await add(ws, 'rule', { source: 'git+file://' + repository, names: [], destDir: 'src' });
    const first = await readOptional(ws.lockPath);
    await write(join(repository, 'AGENTS.md'), 'Updated guidance.');
    await commit();
    ws.offline = true;
    await sync(ws, ['codex']);
    expect(await readOptional(join(ws.root, 'src/AGENTS.md'))).toContain('Original guidance.');
    expect(await readOptional(ws.lockPath)).toBe(first);
    ws.offline = false;
    await update(ws);
    await sync(ws, ['codex']);
    expect(await readOptional(join(ws.root, 'src/AGENTS.md'))).toContain('Updated guidance.');
    expect(await readOptional(ws.lockPath)).not.toBe(first);
  });
  it('deduplicates complete skill aliases, including native symlinks, but detects asset conflicts', async () => {
    const { ws } = await fixture();
    const skill = '---\nname: checks\ndescription: Run checks\n---\nRun tests.\n';
    await write(join(ws.root, '.agents/skills/checks/SKILL.md'), skill);
    await write(join(ws.root, '.agents/skills/checks/assets/data.txt'), 'one');
    await fs.mkdir(join(ws.root, '.codex/skills'), { recursive: true });
    await fs.symlink('../../.agents/skills/checks', join(ws.root, '.codex/skills/checks'));
    await convert(ws, 'codex');
    expect(Object.keys((await ws.manifest()).skill)).toEqual(['checks']);
    expect((await ws.manifest()).skill.checks.origins).toHaveLength(2);
    await fs.rm(join(ws.root, '.codex/skills/checks'));
    await fs.cp(join(ws.root, '.agents/skills/checks'), join(ws.root, '.codex/skills/checks'), {
      recursive: true,
    });
    await write(join(ws.root, '.codex/skills/checks/assets/data.txt'), 'two');
    await expect(convert(ws, 'codex')).rejects.toMatchObject({ code: 'IMPORT_COLLISION' });
  });
});
describe('user rule scope', () => {
  it.each([
    'claude',
    'codex',
    'copilot-cli',
    'gemini',
    'kiro',
    'pi',
    'omp',
    'opencode',
    'antigravity',
    'cline',
    'kilo',
    'windsurf',
    'amp',
    'zed',
  ])('uses a standalone user file for %s', async (id) => {
    const { ws } = await fixture(true);
    const rendered = await renderRules([resource()], profile(id), ws, {});
    expect(rendered.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(rendered.units.filter((unit) => unit.content)).toHaveLength(1);
    expect(rendered.units.find((unit) => unit.content)!.path).toBe(
      join(ws.home, profile(id).rule!.file![1]),
    );
    expect(profile(id).rule!.global.every((source) => !source.directory)).toBe(true);
  });
  it('writes standalone personal instructions and excludes project rule directories from discovery', async () => {
    const { ws } = await fixture(true);
    await write(join(ws.root, '.claude/CLAUDE.md'), standing.prompt);
    await write(
      join(ws.root, '.claude/rules/project.md'),
      '---\npaths: ["src/**"]\n---\nProject only.',
    );
    await convert(ws, 'claude');
    expect(Object.keys((await ws.manifest()).rule)).toHaveLength(1);
    await sync(ws, ['codex']);
    expect(await readOptional(join(ws.root, '.codex/AGENTS.md'))).toContain(standing.prompt);
    const cursor = await renderRules([resource()], profile('cursor'), ws, {
      rulesPath: join(ws.root, '.cursor/rules'),
    });
    expect(cursor.units).toEqual([]);
    expect(cursor.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'RULE_SCOPE_UNSUPPORTED', severity: 'error' }),
    );
  });
  it.each(['directory', 'glob', 'manual'])(
    'rejects %s registrations globally before saving a rule',
    async (variant) => {
      const { ws } = await fixture(true);
      const rule =
        variant === 'directory'
          ? { ...standing, base: 'src' }
          : variant === 'glob'
            ? { ...standing, activation: 'glob' as const, patterns: ['src/**'] }
            : { ...standing, activation: 'manual' as const };
      await write(join(ws.root, 'checks.md'), canonicalRuleText(rule));
      await expect(
        add(ws, 'rule', { source: join(ws.root, 'checks.md'), names: [] }),
      ).rejects.toMatchObject({ code: 'GLOBAL_RULE_SCOPE_UNSUPPORTED' });
      expect((await ws.manifest()).rule).toEqual({});
    },
  );
});
