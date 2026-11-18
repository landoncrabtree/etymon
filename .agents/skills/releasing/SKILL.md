---
name: releasing
description: Use when preparing an Etymon npm tarball, reviewing release version
  selection, testing distribution, or publishing a user-authorized release.
---

# Building and publishing Etymon

The release entry points are scripts/npm_build.sh and scripts/npm_publish, backed by scripts/release.mjs. Keep build and publication separate. Publication requires authorization in the active task; loading this skill does not supply it.

Build with scripts/npm_build.sh [patch|minor|major]. Patch is the default. The script reads npm's full version list, selects the highest stable published version, calculates the requested next version, and keeps a higher pending local version when appropriate. Rebuilding an unpublished version must not advance it again. Do not guess the next version from a stale package.json or manually bump before querying npm.

The build runs npm run check before changing package versions, updates package.json and package-lock.json together without creating a Git tag, and packs the checked production files into etymon-<version>.tgz. Registry errors and failed checks leave versions unchanged. The release mutex is .npm-release.lock; after a crash remove it only after confirming no release process is active.

Use npm run smoke for installed npm/npx behavior in a fresh temporary project. Inspect the archive's name/version and intended files. Generated tarballs stay ignored. Document checks and material limitations; do not present config-only native checks as model behavior testing.

scripts/npm_publish [tarball.tgz] --dry-run previews the selected archive. It validates package/archive metadata and rejects already-published versions. It never builds or bumps. When publication is requested, publish that reviewed archive with scripts/npm_publish [tarball.tgz]. The npm account supplies its own authentication or interactive verification; do not copy credentials into source, manifests, or logs.

Release tests in tests/release.test.ts stub npm in an isolated temporary PATH. They must never reach real publication. Update docs/VERIFICATION.md after relevant checks and use conventional commit messages with honest agent attribution for assisted changes.
