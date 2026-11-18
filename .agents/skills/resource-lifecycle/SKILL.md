---
name: resource-lifecycle
description: Use when changing Etymon source classification, locking, cache
  integrity, deduplication, output ownership, conversion, or transaction
  recovery.
---

# Resource lifecycle invariants

Read src/services/environment.ts together with src/core/transaction.ts and docs/ARCHITECTURE.md for the operation you are changing.

## Sources and locks

Use the shared source classifier. An existing path, including a bare relative path, wins over repository shorthand or an MCP registry ID. Explicit local paths such as ./missing stop when missing. Once local is chosen, validation errors remain local. URLs and Git URIs explicitly select remote sources. Expand ~/ using the workspace home, including isolated tests.

Local resources are editable source and do not become external lock dependencies. External resolution records immutable source commits, selected implementations, artifacts/digests, and provider/adapter versions. sync restores the lock; only update chooses a newer resolution. Bounded reads, digest verification, safe paths, and symlink restrictions apply to fresh and cached materialization. Do not execute repository hooks or arbitrary MCP servers during installation.

External skill repositories follow the pinned skills CLI's variant selection. Validate the checkout before staging, then match every installed file and executable bit to a source bundle. Lock the selected source path and artifact, including upstream's file exclusions. This provider policy does not weaken conflicting-bundle checks for local add or native convert.

MCP settings are inline in the manifest. Credentials use environment references. Preserve native extension fields and their originating dialect; an unknown required native field must not silently become portable. Top-level package versions do not freeze transitive dependencies or hosted services; keep claims precise.

## Deduplication and scope

A skill identity includes every bundled file and executable bit, not just SKILL.md. A rule identity includes effective directory scope and activation conditions as well as its prompt. Equal text in different scopes or conditions is not a duplicate. Native read aliases can merge provenance for equivalent resources; differing content must remain visible or block an authored collision.

Nested standing guidance must retain its project-relative base through convert and sync. destDir is a manifest placement override; only explicit --allow-lossy may widen unsupported directory scope or activation, with diagnostics and unchanged canonical source. Global rules cannot carry project scopes or conditional activation. Native compound conditions remain native in source. Default conversion requires a verified equivalent; explicit lossy projection may omit them with warnings.

## Ownership and recovery

Renderers return units; the planner composes the entire selected output and preserves owners for unselected targets. Identical shared-path output can share ownership. Incompatible bytes or changing a shared path without the other owners must block.

Unmanaged existing output needs adoption. Modified owned output needs explicit force. Stale edited output blocks rather than being deleted. Partial removal of a standing fragment must preserve other fragments and unrelated native settings.

Apply uses the workspace operation lock and a private journal, checks for concurrent changes, and atomically replaces each file. It is recoverable across files, not one filesystem-wide atomic transaction. Recovery preserves subsequent unrelated edits and reports conflicts. Authored source and native originals imported by convert do not become generated output.

Test failed plans for no partial activation, concurrent edits/recovery, idempotent sync, and safe removal. Never bypass ownership checks to make a fixture pass.
