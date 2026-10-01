import { isAbsolute, join } from 'node:path';
import { Workspace } from '../core/workspace.js';
import type { RuleDialect } from '../providers/rules.js';

export type RuleSource = {
  path: string;
  dialect?: RuleDialect;
  directory?: boolean;
  tree?: boolean;
  flat?: boolean;
  // Files in one group compete at each directory scope; earlier entries win.
  group?: string;
  mode?: string;
  directoryScope?: boolean;
};
export type RuleProfile = {
  file?: [string, string];
  modular?: [string, string];
  dialect?: RuleDialect;
  nested?: boolean;
  project: RuleSource[];
  global: RuleSource[];
  sources: string[];
  notes?: string[];
};
const file = (path: string, tree = false, group?: string): RuleSource => ({
  path,
  dialect: 'plain',
  tree,
  group,
});
const dir = (path: string, dialect: RuleDialect, tree = false, flat = false): RuleSource => ({
  path,
  dialect,
  directory: true,
  tree,
  flat,
});
const agents = (nested = true, group?: string) => file('AGENTS.md', nested, group);
const github =
  'https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions';
export const ruleProfiles: Record<string, RuleProfile> = {
  claude: {
    file: ['AGENTS.md', '.claude/CLAUDE.md'],
    modular: ['.claude/rules', '.claude/rules'],
    dialect: 'claude',
    nested: true,
    project: [
      file('CLAUDE.md', true),
      file('.claude/CLAUDE.md', true),
      agents(),
      dir('.claude/rules', 'claude', true),
    ],
    global: [file('.claude/CLAUDE.md'), dir('.claude/rules', 'claude')],
    sources: ['https://code.claude.com/docs/en/memory'],
    notes: [
      'Native AGENTS.md needs Claude Code >=2.1.277 and its built-in agents-md plugin. User instructions remain ~/.claude/CLAUDE.md. Existing project CLAUDE.md/CLAUDE.local.md can suppress AGENTS.md discovery.',
    ],
  },
  codex: {
    file: ['AGENTS.md', '.codex/AGENTS.md'],
    nested: true,
    project: [file('AGENTS.override.md', true, 'context'), agents(true, 'context')],
    global: [
      file('.codex/AGENTS.override.md', false, 'context'),
      file('.codex/AGENTS.md', false, 'context'),
    ],
    sources: ['https://learn.chatgpt.com/docs/agent-configuration/agents-md'],
    notes: [
      'One instruction file per directory: AGENTS.override.md wins. Instructions load along the working-directory chain at session start; default combined limit is 32 KiB. Exec-policy .rules files are a separate feature.',
    ],
  },
  'copilot-cli': {
    file: ['AGENTS.md', '.copilot/copilot-instructions.md'],
    modular: ['.github/instructions', '.copilot/instructions'],
    dialect: 'copilot',
    nested: true,
    project: [
      agents(),
      file('CLAUDE.md', true),
      file('.claude/CLAUDE.md', true),
      file('GEMINI.md', true),
      file('.github/copilot-instructions.md', true),
      dir('.github/instructions', 'copilot'),
      dir('.claude/rules', 'copilot'),
    ],
    global: [file('.copilot/copilot-instructions.md'), dir('.copilot/instructions', 'copilot')],
    sources: [
      github,
      'https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference',
    ],
  },
  'copilot-cloud': {
    file: ['AGENTS.md', ''],
    modular: ['.github/instructions', ''],
    dialect: 'copilot',
    nested: true,
    project: [
      agents(),
      file('CLAUDE.md'),
      file('GEMINI.md'),
      file('.github/copilot-instructions.md'),
      dir('.github/instructions', 'copilot'),
    ],
    global: [],
    sources: [
      'https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions',
    ],
    notes: [
      'Project scope only. Commit instruction files for the cloud agent; excludeAgent restrictions are retained.',
    ],
  },
  'vscode-local': {
    file: ['AGENTS.md', ''],
    modular: ['.github/instructions', ''],
    dialect: 'copilot',
    nested: false,
    project: [
      agents(),
      file('.github/copilot-instructions.md'),
      file('CLAUDE.md'),
      file('.claude/CLAUDE.md'),
      dir('.github/instructions', 'copilot'),
      dir('.claude/rules', 'claude'),
    ],
    global: [],
    sources: ['https://code.visualstudio.com/docs/agent-customization/custom-instructions'],
    notes: [
      'Local agent AGENTS.md depends on chat.useAgentsMdFile. Nested discovery is disabled by default; Etymon writes directory guidance as applyTo instructions. User profile rule directories are excluded by Etymon global scope policy.',
    ],
  },
  gemini: {
    file: ['AGENTS.md', '.gemini/AGENTS.md'],
    nested: true,
    project: [file('GEMINI.md', true)],
    global: [file('.gemini/GEMINI.md')],
    sources: ['https://geminicli.com/docs/cli/gemini-md/'],
    notes: [
      'Etymon adds AGENTS.md to context.fileName in the scoped settings.json, retaining existing filenames and the default GEMINI.md. Arbitrary glob and manual activation have no verified writer.',
    ],
  },
  kiro: {
    file: ['AGENTS.md', '.kiro/steering/AGENTS.md'],
    modular: ['.kiro/steering', '.kiro/steering'],
    dialect: 'kiro',
    nested: false,
    project: [{ ...agents(), directoryScope: false }, dir('.kiro/steering', 'kiro')],
    global: [dir('.kiro/steering', 'kiro')],
    sources: ['https://kiro.dev/docs/steering/'],
    notes: [
      'Discovered AGENTS.md files are always included, including subdirectories. Etymon uses fileMatch steering for directory scopes. Custom agents need steering resources declared explicitly.',
    ],
  },
  pi: {
    file: ['AGENTS.md', '.pi/agent/AGENTS.md'],
    nested: true,
    project: [
      file('AGENTS.override.md', true, 'context'),
      agents(true, 'context'),
      file('CLAUDE.md', true, 'context'),
    ],
    global: [
      file('.pi/agent/AGENTS.override.md', false, 'context'),
      file('.pi/agent/AGENTS.md', false, 'context'),
      file('.pi/agent/CLAUDE.md', false, 'context'),
    ],
    sources: [
      'https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/core/resource-loader.ts',
    ],
    notes: [
      'Context loads from the launch-directory ancestor chain. AGENTS.override.md has precedence. PI_CODING_AGENT_DIR relocates personal context. No verified conditional rule writer.',
    ],
  },
  omp: {
    file: ['AGENTS.md', '.omp/agent/AGENTS.md'],
    modular: ['.claude/rules', '.claude/rules'],
    dialect: 'claude',
    nested: true,
    project: [
      file('.omp/AGENTS.md', true, 'context'),
      file('.claude/CLAUDE.md', false, 'context'),
      file('.agent/AGENTS.md', true, 'context'),
      file('.agents/AGENTS.md', true, 'context'),
      file('.gemini/GEMINI.md', false, 'context'),
      file('.github/copilot-instructions.md', false, 'context'),
      agents(true, 'context'),
      file('.omp/RULES.md'),
      dir('.claude/rules', 'claude'),
      dir('.cursor/rules', 'cursor'),
      dir('.github/instructions', 'copilot'),
    ],
    global: [
      file('.omp/agent/AGENTS.md', false, 'context'),
      file('.claude/CLAUDE.md', false, 'context'),
      file('.agent/AGENTS.md', false, 'context'),
      file('.agents/AGENTS.md', false, 'context'),
      file('.codex/AGENTS.md', false, 'context'),
      file('.gemini/GEMINI.md', false, 'context'),
      file('.config/opencode/AGENTS.md', false, 'context'),
      file('.copilot/copilot-instructions.md', false, 'context'),
      file('.omp/agent/RULES.md'),
    ],
    sources: ['https://omp.sh/docs/context-files'],
    notes: [
      'A higher-priority context provider can shadow standalone AGENTS.md. Named omp profiles have separate personal directories; default profile is targeted here. Conditional rules depend on enabled discovery providers.',
    ],
  },
  opencode: {
    file: ['AGENTS.md', '.config/opencode/AGENTS.md'],
    nested: true,
    project: [agents(true, 'context'), file('CLAUDE.md', true, 'context')],
    global: [
      file('.config/opencode/AGENTS.md', false, 'context'),
      file('.claude/CLAUDE.md', false, 'context'),
    ],
    sources: ['https://opencode.ai/docs/rules/'],
    notes: [
      'AGENTS.md is preferred over CLAUDE.md. Configured instructions files and globs add unconditional context; those globs select instruction files, not the files a rule applies to.',
    ],
  },
  cursor: {
    file: ['AGENTS.md', ''],
    modular: ['.cursor/rules', ''],
    dialect: 'cursor',
    nested: true,
    project: [agents(), dir('.cursor/rules', 'cursor', true), file('.cursorrules')],
    global: [],
    sources: ['https://cursor.com/docs/rules'],
    notes: [
      'Scoped project rules require .mdc. User/team rules live in Customize/the dashboard; no verified global filesystem writer.',
    ],
  },
  antigravity: {
    file: ['AGENTS.md', '.gemini/AGENTS.md'],
    modular: ['.agents/rules', '.gemini/config/rules'],
    dialect: 'trigger',
    nested: true,
    project: [
      agents(),
      file('GEMINI.md', true),
      file('.agents/AGENTS.md', true),
      file('.agents/GEMINI.md', true),
      dir('.agents/rules', 'trigger', true, true),
      dir('.agent/rules', 'trigger', true, true),
    ],
    global: [
      file('.gemini/AGENTS.md'),
      file('.gemini/GEMINI.md'),
      file('.gemini/config/AGENTS.md'),
      file('.gemini/config/GEMINI.md'),
      dir('.gemini/config/rules', 'trigger', false, true),
      dir('.gemini/antigravity-cli/rules', 'trigger', false, true),
    ],
    sources: ['https://antigravity.google/docs/rules'],
    notes: [
      'Modular rules require valid trigger frontmatter. Unregistered nested files inside a rules directory are ignored; generated rules are flat.',
    ],
  },
  roo: {
    file: ['AGENTS.md', ''],
    modular: ['.roo/rules', '.roo/rules'],
    dialect: 'plain',
    nested: false,
    project: [
      file('AGENTS.md', false, 'context'),
      file('AGENT.md', false, 'context'),
      { ...dir('.roo/rules', 'plain'), group: 'rules' },
      { ...file('.roorules'), group: 'rules' },
    ],
    global: [dir('.roo/rules', 'plain')],
    sources: ['https://roocodeinc.github.io/Roo-Code/features/custom-instructions/'],
    notes: [
      'Root AGENTS.md loads by default unless roo-cline.useAgentRules is false. Mode-specific rules are preserved in rules-<mode>; no verified file-glob activation.',
    ],
  },
  cline: {
    file: ['AGENTS.md', '.agents/AGENTS.md'],
    modular: ['.cline/rules', '.cline/rules'],
    dialect: 'cline',
    nested: false,
    project: [
      file('AGENTS.md'),
      dir('.cline/rules', 'cline'),
      dir('.clinerules', 'cline'),
      file('.cursorrules'),
      file('.windsurfrules'),
    ],
    global: [
      file('.agents/AGENTS.md'),
      dir('.cline/rules', 'cline'),
      dir('Documents/Cline/Rules', 'cline'),
      dir('Cline/Rules', 'cline'),
    ],
    sources: ['https://docs.cline.bot/customization/cline-rules'],
    notes: [
      'Both .cline/rules and .clinerules are searched. An empty paths array disables a rule. Cline native toggles may disable imported rules; verify in the Rules panel.',
    ],
  },
  kilo: {
    file: ['AGENTS.md', '.config/kilo/AGENTS.md'],
    nested: true,
    project: [
      agents(true, 'context'),
      file('AGENT.md', true, 'context'),
      dir('.kilocode/rules', 'plain'),
    ],
    global: [file('.config/kilo/AGENTS.md')],
    sources: [
      'https://kilo.ai/docs/customize/agents-md',
      'https://kilo.ai/docs/customize/custom-rules',
    ],
    notes: [
      'Current Kilo uses instructions in kilo.json(c) for additional context. Rules in .kilo/rules must be referenced; arbitrary conditional activation is unsupported.',
    ],
  },
  continue: {
    modular: ['.continue/rules', '.continue/rules'],
    dialect: 'continue',
    nested: false,
    project: [dir('.continue/rules', 'continue')],
    global: [dir('.continue/rules', 'continue')],
    sources: [
      'https://docs.continue.dev/customize/deep-dives/rules',
      'https://docs.continue.dev/guides/configuring-models-rules-tools',
    ],
    notes: [
      'Continue rules use Markdown frontmatter. regex and combined model/glob activation remain native; default cross-harness conversion blocks unmapped semantics; --allow-lossy reports omitted conditions.',
    ],
  },
  windsurf: {
    file: ['AGENTS.md', '.codeium/windsurf/memories/global_rules.md'],
    modular: ['.devin/rules', ''],
    dialect: 'trigger',
    nested: true,
    project: [
      agents(),
      { ...dir('.devin/rules', 'trigger', true), group: 'rules' },
      { ...dir('.windsurf/rules', 'trigger', true), group: 'rules' },
      file('.windsurfrules'),
    ],
    global: [file('.codeium/windsurf/memories/global_rules.md')],
    sources: ['https://docs.devin.ai/desktop/cascade/memories'],
    notes: [
      'Targets Cascade rules. .devin is preferred over .windsurf. Global guidance is always on (6000 characters); project rule limit is 12000 characters.',
    ],
  },
  amp: {
    file: ['AGENTS.md', '.config/amp/AGENTS.md'],
    modular: ['.agents/etymon-output/amp/rules', '.config/amp/etymon/rules'],
    dialect: 'amp',
    nested: true,
    project: [
      agents(true, 'context'),
      file('AGENT.md', true, 'context'),
      file('CLAUDE.md', true, 'context'),
    ],
    global: [file('.config/amp/AGENTS.md'), file('.config/AGENTS.md')],
    sources: ['https://ampcode.com/docs/customize/agents-md'],
    notes: [
      'Glob guidance must be @-referenced from AGENTS.md. Etymon uses explicit relative patterns to avoid Amp implicit **/ prefix broadening.',
    ],
  },
  zed: {
    file: ['AGENTS.md', '.config/zed/AGENTS.md'],
    nested: false,
    project: [
      '.rules',
      '.cursorrules',
      '.windsurfrules',
      '.clinerules',
      '.github/copilot-instructions.md',
      'AGENT.md',
      'AGENTS.md',
      'CLAUDE.md',
      'GEMINI.md',
    ].map((path) => file(path, false, 'context')),
    global: [file('.config/zed/AGENTS.md')],
    sources: ['https://zed.dev/docs/ai/instructions'],
    notes: [
      'Zed native agent uses the first matching compatibility file. Earlier .rules/.cursorrules/etc can shadow AGENTS.md. No verified scoped or manual writer. External agents use their own loaders.',
    ],
  },
};
export function ruleLocation(path: string, workspace: Workspace, harness: string): string {
  if (isAbsolute(path)) return path;
  if (workspace.global && !workspace.homeOverride) {
    const prefixes: [string, string | undefined][] = [
      ['.codex/', harness === 'codex' ? process.env.CODEX_HOME : undefined],
      ['.claude/', process.env.CLAUDE_CONFIG_DIR],
      ['.copilot/', process.env.COPILOT_HOME],
      ['.pi/agent/', harness === 'pi' ? process.env.PI_CODING_AGENT_DIR : undefined],
      ['.config/', process.env.XDG_CONFIG_HOME],
    ];
    for (const [prefix, target] of prefixes)
      if (target && path.startsWith(prefix)) return join(target, path.slice(prefix.length));
  }
  return join(workspace.root, path);
}
