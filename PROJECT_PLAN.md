# Etymon — Project Plan

**Status:** Product direction and proposed user experience

**Updated:** September 30, 2026

**Companion:** [TECHNICAL_DETAILS.md](TECHNICAL_DETAILS.md)

> **Bring your agent environment with you.** Install resources from existing ecosystems, import the setup you already authored, and sync the supported environment into your preferred coding harness.

Commands in this document describe the proposed Etymon product. They are not a claim that an npm package or these features have already shipped.

## 1. The problem

AI coding tools increasingly expose similar building blocks, but they do not load or configure them in the same way. A team can end up maintaining separate versions of its skills, MCP servers, agents, rules, plugins, and hooks for several tools. Native differences include Claude skill directories, Codex TOML MCP configuration, and OpenCode JSON configuration. The detailed, qualified inventory is in [the technical document](TECHNICAL_DETAILS.md#4-harness-by-harness-inventory). [CL-S] [CX-M] [OC-C]

This creates configuration drift, repetitive onboarding, and accidental dependence on the harness the original author happened to use. A carefully written Claude setup should not require someone to start again just because they prefer Codex. Equally, a new collaborator should not need the list of installation commands that originally created the environment.

Etymon addresses both problems: **dependency management and configuration portability**. It is not another coding agent, orchestration framework, or replacement for the underlying registries.

## 2. The goal

There are two equally important entry points:

```text
Start with existing registries         Start with an existing native setup
              |                                      |
   etymon skill/mcp/agent add           etymon convert claude
              |                                      |
              +-------------------+------------------+
                                  |
                         Etymon environment
                                  |
                    etymon sync --harness codex
                                  |
                     Native Codex files and settings
```

Etymon should perform the installation, not leave the user with an intermediate format they must manually connect to a harness. A sync restores the locked external resources, reads the authored resources, checks compatibility, and writes the selected harness's current native configuration.

The promise is **portable configuration and reproducible external artifacts for supported features**. It is not identical model behavior, lossless conversion of arbitrary executable plugins, or support for every future harness format.

## 3. One owner for each kind of information

The portable environment has three parts:

| Part | Purpose | Owner |
|---|---|---|
| `.agents/etymon.toml` | Authored resource references, custom MCP connections, resource bindings, and reviewed project configuration | User; also created by `convert` or local-resource commands |
| `.agents/etymon/` | Self-written or imported skills, agent prompts, rules, bundles, scripts, and preserved native material | User |
| `.agents/etymon.lock` | External dependency requests and exact versions, commits, integrity, provenance, and dependency relationships | Etymon CLI |

**The TOML file is not a second external dependency manifest.** Installing an upstream skill should not duplicate its repository and version in both files. The lock owns that resolution. A project-specific configuration entry may reference its stable dependency ID without redeclaring the dependency.

For example, the lock can identify the external MCP package, while the TOML file supplies the environment-variable references this project uses to configure it. Secrets themselves belong in neither file.

A registry-only environment can use just `etymon.lock`. An authored-only environment can use `etymon.toml` and source files; the CLI may create an otherwise empty lock to record toolchain metadata. A mixed environment must commit all the authored inputs as well as its lock. **The lockfile alone is not a complete backup of authored work.**

## 4. Project layout

```text
project/
├── .agents/
│   ├── etymon.toml                  # Optional authored configuration
│   ├── etymon.lock                  # External dependency state
│   │
│   ├── etymon/                      # Tracked authored/imported source
│   │   ├── skills/
│   │   │   └── release-check/
│   │   │       ├── SKILL.md
│   │   │       └── scripts/
│   │   ├── agents/
│   │   │   └── reviewer.md
│   │   ├── rules/
│   │   ├── plugins/
│   │   ├── hooks/
│   │   └── native/                     # Optional, nonportable material
│   │       └── claude/
│   │
│   └── .etymon/                     # Ignored local state/runtime/staging
│
├── .claude/                            # May contain managed native output
├── .codex/
└── ...
```

Use `.agents/etymon/<resource>/` for authored source, not `.agents/<resource>/`. Some harnesses discover paths such as `.agents/skills/` directly, so source and activation must remain separate. The proposed source layout still needs discovery tests for every supported target. [CX-S]

Downloaded external dependencies belong in Etymon's cache, not in the authored source directory. Turning a dependency into a locally editable fork should be an explicit action.

Paths in the authored manifest are relative to `.agents/etymon.toml`; for example, `etymon/agents/reviewer.md`. Custom MCP connections can live inline in the manifest and do not require a separate MCP directory.

## 5. The main workflows

### Build an environment from registries

```bash
npx etymon init

npx etymon skill add <skill-source> --skill <skill-name>
npx etymon mcp add <registry-server-id>
npx etymon agent add <git-agent-source>

npx etymon sync --harness claude
```

`init` establishes Etymon's directory and lock. It creates an authored manifest when one is needed, not merely to repeat the external dependency list. It can detect harnesses and set up narrowly scoped ignore entries for generated or machine-local files.

`add` resolves the chosen resource and updates the lock. It can cache the resource immediately, but native activation is the job of `sync`. An ambiguous search term must lead to an explicit selection, not an arbitrary package.

### Bring an existing setup into Etymon

```bash
npx etymon convert claude --dry-run
npx etymon convert claude
npx etymon sync --harness codex
```

`convert` reads the existing Claude environment for the requested scope. It creates editable Etymon source for authored resources, records externally sourced dependencies only when their provenance is verified, and reports unsupported or ambiguous features.

**The original Claude configuration stays unchanged.** Conversion does not delete it, adopt its files for future overwrites, run its hooks, start its MCP servers, or migrate sign-in sessions. Importing and taking ownership of an existing native file are separate decisions.

### Work with local resources

```bash
npx etymon agent add ./.agents/etymon/agents/reviewer.md
npx etymon skill add ./.agents/etymon/skills/release-check

# Edit the source files, then regenerate the native environment.
npx etymon sync --harness claude,codex
```

Local additions register authored resources in `etymon.toml`. Normal edits to local instructions do not require an external dependency update or a new lock entry. A local resource referring to an external dependency must reference an existing locked ID; a missing dependency produces an actionable error rather than an implicit network resolution.

### Restore on another machine

```bash
git clone <repo>
cd <repo>
npx etymon sync
```

Sync prompts for a supported harness when no local preference or explicit target exists. It fetches missing locked artifacts and generates the target-native files. Authentication, workspace trust, or a native registration may still need a separate step; those requirements must be reported honestly.

### Update or remove

```bash
npx etymon update
npx etymon skill remove <resource-id-or-unambiguous-name>
npx etymon list
npx etymon doctor --harness codex
```

`update` is the operation that intentionally changes external resolutions. `sync` does not choose newer dependency versions. Removing a resource updates its authoritative file and cleans up owned native output safely; it does not delete authored source files by default or remove resources still required by another component.

## 6. Native output is the point

Etymon should inspect supported compatibility locations when importing, but **write the current first-class format for the selected harness and scope**. It should not use a foreign or legacy format merely because a client happens to accept it.

| Example | Project output | Global/user output |
|---|---|---|
| Skill → Claude Code | `.claude/skills/<name>/SKILL.md` | `~/.claude/skills/<name>/SKILL.md` |
| MCP → OpenCode | `opencode.json`; retain an existing current `opencode.jsonc` | `~/.config/opencode/opencode.json` |
| MCP → Codex | `.codex/config.toml` | `~/.codex/config.toml` |

These locations come from the respective native documentation. Real skills include their supporting files, and real MCP writes merge only Etymon-owned entries. Configuration-root overrides, trust requirements, and platform differences remain part of each adapter. [CL-S] [OC-C] [CX-M]

A shared standardized directory can itself be the current native destination, as with Codex skills in `.agents/skills/`. Native-first does not mean inventing a branded directory that the harness does not load. [CX-S]

## 7. The resource and harness model

Etymon understands six resource types:

```text
Skill · MCP · Agent · Rule · Plugin · Hook
```

Each supported harness has an adapter with two directions:

```text
Native configuration → Etymon resources
Etymon resources → Native configuration
```

Registry providers, authored files, and native importers all feed the same resource model. There should not be a separate Claude-to-Codex converter, Claude-to-OpenCode converter, and so on. The destination adapter should not care where a resource originally came from.

Support is feature- and version-specific. A harness can support importing one resource type before it supports exporting another. The detailed inventory is a research and implementation guide, not a claim that every adapter has shipped.

## 8. Use standards where they fit

**Skills:** use the Agent Skills format and integrate with the skills.sh ecosystem for discovery and source resolution. Agent Skills defines `SKILL.md`; skills.sh is the distribution integration. Etymon owns the final harness placement and its own external dependency lock. [STD-S] [SK-CLI]

**MCP:** use the official MCP Registry as the primary source of server metadata. Etymon must resolve the actual package or hosted connection and own the client-specific transformation. Smithery can be an optional later provider, not a required dependency of the core workflow. [MCP-R]

**Plugins:** use the Agent Plugins specification where applicable. Its v1 portable components are skills and MCP servers; additional native capabilities need explicit extensions and Etymon mappings. It is not a universal agent-definition or executable-plugin format. [STD-P]

**Agents, Rules, and Hooks:** define a small, useful Etymon core and implement explicit transformations. Preserve advanced native behavior separately rather than forcing every native field into a supposed universal standard.

## 9. Conversion is accountable, not necessarily lossless

The useful promise is to import supported native features, preserve nonportable information, and emit supported current-native equivalents. It is not to translate all possible behavior automatically.

| Result | User meaning |
|---|---|
| **Exact** | The supported behavior is represented without a known semantic change. |
| **Adapted** | A defined conversion is applied; any optional differences are disclosed. |
| **Native-only** | Material is preserved for the source harness but not activated on another target. |
| **Blocked** | A required feature, restriction, or dependency cannot be represented safely. |

Unknown mappings and pending authentication/registration are reported separately. Etymon must not claim that installing a file proves it is loaded or usable.

If an agent requires enforced read-only execution, exporting only its prompt is not enough. If a hook enforces a required decision, dropping it is not an acceptable conversion. Optional differences can be reviewed; required security guarantees cannot silently become suggestions.

## 10. Preserve authorship and provenance

During `convert`, locally authored resources become editable files under `.agents/etymon/`. A verified, unchanged external package becomes a locked dependency. A modified upstream resource becomes a local fork with its origin retained. Unknown material remains unverified or native-only until reviewed.

Etymon must not infer a package's source from its display name or claim to recover a historical version from an unpinned command such as `package@latest`.

After conversion, the normal workflow is to edit Etymon source and run `sync`. Re-running `convert` is an explicit re-import with conflicts and a diff, not continuous two-way synchronization between three competing copies.

## 11. Plugins and hooks

A plugin remains a parent bundle with component relationships. Where a target supports the relevant native bundle, Etymon can produce that bundle. Otherwise, it can install individually supported skills, MCP servers, agents, or rules while retaining their shared ownership and dependencies.

Decomposition is permitted only when it preserves required behavior. A component that depends on an unsupported hook cannot quietly become a standalone component. Removing the parent package must also respect children referenced elsewhere.

Hooks require deliberately designed event and payload mappings. Copying a script does not translate the event data it expects, its return contract, timing, or failure behavior. Start with a narrow portable contract rather than arbitrary script rewriting.

## 12. Roadmap

| Priority | Resource coverage | Source and conversion plan |
|---|---|---|
| **P0** | Skills | Agent Skills + skills.sh; local source and native import/export |
| **P0** | MCP | Official MCP Registry + custom definitions; Etymon-owned native renderers/importers |
| **P0** | Agents | Git/local sources initially; registry TBD; core agent model and native import/export |
| **P1** | Rules | Local/Git; always-on and directory scope first, then carefully defined conditional rules |
| **P2** | Plugins | Agent Plugins and native bundle importers; preserve parent/child identity and decompose where safe |
| **P3** | Hooks | Small explicit portable contracts and tested native bridges |

The first end-to-end implementation should exercise Claude Code and Codex. Add Copilot CLI and VS Code as distinct targets, then OpenCode, Gemini, and the broader inventory as mappings are verified. This is implementation sequencing, not a popularity ranking.

P0 `convert` should import Skills, MCP, and Agents and report later-phase resources. It must not imply that a whole setup was ported when Rules, Plugins, or Hooks were only detected or preserved.

## 13. Global scope, ownership, and safety

The same structure can exist under `~/.agents/` for personal resources:

```bash
npx etymon convert claude --global
npx etymon skill add <source> --global
npx etymon sync --harness codex --global
```

Project commands operate on project state; global commands operate on global state. Neither should silently install into the other scope. Native loaders may combine or prioritize user and project configuration differently, so `doctor` must identify collisions instead of promising universal project-over-global precedence.

Generated output is managed at the file or configuration-entry level. Etymon must preserve unrelated user settings, detect edits to managed output, and require explicit adoption before taking over existing files. This ownership tracking is a first-release requirement, not a later cleanup feature.

Ignore only known generated or local-state paths. Do not blanket-ignore `.github/`, `.claude/`, or `.agents/`. Hosted agents may require committed generated output or a bootstrap step; provide an explicit workflow rather than silently committing files.

Do not copy credentials, OAuth state, sign-in sessions, or unrelated machine history into the portable source tree. Native configuration can mix resource settings with sensitive state, so conversion must extract recognized fields rather than back up whole configuration files indiscriminately. [CL-C]

## 14. Related work

The specific project at **dot-agents.com** describes a unified local configuration system built around `~/.agents/`, links, and cross-project organization. It is worth evaluating for reusable ideas. Do not conflate it with unrelated projects that share similar DotAgents names or assume it implements Etymon's exact dependency and conversion model. [DOT]

Etymon's intended scope combines registry-backed installation, immutable external resolution, editable imported source, native-first output, and explicit conversion diagnostics. Before building broadly, compare these requirements against existing implementations and decide what to reuse, extend, or build independently.

## 15. First-release acceptance criteria

The first useful version must complete both journeys: **registry → lock → native sync** and **existing native setup → editable Etymon source → another native harness**.

A collaborator should be able to clone the committed Etymon inputs and run `sync` without knowing the original installation commands. An author should be able to convert an existing setup without losing the original files, modify a local agent without relocking unrelated dependencies, and see exactly which features did or did not survive conversion.

The release must also demonstrate safe ownership, secret handling, current-native output selection, deterministic restoration of external artifacts, and honest failure when a required capability cannot be mapped.

> **Author once. Install once. Convert deliberately. Sync to your harness.**

## References

The technical document retains the full harness inventory and reference index. Product decisions and proposed Etymon commands above are design choices; the following links support external format and product facts.

[STD-S]: https://agentskills.io/specification "Agent Skills specification"
[SK-CLI]: https://github.com/vercel-labs/skills "Skills CLI"
[MCP-R]: https://modelcontextprotocol.io/registry/about "Official MCP Registry"
[STD-P]: https://agent-plugins.org/specification "Agent Plugins specification"
[CL-S]: https://code.claude.com/docs/en/skills "Claude Code skills"
[CL-C]: https://code.claude.com/docs/en/settings "Claude Code settings and sensitive state"
[CX-S]: https://learn.chatgpt.com/docs/build-skills "Codex skill discovery"
[CX-M]: https://learn.chatgpt.com/docs/extend/mcp?surface=cli "Codex MCP configuration"
[OC-C]: https://opencode.ai/docs/config/ "OpenCode configuration"
[DOT]: https://www.dot-agents.com/ "The specific dot-agents project supplied in the discussion"
