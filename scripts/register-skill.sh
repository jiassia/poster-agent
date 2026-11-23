#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="$root/skills/poster-agent"
registry="$HOME/.agents/skills"
link="$registry/poster-agent"
test -f "$target/SKILL.md"
if [[ -e "$link" || -L "$link" ]]; then
  if [[ -L "$link" && "$(readlink "$link")" == "$target" ]]; then
    printf 'Already registered: %s -> %s\n' "$link" "$target"
    exit 0
  fi
  printf 'Refusing to overwrite existing skill: %s\n' "$link" >&2
  exit 1
fi
mkdir -p "$registry"
ln -s "$target" "$link"
printf 'Registered: %s -> %s\n' "$link" "$target"
