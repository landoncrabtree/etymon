# Executable scenarios

`testcases/1` through `testcases/19` are editable starting states. Each folder contains a `scenario.json` and ordinary native/source files. `scenarios.mjs` defines the operations and assertions; `native.mjs` contains checks against the actual installed harnesses.

Run from any directory:

```bash
./test_harness.sh                           # all lifecycle scenarios
./test_harness.sh 1 2 5                     # selected scenarios
./test_harness.sh 9 --native codex,opencode,copilot,claude
./test_harness.sh 9 --native gemini,pi,kilo  # install these CLIs first
./test_harness.sh --keep --report-dir ./test-results/local
npm run test:coverage
```

The runner builds Etymon, copies each fixture into a fresh temporary Git repository, commits its baseline, and invokes the built executable with isolated home/config/cache directories. It never modifies the numbered fixture folders or your personal configuration. Scenario 2 demonstrates clearing files and restoring their baseline with Git before testing Etymon restoration. Temporary directories are removed after success; failed runs are retained for inspection. `--keep` retains successful runs too. `--report-dir` saves command transcripts, assertions, generated files, and a JSON summary.

`convert <harness>` imports a native setup into Etymon. `sync --harness <harness>` exports the registered environment. Every scenario distinguishes these operations and checks the resulting manifest, lock, or native files. Repeated sync must produce no changes.

| Case | Behavior tested                                                                                                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Existing OpenCode MCP → authored manifest → Claude/Codex → equivalent reimport                                                                       |
| 2    | Nested AGENTS.md scopes → manifest `destDir` → deleted files restored by Codex → Continue globs → Zed capability gate                                |
| 3    | Real skills CLI stages a local Git fixture → commit/digest lock → Codex/Copilot → cached offline restoration                                         |
| 4    | Deterministic localhost MCP registry → exact metadata/digest lock → Copilot reimport/idempotence → Pi projection                                     |
| 5    | Equivalent rule/skill aliases register once; Claude bridge remains stable                                                                            |
| 6    | Standalone global guidance, no global project directories or conditional rules                                                                       |
| 7    | Cursor globs translate to Claude/Copilot; Codex cannot broaden activation                                                                            |
| 8    | Shared instruction fragments survive removal; manual output edits block deletion                                                                     |
| 9    | Installed harnesses use their own discovery APIs without sign-in or prompts                                                                          |
| 10   | Continue regex + glob/model conditions remain native and cannot be discarded                                                                         |
| 11   | Editable `destDir` moves guidance and removes stale native placement                                                                                 |
| 12   | Git agent lock, offline sync, explicit update, multiple targets, and removal                                                                         |
| 13   | Identical SKILL.md with conflicting supporting assets blocks import atomically                                                                       |
| 14   | JSONC comments/settings survive sync; credentials become runtime references                                                                          |
| 15   | All 19 project rule writers compose and resync without changes                                                                                       |
| 16   | Actual neo-blessed TUI in a POSIX terminal: rule registration, directory scope, harness dialog, and clean exit                                       |
| 17   | Actual global npm uninstall from the installed CLI: terminal keep/remove/cancel, dry-run, scripted defaults, and project preservation                |
| 18   | Initialization preserves project ignores and tracks authoritative files while ignoring native outputs from multiple tools                            |
| 19   | Custom creation from flags, stdin, and real terminal forms; multiline instructions, inline STDIO/HTTP/SSE, validation, cancellation, and stable sync |

Case 3 uses `npx skills@1.7.0`; first use needs npm access. `--skills-cli /absolute/path/to/skills/bin/cli.mjs` can use a preinstalled **real** 1.7.0 CLI in a restricted environment. The wrapper forwards the upstream command and checks its requested version; it does not simulate installation. Case 4 needs localhost sockets; `--skip-registry` explicitly reports that case as skipped. Case 9 is skipped unless `--native` selects installed loaders. Missing selected CLIs fail the scenario.

The native checks currently cover:

| Harness     | Actual inspection path                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Codex       | Stdio app-server `skills/list` and `config/read` in an isolated trusted project                                               |
| OpenCode    | `debug config`, `debug skill`, `debug agent fixture-reviewer`                                                                 |
| Copilot CLI | `instruction list --json` at root and nested cwd, `skill list --json`, `mcp list --json`                                      |
| Claude Code | `mcp get fixture`, including project scope and pending native approval                                                        |
| Gemini CLI  | `skills list`, `mcp list` with a deterministic local stdio server                                                             |
| Pi          | The installed package's actual `DefaultResourceLoader` SDK for skills and root/nested context; no extensions or model session |
| Kilo CLI    | `debug config`, `debug skill`, `debug agent fixture-reviewer`                                                                 |

No account credentials are inherited. No model requests are sent. Native discovery tests check loading/configuration, not model behavior. Claude does not expose the same inspection coverage as Copilot; its current check covers MCP configuration. Pi's check covers skills/context rather than claiming its MCP extension ran. Editor-only adapters receive format/lifecycle coverage rather than native runtime certification.

Cases 16, 17, and 19 use Python 3's standard-library POSIX terminal support, available on the configured Linux/macOS runners. They drive the built executable without modifying production code for testing. Case 17 packs an inert local package, installs it with real npm into an isolated prefix, stages the built Etymon executable there with existing dependencies, and verifies self-removal. No global installation outside the temporary prefix is touched. Case 19 validates keyboard navigation, multiline bodies, transport switching, invalid-save recovery, cancellation, and main-menu creation.

The inspection contracts are grounded in [Codex app-server documentation](https://learn.chatgpt.com/docs/app-server), [OpenCode CLI](https://opencode.ai/docs/cli/), [Copilot CLI reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference), [Claude CLI](https://code.claude.com/docs/en/cli-reference), [Gemini CLI reference](https://geminicli.com/docs/cli/cli-reference/), [Pi's resource loader](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/resource-loader.ts), and [Kilo CLI reference](https://kilo.ai/docs/code-with-ai/platforms/cli-reference).

CI runs lifecycle scenarios on Linux/macOS with Node 22/24. `native-harnesses.yml` installs seven real CLIs into a temporary prefix, records their version output, executes case 9, uploads transcripts, and removes the installation. All seven use locally verified version pins. Weekly and manual upstream runs test newer releases. Gemini's isolated fixture is trusted through its documented headless environment option; production sync does not change users' trust settings. Additional CLI adapters should declare an authenticated-free discovery path before joining this matrix.

`coverage.yml` runs [c8](https://github.com/bcoe/c8) over the unit suite and CLI scenarios, producing text, HTML, LCOV, and JSON coverage artifacts. All source files, including unexecuted files, are included. Coverage reporting needs npm access for the temporary c8 package; the normal test runner has no added coverage dependency. The measured baseline and enforced minimums are recorded in [verification notes](../docs/VERIFICATION.md).
