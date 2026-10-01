import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Workspace,
  add,
  sync,
  remove,
  doctor,
  resources,
  renderRules,
  profile,
  ruleSchema,
  canonicalRuleText,
  emptyManifest,
  parseAgent,
  renderAgent,
} from '../src/index.js';
import { readOptional, exists } from '../src/core/fs.js';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await fs.rm(directory, { recursive: true, force: true });
});
async function fixture(global = false) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'etymon-lossy-'));
  directories.push(directory);
  const ws = new Workspace({
    cwd: join(directory, 'project'),
    home: join(directory, 'home'),
    cache: join(directory, 'cache'),
    global,
  });
  await fs.mkdir(ws.root, { recursive: true });
  return ws;
}
async function write(path: string, text: string) {
  await fs.mkdir(join(path, '..'), { recursive: true });
  await fs.writeFile(path, text);
}
async function registerRule(ws: Workspace, name: string, extra = {}) {
  const rule = ruleSchema.parse({ name, prompt: `Guidance for ${name}.`, ...extra });
  await write(join(ws.root, name + '.md'), canonicalRuleText(rule));
  await add(ws, 'rule', { source: join(ws.root, name + '.md'), names: [] });
}
const errors = (plan: { diagnostics: { severity: string }[] }) =>
  plan.diagnostics.filter((d) => d.severity === 'error');

it('retains native behavior where supported and warns when unknown tools or mode conditions are lost', async () => {
  const ws = await fixture();
  const agent = parseAgent(
    '---\nname: checks\ndescription: Run checks\nhooks: {}\n---\nRun tests.',
    'checks.md',
  );
  const same = renderAgent(agent, profile('claude'), { allowLossy: true });
  expect(same.text).toContain('hooks: {}');
  expect(same.diagnostics).toEqual([]);
  const unknown = { ...agent, native: {}, tools: ['UnknownTool'] };
  expect(() => renderAgent(unknown, profile('opencode'))).toThrow('Cannot map tool UnknownTool');
  expect(
    renderAgent(unknown, profile('opencode'), { allowLossy: true }).diagnostics,
  ).toContainEqual(
    expect.objectContaining({
      code: 'TOOL_RESTRICTION_OMITTED',
      severity: 'warning',
      message: expect.stringContaining('UnknownTool'),
    }),
  );
  const resource = {
    id: 'rule:mode',
    name: 'checks',
    kind: 'rule' as const,
    rule: ruleSchema.parse({
      name: 'checks',
      prompt: 'Run tests.',
      format: 'roo',
      native: { mode: 'code' },
    }),
  };
  const native = await renderRules([resource], profile('roo'), ws, { allowLossy: true });
  expect(native.units[0].path).toContain('.roo/rules-code/');
  expect(errors(native)).toEqual([]);
  const lossy = await renderRules([resource], profile('codex'), ws, { allowLossy: true });
  expect(lossy.units[0].path).toBe(join(ws.root, 'AGENTS.md'));
  expect(lossy.diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'RULE_NATIVE_FIELDS_OMITTED',
      message: expect.stringContaining('mode'),
    }),
  );
  expect(resource.rule.native).toEqual({ mode: 'code' });
  resource.rule.native.mode = '../unsafe';
  const invalid = await renderRules([resource], profile('roo'), ws, { allowLossy: true });
  expect(invalid.units).toEqual([]);
  expect(invalid.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'INVALID_RULE', severity: 'error' }),
  );
});

