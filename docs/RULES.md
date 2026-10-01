# Rules and instructions

Standing instructions and conditional rules share the `rule` resource kind. CLI, TUI, `convert`, `sync`, `update`, `remove`, and `doctor` share the same normalized rule pipeline. Research baseline: October 1, 2026. Native rule locations and loaders change frequently; each harness profile carries its primary sources and prerequisites in `etymon harnesses --json`.

```bash
etymon convert codex --dry-run
etymon convert codex
etymon sync --harness claude,cursor --dry-run
etymon sync --harness claude,cursor --adopt

etymon rule add ./guidance.md --dest-dir packages/api
etymon rule add owner/repo/rules --rule types
etymon rule add ./rules --list
etymon rule list --json
etymon rule remove types
```

`convert` leaves the native originals in place and creates editable Markdown under `.agents/etymon/rules/`. Local `rule add` also copies guidance into that authored directory, so its input can be removed afterward. Edit the copied rule or its manifest registration. Git/URL rules use the external lock and cache; Git commit, artifact SHA-256, selected names, and destination override remain reproducible. `sync` never advances their resolution; `update` does.

## Directory and activation scope

A rule has a Markdown body, a directory `base`, and an independent activation mode: `always`, `glob`, `model`, `manual`, `never`, or preserved `native` conditions. Glob patterns are relative to the base. Directory scope changes where guidance applies; it does not turn conditional guidance into always-on guidance.

The `layout` preference records whether guidance belongs in a standing instruction file or a separate rule file. Importing `.cursor/rules/*.mdc`, `.claude/rules/*.md`, or another rule directory sets `layout: modular`; importing `AGENTS.md` or `CLAUDE.md` sets `layout: standing`. New rules default to standing instructions. Choose `--layout modular` when creating one, or select **Separate rule file** in the project form.

Compatible destinations preserve modular files even when their activation is always-on. Cursor modules synced to Claude become separate `.claude/rules/*.md` files: unconditional guidance has no `paths` field, and glob-scoped guidance carries `paths`. Standing-only destinations compose compatible modules into one instruction file. Standalone `.claude/CLAUDE.md` imports at its containing project's scope and becomes `AGENTS.md` for Codex or Copilot. Continue uses `.continue/rules/*.md` for either layout. Layout never bypasses activation or scope checks.

