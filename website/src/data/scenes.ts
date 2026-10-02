const addExamples = [
  {
    id: "add-skill",
    label: "Add a skill",
    command: "etymon skills add vercel-labs/skills --skill find-skills",
    lines: ["Select find-skills", "Lock its source commit and content"],
    completion: "Ready for the next sync.",
    before: ["etymon.toml", "etymon.lock"],
    files: ["etymon.toml", "etymon.lock"],
    outputs: [
      ["find-skills", "Selected skill"],
      ["etymon.lock", "Pinned external source"],
      ["etymon sync", "Install for your tools"],
    ],
  },
  {
    id: "find-mcp",
    label: "Find an MCP server",
    command: "etymon mcp find context7",
    lines: ["Search the MCP Registry", "Find io.github.upstash/context7"],
    completion: "Choose a connection to add.",
    before: ["etymon.toml", "etymon.lock"],
    files: ["etymon.toml", "etymon.lock"],
    outputs: [
      ["Context7", "Library documentation"],
      ["MCP Registry", "Connection details"],
      ["Your source", "Unchanged by search"],
    ],
  },
  {
    id: "add-mcp",
    label: "Add an MCP server",
    command: "etymon mcp add io.github.upstash/context7 --remote 0",
    lines: [
      "Select the hosted connection",
      "Save MCP settings in the manifest",
    ],
    completion: "One connection for your tools.",
    before: ["etymon.toml", "etymon.lock"],
    files: ["etymon.toml", "etymon.lock"],
    outputs: [
      ["Context7", "Hosted MCP connection"],
      ["etymon.toml", "Inline connection settings"],
      ["etymon.lock", "Registry source recorded"],
    ],
  },
  {
    id: "create-skill",
    label: "Create a skill",
    command:
      'etymon skills create --name checks --description "Run project checks" --body "Run npm test and report failures." --yes',
    lines: ["Write checks/SKILL.md", "Register your custom skill"],
    completion: "Your project checks, ready to share.",
    before: ["etymon.toml", "etymon.lock"],
    files: ["etymon.toml", "etymon.lock", "etymon/", "  skills/"],
    outputs: [
      ["checks", "Your custom skill"],
      ["SKILL.md", "Editable instructions"],
      ["etymon sync", "Install for your tools"],
    ],
  },
  {
    id: "create-agent",
    label: "Create an agent",
    command:
      'etymon agents create --name reviewer --description "Review changes" --body "Find correctness bugs." --yes',
    lines: ["Write reviewer.json", "Register your custom agent"],
    completion: "A reviewer for your project.",
    before: ["etymon.toml", "etymon.lock"],
    files: ["etymon.toml", "etymon.lock", "etymon/", "  agents/"],
    outputs: [
      ["reviewer", "Your custom agent"],
      ["reviewer.json", "Editable agent source"],
      ["etymon sync", "Install for your tools"],
    ],
  },
  {
    id: "create-rule",
    label: "Create a rule",
    command:
      'etymon rules create --name testing --layout modular --body "Run checks before committing." --yes',
    lines: ["Write testing.md", "Register an always-on project rule"],
    completion: "Shared guidance for contributors.",
    before: ["etymon.toml", "etymon.lock"],
    files: ["etymon.toml", "etymon.lock", "etymon/", "  rules/"],
    outputs: [
      ["testing", "Your project rule"],
      ["testing.md", "Editable instructions"],
      ["etymon sync", "Install for your tools"],
    ],
  },
] as const;

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
    ...addExamples[0],
    id: "add",
    label: "add",
    icon: "plus",
    description:
      "Add skills and MCP servers, or create your own skills, agents and rules. Sync when you're ready.",
    examples: addExamples,
  },
] as const;
