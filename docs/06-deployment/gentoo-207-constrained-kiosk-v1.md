# Gentoo 207 Constrained Kiosk v1

## Purpose

`192.168.10.207` uses a lower-performance Radeon/EVDI path than the primary
Gentoo reference host. This profile keeps the 2560 x 720 kiosk usable without
discarding resident Provider profiles or their login state. It is a
machine-local runtime profile: keep `.env`, `.env.kiosk`, and `.tikpal/*` out
of Git.

## 207 runtime profile

The production `.env.kiosk` selects the constrained renderer, a TURZX/EVDI
half-refresh display mode, CDP lifecycle freezing, and the kiosk-only CPU
governor:

```conf
TIKPAL_KIOSK_XRANDR_OUTPUT=DVI-I-1-1
TIKPAL_KIOSK_XRANDR_MODE=2560x720
TIKPAL_KIOSK_XRANDR_RATE=29.95
TIKPAL_KIOSK_APPLY_PHYSICAL_DISPLAY_MODE=1
TIKPAL_RENDER_PROFILE=constrained
TIKPAL_WEB_MODE_CDP_SESSION_MANAGER=1
TIKPAL_WEB_MODE_PROVIDER_BACKGROUND_FREEZE_ENABLED=1
TIKPAL_WEB_MODE_PROVIDER_BACKGROUND_FREEZE_DELAY_SECONDS=8
TIKPAL_KIOSK_CPU_GOVERNOR=performance
```

The physical-display soft-kick runs after X starts and before Chromium. It is
best-effort: a failed kick is logged once and never creates a restart loop.
The desired RandR result is `2560x720` with `29.95*`; the adjacent `59.90`
mode may remain advertised but must not be active.

`tikpal-kiosk-performance.service` records each cpufreq policy's original
governor before applying `performance`. Its stop action restores only those
recorded values, so it never guesses or overwrites a governor selected by a
different owner.

## Render behavior

`runtime.renderProfile` is delivered by the API, not inferred from hostname.
The constrained profile uses one scene-video layer and removes expensive video
filters, fullscreen backdrop filters, broad blur, and continuous Hi-Fi
particles/waveforms. Ordinary opacity and transform transitions remain.

The browser records rAF pacing, Long Tasks, and
`HTMLVideoElement.getVideoPlaybackQuality()`:

- After ten continuous seconds with video drops at or above 4%, or rAF p95
  above 45ms, it swaps to a static scene background.
- After sixty stable seconds with rAF p95 at or below 42ms, it tries one video
  layer again.
- A repeated failure returns to static for five minutes before the next try.

The static state is deliberately non-blocking and is reported in the kiosk
heartbeat as `activeSceneVideo.staticOnly=true`. It is a successful protective
state, not a missing-scene watchdog failure.

## Resident Provider behavior

All ten Provider Chromium processes, profiles, CDP sessions, and login state
remain resident. An inactive `ready` Provider becomes `frozen` eight seconds
after the pool is idle through `Page.setWebLifecycleState(frozen)`.

`active`, side-panel, prewarming, switching, Guard-held, and audio-carrying
pages are excluded. A foreground selection first resumes its own Manager READY
session, then completes the fenced X11/Guard transaction, and only commits the
new visible owner after that transaction. The old page is frozen only after
the target is visible and audio handoff is complete. CDP lifecycle rejection
keeps the existing off-screen parking path and reports `activity=unsupported`;
it never sends `SIGSTOP`, closes a window, or deletes a profile.

The hot path reuses a successful Manager lifecycle confirmation instead of
performing redundant direct CDP page probes. A direct probe remains the
fallback for pages that were not frozen. This preserves the Provider-page
proof before the X11 reveal while keeping the EVDI foreground path bounded.

`WebModeResidentProviderState.activity` is diagnostic-only and can be
`active`, `parked`, `frozen`, or `unsupported`; it does not change the existing
Provider status enum or action API.

## Diagnostics and graphics policy

Run the read-only report as the kiosk user:

```bash
runuser -u moode -- \
  /home/moode/code/tikpal/deploy/chromium/tikpal-rendering-diagnostics.sh
```

It reports RandR mode, Mesa renderer, VA-API capability, thermal/CPU state,
Chromium GPU/video-decode diagnostics, and Provider CDP status. The 207 field
baseline identified Mesa `AMD CEDAR`, not llvmpipe, but Chromium reported
software video decode and VA-API did not validate. Do not add Chromium VA-API
flags or a graphics overlay unless a later on-device verification proves
hardware decode and no playback regression.

## Field acceptance

Use runtime evidence to detect regressions, but treat physical observation as
the final authority for black frames, visible stutter, and audio continuity.

```bash
curl -fsS http://127.0.0.1:8787/api/v1/web-mode/state
curl -fsS http://127.0.0.1:8787/api/v1/kiosk/heartbeat
runuser -u moode -- \
  /home/moode/code/tikpal/deploy/chromium/tikpal-web-mode-cdp-client.py \
  --socket /run/tikpal/cdp-session-manager.sock --op status
```

Expected idle state is ten `ready` Provider cards with ten `frozen` CDP
sessions, no active Provider, no hard CDP error, and a fresh healthy heartbeat.
On the 2026-09-03 field check, a traced frozen resident switch reached physical
foreground in 774ms; this is one sample, not a median or p95 claim. The target
for further acceptance remains rAF p95 at or below 42ms with video drops below
4% when video is active, or a clean automatic static fallback without repeated
long stalls.

## Rollback boundary

Keep the profile changes independent. If field observation identifies a
regression, first change only the relevant machine-local setting, restart the
kiosk in an approved maintenance window, and re-run the read-only report:

- Set `TIKPAL_RENDER_PROFILE=standard` to restore the full visual profile.
- Set `TIKPAL_WEB_MODE_PROVIDER_BACKGROUND_FREEZE_ENABLED=0` to retain
  off-screen parking without lifecycle freezing.
- Clear `TIKPAL_KIOSK_XRANDR_RATE` only when a 59.90Hz display mode has been
  physically revalidated.

Do not reset Provider profiles, proxy settings, or `.tikpal` runtime state as
part of a rendering rollback.
