import type { CommandFormat } from '../core/commands.js';
import type { Workspace } from '../core/workspace.js';
import { ruleLocation } from './rule-profiles.js';

export type CommandSource = {
  path: string;
  format: CommandFormat;
  recursive?: boolean;
  namespace?: boolean;
  config?: boolean;
  tree?: boolean;
};
export type CommandProfile = {
  project: CommandSource[];
  global: CommandSource[];
  sources: string[];
};
const dir = (path: string, format: CommandFormat, recursive = true): CommandSource => ({
  path,
  format,
  recursive,
});
const config = (path: string, format: CommandFormat): CommandSource => ({
  path,
  format,
  config: true,
});
const same = (path: string, format: CommandFormat, sources: string[]): CommandProfile => ({
  project: [dir(path, format)],
  global: [dir(path, format)],
  sources,
});

/** Native readers only. Writers always produce modern skill bundles. */
export const commandProfiles: Record<string, CommandProfile> = {
  claude: same('.claude/commands', 'claude', ['https://code.claude.com/docs/en/skills']),
  codex: {
    project: [],
    global: [dir('.codex/prompts', 'codex', false)],
    sources: [
      'https://learn.chatgpt.com/docs/custom-prompts',
      'https://learn.chatgpt.com/docs/build-skills',
    ],
  },
  'copilot-cli': same('.claude/commands', 'claude', [
    'https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference',
  ]),
  cursor: same('.cursor/commands', 'cursor', [
    'https://docs.cursor.com/en/agent/chat/commands',
    'https://forum.cursor.com/t/can-i-have-few-commands-folders-in-one-repo/145901/2',
  ]),
  gemini: {
    project: [{ ...dir('.gemini/commands', 'gemini'), namespace: true }],
    global: [{ ...dir('.gemini/commands', 'gemini'), namespace: true }],
    sources: ['https://geminicli.com/docs/cli/custom-commands/'],
  },
  opencode: {
    project: [
      config('opencode.json', 'opencode'),
      config('opencode.jsonc', 'opencode'),
      config('.opencode/opencode.json', 'opencode'),
      config('.opencode/opencode.jsonc', 'opencode'),
      { ...dir('.opencode/command', 'opencode'), namespace: true },
      { ...dir('.opencode/commands', 'opencode'), namespace: true },
    ],
    global: [
      config('.config/opencode/config.json', 'opencode'),
      config('.config/opencode/opencode.json', 'opencode'),
      config('.config/opencode/opencode.jsonc', 'opencode'),
      { ...dir('.config/opencode/command', 'opencode'), namespace: true },
      { ...dir('.config/opencode/commands', 'opencode'), namespace: true },
    ],
    sources: [
      'https://opencode.ai/docs/commands/',
      'https://raw.githubusercontent.com/anomalyco/opencode/v1.18.30/packages/opencode/src/config/command.ts',
      'https://raw.githubusercontent.com/anomalyco/opencode/v1.18.30/packages/opencode/src/config/config.ts',
    ],
  },
  kilo: {
    project: [
      dir('.kilo/commands', 'kilo'),
      dir('.kilocode/workflows', 'kilo'),
      config('kilo.json', 'kilo'),
      config('kilo.jsonc', 'kilo'),
    ],
    global: [
      dir('.config/kilo/commands', 'kilo'),
      config('.config/kilo/kilo.json', 'kilo'),
      config('.config/kilo/kilo.jsonc', 'kilo'),
    ],
    sources: ['https://kilo.ai/docs/customize/workflows'],
  },
  amp: {
    project: [dir('.agents/commands', 'amp')],
    global: [dir('.config/amp/commands', 'amp')],
    sources: ['https://ampcode.com/news/slashing-custom-commands'],
  },
  roo: same('.roo/commands', 'roo', [
    'https://roocodeinc.github.io/Roo-Code/features/slash-commands/',
  ]),
  cline: {
    project: [dir('.clinerules/workflows', 'cline')],
    global: [dir('Documents/Cline/Workflows', 'cline')],
    sources: [
      'https://raw.githubusercontent.com/cline/cline/main/apps/vscode/src/core/storage/disk.ts',
      'https://raw.githubusercontent.com/cline/cline/main/apps/vscode/src/sdk/slash-command-expansion.ts',
    ],
  },
  windsurf: {
    project: [
      { ...dir('.devin/workflows', 'windsurf'), tree: true },
      { ...dir('.windsurf/workflows', 'windsurf'), tree: true },
    ],
    global: [dir('.codeium/windsurf/global_workflows', 'windsurf')],
    sources: ['https://docs.devin.ai/desktop/cascade/workflows'],
  },
  antigravity: {
    project: [dir('.agents/workflows', 'antigravity'), dir('.agent/workflows', 'antigravity')],
    global: [dir('.gemini/config/workflows', 'antigravity')],
    sources: [
      'https://www.antigravity.google/docs/ide/workflows/',
      'https://www.antigravity.google/docs/migration/workflows-to-skills/',
    ],
  },
  pi: {
    project: [dir('.pi/prompts', 'pi', false)],
    global: [dir('.pi/agent/prompts', 'pi', false)],
    sources: [
      'https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/prompt-templates.md',
    ],
  },
  omp: {
    project: [dir('.omp/prompts', 'omp')],
    global: [dir('.omp/agent/prompts', 'omp')],
    sources: ['https://omp.sh/docs/prompt-templates'],
  },
  kiro: {
    project: [dir('.kiro/prompts', 'kiro'), dir('.amazonq/prompts', 'kiro')],
    global: [dir('.kiro/prompts', 'kiro'), dir('.aws/amazonq/prompts', 'kiro')],
    sources: [
      'https://kiro.dev/docs/cli/chat/manage-prompts/',
      'https://kiro.dev/docs/cli/migrating-from-q/',
    ],
  },
  continue: {
    project: [config('.continue/config.json', 'continue')],
    global: [config('.continue/config.json', 'continue')],
    sources: [
      'https://raw.githubusercontent.com/continuedev/continue/main/core/commands/slash/customSlashCommand.ts',
    ],
  },
};

export function commandLocation(source: CommandSource, workspace: Workspace, id: string): string {
  return ruleLocation(source.path, workspace, id);
}

/** Workflows stored below a compatibility rule folder are separate resources. */
export function isCommandDirectoryFile(path: string): boolean {
  const normalized = '/' + path.replaceAll('\\', '/');
  return Object.values(commandProfiles).some((p) =>
    p.project.some((source) => !source.config && normalized.includes('/' + source.path + '/')),
  );
}
