#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/tikpal-moodeutl.sh"

# Safe on hosts without moodeutl (e.g. Gentoo).
tikpal_moodeutl -Ro --airplay off >/dev/null 2>&1 || true
