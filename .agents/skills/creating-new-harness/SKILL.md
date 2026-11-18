---
name: creating-new-harness
description: Use when adding or updating an Etymon destination tool, its
  supported interfaces and scopes, native import/render paths, or native loader
  verification.
---

# Adding a harness

Start by checking the current tool's primary documentation or source for each requested interface. Record supported project/user locations, read aliases, preferred output paths, precedence, conditions, required feature settings, and native loader behavior. Existing products may change paths or capabilities; copy a profile only after verifying its semantics.

## Declare verified capabilities

Add the profile in src/harnesses/profiles.ts. Rule locations and conditions belong in src/harnesses/rule-profiles.ts; alias discovery belongs in src/harnesses/discovery.ts. Keep read aliases separate from preferred writes so convert can deduplicate alternate installations without generating multiple copies.

Reuse a native dialect only if connection types, environment references, agent restrictions, and scope semantics match. Otherwise extend render/import or rule-render/rule-import. Return Unit values for the transaction planner. Native configuration edits must preserve unrelated values and supported comments.

Do not infer global support from project support. Global rules are unscoped always-on guidance in verified standalone user files. Project rule folders and nested directory guidance never become global. Prefer AGENTS.md where the tool actually loads it; a required native include or loader setting must be verified and tested, not assumed.

Treat prerequisites as diagnostics or explicit user configuration. Do not grant project trust or enable experimental execution features in a user's environment. If a semantic has no verified mapping, block default activation. Explicit --allow-lossy may adapt or omit it with a concrete warning; never mutate canonical source or invent unsupported native paths. Keep structural and ownership errors blocking. See docs/RULES.md for existing scope boundaries.

## Verify what the tool reads

Cover profile paths, malformed import, equivalent aliases, complete skill assets, all supported interfaces, standing/conditional/nested rules, project/user separation, and unsupported restrictions. Exercise sync twice and check ownership conflicts at shared paths. Update fixed-count expectations only after adding substantive coverage.

Add a numbered CLI scenario where a lifecycle is new. For available CLIs, add a loader check to testcases/native.mjs and case 9, isolating HOME and accounts. Inspect what the tool discovers without sending model messages. Extend the pinned/scheduled native workflow and clean temporary installs. For editor-only products, document format verification accurately; do not call it runtime certification.

Run init in a fixture and confirm the profile-derived ignore block ignores native files but still tracks Etymon source. Update README's tool matrix, docs/RULES.md, docs/VERIFICATION.md, and profile source links. Use the testing and resource-lifecycle skills for the shared checks.
