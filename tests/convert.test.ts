import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { Workspace, convert, resources, sync } from '../src/index.js';
import { exists, readOptional } from '../src/core/fs.js';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await fs.rm(directory, { recursive: true, force: true });
});
async function fixture(global = false) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'etymon-convert-'));
  directories.push(directory);
  const root = join(directory, 'project'),
    home = join(directory, 'home');
  await fs.mkdir(root);
  await fs.mkdir(home);
  const ws = new Workspace({ cwd: root, home, global, cache: join(directory, 'cache') });
  const write = async (path: string, text: string) => {
    const full = join(ws.root, path);
    await fs.mkdir(dirname(full), { recursive: true });
    await fs.writeFile(full, text);
  };
  return { ws, write };
}
const skill = '---\nname: checks\ndescription: Run project checks\n---\nRun tests.\n';

describe('conversion discovery', () => {
  it('discovers mixed native formats once and preserves shared rule semantics and skill assets', async () => {
    const { ws, write } = await fixture();
    await write('AGENTS.md', 'Keep public APIs stable.\n');
    await write('CLAUDE.md', 'Keep public APIs stable.\n');
    await write('packages/api/AGENTS.md', 'Keep public APIs stable.\n');
    await write('.claude/rules/checks.md', 'Run checks before committing.\n');
    await write(
      '.cursor/rules/types.mdc',
      '---\nalwaysApply: false\nglobs: src/**/*.ts\n---\nUse explicit types.\n',
    );
    for (const path of ['.agents/skills/checks', '.codex/skills/checks', '.claude/skills/checks']) {
      await write(path + '/SKILL.md', skill);
      await write(path + '/assets/check.txt', 'Supporting asset.\n');
    }
    await write(
      'opencode.json',
      JSON.stringify({ mcp: { fixture: { type: 'local', command: ['node', 'server.js'] } } }),
    );
    await write(
      '.mcp.json',
      JSON.stringify({ mcpServers: { fixture: { command: 'node', args: ['server.js'] } } }),
    );
    const preview = await convert(ws, undefined, { dryRun: true });
    expect(preview.resources.filter((resource) => resource.kind === 'rule')).toHaveLength(4);
    expect(preview.resources.filter((resource) => resource.kind === 'skill')).toHaveLength(1);
    expect(preview.resources.filter((resource) => resource.kind === 'mcp')).toHaveLength(1);
    expect(await exists(ws.manifestPath)).toBe(false);
    await convert(ws);
    const manifest = await ws.manifest();
    expect(Object.keys(manifest.skill)).toEqual(['checks']);
    expect(manifest.skill.checks.origins).toHaveLength(3);
    expect(manifest.mcp.fixture.origins).toHaveLength(2);
    expect((await ws.lock()).dependencies).toEqual([]);
    const rules = (await resources(ws)).filter((resource) => resource.kind === 'rule');
    expect(rules.find((resource) => resource.name === 'checks')?.rule).toMatchObject({
      activation: 'always',
      layout: 'modular',
    });
    expect(
      rules
        .filter((resource) => resource.rule.prompt === 'Keep public APIs stable.')
        .map((resource) => resource.rule.base)
        .sort(),
    ).toEqual(['.', 'packages/api']);
    const source = await readOptional(ws.manifestPath);
    await convert(ws);
    expect(await readOptional(ws.manifestPath)).toBe(source);
    await sync(ws, ['claude'], { adopt: true });
    expect(await readOptional(join(ws.root, '.claude/skills/checks/assets/check.txt'))).toBe(
      'Supporting asset.\n',
    );
    expect(await readOptional(join(ws.root, '.claude/rules/checks.md'))).not.toContain('paths:');
    expect((await sync(ws, ['claude'])).summary).toEqual([]);
  });

  it('retains different instruction sources through filtered, all, and filtered conversions', async () => {
    const { ws, write } = await fixture();
    await write('AGENTS.md', 'Run the test suite.\n');
    await write('CLAUDE.md', 'Review public APIs.\n');
    await convert(ws, 'codex');
    const firstSource = await readOptional(join(ws.agents, 'etymon/rules/instructions.md'));
    await convert(ws);
    await convert(ws, 'claude');
    expect(Object.keys((await ws.manifest()).rule)).toHaveLength(2);
    expect(await readOptional(join(ws.agents, 'etymon/rules/instructions.md'))).toBe(firstSource);
    const ruleResources = (await resources(ws)).filter((resource) => resource.kind === 'rule');
    expect(ruleResources.map((resource) => resource.rule.prompt).sort()).toEqual([
      'Review public APIs.',
      'Run the test suite.',
    ]);
    const manifest = await readOptional(ws.manifestPath);
    await convert(ws);
    expect(await readOptional(ws.manifestPath)).toBe(manifest);
  });

  it('keeps equal rule text with different activation and scope as distinct registrations', async () => {
    const { ws, write } = await fixture();
    await write('AGENTS.md', 'Run checks.\n');
    await write('.claude/rules/checks.md', '---\npaths: src/**\n---\nRun checks.\n');
    await write(
      '.cursor/rules/checks.mdc',
      '---\nalwaysApply: false\nglobs: tests/**\n---\nRun checks.\n',
    );
    await convert(ws);
    const ruleResources = (await resources(ws)).filter((resource) => resource.kind === 'rule');
    expect(ruleResources).toHaveLength(3);
    expect(
      ruleResources
        .filter((resource) => resource.rule.activation === 'glob')
        .map((resource) => resource.rule.patterns),
    ).toEqual([['src/**'], ['tests/**']]);
    const manifest = await readOptional(ws.manifestPath);
    await convert(ws, ['cursor', 'claude']);
    expect(await readOptional(ws.manifestPath)).toBe(manifest);
  });

  it('filters selected tools, normalizes aliases, and accepts multiple filters', async () => {
    const { ws, write } = await fixture();
    await write('AGENTS.md', 'Run checks.\n');
    await write('.mcp.json', JSON.stringify({ mcpServers: { fixture: { command: 'node' } } }));
    await convert(ws, 'codex');
    expect(Object.keys((await ws.manifest()).mcp)).toEqual([]);
    await convert(ws, ['claude-code', 'claude,codex']);
    expect(Object.keys((await ws.manifest()).rule)).toHaveLength(1);
    expect(Object.keys((await ws.manifest()).mcp)).toEqual(['fixture']);
  });

  it('retains shared files explicitly loaded at different scopes or with different activation', async () => {
    const { ws, write } = await fixture();
    await write('packages/api/AGENTS.md', 'Preserve API contracts.\n');
    await write('.claude/rules/types.md', '---\npaths: src/**\n---\nUse explicit types.\n');
    await write(
      'opencode.json',
      JSON.stringify({ instructions: ['packages/api/AGENTS.md', '.claude/rules/types.md'] }),
    );
    await convert(ws);
    const rules = (await resources(ws)).filter((resource) => resource.kind === 'rule');
    expect(rules).toHaveLength(4);
    expect(
      rules
        .filter((resource) => resource.rule.prompt === 'Preserve API contracts.')
        .map((resource) => resource.rule.base)
        .sort(),
    ).toEqual(['.', 'packages/api']);
    expect(
      rules.find((resource) => resource.rule.prompt === 'Use explicit types.')?.rule,
    ).toMatchObject({ activation: 'glob', patterns: ['src/**'] });
    expect(
      rules.find((resource) => resource.rule.prompt.includes('paths: src/**'))?.rule,
    ).toMatchObject({ activation: 'always', base: '.' });
    const manifest = await readOptional(ws.manifestPath);
    await convert(ws);
    expect(await readOptional(ws.manifestPath)).toBe(manifest);
  });

  it.each(['mcp', 'skill', 'agent'] as const)(
    'blocks conflicting %s names before writing any imported source',
    async (kind) => {
      const { ws, write } = await fixture();
      await write('AGENTS.md', 'Run checks.\n');
      if (kind === 'mcp') {
        await write('.mcp.json', JSON.stringify({ mcpServers: { fixture: { command: 'node' } } }));
        await write(
          'opencode.json',
          JSON.stringify({ mcp: { fixture: { type: 'local', command: ['python'] } } }),
        );
      } else if (kind === 'skill') {
        await write('.claude/skills/checks/SKILL.md', skill);
        await write('.agents/skills/checks/SKILL.md', skill);
        await write('.claude/skills/checks/assets/check.txt', 'First asset.\n');
        await write('.agents/skills/checks/assets/check.txt', 'Different asset.\n');
      } else {
        await write(
          '.claude/agents/reviewer.md',
          '---\nname: reviewer\ndescription: Review code\n---\nFirst instructions.\n',
        );
        await write(
          '.github/agents/reviewer.agent.md',
          '---\nname: reviewer\ndescription: Review code\n---\nDifferent instructions.\n',
        );
      }
      await expect(convert(ws)).rejects.toMatchObject({ code: 'IMPORT_COLLISION' });
      expect(await exists(ws.manifestPath)).toBe(false);
      expect(await exists(join(ws.agents, 'etymon'))).toBe(false);
      expect(await readOptional(join(ws.root, 'AGENTS.md'))).toBe('Run checks.\n');
    },
  );

  it('blocks invalid native configuration atomically and still allows an explicit filter', async () => {
    const { ws, write } = await fixture();
    await write('AGENTS.md', 'Run checks.\n');
    await write('.mcp.json', JSON.stringify({ mcpServers: { broken: { type: 'http' } } }));
    const preview = await convert(ws, undefined, { dryRun: true });
    expect(preview.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'INVALID_NATIVE_MCP', severity: 'error' }),
    );
    await expect(convert(ws)).rejects.toMatchObject({ code: 'IMPORT_BLOCKED' });
    expect(await exists(ws.manifestPath)).toBe(false);
    await convert(ws, 'codex');
    expect(Object.keys((await ws.manifest()).rule)).toHaveLength(1);
  });

  it('protects edits to previously imported source during an unfiltered conversion', async () => {
    const { ws, write } = await fixture();
    await write('AGENTS.md', 'Run checks.\n');
    await convert(ws, 'codex');
    const path = (await ws.manifest()).rule.instructions.path;
    await write(
      '.agents/' + path,
      '---\netymon: rule\nname: instructions\n---\nEdited by the author.\n',
    );
    const manifest = await readOptional(ws.manifestPath);
    await expect(convert(ws)).rejects.toMatchObject({ code: 'IMPORT_CONFLICT' });
    expect(await readOptional(ws.manifestPath)).toBe(manifest);
    expect(await readOptional(join(ws.agents, path))).toContain('Edited by the author.');
  });

  it('limits unfiltered global conversion to user resources and standalone guidance', async () => {
    const { ws, write } = await fixture(true);
    await write('.claude/CLAUDE.md', 'Keep responses concise.\n');
    await write('.codex/AGENTS.md', 'Keep responses concise.\n');
    await write('.claude/rules/project.md', '---\npaths: src/**\n---\nProject rule.\n');
    await convert(ws);
    expect(Object.keys((await ws.manifest()).rule)).toHaveLength(1);
    expect((await resources(ws))[0]).toMatchObject({
      kind: 'rule',
      rule: { base: '.', activation: 'always' },
    });
    expect(await exists(join(ws.root, '.gitignore'))).toBe(false);
  });

  it('deduplicates reimported guidance using its edited manifest directory scope', async () => {
    const { ws, write } = await fixture();
    await write('AGENTS.md', 'Preserve API contracts.\n');
    await convert(ws, 'codex');
    const manifest = await ws.manifest();
    manifest.rule.instructions.destDir = 'packages/api';
    await ws.saveManifest(manifest);
    const path = join(ws.agents, manifest.rule.instructions.path);
    const authored = await readOptional(path);
    await fs.unlink(join(ws.root, 'AGENTS.md'));
    await sync(ws, ['codex']);
    await convert(ws);
    expect(Object.keys((await ws.manifest()).rule)).toEqual(['instructions']);
    expect((await resources(ws))[0]).toMatchObject({
      kind: 'rule',
      rule: { base: 'packages/api' },
    });
    expect(await readOptional(path)).toBe(authored);
    expect((await sync(ws, ['codex'])).summary).toEqual([]);
  });

  it('requires one tool when native path overrides are supplied', async () => {
    const { ws } = await fixture();
    await expect(
      convert(ws, undefined, { configPath: join(ws.root, 'custom.json') }),
    ).rejects.toMatchObject({ code: 'CONFIG_PATH_SCOPE' });
    await expect(
      convert(ws, ['claude', 'codex'], { rulesPath: join(ws.root, 'custom') }),
    ).rejects.toMatchObject({ code: 'CONFIG_PATH_SCOPE' });
    expect(await exists(ws.manifestPath)).toBe(false);
  });

  it('reuses existing manifest aliases rather than creating duplicate named resources', async () => {
    const { ws, write } = await fixture();
    await write('.agents/etymon/skills/custom/SKILL.md', skill);
    await write('.claude/skills/checks/SKILL.md', skill);
    await write('.mcp.json', JSON.stringify({ mcpServers: { fixture: { command: 'node' } } }));
    await ws.saveManifest({
      version: 1,
      skill: { custom: { path: 'etymon/skills/custom', name: 'checks' } },
      mcp: {
        custom: {
          name: 'fixture',
          connection: { transport: 'stdio', command: 'node', args: [], env: {} },
        },
      },
      agent: {},
      rule: {},
    });
    await convert(ws);
    const manifest = await ws.manifest();
    expect(Object.keys(manifest.skill)).toEqual(['custom']);
    expect(Object.keys(manifest.mcp)).toEqual(['custom']);
    expect(manifest.skill.custom.name).toBe('checks');
    expect(manifest.mcp.custom.name).toBe('fixture');
    expect((await resources(ws)).map((resource) => resource.name).sort()).toEqual([
      'checks',
      'fixture',
    ]);
  });

  it('initializes an empty project and rejects an unknown filter without importing files', async () => {
    const { ws } = await fixture();
    await expect(convert(ws, 'unknown')).rejects.toMatchObject({ code: 'UNKNOWN_HARNESS' });
    expect(await exists(ws.manifestPath)).toBe(false);
    expect((await convert(ws)).resources).toEqual([]);
    expect(await exists(ws.manifestPath)).toBe(true);
    expect((await ws.lock()).dependencies).toEqual([]);
  });
});
