# 136 Debian core migration — 2026-09-14

Status: implementation and initial deployment completed; **acceptance incomplete**.
SSH was restored by the user after the first reboot; its original disabled boot
policy was recorded and SSH was enabled for subsequent remote recovery.
207 was not changed.

## Deployment

- Base source: `b0ae9a6c9f57b99a2ec36e2cdc9da36556479d01`, staged in a separate
  worktree. Existing uncommitted scene/audio work was not deployed or overwritten.
- Target source: `/home/radxa/code/tikpal`.
- Node: ARM64 24.21.0, archive SHA-256
  `6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2`.
- Retained Chromium 126 (`chromium-x11`), kernel 6.1.84-13-rk2410-nocsf,
  PipeWire 0.3.65 and WirePlumber 0.4.13. MPD 0.23.12 installed.
- Six per-user services under `tikpal-debian.target`: API, web, MPD, CDP manager,
  read-only Helper and kiosk browser. Only loopback web/API/debug listeners.
- GDM configured for automatic login to `tikpal.desktop`, running Tikpal directly on X11
  without KDE or a window manager. The actual attached display determines geometry at startup.
- BT66 was connected during work and selected as the saved PipeWire default:
  `alsa_output.usb-Generic_BT66_20170726905923-00.analog-stereo`.

Platform changes include architecture-specific CDM paths, recognition of Radxa's
`chromium-bin` process, a private xdotool restack adapter,
and skipping AirPlay system-unit actions when the service is absent. Public API
contracts remain unchanged. Helper takeover stays disabled.

## Evidence before the reboot

- ARM64 `npm ci`, typecheck, build and Helper compilation/self-test passed.
- Actual main Chromium page and scene video displayed at 2560×1440.
- Radio API returned 36 stations; SomaFM Cliqhop played through MPD → PipeWire →
  board output with both channels active. BT66 was then recognized and selected;
  a three-second test tone was sent to the default output. Listening confirmation
  remains pending.
- QQ player and extension service worker loaded. QQ was not logged in and its
  playlist was empty; protected/song playback is not accepted.
- In the initial KDE session, five complete collapse/expand cycles were observed
  after adaptation, including a 30-second collapsed hold. Confirmed geometry:
  provider 1920×1440 / 2504×1440; panel x=1920 / 2504, size 640×1440.
  Requests took approximately 7.7–9.2 seconds. This is not the final kiosk-session
  acceptance and does not meet the earlier one-second responsiveness target.
- Debian platform fixture passed on ARM64: CDM architecture separation,
  `chromium-bin` lookup, profile isolation, restacking, invalid XID rejection.
- ARM64 panel Xvfb, initial-entry failure injection, Linux audio-release and
  OAuth fixtures passed. Local typecheck/build, kiosk, lifecycle, CDP and audio
  gate regressions passed.
- Two pre-existing failures reproduced in the unchanged source baseline:
  browser panel fixture line 81 (`[role="status"][title*="retry"]`) and Helper
  Phase 1 (`Helper paint gate stamped before a nonblank frame or released its
  lease on failure`). They were not silently marked passed or changed here.

## Remaining acceptance

The first reboot verified automatic Openbox login, absence of KDE, all six services
and retention of BT66 as default. Openbox constrained the 56px panel to 64px
(10 percent of its width); that failed acceptance. The final session now follows
the existing Gentoo direct-X11 design, removing the unnecessary window manager.
The second reboot verified automatic SSH startup, direct X11 kiosk (no Openbox,
KWin or Plasma processes), all six services and BT66 default retention. Ten complete collapse/expand cycles then passed, including a 30-second
collapsed hold. Geometry was independently queried after every request and
during the hold. Provider and panel XIDs remained unchanged. QQ URL and
performance.timeOrigin were identical before/after; no page reload occurred.
No audio/video element was playing, so playback continuity is not accepted.
Request timing: min 3.757s, median 7.376s,
max 8.261s; the one-second target remains unmet.
 The real QQ Chromium EME probe returned
`NotSupportedError: Unsupported keySystem or supportedConfigurations.`

Remaining checks: close/immediate reopen, browser failure recovery, and
30 minutes of continuous audio with resource/error sampling. Actual BT66 listening
and QQ song playback remain pending; the current browser DRM probe failed. Physical 2560×720/touch checks remain pending
until that screen is connected.

The final installer includes a GDM preflight and atomic managed-file replacement.

## Evidence and recovery locations

