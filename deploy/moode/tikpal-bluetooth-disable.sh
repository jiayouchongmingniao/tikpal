#!/usr/bin/env bash
set -euo pipefail

# Disable Bluetooth audio. Safe on hosts without moodeutl (e.g. Gentoo).
if command -v moodeutl >/dev/null 2>&1; then
  moodeutl -Ro --bluetooth off >/dev/null 2>&1 || true
fi
