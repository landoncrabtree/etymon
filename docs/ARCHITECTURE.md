# Architecture

User-facing installation and team workflows are in the [README](../README.md). Release builds use `scripts/npm_build.sh` and `scripts/npm_publish`; development uses `npm run check`, `npm run smoke`, and `./test_harness.sh`.

`services/uninstall.ts` inspects the active global npm prefix and removes Etymon through npm. `tui/uninstall.ts` reviews the installation and the two optional personal files before removal. Project resources, authored source, native configuration, and caches are retained. Noninteractive uninstall requires an explicit personal-file choice or `--yes`, which keeps them. Personal cleanup uses the workspace operation lock and rejects symlinked or non-file paths.

The resource pipeline is shared by the neo-blessed TUI, Commander CLI, and exported SDK.

Commands are native source dialects of skills, rather than a fifth resource kind. `core/commands.ts` validates invocation intent and retained native requirements in the standard string metadata map. `providers/commands.ts` parses command files/configuration without executing templates, normalizes names, and returns skill artifacts. Local command addition shares conversion's registration transaction; external commands use skill dependencies with a locked source format and bundle digest. `harnesses/command-profiles.ts` declares readers only. `skill-render.ts` projects verified invocation controls and gates unsupported native requirements. No legacy command writer is used. See [command migration](COMMANDS.md).

`services/create.ts` validates custom resources against one creation schema and writes source plus manifest through the journaled transaction. Skills become `SKILL.md` bundles, agents become canonical JSON, rules become canonical Markdown, and MCP connections remain inline. Authored files are not registered as generated output. `tui/create.ts` presents the schema in a scrolling form with native text editors, transport/activation selection, save/cancel controls, and validation before submission. Rule patterns appear only for glob activation; the global form omits project scopes and conditional activation. CLI flags and stdin bodies use the same service; no-source `add` and explicit `create` share this entry point.

`providers/source.ts` supplies the shared classification policy for the CLI, TUI, and service. Existing local paths win over Git shorthand or MCP registry IDs. Explicit local paths stop when missing, and filesystem/validation failures never trigger remote fallback. Explicit URLs and Git URIs stay remote. MCP accepts local JSON definitions or registry IDs; its classification does not add Git-backed definitions or treat an endpoint URL as a registry ID. The terminal inspection flow pins a chosen local path to its absolute location before registration.

Repository contribution skills and an always-on root rule are authored under `.agents/etymon/` through the same creation commands. Their registrations are project-scoped, with no external lock dependencies. `sync` generates ignored native copies; [CONTRIBUTING.md](CONTRIBUTING.md) is the human-facing version of these expectations.

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

