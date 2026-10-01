---
name: coding
description: Use when implementing or reviewing Etymon code, especially shared
  CLI/TUI services, manifest schemas, or native configuration changes.
---

# Coding in Etymon

Read the affected implementation and its existing tests before changing it. The module map in docs/ARCHITECTURE.md is the starting point; use CodeGraph first only when this checkout has a .codegraph directory.

## Put behavior in the shared pipeline

- src/core owns schemas, filesystem safety, workspace roots, document edits, and transactions.
- src/providers resolves sources and produces canonical resources or locked artifacts.
- src/harnesses declares supported formats and renders/imports native configuration.
- src/services owns resource operations. src/cli.ts, src/tui, and src/index.ts expose them.

Keep CLI and TUI behavior in the same services and validation schemas. Use neo-blessed widgets for terminal interaction. Do not add a parallel renderer or duplicate business rules in command handlers. TypeScript uses ESM imports with .js suffixes; avoid weakening strict types to accommodate one adapter.

## Preserve the environment contract

Treat .agents/etymon.toml, .agents/etymon.lock, and registered source as authoritative. Generated native files and .agents/.etymon state are disposable local output. Edit canonical source and sync; do not fix generated output by hand.

Return native Unit values from renderers. Mutations go through workspace locking, whole-plan composition, and the journal. Use the resource-lifecycle skill for changes involving ownership, recovery, deduplication, or source resolution. Direct filesystem writes around the planner can break adoption, drift detection, and shared-path ownership.

Use existing diagnostic codes and actionable messages where they fit. Preserve restrictive semantics in default conversion. Explicit --allow-lossy may omit or broaden unsupported conditions, restrictions, models, native fields, or entire resources. Render a copy and report each loss with the resource and destination. Keep invalid input, ownership conflicts, filesystem failures, and disabled or shadowed loaders as errors.

For current native formats, consult primary documentation or source and record evidence in profile source links. A valid configuration file is not proof that a runtime loads it.

Use the testing skill to choose verification appropriate to the change. Update user-facing docs when behavior changes. Keep README and contribution copy concrete, concise, and free of em dashes or promotional filler.