it('projects all four interfaces with specific warnings and unchanged authoritative source', async () => {
  const ws = await fixture();
  await write(
    join(ws.root, 'skill/SKILL.md'),
    '---\nname: checks\ndescription: Run checks\nargument-hint: "[file]"\ndisable-model-invocation: true\n---\n\n    Run tests.  \n\n',
  );
  await write(join(ws.root, 'skill/assets/check.txt'), 'asset bytes\n');
  await add(ws, 'skill', { source: './skill', names: [] });
  await write(
    join(ws.root, 'reviewer.md'),
    '---\nname: reviewer\ndescription: Review code\ntools: Read\nmodel: opus\nhooks: {}\n---\nReview changes.\n',
  );
  await add(ws, 'agent', { source: './reviewer.md', names: [] });
  const manifest = await ws.manifest();
  manifest.mcp.docs = {
    connection: { transport: 'streamable-http', url: 'https://example.com/mcp', headers: {} },
    format: 'copilot-cli',
    native: { tools: ['read'] },
  };
  manifest.mcp.legacy = {
    connection: { transport: 'sse', url: 'https://example.com/sse', headers: {} },
  };
  manifest.mcp.secret = {
    connection: {
      transport: 'streamable-http',
      url: 'https://example.com/auth',
      headers: { Authorization: 'Custom ${env:ETYM_TEST_SECRET}' },
    },
  };
  await ws.saveManifest(manifest);
  await registerRule(ws, 'types', {
    base: 'packages/api',
    activation: 'glob',
    patterns: ['**/*.ts'],
  });
  const before = JSON.stringify(await resources(ws)),
    manifestBefore = await fs.readFile(ws.manifestPath),
    lockBefore = await fs.readFile(ws.lockPath);
  const strict = await sync(ws, ['codex'], { dryRun: true });
  expect(errors(strict).length).toBeGreaterThan(0);
  expect(strict.summary).toEqual([]);
  expect(await exists(join(ws.root, '.codex/config.toml'))).toBe(false);
  const lossy = await sync(ws, ['codex'], { allowLossy: true });
  expect(errors(lossy)).toEqual([]);
  expect(lossy.diagnostics.map((d) => d.code)).toEqual(
    expect.arrayContaining([
      'SKILL_FIELDS_OMITTED',
      'NATIVE_FIELD_OMITTED',
      'MODEL_INHERITED',
      'TOOL_RESTRICTION_OMITTED',
      'MCP_FIELDS_OMITTED',
      'RESOURCE_OMITTED',
      'RULE_CONDITIONS_DROPPED',
    ]),
  );
  expect(
    lossy.diagnostics
      .filter((d) => d.severity === 'warning')
      .every((d) => d.resource && d.harness === 'codex'),
  ).toBe(true);
  const skill = await fs.readFile(join(ws.root, '.agents/skills/checks/SKILL.md'), 'utf8');
  expect(skill).toContain('Run tests.');
  expect(skill.endsWith('---\n\n    Run tests.  \n\n')).toBe(true);
  expect(skill).not.toContain('argument-hint');
  expect(skill).not.toContain('disable-model-invocation');
  expect(await fs.readFile(join(ws.root, '.agents/skills/checks/assets/check.txt'), 'utf8')).toBe(
    'asset bytes\n',
  );
  const config = await fs.readFile(join(ws.root, '.codex/config.toml'), 'utf8');
  expect(config).toContain('[mcp_servers.docs]');
  expect(config).not.toContain('legacy');
  expect(config).not.toContain('secret');
  expect(config).not.toContain('tools');
  expect(await readOptional(join(ws.root, 'AGENTS.md'))).toBeUndefined();
  expect(await fs.readFile(join(ws.root, 'packages/api/AGENTS.md'), 'utf8')).toContain(
    'Guidance for types.',
  );
  expect(JSON.stringify(await resources(ws))).toBe(before);
  expect(await fs.readFile(ws.manifestPath)).toEqual(manifestBefore);
  expect(await fs.readFile(ws.lockPath)).toEqual(lockBefore);
  expect((await sync(ws, ['codex'], { allowLossy: true })).summary).toEqual([]);
  expect(errors(await doctor(ws, ['codex'], { allowLossy: true }))).toEqual([]);
});

it('keeps scope loss visible when a root-only destination cannot preserve nesting', async () => {
  const ws = await fixture();
  await registerRule(ws, 'nested', { base: 'packages/api' });
  const plan = await sync(ws, ['zed'], { allowLossy: true });
  expect(plan.diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'RULE_SCOPE_BROADENED',
      severity: 'warning',
      message: expect.stringContaining('packages/api becomes project-wide'),
    }),
  );
  expect(await readOptional(join(ws.root, 'AGENTS.md'))).toContain('Guidance for nested.');
  expect((await resources(ws))[0]).toMatchObject({ rule: { base: 'packages/api' } });
});

it('rebuilds shared rule output on opted-in removal and preserves the other rule', async () => {
  const ws = await fixture();
  for (const name of ['checks', 'types'])
    await registerRule(ws, name, { activation: 'glob', patterns: ['src/**'] });
  await sync(ws, ['codex'], { allowLossy: true });
  const before = await fs.readFile(ws.manifestPath);
  await expect(remove(ws, 'rule', 'checks')).rejects.toMatchObject({ code: 'REMOVE_BLOCKED' });
  expect(await fs.readFile(ws.manifestPath)).toEqual(before);
  const result = await remove(ws, 'rule', 'checks', { allowLossy: true });
  expect(result.plan.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'RULE_CONDITIONS_DROPPED', severity: 'warning' }),
  );
  const content = await fs.readFile(join(ws.root, 'AGENTS.md'), 'utf8');
  expect(content).toContain('Guidance for types.');
  expect(content).not.toContain('Guidance for checks.');
  expect((await sync(ws, ['codex'], { allowLossy: true })).summary).toEqual([]);
});

