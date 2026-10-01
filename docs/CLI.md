# CLI reference

```text
etymon [options] [command]
```

Without a command, Etymon opens its terminal UI when stdin and stdout are terminals. Otherwise it prints help. Use `etymon --help` or `etymon <command> --help` for the installed version's flags.

## Shared options

Options may appear before or after subcommands.

| Option                         | Behavior                                                      |
| ------------------------------ | ------------------------------------------------------------- |
| `--cwd <path>`                 | Project directory; defaults to the current directory          |
| `-g`, `--global`               | Use your personal environment instead of the project          |
| `--home <path>`                | Override the home directory for isolated profiles             |
| `--cache <path>`               | Override the artifact cache directory                         |
| `--offline`                    | Use cached external resources; remote resolution/search fails |
| `--json`                       | Machine-readable output; skips interactive prompts            |
| `-y`, `--yes`                  | Skip interactive prompts and use noninteractive defaults      |
| `--debug`                      | Provider command details and error stack traces               |
| `-H`, `--harness <targets...>` | Destination IDs, comma-separated or space-separated           |
| `--config-path <path>`         | Explicit native MCP configuration path; one destination       |
| `--rules-path <path>`          | Explicit project instruction directory; one destination       |
| `-V`, `--version`              | Installed package version                                     |

`skill`/`skills`, `agent`/`agents`, and `rule`/`rules` are equivalent command groups. `ls` aliases `list`; `rm` aliases a resource group's `remove`.

## Initialize and sync

```bash
etymon init
etymon sync --harness claude,codex,opencode
etymon sync
etymon sync --dry-run
etymon sync --offline --locked
```

`init` creates `.agents/etymon.toml`, `.agents/etymon.lock`, and an owned block in `.gitignore`, preserving existing content. Generated native files stay ignored. Track the manifest, lock, and authored files under `.agents/etymon/`; also track any local source registered elsewhere with `add`.

The manifest and lock coordinate the environment. Skill bundles, agent prompts, and rule bodies remain in editable source files. MCP connections are inline in the manifest.

The first interactive sync asks for destinations if none are supplied. Later syncs reuse the local selection. Headless first sync requires `--harness`. Sync restores external resources at their locked versions and materializes local source. It does not choose newer external versions.

| Sync option     | Behavior                                                           |
| --------------- | ------------------------------------------------------------------ |
| `--dry-run`     | Plan without writing native output or acquiring ownership          |
| `--locked`      | Require matching recorded toolchain versions                       |
| `--adopt`       | Take ownership of existing unmanaged output                        |
| `--force`       | Replace changes to already-owned output                            |
| `--allow-lossy` | Allow behavior changes or omitted resources with specific warnings |

`--allow-lossy` applies to all four interfaces. Rule conditions may become always-on; directory scope may broaden if nesting or equivalent file patterns are unavailable. Agent restrictions and native settings, skill extensions, and MCP native settings may be omitted. Unsupported MCP transports or environment interpolation cause that server to be omitted; credentials are never resolved into generated output. A resource with no verified writer is omitted rather than assigned a guessed path. Disabled rules stay inactive, and oversized guidance is omitted rather than truncated.

Warnings name the resource, destination, and exact loss. Source files, manifest, and lock remain unchanged. Use `--dry-run --allow-lossy` to review first and pass the flag on later syncs as well. The TUI offers the same preview followed by an apply choice. Invalid source/configuration, ownership or drift conflicts, unsafe paths, filesystem failures, and disabled/shadowed instruction loaders remain errors. `convert` imports native semantics into source; lossy adaptation happens when projecting that source with `sync`.

Review adoption or force plans before applying them. Deleted managed output can be restored by sync. Edited stale output blocks deletion. Shared output can require syncing its owning destinations together.

## Import an existing setup

```bash
etymon convert claude
etymon convert opencode --dry-run
etymon sync --harness codex --dry-run
etymon sync --harness codex --adopt
```

`convert <harness>` imports native skills, agents, MCP settings, and recognized rules into editable Etymon source. It leaves originals in place. Equivalent aliases merge into one registration; differing skill assets or rule scopes do not deduplicate. Native extensions stay associated with their original format.

Rules and instructions share one interface. Profiles distinguish standing files, modular rule directories, nesting, and supported activation modes; source count does not create a separate resource kind.

