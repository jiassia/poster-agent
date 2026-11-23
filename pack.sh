#!/usr/bin/env bash
# Modified 2026-11-10: package the independent Poster Agent skill only.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$root/skills/poster-agent/pack.sh" "$@"
