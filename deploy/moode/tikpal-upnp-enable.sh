#!/usr/bin/env bash
set -euo pipefail

if systemctl is-active --quiet upmpdcli.service 2>/dev/null; then
  exit 0
fi

if systemctl start upmpdcli.service >/dev/null 2>&1; then
  exit 0
fi

if command -v sudo >/dev/null 2>&1 && sudo -n systemctl start upmpdcli.service >/dev/null 2>&1; then
  exit 0
fi

if command -v moodeutl >/dev/null 2>&1; then
  moodeutl -Ro --upnp on >/dev/null 2>&1 || true
fi

systemctl is-active --quiet upmpdcli.service 2>/dev/null
