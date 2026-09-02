#!/usr/bin/env bash
set -euo pipefail

# Privileged, deliberately narrow repair surface for Explore runtime files.
# It never follows symlinks, never recursively changes a directory, and only
# terminates unregistered root-owned Guard processes that have been orphaned.

runtime_user=moode
runtime_group=moode
profile_root=/home/moode/.config/tikpal-web-mode
runtime_root=/run/tikpal
mode="${1:-check}"

[[ "$(id -u)" == "0" ]] || { printf '%s\n' 'owner repair requires root' >&2; exit 77; }
[[ "$mode" == "check" || "$mode" == "repair" ]] || { printf '%s\n' 'usage: tikpal-web-mode-owner-repair [check|repair]' >&2; exit 64; }
id -u "$runtime_user" >/dev/null 2>&1 || { printf '%s\n' "runtime user is unavailable: $runtime_user" >&2; exit 78; }

declare -a mismatches=()
declare -a repaired_paths=()
declare -a blocked_paths=()
declare -a root_guard_pids=()

track_mismatch() {
  local path="$1" item
  for item in "${mismatches[@]}"; do [[ "$item" == "$path" ]] && return; done
  mismatches+=("$path")
}

track_blocked() {
  local path="$1" item
  for item in "${blocked_paths[@]}"; do [[ "$item" == "$path" ]] && return; done
  blocked_paths+=("$path")
}

is_expected_owner() {
  [[ "$(stat -c '%U:%G' -- "$1" 2>/dev/null || true)" == "$runtime_user:$runtime_group" ]]
}

repair_regular_path() {
  local path="$1"
  [[ -e "$path" || -L "$path" ]] || return 0
  if [[ -L "$path" || ! -f "$path" ]]; then
    track_blocked "$path"
    return 0
  fi
  is_expected_owner "$path" && return 0
  track_mismatch "$path"
  if [[ "$mode" == "repair" ]]; then
    chown --no-dereference "$runtime_user:$runtime_group" -- "$path"
    repaired_paths+=("$path")
  fi
}

repair_directory_path() {
  local path="$1"
  [[ -e "$path" || -L "$path" ]] || return 0
  if [[ -L "$path" || ! -d "$path" ]]; then
    track_blocked "$path"
    return 0
  fi
  is_expected_owner "$path" && return 0
  track_mismatch "$path"
  if [[ "$mode" == "repair" ]]; then
    chown --no-dereference "$runtime_user:$runtime_group" -- "$path"
    repaired_paths+=("$path")
  fi
}

repair_lock_path() {
  local path="$1"
  [[ -e "$path" || -L "$path" ]] || return 0
  if [[ -L "$path" || ! -f "$path" ]]; then
    track_blocked "$path"
    return 0
  fi
  is_expected_owner "$path" && return 0
  track_mismatch "$path"
  if ! flock -n "$path" true >/dev/null 2>&1; then
    track_blocked "$path"
    return 0
  fi
  if [[ "$mode" == "repair" ]]; then
    chown --no-dereference "$runtime_user:$runtime_group" -- "$path"
    repaired_paths+=("$path")
  fi
}

collect_registered_guard_pids() {
  local pid_file pid
  for pid_file in "$profile_root"/provider-guard-*.pid; do
    [[ -f "$pid_file" && ! -L "$pid_file" ]] || continue
    pid="$(head -n 1 "$pid_file" 2>/dev/null || true)"
    [[ "$pid" =~ ^[1-9][0-9]*$ ]] && printf '%s\n' "$pid"
  done | sort -un
}

guard_is_orphaned_root_process() {
  local pid="$1" owner parent command_line
  [[ "$pid" =~ ^[1-9][0-9]*$ && -r "/proc/$pid/cmdline" ]] || return 1
  owner="$(ps -o user= -p "$pid" 2>/dev/null | tr -d ' ')"
  parent="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
  command_line="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
  [[ "$owner" == root && "$parent" == 1 && "$command_line" == *"node "* && "$command_line" == *"/tikpal-web-mode-guard.mjs"* ]]
}

collect_orphaned_root_guards() {
  local pid registered=""
  registered="$(collect_registered_guard_pids || true)"
  while IFS= read -r pid; do
    [[ "$pid" =~ ^[1-9][0-9]*$ ]] || continue
    guard_is_orphaned_root_process "$pid" || continue
    grep -Fx -- "$pid" <<< "$registered" >/dev/null 2>&1 && continue
    root_guard_pids+=("$pid")
    track_mismatch "root-guard:$pid"
  done < <(pgrep -f '/tikpal-web-mode-guard[.]mjs' 2>/dev/null || true)
}

repair_orphaned_root_guards() {
  local pid attempt remaining
  [[ "$mode" == "repair" ]] || return 0
  for pid in "${root_guard_pids[@]}"; do
    guard_is_orphaned_root_process "$pid" || continue
    kill -TERM "$pid"
  done
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    remaining=0
    for pid in "${root_guard_pids[@]}"; do
      if guard_is_orphaned_root_process "$pid"; then remaining=1; fi
    done
    [[ "$remaining" == 0 ]] && break
    sleep 0.1
  done
  for pid in "${root_guard_pids[@]}"; do
    if guard_is_orphaned_root_process "$pid"; then
      track_blocked "root-guard:$pid"
    else
      repaired_paths+=("root-guard:$pid")
    fi
  done
}

json_array() {
  local first=1 value
  printf '['
  for value in "$@"; do
    [[ "$first" == 1 ]] || printf ','
    first=0
    printf '"%s"' "${value//\\/\\\\}"
  done
  printf ']'
}

inspect_paths() {
  local path
  repair_directory_path "$runtime_root"
  repair_directory_path "$profile_root"
  for path in \
    "$runtime_root/web-mode-state.json" \
    "$runtime_root/guard-windows.tsv" \
    "$runtime_root/x11-helper-generation" \
    "$runtime_root/x11-helper-owner.json" \
    "$profile_root/last-physical-reveal.tsv" \
    "$profile_root/pool-warm.stamp"; do
    repair_regular_path "$path"
  done
  for path in \
    "$profile_root/web-mode.lock" \
    "$profile_root/provider-state.lock" \
    "$profile_root/window-guard.lock" \
    "$profile_root/onboard.lock" \
    "$profile_root"/provider-*.launch.lock; do
    repair_lock_path "$path"
  done
  collect_orphaned_root_guards
  repair_orphaned_root_guards
}

inspect_paths
if [[ "$mode" == "repair" ]]; then
  mismatches=()
  root_guard_pids=()
  inspect_paths
fi

ok=true
[[ "${#mismatches[@]}" == 0 && "${#blocked_paths[@]}" == 0 ]] || ok=false
message="Explore runtime ownership is healthy"
[[ "$ok" == true ]] || message="Explore runtime ownership needs attention"
if [[ "${#repaired_paths[@]}" -gt 0 && "$ok" == true ]]; then
  message="Explore runtime ownership repaired"
fi
printf '{"ok":%s,"repaired":%s,"mismatches":' "$ok" "$([[ "${#repaired_paths[@]}" -gt 0 ]] && printf true || printf false)"
json_array "${mismatches[@]}"
printf ',"repairedPaths":'
json_array "${repaired_paths[@]}"
printf ',"blockedPaths":'
json_array "${blocked_paths[@]}"
printf ',"message":"%s"}\n' "$message"