Each distinct imported rule gets a manifest entry and canonical Markdown under `.agents/etymon/rules/`. For example, two always-on `.cursor/rules/*.mdc` files become two registered rules with `destDir = "."`. Syncing to Codex composes their bodies into separate managed sections in one root `AGENTS.md`. Tools with compatible individual rule files receive separate output; nested standing rules retain their directory placement. A destination that cannot preserve a rule's conditions blocks the default plan. `--allow-lossy` can broaden activation or directory scope and reports each change. Single-file output can contain multiple rules without merging their identities.

`--dry-run` reports the import without writing source. Explicit configuration/rule paths use the shared options above. See [rule compatibility](RULES.md) for recognized locations, conditions, nesting, and precedence.

## Add a source

```bash
etymon skills add ./skills/checks
etymon skills add vercel-labs/skills --skill find-skills
etymon agents add augmnt/agents/api-designer.md
etymon rules add ./guidance.md --dest-dir src/api
etymon mcp add ./mcp.json
etymon skills add owner/repo --list
```

`add <source>` registers a local resource or resolves and locks an external one. It does not activate output until sync. `--list` inspects without registering.

All interfaces check existing local paths first, including bare paths such as `abc/abc/abc`. An invalid existing local source fails locally and never retries remotely. Explicit local paths (`./`, `../`, absolute paths, `~/`, or `file:` URLs) fail when missing. `~/` expands using the workspace home.

For skills, agents, and rules, a missing bare `owner/repo[/path]` becomes Git shorthand. Full GitHub/GitLab/Azure DevOps URLs, SSH/Git URIs, and direct file URLs select remote sources explicitly. Use `./` when a missing path must stay local; use an explicit Git URL to bypass an existing local path.

External skill repositories use the pinned `npx skills` discovery policy to select among tool-specific variants. Etymon verifies the installed files against the checkout and locks the chosen source path and bundle digest. External skill `--list` performs this selection in a temporary staging directory. Conflicting bundles found during local discovery or native conversion still block.

MCP accepts local JSON connections or registry IDs. A missing bare ID is looked up in the registry. MCP endpoint URLs belong in `mcp create --url`, rather than `mcp add`. Git-backed MCP definitions are not supported.

| Add option                 | Applies to            | Behavior                                               |
| -------------------------- | --------------------- | ------------------------------------------------------ |
| `--ref <revision>`         | Skills, agents, rules | Git branch, tag, or commit                             |
| `--list`                   | All                   | Inspect without registration                           |
| `-s`, `--skill <names...>` | Skills                | Select skill names; default is all discovered skills   |
| `-a`, `--agent <names...>` | Agents                | Select agent names; default is all discovered agents   |
| `-r`, `--rule <names...>`  | Rules                 | Select recognized rules                                |
| `--dest-dir <directory>`   | Rules                 | Override the detected project-relative directory scope |
| `--version <version>`      | MCP                   | Registry metadata version; default is latest           |
| `--registry <url>`         | MCP                   | Registry base URL                                      |
| `--package <identifier>`   | MCP                   | Select a package identifier or registry type           |
| `--remote <index>`         | MCP                   | Select a hosted connection by zero-based index         |
| `--input <values...>`      | MCP                   | Metadata inputs as `NAME=value` or `NAME=env:VARIABLE` |

Local skills retain their full bundle, including assets. Local agents/rules retain registered source paths. Local MCP JSON is embedded in the manifest and can be removed after import. Local resources do not add external lock dependencies.

## Create a resource

```bash
etymon skills create
etymon agents create
etymon rules create
etymon mcp create

# No-source add opens the same form
etymon skills add
```

The terminal form uses Tab/Shift+Tab to move between fields, Ctrl+S to save, and Ctrl+C to cancel. Validation keeps the form open for correction. Instructions are multiline. MCP fields change with transport; project rule patterns appear for glob activation. Global rule forms omit project scope and conditional activation.

Supply fields for headless use. In a terminal, `--yes` skips the form; `--json` also selects headless behavior.

```bash
etymon skills create --name checks --description "Run project checks" \
  --body "Run npm test and report failures." --yes

etymon agents create --name reviewer --description "Review changes" \
  --body "Find correctness bugs." --model preferred-model --tools Read Grep --yes

etymon rules create --name typescript --dest-dir src --activation glob \
  --pattern '**/*.ts' --body "Keep public types stable." --yes

printf 'Run project checks.\n' | etymon skills create --name checks \
  --description "Run project checks" --body-file - --json

etymon mcp create --name docs --url https://example.com/mcp \
  --header Authorization=env:MCP_AUTH --yes

etymon mcp create --name local-server --transport stdio --command node \
  --arg=server.js --arg='two words' --env TOKEN=env:MCP_TOKEN --yes
```

