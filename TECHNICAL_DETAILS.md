# Etymon — Technical Details

**Document:** `TECHNICAL_DETAILS.md`

**Architecture revision:** September 30, 2026 — authored source, external locking, and bidirectional conversion

**Inventory baseline:** September 30, 2026; retained and qualified, not a new full runtime audit

**Status:** Implementation proposal and source-referenced native capability inventory; not a shipped or runtime-certified compatibility list

**Companion:** [PROJECT_PLAN.md](PROJECT_PLAN.md)

> Etymon combines authored configuration and locked external resources into one portable environment. Versioned harness adapters import supported native setups and export each selected target's current first-class format. Unsupported information is preserved and reported; required semantics cannot silently disappear.

## Contents

1. [Decisions and important findings](#1-decisions-and-important-findings)
2. [How to read the inventory](#2-how-to-read-the-inventory)
3. [Support overview](#3-support-overview)
4. [Harness-by-harness inventory](#4-harness-by-harness-inventory)
5. [Universal resource model](#5-universal-resource-model)
6. [Skills mapping](#6-skills-mapping)
7. [MCP mapping](#7-mcp-mapping)
8. [Agent mapping](#8-agent-mapping)
9. [Rules mapping](#9-rules-mapping)
10. [Plugin mapping and decomposition](#10-plugin-mapping-and-decomposition)
11. [Hooks mapping](#11-hooks-mapping)
12. [Authored configuration, lockfile, and reproducibility](#12-authored-configuration-lockfile-and-reproducibility)
13. [Safe synchronization and file ownership](#13-safe-synchronization-and-file-ownership)
14. [Bidirectional harness adapters and conversion](#14-bidirectional-harness-adapters-and-conversion)
15. [Validation and release gates](#15-validation-and-release-gates)
16. [Delivery sequence and unresolved questions](#16-delivery-sequence-and-unresolved-questions)
17. [Source index](#17-source-index)

---

## 1. Decisions and important findings

### 1.1 Current product contract

The product is **Etymon**; examples use the proposed `npx etymon` CLI. These commands and Etymon schemas are design contracts, not assertions that the npm package or adapters have shipped. [PROJECT_PLAN.md](PROJECT_PLAN.md) explains the user-facing goal; this document defines implementation boundaries.

There are two input journeys and one output journey:

```text
Registry/Git providers ── add ──────> locked external dependencies ──┐
                                                                  │
Native harness setup ── convert ──> authored source + verified locks ┼─> Environment
                                                                  │       │
Self-authored TOML + files ────────────────────────────────────────┘       │
                                                                         sync
                                                                          │
                                                              current native output
```

`sync` must actually materialize skills and merge native configuration, not just emit a portable file and ask the user to wire it up. The simplest supported path remains `add → lock → sync → native files`. Conversion adds `native input → editable Etymon environment → another native target`.

### 1.2 Authoritative ownership

| Input/state | Authoritative responsibility |
|---|---|
| `.agents/etymon.toml` | Optional authored-resource declarations, custom MCP connections, relationships and project-specific bindings/overrides |
| `.agents/etymon/{skills,agents,rules,plugins,hooks}/` | Editable first-party or imported resource files |
| `.agents/etymon/native/` | Optional sanitized, explicitly preserved native material; not automatically activated |
| `.agents/etymon.lock` | CLI-owned external dependency requests, immutable resolutions, provenance, transitive graph, and pinned build-tool metadata |
| `.agents/.etymon/` | Ignored machine state, input/output digests, ownership journal, runtime materialization and staging |
| Native harness files | Generated owned entries/files, alongside unrelated user-owned content |

The earlier lock-only model is superseded for mixed environments. There is still no `agents.toml`: the authored file is **`etymon.toml`**, and it does not duplicate the external dependency list. A registry-only project may omit it. An authored-only project may use an empty external lock. A mixed environment requires the manifest, source files, and lock together.

Editing a local prompt changes authored source, not the external lock. Updating an external package changes the lock, not an automatically vendored editable copy. Binding project settings to an external resource references its stable ID and does not redeclare its version. See Section 12.

### 1.3 Resource scope and roadmap

| Priority | Resources | Initial source strategy |
|---|---|---|
| P0 | Skills, MCP servers, agents | Agent Skills/skills.sh; official MCP Registry; Git/local agents; native import/export for the supported core |
| P1 | Rules | Local/Git and native imports; always-on and directory scope first |
| P2 | Plugins | Agent Plugins and native bundle importers; parent/child identity and safe decomposition |
| P3 | Hooks | Small versioned event/handler contracts and deliberately implemented bridges |

The six resource abstractions are **Skill, MCP, Agent, Rule, Plugin, and Hook**. A **Harness** abstraction has a versioned importer and exporter. Native-only preservation is an outcome/envelope, not a seventh universal executable resource type.

### 1.4 Standards and compatibility boundary

**Use a small useful portable core plus explicitly modeled extensions.** Do not implement every native feature up front, and do not shrink the model to the intersection of every harness. Required behaviors remain requirements even when they are outside the initial core. An unrepresentable restriction blocks activation; optional changes require a diagnostic and, when material, explicit acceptance.

Agent Skills is the skill format specification; skills.sh is its ecosystem/distribution integration. Agent Plugins supplies a portable bundle core for skills and MCP, with client-specific extensions. Neither standard supplies a complete universal agent/rule/hook execution model. Etymon owns those narrowly defined mappings. [STD-S] [SK-CLI] [STD-P]

**Read compatibility inputs; write current first-class native output.** The exporter chooses one authoritative destination per resource and scope. Supported legacy or foreign-harness read locations do not become default write locations. Shared standardized paths are valid native destinations when the harness defines them that way. See Section 2.4.

### 1.5 Inventory findings retained

The inventory below retains the earlier September 30, 2026 documentation/source baseline. This revision changes the architecture and spot-checks the standards and key native-output examples; it does not re-certify every listed runtime.

Native Codex documentation covers subagents, hooks, and plugins; old blanket assumptions that these concepts are absent must not drive adapters. [CX-A] [CX-H] [CX-P]

The application name alone is not a target identity. Copilot CLI, Copilot cloud, and VS Code Local need distinct contracts; executable Cline plugins and editor-extension features also have separate surface boundaries. [GH-A] [VS-H] [CN-P]

Several harnesses discover shared `.agents/` paths. Source is therefore namespaced under `.agents/etymon/`, and downloaded packages are staged separately. The proposed source layout must be tested for non-discovery; its name is not a sandbox. [CX-S] [AG-A] [AG-R]

A lock can pin external artifacts and generation rules. It cannot freeze a hosted MCP service or guarantee identical model behavior. Reproducibility now depends on **authored inputs + external lock + toolchain + target/bindings**, not just the lockfile.

---

## 2. How to read the inventory

### 2.1 Evidence and support labels

| Label | Meaning |
|---|---|
| **N — Native** | The reviewed native documentation/source describes the resource and a loading mechanism. This is not a claim of runtime testing. |
| **P — Partial / different primitive** | Related functionality exists, but differs in scope, lifecycle, or semantics. |
| **X — Extension-mediated** | Achievable through the harness's documented executable extension mechanism, not by dropping in a universal resource file. |
| **? — Unverified** | This review did not establish a sufficiently precise public contract. Do not emit speculative configuration. |
| **— — Explicitly unavailable in the stated surface** | Use only where a source explicitly excludes it. |

A “Native” entry is still subject to version, trust, entitlement, feature flags, and configuration precedence. “Unverified” does **not** mean the product cannot have the feature. These labels describe the **native product**, not shipped Etymon import/export support. Etymon certifies each direction and feature separately (Section 14).

### 2.2 Scope and path conventions

**P** means project/workspace; **U** means the current user; **B** means inside an installed bundle. Unless shown otherwise, project paths are relative to the selected project root. `~` is the home of the process actually running the harness, which may be a remote container rather than the developer's laptop.

Paths below are documented defaults and relevant compatibility locations, **not an exhaustive list of every administrator override or future release**. Where an editor manages its own user-profile location, use its configuration interface or a verified profile resolver instead of guessing a platform-specific `globalStorage` path.

A path may be a **read location**, not a safe **write target**. Etymon should choose one authoritative destination per resource/target, examine other read locations for conflicts, and avoid writing copies into every supported directory.

### 2.3 Versioned target identity

The target should be identified by:

```text
harness + surface + release/channel + operating system + config-root overrides
        + trust/feature configuration + installed extension prerequisites
```

For example, `copilot-cli`, `copilot-cloud`, and `vscode-local` are distinct adapters. `kiro-cli-current` and a legacy Kiro CLI profile must not share an unversioned hooks renderer. The current Kiro docs explicitly distinguish CLI 3.x / IDE 1.x from legacy generations. [KI-C]

This review did not install and execute every harness. Exact supported-version intervals must be established by the validation work in Section 15; do not label them “all versions.”

### 2.4 Preferred current-native write policy

For each resource, the adapter must keep a **read set** and a **preferred write target**. The read set can include recognized current, legacy and foreign-harness compatibility formats. Only the current first-class contract for the selected target profile is eligible for ordinary export.

Selection order:

1. Resolve explicit configuration-root overrides and requested scope without promoting scope.
2. Select the adapter's verified current-native schema/location for that target release.
3. Retain an existing equally current format variant when it avoids a duplicate configuration (for example OpenCode JSONC); preserve unrelated content.
4. Check all additional read locations for collisions, inherited restrictions and duplicate activation.
5. If there is no verified writer, report blocked/unverified. Do not fall back silently to a legacy or another harness's schema.

A shared standard location can be the native contract. Codex skills belong in `.agents/skills/`, not an invented `.codex/skills/` output simply to include the brand name. In contrast, Codex MCP is generated in `config.toml`, not a compatibility `.mcp.json`. [CX-S] [CX-M]

For a new OpenCode project configuration, Etymon chooses `opencode.json`; an existing current `opencode.jsonc` remains valid and is edited in place after ownership checks. Do not generate both just to avoid parsing the existing one. [OC-C]

Source under `.agents/etymon/` is separate from either read-set discovery or native output. The fact that a source file exists there must not itself register or activate it.

---

## 3. Support overview

The linked harness sections provide the specs, locations, qualifications, and primary sources for these abbreviated **native-capability** entries. They are retained research inventory, not an Etymon implementation or conversion certification matrix. **Plugins** includes native bundles or executable extensions, not necessarily a common format.

| Target | Skills | Agents | MCP | Plugins | Rules | Hooks |
|---|---|---|---|---|---|---|
| [Claude Code](#41-claude-code) | N | N | N | N | N | N |
| [Codex](#42-codex) | N | N | N | N | N | N |
| [Copilot CLI](#43-github-copilot-cli) | N | N | N | N | N | N |
| [Copilot cloud](#44-github-copilot-cloud-agent) | N / repository | N | N / service config | ? | N | P / cloud subset |
| [VS Code Local](#45-vs-code-local-agent) | N | N | N | N | N | N / preview |
| [Gemini CLI](#46-gemini-cli) | N | N / gated features | N | N / extensions | N | N |
| [Kiro](#47-kiro) | N | N | N | N / Powers | N / steering | N / versioned |
| [Pi](#48-pi) | N | X | N | N / packages + code | N | X |
| [Oh My Pi](#49-oh-my-pi-omp) | N | N | N | N / plugins | N | N / executable |
| [OpenCode](#410-opencode) | N | N | N | N / executable | N | X |
| [Cursor](#411-cursor) | N | N | N | N | N | N |
| [Antigravity](#412-antigravity) | N | N / CLI verified | N | P / contract incomplete | N | N / surface-qualified |
| [Roo Code](#413-roo-code) | N | P / custom modes | N | P / marketplace | N | ? |
| [Cline](#414-cline) | N | P / built-in delegation | N | N CLI; — IDE | N | X / CLI SDK; ? IDE contract |
| [Kilo](#415-kilo) | N | N | N | N / executable | N | X |
| [Continue](#416-continue) | ? | P / agent configurations | N | P / configuration blocks | N | ? |
| [Windsurf / Devin Cascade](#417-windsurf--devin-cascade) | N | ? custom file contract | N | ? portable contract | N | N |
| [Amp](#418-amp) | N | X | N | N / executable | N | X |
| [Zed native agent](#419-zed-native-agent-and-external-agent-boundary) | N | P / profiles | N | P / editor extensions | N | ? |

Do not collapse Roo, Cline, Kilo, and Continue into one adapter because they share an editor distribution channel or historical ancestry. Their current public configuration contracts differ substantially. [RO-A] [CN-C] [KL-M] [CT-C]

---

## 4. Harness-by-harness inventory

“Supported locations” identifies native inspection/loading inputs. “Etymon direction” proposes how supported meaning should be exported. Importers must parse each recognized source schema, preserve unsupported information, and classify provenance; a location alone does not establish a faithful importer. Section 4.21 makes the P0 default write selections explicit.

### 4.1 Claude Code

**Target:** Claude Code native configuration, not Claude Desktop or a hosted managed-agent API.

| Resource | Support and specification | Supported locations / loading | Etymon direction |
|---|---|---|---|
| Skills | **N.** `SKILL.md` with YAML frontmatter; Agent Skills plus Claude-specific invocation, tool, and fork-context fields. | P `.claude/skills/<name>/SKILL.md`, including discovered nested project roots; U `~/.claude/skills/`; B `skills/`; additional configured roots and managed skills. Legacy commands are another input format. [CL-S] | Generate one skill directory with all assets; do not treat Claude-only frontmatter as portable by default. |
| Agents | **N.** Markdown/YAML subagents: `name`, `description`, prompt body, tools, model, and optional execution settings. | P `.claude/agents/`; U `~/.claude/agents/`; plugin agent directories; CLI-supplied definitions. [CL-A] | Native subagent renderer; explicitly resolve tool names and permission behavior. |
| MCP | **N.** JSON `mcpServers`; stdio, HTTP, and legacy SSE definitions. | P `.mcp.json`; U `~/.claude.json`; project-local private registrations are also stored in the user's `.claude.json`, not a second repository MCP file. [CL-M] | Own managed keys inside the appropriate map; do not replace the full user file. |
| Plugins | **N.** Claude plugin bundle; `.claude-plugin/plugin.json`, with components relative to the bundle root. | Native installed-plugin loader or `--plugin-dir`; B `skills/`, `agents/`, `commands/`, `hooks/hooks.json`, `.mcp.json`. [CL-P] | Pin a local bundle and register through a supported loader; do not infer installation from the existence of a manifest alone. |
| Rules | **N.** Markdown memory/instructions; modular rules can have `paths` frontmatter. | P `CLAUDE.md`, `.claude/CLAUDE.md`, hierarchical `CLAUDE.md`, `.claude/rules/**/*.md`; U `~/.claude/CLAUDE.md`, `~/.claude/rules/`. [CL-R] | Prefer a separate managed modular rule where semantics fit; preserve hierarchy and imports. |
| Hooks | **N.** JSON `hooks`, event → matcher groups → handlers; command and additional native handler types. | P `.claude/settings.json`, `.claude/settings.local.json`; U `~/.claude/settings.json`; B `hooks/hooks.json`; applicable agent frontmatter. [CL-H] | Merge only owned handlers; event spelling alone does not establish portability. |

**Mapping hazards.** Claude's documented skill precedence can put personal skills above project skills. Plugin-provided subagents ignore certain frontmatter features, including hooks, MCP-server declarations, and permission mode. Flattening such a subagent into a standalone file can therefore change effective authority. A plugin's root `CLAUDE.md` is not automatically its instruction source. [CL-S] [CL-A] [CL-P]

**Preferred P0 writes:** `.claude/skills/<allocated-name>/`, `.claude/agents/<allocated-name>.md`, and owned entries in `.mcp.json`.

### 4.2 Codex

**Target:** Native Codex configuration. Keep app, CLI, IDE, and hosted availability as separate surface capabilities where their loaders differ.

| Resource | Support and specification | Supported locations / loading | Etymon direction |
|---|---|---|---|
| Skills | **N.** Agent Skills; optional OpenAI-specific `agents/openai.yaml` metadata. | P `.agents/skills/` discovered from working directory toward repository root; U `~/.agents/skills/`; administrator `/etc/codex/skills/`; bundled sources. [CX-S] | Shared skill path is valid but has cross-harness visibility. Preserve OpenAI metadata as a native extension. |
| Agents | **N.** TOML files with required `name`, `description`, `developer_instructions`; additional agent configuration forms a child-session config layer. | P `.codex/agents/*.toml`; U `~/.codex/agents/*.toml`; `[agents]` controls in Codex config. [CX-A] | Translate prompt body into `developer_instructions`; filename alone is not the agent identity. |
| MCP | **N.** TOML `[mcp_servers.<id>]`; command/args or remote URL, native auth and tool-filter fields. | U `~/.codex/config.toml`; trusted P `.codex/config.toml`; config-root overrides must be respected. [CX-M] | Structured TOML edits; preserve unrelated model, approval, sandbox, and authentication settings. |
| Plugins | **N.** Agent Plugins root `plugin.json`; OpenAI extensions. Compatibility packaging also exists. | Native plugin loader; B root `skills/`, `mcp.json`; compatibility `.codex-plugin/plugin.json`; native hook/application metadata where supported. [CX-P] | Prefer the declared portable spec version. Do not confuse compatibility `.mcp.json` with the standard's typed `mcp.json`. |
| Rules | **N.** Hierarchical `AGENTS.md` and `AGENTS.override.md`. | U Codex home instruction files; P repository root through working directory. Configurable discovery and size limits apply. [CX-R] | Map always-on/directory rules, but do not pretend arbitrary file-glob activation is equivalent. |
| Hooks | **N.** Native hook configuration and plugin hooks. | U `~/.codex/hooks.json`; P `.codex/hooks.json`; inline hooks configuration and B `hooks/hooks.json`/manifest-selected paths. [CX-H] | Sources can accumulate; prevent duplicate callbacks across inline, standalone, and plugin output. |

**Mapping hazards.** Agent files inherit omitted session settings. A supposedly minimal agent can inherit MCP access or other configuration. The compiler must distinguish deliberate inheritance from a requested restrictive environment. Native plugin overlay precedence also matters; an OpenAI namespaced extension can replace a compatibility overlay rather than merge field by field. [CX-A] [CX-P]

**Preferred P0 writes:** `.agents/skills/<allocated-name>/`, `.codex/agents/<allocated-name>.toml`, and owned `[mcp_servers]` entries in `.codex/config.toml`.

### 4.3 GitHub Copilot CLI

| Resource | Support and specification | Supported locations / loading | Etymon direction |
|---|---|---|---|
| Skills | **N.** Agent Skills with CLI additions such as invocation/tool-approval metadata. | P `.github/skills/`, `.agents/skills/`, `.claude/skills/`; U `~/.copilot/skills/`, `~/.agents/skills/`; plugin/configured sources. [GH-S] | Prefer `.github/skills/` for project output and `~/.copilot/skills/` for user output; inspect shared/foreign aliases. An approval hint is not a deny policy. |
| Agents | **N.** Markdown profiles, commonly `*.agent.md`; YAML description/tools and prompt body. | P `.github/agents/`; U `~/.copilot/agents/`; organization/enterprise agent repositories; Claude-compatible project directories are also documented by the plugin reference. [GH-A] [GH-A2] | Generate `.github/agents/<id>.agent.md`; account for user-level overrides and filename-derived identity. |
| MCP | **N.** JSON `mcpServers` or accepted bare map; local stdio uses `type: "local"`; remote HTTP has its own fields. | U `~/.copilot/mcp-config.json`; P `.mcp.json` or `.github/mcp.json`, searched through project ancestors; additional CLI config. [GH-M] | Prefer owned entries in `.github/mcp.json` for project output; inspect root `.mcp.json` as another read source and collision risk. |
| Plugins | **N.** Agent Plugins and legacy Copilot/Claude manifests. | Native plugin installation or `--plugin-dir`; U `~/.copilot/installed-plugins/`; standard root `plugin.json`; legacy `.plugin/`, `.github/plugin/`, `.claude-plugin/` manifest locations. [GH-P] | Pin the plugin spec and source; disable/avoid unmanaged auto-updating when claiming locked restoration. |
| Rules | **N.** Repository/personal instructions, path-specific instruction files, and compatible agent instruction files. | P `.github/copilot-instructions.md`, `.github/instructions/**/*.instructions.md`, `AGENTS.md`, `CLAUDE.md`, `.claude/CLAUDE.md`, `GEMINI.md`; U `~/.copilot/copilot-instructions.md`, `instructions/`. [GH-R] | Preserve `applyTo` behavior and avoid duplicating the same text through aliases. |
| Hooks | **N.** Versioned JSON with CLI event names such as `preToolUse`; shell-specific handler fields. | P `.github/hooks/*.json`; U `~/.copilot/hooks/`; additional settings/plugin/managed sources. [GH-H] | Use a CLI-specific hook adapter; do not copy VS Code's Local-agent hook dialect unchanged. |

**Mapping hazards.** User custom agents can override repository definitions. The agent configuration reference permits omitted tool lists to expose all tools, while an empty list means none; unknown tools may be ignored. A broken restriction must therefore be caught before generation. Some fields accepted by one Copilot surface are ignored by another. [GH-A] [GH-A2]

**Preferred P0 writes:** `.github/skills/<name>/`, `.github/agents/<id>.agent.md`, and owned entries in `.github/mcp.json`; user equivalents follow the native user paths above.

### 4.4 GitHub Copilot cloud agent

This is a remote execution target, not the CLI running in a local directory. The installation mechanism may be an exported repository artifact or a settings operation rather than a filesystem write on the current machine.

| Resource | Support and specification | Supported locations / loading | Etymon direction |
|---|---|---|---|
| Skills | **N, repository-scoped.** Agent Skills. | Repository skill directories supported by the cloud agent; do not assume laptop user directories are transferred. [GH-CS] | Generate committed/bootstrap-accessible skills; validate cloud discovery independently. |
| Agents | **N.** Copilot agent-profile format, with surface-specific unsupported fields. | Repository `.github/agents/`; organization/enterprise sources. [GH-A] | Export an agent profile; do not retain IDE-only handoffs as though enforced. |
| MCP | **N, service configuration.** Repository MCP settings and applicable agent-level `mcp-servers`. | Repository settings/service configuration; associated secret environment. This is not equivalent to writing local `~/.copilot/mcp-config.json`. [GH-CM] [GH-A] | Return a pending settings/export operation unless an authorized integration applies it. |
| Plugins | **?** CLI plugin support does not establish cloud support. | No cloud-general plugin installation contract established in this review. | Flatten verified components only, and report all remaining components. |
| Rules | **N.** Cloud-supported repository instructions. | P `.github/copilot-instructions.md`, `.github/instructions/**/*.instructions.md`, hierarchical `AGENTS.md`; compatible root `CLAUDE.md` / `GEMINI.md`. [GH-CR] | Generate repository-visible output and preserve target exclusions. |
| Hooks | **P.** Cloud-supported hook subset. | Tracked repository `.github/hooks/*.json`; user/plugin sources are not automatically equivalent. [GH-H] | Validate event support against the cloud profile. |

**Cloud MCP constraints:** the reviewed repository schema requires a tool selection and transport type. It supports tools rather than all MCP primitives, and does not support remote OAuth servers in this surface. Secret/variable references use the service’s `COPILOT_MCP_` naming requirements. These restrictions must be validated separately from CLI support. [GH-CM]

**Important product exception:** the default “ignore all generated files” strategy is unsuitable when the hosted agent only receives committed repository content. Offer an explicit **export-for-cloud** mode or a pinned bootstrap step. Do not silently commit files or mutate repository settings during `sync`.

### 4.5 VS Code Local agent

This adapter means VS Code's **Local agent customization system**. Claude/Codex sessions hosted by the editor retain their own native contracts.

| Resource | Support and specification | Supported locations / loading | Etymon direction |
|---|---|---|---|
| Skills | **N.** Agent Skills with local-agent extensions. | P `.github/skills/`, `.claude/skills/`, `.agents/skills/`; U `~/.copilot/skills/`, `~/.claude/skills/`, `~/.agents/skills/`; configured locations. [VS-S] | Allocate one discoverable copy; check flags for experimental extensions. |
| Agents | **N.** `*.agent.md` with YAML fields, tool selection, model, handoffs, and visibility controls. | P `.github/agents/` and supported `.claude/agents/` compatibility; U `~/.copilot/agents/` / `.claude/agents/` and configured locations. [VS-A] | Keep handoffs as IDE-specific workflow metadata unless another target explicitly implements them. |
| MCP | **N.** JSON **`servers`**, not `mcpServers`; interactive `inputs` supported. | P `.vscode/mcp.json`; workspace configuration; user-profile MCP configuration opened through VS Code's MCP configuration command. [VS-M] | Resolve the actual profile/remote context; never hard-code one OS's user directory. |
| Plugins | **N.** Agent Plugins and compatible native plugin bundles; client extras in `com.github.copilot`. | Native plugin/marketplace loader; B root `plugin.json`, `skills/`, `mcp.json`, namespaced agent/rule/hook components. [VS-P] | Use native registration or flatten supported resources. A VSIX extension is a different artifact class. |
| Rules | **N.** Repository instructions, `*.instructions.md`, and `AGENTS.md`. | P `.github/copilot-instructions.md`, `.github/instructions/`, `AGENTS.md`; configured/personal instruction locations. [VS-R] | Preserve `applyTo`, manual attachment, and other activation distinctions. |
| Hooks | **N, preview.** Local-agent JSON hooks using PascalCase lifecycle events. | P `.github/hooks/*.json`; U `~/.copilot/hooks/`; agent/plugin hooks. Claude settings compatibility requires the applicable setting. [VS-H] | Separate from CLI camelCase hooks; never write competing files that both loaders execute. |

**Hook compatibility warning:** VS Code Local can parse the numeric-version/camelCase Copilot hook format, but sends Local runtime payloads. Its optional Claude-settings compatibility ignores matcher values. Therefore syntactic acceptance is not proof that filtering or handler behavior is preserved. [VS-H]

**Preferred P0 writes:** `.github/skills/<name>/`, `.github/agents/*.agent.md` with an explicit compatibility check against Copilot CLI, and `.vscode/mcp.json` with owned `servers` entries.

### 4.6 Gemini CLI

| Resource | Support and specification | Supported locations / loading | Etymon direction |
|---|---|---|---|
| Skills | **N.** Agent Skills, with activation/permission behavior. | P `.gemini/skills/`, `.agents/skills/`; U `~/.gemini/skills/`, `~/.agents/skills/`; extension skills. [GE-S] | Prefer `.gemini/skills/` for project output and the native user root for global output; inspect shared paths rather than installing both. |
| Agents | **N; feature-gated capabilities.** Markdown/YAML subagents, including local and remote forms. | P `.gemini/agents/*.md`; U `~/.gemini/agents/*.md`; extension agents. [GE-A] | Local isolated agent and remote A2A agent are different canonical variants. Record required feature flags. |
| MCP | **N.** `mcpServers` in JSON settings. Stdio command/args; **`httpUrl` for Streamable HTTP**, **`url` for SSE**. | P `.gemini/settings.json`; U `~/.gemini/settings.json`; extension definitions. [GE-M] | Do not infer transport from a generic field named `url`; convert explicitly. |
| Plugins | **N, called extensions.** `gemini-extension.json`, with MCP/context metadata and bundled resources. | U `~/.gemini/extensions/<name>/`; native install/link operations; B `skills/`, `agents/`, `hooks/hooks.json`. [GE-P] | Use an extension importer/exporter; installation scope and workspace enablement are distinct. |
| Rules | **N.** `GEMINI.md`, configurable context filenames, and imports. | U `~/.gemini/GEMINI.md`; workspace/ancestor context and contextual directory discovery. [GE-R] | Keep hierarchical discovery; changing `context.fileName` is a global behavioral change, not a harmless file rename. |
| Hooks | **N.** Settings hooks and extension hooks; tool, model, and session event families. | P/U `.gemini/settings.json`; B `hooks/hooks.json`. [GE-H] | Translate event payloads and decisions, not just event names. |

**Preferred P0 writes:** `.gemini/skills/<name>/`, `.gemini/agents/<name>.md`, and owned `mcpServers` in `.gemini/settings.json`.

### 4.7 Kiro

**Profile boundary:** the current shared documentation covers IDE 1.x / CLI 3.x and points separately to legacy releases. Older `.kiro.hook` examples must not define the current adapter. [KI-C]

| Resource | Support and specification | Supported locations / loading | Etymon direction |
|---|---|---|---|
| Skills | **N.** `SKILL.md`; agent resources can refer to skills. | P `.kiro/skills/`; U `~/.kiro/skills/`; Powers/bundled skills. [KI-S] [KI-C] | Generate native skill directory or a declared agent resource reference. |
| Agents | **N.** JSON or Markdown/YAML definitions; tools, exclusions, resources, MCP/Powers inclusion, permissions, and prompt fields. | P `.kiro/agents/`; U `~/.kiro/agents/`. [KI-A] | Model selectable agents and delegated execution explicitly; preserve `includeMcpJson` / Powers exposure decisions. |
| MCP | **N.** JSON `mcpServers`; local and remote servers. | P `.kiro/settings/mcp.json`; U `~/.kiro/settings/mcp.json`; applicable agent/Powers configuration. [KI-M] [KI-C] | Own named server entries; do not broaden agent MCP inclusion automatically. |
| Plugins | **N, called Powers.** Agent Plugins `plugin.json` or legacy `POWER.md`. | Native Powers install/import from local directory or repository; bundle-managed resources. A stable cache directory is not established here as a write API. [KI-P] [KI-PI] | Use supported registration. Standard Power MCPs are internally managed; flattening can change activation lifetime. |
| Rules | **N, steering.** Markdown/YAML with `inclusion` and file-match/activation settings. | P `.kiro/steering/*.md`; U `~/.kiro/steering/*.md`. [KI-R] | Map always/file-match/manual/automatic modes only after comparing trigger semantics. |
| Hooks | **N.** Current versioned JSON hook list with `trigger`, `matcher`, and `action`. | P `.kiro/hooks/*.json`; U `~/.kiro/hooks/*.json`. [KI-H] | Current renderer differs from legacy IDE and CLI hooks. Editor save events cannot be substituted for tool completion. |

**Preferred P0 writes:** `.kiro/skills/`, `.kiro/agents/`, `.kiro/settings/mcp.json`. Power installation remains a P2 registration operation rather than an invented cache-file contract.

### 4.8 Pi

**Source basis:** current coding-agent documentation in the official `earendil-works/pi` repository. Do not assume historical Pi limitations still apply. [PI-C]

| Resource | Support and specification | Supported locations / loading | Etymon direction |
|---|---|---|---|
| Skills | **N.** Agent Skills. | P `.pi/skills/`, discovered `.agents/skills/`; U `~/.pi/agent/skills/`, `~/.agents/skills/`; package/configured paths. [PI-S] | Use a single discovered destination; preserve the complete skill tree. |
| Agents | **X.** Official subagent example extension; Markdown/YAML definitions consumed by that extension. | U `~/.pi/agent/agents/*.md`; P `.pi/agents/*.md` only when the extension's agent scope enables project definitions. [PI-A] | Install and pin the extension as an explicit dependency; copying agent files alone is insufficient. |
| MCP | **N, implemented by a built-in extension.** JSON `mcpServers`; stdio and Streamable HTTP. | P `.pi/mcp.json`; U `~/.pi/agent/mcp.json`. Legacy SSE is explicitly rejected by the reviewed implementation. [PI-M] | Verify the active MCP extension; another extension can replace the built-in command. |
| Plugins | **N, packages/extensions.** `package.json` with `pi` resources; npm/Git/local packages and executable extensions. | P `.pi/settings.json` package entries and `.pi/extensions/`; U `~/.pi/agent/settings.json`, `extensions/`; package resource directories. [PI-P] [PI-C] | Lock executable package artifacts and their runtime dependencies; do not treat them as portable Markdown bundles. |
| Rules | **N.** Agent instruction files and native context loading. | U `~/.pi/agent/AGENTS.override.md`, `AGENTS.md`, `CLAUDE.md`; project/ancestor instruction discovery. [PI-C] | Use the actual context loader's precedence and trust boundary; inspect ambient files. |
| Hooks | **X.** TypeScript/JavaScript Extension API events such as tool calls and session events. | P `.pi/extensions/`; U `~/.pi/agent/extensions/`; loaded packages/explicit extension paths. [PI-H] | A portable hook needs a generated, pinned executable bridge; no generic native hooks JSON is established. |

**Agent limitation:** the official example starts delegated Pi processes. User-level agents load by default; project agents require the appropriate `agentScope`. That prerequisite belongs in the capability plan, not hidden installation side effects. [PI-A]

### 4.9 Oh My Pi (OMP)

Pi and OMP are separate targets with separate roots and extension contracts.

| Resource | Support and specification | Supported locations / loading | Etymon direction |
|---|---|---|---|
| Skills | **N.** `SKILL.md`; native and compatibility providers. | P `.omp/skills/<name>/`; U `~/.omp/agent/skills/<name>/`; configured/profile sources. Native skill discovery expects the supported shallow layout. [OM-S] | Flatten skill names, not their internal assets; do not put a category directory between root and skill. |
| Agents | **N.** Markdown/YAML subagents with name, description, tools, model, and prompt. | P `.omp/agents/*.md`; U `~/.omp/agent/agents/*.md`; named profiles under `~/.omp/profiles/<profile>/agent/agents/`; plugin/extension sources. [OM-A] | Choose one profile root and emit a native agent definition. |
| MCP | **N.** JSON `mcpServers`, native configuration plus compatibility imports. | P `.omp/mcp.json`; U `~/.omp/agent/mcp.json`; profile equivalents; other harness files and generic root files can also be imported. [OM-M] | Enumerate all effective sources before writing; compatibility imports are a major duplication risk. |
| Plugins | **N.** npm/Git/local plugins and supported Claude-style marketplaces; `omp` package metadata. | Native plugin manager with explicit scope; extension configuration in `~/.omp/agent/config.yml`; package-managed resource roots. [OM-P] | Record registration as well as artifact contents; native runtime code remains target-specific. |
| Rules | **N.** Context files, `AGENTS.md`, and additional rule mechanisms. | P `.omp/AGENTS.md` and project instructions; U `~/.omp/agent/AGENTS.md`; `.omp/RULES.md` and compatibility context sources. [OM-R] | Do not assume every context file is concatenated; compatibility precedence can shadow another source. |
| Hooks | **N, executable.** JS/TS hooks using Extension API events. | P `.omp/hooks/pre/`, `.omp/hooks/post/`; U `~/.omp/agent/hooks/pre/`, `post/`; profiles and explicit hook paths. [OM-H] | The `pre`/`post` directory name does not itself bind an event; inspect exported code/registration. |

**Preferred P0 writes:** OMP-native directories, with cross-harness aliases treated as inspected inputs rather than additional output destinations.

### 4.10 OpenCode

| Resource | Support and specification | Supported locations / loading | Etymon direction |
|---|---|---|---|
| Skills | **N.** Agent Skills; unsupported frontmatter is not necessarily enforced. | P `.opencode/skills/`, `.claude/skills/`, `.agents/skills/`; U `~/.config/opencode/skills/`, `~/.claude/skills/`, `~/.agents/skills/`. [OC-S] | Emit only supported frontmatter; record unsupported semantics separately. |
| Agents | **N.** Markdown agents or JSON `agent` configuration; modes include primary and subagent. | P `.opencode/agents/*.md`; U `~/.config/opencode/agents/*.md`; `agent` entries in config. [OC-A] | Translate permissions and mode explicitly; an agent persona is not automatically a child session. |
| MCP | **N.** `mcp` map; `type: "local"` has a **command array** and `environment`; remote uses `type: "remote"`, URL/auth fields. | P `opencode.json` / `opencode.jsonc`; U `~/.config/opencode/opencode.json`; configured overrides. [OC-M] [OC-C] | Distinct renderer from `mcpServers` JSON clients. |
| Plugins | **N, executable.** JS/TS plugin API; configured npm packages. | P `.opencode/plugins/`; U `~/.config/opencode/plugins/`; `plugin` array in native config. [OC-P] | Preserve native packages; generate a small bridge only for a narrowly specified portable operation. |
| Rules | **N.** `AGENTS.md`, compatible instruction sources, and `instructions` configuration. | Project `AGENTS.md`; U `~/.config/opencode/AGENTS.md`; configured local/glob/other instruction sources. [OC-R] | Maintain file inclusion scope and avoid unwanted global content. |
| Hooks | **X.** Plugin callbacks and events, including before/after tool execution. | Same plugin locations; no portable standalone hooks JSON contract. [OC-P] | Use an executable bridge; pin the plugin API version. |

**Preferred P0 writes:** `.opencode/skills/<name>/`, `.opencode/agents/*.md`, and owned `mcp` entries in `opencode.json`; retain an existing current `opencode.jsonc` after ownership checks.

### 4.11 Cursor

| Resource | Support and specification | Supported locations / loading | Etymon direction |
|---|---|---|---|
| Skills | **N.** Agent Skills with Cursor behavior. | P `.agents/skills/`, `.cursor/skills/`; U equivalents; `.claude/skills/` and `.codex/skills/` compatibility locations. [CU-S] | Inspect aliases; shared paths may expose a skill to other installed harnesses. |
| Agents | **N.** Native subagent definitions with YAML frontmatter and prompt body. | P `.cursor/agents/`; U `~/.cursor/agents/`; documented Claude/Codex-compatible roots. [CU-A] | Prefer native `.cursor/agents/`; test the actual accepted format before importing a foreign directory wholesale. |
| MCP | **N.** JSON `mcpServers`; stdio, SSE, and HTTP; native variable expansion. | P `.cursor/mcp.json`; U `~/.cursor/mcp.json`. [CU-M] | Typed variable conversion; `${env:NAME}` is not interchangeable with every other client's syntax. |
| Plugins | **N.** Agent Plugins and Cursor-native plugin manifest. | Native plugin installation; local development `~/.cursor/plugins/local/<name>/`; root `plugin.json` or `.cursor-plugin/plugin.json`. [CU-P] | Do not invent a project plugin autoload directory. Preserve native components where possible. |
| Rules | **N.** `.mdc` rules with `description`, `globs`, `alwaysApply`; plain `AGENTS.md` support. | P `.cursor/rules/**/*.mdc`; project `AGENTS.md`; user rules through settings and team-managed rules. [CU-R] | `.md` in the rules directory is not an equivalent output. Global rules may require a settings operation. |
| Hooks | **N.** Cursor JSON hook events and handlers. | P `.cursor/hooks.json`; U `~/.cursor/hooks.json`; managed sources. [CU-H] | Account for working-directory and multi-scope aggregation semantics. |

**Mapping hazards.** A file generated for Claude or Codex may also be discovered by Cursor. Global hooks and project hooks can run in different working directories. Native event families include shell/MCP/file-edit distinctions that should not be flattened into one generic tool callback without a documented bridge. [CU-S] [CU-A] [CU-H]

### 4.12 Antigravity

**Target split:** CLI, IDE, and Antigravity 2.0 have overlapping but non-identical paths. The current documents include newer `.agents/` conventions and legacy `.agent/` compatibility. [AG-S] [AG-R]

| Resource | Support and specification | Supported locations / loading | Etymon direction |
|---|---|---|---|
| Skills | **N.** Agent Skills. | P `.agents/skills/`, legacy `.agent/skills/`; IDE/2.0 U `~/.gemini/config/skills/`, legacy Antigravity root; CLI U `~/.gemini/antigravity-cli/skills/`; plugin skills. [AG-S] | Use a surface-specific user root; avoid overwriting Gemini CLI resources. |
| Agents | **N for documented CLI custom agents.** Markdown/YAML. | P `.agents/agents/<name>.md` or `<name>/agent.md`; U `~/.gemini/config/agents/`. [AG-A] | CLI output can be specified; IDE parity remains separately gated. These directories cannot be used as inert source storage. |
| MCP | **N.** JSON `mcpServers`; local command/args; remote **`serverUrl`** in the reviewed configuration. | P `.agents/mcp_config.json`; U `~/.gemini/config/mcp_config.json`; surface-dependent integration. [AG-M] | Do not generate Gemini CLI's `httpUrl` or a generic `url` for this contract. |
| Plugins | **P.** CLI plugin installation and bundled skills/rules/hooks are documented, but a complete manifest/import contract was not established here. | CLI-installed bundles under `~/.gemini/antigravity-cli/plugins/<name>/`; native installation flow. [AG-S] [AG-R] [AG-H] | P2 importer blocked pending manifest/version verification; P0 components can be projected independently. |
| Rules | **N.** Directory instructions and YAML rules with `trigger` (`always_on`, `glob`, `model_decision`, `manual`). | P `AGENTS.md` / `GEMINI.md`, `.agents/AGENTS.md`, `.agents/rules/*.md`, legacy `.agent/rules/`; U `.gemini` instruction files and `~/.gemini/config/rules/`; CLI-specific rules root. [AG-R] | Validate required frontmatter. Flat scanning and explicit nested-rule registration differ from recursive loaders. |
| Hooks | **N, surface-qualified.** Named hook packs containing lifecycle events and handlers. | P `.agents/hooks.json`; U `~/.gemini/config/hooks.json`; CLI settings and plugin hook files. [AG-H] | The extra named-pack layer matters; Claude-like event names do not imply an identical top-level schema. |

**Preferred P0 writes:** current `.agents/skills/<name>/`, CLI-native `.agents/agents/` output only for its verified CLI profile, and owned `.agents/mcp_config.json` entries. Legacy `.agent/` paths are inspection/import inputs, not default new output.

### 4.13 Roo Code

| Resource | Support and specification | Supported locations / loading | Etymon direction |
|---|---|---|---|
| Skills | **N.** Agent Skills and native mode-aware skill features. | P `.roo/skills/`, `.agents/skills/`; U `~/.roo/skills/`, `~/.agents/skills/`; native mode-specific mechanisms require their own profile. [RO-S] | Base skill projection is straightforward; retain mode targeting as an extension. |
| Agents | **P: custom modes.** YAML/JSON `customModes`, with slug, role definition, tool groups, and instructions. | P `.roomodes`; user `custom_modes.yaml` opened/managed by the extension. [RO-A] | A mode is not an isolated reusable subagent. Translate only when the source permits persona/mode fallback. |
| MCP | **N.** Native JSON `mcpServers`. | P `.roo/mcp.json`; user `mcp_settings.json` in extension-managed storage. [RO-M] | Prefer project config; use the editor to resolve user config instead of hard-coding storage paths. |
| Plugins | **P: marketplace catalog.** Catalogued modes/MCP integrations are not evidence of a universal executable agent-plugin runtime. | Roo Marketplace and native component installation. [RO-P] | Decompose a package into supported skills, modes, and MCP definitions. |
| Rules | **N.** Markdown custom instructions, including mode-specific rules. | P `.roo/rules/`, `.roo/rules-<mode>/`; U `~/.roo/` equivalents; legacy `.roorules`; optional `AGENTS.md` support. [RO-R] | Preserve mode association; do not turn a mode rule into an unconditional project rule. |
| Hooks | **?** No precise native lifecycle-hook installation/schema contract established in the reviewed material. | No approved Etymon write destination. | Reject required portable hooks; do not invent a `.roo/hooks.json`. |

### 4.14 Cline

**Target split is mandatory:** IDE extension versus CLI/SDK/Kanban. Current plugin documentation explicitly excludes VS Code and JetBrains from its newer plugin runtime. [CN-P]

| Resource | Support and specification | Supported locations / loading | Etymon direction |
|---|---|---|---|
| Skills | **N.** Agent Skills. | P `.cline/skills/` (preferred), `.clinerules/skills/`, `.claude/skills/`; U `~/.cline/skills/`. Global same-name skills take precedence. [CN-S] | Generate one skill bundle and check compatibility aliases before activation. |
| Agents | **P.** Documented experimental read-only subagent research; CLI teams are another mechanism. A complete portable named-agent file schema was not established. | Config docs list P `.cline/agents/` and U `~/.cline/agents/`, but a directory listing is not a sufficient renderer contract. [CN-C] [CN-A] [CN-T] | Do not write guessed Claude-style files and call them installed. Keep custom-agent export gated. |
| MCP | **N, with a documentation conflict.** Native `mcpServers`; remote `streamableHttp` naming differs from some clients. | Configuration guide identifies `~/.cline/data/settings/cline_mcp_settings.json`; MCP guide names `~/.cline/mcp.json` for CLI. IDE uses its active settings interface. [CN-C] [CN-M] | Resolve by surface/release and active-config probe. Do not write both to hide uncertainty. |
| Plugins | **N CLI/SDK; unavailable in the stated IDE surfaces.** Executable `AgentPlugin` modules and package metadata. | P `.cline/plugins/`; U `~/.cline/plugins/`; native installed-plugin storage and CLI configuration. [CN-P] | Native-only modules; flatten portable resources for IDE targets rather than pretending the runtime exists there. |
| Rules | **N.** Cline rule files and current/legacy discovery conventions. | P `.clinerules/` and documented `.cline/rules/`; U `~/.cline/rules/`, legacy Documents/Cline rule locations. [CN-R] [CN-C] | Choose the verified generation's preferred root; inspect compatibility sources for duplicate loading. |
| Hooks | **X in current SDK plugin system.** Typed before/after run/model/tool callbacks and events. Standalone/IDE hook schema remains unverified here. | Loaded plugin modules; config also lists hook directories without establishing their complete contract. [CN-H] [CN-C] | Bridge against a pinned SDK plugin API; do not claim old hook-script conventions cover all current surfaces. |

**Agent limitation:** documented research subagents exclude several capabilities available to the main agent. An imported browser-enabled or write-enabled reviewer cannot be mapped to that primitive as an exact translation. [CN-A]

### 4.15 Kilo

**Current platform, not a copy of Roo's historical configuration.** Native configuration and plugin docs contain migration-era inconsistencies that require release-specific probes. [KL-M] [KL-P]

| Resource | Support and specification | Supported locations / loading | Etymon direction |
|---|---|---|---|
| Skills | **N.** Agent Skills and compatibility discovery. | P `.kilo/skills/`; U `~/.kilo/skills/`; compatible `.claude/skills/` and `.agents/skills/`; configured skill paths. [KL-S] | Do not carry over obsolete mode-specific folder assumptions. |
| Agents | **N.** Markdown subagents or native `agent` configuration. | P `.kilo/agents/*.md`; U `~/.config/kilo/agents/`; native config entries. [KL-A] | Preserve primary/subagent mode and native permissions. |
| MCP | **N.** `mcp` map, local command arrays or remote URL definitions. | P `kilo.json(c)` or `.kilo/kilo.json(c)`; U `~/.config/kilo/kilo.json(c)`. [KL-M] | Current-schema renderer; identify legacy `mcpServers` imports instead of merging dialects. |
| Plugins | **N, executable.** Native plugin descriptor/module and npm/local packages. | P `.kilo/plugin/` or `plugins/` alias; U `~/.config/kilo/plugin/`; config plugin entries; legacy `.kilocode/` compatibility. [KL-P] | Pin Kilo's API. Similarity to OpenCode is not proof of module-ABI compatibility. |
| Rules | **N.** Configured instruction files/globs and compatible rule sources. | `instructions` in Kilo config; files such as `.kilo/rules/` when referenced; legacy `.kilocode/rules/` discovery. [KL-R] | Do not assume every arbitrary file in a new folder auto-loads. |
| Hooks | **X.** Native plugin callbacks, including before/after tool execution. | Same executable plugin locations. [KL-P] | Generate an API-specific bridge rather than a nonexistent universal hooks file. |

**Validation blocker:** parts of the plugin documentation still mention OpenCode-named config/cache paths while the configuration reference specifies Kilo paths. The adapter must confirm the active release's behavior before managing plugin registration. [KL-P] [KL-M]

### 4.16 Continue

**Reviewed scope:** public config-v1/IDE customization documentation. Do not extend these conclusions to every separately released Continue CLI or hosted service without a profile audit.

| Resource | Support and specification | Supported locations / loading | Etymon direction |
|---|---|---|---|
| Skills | **?** A native Agent Skills `SKILL.md` discovery contract was not verified in the reviewed documentation. | No approved standalone skill destination established here. | Offer an explicitly lossy prompt/rule export only when requested; do not claim progressive-disclosure skill support. |
| Agents | **P.** “Agent” configuration composes models, rules, tools, context, and other blocks; not a verified isolated named-subagent file format. | Selected `config.yaml`/Hub configuration; user configuration commonly `~/.continue/config.yaml`. [CT-C] [CT-L] | Treat as a whole-profile export, not a Markdown subagent renderer. |
| MCP | **N.** Config-v1 `mcpServers` list; stdio/SSE/Streamable HTTP; JSON compatibility ingestion. | Selected config; P `.continue/mcpServers/*.yaml` or `*.json`. Standalone YAML blocks require metadata such as name/version/schema. [CT-M] | Prefer an owned standalone block rather than replacing the active agent configuration. |
| Plugins | **P.** Shareable configuration blocks and Hub composition. | `uses`/configuration composition in selected config; no generic executable agent-plugin ABI established here. [CT-C] | Decompose supported configuration components, not arbitrary plugin code. |
| Rules | **N.** Markdown/YAML rule metadata with `globs`, `regex`, `description`, `alwaysApply`. | P `.continue/rules/`; rules in selected configuration/Hub sources. [CT-R] | Preserve matching against supplied context and its lexicographic ordering. |
| Hooks | **?** No precise native lifecycle-hook schema/location established for the reviewed surface. | No approved write destination. | Block required hook projection until a versioned contract is verified. |

### 4.17 Windsurf / Devin Cascade

The reviewed official Windsurf URLs redirect to current Devin Desktop/Cascade documentation. These sources describe newer `.devin/` paths and retained `.windsurf/` compatibility. **Ship separate legacy/current profiles rather than rewriting every existing Windsurf setup.** [WI-S] [WI-R]

| Resource | Support and specification | Supported locations / loading | Etymon direction |
|---|---|---|---|
| Skills | **N.** Agent Skills. | P `.devin/skills/`, legacy `.windsurf/skills/`, shared `.agents/skills/`; U documented Devin and `~/.codeium/windsurf/skills/` locations; compatibility loaders. [WI-S] | Select paths from the actual detected product/release, not brand-name inference. |
| Agents | **? for reusable custom-subagent files.** Native modes/workflows do not establish an equivalent file contract. | No approved custom-agent destination established here. | Keep required isolated agents unsupported pending verification. |
| MCP | **N.** JSON `mcpServers`, local/remote server configuration. | Current U `~/.config/devin/mcp_config.json` or platform config equivalent; legacy roots require their own adapter. No project MCP destination is established here. [WI-M] | Project request may need an explicit user-scope registration or a supported isolated config root. |
| Plugins | **? for a portable agent-bundle loader.** Editor extensions and integrations are not interchangeable with agent plugins. | No approved generic package destination established here. | Extract only verified components. |
| Rules | **N.** Triggered Markdown rules and compatible instruction files. | P `.devin/rules/`, fallback `.windsurf/rules/`; `AGENTS.md`; U `~/.codeium/windsurf/memories/global_rules.md`. [WI-R] | Preserve activation modes; don't broaden a scoped rule during legacy migration. |
| Hooks | **N.** Native lifecycle hooks. | P `.devin/hooks.json`, fallback `.windsurf/hooks.json`; U `~/.codeium/windsurf/hooks.json`; JetBrains/system roots differ. [WI-H] | Surface-specific event and execution mapping. |

### 4.18 Amp

Amp is an additional integration candidate because its current docs cover skills, MCP, and an executable plugin API. This is a coverage decision, not a measured popularity ranking.

| Resource | Support and specification | Supported locations / loading | Etymon direction |
|---|---|---|---|
| Skills | **N.** Agent Skills plus native fields and plugin-qualified registrations. | P `.agents/skills/` and compatible sources; U `~/.config/agents/skills/`, `~/.agents/skills/`, `~/.config/amp/skills/`; Claude-compatible/configured sources. [AM-S] | Global definitions can mask project ones; inspect effective resolution. |
| Agents | **X.** Plugin API `createAgent` and registered delegation tools; custom modes also use executable registration. | Executable plugin modules, not a verified universal `agents/*.md` loader. [AM-A] | A custom subagent renderer requires a pinned bridge and an explicit runtime dependency. |
| MCP | **N.** `amp.mcpServers` configuration and other native sources. | P `.amp/settings.json`; U `~/.config/amp/settings.json`; `--mcp-config`; skill-bundled and remote definitions. [AM-M] | Preserve project trust checks and the separate environment used by hosted Orbs. |
| Plugins | **N, executable.** JS/TS module or directory `index.ts` / `index.js`, using `@ampcode/plugin`. | P `.amp/plugins/`; U config-root `amp/plugins/`; personal/workspace plugin repositories. [AM-P] | Pin source and loader contract; copying a skills subfolder does not perform native plugin registration. |
| Rules | **N.** `AGENTS.md` project instructions and native context conventions. | P/ancestor/subtree `AGENTS.md`; U `~/.config/amp/AGENTS.md` and `~/.config/AGENTS.md`; platform-managed guidance. [AM-R] | Preserve hierarchical scope. |
| Hooks | **X.** Plugin events such as `session.start`, `tool.call`, `tool.result`, `agent.start`, `agent.end`. | Same plugin module roots. [AM-H] | Match decision semantics; an agent turn ending is not a process/session ending. |

### 4.19 Zed native agent and external-agent boundary

| Resource | Support and specification | Supported locations / loading | Etymon direction |
|---|---|---|---|
| Skills | **N for Zed Agent.** Agent Skills, flat skill-root layout. | P `<worktree>/.agents/skills/<name>/`; U `~/.agents/skills/<name>/`; trusted worktrees required for project discovery. [ZD-S] | Do not use nested category folders; skills for external agents follow that agent's loader. |
| Agents | **P: profiles.** Native profiles select model and available tools; not equivalent to isolated prompt-defined subagents. | `agent.profiles` in Zed settings. [ZD-A] | Persona/tool-profile export only; reject required isolated-agent semantics. |
| MCP | **N.** `context_servers` configuration with command/args/env or remote URL. | Active Zed settings file opened through the editor; configured servers may be forwarded over ACP to external agents. [ZD-M] | Avoid configuring the same server in both host and delegated harness without a defined ownership policy. |
| Plugins | **P: editor extensions.** MCP/agent-server extensions have their own extension contracts. | Native Zed extension manager and development-extension workflow. [ZD-M] [ZD-X] | Not a drop-in Agent Plugins target. Extract skills/MCP where possible. |
| Rules | **N.** Personal/project instructions with a compatibility precedence list. | U `~/.config/zed/AGENTS.md` or Windows equivalent; P `AGENTS.md` plus higher-priority compatible filenames such as `.rules`. [ZD-R] | A newly generated `AGENTS.md` may be shadowed. Do not assume all files are concatenated. |
| Hooks | **? for a general native lifecycle-hook file/API suitable here.** | No approved portable-hook destination established in this review. | Delegate to the actual external harness where appropriate; do not confuse editor events with agent events. |

### 4.20 Further discovery queue

The explicit requested families are covered above, including qualified unknowns. Further candidates can be added after the first adapters are tested. Avoid claiming a popularity ranking without a defined metric. The useful expansion criterion is: **does a target expose a stable, testable configuration contract and enough users of Etymon request it?**

For editor-hosted agents and ACP clients, first determine whether a new resource adapter is necessary at all. Often the editor is only a host and the existing Claude/Codex/OpenCode adapter remains the correct dependency target. [ZD-X] [VS-A]

### 4.21 P0 preferred project output selections

These selections apply the Etymon native-first policy to the inventory, with each row still subject to release validation. User-scope equivalents and non-filesystem prerequisites remain in the individual profiles. A dash here means **no approved Etymon writer in this inventory**, not universal native feature absence.

| Target/profile | Skill output | Agent output | MCP output |
|---|---|---|---|
| Claude Code | `.claude/skills/<name>/` | `.claude/agents/<name>.md` | Owned `mcpServers` in `.mcp.json` |
| Codex | `.agents/skills/<name>/` | `.codex/agents/<name>.toml` | Owned `[mcp_servers]` in `.codex/config.toml` |
| Copilot CLI | `.github/skills/<name>/` | `.github/agents/<name>.agent.md` | Owned `mcpServers` in `.github/mcp.json` |
| Copilot cloud | Repository-visible supported skill output | `.github/agents/<name>.agent.md` | Explicit repository/service settings operation |
| VS Code Local | `.github/skills/<name>/` | `.github/agents/<name>.agent.md` | Owned `servers` in `.vscode/mcp.json` |
| Gemini CLI | `.gemini/skills/<name>/` | `.gemini/agents/<name>.md` | `.gemini/settings.json` |
| Kiro current | `.kiro/skills/<name>/` | `.kiro/agents/`, verified current profile schema | `.kiro/settings/mcp.json` |
| Pi | `.pi/skills/<name>/` | `.pi/agents/` only with the pinned extension and allowed project scope | `.pi/mcp.json` |
| OMP | `.omp/skills/<name>/` | `.omp/agents/<name>.md` | `.omp/mcp.json` |
| OpenCode | `.opencode/skills/<name>/` | `.opencode/agents/<name>.md` | `opencode.json`; retain an existing current `.jsonc` variant |
| Cursor | `.cursor/skills/<name>/` | `.cursor/agents/<name>.md` | `.cursor/mcp.json` |
| Antigravity current | `.agents/skills/<name>/` | `.agents/agents/` for the verified CLI surface | `.agents/mcp_config.json` for the supported surface |
| Roo | `.roo/skills/<name>/` | `.roomodes` only for an explicitly permitted persona mapping | `.roo/mcp.json` |
| Cline | `.cline/skills/<name>/` | — until schema/loader verification | — until requested scope/surface resolves the documented path conflict |
| Kilo current | `.kilo/skills/<name>/` | `.kilo/agents/<name>.md` | Project `kilo.json`; verified current variants inspected before writing |
| Continue reviewed IDE profile | — | Explicit whole-profile export only | `.continue/mcpServers/etymon-<name>.yaml` |
| Devin Cascade current | `.devin/skills/<name>/` | — | No verified project writer; do not silently use user scope |
| Amp | `.agents/skills/<name>/` | Explicit pinned executable bridge, not guessed Markdown | `.amp/settings.json` |
| Zed native | `.agents/skills/<name>/` | Explicit native profile operation, not an isolated-agent file | Active settings operation; verify requested scope |

Evidence is supplied in Sections 4.1–4.19. The extra selection table is Etymon policy, not a claim that each application mandates the selected spelling when multiple current paths exist. Legacy Windsurf and other old-generation profiles require separate explicit selection; they are not fallback writers for a current target.

Native shared-path collisions must still be planned across targets. A native-first preference does not authorize writing duplicate skills or incompatible agent definitions where another selected client reads the same or aliased path.

---

## 5. Universal resource model

### 5.1 A portable core, not a universal native-file dump

The resource model describes meaning; authoring formats remain appropriate to each resource. Keep a standard skill as a `SKILL.md` tree. Keep supported standard plugin bundles as bundles. Use Etymon-specific, versioned definitions only where a suitable portable contract has not been adopted.

A normalized **Environment** is an in-memory build input, not another hand-edited manifest and not a serialized copy of all authored files in the lock.

```text
Authored TOML + source ─── parse ──────────────┐
                                             │
Locked external artifacts ── normalize ───────┼─> Environment
                                             │      │
Reviewed local bindings ── validate/overlay ──┘      ├─> Claude exporter
                                                    ├─> Codex exporter
Native harness ── importer ──> proposed source/lock  └─> other exporters
```

The native importer produces an **ImportPlan** for source and lock changes. It does not silently insert a second live environment into the current session. Registry providers and harness importers are different input mechanisms that converge on the same model.

### 5.2 Resource contracts

| Resource | Portable starting point | Etymon-owned additions |
|---|---|---|
| Skill | Agent Skills directory and metadata | Provenance, dependencies, activation requirements, bounded native extensions |
| MCP | Explicit connection/transport semantics; supported standard plugin MCP input | Artifact/runtime resolution, typed values and auth, scope, target-specific configuration |
| Agent | Versioned Etymon Markdown/YAML profile | Prompt, execution role, resource relationships, supported tools/restrictions |
| Rule | Markdown content with Etymon-declared activation | Scope, matching basis, ordering and native import/export |
| Plugin | Recognized Agent Plugins or native package format | Parent-child graph, lifecycle requirements, decomposition decisions |
| Hook | Versioned opt-in Etymon handler contract | Precisely modeled events, payload/result conversion and execution requirements |

Agent Skills and Agent Plugins define their respective file formats; the remaining columns are Etymon design choices, not fields claimed to be part of those standards. [STD-S] [STD-P]

### 5.3 Proposed core types

The following TypeScript sketches describe the implementation boundary. They are not a released SDK. Persistence schemas validate equivalent concepts without requiring all resources to be stored in one file format.

```ts
type ResourceKind = "skill" | "mcp" | "agent" | "rule" | "plugin" | "hook";
type ResourceId = string; // Validated as kind:local/name or kind:external/name.
type RequirementLevel = "required" | "optional";
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

type ResourceOrigin =
  | { kind: "authored"; manifestKey: string; sourceRoot: string }
  | { kind: "external"; lockId: ResourceId; artifactDigest: string };

type ValueRef =
  | { kind: "literal"; value: string }
  | { kind: "environment"; name: string }
  | { kind: "secret"; name: string }
  | { kind: "project-path"; path: string }
  | { kind: "artifact-path"; resourceId: ResourceId; path: string };

interface Requirement {
  capability: string;
  level: RequirementLevel;
  reason: string;
}

interface NativeExtension {
  namespace: string;
  schema: string;
  payload: Json;
  required: boolean;
}

interface ResourceBase {
  id: ResourceId;
  kind: ResourceKind;
  origin: ResourceOrigin;
  displayName: string;
  description?: string;
  dependsOn: ResourceId[];
  requires: Requirement[];
  nativeExtensions: NativeExtension[];
}

interface SkillResource extends ResourceBase {
  kind: "skill";
  name: string;
  instructionFile: string; // Relative to its authored or immutable source tree.
  activation: {
    automatic: "inherit" | "enabled" | "disabled";
    userInvocable: "inherit" | "enabled" | "disabled";
    isolation: "inherit" | "child-session";
  };
  declaredToolPreferences: string[];
}

type McpConnection =
  | {
      transport: "stdio";
      executable: ValueRef;
      args: ValueRef[];
      env: Record<string, ValueRef>;
      cwd?: ValueRef;
      runtimeArtifact?: ResourceId;
    }
  | {
      transport: "streamable-http" | "sse";
      url: string;
      headers: Record<string, ValueRef>;
      auth:
        | { scheme: "none" }
        | { scheme: "bearer"; token: ValueRef }
        | { scheme: "oauth" | "native"; provider?: string };
    };

interface McpResource extends ResourceBase {
  kind: "mcp";
  connection: McpConnection;
  timeouts?: { startupMs?: number; requestMs?: number };
  exposedTools?: { allow?: string[]; deny?: string[] };
  scope: "session" | "agent" | "plugin";
}

type AgentExecution =
  | { kind: "persona" }
  | { kind: "isolated-subagent"; delegateFurther: "inherit" | "allow" | "deny" }
  | { kind: "remote-agent"; protocol: string; endpoint: string };

interface AgentResource extends ResourceBase {
  kind: "agent";
  instructionFile: string;
  execution: AgentExecution;
  skills: ResourceId[];
  mcpServers: ResourceId[];
  tools: { include: string[]; exclude: string[]; inherit: boolean };
  authority: {
    filesystem: "inherit" | "read-only" | "workspace-write";
    shell: "inherit" | "deny" | "allow";
    network: "inherit" | "deny" | "allow";
  };
  model: { strategy: "inherit" | "named-policy"; policyName?: string };
}

type RuleActivation =
  | { kind: "always" }
  | { kind: "directory"; root: string }
  | { kind: "file-match"; patterns: string[]; matchBasis: "accessed-file" | "attached-context" }
  | { kind: "model-select"; description: string }
  | { kind: "manual" };

interface RuleResource extends ResourceBase {
  kind: "rule";
  instructionFile: string;
  activation: RuleActivation;
  order: number;
}

interface PluginResource extends ResourceBase {
  kind: "plugin";
  format: string;
  manifestPath: string;
  children: ResourceId[];
  nativeRuntimeModules: string[];
  activation: "always" | "on-demand" | "native";
}

interface HookResource extends ResourceBase {
  kind: "hook";
  event: "tool.before" | "tool.after" | "session.start" | "session.end" | "agent.turn.end";
  handlerRoot: string;
  handlerEntrypoint: string;
  inputContract: string;
  outputContract: string;
  blocking: boolean;
  failureMode: "deny" | "report";
  timeoutMs: number;
}

type Resource = SkillResource | McpResource | AgentResource |
                RuleResource | PluginResource | HookResource;

interface Environment {
  schemaVersion: number;
  resources: ReadonlyMap<ResourceId, Resource>;
  roots: readonly ResourceId[];
  inputDigest: string;       // Hash of this build's authored + locked inputs.
  toolchainRevision: string;
}
```

Resource IDs are not native filenames. Two sources with the same display name do not become the same dependency. Target alias allocation is deterministic and records collisions; known structural references are rewritten together. Natural-language references are not silently rewritten.

`origin` controls ownership, not portability. An authored MCP and a registry-resolved MCP pass through the same destination renderer. Import provenance is metadata attached to authored source or the relevant external resolution; it does not require a separate "imported" runtime type.

### 5.4 Authoring and merge rules

Normalize external packages from the pinned artifacts, parse current authored files, and then apply only schema-approved project bindings. The merged Environment is disposable. The original inputs remain authoritative.

A binding may configure environment references, enabled state, or an explicitly supported tool selection for an external MCP. It may not replace its repository, version, integrity, executable artifact, or package dependency graph. Changing those values is an external dependency mutation or an explicit local fork.

Duplicate declarations for one ID, dangling references, conflicting source metadata, and dependency cycles with unsupported semantics are errors. Do not silently deduplicate by display name or perform a generic deep merge of unknown native objects.

### 5.5 Core-first does not mean silently permissive

Keep the initial model useful: complete skills, explicit MCP connections, agent instructions/roles/relationships, and later narrowly scoped rules and hooks. Unsupported advanced behavior stays in native extensions or preserved records. A target that only supports a persona is not automatically an isolated-subagent target.

Unknown omitted semantics must not default to permission grants. Importers retain whether a source explicitly configured a value or inherited it. A required read-only execution guarantee needs enforcement; a prompt instruction or a hidden editor tool does not establish it.

Model selection is similarly explicit: preserve a native-only model requirement or use a reviewed named model policy. Do not map brands or aliases by informal "fast"/"reasoning" categories.

### 5.6 Conversion results and evidence

Use four primary outcomes at resource or feature granularity:

```ts
type ConversionOutcome = "exact" | "adapted" | "native-only" | "blocked";
type EvidenceStatus = "verified" | "documentation-only" | "unverified";
type ActivationStatus = "not-applied" | "materialized" | "registered" |
                        "discovered" | "usable" | "external-step";

interface ConversionResult {
  resourceId?: ResourceId;
  outcome: ConversionOutcome;
  evidence: EvidenceStatus;
  changes: readonly string[];
  requiresAcknowledgement: boolean;
  preservedNativePaths: readonly string[];
}
```

**Exact** means no known semantic change within a validated contract, not identical text formatting or model decisions. **Adapted** describes a defined translation; optional losses must be enumerated and acknowledged where material. **Native-only** preserves material but does not activate it on foreign targets. **Blocked** prevents an unrepresentable required behavior from being installed.

Evidence and activation are separate axes. A mapping can be documented but not runtime-certified, and a correctly rendered MCP can still need authentication. An unverified adapter cannot label a security guarantee exact. Unknown behavior is conservatively preserved or blocked, never treated as an optional omission by default.

Native-only preservation must survive future same-harness export where a tested mapping exists, but it is not a license to replay opaque code or unknown settings automatically. Every resource/component is accounted for in the report.

---

## 6. Skills mapping

### 6.1 Portable base

Reuse Agent Skills for `SKILL.md`, metadata, and bundled files. It defines the base format; skills.sh is the source/distribution integration, not the owner of every harness's runtime semantics. Keep `scripts/`, `references/`, and other assets with their skill. [STD-S] [SK-CLI]

For broad compatibility, emit a flat `<skill-root>/<name>/SKILL.md` structure. This remains compatible with loaders that accept deeper layouts while avoiding failures in flat-only loaders such as Zed and the standard plugin layout. [ZD-S] [STD-P]

### 6.2 Feature-level treatment

| Skill feature | Canonical handling | Translation policy |
|---|---|---|
| Name, description, Markdown body | Standard skill fields and artifact files | Preserve bytes where possible; validate target constraints. |
| Relative scripts/assets/references | Full artifact subtree | Never copy only `SKILL.md`; preserve safe relative references and executable file modes. |
| Manual invocation | Explicit activation field | Keep native invocation syntax in the adapter, not in the resource identity. |
| Automatic activation disabled | Explicit requirement | If the target cannot prevent automatic loading, block a required manual-only skill. |
| Tool hints / `allowed-tools` | Declared preferences plus native semantics | Do not reinterpret an approval list as a security allowlist. |
| Forked context / subagent binding | Isolation and agent dependency | Treat as agent execution, not an innocuous extra frontmatter field. |
| Dynamic shell-expanded instructions | Executable/native extension | Never evaluate during dependency resolution; trust and execution phase must be explicit. |
| Vendor UI metadata | Namespaced extension | Preserve only for consumers that understand it. |

For example, Claude and Copilot document skill-specific behavior beyond the base format, and OpenCode may ignore unrecognized fields. “The file parses” therefore does not imply every field is enforced. [CL-S] [GH-S] [OC-S]

### 6.3 Discovery and deduplication

Store the **source skill name**, **graph ID**, and **target-installed name** separately. A graph ID can be `skill:acme/review`; that does not make a slash legal in a native skill name. Apply the standard's name constraints and the target's own naming/namespace rules. [STD-S]

Do not rename arbitrarily on collision: other instructions may invoke the skill by name. Ask for or record a stable installation alias, rewrite only structurally known references, and report unresolved natural-language references.

Choose each profile's preferred current-native skill root, not a shared root merely to reduce file copies. When two targets' preferred destinations are the same and the generated bytes are identical, one owned copy can satisfy both. Inspect all compatibility read locations for duplication or shadowing, including files generated for another target. Incompatible bytes at a shared/aliased destination require an explicit resolution or a blocked plan.

### 6.4 skills.sh integration boundary

Keep skills.sh as the preferred ecosystem integration, but pin the version of any CLI or resolver implementation used. Its repository documents source installation and multiple agent targets; this review does **not** establish a stable embeddable API or a supported “never write a lockfile” switch. [SK-CLI]

Preferred order of implementation investigation:

1. A documented reusable resolution API, if one exists for the pinned release.
2. A controlled subprocess in an isolated temporary project, with explicit scope and output target.
3. A narrow source adapter reproducing only documented source-resolution behavior, with upstream compatibility tests.

Never execute unrestricted `npx skills add` inside the user's actual project and then try to infer all its mutations. Upstream locks and caches can be temporary provider details; only `etymon.lock` owns Etymon's external dependency resolutions. The final harness projection belongs to Etymon even if upstream output is used as a reference fixture.

### 6.5 Skill import and source ownership

`convert` imports the full skill tree into `.agents/etymon/skills/<name>/` when it is authored, modified or lacks verified external provenance. Preserve relative references, executable modes and source-native metadata without executing dynamic instructions or scripts. Register the source path in `etymon.toml`.

A verified unchanged external skill is represented by its lock entry instead. Project-specific supported configuration belongs in a typed manifest binding, not an edited package cache. A locally modified external skill is a fork; do not discard its edits when a similarly named registry package is found.

Imported unsupported frontmatter is preserved and reported. Source behavior that depends on a native invocation, isolation mode or tool approval rule requires a semantic mapping before activation on the destination.

---

## 7. MCP mapping

### 7.1 Registry resolution and installation are different stages

The official registry supplies server metadata and distribution/connection choices. It is not a universal client configuration file. Its package documentation includes several distribution families, including npm, PyPI, OCI, and other package types; the adapter must read the selected record's actual schema rather than assume every server is an npm command. [MCP-R] [MCP-P]

A resolver should produce:

```text
registry identity + metadata version
    -> chosen distribution or remote endpoint
    -> immutable artifact / explicit hosted-service limitation
    -> runtime launch contract
    -> canonical MCP connection
    -> target-specific configuration
```

A registry record can offer multiple alternatives. Choose explicitly, record the selection, and retain OS/architecture requirements. Do not let one developer silently install an OCI image while another gets an unpinned `npx` package because it was easier to launch.

### 7.2 Concrete dialect mapping

These are native configuration shapes, not interchangeable protocol names.

| Target | Container/key | Local server | Remote server | Important distinction |
|---|---|---|---|---|
| Claude | `mcpServers.<id>` | `command`, `args`, `env` | `type: "http"`, `url`; SSE variant | Local/private scope is not the same file as project scope. [CL-M] |
| Codex | `[mcp_servers.<id>]` | `command`, `args`, `env_vars` / `env`, `cwd` | `url`, native auth/header fields | TOML; inherited environment and literal environment are separate. [CX-M] |
| Copilot CLI | `mcpServers.<id>` | `type: "local"`, `command`, `args` | `type: "http"`, `url` | CLI/cloud tool filtering and config ingestion differ. [GH-M] |
| VS Code Local | **`servers.<id>`** | `type: "stdio"`, command/args/env | HTTP/SSE URL config | `inputs` and user-profile resolution are native features. [VS-M] |
| Gemini CLI | `mcpServers.<id>` | command/args/env/cwd | **`httpUrl`** or legacy **`url`** | `url` denotes SSE rather than being a generic remote alias. [GE-M] |
| Kiro | `mcpServers.<id>` | command/args/env | Native remote connection fields | Powers and agent-scoped definitions can change activation/exposure. [KI-M] |
| Pi | `mcpServers.<id>` | command/args/env/cwd | HTTP URL/auth | Reviewed built-in implementation rejects SSE. [PI-M] |
| OMP | `mcpServers.<id>` | Native local definition | Native remote definition | Compatibility discovery requires deduplication before writes. [OM-M] |
| OpenCode | **`mcp.<id>`** | `type: "local"`, **`command: [executable, ...args]`**, `environment` | `type: "remote"`, `url`, headers/OAuth | Neither the top-level map nor the command shape matches Claude. [OC-M] |
| Cursor | `mcpServers.<id>` | command/args/env | URL and native auth fields | Variable syntax is client-specific. [CU-M] |
| Antigravity | `mcpServers.<id>` | command/args | **`serverUrl`** | The reviewed config rejects assumptions based on `url`/`httpUrl`. [AG-M] |
| Roo | `mcpServers.<id>` | Native local definition | Native typed remote definition | User file is editor-managed; project config is `.roo/mcp.json`. [RO-M] |
| Cline | `mcpServers.<id>` | command/args/env | `type: "streamableHttp"`, `url` | Exact active config path needs surface/release verification. [CN-M] |
| Kilo | **`mcp.<id>`** | local command array | `type: "remote"`, `url` | Use current Kilo dialect, not legacy Roo-style configuration. [KL-M] |
| Continue | `mcpServers` **list** in YAML; JSON compatibility map | `name`, command/args/env | `type: "streamable-http"` or `"sse"`, `url` | Standalone YAML file has its own metadata envelope. [CT-M] |
| Amp | `amp.mcpServers` in settings | Local launch definition | Remote definition | Project trust and hosted Orb scope are separate. [AM-M] |
| Zed | **`context_servers.<id>`** | command/args/env | URL/headers | ACP forwarding is a host capability, not target-native configuration. [ZD-M] |

### 7.3 One local connection, seven outputs

The examples below are **proposed renderer fixtures**, not a real registry package. Assume the selected machine has already materialized a verified server at `/work/demo/.agents/.etymon/runtime/example/server.mjs`. Absolute paths are generated machine output, never committed dependency identities. The underlying native shapes are documented in the sources beside each example.

**Claude — `.mcp.json`** [CL-M]

```json
{
  "mcpServers": {
    "example": {
      "command": "node",
      "args": ["/work/demo/.agents/.etymon/runtime/example/server.mjs"]
    }
  }
}
```

**Codex — `.codex/config.toml`** [CX-M]

```toml
[mcp_servers.example]
command = "node"
args = ["/work/demo/.agents/.etymon/runtime/example/server.mjs"]
```

**Copilot CLI — `.github/mcp.json`** [GH-M]

```json
{
  "mcpServers": {
    "example": {
      "type": "local",
      "command": "node",
      "args": ["/work/demo/.agents/.etymon/runtime/example/server.mjs"]
    }
  }
}
```

**VS Code Local — `.vscode/mcp.json`** [VS-M]

```json
{
  "servers": {
    "example": {
      "type": "stdio",
      "command": "node",
      "args": ["/work/demo/.agents/.etymon/runtime/example/server.mjs"]
    }
  }
}
```

**Gemini CLI — `.gemini/settings.json`** [GE-M]

```json
{
  "mcpServers": {
    "example": {
      "command": "node",
      "args": ["/work/demo/.agents/.etymon/runtime/example/server.mjs"]
    }
  }
}
```

**OpenCode — `opencode.json` (or an existing current `opencode.jsonc`)** [OC-M]

```json
{
  "mcp": {
    "example": {
      "type": "local",
      "command": ["node", "/work/demo/.agents/.etymon/runtime/example/server.mjs"]
    }
  }
}
```

**Continue — `.continue/mcpServers/etymon-example.yaml`** [CT-M]

```yaml
name: Etymon Example MCP
version: 1.0.0
schema: v1
mcpServers:
  - name: example
    type: stdio
    command: node
    args:
      - /work/demo/.agents/.etymon/runtime/example/server.mjs
```

These examples are intentionally credential-free and demonstrate serialization only. Real adapters merge owned entries into existing files and validate them through the actual loader.

### 7.4 Remote transport and authentication

Normalize remote connections to **Streamable HTTP** or **legacy SSE**, rather than a vague `remote: true`. A WebSocket or vendor-specific bridge remains a native extension until modeled. Translating one transport into another requires an actual protocol proxy and an additional locked executable dependency, not a property rename.

Keep secrets as typed references. The adapter chooses between native environment lookup, a secure user binding, an interactive input, or an explicit launcher/proxy when necessary. Never put resolved credentials into a tracked lockfile, command preview, error report, or copied plugin manifest.

Examples of why raw string passthrough is unsafe: Cursor has `${env:...}` forms, OpenCode uses `{env:...}`, and Codex distinguishes literal values from environment-variable references. A string appropriate to one harness may be passed literally by another. [CU-M] [OC-C] [CX-M]

OAuth state is machine/user state. The lock records that OAuth is required and the server identity; it does not contain refresh tokens. “Restored” must be allowed to mean “configuration restored; authentication still required.”

### 7.5 Runtime pinning

A generated `npx -y package@latest` is not a locked installation. Even an exact top-level npm version does not by itself demonstrate that every runtime dependency and native binary is pinned. The same issue applies to package-manager runners, image tags, browser downloads, and extension startup installers.

For strict mode, use a verified content-addressed runtime environment or a digest-pinned container and record the relevant platform/toolchain. Preserve the MCP process's protocol output: launcher status messages go to stderr, not the stdio protocol stream. A fast “configuration-only” mode may exist, but must report a weaker reproducibility level.

### 7.6 Permissions and exposure

Keep these concepts distinct:

```text
Installed server
  != enabled connection
  != tools exposed to this agent
  != approval bypass
  != permission to perform the underlying operation
```

Do not map a server's `trust` setting to a generic `enabled` field. Do not expose all server tools when a required allowlist cannot be represented. If a target cannot scope MCP access to one agent, moving the server to session scope is a behavior change that needs explicit approval or a blocking diagnostic.

### 7.7 Native MCP import

Importers invert the verified dialect mappings: OpenCode's command array becomes executable plus arguments; Codex TOML tables become connection records; a native environment placeholder becomes a typed reference rather than an expanded secret. Parse the source transport explicitly, including ambiguous-looking URL field names.

A custom server becomes an authored TOML entry. A verified package-backed server can have its artifact in the external lock and its project settings in a binding. Do not infer package identity from a server's display name or infer a past resolution from `latest`.

Keep the source working-directory basis, explicit/default/inherited values, scope and auth requirements. Rebase known path fields only. Arbitrary arguments are opaque strings unless their source contract defines them as paths; do not perform global search-and-replace on a command line. Unsupported input prompts, secret mechanisms and per-agent exposure become adaptation diagnostics or blockers.

Where a bundled MCP uses the Agent Plugins connection format, import that recognized schema directly and then normalize its path/runtime context. Do not treat its file as already being a Codex/OpenCode configuration. [STD-P]

---

## 8. Agent mapping

### 8.1 The three agent primitives

| Primitive | Meaning | Valid examples of mapping |
|---|---|---|
| **Persona / mode / profile** | Selects instructions or tools in an existing interactive session. | A Roo custom mode or Zed tool profile, within its actual supported fields. |
| **Isolated subagent** | A distinct delegated context/run with its own instructions and selected capabilities. | A native Claude/Codex/Copilot subagent or an explicitly installed Pi bridge. |
| **Remote agent** | Delegates through a remote protocol/service boundary. | A Gemini remote-agent configuration where supported. |

The native distinctions are documented in the respective agent systems. [RO-A] [ZD-A] [CL-A] [CX-A] [GE-A]

A persona fallback must not be reported as an exact subagent conversion. Isolation, persistence, delegation, model inheritance, tool access, and return-channel behavior are material semantics.

### 8.2 Field mapping strategy

| Canonical field | Claude | Codex | Copilot / VS Code | OpenCode / Kilo | Other targets |
|---|---|---|---|---|---|
| Identity | Frontmatter name and native file | TOML `name` | Filename-derived ID plus display metadata | Filename or named config entry | Adapter-defined native identity |
| Instructions | Markdown body | `developer_instructions` | Markdown body | Markdown body / prompt config | Preserve prompt role and loader |
| Tool inclusion | Native tool identifiers | Child config / available controls | Tools and aliases | Native tools/permissions | Explicit mapping table, never guessed casing |
| Execution kind | Subagent | Child agent | Custom agent with surface-specific behavior | Primary/subagent mode | Persona/extension/remote distinctions |
| Model selection | Native model field | Native model/effort config | Surface-specific model support | Native model/provider config | Resolve explicit policy, not marketing tiers |
| Skills/MCP dependencies | Native bindings where supported | Child config can inherit or override | Surface-specific | Session/config/agent semantics differ | Reject unintended scope widening |

The concrete fields above come from each target's agent reference; the canonical interpretation and rejection policy are Etymon's design. [CL-A] [CX-A] [GH-A2] [VS-A] [OC-A] [KL-A]

### 8.3 Tools are capabilities, names, and enforcement boundaries

A useful logical tool taxonomy is `files.read`, `files.search`, `files.write`, `process.exec`, `network.fetch`, `agent.delegate`, and `mcp:<resource>:<tool>`. These labels simplify comparison but are not sufficient to prove safety.

For each native tool, the adapter needs a capability description. A shell tool can write files and access the network even when a dedicated editor tool is hidden. An MCP tool named “read” is not automatically read-only. A model instruction saying “do not write” is not a filesystem sandbox.

Accordingly, a source requesting **enforced read-only execution** requires a target sandbox/policy with verified coverage. A source requesting only **hide editing tools** can map to a weaker tool-selection control, but the report must not upgrade that into a stronger security claim.

### 8.4 Example: authored reviewer

The manifest registers `etymon/agents/reviewer.md`. The proposed Etymon agent file owns its metadata and prompt body; its schema is not claimed to be native Claude or Codex syntax.

```markdown
---
schema: etymon.agent.v1
name: reviewer
description: Review a change and return findings without inheriting unrelated tools.
execution:
  kind: isolated-subagent
  delegateFurther: deny
skills:
  - skill:local/release-check
mcpServers: []
tools:
  include: [files.read, files.search]
  exclude: [files.write, process.exec]
  inherit: false
requires:
  - capability: agent.isolated-context
    level: required
    reason: Keep the review in a separate delegated context.
  - capability: tools.explicit-selection
    level: required
    reason: Do not inherit unrelated tools.
  - capability: agent.no-further-delegation
    level: required
    reason: This reviewer must not delegate again.
---

Review the requested change. Return findings with file references and explain
which issues are demonstrated versus uncertain. Use the release-check skill
where it applies.
```

Resource references must resolve to manifest declarations or external lock IDs. The parser adds these edges to the effective graph; it does not duplicate the local prompt into the external lock. Tool selection here is not a claim of an OS-enforced read-only sandbox.

Claude export produces supported Markdown/native tool fields. Codex export produces native TOML plus validated child settings. A persona-only target is blocked by the isolated-context requirement; a target without the no-further-delegation control is blocked by that requirement. Pi needs its explicit bridge prerequisite. Native schemas and execution differences are documented in the respective sources. [CL-A] [CX-A] [RO-A] [ZD-A] [PI-A]

### 8.5 Unstructured prompt references

An imported agent might say “call the Task tool,” “run `/some-plugin:review`,” or “use the `Bash` tool.” Renaming YAML fields does not repair these instructions. Preserve the original prompt artifact and maintain explicit known references when source metadata provides them. Otherwise report possible nonportable prompt references for review.

Do not use an LLM rewrite silently as the deterministic compiler. An optional migration assistant can propose a reviewed patch, but the resulting authored change must be explicit, reviewable and included in the build input fingerprint—not silently written into an external package lock record.

### 8.6 Agent import

Read prompt role/body, execution kind, tool declarations, model settings, scope, required dependencies and inherited behavior. Translate native tool identifiers through a versioned capability mapping; preserve unsupported fields as native extensions. Never normalize an omitted native tool list into an empty one or vice versa without proving the source semantics.

A Claude subagent, Roo mode and remote Gemini agent can all become Etymon records, but they retain different execution kinds. Do not manufacture isolation or flatten a child session into a persona without an explicit permitted adaptation. Preserve structured native references and flag prose that depends on harness-specific tool names or commands.

On import, a required native restriction remains required. Unknown authority-related settings block cross-harness activation until classified. Broad model/session defaults outside the selected scope remain detected dependencies, not silently copied personal configuration.

---

## 9. Rules mapping

### 9.1 Rules are contextual instructions, not universal enforcement

The shared core is Markdown text. The difficult part is **when** it enters context and **which scope** it affects.

| Rule intent | Candidate representations | Risk |
|---|---|---|
| Always-on project guidance | `AGENTS.md`, `CLAUDE.md`, native always-included rule | Hierarchy, precedence, and context budgets can differ. |
| Directory-scoped guidance | Nested instruction file or native scoped rule | Some loaders scan from cwd; others react to accessed files. |
| File-pattern rule | Claude `paths`, Copilot `applyTo`, Cursor `globs`, Kiro file matching | Matching against an opened file is not the same as matching attached context. |
| Model-selected rule | Native description/automatic-selection rule | No exact fallback to always-on instructions. |
| Manual-only rule | Native manual attachment/command | Automatic loading would change intent. |
| Mode-specific rule | Roo mode rules or other agent binding | Flattening to project scope broadens its audience. |

These activation mechanisms are documented in the individual rule specifications. [CL-R] [GH-R] [CU-R] [KI-R] [RO-R] [CT-R]

### 9.2 Recommended P1 core

Begin with always-on and directory-scoped rules. Add file-pattern rules only with a canonical definition of glob syntax, base directory, matching population, ordering, and exclusions. Preserve unsupported activation as a native extension rather than broadening it silently.

Do not concatenate all instructions into every target's root file. That destroys scope and can multiply context. Do not translate a security-oriented natural-language rule into a claim of enforced policy.

### 9.3 Collision examples

Zed's documented project loader chooses a matching compatibility instruction file from a precedence list; generating `AGENTS.md` may not make it effective. Antigravity's modular rules require valid trigger metadata, and its directory scanning is not simply recursive. Continue's rule order is lexicographic and its activation considers provided context. [ZD-R] [AG-R] [CT-R]

Therefore `doctor` should display both **generated file exists** and **effective instruction source**, with a reason when the latter differs.

### 9.4 Rule import and authoring (P1)

Place authored rule text under `.agents/etymon/rules/` and declare its supported activation in `etymon.toml`. Preserve source hierarchy, order, matching basis and include boundaries. Importing a nested instruction file as an always-on root rule is a semantic change, not a harmless move.

Native-only trigger types remain preserved. Changes to current local rule text are source edits; sync does not relock them as external dependencies. P0 conversion can detect and report rules without claiming to import or activate them portably.

---

## 10. Plugin mapping and decomposition

### 10.1 Reuse the existing portable bundle core

Etymon should accept Agent Plugins manifests as a first-class P2 input. The standard's fixed skills/MCP component locations and namespaced extensions provide an existing interoperability boundary. Pin the recognized schema version rather than assuming every future revision is compatible. [STD-P]

Other importers should cover native Claude bundles, Gemini extensions, Kiro legacy Powers, and the executable package formats of Pi, OMP, OpenCode, Kilo, Cline, and Amp. These are separate importers; shared vocabulary does not create a common executable ABI. [CL-P] [GE-P] [KI-PI] [PI-P] [OM-P] [OC-P] [KL-P] [CN-P] [AM-P]

### 10.2 Decomposition algorithm

```text
1. Identify and validate the bundle format and version.
2. Resolve the immutable external bundle, or snapshot the complete authored bundle source.
3. Enumerate skills, MCPs, agents, rules, hooks, native modules, and unknown components.
4. Create a parent plugin node plus child resource nodes and explicit dependency edges.
5. Decide between native bundle installation and component projection per target.
6. Check activation, namespace, permission, and relative-path changes.
7. Produce a report accounting for every component.
8. Apply only a fully approved plan.
```

Use the native bundle when it preserves the desired semantics and can be pinned. Decompose when the target lacks that bundle loader **and** the individual components can be mapped. Reject required components that cannot be represented.

### 10.3 Example conversion report

Illustrative output for a bundle imported from a Claude-style marketplace:

```text
Plugin: acme-review-suite
Target: a harness without a compatible bundle loader

skill/review-checklist      -> native skill                  exact
mcp/repository-index        -> native MCP config             adapted
agent/reviewer             -> native isolated agent          adapted
hook/enforce-approval      -> no equivalent blocking event   blocked
native/lsp-server          -> no configured target mapping   unverified

Result: not applied
Reason: required approval hook would be lost
```

This is more useful than a green “plugin installed” message after copying only its skills.

### 10.4 Changes introduced by flattening

A bundle provides more than directory organization. It may establish namespacing, lazy activation, private agent-scoped tools, persistent data paths, dependency lifecycle, or special permission limitations.

Kiro's standard Powers can manage MCP activation internally rather than writing standalone user MCP entries. Claude's plugin subagents can ignore fields that standalone agents accept. In both cases, flattening may change execution behavior or authority. [KI-PI] [CL-A]

Retain parent-child relationships in the effective graph: external package relationships come from the lock/artifact; authored bundle relationships come from the manifest and source bundle. Removing a plugin should remove its owned children only when they are not also explicitly installed or referenced elsewhere. Shared children require reference counting, not a recursive directory delete.

### 10.5 Native executable modules

A TypeScript callback registered against one harness's plugin API is **native code**, even when it looks small. It can rely on tools, event payloads, UI APIs, cancellation, and lifecycle semantics unavailable elsewhere.

Do not promise automatic JavaScript-to-JavaScript plugin conversion. Portable hook contracts can have separately implemented bridges. General executable plugins should remain native-only until a specific translation is engineered and tested.

### 10.6 Authored versus external bundles

A self-written or locally modified bundle lives under `.agents/etymon/plugins/` and is registered by the authored manifest. A verified unchanged external bundle remains an immutable dependency. Flattening its components for one target does not convert it into several unrelated user-installed packages.

Prefer the recognized Agent Plugins schema for portable package authoring; keep Etymon-specific relationships outside its closed core fields or in an explicitly supported extension. Native source formats are parsed by separate importers. The portable bundle core is not a general-purpose agent or hooks standard. [STD-P]

A P2 import must account for required hooks even though portable hook implementation is scheduled for P3. Preserve native components, block unsupported required dependencies, and report partial conversion instead of silently dropping later-phase resources.

---

## 11. Hooks mapping

### 11.1 Similar event names are not sufficient

A hook mapping needs all of the following:

```text
trigger and timing
payload schema and tool-name vocabulary
blocking versus notification-only execution
result/decision schema
failure and timeout behavior
working directory and environment
coverage gaps and reentrancy
```

For example, current Codex documentation says some tool paths are outside normal hooks and that certain unsupported output fields can cause a hook failure while execution continues. Such a mechanism must not be advertised as a universal security boundary. [CX-H]

### 11.2 Initial event-family map

This table identifies implementation candidates, **not certified equivalence**.

| Canonical family | Native candidates | Required validation |
|---|---|---|
| `tool.before` | Claude/Codex `PreToolUse`; Copilot CLI `preToolUse`; Gemini `BeforeTool`; Kiro `PreToolUse` | Which tools are covered? Can the result deny execution? Does failure deny or continue? [CL-H] [CX-H] [GH-H] [GE-H] [KI-H] |
| `tool.after` | Claude/Codex `PostToolUse`; CLI `postToolUse`; Gemini `AfterTool`; native plugin callbacks | Distinguish observation, result replacement, and rejecting an already-executed operation. [CL-H] [CX-H] [GH-H] [GE-H] |
| Tool-specific pre/post | Cursor shell/MCP/edit event families | One family may require several bindings; direct filesystem changes might not be covered. [CU-H] |
| Executable `tool.before/after` | Pi/OMP event APIs; OpenCode/Kilo plugin callbacks; Cline SDK before/after tool; Amp tool events | Versioned bridge, native payload conversion, errors, async behavior. [PI-H] [OM-H] [OC-P] [KL-P] [CN-H] [AM-H] |
| `session.start` | Native lifecycle hooks or executable plugin event | Process startup, thread opening, and conversation start are not necessarily identical. |
| `agent.turn.end` | Native completion/stop or plugin turn-end event | Do not substitute session termination; avoid infinite continuation loops. |
| Editor file save | Kiro and other editor-specific events | Keep separate from model tool execution. [KI-H] |

VS Code Local and Copilot CLI should remain separate hook dialects even when they share `.github/hooks/`. Antigravity adds its own named-pack envelope. These are structural differences, not just casing preferences. [VS-H] [GH-H] [AG-H]

### 11.3 Proposed portable command-hook contract

Define a small versioned Etymon contract for hooks that opt into portability. A handler receives a JSON object on stdin and writes one JSON decision on stdout. Diagnostics go to stderr. The bridge converts between that contract and the native hook schema.

```json
{
  "contract": "etymon.hook.v1",
  "event": "tool.before",
  "resourceId": "hook:review-policy",
  "tool": {
    "logicalCapability": "process.exec",
    "nativeName": "Bash",
    "arguments": {"command": "echo example"}
  },
  "context": {"projectRoot": "/work/demo"}
}
```

Illustrative portable result:

```json
{
  "decision": "deny",
  "reason": "This operation requires a reviewed approval record."
}
```

This is a new Etymon contract, not a shape to copy directly into a native hook. Preserve the original payload in a namespaced field only when needed and safe; normalize only fields with understood semantics.

### 11.4 Security gates

A required blocking hook must fail compilation when the target has only an asynchronous notification, incomplete relevant-tool coverage, or a fail-open behavior that Etymon cannot safely compensate for. “We installed a hook” is not proof of policy enforcement.

Hook code is privileged code. `add` may fetch and inspect it but should not run it. `sync` should require explicit trust before activation; project files must not be able to disable that trust requirement. Pin generated bridge code and its runtime dependencies as part of the plan.

### 11.5 Hook import and preservation (P3)

Keep authored portable handlers under `.agents/etymon/hooks/` with explicit contracts. Importing a native hook requires identifying its event, matcher, input/output schema, working directory, command and failure behavior. The original script does not automatically understand Etymon's proposed JSON contract.

Static parsing may preserve a native handler and its assets, but general script translation is not promised. A tested bridge is a separate implementation. Unknown or later-phase hooks remain native-only/needs-review records; required hooks block foreign activation. Never execute imported handlers to discover what they do.

---

## 12. Authored configuration, lockfile, and reproducibility

### 12.1 Separate ownership, one effective environment

The committed inputs are:

```text
etymon.toml       authored resource declarations, connections and bindings
etymon/          authored or explicitly imported resource files
etymon.lock      external dependency requests and immutable resolutions
```

They live together under `.agents/`. The manifest is optional for registry-only environments. A local-only environment can have no external resources; `init` may still create a lock containing the format/toolchain metadata. Do not put every local resource into the lock merely to force one-file ownership.

| Information | Authoritative location |
|---|---|
| Local resource ID and source reference | Corresponding manifest declaration |
| Local skill metadata/instructions/assets | Standard skill tree |
| Local agent prompt, role, dependencies and restrictions | Etymon agent file; manifest only registers its path |
| Local rule content | Rule Markdown file; activation is declared in the manifest |
| Custom MCP connection | Authored manifest entry |
| External package source, selector and update policy | External lock request |
| Exact external artifact and base definitions | Locked artifact; optional normalized cache is derived and validated |
| Project-specific external-resource configuration | Typed binding in the manifest referencing the locked resource ID |
| Imported native fields not modeled portably | Sanitized authored native preservation records/files |
| Active native aliases and output ownership | Ignored machine state |
| Credentials, OAuth/session state and trust approvals | User-controlled secret/native state, never portable source or lock |

The complete build graph is computed from these inputs. Local relationships may point to locked external IDs, but this does not make local prompts or authored dependency edges machine-owned.

### 12.2 Proposed authored manifest

This is an Etymon schema proposal. All file paths below resolve relative to `.agents/etymon.toml`. The external resource named in `bindings` must already exist in the lock; this example does not declare or resolve it.

```toml
schema_version = 1

[skills.release-check]
path = "etymon/skills/release-check"

[agents.reviewer]
path = "etymon/agents/reviewer.md"

# P1 resource; P0 recognizes and reports unsupported phase coverage.
[rules.project]
path = "etymon/rules/project.md"
activation = "always"

[mcp.internal-docs]
transport = "streamable-http"
url = "https://docs.example.com/mcp"

[mcp.internal-docs.auth]
scheme = "bearer"
token_env = "INTERNAL_DOCS_TOKEN"

# Project binding for an external implementation, not a second dependency request.
[bindings."mcp:external/repository-index"]
enabled = true

[bindings."mcp:external/repository-index".env]
SOURCE_TOKEN = { kind = "environment", name = "GITHUB_TOKEN" }
```

The declaration `[agents.reviewer]` establishes `agent:local/reviewer`; the file owns its prompt and agent-specific fields. Metadata repeated across a declaration and a source file must agree or fail validation. Do not resolve disagreement by last-write-wins.

The inline `token_env` form normalizes to a typed environment reference. Literal secret values are invalid in secret-bearing fields. Environment-variable names are portable configuration; a usable value is supplied on the destination machine.

The binding schema is resource-specific and allowlisted. `enabled` and `env` are proposed MCP binding fields; arbitrary TOML tables must not be passed verbatim into native configuration. Source/version/integrity changes remain CLI-owned dependency operations. A binding that changes a required package contract is blocked pending an explicit fork or reviewed dependency change.

Paths supplied to CLI commands are shell-working-directory relative; the CLI normalizes them into manifest-relative references. Default local imports are contained under `.agents/etymon/`. Referencing outside that tree requires an explicit, visible policy and must not silently copy private files into a repository.

### 12.3 External lock content

Use a versioned machine-readable lock with deterministic ordering. JSON is the proposed serialization despite the `.lock` extension; this is an Etymon choice, not an upstream format requirement.

| Area | Lock content |
|---|---|
| Format/toolchain | Lock and normalization versions; pinned Etymon/adapter implementation set |
| Requests | Provider, source, selector, alias, explicit/transitive status, update policy |
| Resolution | Commit and subtree, exact package artifact/integrity, image digest, or explicit hosted endpoint |
| Materialization | Full tree integrity, file modes, platform constraints, required runtime artifacts |
| External graph | External package/component identities, relationships and base requirements |
| Provenance | Registry identity/schema/record version, verified package evidence, license where available |
| Reproducibility limits | Artifact versus runtime versus hosted-binding guarantees |

Do not store current local file contents, local prompt hashes that must be manually refreshed after every edit, personal harness preferences, credential values, or absolute machine paths in the external dependency graph.

A normalized external definition can be stored as a schema-versioned derived cache tied to the locked artifact digest. It is not independently editable project configuration. Local bindings are applied after this cache is validated; they are never written back into the package's immutable base record.

### 12.4 Illustrative external lock

This deliberately unusable fixture uses an example repository and zero-filled digests. It shows the ownership model, not a real registry package or a release recommendation.

```json
{
  "lockVersion": 1,
  "normalizationVersion": 1,
  "toolchain": {
    "revision": "example-etymon-toolchain-1",
    "integrity": "sha256:0000000000000000000000000000000000000000000000000000000000000000"
  },
  "roots": ["skill:external/review-checklist"],
  "resources": {
    "skill:external/review-checklist": {
      "kind": "skill",
      "request": {
        "provider": "skills-sh",
        "source": "example-org/example-skills",
        "selector": "review-checklist",
        "updatePolicy": "explicit"
      },
      "resolution": {
        "kind": "git",
        "repository": "https://example.invalid/example-org/example-skills.git",
        "commit": "0000000000000000000000000000000000000000",
        "path": "skills/review-checklist",
        "treeIntegrity": "sha256:0000000000000000000000000000000000000000000000000000000000000000"
      },
      "dependsOn": [],
      "reproducibility": "artifact"
    }
  }
}
```

External includes direct Git/package sources, not only registry-discovered packages. A registry alias is discovery provenance; the underlying artifact is what must be locked. A hosted URL can lock only a binding and metadata, not the remote implementation. Publisher authenticity and content integrity are separate checks.

### 12.5 Authored edits and build fingerprints

A user edits `.agents/etymon/agents/reviewer.md` and runs `sync`. Etymon parses the new source without updating the external lock. A live source edit is ordinary authoring, not a permanently dirty dependency that requires relocking.

For reproducible generation, compute an input fingerprint covering:

```text
manifest + complete authored resource trees + accepted native preservation data
+ external lock + pinned normalizers/adapters + target profile + nonsecret bindings
```

Capture stable source bytes into staging for the plan; detect changes during application rather than mixing two revisions. Store the fingerprint and generated digests in ignored build/ownership state. Git or another source snapshot supplies authored-version reproducibility. CI can require a clean checked-out source revision in addition to a locked dependency restore.

`--locked` means no external resolution or toolchain mutation. It does not make the current authored source immutable or compare it against stale hashes inside the external lock. A missing referenced external ID is an error; the user must add it explicitly. Merely editing TOML must not trigger registry discovery.

### 12.6 Reproducibility levels

| Level | What is fixed/verified | What remains outside the guarantee |
|---|---|---|
| Configuration | Authored snapshot, normalized settings, target profile and generation rules | Ambient host tools, mutable dependencies, live services |
| Artifact | Above plus exact external source/package bytes | Transitive startup installs and unpinned runtimes |
| Runtime | Above plus the executable environment for a specified platform | Credentials, live data, relevant OS/kernel differences |
| Hosted binding | Endpoint and declared transport/auth/configuration | Remote implementation, available tools and service availability |

Report the weakest applicable level per resource. A local command relying on a host binary can be valid configuration without being a locked executable environment. The UI must state that limitation; strict runtime requirements must fail rather than pretend the host dependency was pinned.

Pin the generation implementation as well as the artifacts. The CLI must check its compatibility with the lock's toolchain before a strict sync. It must not silently generate different files because `npx` fetched a newer CLI. A deliberate toolchain upgrade produces a reviewed lock change. Adapter selection from an already pinned set does not change dependencies.

### 12.7 CLI mutation contract

| Command | Canonical inputs changed | Native effect |
|---|---|---|
| `init` | Creates initial lock; manifest/source only as needed | Narrow machine-state/ignore setup, not adoption of existing settings |
| `<kind> add <external-source>` | Lock requests/resolutions | Fetch/cache only; activation through sync |
| `<kind> add <local-path>` | Manifest registration; source import only when explicitly requested | No automatic native activation |
| `convert <harness>` | Reviewed authored files/manifest and verified external resolutions | Original native setup unchanged |
| `sync` | None | Restores locked bytes and applies owned native output |
| `update` | Selected external resolutions | Native targets are regenerated by subsequent sync |
| `<kind> remove <id>` | The owning declaration/lock root | Safely removes owned output; source files retained by default |
| `doctor` | None | Inspects state; no implied destructive repair |

If a removal would orphan a required relationship, stop with the references that need attention. External packages and plugin children still referenced by another resource remain present. Cache garbage collection is not source deletion.

```bash
# Proposed commands; placeholders are not real package identifiers.
npx etymon init
npx etymon skill add <source> --skill <name>
npx etymon mcp add <registry-id>
npx etymon agent add ./.agents/etymon/agents/reviewer.md

npx etymon convert claude --dry-run
npx etymon convert claude

# Reads authored inputs; restores external dependencies without updating them.
npx etymon sync --harness claude,codex
npx etymon sync --harness codex --locked --non-interactive
npx etymon sync --harness opencode --dry-run

npx etymon update
npx etymon doctor --harness codex --json
```

`sync` is the complete restore-and-project operation. A separate mandatory `install` step is not required. Selecting a harness persists only in ignored local preferences unless the project explicitly authors a target requirement. Noninteractive use must supply a target or have an unambiguous configured selection; missing secrets/trust are errors or pending steps, never interactive surprises in CI.

### 12.8 Project and global scope

| Scope | Manifest | Lock | Authored source |
|---|---|---|---|
| Project | `<repo>/.agents/etymon.toml` | `<repo>/.agents/etymon.lock` | `<repo>/.agents/etymon/` |
| Global | `~/.agents/etymon.toml` | `~/.agents/etymon.lock` | `~/.agents/etymon/` |

Default commands address the project. `--global` addresses the current user's global Etymon environment and target roots. No project resource is silently promoted to a global target, and no user's global configuration is silently vendored into a team repository.

Project/global inventories remain separate; `doctor` and an effective-environment view inspect native layering. An explicit future composite profile can define managed-graph precedence, but it cannot override a harness's native precedence by assertion. Claude skills and Copilot agents have documented precedence behavior that requires collision checks. [CL-S] [GH-A]

If the source's behavior depends on an out-of-scope global definition, conversion reports the dependency rather than silently flattening it. If the target lacks the requested scope, export is blocked or offers an explicit alternative.

---

## 13. Safe synchronization and file ownership

### 13.1 Source, cache, and output separation

```text
project/
├── .agents/
│   ├── etymon.toml                 # Tracked authored declarations and bindings
│   ├── etymon.lock                 # Tracked external resolutions/toolchain
│   ├── etymon/                     # Tracked authored/imported source
│   │   ├── skills/<name>/SKILL.md
│   │   ├── agents/<name>.md
│   │   ├── rules/<name>.md
│   │   ├── plugins/<name>/
│   │   ├── hooks/<name>/
│   │   └── native/<harness>/           # Sanitized preservation; not autoloaded
│   ├── .etymon/                    # Ignored machine state and materialization
│   │   ├── state.json
│   │   ├── runtime/
│   │   ├── staging/
│   │   └── reports/
│   └── skills/                        # Generated ONLY for a target that loads it
├── .claude/                           # Native output mixed with user-owned files
├── .codex/
├── .github/
└── opencode.json                      # Native output merged at owned keys
```

Source uses `.agents/etymon/`, not `.agents/src/` and not the live native `.agents/skills/` path. Runtime/staging uses `.agents/.etymon/`; the leading dot distinguishes it from authored source. A content-addressed download cache may live outside the repository and must never be treated as editable source.

Test source and staging non-discovery against each supported harness. A namespaced folder is not a security boundary. Generated configuration can reference resolved runtime paths on the target machine, but those paths do not belong in portable resource identities or external lock resolutions.

### 13.2 Multi-target composition

Build one whole-project write plan. Do not let adapters independently mutate the same physical file.

Examples requiring coordination:

| Shared surface | Conflict |
|---|---|
| `.agents/skills/<name>/` | Several selected and unselected harnesses may discover one copy. |
| `.mcp.json` | Claude and Copilot CLI can read the same file with overlapping but not identical contracts. |
| `.github/agents/*.agent.md` | VS Code Local and Copilot CLI/cloud can interpret different fields. |
| `.github/hooks/*.json` | Different event dialects can occupy the same directory. |
| `AGENTS.md` / `CLAUDE.md` | Compatibility loaders may duplicate, shadow, or broaden instructions. |

These are documented shared locations, not hypothetical filename coincidences. [CU-S] [GH-M] [VS-A] [GH-H] [VS-H] [ZD-R]

If two targets require incompatible bytes at the same path, fail planning or require a supported scoped alternative. Do not make “last adapter wins” the behavior. Also report resources visible to an unselected harness where its compatibility loader would discover them.

### 13.3 Ownership granularity

Own individual files in managed resource directories, individual JSON/TOML map entries, or clearly delimited instruction blocks—not entire user configuration files.

The ignored state record should store target path, ownership unit, previous generated digest, source resource IDs, adapter revision, and any adoption record. On resync, compare current bytes against the prior generated version. Unmanaged or modified content becomes a conflict, not an overwrite opportunity.

Use syntax-aware JSONC/TOML/YAML editing that preserves unrelated keys and comments where possible. Detect duplicate keys and ambiguous parse results. For a shared Markdown instruction file, use a clearly marked managed block only with explicit adoption; a dedicated native modular rule is preferable when equivalent.

### 13.4 Transactional application

1. Read and validate authored inputs, the external lock, and all affected native configurations.
2. Fetch locked artifacts and snapshot authored inputs into inert staging without activating them.
3. Compute compatibility, collision, trust, and ownership diagnostics.
4. Render the entire plan and validate generated syntax.
5. Obtain any required approval before activation.
6. Apply through a journaled transaction, using atomic file replacement where supported.
7. Validate native registration/discovery; record the applied generation.
8. Roll back owned changes on failure where possible; report non-rollbackable external operations.

Multiple files and remote registrations are not magically one filesystem transaction. The implementation needs a write journal, recovery behavior, and an honest partial-application state.

### 13.5 `.gitignore` behavior

`init` should add only managed runtime/cache paths automatically. Generated native files can be ignored when Etymon owns the whole file and the user chose local generation.

Never add blanket `.github/`, `.claude/`, `.vscode/`, or `.agents/` ignores. `.gitignore` cannot hide just the managed keys in a shared tracked JSON file, and it does not untrack an already committed file. Mixed-ownership files require an explicit strategy: keep the reviewed generated entries tracked, choose a native include/local override if supported, or request a separate managed file.

For hosted targets, repository-visible generated output may be required. `sync` should not stage or commit changes automatically.

### 13.6 Removal and garbage collection

Removing a resource changes its owning declaration or external lock root, then generates a removal plan. Do not delete authored source files by default. Delete only files/entries still matching Etymon's ownership record. If edited, leave them and report drift. Keep resources referenced by other agents/plugins. Cache garbage collection is separate from uninstall and must not remove active runtimes.

### 13.7 Conversion is not adoption

`convert` writes Etymon source/manifest/lock only. It leaves the inspected native files untouched and does not make them owned output. A subsequent sync to that same harness must explicitly adopt the affected files/entries or report a conflict.

Keep import and export journals separate. A failed import rolls back Etymon source mutations where possible without altering the original setup. A failed native sync rolls back only the owned output operations it applied. Store sanitized provenance and precondition digests so a re-import can detect conflicts with both later native edits and later authored edits.

Never preserve credentials by copying a mixed native settings file wholesale into `etymon/native/`. Parse and sanitize recognized resource fragments first. Native executable material remains inert until supported and explicitly trusted.

---

## 14. Bidirectional harness adapters and conversion

### 14.1 Responsibilities

```text
Provider       discover/resolve/fetch external artifacts and registry metadata
Source parser  read authored Etymon files and recognized standard bundles
Harness        selected native product/surface/version/scope/configuration roots
Importer       read known native formats and propose portable source/lock changes
Normalizer     turn recognized source definitions into typed Resource values
Planner        compose the Environment; check requirements, collisions and trust
Exporter       produce current-native output/registration operations for a target
Applier        safely apply an approved source-import or native-output plan
Validator      check schemas, loading, behavior and conversion reports
```

A Harness adapter supplies the import and export knowledge for one target family. It should compose resource-specific handlers rather than use a deep inheritance hierarchy. The write applier is shared: adapters do not each invent their own overwrite, cleanup, or rollback semantics.

No pairwise converters are required. Claude-to-Codex is a Claude import plus Codex export through the same resource model used by registry installations.

### 14.2 Proposed interfaces

The types build on Section 5. They describe data contracts, not an implementation with every schema already supported.

```ts
type HarnessId =
  | "claude" | "codex" | "copilot-cli" | "copilot-cloud" | "vscode-local"
  | "gemini" | "kiro" | "pi" | "omp" | "opencode" | "cursor" | "antigravity"
  | "roo" | "cline" | "kilo" | "continue" | "windsurf" | "devin-cascade"
  | "amp" | "zed";

type Scope =
  | { kind: "project"; projectRoot: string }
  | { kind: "global"; userHome: string };

interface TargetContext {
  harness: HarnessId;
  surface: string;
  scope: Scope;
  configRootOverrides: Readonly<Record<string, string>>;
}

interface TargetProfile extends TargetContext {
  detectedVersion: string | null;
  profileId: string;
  adapterRevision: string;
  platform: string;
  configRoots: Readonly<Record<string, string>>;
  featureFlags: Readonly<Record<string, boolean>>;
}

type DirectionSupport = "supported" | "partial" | "native-only" | "unverified" | "unavailable";

interface ResourceSupport {
  resource: ResourceKind;
  import: DirectionSupport;
  export: DirectionSupport;
  features: Readonly<Record<string, EvidenceStatus>>;
  prerequisites: readonly string[];
}

interface Diagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  resourceId?: ResourceId;
  target?: string;
  message: string;
  evidence?: string;
}

interface NativeArtifactSnapshot {
  sourceLocator: string;       // Local/private diagnostic; redact before portable persistence.
  schemaId: string;
  sourceDigest: string;
  scope: "project" | "global" | "private-project" | "managed";
  sanitizedContent: string;
  referencedAssets: readonly string[];
}

interface NativeSnapshot {
  profile: TargetProfile;
  artifacts: readonly NativeArtifactSnapshot[];
  diagnostics: readonly Diagnostic[];
}

type ImportDisposition =
  | "authored" | "verified-external" | "local-fork"
  | "preserved-native" | "needs-review";

interface ImportedItem {
  sourceLocator: string;
  resourceId?: ResourceId;
  disposition: ImportDisposition;
  result: ConversionResult;
}

interface PlannedOperation {
  kind: "write-file" | "merge-keys" | "remove-owned" | "register-native" | "external-step";
  destination: string;
  owner: string;
  expectedPreviousDigest?: string;
  content?: string;
}

interface ImportOptions {
  dryRun: boolean;
  preserveUnsupported: boolean;
  includePrivateProjectConfig: boolean;
}

interface ImportPlan {
  items: readonly ImportedItem[];
  sourceOperations: readonly PlannedOperation[];
  diagnostics: readonly Diagnostic[];
  status: "ready" | "review-required" | "blocked";
}

interface ExportPlan {
  operations: readonly PlannedOperation[];
  results: readonly ConversionResult[];
  diagnostics: readonly Diagnostic[];
  inputDigest: string;
  status: "ready" | "blocked" | "external-step";
}

interface HarnessAdapter {
  id: HarnessId;
  detect(context: TargetContext): Promise<TargetProfile>;
  capabilities(profile: TargetProfile): readonly ResourceSupport[];
  inspect(profile: TargetProfile): Promise<NativeSnapshot>;
  import(snapshot: NativeSnapshot, options: ImportOptions): Promise<ImportPlan>;
  export(environment: Environment, profile: TargetProfile): Promise<ExportPlan>;
  validateInstalled(plan: ExportPlan, profile: TargetProfile): Promise<readonly Diagnostic[]>;
}

interface Harness {
  profile: TargetProfile;
  adapter: HarnessAdapter;
}
```

The capabilities contract tracks **import and export independently**. Native product support in Section 3 does not establish either Etymon direction. A release support matrix must identify the exact resource features, source versions it can read, current target versions it can write, evidence, and runtime prerequisites.

Resource-specific native plugins that require code execution remain separate from declarative importers. `inspect` can use a documented, non-executing listing interface, but must not load arbitrary code to see what resources it registers. Connection tests are explicitly authorized validation steps, not a side effect of importing a configuration.

### 14.3 `convert` pipeline

```text
1. Resolve source harness, version/surface, explicit scope and roots.
2. Inspect current and recognized legacy/compatibility inputs without mutation.
3. Parse native declarations and retain source locations, scope and inheritance.
4. Classify authored resources, verified externals, forks and unknown native material.
5. Normalize the supported core; enumerate every known field/component.
6. Resolve external provenance only from verifiable evidence, never names alone.
7. Propose source files, manifest references/bindings and external lock changes.
8. Redact secrets; validate paths, dependencies, conflicts and conversion outcomes.
9. Show a report/diff and obtain required review before applying the import.
10. Journal changes to Etymon inputs only; leave native source unchanged.
```

`convert claude --global` imports the user's global resources, not every repository referenced by a global state file. Default project conversion does not silently publish private/local settings or effective global defaults into the team manifest. It detects those dependencies and requires a deliberate scope decision.

The importer may need to inspect selected project-local records stored outside the repository to explain effective behavior. Reading those records for diagnostics is not permission to vendor them. Managed/admin policy remains a detected constraint, not user-editable configuration automatically copied for reapplication elsewhere.

Claude's user state can mix MCP records, sign-in state and per-project trust information. Extract only recognized resource settings and retain secret references. Do not copy the whole state file into `native/` or a conversion report. [CL-C]

### 14.4 Import classification and destination

| Source finding | Destination/behavior |
|---|---|
| Self-authored skill/agent/rule | Normalize supported format into `.agents/etymon/<kind>/`; register in TOML |
| Custom MCP command or URL | Authored MCP entry, with typed environment/secret/path references |
| Unchanged external resource with verified exact origin | External lock entry; local configuration differences become typed manifest bindings |
| Modified external resource | Editable local fork with upstream provenance; never substitute an upstream version and discard edits |
| External-looking resource without provable origin | Preserve as local/unverified; do not fabricate a registry identity or historical version |
| Native plugin with declarative components | P2 bundle importer; record parent/children and account for unsupported components |
| Arbitrary executable module or unknown fields | Sanitized native-only preservation or a review/blocking diagnostic |
| Credentials, session history or unrelated state | Excluded; report categories/counts without leaking values |

Proving external provenance may require an installed package record plus an artifact/tree comparison. A hash match against a guessed package is not sufficient identity evidence by itself. Registry lookup used to find a *candidate* must not become an automatic substitution.

A native `npx package@latest` connection does not establish the version that previously ran. Preserve it as configuration with an unpinned-runtime warning; resolving a new exact version is a new dependency operation whose result must be reviewed. An absolute local executable path is a machine dependency until it is explicitly rebased or packaged.

### 14.5 Native preservation envelope

Unmodeled material is not injected into generic `Resource` values as trusted portable behavior. Known native fields can become namespaced extensions with a pinned schema. Other material is represented by an inert preservation record referencing sanitized source.

Proposed manifest example:

```toml
[[preserved_native]]
id = "claude-unmodeled-hook"
harness = "claude"
path = "etymon/native/claude/unmodeled-hook.json"
activation = "disabled"
reason = "No supported portable event/payload mapping."
```

This is a preservation index, not a new plugin loader. Unknown executable behavior remains disabled. Exporting back to Claude requires a known native schema, a reviewed plan and any trust requirements; exporting to Codex does not replay the Claude payload.

Per-resource native extensions need the same accountability. An unsupported required field blocks activation. A known optional field can remain preserved while an explicitly reviewed portable subset is exported. Unclassified behavior is not presumed optional.

### 14.6 Re-imports and ownership adoption

`convert` is a one-way import action, not a persistent link or watcher. After migration, users edit Etymon inputs and run `sync`.

On re-import, compare the source snapshot, the last imported normalized representation, and current authored state. Unchanged imported records are no-ops. Competing source and authored changes are reviewable conflicts. Do not overwrite self-written edits or silently replace a local fork with a package.

Original native files remain unmanaged even after import. A later same-harness sync must obtain explicit adoption before replacing or merging into their owned units. A proposed `sync --adopt` may authorize the displayed adoption plan; it must not mean ownership of an entire configuration directory or unrelated keys.

A conversion report should retain enough provenance to connect an imported resource with its original source and accepted transformations. Reports stored in a repository must be sanitized; detailed machine locators belong in ignored local state.

### 14.7 Current-native export pipeline

```text
1. Read authored inputs and external lock for the selected scope.
2. Fetch/verify missing locked artifacts without resolving new versions.
3. Normalize resources, apply typed bindings and build the full dependency graph.
4. Select supported target profiles and their preferred current-native writers.
5. Plan complete skill trees, schema-specific config edits and registrations.
6. Compose cross-target operations; detect aliases, collisions and ownership conflicts.
7. Validate capability requirements and report every adapted/native-only component.
8. Apply an approved journaled plan; preserve unrelated native state.
9. Verify supported loader/discovery steps and report remaining activation requirements.
```

A selected target gets native output: Claude skills are materialized into the appropriate `.claude/skills` root; Codex MCP becomes owned TOML tables; OpenCode MCP becomes owned entries in its native JSON map. The inventory provides the native schemas and scope paths. [CL-S] [CX-M] [OC-M]

Current-native means the verified contract for the selected target release. An explicitly selected older release can have its own supported profile, but the exporter must not fall back to an old/foreign format just because it is easier to write. An unsupported target version is a diagnostic, not a reason to generate guessed files.

Syncing an additional harness does not automatically delete output for another harness. Stale cleanup applies to owned units in the requested plan; cross-harness removal is explicit. Switching native formats is likewise a migration with ownership and collision checks, not an unannounced file rename.

### 14.8 Mapping data versus code

Keep stable path, schema and container selection declarative, with separate read and write fields. A mapping record should include:

```yaml
profile: example-target-current
resource: mcp
read:
  - path: .example/config.json
    schema: example-current-v1
  - path: .legacy-example/mcp.json
    schema: example-legacy-v0
    purpose: import-only
write:
  projectPath: .example/config.json
  schema: example-current-v1
  containerKey: mcpServers
  mergeStrategy: owned-map-entries
```

This is an illustrative Etymon fixture, not a real harness contract. Schemas, accepted version intervals, official sources, discovery tests and expected semantic behavior must accompany production records.

Use code for semantic parsing, permissions, editor/profile discovery, OAuth, bundle registration, and hook bridges. Do not force runtime lifecycle behavior into a string-substitution template engine. Resolve external references through the provider layer rather than allowing renderers to fetch mutable aliases.

### 14.9 Scope, non-filesystem operations and unsupported surfaces

Native plugin registration, editor-managed user settings, hosted repository settings, and authentication can require operations beyond writing files. Model them explicitly. A project request must not silently become a global registration.

A supported native format with an unverified loading path is not an approved export target. A verified export path does not automatically establish a faithful importer for all existing settings. Publish both directions and their limitations; do not place a blanket supported badge on a harness from a skill-only integration.

---

## 15. Validation and release gates

### 15.1 Tests that establish real support

| Test class | What it must establish |
|---|---|
| Schema/golden tests | Exact output fields, casing, file extension, container key, ordering, and path placement |
| Native import fixtures | Current and supported legacy input schemas, scope/default/inheritance capture, full asset preservation |
| Authorship/provenance tests | Local versus external classification, modified forks, unknown origins, bindings without duplicate dependency declarations |
| Source/lock ownership | Editing local source changes output without changing external resolution; update does not overwrite local source |
| Migration tests | Non-destructive conversion, explicit adoption, re-import no-ops and three-way conflicts |
| Native-first tests | Current output selected even when an accepted legacy or foreign file exists; current JSONC retained where appropriate |
| Native discovery tests | The actual harness lists/loads the intended skill, agent, server, or plugin |
| Behavioral contract tests | A required restriction, scope, or activation mode behaves as declared |
| Transport tests | Local stdio and remote transports connect without protocol contamination or silent fallback |
| Hook tests | Timing, payload conversion, deny behavior, errors, timeouts, cancellation, and coverage |
| Scope tests | Project/user/parent/config-root precedence and ambient resource collisions |
| Multi-target tests | Shared files and compatibility aliases do not duplicate or shadow managed resources |
| Security tests | Traversal, symlink escapes, archive extraction, command injection, secret redaction, untrusted code activation |
| Ownership tests | Unmanaged files preserved; edits detected; stale owned entries removed safely |
| Recovery tests | Interrupted sync, concurrent sync, disk-full, partial external registration, and rollback |

Do not use “the model appeared to follow the instruction once” as proof of enforcement. Tool and loader behavior should be tested without relying on model judgment where possible.

### 15.2 Golden fixtures

```text
tests/
├── fixtures/
│   ├── skill-standard/
│   ├── skill-manual-only/
│   ├── agent-isolated-read-tools/
│   ├── agent-native-extension/
│   ├── mcp-stdio/
│   ├── mcp-http-oauth/
│   ├── rule-directory/
│   ├── rule-file-pattern/
│   ├── plugin-mixed-components/
│   └── hook-required-deny/
├── golden/<harness>/<profile>/
├── integration/<harness>/
└── security/
```

Fixtures should include valid and invalid documents, Unicode, spaces in paths, Windows quoting, remote workspaces, monorepos, colliding aliases, and existing user configuration. A full-tree skill fixture should include a script and a relative reference, not only a two-line `SKILL.md`.

### 15.3 Core properties

```text
Idempotence:
  applying the same locked plan twice produces no additional changes

Isolation:
  applying a plan never edits unowned files/keys without explicit adoption

Locked restore:
  sync never changes external resolution or the pinned toolchain; it reads current authored inputs

No silent loss:
  every input component is exported, explicitly adapted/excluded, preserved native-only, or blocked; evidence is separate

No security downgrade:
  an unrepresentable required restriction blocks activation

Determinism:
  identical authored snapshot + external lock + toolchain + target + bindings -> identical planned output
```

Import/export round-tripping is a tested contract only for the **representable subset** and an explicitly certified profile. Preserve a native extension or original source artifact for information outside that subset. Never claim lossless round-tripping of arbitrary executable plugins.

### 15.4 Version certification

For each released adapter profile, record the actual CLI/editor version and feature flags used in tests. Run a small native loader test matrix for every supported operating system or state the limitation. Include user-home isolation and restore the test environment afterward.

Do not declare a new version compatible merely because its config file still parses. Hook semantics, tool exposure, precedence, and native plugin auto-updates can change independently of schema syntax.

### 15.5 Recommended diagnostic codes

```text
E_CAPABILITY_REQUIRED       Target cannot represent a required feature
E_SECURITY_DOWNGRADE        Authority would be broadened or enforcement lost
E_SHARED_PATH_CONFLICT      Selected targets need incompatible bytes at one path
E_SCOPE_UNSUPPORTED         Requested scope lacks a verified native installation path
E_LOCK_MISMATCH             External artifact or toolchain does not match the lock
E_UNMANAGED_CONFLICT        Output would overwrite unrelated or edited content
E_SOURCE_UNVERIFIED         No validated schema/profile exists for this artifact
E_AUTHORED_SCHEMA           Authored manifest/resource is invalid or contradictory
E_DEPENDENCY_MISSING        An authored reference lacks a locked/declarative target
E_IMPORT_CONFLICT           Re-import would overwrite independent authored changes
E_PRIVATE_SCOPE            Import would publish private or out-of-scope configuration
W_SOURCE_PROVENANCE         External-looking source cannot be verified
W_UNPINNED_RUNTIME          Connection depends on a mutable package or host executable
W_AMBIENT_OVERRIDE          A native user/parent resource may shadow managed output
W_CROSS_HARNESS_DISCOVERY   An unselected harness can also discover the generated file
W_OPTIONAL_COMPONENT_LOSS   An optional behavior/component is intentionally omitted
I_AUTH_REQUIRED            Configuration restored; user authentication pending
I_EXTERNAL_REGISTRATION    A separate native/service operation remains
```

### 15.6 Bidirectional contract tests

Test both directions independently before combining them:

```text
Native fixture -> import -> expected authored files/lock/provenance/report
Etymon fixture -> export -> expected current native files/report

For an exact certified subset:
  normalize(import(export(environment))) == normalize(environment)

For a supported legacy input:
  import(legacy) -> Etymon -> export(current)
  preserves the declared supported meaning, not legacy syntax
```

Exclude machine locators, output aliases and formatting from semantic comparisons only when they are demonstrably nonsemantic. Keep unknown native payloads in the preservation assertions. Adapted/partial examples assert the exact disclosed differences rather than pretending round-trip equality.

Required fixtures include: a registry-only project; an authored-only project; a mixed project; a local prompt edit with unchanged lock; a verified external skill; a modified external fork; an unpinned MCP command; a secret-bearing native file; a scoped rule; and a plugin with an unsupported required hook.

Use the target's native parser/discovery behavior as an independent oracle. Matching two Etymon functions is insufficient: importer and exporter can share the same bug. No test may execute untrusted imported scripts as part of discovery.

---

## 16. Delivery sequence and unresolved questions

### 16.1 P0: skills, MCP, agents

**First implementation lane:** Claude Code and Codex, including both `convert` and `sync` for the supported P0 core. Their different Markdown/TOML agent formats and different MCP containers exercise the compiler boundary early. Add Copilot CLI and VS Code Local as separate profiles to expose shared-file collisions. Add Gemini CLI and OpenCode next to test remote transport naming, executable extensions, and mode/subagent distinctions.

This order is an engineering recommendation, not a market-share ranking. Broader skill-only support can be added sooner, but a harness should not receive a blanket “supported” badge when its agent or security mapping is unverified.

Kiro, Cursor, OMP, Pi, Antigravity, Kilo, Roo, Cline, Continue, and additional targets then graduate feature by feature. A Pi agent requires its extension dependency. A Roo custom mode remains a different capability. Continue's unknown skill/subagent contract must remain unknown until verified.

### 16.2 P1: rules

Start with always-on and directory rules, then add scoped/conditional rule compilation with explicit match semantics. Integrate multi-harness instruction-file discovery into `doctor` before writing shared root guidance automatically.

### 16.3 P2: plugins

Import Agent Plugins and Claude-style bundles first, retaining parent-child provenance. Add Gemini extensions and Kiro Powers. Keep executable plugin formats native-only unless a specific portable component bridge is implemented. A required P3 hook inside a P2 plugin can block full portability; the plugin importer must not silently discard it just because hooks are scheduled later.

### 16.4 P3: hooks

Ship a small portable command-hook contract and a few rigorously tested bridges. Prioritize correct deny/failure behavior over claiming every lifecycle event. Keep editor-specific and model-specific events native until their semantics are defined.

### 16.5 Research / implementation blockers

| Item | Current finding | Required before release |
|---|---|---|
| Exact supported versions | Documentation/source review only | Pin releases and run real loader/behavior tests. |
| Continue native skills/subagents/hooks | Precise contracts not established | Source/maintainer verification or keep those resource types unverified. |
| Cline user MCP path | Official pages name different paths/surfaces | Detect active release/config; fixture both where justified. |
| Cline custom-agent files | Config lists agent directories without sufficient schema | Obtain actual loader/schema; no guessed renderer. |
| Antigravity plugin manifest | Installed plugin resources documented, full import contract not established | Verify manifest/version/registration and surface parity. |
| Roo hook runtime | No verified portable lifecycle contract | Confirm native support or explicitly remain unsupported by Etymon. |
| Kilo plugin registration | Current and migration-era path references coexist | Test active plugin loader and avoid foreign config names. |
| Kiro Powers registration | Public native install flow is known; cache path is not a stable API here | Use documented install/link API or approved manual registration. |
| Shared `.agents/` visibility | Several targets auto-read it | Cross-target discovery tests and inert source/cache layout. |
| Headless skills.sh integration | CLI exists; stable resolver/no-lock API not established here | Pin and test isolated integration; do not rely on undocumented flags. |
| Hosted targets | May not receive ignored local output or personal configuration | Explicit export/bootstrap/service registration mode. |
| Hooks as hard security policy | Native coverage/failure semantics can be incomplete | Verify relevant operations or block a required enforcement claim. |

The evidence for product-specific blockers is in the respective harness rows and their sources. Unknowns are not evidence of absence; they are reasons **not to ship a speculative write path**.

### 16.6 Definition of done for the first release

A collaborator clones a repository containing `.agents/etymon.toml` when used, its `.agents/etymon/` authored resources, and `.agents/etymon.lock`, runs `etymon sync`, selects a certified harness profile, and obtains the environment built from the same authored snapshot and locked external graph. Etymon either verifies the generated resources are discoverable or reports exactly what remains—authentication, trust, native registration, unsupported semantics, or a conflicting user file.

The success condition is not “all files were copied.” It is:

> Every requested resource has an accountable result, every supported mapping preserves its declared semantics, and nothing becomes more privileged or less reproducible without an explicit decision.

### 16.7 Required first-release conversion journey

An existing self-authored Claude setup can be imported without deleting or modifying its source. The generated Etymon manifest references editable resources under `.agents/etymon/`; externally verified artifacts go into the lock, while unknown provenance is not guessed. Syncing to a certified Codex profile then produces native files and an accountable feature report.

Editing a converted local agent changes the next sync without a dependency update. Re-running convert does not clobber that edit. Syncing back to Claude requires explicit adoption of the original native entries. Required unsupported semantics block activation; P1/P2/P3 components encountered during P0 are reported or preserved without an implication of full-environment conversion.

These migration and ownership behaviors are part of the MVP, not optional work after broad harness coverage.

---

## 17. Source index

The primary-source reference index below is retained from the **September 30, 2026** inventory baseline. This architecture revision spot-checked Agent Skills, Agent Plugins, Claude settings, Codex skills/MCP, OpenCode configuration and the specific dot-agents site; it did **not** re-fetch every inventory source or run every native client. Some URLs redirect to current documentation. Proposed Etymon commands, schemas, conversion policies and test plans are original design recommendations, not upstream guarantees.

**Evidence boundary:** no installed-client compatibility certification was performed in this research pass. The unknown and conflict entries are intentional release gates, not placeholder paths to implement blindly.


**Shared standards and providers:** [Agent Skills specification][STD-S] · [Agent Plugins specification][STD-P] · [Skills CLI upstream repository][SK-CLI] · [MCP Registry overview][MCP-R] · [MCP Registry package types][MCP-P]

**Claude Code:** [Settings and mixed private state][CL-C] · [Skills][CL-S] · [Subagents][CL-A] · [MCP][CL-M] · [Plugin reference][CL-P] · [Memory and rules][CL-R] · [Hooks reference][CL-H]

**Codex:** [Skills][CX-S] · [Subagents][CX-A] · [MCP][CX-M] · [Plugin packaging][CX-P] · [AGENTS.md instructions][CX-R] · [Hooks][CX-H]

**GitHub Copilot:** [CLI skills][GH-S] · [CLI custom-agent locations and precedence][GH-A] · [Custom-agent configuration reference][GH-A2] · [CLI MCP servers][GH-M] · [CLI plugin reference][GH-P] · [CLI custom instructions][GH-R] · [Hooks reference][GH-H] · [Agent skills and supported surfaces][GH-CS] · [Cloud/repository MCP configuration][GH-CM] · [Repository custom instructions][GH-CR]

**VS Code Local:** [Agent skills][VS-S] · [Custom agents][VS-A] · [MCP servers][VS-M] · [Agent plugins][VS-P] · [Custom instructions][VS-R] · [Hooks][VS-H]

**Gemini CLI:** [Skills][GE-S] · [Subagents][GE-A] · [MCP servers][GE-M] · [Extension reference][GE-P] · [GEMINI.md][GE-R] · [Hooks reference][GE-H]

**Kiro:** [Configuration scopes and current generations][KI-C] · [Skills][KI-S] · [Custom agents][KI-A] · [MCP][KI-M] · [Powers][KI-P] · [Power installation and activation][KI-PI] · [Steering][KI-R] · [Hooks][KI-H]

**Pi:** [Configuration][PI-C] · [Skills][PI-S] · [Official subagent extension example][PI-A] · [MCP][PI-M] · [Packages][PI-P] · [Extension API][PI-H]

**Oh My Pi:** [Skills][OM-S] · [Subagent authoring][OM-A] · [MCP][OM-M] · [Plugins][OM-P] · [Context files][OM-R] · [Hooks][OM-H]

**OpenCode:** [Skills][OC-S] · [Agents][OC-A] · [MCP servers][OC-M] · [Plugins and callbacks][OC-P] · [Rules][OC-R] · [Configuration][OC-C]

**Cursor:** [Skills][CU-S] · [Subagents][CU-A] · [MCP][CU-M] · [Plugins][CU-P] · [Rules][CU-R] · [Hooks][CU-H]

**Antigravity:** [Skills and plugin skill locations][AG-S] · [CLI subagents][AG-A] · [MCP][AG-M] · [Rules and surface paths][AG-R] · [Hooks][AG-H]

**Roo Code:** [Skills][RO-S] · [Custom modes][RO-A] · [MCP configuration][RO-M] · [Marketplace][RO-P] · [Custom instructions][RO-R]

**Cline:** [Skills][CN-S] · [Subagents][CN-A] · [MCP overview][CN-M] · [Plugins and supported surfaces][CN-P] · [Rules][CN-R] · [SDK plugins and hooks][CN-H] · [Configuration paths][CN-C] · [CLI agent teams][CN-T]

**Kilo:** [Skills][KL-S] · [Custom subagents][KL-A] · [MCP configuration][KL-M] · [Native plugins and hooks][KL-P] · [Custom rules][KL-R]

**Continue:** [Config-v1 reference][CT-C] · [Configuration locations][CT-L] · [MCP][CT-M] · [Rules][CT-R]

**Windsurf / Devin Cascade:** [Skills][WI-S] · [MCP][WI-M] · [Memories and rules][WI-R] · [Hooks][WI-H]

**Amp:** [Skills][AM-S] · [Plugin API and custom subagents][AM-A] · [MCP][AM-M] · [Plugins and installation paths][AM-P] · [AGENTS.md][AM-R] · [Plugin event contract][AM-H]

**Zed:** [Skills][ZD-S] · [Agent profiles][ZD-A] · [MCP and extension integration][ZD-M] · [Instructions][ZD-R] · [External-agent configuration boundary][ZD-X]

**Related project identity:** [dot-agents.com][DOT] is the site supplied in the product discussion. Its claims are not automatically transferable to other projects named DotAgents.

<!-- Reference definitions. Stable public URLs; adapter releases should additionally pin source/schema revisions. -->

[STD-S]: https://agentskills.io/specification "Agent Skills specification"
[STD-P]: https://agent-plugins.org/specification "Agent Plugins specification"
[SK-CLI]: https://github.com/vercel-labs/skills "Skills CLI upstream repository"
[MCP-R]: https://modelcontextprotocol.io/registry/about "MCP Registry overview"
[MCP-P]: https://modelcontextprotocol.io/registry/package-types "MCP Registry package types"
[CL-S]: https://code.claude.com/docs/en/skills "Skills"
[CL-A]: https://code.claude.com/docs/en/sub-agents "Subagents"
[CL-M]: https://code.claude.com/docs/en/mcp "MCP"
[CL-P]: https://code.claude.com/docs/en/plugins-reference "Plugin reference"
[CL-R]: https://code.claude.com/docs/en/memory "Memory and rules"
[CL-H]: https://code.claude.com/docs/en/hooks "Hooks reference"
[CX-S]: https://learn.chatgpt.com/docs/build-skills "Skills"
[CX-A]: https://learn.chatgpt.com/docs/agent-configuration/subagents "Subagents"
[CX-M]: https://learn.chatgpt.com/docs/extend/mcp?surface=cli "MCP"
[CX-P]: https://developers.openai.com/plugins/build/plugins "Plugin packaging"
[CX-R]: https://learn.chatgpt.com/docs/agent-configuration/agents-md "AGENTS.md instructions"
[CX-H]: https://learn.chatgpt.com/docs/hooks "Hooks"
[GH-S]: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills "CLI skills"
[GH-A]: https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/invoke-custom-agents "CLI custom-agent locations and precedence"
[GH-A2]: https://docs.github.com/en/copilot/reference/custom-agents-configuration "Custom-agent configuration reference"
[GH-M]: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers "CLI MCP servers"
[GH-P]: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference "CLI plugin reference"
[GH-R]: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions "CLI custom instructions"
[GH-H]: https://docs.github.com/en/copilot/reference/hooks-reference "Hooks reference"
[GH-CS]: https://docs.github.com/en/copilot/concepts/agents/about-agent-skills "Agent skills and supported surfaces"
[GH-CM]: https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/configure-mcp-servers "Cloud/repository MCP configuration"
[GH-CR]: https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions "Repository custom instructions"
[VS-S]: https://code.visualstudio.com/docs/agent-customization/agent-skills "Agent skills"
[VS-A]: https://code.visualstudio.com/docs/agent-customization/custom-agents "Custom agents"
[VS-M]: https://code.visualstudio.com/docs/agent-customization/mcp-servers "MCP servers"
[VS-P]: https://code.visualstudio.com/docs/agent-customization/agent-plugins "Agent plugins"
[VS-R]: https://code.visualstudio.com/docs/agent-customization/custom-instructions "Custom instructions"
[VS-H]: https://code.visualstudio.com/docs/agent-customization/hooks "Hooks"
[GE-S]: https://geminicli.com/docs/cli/skills/ "Skills"
[GE-A]: https://geminicli.com/docs/core/subagents/ "Subagents"
[GE-M]: https://geminicli.com/docs/tools/mcp-server/ "MCP servers"
[GE-P]: https://geminicli.com/docs/extensions/reference/ "Extension reference"
[GE-R]: https://geminicli.com/docs/cli/gemini-md/ "GEMINI.md"
[GE-H]: https://geminicli.com/docs/hooks/reference/ "Hooks reference"
[KI-C]: https://kiro.dev/docs/configuration/ "Configuration scopes and current generations"
[KI-S]: https://kiro.dev/docs/skills/ "Skills"
[KI-A]: https://kiro.dev/docs/custom-agents/ "Custom agents"
[KI-M]: https://kiro.dev/docs/mcp/ "MCP"
[KI-P]: https://kiro.dev/docs/powers/ "Powers"
[KI-PI]: https://kiro.dev/docs/powers/installation/ "Power installation and activation"
[KI-R]: https://kiro.dev/docs/steering/ "Steering"
[KI-H]: https://kiro.dev/docs/hooks/ "Hooks"
[PI-C]: https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/configuration.md "Configuration"
[PI-S]: https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/skills.md "Skills"
[PI-A]: https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/examples/extensions/subagent/README.md "Official subagent extension example"
[PI-M]: https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/mcp.md "MCP"
[PI-P]: https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/packages.md "Packages"
[PI-H]: https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/extensions.md "Extension API"
[OM-S]: https://omp.sh/docs/skills "Skills"
[OM-A]: https://omp.sh/docs/subagent-authoring "Subagent authoring"
[OM-M]: https://omp.sh/docs/mcp "MCP"
[OM-P]: https://omp.sh/docs/plugins "Plugins"
[OM-R]: https://omp.sh/docs/context-files "Context files"
[OM-H]: https://omp.sh/docs/hooks "Hooks"
[OC-S]: https://opencode.ai/docs/skills/ "Skills"
[OC-A]: https://opencode.ai/docs/agents/ "Agents"
[OC-M]: https://opencode.ai/docs/mcp-servers/ "MCP servers"
[OC-P]: https://opencode.ai/docs/plugins/ "Plugins and callbacks"
[OC-R]: https://opencode.ai/docs/rules/ "Rules"
[OC-C]: https://opencode.ai/docs/config/ "Configuration"
[CU-S]: https://cursor.com/docs/skills "Skills"
[CU-A]: https://cursor.com/docs/subagents "Subagents"
[CU-M]: https://cursor.com/docs/mcp "MCP"
[CU-P]: https://cursor.com/docs/plugins "Plugins"
[CU-R]: https://cursor.com/docs/rules "Rules"
[CU-H]: https://cursor.com/docs/hooks "Hooks"
[AG-S]: https://antigravity.google/docs/skills "Skills and plugin skill locations"
[AG-A]: https://antigravity.google/docs/subagents/ "CLI subagents"
[AG-M]: https://antigravity.google/docs/mcp "MCP"
[AG-R]: https://antigravity.google/docs/rules "Rules and surface paths"
[AG-H]: https://antigravity.google/docs/hooks/ "Hooks"
[RO-S]: https://roocodeinc.github.io/Roo-Code/features/skills/ "Skills"
[RO-A]: https://roocodeinc.github.io/Roo-Code/features/custom-modes/ "Custom modes"
[RO-M]: https://roocodeinc.github.io/Roo-Code/features/mcp/using-mcp-in-roo/ "MCP configuration"
[RO-P]: https://roocodeinc.github.io/Roo-Code/features/marketplace/ "Marketplace"
[RO-R]: https://roocodeinc.github.io/Roo-Code/features/custom-instructions/ "Custom instructions"
[CN-S]: https://docs.cline.bot/customization/skills "Skills"
[CN-A]: https://docs.cline.bot/features/subagents "Subagents"
[CN-M]: https://docs.cline.bot/mcp/mcp-overview "MCP overview"
[CN-P]: https://docs.cline.bot/customization/plugins "Plugins and supported surfaces"
[CN-R]: https://docs.cline.bot/customization/cline-rules "Rules"
[CN-H]: https://docs.cline.bot/sdk/plugins "SDK plugins and hooks"
[CN-C]: https://docs.cline.bot/getting-started/config "Configuration paths"
[CN-T]: https://docs.cline.bot/cli/agent-teams "CLI agent teams"
[KL-S]: https://kilo.ai/docs/customize/skills "Skills"
[KL-A]: https://kilo.ai/docs/customize/custom-subagents "Custom subagents"
[KL-M]: https://kilo.ai/docs/automate/mcp/using-in-kilo-code "MCP configuration"
[KL-P]: https://kilo.ai/docs/automate/extending/plugins "Native plugins and hooks"
[KL-R]: https://kilo.ai/docs/customize/custom-rules "Custom rules"
[CT-C]: https://docs.continue.dev/reference "Config-v1 reference"
[CT-L]: https://docs.continue.dev/guides/understanding-configs "Configuration locations"
[CT-M]: https://docs.continue.dev/customize/deep-dives/mcp "MCP"
[CT-R]: https://docs.continue.dev/customize/deep-dives/rules "Rules"
[WI-S]: https://docs.devin.ai/desktop/cascade/skills "Skills"
[WI-M]: https://docs.devin.ai/desktop/cascade/mcp "MCP"
[WI-R]: https://docs.devin.ai/desktop/cascade/memories "Memories and rules"
[WI-H]: https://docs.devin.ai/desktop/cascade/hooks "Hooks"
[AM-S]: https://ampcode.com/docs/customize/skills "Skills"
[AM-A]: https://ampcode.com/docs/plugin-api "Plugin API and custom subagents"
[AM-M]: https://ampcode.com/docs/customize/mcp "MCP"
[AM-P]: https://ampcode.com/docs/customize/plugins "Plugins and installation paths"
[AM-R]: https://ampcode.com/docs/customize/agents-md "AGENTS.md"
[AM-H]: https://ampcode.com/docs/plugin-api "Plugin event contract"
[ZD-S]: https://zed.dev/docs/ai/skills "Skills"
[ZD-A]: https://zed.dev/docs/ai/agent-profiles "Agent profiles"
[ZD-M]: https://zed.dev/docs/ai/mcp "MCP and extension integration"
[ZD-R]: https://zed.dev/docs/ai/instructions "Instructions"
[ZD-X]: https://zed.dev/docs/ai/external-agents "External-agent configuration boundary"

[CL-C]: https://code.claude.com/docs/en/settings "Claude settings, scopes, and mixed private state"
[DOT]: https://www.dot-agents.com/ "Specific dot-agents project supplied in the discussion"
