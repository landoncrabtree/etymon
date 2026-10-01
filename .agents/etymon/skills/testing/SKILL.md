---
name: testing
description: Use when adding or changing Etymon tests, reproducing a resource
  lifecycle bug, checking native tool discovery, or measuring code coverage.
---

# Testing Etymon

## Choose the right location

Use tests/*.test.ts for focused service, parser, schema, transaction, or release behavior. Use testcases/<number> for workflows that need the actual CLI, generated files, Git resets, or a terminal. Each numbered folder is an editable starting state with scenario.json; handlers live in testcases/scenarios.mjs. Add an entry to testcases/README.md.

The scenario runner copies fixtures to a temporary Git repository, commits the starting state, and isolates HOME, configuration, and caches. A folder needs a real starting file, since an empty baseline cannot be committed. testcases/.gitignore deliberately keeps native fixture files trackable despite the root ignore block. Never reset the working repository to test restoration.

Assert externally meaningful behavior: manifest and lock contents, exact native settings, preserved unrelated content, diagnostics, absence of partial writes, and a second sync with no changes. Test blocked conversions as well as successful ones. For source changes, prove offline restoration and that only update advances a locked resolution. Avoid tests that simply restate the implementation.

## Commands

- npm test runs Vitest. For a focused file: npm test -- tests/rules.test.ts.
- npm run check runs formatting, strict types, unit tests, and the production build.
- ./test_harness.sh 2 7 selects lifecycle scenarios; --keep and --report-dir help inspect failures.
- npm run smoke packs the real executable and exercises npm/npx in a clean project.
- npm run test:coverage measures unit tests plus built-CLI scenarios with all source files included.

The enforced coverage floors are 70% lines/statements, 65% branches, and 80% functions. Keep coverage at least at the measured baseline in docs/VERIFICATION.md when practical; add meaningful missing cases rather than lowering gates or excluding files. Add new lifecycle numbers to scripts/coverage-run.mjs and .github/workflows/ci.yml when they do not require installed native tools.

## Native and terminal checks

Case 9 checks installed native loaders through testcases/native.mjs. Pass --native codex,opencode,copilot,claude or an installed subset. Gemini, Pi, and Kilo have additional checks. These inspect resources without model calls or inherited accounts. Do not add provider credentials just to test discovery. Native trust, when necessary, belongs only in the isolated test environment.

Use testcases/tui.py for actual POSIX terminal interaction, including validation, cancellation, transport/activation changes, and clean exit. Drain PTY output while sending keys to avoid blocked redraws. A mock widget test cannot establish keyboard behavior.

The native workflow installs pinned CLIs into a temporary prefix and cleans it afterward; scheduled/manual runs also exercise latest versions. Editor adapters have format and lifecycle tests, not runtime certification. State which tools and interfaces were actually inspected when updating docs/VERIFICATION.md.

Run targeted checks while iterating, then the required checks once. Broaden or repeat only when new changes or failures justify it.
