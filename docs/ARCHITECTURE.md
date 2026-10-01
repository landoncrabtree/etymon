# Architecture

User-facing installation and team workflows are in the [README](../README.md). Release builds use `scripts/npm_build.sh` and `scripts/npm_publish`; development uses `npm run check`, `npm run smoke`, and `./test_harness.sh`.

`services/uninstall.ts` inspects the active global npm prefix and removes Etymon through npm. `tui/uninstall.ts` reviews the installation and the two optional personal files before removal. Project resources, authored source, native configuration, and caches are retained. Noninteractive uninstall requires an explicit personal-file choice or `--yes`, which keeps them. Personal cleanup uses the workspace operation lock and rejects symlinked or non-file paths.

The resource pipeline is shared by the neo-blessed TUI, Commander CLI, and exported SDK.

`services/create.ts` validates custom resources against one creation schema and writes source plus manifest through the journaled transaction. Skills become `SKILL.md` bundles, agents become canonical JSON, rules become canonical Markdown, and MCP connections remain inline. Authored files are not registered as generated output. `tui/create.ts` presents the schema in a scrolling form with native text editors, transport selection, save/cancel controls, and validation before submission. CLI flags and stdin bodies use the same service; no-source `add` and explicit `create` share this entry point.

Project initialization creates the manifest and lockfile without replacing existing contents. `harnesses/gitignore.ts` derives native output and read-alias ignore paths from the profiles, adds explicit authoritative-file exceptions, and updates one owned block in `.gitignore`. Global initialization does not create a user `.gitignore`. `testcases/.gitignore` keeps native fixture sources trackable under the repository's generated-output patterns.

```text
Git / URL / skills CLI / MCP registry ──> external lock + artifact cache
Local files / native importer ────────> authored TOML + editable source
                                               │
                                      normalized resources
                                               │
                                      harness renderers
                                               │
                                   composed ownership plan
                                               │
                                    journaled native apply
```

## Modules

