# Command migration

Etymon imports native commands into standard `SKILL.md` bundles. `convert` discovers them alongside skills, agents, MCP connections, and rules. `commands add` accepts an explicit local or remote source. Sync always writes skills.

```bash
etymon convert --harness cursor
etymon commands add ./.claude/commands/review.md
etymon commands create --name checks --description "Run checks" \
  --body "Run npm test and report failures." --yes
etymon sync --harness claude,codex
```

Commands share the skill manifest, cache, external lock, update, and removal lifecycle. Local imports become editable bundles under `.agents/etymon/skills/`. External definitions are locked as skill dependencies with their source dialect and bundle digest. Sync restores exact locked bytes; update deliberately changes the resolution.

## Recognized sources

Locations below are relative to the project or user home unless shown otherwise. Project and user discovery are separate. Native sources and defaults were checked against the linked primary documentation or source on October 2, 2026.

| Tool                     | Project sources                                                                                                         | User sources                                     | Evidence                                                                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude Code              | `.claude/commands/*.md`, including subdirectories                                                                       | `.claude/commands/`                              | [Skills and legacy commands](https://code.claude.com/docs/en/skills)                                                                                                                             |
| Codex                    | None                                                                                                                    | `.codex/prompts/*.md`, top-level files           | [Custom prompts](https://learn.chatgpt.com/docs/custom-prompts)                                                                                                                                  |
| Copilot CLI              | `.claude/commands/`                                                                                                     | `.claude/commands/`                              | [CLI reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)                                                                                        |
| Cursor                   | `.cursor/commands/`                                                                                                     | `.cursor/commands/`                              | [Commands](https://docs.cursor.com/en/agent/chat/commands), [user location](https://forum.cursor.com/t/can-i-have-few-commands-folders-in-one-repo/145901/2)                                     |
| Gemini                   | `.gemini/commands/**/*.toml`                                                                                            | `.gemini/commands/`                              | [Custom commands](https://geminicli.com/docs/cli/custom-commands/)                                                                                                                               |
| OpenCode                 | `opencode.json`, `opencode.jsonc`, corresponding files inside `.opencode/`, `.opencode/command/`, `.opencode/commands/` | `.config/opencode/` config and command files     | [Commands](https://opencode.ai/docs/commands/), [configuration precedence](https://github.com/anomalyco/opencode/blob/v1.18.30/packages/opencode/src/config/config.ts)                           |
| Kilo                     | `.kilo/commands/`, `.kilocode/workflows/`, `kilo.json`, `kilo.jsonc`                                                    | `.config/kilo/commands/` and configuration files | [Workflows](https://kilo.ai/docs/customize/workflows)                                                                                                                                            |
| Amp                      | `.agents/commands/`                                                                                                     | `.config/amp/commands/`                          | [Retired custom commands](https://ampcode.com/news/slashing-custom-commands)                                                                                                                     |
| Roo                      | `.roo/commands/`                                                                                                        | `.roo/commands/`                                 | [Slash commands](https://roocodeinc.github.io/Roo-Code/features/slash-commands/)                                                                                                                 |
| Cline                    | `.clinerules/workflows/`                                                                                                | `Documents/Cline/Workflows/`                     | [Locations](https://github.com/cline/cline/blob/main/apps/vscode/src/core/storage/disk.ts), [expansion](https://github.com/cline/cline/blob/main/apps/vscode/src/sdk/slash-command-expansion.ts) |
| Windsurf / Devin Cascade | `.devin/workflows/`, `.windsurf/workflows/`, including nested project directories                                       | `.codeium/windsurf/global_workflows/`            | [Workflows](https://docs.devin.ai/desktop/cascade/workflows)                                                                                                                                     |
| Antigravity              | `.agents/workflows/`, `.agent/workflows/`                                                                               | `.gemini/config/workflows/`                      | [Workflow migration](https://www.antigravity.google/docs/migration/workflows-to-skills/)                                                                                                         |
| Pi                       | `.pi/prompts/*.md`, top-level files                                                                                     | `.pi/agent/prompts/*.md`                         | [Prompt templates](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/prompt-templates.md)                                                                                |
| Oh My Pi                 | `.omp/prompts/`                                                                                                         | `.omp/agent/prompts/`                            | [Prompt templates](https://omp.sh/docs/prompt-templates)                                                                                                                                         |
| Kiro / legacy Amazon Q   | `.kiro/prompts/`, `.amazonq/prompts/`                                                                                   | `.kiro/prompts/`, `.aws/amazonq/prompts/`        | [Manage prompts](https://kiro.dev/docs/cli/chat/manage-prompts/), [Q migration](https://kiro.dev/docs/cli/migrating-from-q/)                                                                     |
| Continue                 | `.continue/config.json` legacy `customCommands`                                                                         | `.continue/config.json`                          | [Legacy command implementation](https://github.com/continuedev/continue/blob/main/core/commands/slash/customSlashCommand.ts)                                                                     |

Codex, Pi, Oh My Pi, and Kiro name these reusable slash-command sources prompts or templates. They are included in command migration. VS Code `.github/prompts/*.prompt.md` files and MCP prompts are outside this interface.

`CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `COPILOT_HOME`, `PI_CODING_AGENT_DIR`, and `XDG_CONFIG_HOME` affect their applicable user locations. `--home` selects an isolated home and takes precedence. Custom OS Documents locations and other tool-specific location overrides can be imported with an explicit path and `--format`.

OpenCode merges JSON and JSONC configuration, then command Markdown overrides the template and explicitly supplied fields. Kilo configuration overrides its command files. Gemini and OpenCode subdirectory names become skill name prefixes, such as `git-review`. Names normalize to lowercase hyphenated skill names. Distinct definitions that normalize to the same name block import. Native skills take precedence over same-name legacy commands for Claude, Copilot CLI, and Antigravity; differing shadowed commands produce a warning.

Conversion keeps originals in place. Exclusions apply before parsing. Direct source symlinks are rejected; native child command aliases produce a warning and are skipped. Amp executable commands retain their bytes and executable mode under `scripts/`; importing or syncing never runs them.

## Invocation controls

Skill metadata records invocation intent using `metadata.etymon.invocation`:

| Value    | Model selection | Explicit user invocation |
| -------- | --------------- | ------------------------ |
| `auto`   | Allowed         | Allowed                  |
| `manual` | Disabled        | Allowed                  |
| `model`  | Allowed         | Hidden                   |
| `never`  | Disabled        | Hidden                   |

Most native command sources default to `manual`. Claude-compatible commands and current Antigravity workflows use their documented automatic-selection defaults. Native `disable-model-invocation` and `user-invocable` flags override these defaults. `commands create` defaults to `manual`; skill creation accepts the same `--invocation` option without changing the ordinary skill default.

| Destination | Manual-only control                                                 | Hide user invocation    | Argument hint       | Evidence                                                                                                  |
| ----------- | ------------------------------------------------------------------- | ----------------------- | ------------------- | --------------------------------------------------------------------------------------------------------- |
| Claude Code | `disable-model-invocation: true`                                    | `user-invocable: false` | Supported           | [Skills](https://code.claude.com/docs/en/skills)                                                          |
| Codex       | `agents/openai.yaml` with `policy.allow_implicit_invocation: false` | No verified mapping     | No verified mapping | [Build skills](https://learn.chatgpt.com/docs/build-skills)                                               |
| Copilot CLI | `disable-model-invocation: true`                                    | `user-invocable: false` | Supported           | [CLI reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference) |
| VS Code     | `disable-model-invocation: true`                                    | `user-invocable: false` | No verified mapping | [Agent skills](https://code.visualstudio.com/docs/agent-customization/agent-skills)                       |
| Cursor      | `disable-model-invocation: true`                                    | No verified mapping     | No verified mapping | [Skills](https://prod.cursor.com/docs/skills)                                                             |
| Pi          | `disable-model-invocation: true`                                    | No verified mapping     | No verified mapping | [Skills](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)             |
| Oh My Pi    | `disable-model-invocation: true`                                    | No verified mapping     | No verified mapping | [Skills](https://omp.sh/docs/skills)                                                                      |
| Zed         | `disable-model-invocation: true`                                    | No verified mapping     | No verified mapping | [Skills](https://zed.dev/docs/ai/skills)                                                                  |

Other skill writers do not have a verified mapping for these restrictions. Strict sync blocks a manual-only command rather than making it automatically selectable. `--allow-lossy` permits that change with a resource-specific warning. A contradictory Codex policy file remains a validation error even with the flag. Codex output also retains the frontmatter flag for Zed, which reads the same `.agents/skills` location; Codex's verified enforcement uses its sidecar. The table documents format support; it does not certify model behavior in every listed product.

## Native requirements and loss

Native command settings and detected template features stay in canonical string metadata under `etymon.command`. Argument hints use `etymon.argument-hint`. These fields fit the Agent Skills metadata map and remain part of bundle identity.

Claude-compatible argument expansion, automatic context substitutions, and native command frontmatter can remain active in Claude skills. For other destinations, argument templates, context injection, executable dispatch, workflow chaining, model selection, tool restrictions, or dispatch modes require a verified mapping. Etymon blocks unsupported requirements by default. Explicit `--allow-lossy` keeps the body and warns that placeholders remain literal or native settings/behavior are omitted. It does not execute substitutions or claim cross-tool equivalence.

```bash
etymon sync --harness codex --dry-run --allow-lossy
etymon sync --harness codex --allow-lossy
```

Warnings identify the resource and destination. Canonical source, manifest, and lock stay unchanged. Reimporting Etymon's own skill projections removes only matching native policy fields before deduplication, retaining supporting files and executable modes. Changed native assets still conflict with authored source.

Cases [27 and 28](../testcases/README.md) cover conversion, creation in a real terminal, repeated imports, invocation policy, strict/lossy plans, external locking, empty-cache restoration, integrity failures, update, and removal. Native checks use installed loaders without model requests.
