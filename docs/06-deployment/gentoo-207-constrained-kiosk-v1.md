# Gentoo 207 Constrained Kiosk v1

## Purpose

`192.168.10.207` uses a lower-performance Radeon/EVDI path than the primary
Gentoo reference host. This profile keeps the 2560 x 720 kiosk usable without
discarding resident Provider profiles or their login state. It is a
machine-local runtime profile: keep `.env`, `.env.kiosk`, and `.tikpal/*` out
of Git.

## 207 runtime profile

The production `.env.kiosk` selects the constrained renderer, dynamic display
selection, CDP lifecycle freezing, and the kiosk-only CPU governor:

```conf
TIKPAL_KIOSK_XRANDR_OUTPUT=auto
TIKPAL_KIOSK_XRANDR_MODE=2560x720
TIKPAL_KIOSK_XRANDR_RATE=
TIKPAL_KIOSK_XRANDR_USB_RATE=29.95
TIKPAL_KIOSK_XRANDR_USB_OUTPUT_PATTERN="^(DVI-I|DVI-D)-[0-9]+-[0-9]+$"
TIKPAL_KIOSK_XRANDR_DIRECT_OUTPUT_PATTERN="^(HDMI|DP|DisplayPort)-"
TIKPAL_KIOSK_XRANDR_PRIMARY_PREFERRED_OUTPUTS=
TIKPAL_PHYSICAL_DISPLAY_DRM_CONNECTORS=auto
TIKPAL_PHYSICAL_DISPLAY_DRM_PREFERRED_CONNECTORS=
TIKPAL_KIOSK_APPLY_PHYSICAL_DISPLAY_MODE=1
TIKPAL_RENDER_PROFILE=constrained
TIKPAL_WEB_MODE_CDP_SESSION_MANAGER=1
TIKPAL_WEB_MODE_PROVIDER_BACKGROUND_FREEZE_ENABLED=1
TIKPAL_WEB_MODE_PROVIDER_BACKGROUND_FREEZE_DELAY_SECONDS=8
TIKPAL_KIOSK_CPU_GOVERNOR=performance
```

The physical-display soft-kick runs after X starts and before Chromium. It is
best-effort: a failed kick is logged once and never creates a restart loop.
With `auto`, an explicitly configured connected output wins; otherwise the
scripts select a connected HDMI/DP output, then another non-EVDI output, and
only then an EVDI-style DVI output. Direct HDMI/DP uses the panel's native
refresh because no `--rate` is passed. An EVDI-style DVI primary instead uses
`29.95Hz`, so the same profile adapts safely when the USB TURZX is reattached.
On the 2026-09-03 HDMI check, the connected `HDMI-0` was `2560x720@60.00`.
Output-specific RandR properties are queried before use, so unsupported HDMI
properties are skipped rather than reported as failed EVDI tuning.

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

## Physical Explore entry and HDMI record

`tikpal-explore-physical-acceptance.sh` keeps the action API and CDP input
read-only. It queries the rendered center of the actual control, then uses
`xdotool` for the X11 click. This avoids fixed coordinates, which are invalid
when the connected panel, compositor geometry, or Room/Hi-Fi presentation
changes. A Room-mode ambient click may reveal the Explore picker directly; if
it does not, the script uses the Hi-Fi source-toggle control and then waits for
the real Explore option. These are mouse-injection checks, not proof from a
touch digitizer; a separately connected USB touch interface still requires its
own hardware acceptance.

When diagnostic CDP access is temporarily needed on a field unit, keep both
Chromium and its proxy bound to `127.0.0.1`; do not expose a DevTools port on
the LAN. On 2026-09-03, the HDMI panel was confirmed as
`HDMI-0 2560x720@60.00`, and one strict pass through all ten Providers completed
with physical-visible timing median/p95/max of `773/797/797ms`. Settled timing
was `1255/2437/2437ms`; opening Explore settled in `5448ms`, closing it in
`6123ms`, and the full recorded run was `128151ms`, including its preflight.
This is field evidence for the ten-round run, not a substitute for the wider
Phase 4 acceptance suite.

For capture support, build `media-video/ffmpeg` with its `X` USE flag and
confirm `x11grab` appears in `ffmpeg -devices`. Any shell-driven FFmpeg capture
that shares its caller's standard input must use `-nostdin`; otherwise FFmpeg
can consume subsequent shell commands.

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
