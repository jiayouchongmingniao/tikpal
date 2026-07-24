#!/usr/bin/env bash
set -euo pipefail

mpc_bin="${TIKPAL_MPC_BIN:-mpc}"

current="$("$mpc_bin" --format '%title%\t%artist%\t%album%\t%file%\t%time%' current 2>/dev/null || true)"
status="$("$mpc_bin" status 2>/dev/null || true)"

if [[ -z "${current//[[:space:]]/}" ]]; then
  exit 0
fi

IFS=$'\t' read -r title artist album file duration _rest <<< "$current"

clean_text() {
  local value="${1:-}"
  value="${value//$'\r'/ }"
  value="${value//$'\n'/ }"
  value="$(printf '%s' "$value" | sed -E 's/[[:space:]]+/ /g; s/^[[:space:]]+//; s/[[:space:]]+$//')"
  case "$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')" in
    ""|"unknown"|"unknow"|"unknown artist"|"unknown album")
      return 0
      ;;
  esac
  printf '%s' "$value"
}

duration_to_ms() {
  local value
  value="$(clean_text "${1:-}")"
  [[ -n "$value" ]] || return 0
  local IFS=:
  # shellcheck disable=SC2206
  local parts=($value)
  local seconds=0
  case "${#parts[@]}" in
    1) seconds="${parts[0]}" ;;
    2) seconds=$((10#${parts[0]} * 60 + 10#${parts[1]})) ;;
    3) seconds=$((10#${parts[0]} * 3600 + 10#${parts[1]} * 60 + 10#${parts[2]})) ;;
    *) return 0 ;;
  esac
  if [[ "$seconds" =~ ^[0-9]+$ ]] && (( seconds > 0 )); then
    printf '%s' "$((seconds * 1000))"
  fi
}

status_value="stopped"
if printf '%s\n' "$status" | grep -q '^\[playing\]'; then
  status_value="playing"
elif printf '%s\n' "$status" | grep -q '^\[paused\]'; then
  status_value="paused"
fi

progress="$(
  printf '%s\n' "$status" | awk '
    /^\[(playing|paused)\]/ {
      for (i = 1; i <= NF; i += 1) {
        if ($i ~ /^[0-9]+(:[0-9][0-9]){0,2}\/[0-9]+(:[0-9][0-9]){0,2}$/) {
          print $i
          exit
        }
      }
    }
  '
)"
position_ms=""
duration_ms="$(duration_to_ms "$duration")"
if [[ -n "$progress" ]]; then
  elapsed_part="${progress%%/*}"
  total_part="${progress#*/}"
  position_ms="$(duration_to_ms "$elapsed_part")"
  if [[ -z "$duration_ms" ]]; then
    duration_ms="$(duration_to_ms "$total_part")"
  fi
fi

title="$(clean_text "$title")"
artist="$(clean_text "$artist")"
album="$(clean_text "$album")"

if [[ -z "$title" && -n "${file:-}" && ! "$file" =~ ^https?:// ]]; then
  basename="${file##*/}"
  title="$(clean_text "${basename%.*}")"
fi

if [[ -n "$title" ]]; then
  printf 'title=%s\n' "$title"
fi
if [[ -n "$artist" ]]; then
  printf 'artist=%s\n' "$artist"
fi
if [[ -n "$album" ]]; then
  printf 'album=%s\n' "$album"
fi
printf 'status=%s\n' "$status_value"
if [[ -n "$position_ms" ]]; then
  printf 'positionMs=%s\n' "$position_ms"
  printf 'positionTrusted=true\n'
  printf 'positionConfidence=trusted\n'
fi
if [[ -n "$duration_ms" ]]; then
  printf 'durationMs=%s\n' "$duration_ms"
fi
printf 'metadataSource=mpd\n'