- Device baselines/logs: `/home/radxa/tikpal-migration/`.
- Managed-file backups: `/home/radxa/tikpal-migration/install-backup/`.
- Local build/test/screenshots/manifest: `/tmp/tikpal136-source-baseline/`.
- Installer and rollback instructions: `deploy/debian/README.md`.

SSH is now enabled at boot; its prior disabled policy is saved in
`install-backup/ssh.service.enabled`. Rollback restores that boot policy without
stopping the active SSH connection. Rollback uses
`sudo bash /home/radxa/code/tikpal/deploy/debian/rollback-core.sh radxa`, followed
by a reboot; it retains profiles, source, radio data and dependencies.
## Isolated Radxa branch — 2026-09-14

`codex/radxa` was created from `b0ae9a6` in `/Users/pom/Code/tikpal-radxa`.
Only the Debian platform scripts, Chromium process/CDM detection, Helper class
compatibility, absent-AirPlay guard and their fixtures were migrated. The original
`207` worktree and its uncommitted scene/audio/UI changes were preserved.
Dependencies were installed independently with `npm ci`; no device profiles,
runtime state or hardware configuration were copied. No device was deployed in
this branch-isolation step. Strict single-video rendering is a subsequent change.

Branch validation (local macOS, Node 25.9.0): typecheck/build, shell syntax, LFS
integrity, Debian CDM/AirPlay fixtures, panel state/API/Xvfb, provider audio gate
and OAuth passed. Initial-entry verification passed two success paths, 19 injected
failures, two trace-loss cleanup paths and one fail-closed preflight. The Linux-only adapter/process tests are not executed on macOS;
earlier ARM64 results above remain historical device evidence.

The lifecycle smoke initially timed out at `prepare-entry did not capture opening
state` during concurrent checks. Both the unchanged baseline and the Radxa rerun
passed. The panel browser fixture failed at line 81 (`[role="status"][title*="retry"]`)
on both branches; it is a reproduced baseline failure, not an accepted browser pass.
The build also reports its existing bundle-size warning.

## Radio direct-network fallback — 2026-09-16

MPD cannot sustain an Internet stream when the source's delivered throughput stays
below its bitrate. Larger buffers only defer the dropout. Keep the proxy path when
it is available, but configure a direct lower-bitrate variant only after verifying
that exact endpoint from the target device:

```conf
TIKPAL_RADIO_LOW_BANDWIDTH_VARIANTS='{"http://ice1.somafm.com/beatblender-128-mp3":{"uri":"http://ice1.somafm.com/beatblender-64-aac","bitrateKbps":64,"codec":"AAC"}}'
```

The mapping is optional and defaults to no behavior change. After the configured
Radio xrun grace/window/threshold is exceeded, Tikpal reopens the configured
lower-bitrate URL for the same station and keeps its `radioStationId`, artwork and
remembered source. If that retry cannot reach a playing state, the existing
bounded next-station recovery remains the fallback; it must not wait indefinitely
or keep outputting silence. Add entries only for streams with an independently
verified lower-bitrate URL, codec support and sustained direct throughput.

## HDMI XRandR brightness fallback — 2026-09-17

The 2560×720 HDMI display on the Radxa exposes no `/sys/class/backlight` node and
does not answer DDC/CI VCP `0x10` on its mapped I²C bus. Do not configure a DDC
display index for this panel. Its XRandR output does expose a writable `brightness`
property, so configure the API's verified driver-property helper instead:

```conf
TIKPAL_DISPLAY_BRIGHTNESS_COMMAND=./deploy/debian/tikpal-xrandr-display-brightness.sh
TIKPAL_DISPLAY_BRIGHTNESS_OUTPUT=HDMI-1
TIKPAL_DISPLAY_BRIGHTNESS_TIMEOUT_MS=2500
```

The helper reads the current output property, writes only an integer from 0 to
100, then reads it back. The API reports `transport: "xrandr"` only after that
status read is successful. This controls the X display pipeline, not a measured
panel-backlight luminance value. If the property is absent or readback fails, the
API remains unavailable and the UI must not present a successful brightness change.

## Constrained runtime sampling — 2026-09-17

Playback state remains fresh every three seconds, but network, display, output,
DSP, thermal, uptime and multi-room probes are reused for 15 seconds by default.
Set `TIKPAL_SYSTEM_SNAPSHOT_REFRESH_MS=15000` in `.env.kiosk` for the same
behavior on the device. Any user action invalidates this system cache, so a
brightness or source change still returns its updated state immediately. The ARM
Hi-Fi view also freezes its 28 lyric-footer equalizer bars in the constrained
render profile while keeping their static waveform visible.
