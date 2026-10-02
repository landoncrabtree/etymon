import { join } from 'node:path';
import { EtymonError } from '../core/model.js';
import { Workspace } from '../core/workspace.js';
import { ruleProfiles, RuleProfile } from './rule-profiles.js';
import { commandProfiles } from './command-profiles.js';
import { skillControls } from './skill-profiles.js';

export type AgentDialect =
  | 'claude'
  | 'codex'
  | 'copilot'
  | 'opencode'
  | 'gemini'
  | 'kiro'
  | 'cursor'
  | 'omp'
  | 'antigravity';
export type McpDialect =
  | 'standard'
  | 'codex'
  | 'copilot'
  | 'vscode'
  | 'gemini'
  | 'opencode'
  | 'antigravity'
  | 'amp'
  | 'continue'
  | 'zed'
  | 'cline';
export type Profile = {
  id: string;
  label: string;
  aliases?: string[];
  command?: string;
  skill?: [string, string];
  agent?: [string, string];
  agentDialect?: AgentDialect;
  rule?: RuleProfile;
  mcp?: [string, string];
  mcpDialect?: McpDialect;
  map?: string;
  notes?: string[];
  sources: string[];
  projectOnly?: boolean;
  globalMcpOnly?: boolean;
};
export const profiles: Profile[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    aliases: ['claude-code'],
    command: 'claude',
    skill: ['.claude/skills', '.claude/skills'],
    agent: ['.claude/agents', '.claude/agents'],
    agentDialect: 'claude',
    mcp: ['.mcp.json', '.claude.json'],
    mcpDialect: 'standard',
    map: 'mcpServers',
    sources: [
      'https://code.claude.com/docs/en/skills',
      'https://code.claude.com/docs/en/sub-agents',
      'https://code.claude.com/docs/en/mcp',
    ],
    notes: ['Project MCP servers may require native approval.'],
  },
  {
    id: 'codex',
    label: 'Codex',
    command: 'codex',
    skill: ['.agents/skills', '.agents/skills'],
    agent: ['.codex/agents', '.codex/agents'],
    agentDialect: 'codex',
    mcp: ['.codex/config.toml', '.codex/config.toml'],
    mcpDialect: 'codex',
    map: 'mcp_servers',
    sources: [
      'https://learn.chatgpt.com/docs/agent-configuration/subagents',
      'https://learn.chatgpt.com/docs/extend/mcp?surface=cli',
    ],
    notes: ['Project configuration is loaded only in trusted projects.'],
  },
  {
    id: 'copilot-cli',
    label: 'GitHub Copilot CLI',
    aliases: ['copilot', 'github-copilot'],
    command: 'copilot',
    skill: ['.github/skills', '.copilot/skills'],
    agent: ['.github/agents', '.copilot/agents'],
    agentDialect: 'copilot',
    mcp: ['.github/mcp.json', '.copilot/mcp-config.json'],
    mcpDialect: 'copilot',
    map: 'mcpServers',
    sources: [
      'https://docs.github.com/en/copilot/reference/custom-agents-configuration',
      'https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers',
    ],
    notes: [
      'Project MCP configuration requires a Git repository and folder trust. Root .mcp.json has precedence.',
    ],
  },
  {
    id: 'copilot-cloud',
    label: 'GitHub Copilot cloud',
    skill: ['.github/skills', ''],
    agent: ['.github/agents', ''],
    agentDialect: 'copilot',
    projectOnly: true,
    sources: [
      'https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp/extend-copilot-coding-agent-with-mcp',
    ],
    notes: [
      'Commit generated repository resources or use a bootstrap. MCP uses repository service settings; no local writer.',
    ],
  },
  {
    id: 'vscode-local',
    label: 'VS Code Local',
    aliases: ['vscode'],
    command: 'code',
    skill: ['.github/skills', '.copilot/skills'],
    agent: ['.github/agents', '.copilot/agents'],
    agentDialect: 'copilot',
    mcp: ['.vscode/mcp.json', ''],
    mcpDialect: 'vscode',
    map: 'servers',
    sources: [
      'https://code.visualstudio.com/docs/copilot/customization/custom-agents',
      'https://code.visualstudio.com/docs/copilot/customization/mcp-servers',
    ],
    notes: ['Global MCP configuration needs a resolved editor profile; use --config-path.'],
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    aliases: ['gemini-cli'],
    command: 'gemini',
    skill: ['.gemini/skills', '.gemini/skills'],
    agent: ['.gemini/agents', '.gemini/agents'],
    agentDialect: 'gemini',
    mcp: ['.gemini/settings.json', '.gemini/settings.json'],
    mcpDialect: 'gemini',
    map: 'mcpServers',
    sources: [
      'https://geminicli.com/docs/core/subagents/',
      'https://geminicli.com/docs/tools/mcp-server/',
      'https://geminicli.com/docs/cli/trusted-folders/',
    ],
    notes: [
      'Custom subagents require the native experimental.enableAgents setting. Etymon does not enable it automatically.',
      'Workspace skills and MCP settings require a trusted Gemini workspace. Etymon does not grant trust.',
    ],
  },
  {
    id: 'kiro',
    label: 'Kiro CLI 3 / IDE 1',
    aliases: ['kiro-cli'],
    command: 'kiro-cli',
    skill: ['.kiro/skills', '.kiro/skills'],
    agent: ['.kiro/agents', '.kiro/agents'],
    agentDialect: 'kiro',
    mcp: ['.kiro/settings/mcp.json', '.kiro/settings/mcp.json'],
    mcpDialect: 'standard',
    map: 'mcpServers',
    sources: [
      'https://kiro.dev/docs/custom-agents/configuration-reference/',
      'https://kiro.dev/docs/mcp/',
    ],
  },
  {
    id: 'pi',
    label: 'Pi',
    command: 'pi',
    skill: ['.pi/skills', '.pi/agent/skills'],
    mcp: ['.pi/mcp.json', '.pi/agent/mcp.json'],
    mcpDialect: 'standard',
    map: 'mcpServers',
    sources: [
      'https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/mcp.md',
    ],
    notes: [
      'Agents need the pinned subagent extension; no native agent writer. MCP needs the built-in MCP extension. Legacy SSE is unsupported.',
    ],
  },
  {
    id: 'omp',
    label: 'Oh My Pi',
    aliases: ['oh-my-pi'],
    command: 'omp',
    skill: ['.omp/skills', '.omp/agent/skills'],
    agent: ['.omp/agents', '.omp/agent/agents'],
    agentDialect: 'omp',
    mcp: ['.omp/mcp.json', '.omp/agent/mcp.json'],
    mcpDialect: 'standard',
    map: 'mcpServers',
    sources: ['https://omp.sh/docs/subagent-authoring', 'https://omp.sh/docs/mcp'],
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    command: 'opencode',
    skill: ['.opencode/skills', '.config/opencode/skills'],
    agent: ['.opencode/agents', '.config/opencode/agents'],
    agentDialect: 'opencode',
    mcp: ['opencode.json', '.config/opencode/opencode.json'],
    mcpDialect: 'opencode',
    map: 'mcp',
    sources: [
      'https://opencode.ai/docs/agents/',
      'https://opencode.ai/docs/mcp-servers/',
      'https://opencode.ai/docs/config/',
    ],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    command: 'cursor-agent',
    skill: ['.cursor/skills', '.cursor/skills'],
    agent: ['.cursor/agents', '.cursor/agents'],
    agentDialect: 'cursor',
    mcp: ['.cursor/mcp.json', '.cursor/mcp.json'],
    mcpDialect: 'standard',
    map: 'mcpServers',
    sources: ['https://cursor.com/docs/subagents', 'https://cursor.com/docs/context/mcp'],
  },
  {
    id: 'antigravity',
    label: 'Antigravity CLI',
    aliases: ['antigravity-cli'],
    command: 'antigravity',
    skill: ['.agents/skills', '.gemini/antigravity-cli/skills'],
    agent: ['.agents/agents', '.gemini/config/agents'],
    agentDialect: 'antigravity',
    mcp: ['.agents/mcp_config.json', '.gemini/config/mcp_config.json'],
    mcpDialect: 'antigravity',
    map: 'mcpServers',
    sources: ['https://antigravity.google/docs/subagents/', 'https://antigravity.google/docs/mcp/'],
    notes: ['This profile targets the documented CLI surface; IDE parity is not certified.'],
  },
  {
    id: 'roo',
    label: 'Roo Code',
    aliases: ['roo-code'],
    skill: ['.roo/skills', '.roo/skills'],
    mcp: ['.roo/mcp.json', ''],
    mcpDialect: 'standard',
    map: 'mcpServers',
    sources: ['https://docs.roocode.com/features/mcp/using-mcp-in-roo'],
    notes: [
      'Custom modes are personas; no isolated agent writer. User MCP settings need --config-path from the editor.',
    ],
  },
  {
    id: 'cline',
    label: 'Cline',
    command: 'cline',
    skill: ['.cline/skills', '.cline/skills'],
    mcpDialect: 'cline',
    map: 'mcpServers',
    sources: [
      'https://docs.cline.bot/getting-started/configuration',
      'https://docs.cline.bot/mcp/mcp-overview',
    ],
    notes: [
      'Agent loader and MCP path differ by surface/release. MCP needs an explicit --config-path; no speculative agent writer.',
    ],
  },
  {
    id: 'kilo',
    label: 'Kilo Code',
    command: 'kilo',
    skill: ['.kilo/skills', '.kilo/skills'],
    agent: ['.kilo/agents', '.config/kilo/agents'],
    agentDialect: 'opencode',
    mcp: ['kilo.json', '.config/kilo/kilo.json'],
    mcpDialect: 'opencode',
    map: 'mcp',
    sources: [
      'https://kilo.ai/docs/customize/custom-subagents',
      'https://kilo.ai/docs/customize/mcp',
    ],
  },
  {
    id: 'continue',
    label: 'Continue',
    mcp: ['.continue/mcpServers', ''],
    mcpDialect: 'continue',
    sources: ['https://docs.continue.dev/customize/deep-dives/mcp'],
    notes: [
      'No verified standalone Agent Skills or isolated agent writer. Global MCP export needs a native destination via --config-path.',
    ],
  },
  {
    id: 'windsurf',
    label: 'Devin Cascade / Windsurf',
    aliases: ['devin'],
    skill: ['.devin/skills', '.config/devin/skills'],
    mcp: ['', '.config/devin/mcp_config.json'],
    mcpDialect: 'standard',
    map: 'mcpServers',
    globalMcpOnly: true,
    sources: ['https://docs.devin.ai/desktop/cascade/mcp'],
    notes: [
      'No verified project MCP or reusable agent writer. Legacy Windsurf paths are not selected implicitly.',
    ],
  },
  {
    id: 'amp',
    label: 'Amp',
    command: 'amp',
    skill: ['.agents/skills', '.config/agents/skills'],
    mcp: ['.amp/settings.json', '.config/amp/settings.json'],
    mcpDialect: 'amp',
    map: 'amp.mcpServers',
    sources: ['https://ampcode.com/docs/customize/mcp'],
    notes: ['Custom agents require an executable plugin bridge; no guessed Markdown writer.'],
  },
  {
    id: 'zed',
    label: 'Zed native agent',
    command: 'zed',
    skill: ['.agents/skills', '.agents/skills'],
    mcpDialect: 'zed',
    map: 'context_servers',
    sources: ['https://zed.dev/docs/ai/mcp', 'https://zed.dev/docs/ai/agent-panel'],
    notes: [
      'MCP needs an active settings file via --config-path. Native profiles are not isolated agents.',
    ],
  },
];
for (const p of profiles) {
  p.rule = ruleProfiles[p.id];
  // Etymon's user scope deliberately contains standing guidance only. Native
  // modular user locations are documented separately, never selected as writers.
  p.rule.global = p.rule.global.filter((source) => !source.directory);
  if (p.rule.file?.[1] && !p.rule.global.some((source) => source.path === p.rule!.file![1]))
    p.rule.global.push({ path: p.rule.file[1], dialect: 'plain' });
  if (p.rule.modular) p.rule.modular[1] = '';
  p.sources.push(...p.rule.sources);
  p.sources.push(
    ...(commandProfiles[p.id]?.sources ?? []),
    ...(skillControls[p.id]?.sources ?? []),
  );
}
export function profile(input: string): Profile {
  const found = profiles.find((p) => p.id === input || p.aliases?.includes(input));
  if (!found)
    throw new EtymonError('UNKNOWN_HARNESS', `Unknown harness ${input}. Run etymon harnesses.`);
  return found;
}
export function location(
  p: Profile,
  kind: 'skill' | 'agent' | 'mcp',
  workspace: Workspace,
  configPath?: string,
): string | undefined {
  if (workspace.global && p.projectOnly) return undefined;
  if (kind === 'mcp' && configPath) return configPath;
  const tuple = p[kind];
  if (!tuple) return undefined;
  const subpath = tuple[workspace.global ? 1 : 0];
  if (!subpath) return undefined;
  if (workspace.global) {
    if (!workspace.homeOverride && p.id === 'codex' && kind !== 'skill' && process.env.CODEX_HOME)
      return join(process.env.CODEX_HOME, subpath.replace(/^\.codex\//, ''));
    if (
      !workspace.homeOverride &&
      p.id === 'claude' &&
      kind !== 'mcp' &&
      process.env.CLAUDE_CONFIG_DIR
    )
      return join(process.env.CLAUDE_CONFIG_DIR, subpath.replace(/^\.claude\//, ''));
    if (!workspace.homeOverride && p.id === 'copilot-cli' && process.env.COPILOT_HOME)
      return join(process.env.COPILOT_HOME, subpath.replace(/^\.copilot\//, ''));
    if (!workspace.homeOverride && subpath.startsWith('.config/') && process.env.XDG_CONFIG_HOME)
      return join(process.env.XDG_CONFIG_HOME, subpath.slice(8));
  }
  return join(workspace.root, subpath);
}
export function agentExtension(p: Profile): string {
  return p.agentDialect === 'codex'
    ? '.toml'
    : p.agentDialect === 'copilot'
      ? '.agent.md'
      : p.agentDialect === 'kiro'
        ? '.json'
        : '.md';
}
