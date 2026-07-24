#!/usr/bin/env bash
set -euo pipefail

if systemctl is-active --quiet upmpdcli.service 2>/dev/null; then
  exit 0
fi

pgrep -x upmpdcli >/dev/null 2>&1