| Creation option            | Applies to            | Behavior                                                                            |
| -------------------------- | --------------------- | ----------------------------------------------------------------------------------- |
| `--name <name>`            | All                   | Unique resource name; skill names use lowercase letters, digits, and single hyphens |
| `--description <text>`     | Skills, agents, rules | Usage summary; required for skills, agents, and model-selected rules                |
| `--body <text>`            | Skills, agents, rules | Instructions                                                                        |
| `--body-file <path>`       | Skills, agents, rules | Read instructions from a file or `-` for stdin; mutually exclusive with `--body`    |
| `--license <name>`         | Skills                | Optional license                                                                    |
| `--compatibility <text>`   | Skills                | Optional requirements                                                               |
| `--model <name>`           | Agents                | Optional model preference                                                           |
| `--tools <names...>`       | Agents                | Tool allowlist; accepts comma-separated or space-separated names                    |
| `--dest-dir <directory>`   | Rules                 | Project-relative scope; default `.`                                                 |
| `--activation <mode>`      | Rules                 | `always`, `glob`, `model`, `manual`, or `never`; default `always`                   |
| `--pattern <glob>`         | Rules                 | Repeatable scope-relative glob; required for `glob` activation                      |
| `--transport <type>`       | MCP                   | `stdio`, `streamable-http`, or `sse`; command implies STDIO, URL implies HTTP       |
| `--url <url>`              | MCP                   | HTTP/SSE endpoint                                                                   |
| `--command <executable>`   | MCP                   | STDIO executable; pass arguments separately                                         |
| `--arg <value>`            | MCP                   | Repeatable STDIO argument; use `--arg=-flag` for values beginning with a dash       |
| `--server-cwd <directory>` | MCP                   | Optional STDIO working directory                                                    |
| `--env <values...>`        | MCP                   | STDIO environment values or references                                              |
| `--header <values...>`     | MCP                   | HTTP/SSE header values or references                                                |

The same flags work on no-source `add`. New skills go to `.agents/etymon/skills/<name>/SKILL.md`, agents to `.agents/etymon/agents/<name>.json`, and rules to `.agents/etymon/rules/<name>.md`. MCP remains inline. Creation registers source without generating native output; run sync to activate it. Duplicate names do not overwrite existing source.

## Find and inspect

```bash
etymon skills find react
etymon mcp find context7 --limit 20
etymon mcp find context7 --cursor next-page
etymon mcp info io.github.upstash/context7
etymon mcp info io.github.upstash/context7 --version 1.2.3
etymon list --json
etymon rules list --json
etymon harnesses --json
```

Skills search uses the pinned skills CLI and does not support `--json`. MCP search supports `--registry`, `--cursor`, and `--limit` (1–100); `search` remains an alias for `find`. MCP info supports `--registry` and metadata `--version`. Remote search/info is unavailable offline.

`list` shows authored registrations and locked dependencies; resource-group lists also show resolved resources. `harnesses --json` includes capability gates, prerequisites, and source links.

## Update and remove

```bash
etymon update
etymon update '<dependency-id-from-list>'
etymon sync

etymon skills remove checks --dry-run
etymon skills remove checks
etymon agents remove reviewer
etymon rules remove guidance
etymon mcp remove docs
```

`update [ids...]` re-resolves all or selected external dependency IDs. Use IDs from `list`; local sources are not external updates. Sync applies the new resolutions separately.

`remove <id-or-name>` removes a registration and unchanged owned native output while retaining authored source. `--dry-run` previews changes. `--allow-lossy` permits conversion losses when rebuilding remaining shared rules and reports them in the removal plan. Manually edited output blocks unsafe deletion.

## Personal environment

```bash
etymon init --global
etymon skills add vercel-labs/skills --skill find-skills --global
etymon rules create --name personal --body "Prefer concise explanations." --global --yes
etymon sync --global --harness claude,codex
```

Project and user environments have separate manifests, locks, and ownership. Global initialization does not write a home `.gitignore`. User rules are unscoped, always-on guidance in verified standalone native files. Project rule folders, nested `destDir`, and conditional activation are rejected globally.

## Diagnose and recover

```bash
etymon doctor --json
etymon doctor --harness codex --allow-lossy
etymon recover
etymon tui
```

