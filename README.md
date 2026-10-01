# etymon

Your team's coding tools should share the same setup.

Skills, MCP servers, agents, and rules tend to end up scattered across tool-specific folders. Someone adds a useful skill in Claude. Someone else copies it to Codex. Rules drift, server settings get missed, and the next contributor starts from scratch.

Etymon keeps that setup in your repo. Add what you need once, commit it, and let each person sync it to the tools they use.

## Install

```bash
npm install -g etymon
etymon
```

`etymon` opens a terminal UI for adding resources, importing an existing setup, and reviewing changes before sync.

You can also run it without a global install:

```bash
npx etymon
```

Requires Node.js 22 or later. Git is needed for repository sources.

## Start a new repo

```bash
etymon init

# Add a skill from skills.sh
etymon skills add vercel-labs/skills --skill find-skills

# Add a hosted MCP server from the official registry
etymon mcp add io.github.upstash/context7 --remote 0

# Create your own agent in the terminal form
etymon agents create

# Add guidance for part of the repo
etymon rules create --name api-guidance --dest-dir packages/api \
  --body "Keep public API responses backward compatible."

# Choose the tools you use
etymon sync --harness claude,codex,opencode
```

`init` sets up the manifest, lockfile, and `.gitignore`. Generated tool files stay local. Created resources go straight into `.agents/etymon/`.

Commit `.agents/etymon.toml`, `.agents/etymon.lock`, and the authored files under `.agents/etymon/`. If you register an existing local source with `add`, commit that source too.

Contributors can then run:

```bash
etymon sync
```

The first sync asks which tools they use. Later syncs reuse that choice. External resources restore from the recorded versions.

## Bring in an existing repo

Already have skills, agents, MCP settings, or instruction files?

```bash
etymon init
etymon convert claude
etymon sync --harness codex,opencode
```

Replace `claude` with the tool you're importing from. `convert` creates editable source and keeps the original files in place. Equivalent copies become one registration, including matching CLAUDE.md/AGENTS.md files and skills installed in multiple supported folders.

If sync finds existing output it needs to manage, review the plan before adopting it:

```bash
etymon sync --harness claude --dry-run
etymon sync --harness claude --adopt
```

Commit the Etymon files and local source. Other contributors use `etymon sync` to set up their own tools.

## What you can add

