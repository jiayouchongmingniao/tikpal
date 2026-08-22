# Explore Provider Pool v1

## Overview

Explore runs each music provider in its own Chromium profile (separate `--user-data-dir`). A provider pool pre-warms all providers at boot so switching between them is near-instant. This document covers the pool lifecycle, the process management race-condition mitigations, and the X11 window layering contracts.

## Provider Lifecycle

```
boot → warm_provider_pool() → reset stale state → seed all providers → prewarm queue → all "ready"
                                 ↓
user opens Explore → open_provider_pool(active) → provider "active"
                                 ↓
user switches → fade old → CDP pause old audio → reveal new (CDP fast path) → new "active"
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

Each provider switch calls `first_window_for_profile()` multiple times (current window lookup, reveal). Each call iterates ALL Chromium windows via `all_chromium_windows()` → `xdotool search --class chromium`, then for every window calls `xdotool getwindowpid` and `xdotool getwindowgeometry`. With 10+ provider processes (each with a main + minimized 10×10 window), a single switch generated **300-500 xdotool X11 roundtrips**. When the X server is under load, individual `xdotool` calls can block indefinitely.

### Mitigations

| Layer | Mechanism | Effect |
| --- | --- | --- |
| `xdotool_safe()` | Wraps every `xdotool` invocation with `timeout 3` | No single call blocks > 3s |
| `cached_chromium_windows()` | Caches the window list per switch operation | `all_chromium_windows` called once per switch instead of 5-8× |
| CDP paint check skip | `provider_has_real_provider_page` proves page content via CDP | Skips unreliable X11 paint check for prewarmed providers (~3 s saved) |
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
2. Provider window (active music service)
3. Side panel (Tikpal UI)
4. Onboard keyboard (shown on demand)

### Switch Sequence

1. `begin_provider_switch_guard` — sets switching flag
2. `stop_window_guard` — stop old provider's X11 guard
3. `pause_provider_media_via_cdp` — pause old provider audio via CDP `__tikpalProviderAudioGate.setActive(false)`
4. `begin_provider_switch_transition` — fade out current provider window (0.16 s opacity ramp)
5. `invalidate_chromium_window_cache` — clear cached window list
6. Tile new provider window off-screen, lower it below kiosk
7. `reveal_resident_provider_window` — CDP fast path: if `provider_has_real_provider_page` passes, skip X11 paint check and raise window directly (~200 ms); otherwise fall back to paint check
8. `commit_visible_provider_state` — write new provider as active
9. `start_window_guard` — start X11 guard for new provider
10. `clear_provider_switch_guard` — clear switching flag

## Audio Mixing Prevention

When switching providers, the old provider's Chromium process stays alive (for fast resident switching). Without intervention, both old and new providers would play audio simultaneously through the same ALSA output device.

The guard script (`tikpal-web-mode-guard.mjs`) injects a `__tikpalProviderAudioGate` object into each provider page during prewarm. Before revealing the new provider, `pause_provider_media_via_cdp()` calls `__tikpalProviderAudioGate.setActive(false)` on the old provider via CDP WebSocket, pausing all its media elements. This is called at three points in `open_provider_pool`:

1. Before `begin_provider_switch_transition` (early pause)
2. Before `reveal_resident_provider_window` (defensive pause)
3. Before cold-launch reveal (fallback pause)

The pause is idempotent — multiple calls are safe. When the user switches back, the guard re-injects and re-activates the audio gate.

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
| `TIKPAL_WEB_MODE_RESIDENT_SWITCH_SETTLE_SECONDS` | 0.16 | Settle delay before paint check (CDP fast path skips this) |
| `TIKPAL_WEB_MODE_PROVIDER_SWITCH_FADE_SECONDS` | 0.16 | Opacity fade-out duration for old provider |
| `TIKPAL_WEB_MODE_PROVIDER_WINDOW_TIMEOUT_SECONDS` | 30 | Cold-launch window timeout |

## Files

| File | Role |
| --- | --- |
| `deploy/chromium/tikpal-web-mode.sh` | Shell script: pool lifecycle, X11 management, provider switching, CDP media pause |
| `deploy/chromium/tikpal-web-mode-guard.mjs` | Node.js guard: window focus recovery, QQ dialog dismissal, audio gate injection |
| `deploy/chromium/web-mode-extension/` | Chromium extension: link retargeting, CTA hiding, audio mirror |
| `server/index.mjs` | API: `/api/v1/web-mode/actions`, state management, proxy settings |
| `src/components/WebModeSidePanel.tsx` | Frontend: provider list, status display |
