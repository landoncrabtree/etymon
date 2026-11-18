export const EXPLANATION = `# Etymon

Etymon is a portable environment manager for coding-agent skills, MCP servers, agents, and instructions. It stores shared source in \`.agents/etymon/\`, with an \`etymon.toml\` manifest and \`etymon.lock\` lockfile, then generates configuration for supported AI harnesses.

## Initialize and convert

- New repository: run \`etymon init\`.
- Existing repository: run \`etymon init\`, then \`etymon convert\` to import detected native configuration.
- Import one harness only: run \`etymon convert --harness <id>\` (for example, \`claude\`, \`codex\`, or \`cursor\`).

## Resources

- Skills: \`etymon skills find <query>\`; create one with \`etymon skills create\`.
- MCP servers: \`etymon mcp find <query>\`; create one with \`etymon mcp create\`.
- Agents: create one with \`etymon agents create\`.
- Instructions: create a rule with \`etymon rules create\`.

Creation opens an interactive form in a terminal. Use \`--name\`, \`--description\`, \`--body\`, and \`--yes\` for headless creation. Run \`etymon <resource> --help\` for resource-specific options.

## Generate harness configuration

Run \`etymon sync --harness <ids>\` to generate configuration for specific harnesses, for example:

\`etymon sync --harness claude,codex,opencode\`

Run \`etymon harnesses\` to list supported harness IDs. Use \`etymon sync --dry-run\` to preview changes and \`etymon sync\` to restore previously selected targets from the lockfile.
`;
