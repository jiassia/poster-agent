#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$root/.runtime/bin:$PATH"
skill="$root/skills/poster-agent"
case "${1:-help}" in
  app) shift; node "$root/app/launch.mjs" "$@" ;;
  setup)
    npm ci --prefix "$skill/scripts"
    "$skill/scripts/install-font-kit.sh"
    "$skill/scripts/doctor.sh"
    ;;
  doctor) "$skill/scripts/doctor.sh" ;;
  image) shift; node "$skill/scripts/image.mjs" "$@" ;;
  image-native)
    shift
    # Explicit official-only profile. Never reuse a relay key from the environment.
    unset OPENAI_API_KEY
    export OPENAI_BASE_URL="https://api.openai.com/v1"
    export OPENAI_API_KEY_FILE="${POSTER_AGENT_OPENAI_KEY_FILE:-$HOME/.config/poster-agent/openai-native.api-key}"
    node "$skill/scripts/image.mjs" "$@"
    ;;
  commerce) shift; node "$skill/scripts/commerce.mjs" "$@" ;;
  project) shift; node "$skill/scripts/project.mjs" "$@" ;;
  serve) shift; node "$skill/scripts/serve-project.mjs" "$@" ;;
  providers) node "$skill/scripts/image-provider.mjs" ;;
  pack) shift; "$skill/pack.sh" "$@" ;;
  register) "$root/scripts/register-skill.sh" ;;
  *) printf '%s\n' 'Usage: ./dev.sh {app|setup|doctor|commerce {inspect|import|audit|deliver}|image COMMAND PROJECT REQUEST|image-native COMMAND PROJECT REQUEST|project COMMAND PROJECT|serve PROJECT|providers|pack [archive]|register}' ;;
esac
