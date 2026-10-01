# LobeHub, converted with Etymon

This demo uses a real checkout of [LobeHub at `4bcb808`](https://github.com/lobehub/lobehub/tree/4bcb808c608ed79497713ab20bcd03ac6d8713da) and the published `etymon@0.1.1` package. The README comparison comes from its Git index before and after migration. This is a local demonstration, not a change to LobeHub's upstream repository.

## Run it

From the Etymon repository, with Node.js 22+ and Git:

```bash
npm ci
node scripts/demo-lobehub.mjs

# Keep the temporary checkout to inspect the result
node scripts/demo-lobehub.mjs --keep

# Regenerate the README images from the verified run
node scripts/readme-comparison.mjs
```

The runner fetches the exact upstream commit, isolates user settings and caches, and runs `npx --yes etymon@0.1.1`. It installs no LobeHub dependencies and executes no project hooks or MCP servers. Successful runs update [lobehub.json](lobehub.json), which records commands, exit codes, source paths, bundle hashes, diagnostics, and checks. Temporary checkouts are removed unless `--keep` is supplied.

## What happened

```bash
npx --yes etymon@0.1.1 init
npx --yes etymon@0.1.1 convert --dry-run
npx --yes etymon@0.1.1 convert

# Keep the application's prompt template outside contributor guidance
npx --yes etymon@0.1.1 rules remove packages-agent-templates-src-templates-claw-instructions

# After verifying the imported copies, retire the original setup files
# The runner untracks these paths and clears their working copies:
# .agents/skills, .claude/skills, .codex/skills, .cursor/skills,
# .gemini/skills, AGENTS.md, GEMINI.md, e2e/CLAUDE.md,
# packages/model-runtime/CLAUDE.md

npx --yes etymon@0.1.1 sync --harness claude
npx --yes etymon@0.1.1 sync --harness codex,opencode --dry-run
npx --yes etymon@0.1.1 sync --harness codex,opencode --dry-run --allow-lossy
npx --yes etymon@0.1.1 sync --harness codex,opencode --allow-lossy
npx --yes etymon@0.1.1 doctor --harness claude,codex,opencode --allow-lossy
```

LobeHub already shares 50 skills through `.agents/skills` and four tool-specific symlinks. Conversion registered each skill once and preserved all **266 bundled files**, including executable bits. Running conversion again left the manifest and authored source unchanged.

Discovery also found five instruction files. One, `packages/agent-templates/src/templates/claw/AGENTS.md`, is imported by application code as a prompt template. The demo removes that registration and preserves the original application file. The remaining four rules retain their root, `e2e`, and `packages/model-runtime` scopes.

| Check                         | Result                                   |
| ----------------------------- | ---------------------------------------- |
| Registered source             | 50 skills, 4 rules                       |
| Complete skill bundles        | 266 files preserved                      |
| Repeated conversion           | Unchanged                                |
| Claude sync                   | Passed without lossy conversion          |
| Strict Codex/OpenCode preview | Blocked by Claude-specific skill fields  |
| Reviewed Codex/OpenCode sync  | Passed with 68 metadata warnings         |
| Repeated sync                 | Zero changes                             |
| Doctor                        | Passed                                   |
| External lock dependencies    | Zero; these are imported local resources |

Thirty-four skills contain Claude-specific fields such as `disable-model-invocation`, `argument-hint`, or `user-invocable`. Codex and OpenCode each require `--allow-lossy` to omit those fields, producing 68 warnings in total. The canonical copies retain the original metadata.

## What stays in Git

Etymon source lives in `.agents/etymon.toml`, `.agents/etymon.lock`, and `.agents/etymon/`. Generated native setup stays local. `convert` leaves originals untouched; retiring imported paths is a separate, explicit step in this demo.

The real repository also contains `.claude/prompts` used by workflows, `.cursor/docs`, `.github` workflows and community files, and helper code under `.agents`. Those files remain tracked. Every unrelated Git index entry is checked against the original checkout, and the runner verifies that no unrelated working file changed.

The README image therefore keeps `.claude`, `.cursor`, and `.github` visible. The portable agent configuration has one source under `.agents`; those other folders still contain files the project uses.

These checks cover configuration import, file preservation, rendering, and repeatability. They do not run LobeHub's application tests or send model requests.