Nested [AGENTS.md](https://agents.md/) and nested [CLAUDE.md](https://code.claude.com/docs/en/memory) both exist. Their loading behavior differs across harnesses. Codex and Pi load the ancestor chain of the launch cwd; other loaders can discover instructions while reading files. Kiro includes discovered nested AGENTS.md unconditionally, so Etymon uses `fileMatch` steering to represent authored directory scopes there. VS Code's nested AGENTS discovery is experimental and disabled by default, so its default writer uses `applyTo` instructions.

The manifest records placement explicitly:

```toml
version = 1

[rule.api]
path = "etymon/rules/api.md"
destDir = "packages/api"
```

`destDir` overrides the authored rule's `base`. Paths are project-relative directories; absolute paths, traversal, and glob characters are rejected. Changing `destDir` and syncing moves the native output and removes unchanged stale managed output. Imported nested files retain their directory automatically; `packages/api/.claude/CLAUDE.md` belongs to `packages/api`, rather than its configuration folder. Identical text at root and in a subdirectory remains two rules because their scopes differ.

A canonical rule file is human-editable:

```markdown
---
etymon: rule
name: types
base: packages/api
layout: modular
activation: glob
patterns:
  - '**/*.{ts,tsx}'
format: etymon
native: {}
---

Use explicit types for exported interfaces.
```

Always-on standing rules with a non-root base become nested AGENTS.md where supported, or verified native file-pattern rules for the equivalent subtree. Modular rules use equivalent native file patterns when available and otherwise fall back to supported nested instructions. Targets with neither capability return `RULE_SCOPE_UNSUPPORTED` and write nothing by default. Conditional directory/model combinations that cannot be preserved also block. With `--allow-lossy`, unsupported activation becomes always-on, unsupported directory scope becomes project-wide, and unmapped native conditions are omitted. Each change produces a warning naming the rule, destination, and lost conditions. Directory scope is retained whenever the destination can represent it. Disabled rules are omitted when the destination cannot express them; they are never enabled as a fallback. Oversized instruction groups are omitted with warnings rather than truncated. The authored source keeps its original semantics.

## Project and personal writers

Etymon deliberately restricts `--global` rules to unscoped, always-on personal guidance. It does not import or write project rule modules such as `~/.claude/rules/`, `~/.cursor/rules/`, or editor-profile rule directories. Some upstream harnesses support personal modular rules; they remain outside this Etymon scope policy. `--rules-path` selects an explicit **project** modular directory for one harness and cannot bypass the global restriction.

| Harness                                                                                                                                             | Preferred project guidance                   | Personal standing file                                  | Directory/file conditions                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------- |
| [Claude](https://code.claude.com/docs/en/memory)                                                                                                    | AGENTS.md                                    | ~/.claude/CLAUDE.md                                     | Nested files; .claude/rules paths                       |
| [Codex](https://learn.chatgpt.com/docs/agent-configuration/agents-md)                                                                               | AGENTS.md                                    | ~/.codex/AGENTS.md                                      | Nested launch-cwd chain; arbitrary globs blocked        |
| [Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions)                                     | AGENTS.md                                    | ~/.copilot/copilot-instructions.md                      | Nested files; .github/instructions applyTo              |
| [Copilot cloud](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions) | AGENTS.md                                    | No local personal writer                                | Nested files; repository applyTo; retain excludeAgent   |
| [VS Code local](https://code.visualstudio.com/docs/agent-customization/custom-instructions)                                                         | AGENTS.md                                    | Excluded profile modules                                | .github/instructions applyTo for directory scopes       |
| [Gemini](https://geminicli.com/docs/cli/gemini-md/)                                                                                                 | AGENTS.md with context.fileName registration | ~/.gemini/AGENTS.md with registration                   | Nested files; arbitrary activation blocked              |
| [Kiro](https://kiro.dev/docs/steering/)                                                                                                             | AGENTS.md                                    | ~/.kiro/steering/AGENTS.md                              | .kiro/steering fileMatch, manual, auto                  |
| [Pi](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/core/resource-loader.ts)                                    | AGENTS.md                                    | ~/.pi/agent/AGENTS.md                                   | Nested launch-cwd chain; conditional writer blocked     |
| [Oh My Pi](https://omp.sh/docs/context-files)                                                                                                       | AGENTS.md                                    | ~/.omp/agent/AGENTS.md                                  | Nested files; compatibility rule providers              |
| [OpenCode](https://opencode.ai/docs/rules/)                                                                                                         | AGENTS.md                                    | ~/.config/opencode/AGENTS.md                            | Nested files; configured instructions are unconditional |
| [Cursor](https://cursor.com/docs/rules)                                                                                                             | AGENTS.md                                    | No verified filesystem writer                           | Nested files; .cursor/rules/*.mdc                       |
| [Antigravity](https://antigravity.google/docs/rules)                                                                                                | AGENTS.md                                    | ~/.gemini/AGENTS.md                                     | Nested files; .agents/rules trigger modes               |
| [Roo](https://roocodeinc.github.io/Roo-Code/features/custom-instructions/)                                                                          | AGENTS.md                                    | Excluded personal modules                               | .roo/rules and rules-mode; directory globs blocked      |
| [Cline](https://docs.cline.bot/customization/cline-rules)                                                                                           | AGENTS.md                                    | ~/.agents/AGENTS.md                                     | .cline/rules paths; empty paths means disabled          |
| [Kilo](https://kilo.ai/docs/customize/agents-md)                                                                                                    | AGENTS.md                                    | ~/.config/kilo/AGENTS.md with instructions registration | Nested files; extra sources are unconditional           |
| [Continue](https://docs.continue.dev/customize/deep-dives/rules)                                                                                    | .continue/rules/*.md                         | Excluded personal modules                               | Globs; regex/compound conditions remain native          |
| [Cascade/Windsurf](https://docs.devin.ai/desktop/cascade/memories)                                                                                  | AGENTS.md                                    | ~/.codeium/windsurf/memories/global_rules.md            | Nested files; .devin/rules trigger modes                |
| [Amp](https://ampcode.com/docs/customize/agents-md)                                                                                                 | AGENTS.md                                    | ~/.config/amp/AGENTS.md                                 | Nested files; @-referenced glob guidance                |
| [Zed](https://zed.dev/docs/ai/instructions)                                                                                                         | AGENTS.md                                    | ~/.config/zed/AGENTS.md                                 | Root only; scoped conversion blocked                    |

Claude native AGENTS support requires the built-in agents-md plugin introduced in 2.1.277. Its default selection lets existing CLAUDE.md variants suppress AGENTS.md. Etymon can bridge a fully imported equivalent CLAUDE.md to `@AGENTS.md` during adopted sync. Distinct or private aliases that would suppress output block activation. User instruction settings can disable AGENTS discovery; diagnostics identify this. Private CLAUDE.local.md is not silently imported.

Codex AGENTS.override.md wins over AGENTS.md at each level, and the default combined instruction limit is 32 KiB. Pi has similar per-directory filename precedence. OMP context providers and Zed's compatibility filenames can shadow standardized output. Import honors known precedence and reports inactive guidance rather than silently activating it. Native trust and feature flags still apply.

Gemini configuration retains existing `context.fileName` entries, including the default GEMINI.md, while adding AGENTS.md. Removing the last Etymon rule retains these loader settings and releases their ownership, protecting user-defined filenames. Kilo's personal writer explicitly registers AGENTS.md in its configuration's instructions array. Cascade size limits are checked before writing: 6000 personal characters and 12000 project characters, including generated metadata.

## Deduplication and round trips

Rule identity includes body, effective scope, activation, patterns, and required native fields. Names, output layout, and non-activating descriptions do not create extra guidance. The first registration retains its layout when an equivalent copy is imported. Line endings and final newlines normalize; code indentation and content remain significant. Equivalent CLAUDE.md/AGENTS.md aliases become one registration with multiple `origins`. Native precedence remains relevant when their content differs.

Skill deduplication compares the complete bundle, including assets and executable modes. Equivalent `.agents/skills` and `.codex/skills` definitions register once. Native skill directory symlinks within the environment boundary are readable aliases; symlinks inside a skill bundle and symlink write destinations remain rejected. Same name with differing assets produces an import collision. Equivalent locked/local imports resolve once across commands; MCP source-format labels alone do not make an otherwise identical connection conflict.

Generated standing files use HTML comments to retain fragment identities; native scoped files retain a hashed scope comment so conversion can recover the original portable directory, activation, and layout. These markers do not alter the Markdown guidance. Editing native frontmatter invalidates the old saved scope and imports the new native condition. Removing one rule rebuilds shared files with their remaining fragments and owners. Manual edits to managed files still block replacement or removal.

Arbitrary native file includes, content predicates, tool-specific metadata, and private instruction files require explicit treatment. Etymon understands its standalone AGENTS include bridge and generated Amp references. Other standalone native include directives are reported for explicit expansion before portable import. It does not claim a complete interpreter for every harness's import syntax, interactive toggles, managed settings, or hosted rules. Unknown conditions remain native or block default translation; the diagnostic names the missing mapping. Explicit lossy sync can omit those conditions and warns about the resulting behavior.

See [executable scenarios](../testcases/README.md) and [verification](VERIFICATION.md) for tested behavior and native discovery coverage.
