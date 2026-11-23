#!/usr/bin/env bash
# Modified 2026-11-10: independent Poster Agent development identity.
set -euo pipefail

skill_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
parent_dir="$(cd "$skill_dir/.." && pwd)"
out="${1:-${TMPDIR:-/tmp}/poster-agent-skill.tar.gz}"

mkdir -p "$(dirname "$out")"
tar \
  --exclude='poster-agent/scripts/node_modules' \
  --exclude='poster-agent/font-kit/node_modules' \
  --exclude='poster-agent/._*' \
  --exclude='poster-agent/*/._*' \
  --exclude='poster-agent/*/*/._*' \
  --exclude='poster-agent/.DS_Store' \
  -czf "$out" \
  -C "$parent_dir" \
  poster-agent

echo "$out"
