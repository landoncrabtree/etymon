# Verification

Evidence baseline: September 30, 2026. Harness profiles are documentation-backed mappings with capability gates; the full matrix is not a claim that every runtime has been installed and certified.

## Standards and provider evidence

The implementation was grounded in the current [Agent Skills specification](https://agentskills.io/specification), [skills CLI sources and flags](https://github.com/vercel-labs/skills), [MCP protocol 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28), [official registry API](https://modelcontextprotocol.io/registry/registry-aggregators), and [registry server schema](https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json). The registry's metadata version is independent of the protocol version.

Every harness profile includes its primary documentation links in `etymon harnesses --json`. The original technical inventory's primary-source pages were fetched again for skill, agent, and MCP mappings. Where a contract remained unresolved, the profile keeps a gate or requires an explicit configuration path.

## Automated checks

The current suite contains **124 tests**, all passing locally, including the localhost registry integration. Formatting, strict TypeScript checks, and the production build pass. The current tarball passed `npm run smoke` through actual npm/npx execution with fresh package resolution, including nested rules, inline MCP, stable resync, and doctor. An earlier packed-version check verified CLI output, generated lock metadata, and locked sync after changing the extracted package version. `npm audit --omit=dev` reports **zero vulnerabilities**. CI runs the full suite on Linux and macOS with Node 22 and 24; Windows is not certified by this release.

The rule suite covers all 19 project writers, verified standalone user writers, native activation formats, conditional/native requirements, nested placement, editable `destDir`, equivalent aliases, complete skill bundles and native symlinks, Claude include-bridge idempotence, native precedence, Markdown indentation, scope-preserving round trips, frontmatter edits, shared fragment removal/drift, Gemini loader settings, and immutable Git rule updates.

Nineteen numbered [executable scenarios](../testcases/README.md) invoke the built CLI in temporary Git repositories. **All 19 passed locally**, including the registry and terminal cases. Lifecycle scenarios validate actual manifest/lock/native bytes and repeated sync. Case 9 passed against Codex, OpenCode, Copilot, Claude, Gemini, Pi, and Kilo without inherited authentication or model calls. Gemini, Pi, and Kilo were installed into a temporary prefix for verification and removed afterward. CI uses verified version pins, with scheduled/manual runs against current upstream releases. Native API coverage is described per tool, not inferred from an adapter being present.

Uninstall checks cover preserving personal files after npm failure, symlink/directory rejection, active-operation locking, scope isolation, and unexpected package metadata. The real terminal scenario covers confirmation, cancellation, both personal-file choices, noninteractive defaults, and self-removal from an isolated npm prefix. Project files and native personal instructions remain intact.

The coverage workflow uses c8 over both unit and built-CLI scenarios and uploads HTML, LCOV, and JSON reports. The measured local baseline is **74.09% lines/statements, 73.5% branches, and 83.33% functions**, with all source files included. CI enforces minimums of 70% lines/statements, 65% branches, and 80% functions. Native discovery is tested separately; its installed tools are not needed by the coverage job. Source copied into a temporary npm installation is outside the original source filter, so the uninstall terminal scenario does not contribute to the original TUI file's coverage even though its behavior is verified.

Creation checks cover custom skill assets and metadata, canonical JSON agents and multiline instructions, inline STDIO/HTTP/SSE connections, environment references, scoped rules, equivalent-rule deduplication, invalid inputs, name collisions, source preservation, and editable-source resync. Real terminal forms exercise transport switching, validation followed by correction, cancellation without writes, standalone no-source `add`, explicit `create`, and creation from the main menu. Git checks confirm that initialization is idempotent, existing ignores survive, native and nested output is ignored, and authoritative resources and unrelated source/workflows remain trackable.

The suite verifies binary skill assets, native agent/MCP round trips, ownership adoption and drift, unchanged dry runs, scope separation, native conversion and editable-source reimport conflicts, credential externalization, safe removal, duplicate config rejection, comment-preserving edits, TOML multiline-string handling, shared-path conflicts, symlink rejection, rollback and crash recovery, registry selection and exact package versions, immutable Git restoration, and updates that change resolution only when requested.

CLI tests execute the actual TypeScript entry point with options after commands, JSON output, noninteractive help, and the TTY requirement. `npm run smoke` builds a tarball and invokes its executable through npm/npx in a clean temporary project.

Release workflow tests run the shell entry points in temporary projects with npm stubbed through an isolated PATH. They verify selection from the highest published stable version, repeated builds that reuse a pending version, synchronized package/lock metadata, publication previews of the selected archive, duplicate and mismatched-version rejection, and registry/check failures that leave versions unchanged. They never publish a real package.

Inline MCP checks cover imported credential references, local configurations that work after their input JSON is removed, preservation of native extension fields, idempotent reimport, authored-edit conflicts, and rejection of file-backed or missing-connection manifest entries.

## Local runtime observations

Installed versions during verification: Claude Code **2.1.286**, Codex CLI **0.159.1**, GitHub Copilot CLI **1.0.90-6**, OpenCode **1.18.30**, Gemini CLI **0.62.0**, Pi **0.99.2**, Kilo **7.8.1**, and Herdr **0.9.3**.

Gemini loads workspace skills and MCP settings only after native workspace trust is granted. The isolated discovery test uses its documented `GEMINI_CLI_TRUST_WORKSPACE=true` option and captures both stdout and stderr for inspection; Etymon does not grant trust in users' projects. See [Gemini trusted folders](https://geminicli.com/docs/cli/trusted-folders/). Pi's native SDK discovered the root/nested guidance and skills; Kilo's debug commands loaded the generated MCP settings, skill bundle, and agent prompt. These checks do not start model sessions.

Live external sources were resolved: `augmnt/agents/api-designer.md`, `vercel-labs/skills` / `find-skills` through `npx skills@1.7.0`, and `io.github.upstash/context7` from the official registry. Native projections were generated in an isolated temporary project. Cached offline resync produced no writes.

OpenCode's native agent debugger loaded the generated `api-designer` as a subagent and showed the expected tool restrictions. Claude's native MCP inspection found the project `context7` entry and correctly reported pending approval. Copilot's native MCP inspection found it as a workspace server after the verified temporary directory was trusted for the test. In an isolated trusted project and `CODEX_HOME`, Codex's actual app-server `skills/list` discovered the generated `etymon-check` skill, and `config/read` parsed the generated remote MCP configuration. No model calls were needed for these checks.

The neo-blessed TUI was exercised through an actual sibling Herdr pane without changing the user's focus. Checks include startup, a populated dashboard, harness selection, navigation, input dialogs, update flow, native-shadowing diagnostics, and clean terminal restoration. Modern extended terminfo capabilities exposed a neo-blessed parser error; initializing its program with standard capabilities removed the error, and startup and exit were rechecked. The temporary test pane was closed. The implementation uses [Herdr's documented CLI](https://herdr.dev/docs/cli-reference/) and [agent guide](https://herdr.dev/agent-guide.md).

These checks do not claim model behavior equivalence, automatic native trust, OAuth success, hosted-service reproducibility, or runtime certification of uninstalled editor/agent products. The current-native formats and limitations are explicit in each profile.
