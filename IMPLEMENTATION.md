# Etymon MVP implementation

The product name is etymon. PROJECT_PLAN.md and TECHNICAL_DETAILS.md define the product and architecture.

Acceptance implemented: `skill`, `mcp`, and `agent` providers; separate authored TOML and external lock; pinned artifact restoration; native sync and native import; safe ownership and removal; project/global scopes; persistent neo-blessed TUI and scriptable CLI; all 19 inventoried harness profiles with explicit capability gates; tests and real CLI discovery checks.

Completed architecture:

1. Core validated resource model, filesystem safety, content cache, manifests, locking.
2. Git/URL/local resolution, skills CLI integration, MCP registry resolution, agent format detection.
3. Declarative harness profiles plus native renderers/importers and capability diagnostics.
4. Transactional synchronization, drift/conflict detection, conversion, update/removal, doctor.
5. CLI, documentation, isolated integration tests, packed npm execution and Herdr smoke tests.

The current behavior, supported matrix, and MVP limits are in README.md. Verification evidence is in docs/VERIFICATION.md. The release tarball is executable through npm/npx locally; npm publication is a separate release action.

No hosted-service settings mutation, hook execution, MCP server execution, or sign-in migration is part of installation. Capability gates are part of the interface, not invented formats. Providers and adapters are independently extensible.
