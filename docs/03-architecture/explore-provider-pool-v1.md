# Explore Provider Pool v1

## Overview

Explore runs each music provider in its own Chromium profile (separate `--user-data-dir`). A provider pool pre-warms all providers at boot so switching between them is near-instant. This document covers the pool lifecycle, the process management race-condition mitigations, and the X11 window layering contracts.

## Provider Lifecycle

```
boot → warm_provider_pool() → all providers "ready"
                                 ↓
user opens Explore → open_provider_pool(active) → provider "active"
                                 ↓
user switches → open_provider_pool(new) → transition → reveal → new "active"
                                 ↓
close Explore → close_web_mode → providers stay resident (warm close)
                                 ↓
reboot → close_web_mode_full → kill all profiles → stamp removed → fresh warm
```

### Boot Warm-Up

`warm_provider_pool()` launches all providers concurrently (up to `TIKPAL_WEB_MODE_PROVIDER_PREWARM_MAX_CONCURRENT_LAUNCHES=3`), waits for each to paint a real HTTPS page, then writes `pool-warm.stamp`. The stamp gates all subsequent reconcile/refill calls so they trust the boot state without re-probing.

### Reconcile

`reconcile_provider_pool()` runs after each switch completes. With the stamp present it returns immediately (`pool=trusted`); without the stamp it syncs process statuses and optionally triggers a background prewarm queue.

### Refill After Close

`schedule_provider_pool_refill_after_close()` runs when Explore closes. If the stamp exists, it syncs statuses but does NOT spawn a new `warm-pool`. The stamp is removed only by `close_web_mode_full()` (full shutdown / reboot).

## Process Management Race Condition

### Root Cause

Each provider switch calls `first_window_for_profile()` multiple times (background veil, current window lookup, reveal). Each call iterates ALL Chromium windows via `all_chromium_windows()` → `xdotool search --class chromium`, then for every window calls `xdotool getwindowpid` and `xdotool getwindowgeometry`. With 10+ provider processes (each with a main + minimized 10×10 window), a single switch generated **300-500 xdotool X11 roundtrips**. When the X server is under load, individual `xdotool` calls can block indefinitely.

### Mitigations

| Layer | Mechanism | Effect |
| --- | --- | --- |
| `xdotool_safe()` | Wraps every `xdotool` invocation with `timeout 3` | No single call blocks > 3s |
| `cached_chromium_windows()` | Caches the window list per switch operation | `all_chromium_windows` called once per switch instead of 5-8× |
| Async background veil | `ensure_background_veil` launches in background with 3s watchdog | `transition_bg_veil` capped at 3s (was 3-6s) |
| `invalidate_chromium_window_cache()` | Clears cache at switch boundaries | Fresh window list after window creation/destruction |

### Call Frequency Before/After

| Function | Before (per switch) | After |
| --- | --- | --- |
| `all_chromium_windows` | 5-8× | 1× |
| `xdotool getwindowpid` | 120-200× | 24-40× |
| `xdotool getwindowgeometry` | 120-200× | 24-40× |
| Total xdotool roundtrips | 300-500 | ~75 |

## X11 Window Layering

### Screen Layout (2560×720 physical)

| Region | Position | Size | Content |
| --- | --- | --- | --- |
| Left | 0,0 | 1920×720 | Provider content |
| Right | 1920,0 | 640×720 | Side panel |
| Stage | 2560,0 | 1920×720 | Off-screen parking / prewarm |

### Window Stack (bottom to top)

1. Main kiosk (ambient/hi-fi room)
2. Background veil (`web-mode-background.html`, dark `#05070b`)
3. Provider window (active music service)
4. Transition veil (switch animation, parked off-screen between switches)
5. Side panel (Tikpal UI)
6. Entry-stage veil (first-open animation, parked after reveal)
7. Error veil (load failure, shown on demand)
8. Onboard keyboard (shown on demand)

### Switch Sequence

1. `begin_provider_switch_guard` — sets switching flag
2. `ensure_background_veil` (async, 3s max) — dark background under provider
3. `first_window_for_profile(current)` — find current provider window
4. `reveal_background_veil_below_current_provider` — position background under current
5. `fade_profile_window_for_provider_switch` — fade out current provider
6. `launch_transition_veil` — navigate transition to new provider URL
7. `raise_transition_veil` — show transition above current
8. `reveal_resident_provider_window` — tile, paint-check, raise new provider
9. `park_transition_veil` — park transition off-screen for reuse
10. `clear_provider_switch_guard` — clear switching flag

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
| `TIKPAL_WEB_MODE_RESIDENT_SWITCH_PAINT_TIMEOUT_SECONDS` | 0.6 | Paint check timeout for resident switch |
| `TIKPAL_WEB_MODE_TRANSITION_MIN_VISIBLE_SECONDS` | 0.25 | Minimum transition visibility |
| `TIKPAL_WEB_MODE_PROVIDER_WINDOW_TIMEOUT_SECONDS` | 30 | Cold-launch window timeout |

## Files

| File | Role |
| --- | --- |
| `deploy/chromium/tikpal-web-mode.sh` | Shell script: pool lifecycle, X11 management, provider switching |
| `deploy/chromium/tikpal-web-mode-guard.mjs` | Node.js guard: window focus recovery, QQ dialog dismissal |
| `deploy/chromium/web-mode-extension/` | Chromium extension: link retargeting, CTA hiding, audio mirror |
| `server/index.mjs` | API: `/api/v1/web-mode/actions`, state management, proxy settings |
| `src/components/WebModeSidePanel.tsx` | Frontend: provider list, status display |