Doctor checks ownership, compatibility, environment references, discovery aliases, and native prerequisites without applying changes. Recover rolls back an interrupted journal without overwriting later unrelated edits. A process crash can leave an operation mutex; remove it only after confirming no operation is running.

`tui` requires a terminal and does not support `--json`. JSON errors have an `error` object with a code/message and optional details. Successful commands exit 0, errors exit 1, and cancelled forms exit 130.

## Uninstall

```bash
etymon uninstall
etymon uninstall --dry-run
etymon uninstall --keep-user-config
etymon uninstall --remove-user-config
etymon uninstall --yes
```

Uninstall removes the global npm package. Its terminal UI reviews the installation and asks whether to keep or remove the personal `.agents/etymon.toml` and `.agents/etymon.lock`; keep is selected by default. Project files, authored source, native settings, and caches remain.

Headless uninstall requires `--keep-user-config`, `--remove-user-config`, or `--yes` (keep). The two explicit choices are mutually exclusive. `--dry-run` inspects without removal. Failed npm removal does not delete personal files.

## Supported tools

| Tool (`--harness`)              | Skills | Agents | MCP           | Rules | Conversion limits                                                               |
| ------------------------------- | ------ | ------ | ------------- | ----- | ------------------------------------------------------------------------------- |
| Claude Code (`claude`)          | Yes    | Yes    | Yes           | Yes   | AGENTS.md requires current native support; existing CLAUDE.md can need adoption |
| Codex (`codex`)                 | Yes    | Yes    | Yes           | Yes   | Arbitrary rule globs and unmatched agent tool restrictions block conversion     |
| Copilot CLI (`copilot-cli`)     | Yes    | Yes    | Yes           | Yes   | Required native settings need a matching destination                            |
| Copilot cloud (`copilot-cloud`) | Yes    | Yes    | Service setup | Yes   | Repository files only; MCP needs cloud configuration                            |
| VS Code (`vscode-local`)        | Yes    | Yes    | Yes           | Yes   | User MCP needs an explicit profile path                                         |
| Gemini CLI (`gemini`)           | Yes    | Yes    | Yes           | Yes   | Agents require the experimental setting; conditional rules are limited          |
| Kiro (`kiro`)                   | Yes    | Yes    | Yes           | Yes   | Directory guidance uses native steering conditions                              |
| Pi (`pi`)                       | Yes    | No     | Extension     | Yes   | MCP requires the extension; conditional rules cannot transfer                   |
| Oh My Pi (`omp`)                | Yes    | Yes    | Yes           | Yes   | Native context precedence applies                                               |
| OpenCode (`opencode`)           | Yes    | Yes    | Yes           | Yes   | Configured instruction files are always-on                                      |
| Cursor (`cursor`)               | Yes    | Yes    | Yes           | Yes   | No personal rule-file output                                                    |
| Antigravity (`antigravity`)     | Yes    | Yes    | Yes           | Yes   | Native activation conditions must remain compatible                             |
| Roo Code (`roo`)                | Yes    | No     | Yes           | Yes   | Mode-specific rules stay in Roo; user MCP needs a profile path                  |
| Cline (`cline`)                 | Yes    | No     | Explicit path | Yes   | MCP requires `--config-path`; rule conditions are limited                       |
| Kilo (`kilo`)                   | Yes    | Yes    | Yes           | Yes   | Configured instruction files are always-on                                      |
| Continue (`continue`)           | No     | No     | Yes           | Yes   | Regex and combined conditions stay in Continue                                  |
| Windsurf (`windsurf`)           | Yes    | No     | Global only   | Yes   | Native rule size limits apply                                                   |
| Amp (`amp`)                     | Yes    | No     | Yes           | Yes   | No supported agent writer                                                       |
| Zed (`zed`)                     | Yes    | No     | Explicit path | Yes   | Root rules only; MCP requires `--config-path`                                   |

Basic prompts, skill assets, supported connections, and compatible rules preserve content. Default sync blocks unsupported permissions, tool restrictions, and rule conditions. `--allow-lossy` permits their omission or broadening with warnings, along with model/metadata adaptations and resource omissions. Native feature settings and trust remain the tool's responsibility.

See [rule compatibility](RULES.md) for paths/scopes and [verification evidence](VERIFICATION.md) for actual installed-loader coverage. A supported format is not a claim that every runtime or model behavior has been tested.
