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

## HDMI brightness profile

For the RTK HDMI panel tested on 2026-09-09, apply the device-specific
[HDMI brightness limits](../hdmi-brightness-limits.md): DDC minimum 10,
maximum 45, and startup brightness 45. Hardware value 48 became visibly dimmer
than 45 despite matching DDC readback. The user confirmed recovery at 45 and
normal display after a subsequent reboot. Do not reuse the earlier startup
100 or provisional maximum 48. This is a field-tested control restriction,
not a calibrated luminance scale or a proven thermal fix.

## CPU thermal scene guard

The x86 scene guard protects the host CPU only. It does not infer motherboard,
panel, DAC, or display-driver temperature. On 207 it reads an x86 package
sensor from `/sys/class/hwmon` (including `x86_pkg_temp`, `coretemp`,
`k10temp`, or `zenpower`); if no supported sensor is available, the API reports
the temperature source as unknown and does not activate a thermal fallback.

At **90°C** the Ambient scene video and its scene-audio track are replaced by
the selected scene's static thumbnail. A scene without a thumbnail uses the
bundled fireplace image. The page keeps showing the current CPU temperature and
“设备温度过高，已切换为静态画面。建议关机散热后再使用。” until the CPU
falls to **80°C** or below, when the selected scene video resumes. This guard
does not shut down the host and does not stop MPD, AirPlay, Bluetooth, DLNA, or
other external music playback.

This fallback is distinct from the user's Scene Video setting: when the user
turns Scene Video off, the intended ambient backdrop remains black. The static
thumbnail is only an automatic high-temperature safeguard.

Verify the reported policy and sensor without forcing a temperature change:

```bash
curl -fsS http://127.0.0.1:8787/api/v1/system/state | \
  jq '.system | {cpuTemp, thermal}'
```

For the 207 x86 profile, `thermal.videoPauseCelsius` must be `90` and
`thermal.videoResumeCelsius` must be `80`; `thermal.cpuSource` identifies the
accepted sensor, while `cpuTemp: null` means no automatic temperature-based
scene downgrade is applied.

## Dynamic audio routing

Both the kiosk Chromium process and Explore Providers must use the physical
audio resolver rather than ALSA `default`, which can point to Loopback after
`snd_aloop` loads:

```conf
TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE=auto
TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE=auto
TIKPAL_AUDIO_CARD_PRIORITY=
TIKPAL_AUDIO_CARD_FORCE=
```

With no explicit override, the resolver chooses one currently attached USB
playback endpoint, then one non-HDMI endpoint. If several candidates remain,
it refuses to guess and requires an intentional `TIKPAL_AUDIO_CARD_FORCE` or
deployment-specific priority. This is hardware discovery, not a card-name
pin: on 2026-09-04 the connected USB device happened to resolve to
`dmix:CARD=BT66,DEV=0`, but that value is neither checked in nor stored in the
207 runtime configuration.

Verify the active hardware without changing it:

```bash
runuser -u moode -- \
  /home/moode/code/tikpal/deploy/moode/tikpal-audio-adapt.sh check
```

The launcher log and the QQ Chromium command line must show the same resolved
`--alsa-output-device=` value. A resolved `default` is a configuration error,
not a valid fallback for browser audio on a Loopback-enabled kiosk.

## Radio catalog and DLNA recognition tap

207 uses the existing Tikpal-owned `/var/lib/tikpal/radio.sqlite3`, not the
absent moOde database. Its current catalog contains 36 curated stations across
12 categories and must be checked before any update; a healthy check does not
rewrite it. The service installer reads the configured path from the
device-local `.env` and `.env.kiosk` files without sourcing them.

The DLNA recognition tap requires Gentoo MPD to be built with both `httpd`
and `flac` USE flags. Enable it only with the explicit release flag:

```bash
./deploy/deploy-gentoo.sh --host 192.168.10.207 --user root --proxy '' \
  --allow-dirty --enable-mpd-httpd
```

