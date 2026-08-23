# Explore Provider Pool v1

## Overview

Explore runs each music provider in its own Chromium profile (separate `--user-data-dir`). A provider pool pre-warms all providers at boot so switching between them is near-instant. This document covers the pool lifecycle, the process management race-condition mitigations, the X11 window layering contracts, and the switch-path performance optimizations.

## Provider Lifecycle

```
boot → warm_provider_pool() → reset stale state → seed all providers → prewarm queue → all "ready"
                                 ↓
user opens Explore → open_provider_pool(active) → provider "active"
                                 ↓
user switches → CDP pause old audio → raise new window on top (CDP fast path) → park old windows → new "active"
                                 ↓
close Explore → close_web_mode → providers stay resident (warm close)
                                 ↓
reboot → close_web_mode_full → kill all profiles → stamp removed → schedule_provider_pool_refill_after_close → fresh warm
```

### Boot Warm-Up

`warm_provider_pool()` launches all providers concurrently (up to `TIKPAL_WEB_MODE_PROVIDER_PREWARM_MAX_CONCURRENT_LAUNCHES=3`), waits for each to paint a real HTTPS page, then writes `pool-warm.stamp`. The stamp gates all subsequent reconcile/refill calls so they trust the boot state without re-probing.

**Boot trigger:** `close_web_mode_full()` (called by `tikpal-web-mode.sh close-full` at kiosk startup) now calls `schedule_provider_pool_refill_after_close()` to ensure the pool warms up even on a fresh boot. Previously this was only triggered from the warm-close and guard-close paths, leaving the pool cold after reboot.

**Stale lock cleanup:** `close_web_mode_full()` also cleans up `provider-*.launch.lock` files left by a previous boot's prewarm queue, preventing `flock` from blocking new launches.

### Reconcile

`reconcile_provider_pool()` runs after each switch completes. With the stamp present it returns immediately (`pool=trusted`); without the stamp it syncs process statuses and optionally triggers a background prewarm queue.

### Refill After Close

`schedule_provider_pool_refill_after_close()` runs when Explore closes and now also runs at boot via `close_web_mode_full()`. If the stamp exists, it syncs statuses but does NOT spawn a new `warm-pool`. The stamp is removed only by `close_web_mode_full()` (full shutdown / reboot).

## Switch Performance

### Performance Evolution

Measured on Gentoo 115, 10 providers prewarmed, X11 on integrated GPU:

| Metric | v1 (full scan + node CDP) | v2 (PID lookup + Python CDP) | v3 (fire-and-forget + no park block) |
| --- | --- | --- | --- |
| spotify switch | 4018 ms | 693 ms | **600 ms** |
| suno switch | 13489 ms | ~1100 ms | **620 ms** |
| qq_music switch | 13129 ms | ~1086 ms | **610 ms** |
| netease_music switch | ~20000 ms | ~5355 ms | **620 ms** |
| youtube_music switch | 8246 ms | ~754 ms | **610 ms** |
| CDP pause | 2538 ms | ~240 ms | **0 ms** (async) |
| X11 reveal ops | 1444 ms | ~76 ms | **~40 ms** |
| open_pool_init | 1574 ms | 262 ms | **~260 ms** |
| panel stability | ✓ | ✓ (with fix) | **✓** |

### Root Causes Eliminated

#### 1. Full Window Scan → PID-based Lookup (v2)

`first_window_for_profile()` previously fell back to `cached_chromium_windows()` which scanned ALL ~24 Chromium windows with 3+ `xdotool` calls each (72+ X11 round-trips). Replaced with:

```
pgrep -f -- "--user-data-dir=$profile"  → get main PID
xdotool search --pid $pid               → find windows for that PID (and child PIDs)
pick largest window by area
```

This reduces window lookup from ~72 X11 round-trips to ~4. The fallback full scan remains for when PID lookup fails (e.g. process not yet started).

**Fast cache validation:** `validate_profile_window_fast()` replaces `validate_profile_window()` in the cache-hit path. It checks only `xdotool getwindowgeometry` (1 X11 call) instead of `getwindowpid` + `/proc` + `getwindowgeometry` (3 calls). Window-ID reuse risk is minimal — the guard loop corrects within 250 ms.

#### 2. Node WebSocket → Python Raw Socket for CDP Pause (v2)

`pause_provider_media_via_cdp()` previously spawned **two node processes** per call:
1. `node -e` to extract `webSocketDebuggerUrl` from CDP JSON (~460 ms startup)
2. `node --experimental-websocket` to send `Runtime.evaluate` command (~460 ms startup + 800 ms timeout)

Replaced with:
- `grep` to extract `ws_url` from CDP JSON (instant, no process spawn)
- `python3 -c` with raw `socket` module implementing WebSocket framing per RFC 6455 (~50 ms startup)

The Python implementation handles the WebSocket handshake, masked frame encoding (with correct 2-byte extended length for payloads >125 bytes), and response parsing — all without external dependencies.

