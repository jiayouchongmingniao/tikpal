# Explore Provider Pool v1

## Overview

Explore runs each music provider in its own Chromium profile (separate `--user-data-dir`). A provider pool pre-warms all providers at boot so a resident switch does not need a new browser or network load. Near-instant switching is the intended contract, not the current field result. This document covers the pool lifecycle, the process-management mitigations, the X11 window-layering contract, and dated switch-path performance evidence.

## Provider Lifecycle

```
boot → warm_provider_pool() → reset stale state → seed all providers → prewarm queue → all "ready"
                                 ↓
user opens Explore → open_provider_pool(active) → provider "active"
                                 ↓
user switches → validate known windows → CDP pause old audio → tile/raise target → park old window → new "active"
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

Performance numbers in this document are always tied to a date and a measurement boundary. API return, shell `reveal_ms`, and physical convergence are different metrics and must not be substituted for one another.

### Historical optimization results

The following values were recorded on 2026-08-23 from the `f931e77` resident-switch shell/stage timing work on Gentoo 115 with ten provider processes prewarmed. They are retained as historical stage/log results. They do **not** describe the current physical user-visible switch:

| Metric | v1 full scan | v2 targeted lookup | v3 async pause/park experiment |
| --- | ---: | ---: | ---: |
| spotify switch | 4,018 ms | 693 ms | 600 ms |
| suno switch | 13,489 ms | ~1,100 ms | 620 ms |
| qq_music switch | 13,129 ms | ~1,086 ms | 610 ms |
| netease_music switch | ~20,000 ms | ~5,355 ms | 620 ms |
| youtube_music switch | 8,246 ms | ~754 ms | 610 ms |
| CDP pause command | 2,538 ms | ~240 ms | async submission |
| logged X11 reveal stage | 1,444 ms | ~76 ms | ~40 ms |
| logged `open_pool_init` stage | 1,574 ms | 262 ms | ~260 ms |

Those experiments introduced targeted PID lookup, a lighter CDP client, async media pause, and reduced synchronous parking. They remain useful implementation history, but their timers stopped before physical geometry, nonblank paint, old-window parking, state ownership, and lock release had all converged.

Two earlier 2026-08-18 API/script exercises are historical for the same reason: one reported resident switches in roughly `2.0–2.8 s`, and a 100-switch sequential stress run reported median `1,974 ms`, average `2,050 ms`, and maximum `2,820 ms`. Neither exercise used the 2026-08-24 real-panel/X11 convergence boundary, so neither is current physical performance or a final optimization result.

### 2026-08-24 physical baseline before the known-ID repair

That baseline came from 20 real clicks on the physical right-side panel: all ten providers in a fixed order, then the same ten a second time. HTTP and CDP were read-only evidence channels. All 20 rounds eventually converged, but they failed the performance contract:

| Boundary | min | median | p95 | max |
| --- | ---: | ---: | ---: | ---: |
| click command return | 107 ms | 110 ms | 127 ms | 133 ms |
| API accepts switch | 128 ms | 131 ms | 224 ms | 235 ms |
| target window reaches `0,0` | 16,601 ms | 18,275 ms | 34,875 ms | 36,696 ms |
| first nonblank target frame | 17,079 ms | 18,848 ms | 35,555 ms | 40,558 ms |
| geometry, state, lock, and surfaces settled | 18,321 ms | 20,219 ms | 36,832 ms | 41,622 ms |

In rounded terms, the API median was `131 ms`, target-window placement median was `18.28 s`, first nonblank frame median was `18.85 s`, and full physical stability median was `20.22 s`; full-stability p95 was `36.83 s` and maximum was `41.62 s`. The first ten settled at a 20,175 ms median and the second ten at 20,219 ms. There was no meaningful warm-cache improvement. `fast_resident=1` and real HTTPS pages were already present, so these values are not cold browser or provider-network load.

### Assumptions invalidated by the 20 rounds

- Window-ID reuse risk is not small enough to ignore. Geometry-only cache validation accepted stale provider IDs because the tolerant `xdotool` wrapper swallowed command failure.
- A `250 ms` guard cadence does not imply a `250 ms` correction. The deployed guard repeatedly used the full visible-window path and added X11 process pressure; physical correction took tens of seconds.
- Raising a resident window does not move it from the `2560,0` stage to the `0,0` provider pane. The hot path must tile the target explicitly.
- Hiding only the old window and delegating its parking to the guard is not a settled switch. Several rounds briefly had both old and new providers at `0,0`.
- The panel cannot be assumed stable from session startup or left to repeated background correction. The measured path revalidated and restacked it repeatedly; the repaired switch must place it exactly once per switch.

### 2026-08-25 implemented resident-switch contract

The known-ID and foreground-X11 repair is now implemented. Its runtime contract is:

1. `xdotool_probe()` preserves command failure for identity-sensitive operations. A cached XID is accepted only after one combined PID/geometry query proves that the window still belongs to the expected Chromium profile and has a usable area. A busy X server gets one retry of the same known ID; only a real miss enters target-profile PID-tree discovery.
2. The foreground switch resolves the target, previous provider, and Side Panel once. It stops the current guard and its child X11 command, keeps the existing panel at `1920,0 640x720`, restores the target's opacity when needed, and submits the target reveal plus previous-provider parking in one ordered `xdotool` transaction.
3. `guard-windows.tsv` is replaced atomically with the known provider, panel, and kiosk IDs. Normal guard ticks validate and use only those IDs. Full visible-window discovery is reserved for explicit invalid-ID recovery.
4. The target is not committed as visible merely because CDP has a real HTTPS page. The foreground transaction writes a physical reveal stamp, then verifies the target at `0,0 1920x720` and the previous window at `2560,0 1920x720`; a failure restores the old visible owner instead of accepting the new provider.
5. A provider switch does not close, park, restart, or replace the right Side Panel. Close is a separate lifecycle: `activeProvider` remains the physical owner until every provider/panel surface is transparent and off-screen. A failed Close keeps that active provider and publishes the physical residual as an error.

The first CDP readiness result is streamed through `grep` and passed into the reveal helper. The reveal helper therefore does not fetch the same `/json/list` a second time. This removes duplicate CDP work without making HTTPS proof a substitute for X11 geometry, a nonblank frame, or audio-gate verification.

The normal guard uses one combined X11 query for its cached provider, panel, and kiosk IDs. It checks PID/profile ownership every fourth tick, uses `250 ms` only for the first four ticks after a switch, and then settles to one-second stable ticks. This reduced the observed guard CPU from roughly `3.3%` to `0.5–0.7%`; it did not by itself make foreground switching pass the physical latency gate.

The native Helper keeps its `250 ms` switch deadline. Before mutation it verifies each surface's Chromium class, UID, PID starttime, and profile ancestry; after the checked X11 fence it re-reads all X11 state and requires the same PID, UID, and starttime. It deliberately does not repeat the already-established profile-ancestry walk in that final snapshot, so a slow `/proc` walk cannot consume the remaining transaction budget after mutation. A final identity change or deadline expiry still fails the transaction and triggers the existing fallback.

### Physical reveal timestamp and observer boundary

`tikpal-web-mode.sh` atomically replaces `last-physical-reveal.tsv` immediately after the ordered reveal transaction returns:

```text
provider<TAB>target_xid<TAB>previous_xid<TAB>absolute_epoch_ms
```

The physical acceptance script clears the previous stamp immediately before the real panel click and rejects a missing, malformed, half-written, stale, future, wrong-provider, wrong-target, or wrong-previous stamp. A valid timestamp must be at or after the round input time. The observer then independently waits for lock release, verifies target/previous/panel geometry, captures a nonblank frame, confirms API/runtime ownership, checks all real HTTPS CDP pages and audio gates, and records the final evidence. If a bounded combined geometry query returns empty or incomplete fields while the X server is busy, the observer retries that read up to three times with `150 ms` spacing. A complete-but-wrong geometry still fails immediately. This observer tolerance cannot change or excuse the physical reveal timestamp.

`rounds.tsv` intentionally separates three boundaries:

- `visible_ms`: click to the web-mode physical reveal timestamp. The resident performance ceiling remains `5,000 ms`.
- `observer_delay_ms`: extra time from that physical timestamp until the acceptance observer has confirmed geometry, lock release, and the first nonblank frame.
- `settled_elapsed_ms`: click until two stable state/audio samples complete. Strict acceptance applies the same `5,000 ms` single-round ceiling to this completion boundary; the physical stamp remains the sole source of `visible_ms`, so observer delay is never substituted for physical latency.

`switch-only` requires exactly 20 rounds and derives two passes over all ten providers from the current provider. Both `visible_ms` and `settled_elapsed_ms` must meet median `<=2,000 ms`, p95 `<=3,000 ms`, and max `<=5,000 ms`. `switch-once` requires exactly one explicit target and applies the meaningful single-sample rule—both values must be `<=5,000 ms`—while retaining the same preflight, click, timestamp, geometry, frame, state, HTTPS/CDP, audio, lock, and evidence rules. `stamp-fixtures` covers the timestamp parser and atomic-file failure cases without touching X11.

`TIKPAL_EXPLORE_ACCEPTANCE_PROVIDER_SET` may explicitly select two or more known providers for an incident-scoped run. Its active source, every requested target, residency/HTTPS checks, and cached XID checks must all be inside that set. The run writes `provider-scope.txt`, and its summary reports `scoped_gate_passed`; it deliberately keeps `gate_passed=false`, so a scoped result can never be represented as the ten-provider Phase 2 acceptance.

### 2026-08-25 field result after the repair

The field evidence distinguishes successful single-direction checks from the formal 20-round result:

| Run | Direction | Physical `visible_ms` | Observer extra delay | Result |
| --- | --- | ---: | ---: | --- |
| initial `switch-once` | QQ Music → NetEase | 3,895 ms | 5,885 ms | passed all gates |
| formal `switch-only`, round 1 | NetEase → Suno | 7,426 ms | 8,744 ms | failed `visible-over-5s`; rounds 2–20 not run |
| after CDP reuse | Suno → NetEase | 4,073 ms | 5,614 ms | passed all gates |
| after CDP reuse | NetEase → Suno | 7,471 ms | 7,672 ms | failed `visible-over-5s` |
| one-shot segment probe after guard tuning | NetEase → Suno | 7,439 ms | not retried | failed `visible-over-5s` |
| setup for the skip-only patch | Suno → NetEase | 5,662 ms | geometry observer exhausted three incomplete reads | failed `visible-over-5s` |

The formal result remains **0/1 passed, 1/1 failed, and 19/20 not executed**. It is not 20/20 acceptance. The two later one-shot/setup actions are diagnostics, not extra formal rounds; both also exceeded `5 s`. The stop-on-first-mismatch rule and the physical ceiling were not relaxed.

The before/after NetEase → Suno stage audit explains why the CDP change did not repair the physical path:

| Stage | Before CDP reuse | After CDP reuse | Delta |
| --- | ---: | ---: | ---: |
| `open_pool_init` | 2,779 ms | 2,856 ms | +77 ms |
| reveal opacity/readiness aggregate | 1,057 ms | 990 ms | -67 ms |
| ordered X11 transaction before the stamp | 2,340 ms | 2,348 ms | +8 ms |
| physical click-to-stamp | 7,426 ms | 7,471 ms | +45 ms |
| post-stamp geometry confirmation | 3,381 ms | 3,360 ms | -21 ms |
| post-reveal command tail | 2,680 ms | 1,464 ms | -1,216 ms |

The `67 ms` reveal-stage reduction is only an upper bound on the duplicate-CDP saving because the older aggregate also included opacity restoration. The large improvement is after the physical stamp, so it shortens lock/observer delay but cannot help the `5 s` gate. The ordered X11 transaction is effectively unchanged. The latest nonblank frame, final target/previous/panel geometry, runtime owner, ten real HTTPS pages, audio gates, and free lock all matched; the only failed gate was physical time.

### One-shot segment evidence and current deployed boundary

`TIKPAL_WEB_MODE_SWITCH_SEGMENT_TIMING_ONCE_PATH` enables timing for exactly one resident switch. The foreground path records detailed cache, panel, opacity, combined-X11, and stamp-write fields, emits them only after the physical reveal stamp, and then removes both the marker and its `.details` file. The marker must be created atomically immediately before the approved click; a diagnostic run is never retried automatically.

The only NetEase → Suno run with this marker took `7,439 ms` from click to physical stamp and failed the `5 s` gate. Its coarse segments were `first_cdp_ms=12`, `guard_stop_ms=71`, `target_opacity_ms=962`, and `combined_x11_ms=2292`. The initial `cached_xid_ms=2788` and `panel_retile_ms=811` are contaminated upper bounds from the already-busy X11 path, so the no-retry rule deliberately left them unconfirmed.

The following Suno → NetEase setup also failed at `5,662 ms`, even though its final target, previous, panel, HTTPS, audio, state, and lock were correct. Its stage boundaries were:

| Stage | Duration |
| --- | ---: |
| click → runtime start | 265 ms |
| runtime start → `open_pool_init` | 2,043 ms |
| init → transition | 838 ms |
| transition → reveal | 225 ms |
| reveal → CDP ready | 976 ms |
| CDP ready → physical stamp | 1,315 ms |
| physical stamp → runtime geometry confirmation | 1,792 ms |
| geometry confirmation → command return | 1,432 ms |

The geometry observer timed out on three incomplete combined queries during that setup. This was a secondary observer failure caused by tail-end X11 congestion; it does not overturn the `5,662 ms` physical failure.

Two skip-only foreground changes were then implemented and deployed on Gentoo 115:

- The existing Side Panel geometry probe is reused. Exact `1920,0 640x720` skips `tile_window_fast`; a mismatch, incomplete result, or read failure still executes the original repair. No second geometry query was added.
- The existing target-opacity read is reused. An absent property or full value (`4294967295`/`0xffffffff`) skips `xprop -set`; a non-full, malformed, or unreadable result still executes the original restore. No second opacity query was added.

The candidates passed isolated remote staging and were atomically deployed without restarting any service, provider Chromium, or guard. The post-deploy read-only state had NetEase active at `0,0 1920x720`, Suno parked at `2560,0 1920x720`, the Panel at `1920,0 640x720`, full opacity on all three, ten real HTTPS CDP pages, a free lock, and no timing marker. No provider click has occurred with the deployed skip-only version, so there is no performance claim yet.

The next authorized measurement boundary is exactly one NetEase → Suno click with an atomically created one-shot marker. Stop on any mismatch or physical time over `5,000 ms`; do not retry, run the reverse direction, or start the formal 20 rounds. If it still fails, use the new `.details` evidence to choose between cached-XID validation, PID/profile parsing, and the combined X11 mutation.

These limits apply only to already-prewarmed resident switches. They do not cover first Explore entry, cold launch, or Close. The historical `600–620 ms` result is context only and is not a current acceptance baseline.

`deploy/chromium/tikpal-explore-switch-acceptance.sh` posts API actions and is therefore an interface diagnostic only. Physical performance claims require real panel clicks plus X11 geometry, nonblank-frame, state, lock, and read-only CDP evidence.

## Audio Gate / Media Pause

Explore providers share a single ALSA output. Without explicit pausing, switching providers would play audio simultaneously through the same ALSA output device.

The guard script (`tikpal-web-mode-guard.mjs`) injects a `__tikpalProviderAudioGate` object into each provider page during prewarm. Before revealing the new provider, `pause_provider_media_via_cdp()` calls `__tikpalProviderAudioGate.setActive(false)` on the old provider via CDP WebSocket, pausing all its media elements.

The current resident path submits this pause in a background subshell. That removes the CDP response from the foreground timing, but does not by itself prove a fast or correct physical switch. Acceptance still captures every provider's audio-gate state and stops on a real mismatch.

**CDP WebSocket implementation:** The CDP pause uses Python's `socket` module to implement the WebSocket protocol directly (RFC 6455), avoiding the ~460 ms node.js startup overhead per call. The implementation:
- Performs the HTTP Upgrade handshake with a random Sec-WebSocket-Key
- Constructs masked WebSocket frames with correct length encoding (1-byte for <126, 2-byte for 126-65535)
- Uses `select()` + `recv_exact()` for reliable response reading over localhost
- Timeout: 1 second (socket) + 1 second (select) — fast fail if CDP is unresponsive

## Frontend Optimistic UI

The side panel (`WebModeSidePanel.tsx`) uses optimistic state updates to acknowledge a click immediately. This feedback does not mean the physical provider window has switched:

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
| `TIKPAL_WEB_MODE_RESIDENT_SWITCH_PAINT_TIMEOUT_SECONDS` | 0.6 | Paint check timeout before a resident success stamp, including the Helper path |
| `TIKPAL_WEB_MODE_RESIDENT_SWITCH_SETTLE_SECONDS` | 0.08 | Settle delay before the legacy-path paint check |
| `TIKPAL_WEB_MODE_RESIDENT_SWITCH_PAINT_POLL_SECONDS` | 0.05 | Paint check poll interval |
| `TIKPAL_WEB_MODE_PROVIDER_SWITCH_FADE_SECONDS` | 0.10 | Opacity fade-out duration for old provider (legacy path only; CDP fast path skips fade) |
| `TIKPAL_WEB_MODE_PROVIDER_WINDOW_TIMEOUT_SECONDS` | 30 | Cold-launch window timeout |
| `TIKPAL_WEB_MODE_X11_SEARCH_TIMEOUT_SECONDS` | 0.35 | xdotool search timeout (prevents X11 contention from cascading) |

The paint gate samples the target X11 window itself. It rejects a flat white or gray first frame by contrast range, but accepts a sparse rendered state such as a provider error or consent page; a whole-frame variance requirement would otherwise misclassify that visible content as blank.

## Files

| File | Role |
| --- | --- |
| `deploy/chromium/tikpal-web-mode.sh` | Shell script: pool lifecycle, X11 management, provider switching, CDP media pause, targeted window lookup with explicit recovery, root user detection |
| `deploy/chromium/tikpal-web-mode-guard.mjs` | Node.js guard: window focus recovery, QQ dialog dismissal, audio gate injection |
| `deploy/chromium/tikpal-explore-physical-acceptance.sh` | Real-click physical acceptance: stamp fixtures, strict one-round diagnosis, formal 20-round switching, geometry/frame/state/CDP/audio/lock evidence |
| `deploy/chromium/web-mode-extension/` | Chromium extension: link retargeting, CTA hiding, audio mirror |
| `server/index.mjs` | API: `/api/v1/web-mode/actions`, state management, proxy settings, `activationPhase` |
| `src/components/WebModeSidePanel.tsx` | Frontend: provider list, optimistic UI, activation phase tracking, label crossfade |
| `src/styles.css` | Styles: disabled:not(.is-active) fix, transitions, active state transform |
| `src/types.ts` | Types: `WebModeState.activationPhase` |
| `scripts/provider-switch-physical-bench.mjs` | Headless Playwright side-panel/API timing diagnostic; not physical acceptance |
