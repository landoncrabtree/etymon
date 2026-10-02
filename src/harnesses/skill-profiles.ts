/** Verified invocation controls. Absence means Etymon does not claim support. */
export const skillControls: Record<
  string,
  {
    manual: 'frontmatter' | 'codex-policy';
    userHidden?: boolean;
    hint?: boolean;
    sources: string[];
  }
> = {
  claude: {
    manual: 'frontmatter',
    userHidden: true,
    hint: true,
    sources: ['https://code.claude.com/docs/en/skills'],
  },
  codex: { manual: 'codex-policy', sources: ['https://learn.chatgpt.com/docs/build-skills'] },
  'copilot-cli': {
    manual: 'frontmatter',
    userHidden: true,
    hint: true,
    sources: [
      'https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference',
    ],
  },
  'vscode-local': {
    manual: 'frontmatter',
    userHidden: true,
    sources: ['https://code.visualstudio.com/docs/agent-customization/agent-skills'],
  },
  cursor: { manual: 'frontmatter', sources: ['https://prod.cursor.com/docs/skills'] },
  pi: {
    manual: 'frontmatter',
    sources: [
      'https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/skills.md',
    ],
  },
  omp: { manual: 'frontmatter', sources: ['https://omp.sh/docs/skills'] },
  zed: { manual: 'frontmatter', sources: ['https://zed.dev/docs/ai/skills'] },
};
