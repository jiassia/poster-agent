#!/usr/bin/env bash
# Modified 2026-11-10: Poster Agent development identity.
set -euo pipefail

skill_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
font_dir="$skill_dir/font-kit"

test -f "$font_dir/package-lock.json" || {
  echo "missing font-kit/package-lock.json" >&2
  exit 1
}

npm ci --prefix "$font_dir"
printf 'Poster Agent font kit installed in %s\n' "$font_dir/node_modules"