This maintenance action recompiles MPD and briefly restarts it. It snapshots
and restores the active MPD queue and playback state, but should still be run
outside critical listening. The installed `Tikpal DLNA Recognition Tap` is
FLAC, listens only on `127.0.0.1:8001`, and stays disabled between bounded
captures; it neither changes the primary DAC output nor creates a LAN listener.

Verify after the maintenance action:

```bash
mpd --version
mpc outputs
ss -ltn '( sport = :8001 )' # no listener while the tap is disabled
TIKPAL_RADIO_SQLITE_DB=/var/lib/tikpal/radio.sqlite3 \
  ./deploy/moode/tikpal-radio-presets-sync.sh check
curl -fsS 'http://127.0.0.1:8787/api/v1/audio/radios?limit=80' | jq '.total,.categories'
```

## Optional fixed auxiliary gain

Some DACs expose a downstream playback control separate from the user-facing
volume mixer. This opt-in configuration is independent of display brightness:

```conf
TIKPAL_OUTPUT_VOLUME_FIXED_AUX_CARD=
TIKPAL_OUTPUT_VOLUME_FIXED_AUX_CONTROL=
TIKPAL_OUTPUT_VOLUME_FIXED_AUX_VALUE=
```

Leave all three empty unless the connected card and control have been verified.
The card must exactly match its stable ALSA card ID; the control is the complete
`amixer cget/cset` selector, such as `name='PCM Playback Volume',index=1` only
when that control is confirmed on that card. The value is a fixed percentage
clamped to 0–100. Do not apply a guessed index to every card or tie this fixed
value to the user's volume slider.

`tikpal-output-volume.sh prepare` prepares the matched auxiliary control;
normal volume writes also reassert it. `tikpal-audio-adapt.sh apply` invokes
the preparation after routing is written. Missing configuration, a different
card, or an absent control skips the auxiliary write; `get` stays read-only.
The kiosk fixtures cover exact matches, mismatches, missing controls, and
audio-adapter preparation. Publishing this source does not change the live
207 audio settings or constitute new audible playback acceptance.

## System Widevine source

The provider launcher can seed an incomplete CDM directory from
`TIKPAL_WEB_MODE_SYSTEM_WIDEVINE_CDM_DIR`, defaulting on Gentoo to
`/usr/lib64/chromium-browser/WidevineCdm`, before trying existing Chromium and
provider profiles. A candidate must contain a Linux x64 `libwidevinecdm.so`
larger than 1,000,000 bytes. This is a presence heuristic, not proof of a
compatible CDM, provider entitlement, license exchange or protected playback.
An already populated provider CDM is preserved; repair replaces only the
target `WidevineCdm` subtree, not the provider's login profile. The package
smoke tests system-to-profile seeding. No proprietary CDM binary is included
in this source checkpoint; the provider still needs separately verified runtime
DRM support. See the [Gentoo deployment guide](gentoo-kiosk-deploy-v1.md).

## FT8201P source checkpoint

The `207` branch also contains the independent
[FT8201P I2C driver draft](../../hardware/ft8201p/README.md). The requested
coordinate defaults are 2560×720 with ten touch slots, but its assumed CTPM
point layout still needs capture-based verification, plus an actual I2C address,
reset GPIO and interrupt. No kernel-module build, installation or touch hardware
acceptance is claimed by this source checkpoint. The HDMI panel's observed
USB touchscreen is not evidence for this I2C driver. Do not load it as part of
the brightness deployment.

## DLNA renderer

207 uses the Portage package `media-sound/upmpdcli` as its DLNA Renderer. It is
enabled at boot as `upmpdcli.service`; the shared Tikpal UPnP hooks remain in
`.env.kiosk` and the Renderer configuration is machine-local.

The 2026-09-04 installation runs `upmpdcli 1.9.14` on `192.168.2.207` with:

```conf
friendlyname = Tikpal-Gentoo
avfriendlyname = Tikpal-Gentoo-UPnP/AV
upnpav = 1
openhome = 0
checkcontentformat = 0
ohproductroom = Tikpal-Gentoo
```

