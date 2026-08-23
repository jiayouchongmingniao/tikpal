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

## Switch Performance (v2 — PID-based + Python CDP)

Measured on Gentoo 115, 10 providers prewarmed, X11 on integrated GPU:

| Metric | v1 (full scan + node CDP) | v2 (PID lookup + Python CDP) | Improvement |
| --- | --- | --- | --- |
| youtube_music switch | 3525 ms | **695 ms** | 5.1× |
| spotify switch | 4018 ms | **693 ms** | 5.8× |
| CDP pause | 2538 ms | ~240 ms | 10.6× |
| X11 reveal ops | 1444 ms | ~76 ms | 19× |
| open_pool_init | 1574 ms | 262 ms | 6× |

### Root Causes Eliminated

#### 1. Full Window Scan → PID-based Lookup

`first_window_for_profile()` previously fell back to `cached_chromium_windows()` which scanned ALL ~168 Chromium windows with 3+ `xdotool` calls each (500+ X11 round-trips). Replaced with:

```
pgrep -f -- "--user-data-dir=$profile"  → get main PID
xdotool search --pid $pid               → find windows for that PID (and child PIDs)
pick largest window by area
```

This reduces window lookup from ~500 X11 round-trips to ~4. The cache validation (`validate_profile_window`) still runs on cached window IDs to guard against X11 window-ID reuse.

#### 2. Node WebSocket → Python Raw Socket for CDP Pause

`pause_provider_media_via_cdp()` previously spawned **two node processes** per call:
1. `node -e` to extract `webSocketDebuggerUrl` from CDP JSON (~460 ms startup)
2. `node --experimental-websocket` to send `Runtime.evaluate` command (~460 ms startup + 800 ms timeout)

Replaced with:
- `grep` to extract `ws_url` from CDP JSON (instant, no process spawn)
- `python3 -c` with raw `socket` module implementing WebSocket framing per RFC 6455 (~50 ms startup)

The Python implementation handles the WebSocket handshake, masked frame encoding (with correct 2-byte extended length for payloads >125 bytes), and response parsing — all without external dependencies.

#### 3. Node JSON Validation → grep

`open_pool_init` previously used `node -e` to check if CDP JSON contained a real HTTPS page (~460 ms startup). Replaced with `grep -q '"url": "https://'` which is instant.

#### 4. Boot Warm-Pool Not Triggering

`close_web_mode_full()` was missing `schedule_provider_pool_refill_after_close()`. Only `close_web_mode_warm()` and `close_web_mode_from_guard()` called it. After reboot, the pool stayed cold until the first manual close/reopen cycle.

### Switch Path Timeline (CDP Fast Path, v2)

```
open_pool_init          262 ms   PID lookup + CDP JSON curl + grep validation
  └─ transition lookup  ~80 ms   first_window_for_profile (cached → fast validate)
pause_cdp              ~240 ms   Python WebSocket → Runtime.evaluate (sync)
open_pool_transition   340 ms   includes pause_cdp
reveal_cdp_skip_paint   55 ms   CDP confirms real HTTPS page
reveal_physical         75 ms   mark_window_above + raise_window (2 X11 calls)
reveal_ms              693 ms   total from open_provider_pool entry
```

## Process Management Race Condition

### Root Cause

Each provider switch calls `first_window_for_profile()` multiple times (current window lookup, reveal). Each call previously iterated ALL Chromium windows via `all_chromium_windows()` → `xdotool search --class chromium`, then for every window called `xdotool getwindowpid` and `xdotool getwindowgeometry`. With 10+ provider processes (each with a main + minimized 10×10 window), a single switch generated **300-500 xdotool X11 roundtrips**. When the X server is under load, individual `xdotool` calls can block indefinitely.

### Mitigations

| Layer | Mechanism | Effect |
| --- | --- | --- |
| `xdotool_safe()` | Wraps every `xdotool` invocation with `timeout 3` | No single call blocks > 3 s |
| `cached_chromium_windows()` | Caches the window list per switch operation | `all_chromium_windows` called once per switch instead of 5-8× |
| PID-based lookup | `pgrep` + `xdotool search --pid` for target profile only | ~4 X11 calls instead of ~500 for window discovery |
| CDP paint check skip | `provider_has_real_provider_page` proves page content via CDP | Skips unreliable X11 paint check for prewarmed providers (~3 s saved) |
| Python CDP pause | Raw socket WebSocket, no node startup | ~240 ms instead of ~2500 ms for audio pause |

## X11 Window Layering

### Screen Layout (2560×720 physical)

| Region | Position | Size | Content |
| --- | --- | --- | --- |
| Left | 0,0 | 1920×720 | Provider content |
| Right | 1920,0 | 640×720 | Side panel |
| Stage | 2560,0 | 1920×720 | Off-screen parking / prewarm |

### Window Stack (bottom to top)

1. Main kiosk (ambient/hi-fi room)
2. Provider window (active music service)
3. Side panel (Tikpal UI)
4. Onboard keyboard (shown on demand)

### Switch Sequence (CDP Fast Path — prewarmed providers)

1. `begin_provider_switch_guard` — sets switching flag
2. `stop_window_guard` — stop old provider's X11 guard
3. `pause_provider_media_via_cdp` — pause old provider audio via CDP `__tikpalProviderAudioGate.setActive(false)` using Python raw socket WebSocket
4. Skip fade animation — the new window covers the old one instantly; fade's xprop calls take 1+ s under X server load
5. `reveal_resident_provider_window` — CDP confirms real page → raise new window on top FIRST (~50 ms), then park old windows off-screen (latency invisible to user)
6. `commit_visible_provider_state` — write new provider as active
7. `start_window_guard` — start X11 guard for new provider
8. `clear_provider_switch_guard` — clear switching flag

### Switch Sequence (Legacy Paint Check Path — cold launches)

1-3. Same as CDP path (guard, stop, CDP pause)
4. `begin_provider_switch_transition` — fade out current provider window (0.10 s opacity ramp, 3 steps)
5. Tile + lower new provider window, wait for paint check (up to 3 s timeout)
6. `park_profile_windows_for_reopen` — move old windows to stage position
7. `mark_window_above` + `raise_window` — bring new provider to front
8. Commit state, start guard, clear switching flag

## Audio Mixing Prevention

When switching providers, the old provider's Chromium process stays alive (for fast resident switching). Without intervention, both old and new providers would play audio simultaneously through the same ALSA output device.

The guard script (`tikpal-web-mode-guard.mjs`) injects a `__tikpalProviderAudioGate` object into each provider page during prewarm. Before revealing the new provider, `pause_provider_media_via_cdp()` calls `__tikpalProviderAudioGate.setActive(false)` on the old provider via CDP WebSocket, pausing all its media elements. This is called at three points in `open_provider_pool`:

1. Before `begin_provider_switch_transition` (early pause)
2. Before `reveal_resident_provider_window` (defensive pause)
3. Before cold-launch reveal (fallback pause)

The pause is idempotent — multiple calls are safe. When the user switches back, the guard re-injects and re-activates the audio gate.

**CDP WebSocket implementation:** The CDP pause uses Python's `socket` module to implement the WebSocket protocol directly (RFC 6455), avoiding the ~460 ms node.js startup overhead per call. The implementation:
- Performs the HTTP Upgrade handshake with a random Sec-WebSocket-Key
- Constructs masked WebSocket frames with correct length encoding (1-byte for <126, 2-byte for 126-65535)
- Uses `select()` + `recv_exact()` for reliable response reading over localhost
- Timeout: 2 seconds (socket) + 2 seconds (select) — fast fail if CDP is unresponsive

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
