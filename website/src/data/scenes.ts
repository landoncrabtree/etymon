export const scenes = [
  {
    id: "init",
    label: "init",
    icon: "terminal",
    command: "etymon init",
    description: "Start with a shared manifest and lockfile.",
    lines: [
      "Create .agents/etymon.toml",
      "Create .agents/etymon.lock",
      "Ignore generated tool files",
    ],
    completion: "Your shared setup starts here.",
    before: ["package.json", "src/", "README.md"],
    files: ["etymon.toml", "etymon.lock"],
    outputs: [
      ["etymon.toml", "Shared manifest"],
      ["etymon.lock", "Locked resources"],
      [".gitignore", "Generated files stay local"],
    ],
  },
  {
    id: "convert",
    label: "convert",
    icon: "convert",
    command: "etymon convert claude",
    description:
      "Bring existing Claude configuration into editable shared source. Originals are retained.",
    lines: [
      "Import CLAUDE.md",
      "Import .claude/rules/",
      "Keep MCP settings in the manifest",
      "Register editable rule sources",
    ],
    completion: "Existing setup, now portable.",
    before: ["CLAUDE.md", ".claude/rules/", ".mcp.json"],
    files: ["etymon.toml", "etymon.lock", "etymon/", "  rules/"],
    outputs: [
      ["etymon.toml", "MCP connections included"],
      ["etymon/rules/", "Editable project guidance"],
      ["Original files", "Kept until you remove them"],
    ],
  },
  {
    id: "sync",
    label: "sync",
    icon: "sync",
    command: "etymon sync --harness claude,codex",
    description:
      "Generate native files from the same shared setup for Claude and Codex.",
    lines: [
      "Read the shared manifest",
      "Use locked resource versions",
      "Write native configuration",
      "Keep authored source unchanged",
    ],
    completion: "Same context. Your choice of tools.",
    before: ["etymon.toml", "etymon.lock", "etymon/", "  rules/", "  skills/"],
    files: ["etymon.toml", "etymon.lock", "etymon/", "  rules/", "  skills/"],
    outputs: [
      ["AGENTS.md", "Standing instructions"],
      [".claude/rules/", "Separate Claude rules"],
      [".codex/config.toml", "Codex configuration"],
    ],
  },
  {
    id: "skill",
    label: "skills add",
    icon: "plus",
    command: "etymon skills add vercel-labs/skills --skill find-skills",
    description:
      "Add a skill from skills.sh and lock its source. The next sync installs it for your tools.",
    lines: [
      "Resolve vercel-labs/skills",
      "Select find-skills",
      "Lock the source commit and content",
      "Register the selected skill",
    ],
    completion: "Ready for the next sync.",
    before: ["etymon.toml", "etymon.lock"],
    files: ["etymon.toml", "etymon.lock"],
    outputs: [
      ["find-skills", "Selected skill"],
      ["Pinned commit", "Recorded in etymon.lock"],
      ["etymon sync", "Install for your tools"],
    ],
  },
] as const;
