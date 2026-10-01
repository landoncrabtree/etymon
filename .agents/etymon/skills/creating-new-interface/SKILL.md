---
name: creating-new-interface
description: Use when introducing a new resource interface to Etymon or
  extending the universal schema and lifecycle across existing skills, MCP,
  agents, and rules.
---

# Adding an interface

An interface is a resource kind, such as skill, mcp, agent, or rule. A provider supplies a source; a harness consumes native output. Avoid adding a new kind when a source provider or a native dialect solves the problem.

Read the closest existing interface across the full pipeline before designing a schema. Skills illustrate bundled files, agents illustrate normalized prompts with restrictions, rules illustrate activation and directory scope, and MCP illustrates inline manifest connections plus registry provenance.

## Define the canonical contract

Extend kinds and the discriminated resource, request, manifest, and lock schemas in src/core/model.ts. Decide explicitly whether authored content is inline or file-backed. MCP connections remain inline; do not restore obsolete file-backed MCP entries or add compatibility for an unreleased format.

Represent required semantics so unsupported destinations can reject them by default. Define explicit lossy fallbacks for unsupported conditions and permissions, with precise diagnostics and immutable source. Keep structural validation and ownership checks blocking. Keep secrets as environment references, not literal values written into locks or diagnostics.

## Wire both entry points

Add discovery and validation in src/providers. External sources need separate resolution and immutable restoration in src/providers/index.ts. Reuse src/providers/source.ts so local paths take precedence, explicit missing local paths stop, and invalid local content never retries remotely.

Extend resource assembly, add, convert, sync, update, remove, and doctor in src/services/environment.ts. If users can author the interface, extend the shared creation schema and transactional authoring in src/services/create.ts, then expose matching CLI flags and a neo-blessed form. Keep src/index.ts exports usable by SDK callers.

Declare each destination capability and scope in profiles. Render Unit values and import to canonical resources; do not write native files directly. Verify that profile-derived ignores include new generated output while authored source stays trackable. Keep unsupported destinations explicit.

## Establish the lifecycle

Use the testing skill for malformed inputs, local creation/editing, external lock restoration if applicable, native round trips, unsupported semantics, adoption/drift, remove, and idempotent resync. Add at least one numbered CLI workflow for a new interface and include it in CI/coverage when it needs no installed tools.

Update README examples, supported-interface/tool tables, architecture notes, and verification evidence. List current primary sources for a changing external standard. Use resource-lifecycle for ownership and deduplication details; do not invent a second lifecycle for the new kind.