The unit serves SSDP on `1900/UDP`, the Renderer HTTP endpoint on `49152`, and
its streaming proxy on `49149`. The first configuration backup is retained at
`/var/backups/tikpal/upmpdcli-first-config-20260904T150233`. Do not use a
fixed `/description.xml` probe: obtain the UUID-scoped `LOCATION` through
SSDP and verify the returned `MediaRenderer:1` description names
`Tikpal-Gentoo-UPnP/AV`.

Run configuration only while DLNA is idle because it restarts `upmpdcli` and
Avahi. The initial installation's immediate restart reached the upstream
90-second stop timeout before systemd replaced the process; that completed
with a healthy active service. The recovery is to let systemd complete this
first restart, not to restart Tikpal, kiosk, or X11.

Verify without selecting DLNA or disrupting another active source:

```bash
systemctl is-active upmpdcli.service avahi-daemon.service
systemctl is-enabled upmpdcli.service
runuser -u moode -- sh -lc \
  'cd /home/moode/code/tikpal && ./deploy/moode/tikpal-upnp-ready.sh'
ss -lunp | grep ':1900'
ss -ltnp | grep -E ':49149|:49152'
```

Tikpal should leave the DLNA source blocked until a user selects it; then it
becomes `armed`/`waiting`. Only a real sender and MPD-backed stream may mark
it `connected`.

### Stream interruption diagnosis

`DLNA Ready` with `playback.state:"stopped"` is a retained, armed DLNA source
whose incoming stream ended; it is not by itself a renderer disconnect. During
the 2026-09-04 field run, the same `upmpdcli` PID stayed active with
`NRestarts=0` while Tikpal briefly showed that state, then a new sender stream
restored `connected` playback. Do not restart `upmpdcli`, Tikpal, or X11 for
this symptom because that destroys the evidence and interrupts a sender that
may be reconnecting.

The observed QQ Music sender uses dynamic `aqqmusic.tc.qq.com` MP3 URLs. MPD
logged `mpg123` cannot-seek/getformat errors at some replacement-stream
boundaries, so a single stopped interval does not identify whether the sender
withdrew transport or MPD rejected the next URL. For a conclusive failure, keep
the sender untouched through a full track and retain the paired `upmpdcli`, MPD
and Tikpal API journals; compare the first `DLNA Ready` timestamp with the
sender's next `SetAVTransportURI`.

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

The budget is active only while Ambient is the foreground Tikpal screen. Opening
Player, Settings, or Quick Menu clears a stale static fallback; returning to
Ambient starts a fresh video attempt instead of making the user wait for a
countdown that began behind an overlay.

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

## Explore close behavior

Close sends the active Provider's idempotent `setActive(false)` audio gate
through its existing hot CDP Manager session before any provider or side-panel
window is made transparent or parked. This pauses media, Howler, and audio
contexts immediately; a gate failure is logged as `close_audio_gate` but does
not block the visible close transaction. Only after that close transaction
finishes may the API restore the prior MPD or radio handoff, and only when that
source had been playing before Explore opened.

Closing Explore stops an in-flight provider prewarm worker and never refills
the pool while Ambient is visible. Already `ready` resident pages remain
reusable and still receive the normal eight-second resource freeze. Pages that
were not ready are reconciled and prewarmed only after the next Explore open,
so the side panel cannot briefly show a post-close `prewarming` state.

## Proxy-friendly-page recovery

When a user selects a resident provider whose card is `Check proxy` (or was
briefly changed to `Prewarming` by reconciliation) and whose page is the local
friendly error page, Tikpal performs one bounded probe of that provider's real
URL through the current Settings proxy. A successful probe returns the existing
page to its provider URL through the foreground CDP Manager session, waits for
a real ready HTTPS page, and only then reveals it. The trace logs `proxy_retry`
with provider, outcome, and elapsed time.

An unreachable proxy, failed navigation, or a repeated friendly error leaves
the card at `Check proxy` without a reload loop or browser rebuild; an already
visible different provider remains visible. QQ Music and NetEase Cloud Music
continue to use their direct route and do not enter this proxy retry path.

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