| Module                           | Responsibility                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/core/model.ts`              | Validated schemas, discriminated resources, value references, diagnostic codes           |
| `src/core/dedup.ts`              | Semantic rule identities and complete skill bundle comparison, independent of origins    |
| `src/core/fs.ts`                 | Bounded file bundles/downloads, content hashing/cache, process execution, path safety    |
| `src/core/workspace.ts`          | Project/global roots, authoritative files, operation mutex                               |
| `src/core/documents.ts`          | Duplicate detection, JSONC edits, native TOML table edits                                |
| `src/core/transaction.ts`        | Whole-plan composition, drift/adoption, atomic file replacements, journal/recovery       |
| `src/providers/source.ts`        | Local, Git/forge URL parsing and pinned Git checkout                                     |
| `src/providers/skills.ts`        | Agent Skills validation and isolated pinned skills CLI staging                           |
| `src/providers/mcp.ts`           | Official v0.1 registry API, explicit implementation resolution and input handling        |
| `src/providers/agents.ts`        | Frontmatter parsing, agent discovery and native dialect detection                        |
| `src/providers/rules.ts`         | Rule formats, activation normalization, canonical Markdown, recoverable native scopes    |
| `src/providers/index.ts`         | External dependency resolution, artifact integrity and restoration                       |
| `src/harnesses/profiles.ts`      | Declarative paths, scopes, dialects, prerequisites and source evidence                   |
| `src/harnesses/render.ts`        | Native projections, tool mappings, conservative conversion gates, env launchers          |
| `src/harnesses/import.ts`        | Native resource extraction, credential externalization and phase diagnostics             |
| `src/harnesses/inspect.ts`       | Read-only compatibility alias, precedence and discovery diagnostics                      |
| `src/harnesses/discovery.ts`     | Verified read aliases kept separate from preferred native write paths                    |
| `src/harnesses/gitignore.ts`     | Profile-derived project ignores with authoritative-source exceptions                     |
| `src/harnesses/rule-profiles.ts` | Rule locations, scope capabilities, native prerequisite notes and primary sources        |
| `src/harnesses/rule-import.ts`   | Bounded nested discovery, native precedence, condition preservation, merged origins      |
| `src/harnesses/rule-render.ts`   | Standing fragment composition, scoped native output and fail-closed activation gates     |
| `src/services/environment.ts`    | Add, environment assembly, sync, conversion, update, remove, doctor                      |
| `src/services/create.ts`         | Direct custom creation, shared validation, source/manifest transactions                  |
| `src/tui/create.ts`              | Visible creation forms with multiline instructions and transport-specific fields         |
| `src/tui/app.ts`                 | Library widgets and user interaction; no terminal renderer or business logic duplication |
| `src/cli.ts`                     | Scriptable command interface and TUI launch                                              |
| `src/index.ts`                   | Programmatic extension surface                                                           |

## Add a provider

Normalize a requested resource into `Dependency`, write bounded artifacts to `Cache`, and retain enough immutable provenance to recreate those exact bytes. Implement resolution separately from restoration. `sync` must restore the locked resolution and verify the digest; only `update` changes it. Add provider-specific tests for immutable restoration and malformed metadata. Do not start arbitrary MCP implementations during installation.

Skills are resolved through a pinned upstream CLI and then rendered by Etymon. The CLI stages with `universal`, `--copy`, explicit skill names, telemetry disabled, and a temporary working directory. Original source paths and Git commits are retained for restoration. Upstream installation state is discarded.

## Add a harness

Start with a primary-source profile and an explicit scope. Declare only verified write paths. Reuse an existing dialect only when its semantics match; otherwise add a renderer and importer. Return `Unit` values rather than writing files directly. Required semantics must fail before activation. Optional adaptations produce diagnostics. Add native round-trip fixtures and a real loader check when that runtime is available.

`Unit` represents a complete generated file or one structured map entry. The planner deduplicates identical multi-target units and rejects incompatible bytes at a shared path. It retains owners for unselected targets and prevents changing shared output without syncing those targets together.

## Ownership transaction

Before apply, native destinations are read and compared with the previous owned digest. Existing unmanaged units require `--adopt`; edits to owned units require `--force`. Deleted outputs can be restored. Stale unchanged outputs are removed; edited stale outputs block the plan. Structured edits preserve unrelated content and reject ambiguous documents.

Apply stores a private journal before writing, records each attempted write, checks for concurrent edits, and atomically replaces each file. Ownership state is the final write. On failure or explicit `recover`, safe applied changes are rolled back. Subsequent unrelated edits are preserved and reported as recovery conflicts. Filesystem operations across multiple files are recoverable, not a single global filesystem transaction.

Conversion uses this transaction machinery but does not acquire ongoing ownership of authored source or the native originals. Equivalent source can be reimported across aliases and harnesses; differing authored content blocks. The ignored operation mutex prevents concurrent CLI/TUI mutations; a crash can leave a mutex requiring manual removal after confirming no operation is active.

Authored and imported MCP definitions are embedded in `etymon.toml`, including canonical connections, environment references, native extension fields, and provenance. Skills, agents, and rules retain authored files. Rule registrations carry a `destDir` override; activation stays in canonical Markdown. Registry-backed MCPs retain immutable resolution metadata in the external lock. MCP manifest entries use a distinct strict schema that requires an inline connection and rejects file paths.

## MVP boundaries

This release implements the supported core of skills, MCP, agents, and rules. It does not synthesize executable agent bridges, convert hooks/plugins, modify hosted settings, or migrate authentication. Rule conditions without a verified mapping block activation, even with optional lossy adaptation. User rules deliberately exclude project/module scopes. Native import reads declared locations and verified aliases; inline agents and arbitrary editor profiles are not a complete environment inventory. Advanced native extensions remain attached to their original dialect and cannot silently become portable.

The artifact lock covers source commits, imported bytes, registry metadata, and provider/adapter versions. MCP runners pin top-level versions but do not freeze their transitive dependency graph. OCI tags and hosted services remain mutable; strict runtime materialization is future work. Unsupported formats or required capabilities result in actionable diagnostics.
