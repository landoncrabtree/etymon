import { join } from 'node:path';
import { Kind } from '../core/model.js';
import { Workspace } from '../core/workspace.js';
import { location, Profile } from './profiles.js';
import { ruleLocation } from './rule-profiles.js';

// Read aliases are intentionally independent of the preferred write location.
// The same list drives import and doctor so discovery cannot drift between them.
const skillAliases: Record<string, [string[], string[]]> = {
  codex: [['.codex/skills'], ['.codex/skills']],
  'copilot-cli': [
    ['.agents/skills', '.claude/skills'],
    ['.agents/skills', '.claude/skills'],
  ],
  'copilot-cloud': [['.claude/skills'], []],
  'vscode-local': [
    ['.agents/skills', '.claude/skills'],
    ['.agents/skills', '.claude/skills'],
  ],
  gemini: [['.agents/skills'], ['.agents/skills']],
  opencode: [
    ['.agents/skills', '.claude/skills'],
    ['.agents/skills', '.claude/skills'],
  ],
  cursor: [
    ['.agents/skills', '.claude/skills'],
    ['.agents/skills', '.claude/skills'],
  ],
  kilo: [
    ['.agents/skills', '.claude/skills'],
    ['.agents/skills', '.claude/skills'],
  ],
  cline: [['.claude/skills', '.clinerules/skills'], ['.claude/skills']],
  pi: [['.agents/skills'], ['.agents/skills']],
  roo: [['.agents/skills'], ['.agents/skills']],
  amp: [[], ['.agents/skills']],
};
export function readLocations(
  p: Profile,
  kind: Exclude<Kind, 'rule'>,
  workspace: Workspace,
): string[] {
  if (workspace.global && p.projectOnly) return [];
  const preferred = location(p, kind, workspace);
  const aliases = kind === 'skill' ? (skillAliases[p.id]?.[workspace.global ? 1 : 0] ?? []) : [];
  return [
    ...new Set([
      ...(preferred ? [preferred] : []),
      ...aliases.map((path) => ruleLocation(path, workspace, p.id)),
    ]),
  ];
}
export function skillDefinition(root: string, name: string): string {
  return join(root, name, 'SKILL.md');
}
