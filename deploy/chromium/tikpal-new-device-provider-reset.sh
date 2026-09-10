#!/usr/bin/env bash
set -euo pipefail

# Clear browser identities from a release image before handing it to a new
# owner. Only Tikpal's provider Chromium profiles are in scope.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${TIKPAL_KIOSK_ENV_FILE:-$APP_DIR/.env.kiosk}"

usage() {
  cat <<'USAGE'
Usage: tikpal-new-device-provider-reset.sh [check|--clear-provider-profiles]

check                       Report the Tikpal provider-profile count only.
--clear-provider-profiles   Delete provider browser profiles for a new-device release.
USAGE
}

mode="${1:-check}"
case "$mode" in
  check|--clear-provider-profiles)
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

canonical_path() {
  node -e 'const path = require("node:path"); process.stdout.write(path.resolve(process.argv[1]));' "$1"
}

configured_profile_root() {
  [[ -r "$ENV_FILE" ]] || return 0
  awk '
    /^[[:space:]]*(export[[:space:]]+)?TIKPAL_WEB_MODE_PROFILE_ROOT[[:space:]]*=/ {
      value = $0
      sub(/^[^=]*=/, "", value)
      sub(/^[[:space:]]+/, "", value)
      sub(/[[:space:]]+$/, "", value)
      if ((value ~ /^".*"$/) || (value ~ /^\047.*\047$/)) {
        value = substr(value, 2, length(value) - 2)
      }
      selected = value
    }
    END { if (selected != "") print selected }
  ' "$ENV_FILE"
}

: "${HOME:?HOME must identify the kiosk service user}"
profile_root="${TIKPAL_WEB_MODE_PROFILE_ROOT:-$(configured_profile_root)}"
profile_root="${profile_root:-$HOME/.config/tikpal-web-mode}"
expected_root="$(canonical_path "$HOME/.config/tikpal-web-mode")"
profile_root="$(canonical_path "$profile_root")"

[[ "$profile_root" == "$expected_root" ]] || {
  printf 'Refusing unexpected provider profile root: %s\n' "$profile_root" >&2
  exit 1
}
[[ ! -L "$profile_root" ]] || {
  printf 'Refusing symlinked provider profile root: %s\n' "$profile_root" >&2
  exit 1
}

provider_root="$profile_root/providers"
[[ ! -L "$provider_root" ]] || {
  printf 'Refusing symlinked provider profile directory: %s\n' "$provider_root" >&2
  exit 1
}

profile_count=0
if [[ -d "$provider_root" ]]; then
  while IFS= read -r -d '' profile; do
    profile_count=$((profile_count + 1))
  done < <(find "$provider_root" -mindepth 1 -maxdepth 1 -type d -print0)
fi

printf 'profileRoot=%s\nproviderProfiles=%s\n' "$profile_root" "$profile_count"
if [[ "$mode" == "check" ]]; then
  printf 'action=none\n'
  exit 0
fi

rm -rf -- "$provider_root"
mkdir -p "$provider_root"
printf 'action=cleared-provider-profiles\n'