**Socket timeout:** `socket.create_connection(timeout=1)` + `select(..., 1.0)` = worst case 2 s. This is a deliberate fail-fast: localhost CDP should respond within 100-500 ms; if it takes >1 s, the server is likely hung and waiting longer only blocks the UI.

#### 3. Node JSON Validation → grep (v2)

`open_pool_init` previously used `node -e` to check if CDP JSON contained a real HTTPS page (~460 ms startup). Replaced with `grep -q '"url": "https://'` which is instant.

#### 4. CDP Pause Fire-and-Forget (v3)

The CDP pause was the single largest remaining bottleneck: 2-3 s blocking per switch. The pause sends `__tikpalProviderAudioGate.setActive(false)` via CDP WebSocket to the old provider. When youtube_music was the old provider, its CDP server consistently took ~2 s to respond.

**Fix:** Wrap the pause in a background subshell:

```bash
( pause_provider_media_via_cdp "$port" "$json" || true ) &
```

**Why this is safe:**
- The transition veil covers the old provider — the user cannot see it
- The 2000 ms audio crossfade naturally transitions audio overlap
- By the time the new window is raised (~300 ms later), the pause has either completed or will complete within the crossfade window
- If the pause fails entirely, the worst case is a brief audio overlap (1-2 s), not a UI freeze

#### 5. Park Profile Windows: Sync Opacity Only (v3)

`park_profile_windows_for_reopen()` moves the old provider's windows off-screen (tile to stage position, clear above, lower). This was called synchronously in the reveal path, blocking `reveal_ms` for 1-8 s when X11 was busy.

**Fix:** In the CDP fast path, only set the old window's opacity to 0 synchronously (~5 ms). The tile/clear/lower operations are unnecessary because:
- The new window is already raised on top — the user cannot see the old window
- The guard loop (every 250 ms) will naturally re-tile all windows, pushing old ones off-screen

```bash
if [[ -n "$previous_window" ]]; then
  set_window_opacity "$previous_window" 0 >/dev/null 2>&1 || true
fi
```

The `park_profile_windows_for_reopen()` function still exists for the non-CDP slow path and for explicit park calls (e.g. `park_provider_windows_for_reopen` during close).

#### 6. Park Fallback Full Scan Removed (v3)

`park_profile_windows_for_reopen()` had a fallback that scanned ALL chromium windows when `first_window_for_profile` couldn't find the target. This caused massive X11 contention when multiple background parks ran simultaneously.

**Fix:** When no window is found (old provider process already dead), return immediately. There's nothing to park.

#### 7. `ensure_side_panel` Process Check (v3)

`ensure_side_panel()` was called on every switch in the fast-resident path. It clears the window cache, runs `first_window_for_profile` (PID lookup + validation), and potentially launches a new Chromium instance. This added ~800 ms per switch.

**Fix:** Check if the side-panel Chromium process is already running via `pgrep`:

```bash
if ! pgrep -f -- "--user-data-dir=$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel" >/dev/null 2>&1; then
  ensure_side_panel "$provider" 0 || true
fi
```

The side-panel process persists across provider switches — it only needs to be launched once per Explore session.

#### 8. Stale Window Cache Fix for Side Panel (v3)

`ensure_side_panel()` uses `first_window_for_profile()` to check if the panel exists. With the fast cache validation (`validate_profile_window_fast`), a stale cached window ID could be reused by a different window (e.g. the kiosk window), causing `ensure_side_panel` to think the panel exists when it doesn't.

**Fix:** `ensure_side_panel()` now clears the side-panel's window cache file before lookup, and validates the result with full `validate_profile_window()` (profile match, not just geometry check).

#### 9. Boot Warm-Pool Not Triggering (v2)

`close_web_mode_full()` was missing `schedule_provider_pool_refill_after_close()`. Only `close_web_mode_warm()` and `close_web_mode_from_guard()` called it. After reboot, the pool stayed cold until the first manual close/reopen cycle.

### Switch Path Timeline (CDP Fast Path, v3)

```
open_pool_init          ~260 ms   PID lookup + CDP JSON curl + grep validation
  └─ transition lookup  ~80 ms   first_window_for_profile (cached → fast validate)
switching block         ~17 ms   stop_window_guard + begin_provider_switch_guard
CDP pause               ~0 ms    fire-and-forget background subshell
ensure_side_panel       ~0 ms    pgrep check → process already running → skip
reveal_cdp_skip_paint   ~20 ms   provider_has_real_provider_page via grep
reveal_mark_above       ~10 ms   wmctrl -i -r -b add,above
reveal_physical         ~40 ms   mark + raise + opacity sync
post-reveal             ~30 ms   invalidate cache + commit state + start guard
────────────────────────────────
total reveal_ms         ~600 ms
```

## Audio Gate / Media Pause

Explore providers share a single ALSA output. Without explicit pausing, switching providers would play audio simultaneously through the same ALSA output device.

The guard script (`tikpal-web-mode-guard.mjs`) injects a `__tikpalProviderAudioGate` object into each provider page during prewarm. Before revealing the new provider, `pause_provider_media_via_cdp()` calls `__tikpalProviderAudioGate.setActive(false)` on the old provider via CDP WebSocket, pausing all its media elements.

