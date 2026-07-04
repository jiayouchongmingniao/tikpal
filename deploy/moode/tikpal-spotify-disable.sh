#!/usr/bin/env bash
set -euo pipefail

moodeutl -Ro --spotify off >/dev/null 2>&1 || true

command -v pgrep >/dev/null 2>&1 || exit 0
mapfile -t pids < <(
  pgrep -x librespot 2>/dev/null || true
  pgrep -x go-librespot 2>/dev/null || true
)
if ((${#pids[@]} > 0)); then
  sudo kill -9 "${pids[@]}" >/dev/null 2>&1 || true
fi
