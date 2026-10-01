#!/usr/bin/env bash
set -euo pipefail
ETYMON_REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ETYMON_REPO_DIR"
npm run build
exec node testcases/run.mjs "$@"