In v3, this pause is **fire-and-forget** (background subshell). The transition veil covers the old page, and the 2000 ms audio crossfade masks any brief overlap. If the CDP server is slow (e.g. youtube_music taking ~2 s), the UI is no longer blocked — it proceeds immediately to reveal the new provider.

**CDP WebSocket implementation:** The CDP pause uses Python's `socket` module to implement the WebSocket protocol directly (RFC 6455), avoiding the ~460 ms node.js startup overhead per call. The implementation:
- Performs the HTTP Upgrade handshake with a random Sec-WebSocket-Key
- Constructs masked WebSocket frames with correct length encoding (1-byte for <126, 2-byte for 126-65535)
- Uses `select()` + `recv_exact()` for reliable response reading over localhost
- Timeout: 1 second (socket) + 1 second (select) — fast fail if CDP is unresponsive

## Frontend Optimistic UI

The side panel (`WebModeSidePanel.tsx`) uses optimistic state updates to eliminate perceived latency during provider switches:

- **optimisticProviderRef:** On click, immediately marks the target provider as `is-active` via a ref, before the API response arrives. This overrides the `disabled` state's `opacity: 0.5` CSS rule.
- **activationPhase:** Server-derived state (`"pending"` | `"ready"` | `null`) tracks whether a switch is in flight. The frontend uses this to delay clearing the pending state until the server confirms activation.
- **Label crossfade:** Provider name changes use a 120 ms opacity transition to avoid jarring text swaps.
- **CSS fix:** `.web-mode-provider:disabled:not(.is-active)` prevents the disabled opacity from hiding the optimistic active state.

## Root User SSH Access

When running `tikpal-web-mode.sh` as root via SSH, `$HOME=/root` causes all profile paths to resolve under `/root/.config/` instead of the kiosk user's home. The script detects this at startup:

1. Checks `id -u == 0` and `$HOME` not under `/home/`
2. Finds the kiosk user from running Chromium `--user-data-dir` processes
3. Falls back to the first `/home/*/.config/tikpal-web-mode` directory
4. Re-exports `$HOME` so all subsequent path defaults resolve correctly

This allows `bash tikpal-web-mode.sh open spotify` to work directly from an SSH root session without `su - moode -c '...'`.

## Chromium Flags

`chromium_base_args()` applies to all Explore Chromium processes:

| Flag | Purpose |
| --- | --- |
| `--force-dark-mode` | Dark UI theme |
| `--enable-features=WebUIDarkMode` | Dark mode for internal pages |
| `--default-background-color=000000` | Black background (no white flash) |
| `--disable-features=StatusBubble` | Hide bottom-left link hover URL bar |

## Key Environment Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `TIKPAL_WEB_MODE_PROVIDER_PREWARM_MAX_CONCURRENT_LAUNCHES` | 3 | Parallel warm-up processes |
| `TIKPAL_WEB_MODE_RESIDENT_SWITCH_PAINT_TIMEOUT_SECONDS` | 0.6 | Paint check timeout for cold-launch resident switch (CDP fast path skips this) |
| `TIKPAL_WEB_MODE_RESIDENT_SWITCH_SETTLE_SECONDS` | 0.08 | Settle delay before paint check (CDP fast path skips this) |
| `TIKPAL_WEB_MODE_RESIDENT_SWITCH_PAINT_POLL_SECONDS` | 0.05 | Paint check poll interval |
| `TIKPAL_WEB_MODE_PROVIDER_SWITCH_FADE_SECONDS` | 0.10 | Opacity fade-out duration for old provider (legacy path only; CDP fast path skips fade) |
| `TIKPAL_WEB_MODE_PROVIDER_WINDOW_TIMEOUT_SECONDS` | 30 | Cold-launch window timeout |
| `TIKPAL_WEB_MODE_X11_SEARCH_TIMEOUT_SECONDS` | 0.35 | xdotool search timeout (prevents X11 contention from cascading) |

## Files

| File | Role |
| --- | --- |
| `deploy/chromium/tikpal-web-mode.sh` | Shell script: pool lifecycle, X11 management, provider switching, CDP media pause (Python WebSocket), PID-based window lookup, root user detection |
| `deploy/chromium/tikpal-web-mode-guard.mjs` | Node.js guard: window focus recovery, QQ dialog dismissal, audio gate injection |
| `deploy/chromium/web-mode-extension/` | Chromium extension: link retargeting, CTA hiding, audio mirror |
| `server/index.mjs` | API: `/api/v1/web-mode/actions`, state management, proxy settings, `activationPhase` |
| `src/components/WebModeSidePanel.tsx` | Frontend: provider list, optimistic UI, activation phase tracking, label crossfade |
| `src/styles.css` | Styles: disabled:not(.is-active) fix, transitions, active state transform |
| `src/types.ts` | Types: `WebModeState.activationPhase` |
| `scripts/provider-switch-physical-bench.mjs` | Playwright-based physical timing benchmark for provider switches |