| Module                              | Responsibility                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/core/model.ts`                 | Validated schemas, discriminated resources, value references, diagnostic codes            |
| `src/core/commands.ts`              | Command dialects and reserved skill invocation/native-requirement schemas                 |
| `src/core/dedup.ts`                 | Semantic rule identities and complete skill bundle comparison, independent of origins     |
| `src/core/fs.ts`                    | Bounded file bundles/downloads, content hashing/cache, process execution, path safety     |
| `src/core/workspace.ts`             | Project/global roots, authoritative files, operation mutex                                |
| `src/core/documents.ts`             | Duplicate detection, JSONC edits, native TOML table edits                                 |
| `src/core/transaction.ts`           | Whole-plan composition, drift/adoption, atomic file replacements, journal/recovery        |
| `src/providers/source.ts`           | Local, Git/forge URL parsing and pinned Git checkout                                      |
| `src/providers/skills.ts`           | Agent Skills validation and isolated pinned skills CLI staging                            |
| `src/providers/commands.ts`         | Inert native command parsing, file/config precedence, normalization and skill artifacts   |
| `src/providers/skill-policy.ts`     | Canonical policy metadata, supporting files and exact native projection normalization     |
| `src/providers/mcp.ts`              | Official v0.1 registry API, explicit implementation resolution and input handling         |
| `src/providers/agents.ts`           | Frontmatter parsing, agent discovery and native dialect detection                         |
| `src/providers/rules.ts`            | Rule formats, activation normalization, canonical Markdown, recoverable native scopes     |
| `src/providers/index.ts`            | External dependency resolution, artifact integrity and restoration                        |
| `src/harnesses/profiles.ts`         | Declarative paths, scopes, dialects, prerequisites and source evidence                    |
| `src/harnesses/render.ts`           | Native projections, tool mappings, conversion diagnostics, env launchers                  |
| `src/harnesses/command-profiles.ts` | Verified native command source locations and primary evidence                             |
| `src/harnesses/command-import.ts`   | Bounded native command discovery, exclusions, precedence and import provenance            |
| `src/harnesses/skill-profiles.ts`   | Verified destination invocation controls and primary evidence                             |
| `src/harnesses/skill-render.ts`     | Skill projections, manual policy, native command requirements and explicit lossy warnings |
| `src/harnesses/loss.ts`             | Eligible conversion limits and resource omission diagnostics                              |
| `src/harnesses/import.ts`           | Native resource extraction, credential externalization and phase diagnostics              |
| `src/harnesses/inspect.ts`          | Read-only compatibility alias, precedence and discovery diagnostics                       |
| `src/harnesses/native-discovery.ts` | Shared bounded instruction inventory, pre-parse exclusions, and safe instruction aliases  |
| `src/harnesses/discovery.ts`        | Verified read aliases kept separate from preferred native write paths                     |
| `src/harnesses/gitignore.ts`        | Profile-derived project ignores with authoritative-source exceptions                      |
| `src/harnesses/rule-profiles.ts`    | Rule locations, scope capabilities, native prerequisite notes and primary sources         |
| `src/harnesses/rule-import.ts`      | Bounded nested discovery, native precedence, condition preservation, merged origins       |
| `src/harnesses/rule-render.ts`      | Standing composition, scoped output, strict gates and explicit lossy projections          |
| `src/services/environment.ts`       | Add, environment assembly, sync, conversion, update, remove, doctor                       |
| `src/services/create.ts`            | Direct custom creation, shared validation, source/manifest transactions                   |
| `src/tui/create.ts`                 | Visible creation forms with multiline instructions and transport-specific fields          |
| `src/tui/app.ts`                    | Library widgets and user interaction; no terminal renderer or business logic duplication  |
| `src/cli.ts`                        | Scriptable command interface and TUI launch                                               |
| `src/index.ts`                      | Programmatic extension surface                                                            |

## Add a provider

Normalize a requested resource into `Dependency`, write bounded artifacts to `Cache`, and retain enough immutable provenance to recreate those exact bytes. Implement resolution separately from restoration. `sync` must restore the locked resolution and verify the digest; only `update` changes it. Add provider-specific tests for immutable restoration and malformed metadata. Do not start arbitrary MCP implementations during installation.

Skills are resolved through a pinned upstream CLI and then rendered by Etymon. The CLI stages with `universal`, `--copy`, explicit skill names, telemetry disabled, and a temporary working directory. Repository variant selection follows upstream discovery rather than rejecting differing native copies before staging. Every staged file and executable bit must match a bounded, validated source bundle; upstream-excluded files need not be present in the installed artifact. The selected original path, artifact digest, and Git commit are retained for restoration. Upstream installation state is discarded. Local discovery and native conversion retain strict collision checks.

Skill discovery skips unrelated repository aliases without following them. Complete bundles remain subject to strict symlink checks. Before upstream installation, Etymon copies validated bundles into a temporary source view at their original relative paths. All candidate variants and regular `.claude-plugin/marketplace.json`, `.claude-plugin/plugin.json`, and `skills-lock.json` files are retained so upstream selection keeps its documented inputs. These metadata files are bounded and cannot be links or traverse linked parent directories. This limits the upstream copier to validated input while preserving plugin discovery and the selected original source path.

## Add a harness

Start with a primary-source profile and an explicit scope. Declare only verified write paths. Reuse an existing dialect only when its semantics match; otherwise add a renderer and importer. Return `Unit` values rather than writing files directly. Unsupported semantics block default activation. Explicit --allow-lossy conversion adapts a copy, reports every lost condition, restriction, or omitted resource, and leaves canonical source intact. Invalid input, ownership conflicts, filesystem errors, and disabled or shadowed loaders remain errors. Add native round-trip fixtures and a real loader check when that runtime is available.

`Unit` represents a complete generated file or one structured map entry. The planner deduplicates identical multi-target units and rejects incompatible bytes at a shared path. It retains owners for unselected targets and prevents changing shared output without syncing those targets together.

## Ownership transaction

Before apply, native destinations are read and compared with the previous owned digest. Existing unmanaged units require `--adopt`; edits to owned units require `--force`. Deleted outputs can be restored. Stale unchanged outputs are removed; edited stale outputs block the plan. Structured edits preserve unrelated content and reject ambiguous documents.

Apply stores a private journal before writing, records each attempted write, checks for concurrent edits, and atomically replaces each file. Ownership state is the final write. On failure or explicit `recover`, safe applied changes are rolled back. Subsequent unrelated edits are preserved and reported as recovery conflicts. Filesystem operations across multiple files are recoverable, not a single global filesystem transaction.

Conversion discovers all supported native locations unless a tool filter is supplied. One bounded project inventory is shared across instruction readers; 128 directory levels and 100,000 entries allow ordinary deep monorepos while retaining hard limits. Repeatable project-relative exclusions prune discovery before parsing. Broken skill aliases report warnings, while out-of-bound skill links remain errors. Whole-directory skill aliases and resolved instruction symlinks retain provenance. Simple AGENTS.md include bridges merge the wrapper origin into the scoped rule. Default executable-resource collisions remain errors; explicit MCP conflict renaming retains each complete connection under a stable hash-suffixed name. Existing authored registrations participate in this resolution, so filtered reimports remain stable. Selected profiles are read in their declared order, and successfully imported rule paths and instruction/native interpretations are shared between readers so an alias cannot reinterpret a native file's activation or widen its directory scope. Explicit includes retain their own scope and interpretation instead of being treated as read aliases. The complete inventory is deduplicated before one transaction: rules compare content, effective scope and conditions; other resources compare their name and full semantic identity. Provenance paths merge, independent rules receive distinct names, and conflicting executable resources block the entire import. Existing authored registrations and external lock dependencies participate in deduplication. Discovery does not use saved sync targets or require installed tool executables.

Conversion uses the transaction machinery but does not acquire ongoing ownership of authored source or the native originals. Equivalent source can be reimported across aliases and harnesses; differing authored content blocks. The ignored operation mutex prevents concurrent CLI/TUI mutations; a crash can leave a mutex requiring manual removal after confirming no operation is active.

Authored and imported MCP definitions are embedded in `etymon.toml`, including canonical connections, environment references, native extension fields, and provenance. Skills, agents, and rules retain authored files. Rule registrations carry a `destDir` override; activation stays in canonical Markdown. Registry-backed MCPs retain immutable resolution metadata in the external lock. MCP manifest entries use a distinct strict schema that requires an inline connection and rejects file paths.

## MVP boundaries

This release implements the supported core of skills, MCP, agents, and rules. It does not synthesize executable agent bridges, convert hooks/plugins, modify hosted settings, or migrate authentication. Rule conditions without a verified mapping block default activation. Explicit --allow-lossy may broaden conditions or omit settings/resources with warnings; canonical source retains the original semantics. Validation, ownership, and native loader failures remain blocking. User rules deliberately exclude project/module scopes. Native import reads declared locations and verified aliases; inline agents and arbitrary editor profiles are not a complete environment inventory. Advanced native extensions remain attached to their original dialect and cannot silently become portable.

The artifact lock covers source commits, imported bytes, registry metadata, and provider/adapter versions. MCP runners pin top-level versions but do not freeze their transitive dependency graph. OCI tags and hosted services remain mutable; strict runtime materialization is future work. Unsupported formats or required capabilities result in actionable diagnostics.