| Interface | Sources                                                                                           | Examples                                            |
| --------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Skills    | Local folders and [skills.sh](https://skills.sh) repositories                                     | `etymon skills add ./skills/checks`                 |
| MCP       | Local JSON connections and the [official MCP Registry](https://registry.modelcontextprotocol.io/) | `etymon mcp add ./mcp.json`                         |
| Agents    | Local Markdown, TOML, or JSON; Git repositories and file URLs                                     | `etymon agents add augmnt/agents/api-designer.md`   |
| Rules     | Local Markdown and native rule files; Git repositories and file URLs                              | `etymon rules add ./guidance.md --dest-dir src/api` |

Skills keep their supporting files. MCP connections live directly in `etymon.toml`, so you can remove the input JSON after adding it. Imported agents and rules stay editable under `.agents/etymon/`.

## Create your own

Open a form with `etymon skills create`, `etymon agents create`, or `etymon mcp create`. Running `add` without a source opens the same form. Skills and agents have a multiline instructions field. The MCP form offers STDIO, HTTP, and SSE connections.

Tab moves between fields. Ctrl+S saves; Ctrl+C cancels.

For scripts, supply the fields directly:

```bash
etymon skills create --name project-checks \
  --description "Run the project's checks before finishing a change" \
  --body "Run npm test and explain any failures."

etymon agents create --name reviewer --description "Review code changes" \
  --body "Look for correctness bugs and missing tests."

etymon mcp create --name docs --url https://example.com/mcp \
  --header Authorization=env:MCP_AUTH

etymon mcp create --name local-server --command node --arg=server.js \
  --env API_KEY=env:API_KEY
```

Use `--body-file -` to read instructions from stdin, or `--body-file <path>` for an existing file. Add `--yes` when running a complete command in a terminal to skip the form. `etymon sync` activates what you created.

Edit created skills in their `SKILL.md`, agents in their JSON source, and rules in their Markdown source under `.agents/etymon/`. Custom MCP settings stay in `etymon.toml`. Local creations do not add external dependencies to the lockfile.

Find something to add:

```bash
etymon skills find react
etymon mcp search context7
etymon mcp info io.github.upstash/context7
```

For MCP credentials, store an environment variable reference:

```bash
etymon mcp add io.github.upstash/context7 --package npm \
  --input CONTEXT7_API_KEY=env:CONTEXT7_API_KEY
```

## Supported tools

These are the supported Etymon outputs. Some need a native feature enabled or an explicit editor configuration path. Support for a format does not mean every tool-specific option transfers to every other tool.

| Tool (`--harness`)              | Skills | Agents | MCP           | Rules | Conversion limits                                                            |
| ------------------------------- | ------ | ------ | ------------- | ----- | ---------------------------------------------------------------------------- |
| Claude Code (`claude`)          | Yes    | Yes    | Yes           | Yes   | AGENTS.md needs current native support; existing CLAUDE.md can need adoption |
| Codex (`codex`)                 | Yes    | Yes    | Yes           | Yes   | Arbitrary rule globs and unmatched agent tool restrictions block conversion  |
| Copilot CLI (`copilot-cli`)     | Yes    | Yes    | Yes           | Yes   | Required native settings need a matching destination                         |
| Copilot cloud (`copilot-cloud`) | Yes    | Yes    | Service setup | Yes   | Repository files only; MCP needs cloud configuration                         |
| VS Code (`vscode-local`)        | Yes    | Yes    | Yes           | Yes   | User MCP settings need an explicit profile path                              |
| Gemini CLI (`gemini`)           | Yes    | Yes    | Yes           | Yes   | Agents need the experimental agents setting; conditional rules are limited   |
| Kiro (`kiro`)                   | Yes    | Yes    | Yes           | Yes   | Directory rules use native steering conditions                               |
| Pi (`pi`)                       | Yes    | No     | Extension     | Yes   | MCP needs its built-in extension; conditional rules cannot transfer          |
| Oh My Pi (`omp`)                | Yes    | Yes    | Yes           | Yes   | Native context precedence applies                                            |
| OpenCode (`opencode`)           | Yes    | Yes    | Yes           | Yes   | Configured instruction files are always-on                                   |
| Cursor (`cursor`)               | Yes    | Yes    | Yes           | Yes   | No personal rule-file output                                                 |
| Antigravity (`antigravity`)     | Yes    | Yes    | Yes           | Yes   | Native activation conditions must remain compatible                          |
| Roo Code (`roo`)                | Yes    | No     | Yes           | Yes   | Mode-specific rules stay in Roo; user MCP needs a profile path               |
| Cline (`cline`)                 | Yes    | No     | Explicit path | Yes   | MCP needs `--config-path`; only supported rule conditions transfer           |
| Kilo (`kilo`)                   | Yes    | Yes    | Yes           | Yes   | Configured instruction files are always-on                                   |
| Continue (`continue`)           | No     | No     | Yes           | Yes   | Regex and combined rule conditions stay in Continue                          |
| Windsurf / Cascade (`windsurf`) | Yes    | No     | Global only   | Yes   | Native rule size limits apply                                                |
| Amp (`amp`)                     | Yes    | No     | Yes           | Yes   | Agent execution format has no supported writer                               |
| Zed (`zed`)                     | Yes    | No     | Explicit path | Yes   | Root rules only; MCP needs `--config-path`                                   |

Basic prompts, supported connections, skill files, and compatible rules transfer without dropping content. When permissions or rule scope cannot be preserved, sync stops and explains why. `--allow-lossy` permits dropping optional metadata or model preferences; it does not remove required restrictions.

For paths, scope details, and current prerequisites, see [rule compatibility](docs/RULES.md) or run `etymon harnesses --json`.

## Your personal setup

Use `--global` (or `-g`) for resources you want across repos:

```bash
etymon init --global
etymon skills add vercel-labs/skills --skill find-skills --global
etymon rules add ./personal-guidance.md --global
etymon sync --global --harness claude,codex
```

Personal and project environments are separate. Global rules are always-on personal guidance in supported standalone files. Directory scopes and project rule folders stay project-only.

## Keep it current

```bash
etymon list
etymon update
etymon sync
etymon doctor
```

`sync` uses the locked versions. `update` chooses newer versions, which take effect on the next sync. Use `etymon sync --offline` when the required resources are already cached.

Remove a resource with `etymon skills remove <name>`, `etymon agents remove <name>`, `etymon rules remove <name>`, or `etymon mcp remove <name>`. Removal clears unchanged output managed by Etymon and keeps authored source. Manually edited output needs review.

## Uninstall

```bash
etymon uninstall
```

The terminal UI shows the global npm installation and asks whether to keep or remove your personal `.agents/etymon.toml` and `.agents/etymon.lock`. Keep is selected by default. Project files and generated tool settings remain in place.

For scripts, use `--keep-user-config` or `--remove-user-config`. `--dry-run` shows what was found without changing anything.

## Contributing

The source is at [landoncrabtree/etymon](https://github.com/landoncrabtree/etymon). See the [test scenarios](testcases/README.md), [verification notes](docs/VERIFICATION.md), and [architecture reference](docs/ARCHITECTURE.md). [Bug reports](https://github.com/landoncrabtree/etymon/issues) are most useful with the command, tool version, and output from `etymon doctor --json`.
