---
etymon: rule
name: project-context
base: .
activation: always
patterns: []
description: Shared project purpose, architecture and contribution expectations
format: etymon
native: {}
---

# Etymon project context

Etymon keeps a team's coding-tool setup in one repository. Skills, MCP connections, agents, and rules otherwise accumulate in separate native folders and drift. Contributors should add or import a resource once, commit its portable source, and use etymon sync for the tools they use.

The goal is a complete, usable CLI and terminal UI with local and external sources, reliable conversion, and predictable sync. Preserve permissions and rule scope by default. If a destination cannot represent them, explain the limitation and stop before activation. Explicit --allow-lossy may broaden conditions or omit unsupported settings/resources, with specific warnings and unchanged canonical source. Validation, ownership, filesystem, and loader errors remain errors.

## Repository map

- src/core: schemas, safe filesystem operations, document edits, workspace roots, ownership transactions and recovery.
- src/providers: source discovery, Git/skills/MCP registry resolution, normalized resources and locked artifact restoration.
- src/harnesses: documented tool profiles, native import/render, rule scopes, alias discovery and generated-file ignores.
- src/services: shared create/add/convert/sync/update/remove/doctor/uninstall operations.
- src/cli.ts, src/tui, src/index.ts: scriptable commands, neo-blessed forms and the SDK.
- tests: focused Vitest checks. testcases: isolated Git fixtures, actual CLI workflows, PTY interaction and native loaders.
- docs: architecture, rule compatibility, verification evidence and human contribution instructions. scripts: distribution checks and release entry points.

## Authoritative setup

Track .agents/etymon.toml, .agents/etymon.lock, and authored source in .agents/etymon/. Native tool output and runtime ownership/cache files stay ignored. Edit source, then sync. MCP connections stay inline in the manifest; contributor guidance does not need a test MCP server.

sync uses locked external versions; update deliberately changes resolution. Local resources stay editable. Existing local paths take precedence over remote shorthand, explicit missing local paths stop, and failed local validation never retries remotely. Project scopes remain project-only; user rules are unscoped always-on guidance.

## Working on changes

Use the coding skill for implementation and the testing skill for verification. For new resources or destinations, use creating-new-interface or creating-new-harness. Use resource-lifecycle for locking, ownership, scope, deduplication or recovery changes; adding-skill for contributor guidance; releasing for an authorized release. Read the relevant implementation and repository instructions first. If .codegraph exists, use CodeGraph before code discovery.

Keep CLI and TUI behavior in shared services and schemas. Research changing native formats using primary documentation or source and retain source links. Native configuration parsing alone does not certify runtime discovery. Test discovery without model calls or inherited accounts. Do not enable trust or experimental features in users' environments.

Run relevant focused checks during development and npm run check before completing code changes. Use numbered lifecycle cases, coverage, smoke or native checks when the affected behavior warrants them. Preserve coverage floors and record actual evidence. Avoid implementation-mirroring tests for low-impact edits.

Keep product copy plain and specific. Avoid promotional filler and em dashes. Update docs/CONTRIBUTING.md when contribution expectations change.

Use conventional commit types such as feat, fix, perf, refactor, test, docs, build, ci and chore. Agent-assisted commits identify the agent, for example feat: add rule creation [codex], with an Agent-assisted-by: Codex trailer. Be honest about substantial generated code and human review; do not claim it was entirely human-written. Commit, push, and publish only within the user's authorized task; these instructions do not grant that authorization.
