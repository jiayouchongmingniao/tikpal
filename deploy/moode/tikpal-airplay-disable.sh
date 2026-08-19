#!/usr/bin/env bash
set -euo pipefail

# Disable AirPlay receiver. Safe on hosts without moodeutl (e.g. Gentoo).
if command -v moodeutl >/dev/null 2>&1; then
  moodeutl -Ro --airplay off >/dev/null 2>&1 || true
fi
