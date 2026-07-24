#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="${TIKPAL_UPNP_CONFIG_FILE:-/etc/upmpdcli.conf}"

if [[ -r "$CONFIG_FILE" ]]; then
  label="$(
    awk -F= '
      BEGIN { IGNORECASE = 1 }
      /^[[:space:]]*friendlyname[[:space:]]*=/ {
        value = $2
        sub(/^[[:space:]]+/, "", value)
        sub(/[[:space:]]+$/, "", value)
        print value
        exit
      }
    ' "$CONFIG_FILE"
  )"
  if [[ -n "${label:-}" ]]; then
    printf '%s\n' "$label"
    exit 0
  fi
fi

hostname | sed 's/-/ /g'
