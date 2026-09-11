#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Load only the actual step runner; no launcher or X11 mutations in this test.
source <(sed -n '/^initial_entry_step_run() {/,/^x11_trace_read_active_provider() {/p' "$ROOT_DIR/deploy/chromium/tikpal-web-mode.sh" | sed '$d')
initial_entry_trace_enabled() { return 1; }
initial_entry_window_snapshot() { echo 'unexpected diagnostic snapshot' >&2; return 99; }
mktemp() { echo 'unexpected diagnostic tempfile' >&2; return 99; }
log_open_stage() { :; }
TIKPAL_INITIAL_ENTRY_MUTATION_STARTED=0
called=0
operation() { called=$((called + 1)); }
initial_entry_step_run 1 suno resident_initial_entry target_map 12 map visible 1 operation
[[ "$called" == 1 && "$TIKPAL_INITIAL_ENTRY_MUTATION_STARTED" == 1 ]]
operation() { return 27; }
if initial_entry_step_run 2 suno resident_initial_entry final_surface_snapshot 12 verify visible 0 operation; then
  echo 'verification failure was swallowed' >&2; exit 1
else
  [[ "$?" == 27 ]]
fi
[[ "$TIKPAL_INITIAL_ENTRY_FAILED_STEP" == final_surface_snapshot && "$TIKPAL_INITIAL_ENTRY_FAILED_STATUS" == 27 ]]
echo 'Explore entry fast path passed: no diagnostic I/O, operations and failures preserved'
# Cold entry must pass the same paint-check arguments through the traced path.
source <(sed -n '/^initial_entry_wait_for_entry_paint_optional() {/,/^initial_entry_surface_plan() {/p' "$ROOT_DIR/deploy/chromium/tikpal-web-mode.sh" | sed '$d')
wait_for_entry_provider_paint() { [[ "$#" == 3 && "$1" == 9239 && "$2" == deezer && "$3" == 42 ]]; }
[[ "$(initial_entry_wait_for_entry_paint_optional 9239 deezer 42)" == ready ]]
# A function name inside [[ ]] is a nonempty string, not a function invocation.
if grep -E '\[\[[^]]*initial_entry_trace_enabled[^]]*\]\]' "$ROOT_DIR/deploy/chromium/tikpal-web-mode.sh"; then
  echo 'trace predicate is treated as a string' >&2; exit 1
fi