it('omits unsupported resources while activating supported resources', async () => {
  const ws = await fixture();
  await write(
    join(ws.root, 'reviewer.md'),
    '---\nname: reviewer\ndescription: Review code\n---\nReview.',
  );
  await add(ws, 'agent', { source: './reviewer.md', names: [] });
  await registerRule(ws, 'checks');
  const plan = await sync(ws, ['amp'], { allowLossy: true });
  expect(errors(plan)).toEqual([]);
  expect(plan.diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'RESOURCE_OMITTED',
      resource: 'agent:local/reviewer',
      severity: 'warning',
    }),
  );
  expect(await readOptional(join(ws.root, 'AGENTS.md'))).toContain('Guidance for checks.');
});

it('omits disabled rules and oversized groups rather than enabling or truncating them', async () => {
  const ws = await fixture();
  await registerRule(ws, 'disabled', { activation: 'never' });
  const inactive = await sync(ws, ['codex'], { allowLossy: true });
  expect(errors(inactive)).toEqual([]);
  expect(inactive.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'RESOURCE_OMITTED', resource: 'rule:local/disabled' }),
  );
  expect(await exists(join(ws.root, 'AGENTS.md'))).toBe(false);
  await remove(ws, 'rule', 'disabled');
  for (const name of ['long', 'longer'])
    await registerRule(ws, name, { prompt: name + 'x'.repeat(8000) });
  const strict = await sync(ws, ['windsurf'], { dryRun: true });
  expect(errors(strict)).toHaveLength(2);
  const lossy = await sync(ws, ['windsurf'], { allowLossy: true });
  expect(errors(lossy)).toEqual([]);
  expect(lossy.diagnostics.filter((d) => d.code === 'RESOURCE_OMITTED')).toHaveLength(2);
  expect(await exists(join(ws.root, 'AGENTS.md'))).toBe(false);
});

it('does not use project rule directories for a destination without a global writer', async () => {
  const ws = await fixture(true);
  await registerRule(ws, 'personal');
  const plan = await sync(ws, ['cursor'], { allowLossy: true });
  expect(errors(plan)).toEqual([]);
  expect(plan.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'RESOURCE_OMITTED', severity: 'warning' }),
  );
  expect(await exists(join(ws.root, '.cursor'))).toBe(false);
  const manifest = await ws.manifest();
  manifest.rule.personal.destDir = 'src';
  await ws.saveManifest(manifest);
  await expect(sync(ws, ['codex'], { allowLossy: true })).rejects.toMatchObject({
    code: 'GLOBAL_RULE_SCOPE_UNSUPPORTED',
  });
});

it('keeps invalid input, ownership conflicts, drift, and loader suppression as errors', async () => {
  const ws = await fixture();
  await registerRule(ws, 'conditional', { activation: 'glob', patterns: ['src/**'] });
  await write(join(ws.root, 'AGENTS.md'), 'Unmanaged guidance.');
  await expect(sync(ws, ['codex'], { allowLossy: true })).rejects.toMatchObject({
    code: 'UNMANAGED_CONFLICT',
  });
  await sync(ws, ['codex'], { allowLossy: true, adopt: true });
  await write(join(ws.root, 'AGENTS.md'), 'Edited managed guidance.');
  await expect(sync(ws, ['codex'], { allowLossy: true })).rejects.toMatchObject({
    code: 'MANAGED_DRIFT',
  });
  const standing = {
    id: 'rule:test',
    name: 'checks',
    kind: 'rule' as const,
    rule: ruleSchema.parse({ name: 'checks', prompt: 'Run checks.' }),
  };
  await write(
    join(ws.home, '.claude/settings.json'),
    JSON.stringify({
      pluginConfigs: { 'agents-md@builtin': { options: { instructionFiles: 'managed-only' } } },
    }),
  );
  expect(
    (await renderRules([standing], profile('claude'), ws, { allowLossy: true })).diagnostics,
  ).toContainEqual(expect.objectContaining({ code: 'RULES_DISABLED', severity: 'error' }));
  const manifest = emptyManifest();
  manifest.skill.broken = { path: 'broken' };
  await write(join(ws.agents, 'broken/SKILL.md'), '---\nname: [invalid yaml\n---\nBody.');
  await ws.saveManifest(manifest);
  await expect(sync(ws, ['codex'], { allowLossy: true })).rejects.toMatchObject({
    code: 'INVALID_FRONTMATTER',
  });
});
