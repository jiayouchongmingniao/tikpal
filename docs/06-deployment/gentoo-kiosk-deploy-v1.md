# Gentoo Kiosk Deploy v1

## Goal

Deploy Tikpal on a Gentoo systemd host as the production 2560 x 720 physical kiosk while keeping the existing Raspberry Pi / moOde deployment path intact.

This runbook records the Gentoo migration baseline validated on `192.168.10.117` and later DHCP address `192.168.10.115` in July 2026. The app path stays compatible with the moOde host:

```bash
/home/moode/code/tikpal
```

The Git branch for Gentoo-specific repo work is `gentoo`. Runtime files such as `.env`, `.env.kiosk`, and `.tikpal/*` remain machine-local and must not be copied back into Git.

## Runtime Baseline

Core services use the same repo-owned systemd units as the Pi path:

| Unit | Purpose |
| --- | --- |
| `tikpal-api.service` | Local API on `127.0.0.1:8787`. |
| `tikpal-web.service` | Web UI on `4173` and portable remote on `4174`. |
| `tikpal-audio-adapt.service` | Preserves and reports the Gentoo ALSA output route. |
| `tikpal-library-sync.service` | Keeps MPD library state fresh. |
| `tikpal-kiosk.service` | Physical Chromium kiosk on display `:0`. |
| `tikpal-kiosk-watchdog.timer` | Display watchdog. |

The Gentoo target uses systemd, Portage-managed Xorg/Chromium, and ALSA direct output. Keep the production `.env.kiosk` aligned with the physical screen:

```conf
TIKPAL_KIOSK_DISPLAY=:0
TIKPAL_KIOSK_DISPLAY_MODE=physical
TIKPAL_KIOSK_LOCAL_SCREEN=1
TIKPAL_KIOSK_WINDOW=2560x720
TIKPAL_KIOSK_XRANDR_OUTPUT=HDMI-1
TIKPAL_KIOSK_XRANDR_MODE=2560x720
TIKPAL_KIOSK_VIEWER=none
TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE=_audioout
TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE=tikpal_bt66_dmix
```

Keep `.env` in `mpc` mode and allow the backend to read the real DRM display mode:

```conf
TIKPAL_PLAYER_BACKEND=mpc
TIKPAL_MPD_HOST=127.0.0.1
TIKPAL_MPD_PORT=6600
TIKPAL_RUNTIME_DRM_MODE_ENABLED=1
TIKPAL_AUDIO_CARD_FORCE=BT66
TIKPAL_OUTPUT_VOLUME_CARDS=BT66
```

If a future Gentoo host runs virtual kiosk only, set `TIKPAL_KIOSK_DISPLAY=:1`, `TIKPAL_KIOSK_DISPLAY_MODE=virtual`, `TIKPAL_KIOSK_LOCAL_SCREEN=0`, and keep noVNC enabled only for debugging.

## Gentoo System Setup

Install the base audio and kiosk dependencies with Portage. The validated stack includes ALSA tools/plugins, MPD/MPC, Avahi, upmpdcli, BlueZ/bluez-alsa where hardware exists, ffmpeg, sqlite, jq, sudo, Node.js, Chromium, Xorg/Xvfb, xdotool, wmctrl, x11vnc, noVNC, websockify, and socat.

Gentoo package choices are intentionally conservative:

- Keep Nouveau for the GTX 750 class display path. Do not install `x11-drivers/nvidia-drivers` unless the display path is being revalidated.
- Enable Xorg `suid` through Portage instead of manually keeping `/usr/bin/Xorg` chmodded.
- Keep `snd_aloop` persistent for Loopback-backed capture and compatibility paths.
- Do not enable global USB autosuspend; BT66 DAC, touch, keyboard, and network devices should remain awake.
- Install `sys-power/powertop` for measurement, not for automatic `powertop --auto-tune`.

The long-term display expectation is:

```bash
DISPLAY=:0 XAUTHORITY=/home/moode/.Xauthority xrandr --query
```

Expected high-signal line:

```text
HDMI-1 connected primary 2560x720+0+0
```

The physical display prepare helper should run before and after kiosk start. Its job is to wait for the HDMI DRM connector and EDID at boot, disable DPMS/screen saver, keep the Nouveau PCI path awake, retile `HDMI-1` to `2560x720`, and apply the safe HDMI properties that stopped black-screen recovery churn on the Gentoo target.

Install the repo-owned helper as the root command used by the systemd drop-in:

```bash
install -o root -g root -m 0755 \
  /home/moode/code/tikpal/deploy/chromium/tikpal-physical-display-prepare.sh \
  /usr/local/sbin/tikpal-physical-display-prepare
mkdir -p /etc/systemd/system/tikpal-kiosk.service.d
cat >/etc/systemd/system/tikpal-kiosk.service.d/physical-display.conf <<'EOF'
[Service]
Environment=TIKPAL_KIOSK_ENV_FILE=/home/moode/code/tikpal/.env.kiosk
ExecStartPre=+/usr/local/sbin/tikpal-physical-display-prepare wait-ready
ExecStartPost=+/bin/sh -c 'systemctl stop tikpal-physical-display-kick.service >/dev/null 2>&1 || true; systemd-run --quiet --collect --no-block --unit=tikpal-physical-display-kick --property=Type=oneshot --setenv=TIKPAL_KIOSK_ENV_FILE="$TIKPAL_KIOSK_ENV_FILE" --setenv=HOME=/root /usr/local/sbin/tikpal-physical-display-prepare delayed-soft-kick'
EOF
systemctl daemon-reload
```

`deploy/systemd/install-systemd-services.sh --enable-kiosk` installs the same helper and drop-in. The `+` prefix keeps the command root-owned even though `tikpal-kiosk.service` itself runs Chromium as `moode`. The delayed kick is launched as a short transient unit so `tikpal-kiosk.service` does not block on the full delay window.

The installer also creates `tikpal-display-stability.service`, an enabled oneshot that runs before the kiosk and calls:

```bash
/usr/local/sbin/tikpal-physical-display-prepare pci-stabilize
```

On the Gentoo target, set these production values in `.env.kiosk`:

```conf
TIKPAL_PHYSICAL_DISPLAY_PCI_POWER_DEVICES="0000:03:00.0 0000:03:00.1"
TIKPAL_PHYSICAL_DISPLAY_PCIE_ASPM_POLICY=performance
TIKPAL_PHYSICAL_DISPLAY_DRM_POLL=0
TIKPAL_PHYSICAL_DISPLAY_NOUVEAU_PCI_ID=0000:03:00.0
TIKPAL_KIOSK_PHYSICAL_DISPLAY_CHECK_ENABLED=0
TIKPAL_KIOSK_PHYSICAL_DISPLAY_GPU_REBIND_BEFORE_RESTART=1
```

If the kernel refuses a runtime ASPM policy write, the helper logs it as optional and continues. The important baseline is that both Nouveau GPU and HDMI-audio PCI functions stay at `power/control=on`.

On this GTX 750 host, avoid periodic physical `xrandr --query` probing from the watchdog. Repeated probing can trigger Nouveau DDC reads against the unused `DVI-I-1` connector (`DDC responded, but no EDID for DVI-I-1`) on roughly the watchdog cadence. Because this panel can be black while RandR still reports healthy, that periodic probe adds risk without giving a reliable visual signal. Keep `TIKPAL_KIOSK_PHYSICAL_DISPLAY_CHECK_ENABLED=0` and use the recovery helper manually or from an explicit service when the screen is visibly black.

## Screen Sleep

Tikpal's user-facing Screen Sleep is a soft screen saver, not X11 DPMS power-off. This is intentional for sold kiosk devices that may not ship with a keyboard: the first touch wakes the screen saver and is swallowed, so it does not activate the control underneath.

Automatic Screen Sleep is disabled while Explore has an active provider. Provider login, MV playback, or web-player browsing can be long-running, and the visible provider/side-panel windows sit above the main kiosk. When Explore closes, the kiosk resets the idle timer and resumes the user's configured sleep interval.

On real screen-off entry, Tikpal should briefly show a faint `Touch to wake` hint for the first few seconds, then fade it away. This keeps the saver calm while making it clear that the device is asleep, not black-screened.

Preferences are stored in `.tikpal/ui-preferences.json`:

| Preference | Values | Default |
| --- | --- | --- |
| `displaySleepEnabled` | `true` / `false` | `true` |
| `displaySleepMinutes` | `5`, `10`, `15`, `30`, `60` | `10` |
| `displaySleepStyle` | `meteor_shower`, `clock`, `now_playing`, `starfield`, `signal` | `meteor_shower` |

The selectable styles are intentionally classic and low-risk:

- `meteor_shower`: low-brightness meteor streaks for a living dark screen without looking like a panel fault.
- `clock`: date and clock.
- `now_playing`: current track, artwork, and progress.
- `starfield`: subtle classic starfield animation.
- `signal`: slow music-signal bars with a subdued grid.

Legacy `blank` / `dim_waves` preferences migrate to `meteor_shower`; legacy `dvd` / `dvd_bounce` preferences migrate to `signal`.

Keep `tikpal-physical-display-prepare` disabling DPMS after every soft-kick. Do not expose DPMS/deep power-off as the normal Screen Sleep mode unless touch wake has been revalidated on the target hardware.

## Audio Services

The Gentoo audio base uses ALSA direct output to the BT66 USB DAC. The validated `_audioout` route points at BT66, and Chromium provider audio uses the shareable `tikpal_bt66_dmix` device.

Keep these receiver names unique while the old moOde host remains online:

| Receiver | Name |
| --- | --- |
| UPnP / DLNA | `Tikpal-Gentoo UPNP` |
| AirPlay | `Tikpal-Gentoo-Airplay` |
| Spotify Connect | `Tikpal-Gentoo Spotify` |
| Bluetooth | `Tikpal-Gentoo-Bluetooth` |

Bluetooth remains unavailable unless `bluetoothctl list` shows a real HCI controller. Do not make the UI claim Bluetooth is ready before a USB Bluetooth dongle is present and paired through BlueZ/bluez-alsa.

Use the Gentoo source handoff helper to avoid ALSA output contention:

- AirPlay stops MPD and Spotify, then starts or restarts Shairport Sync.
- Spotify stops MPD and AirPlay, then starts or restarts go-librespot.
- UPnP stops direct web receivers and lets MPD/upmpdcli own playback.
- Library and Radio stop direct web receivers and keep MPD active.

Validation:

```bash
systemctl is-active mpd avahi-daemon upmpdcli shairport-sync
aplay -l
mpc status
sudo fuser -v /dev/snd/*
```

When QQ Music or another Explore provider is playing, the expected owner is a Chromium audio process holding BT66. When MPD or Radio is playing, the expected owner is MPD.

### Multi-room Audio

Multi-room Audio is optional and is controlled from Settings -> Preferences -> Multi-room Audio. Roon, Lyrion, and Tikpal Multi-room can be enabled at the same time and wait for playback; Music Assistant is a coming-soon placeholder in the first release. None of these ecosystems appear in the Player source rail, because playback selection and transport remain in their own apps.

Install Roon Bridge with Roon's official Linux installer, then keep the service name as `roonbridge.service`. Lyrion is a Squeezelite endpoint (`squeezelite.service`), not a local Lyrion server. Tikpal Multi-room is a Snapcast endpoint on Gentoo: `tikpal-multiroom.service` runs `snapclient` against the configured Snapcast server or future Tikpal room coordinator, and the Settings card should describe it as `Based on: Snapcast endpoint`.

```bash
systemctl status roonbridge.service
systemctl status squeezelite.service
systemctl status tikpal-multiroom.service
test -d /opt/RoonBridge
test -d /var/roon/RoonBridge
```

For the production Gentoo kiosk, install the root-owned helpers and allow only those helpers through sudo:

```bash
install -o root -g root -m 0755 /home/moode/code/tikpal/deploy/moode/tikpal-multiroom-state.sh /usr/local/sbin/tikpal-multiroom-state
install -o root -g root -m 0755 /home/moode/code/tikpal/deploy/moode/tikpal-roonbridge-state.sh /usr/local/sbin/tikpal-roonbridge-state
install -o root -g root -m 0755 /home/moode/code/tikpal/deploy/moode/tikpal-audio-output-profile.sh /usr/local/sbin/tikpal-audio-output-profile
install -o root -g root -m 0755 /home/moode/code/tikpal/deploy/moode/tikpal-mpd-bitperfect-profile.sh /usr/local/sbin/tikpal-mpd-bitperfect-profile
cat >/etc/sudoers.d/tikpal-roonbridge-mpd <<'EOF'
Defaults:moode env_keep += "TIKPAL_MULTIROOM_ROON_SERVICE TIKPAL_MULTIROOM_ROON_LABEL TIKPAL_MULTIROOM_LYRION_SERVICE TIKPAL_MULTIROOM_LYRION_LABEL TIKPAL_MULTIROOM_TIKPAL_SERVICE TIKPAL_MULTIROOM_TIKPAL_LABEL TIKPAL_ROONBRIDGE_SERVICE TIKPAL_ROONBRIDGE_LABEL TIKPAL_MPD_CONF TIKPAL_MPD_STANDARD_ALSA_DEVICE TIKPAL_MPD_PURE_ALSA_DEVICE TIKPAL_MPD_BITPERFECT_ALSA_DEVICE TIKPAL_MPD_SLEEP_SAMPLE_RATE TIKPAL_MPD_SLEEP_VOLUME_LIMIT TIKPAL_MPD_CUSTOM_OUTPUT_NAME TIKPAL_MPD_CUSTOM_ALSA_DEVICE TIKPAL_MPD_CUSTOM_PURE_DIRECT TIKPAL_MPD_CUSTOM_VOLUME_NORMALIZATION TIKPAL_MPD_CUSTOM_SMOOTH_TRANSITION TIKPAL_MPD_CUSTOM_AUTOMATIC_SAMPLE_RATE TIKPAL_MPD_CUSTOM_DSD_MODE TIKPAL_MPD_CUSTOM_PLAYBACK_STABILITY TIKPAL_MPD_CUSTOM_MIXER_TYPE TIKPAL_MPD_CUSTOM_REPLAY_GAIN_HANDLER TIKPAL_MPD_CUSTOM_FORMAT TIKPAL_MPD_CUSTOM_FIXED_SAMPLE_RATE TIKPAL_MPD_CUSTOM_REPLAYGAIN TIKPAL_MPD_CUSTOM_CROSSFADE TIKPAL_AUDIO_CARD_FORCE"
moode ALL=(root) NOPASSWD:SETENV: /usr/local/sbin/tikpal-multiroom-state, /usr/local/sbin/tikpal-roonbridge-state, /usr/local/sbin/tikpal-audio-output-profile, /usr/local/sbin/tikpal-mpd-bitperfect-profile
EOF
chmod 0440 /etc/sudoers.d/tikpal-roonbridge-mpd
visudo -cf /etc/sudoers.d/tikpal-roonbridge-mpd
```

Recommended Gentoo `.env` values:

```conf
TIKPAL_MULTIROOM_ROON_SERVICE=roonbridge.service
TIKPAL_MULTIROOM_ROON_READY_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state roon ready"
TIKPAL_MULTIROOM_ROON_ACTIVE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state roon active"
TIKPAL_MULTIROOM_ROON_ENABLE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state roon enable"
TIKPAL_MULTIROOM_ROON_DISABLE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state roon disable"
TIKPAL_MULTIROOM_ROON_LABEL_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state roon label"
TIKPAL_MULTIROOM_LYRION_SERVICE=squeezelite.service
TIKPAL_MULTIROOM_LYRION_READY_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state lyrion ready"
TIKPAL_MULTIROOM_LYRION_ACTIVE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state lyrion active"
TIKPAL_MULTIROOM_LYRION_ENABLE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state lyrion enable"
TIKPAL_MULTIROOM_LYRION_DISABLE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state lyrion disable"
TIKPAL_MULTIROOM_LYRION_LABEL_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state lyrion label"
TIKPAL_MULTIROOM_TIKPAL_SERVICE=tikpal-multiroom.service
TIKPAL_MULTIROOM_TIKPAL_READY_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state tikpal ready"
TIKPAL_MULTIROOM_TIKPAL_ACTIVE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state tikpal active"
TIKPAL_MULTIROOM_TIKPAL_ENABLE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state tikpal enable"
TIKPAL_MULTIROOM_TIKPAL_DISABLE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state tikpal disable"
TIKPAL_MULTIROOM_TIKPAL_LABEL_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state tikpal label"
TIKPAL_ROONBRIDGE_SERVICE=roonbridge.service
TIKPAL_ROONBRIDGE_READY_COMMAND="sudo -n -E /usr/local/sbin/tikpal-roonbridge-state ready"
TIKPAL_ROONBRIDGE_ACTIVE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-roonbridge-state active"
TIKPAL_ROONBRIDGE_ENABLE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-roonbridge-state enable"
TIKPAL_ROONBRIDGE_DISABLE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-roonbridge-state disable"
TIKPAL_ROONBRIDGE_LABEL_COMMAND="sudo -n -E /usr/local/sbin/tikpal-roonbridge-state label"
```

Active multi-room playback means the ecosystem process is holding an ALSA PCM device, not merely that a systemd service is running. Roon matches `RoonBridge|RAATServer`, Lyrion matches `squeezelite`, and Tikpal Multi-room matches `tikpal-multiroom|snapclient|snapserver`. When active, Tikpal reports the ecosystem as the current playback source, pauses local MPD files, stops MPD Radio streams, and does not claim fake metadata, artwork, or lyrics. Stopping an ecosystem restores only the MPD/Radio playback that was active when that same ecosystem was started, and only if no other multi-room player is active.

If `tikpal-multiroom.service` is installed as a local Snapcast endpoint, keep it disabled by default until the user turns Tikpal Multi-room on in Settings. The service should be safe to start and stop repeatedly; the active check still depends on ALSA ownership so an idle `snapclient` does not make Tikpal claim room playback.

Validation:

```bash
curl -fsS http://127.0.0.1:8787/api/v1/multiroom
curl -fsS http://127.0.0.1:8787/api/v1/roonbridge
sudo -n -E /usr/local/sbin/tikpal-multiroom-state roon active
sudo -n -E /usr/local/sbin/tikpal-multiroom-state lyrion ready
sudo -n -E /usr/local/sbin/tikpal-roonbridge-state active
sudo fuser -v /dev/snd/*
mpc status
```

### Audio Output Profiles

Settings -> Preferences -> Audio Output exposes four MPD listening profiles:

- `Pure Listening` rewrites only the Tikpal-managed MPD output block, backs up `/etc/mpd.conf`, uses a real hardware ALSA device such as `hw:CARD=BT66,DEV=0`, sets `mixer_type "none"`, disables ReplayGain handling, avoids output `format` conversion, and locks MPD software volume. User-facing volume still adjusts the output level through `TIKPAL_OUTPUT_VOLUME_SET_COMMAND` when that helper is configured; it must not be silently disabled just because MPD software volume is locked.
- `Everyday` is the default. It keeps `_audioout`, MPD software volume, ReplayGain auto, two-second crossfade, and the shared route that works well with Tikpal Library and Radio.
- `Sleep / Meditation` keeps `_audioout`, sets MPD output `format "48000:*:*"`, uses ReplayGain track, five-second crossfade, caps MPD/Radio volume at `45%`, and schedules MPD stop after 60 minutes. [MPD documents audio output `format`](https://mpd.readthedocs.io/en/stable/mpd.conf.5.html#audio-output) as `sample_rate:bits:channels`, and any field can be `*` when it should not be forced.
- `Custom` uses six user-facing switches saved in `.tikpal/ui-preferences.json`: `Pure Direct`, `Volume Normalization`, `Smooth Transition`, `Automatic Sample Rate`, `DSD Mode`, and `Playback Stability`. The API passes those switches to the root helper as `TIKPAL_MPD_CUSTOM_*` environment flags whenever Custom is applied. Keep lower-level buffer, IRQ, and resampler details in Audio Diagnostics, not in the normal user flow.

Custom is intentionally treated as an advanced path. The kiosk UI shows a short red caution line above the custom switches, and copy should stay concise enough that it does not push the switch grid below the 2560 x 720 Settings viewport.

Custom switch mapping:

- `Pure Direct`: uses the real hardware ALSA device and `mixer_type "none"`.
- `Volume Normalization`: uses MPD ReplayGain auto unless Pure Direct is on.
- `Smooth Transition`: sets MPD crossfade to 2 seconds.
- `Automatic Sample Rate`: leaves MPD output `format` unset; when off, Custom fixes `format` to `48000:*:*` by default.
- `DSD Mode`: writes MPD ALSA `dop "yes"` for DSD-over-PCM. Only enable it for DACs known to support DoP.
- `Playback Stability`: writes conservative ALSA `buffer_time` / `period_time` values for fewer underruns.

The legacy `tikpal-mpd-bitperfect-profile` helper remains as a wrapper: `strict` maps to `pure`, and `standard` maps to `everyday`.

Recommended Gentoo `.env` values:

```conf
TIKPAL_AUDIO_OUTPUT_PROFILE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-audio-output-profile %PROFILE%"
TIKPAL_MPD_BITPERFECT_PROFILE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-mpd-bitperfect-profile %MODE%"
TIKPAL_MPD_STANDARD_ALSA_DEVICE=_audioout
TIKPAL_MPD_PURE_ALSA_DEVICE=hw:CARD=BT66,DEV=0
TIKPAL_MPD_BITPERFECT_ALSA_DEVICE=hw:CARD=BT66,DEV=0
TIKPAL_MPD_SLEEP_SAMPLE_RATE=48000
TIKPAL_MPD_SLEEP_VOLUME_LIMIT=45
TIKPAL_MPD_CUSTOM_OUTPUT_NAME="Tikpal Custom"
TIKPAL_MPD_CUSTOM_ALSA_DEVICE=_audioout
TIKPAL_MPD_CUSTOM_PURE_DIRECT=0
TIKPAL_MPD_CUSTOM_VOLUME_NORMALIZATION=1
TIKPAL_MPD_CUSTOM_SMOOTH_TRANSITION=1
TIKPAL_MPD_CUSTOM_AUTOMATIC_SAMPLE_RATE=1
TIKPAL_MPD_CUSTOM_DSD_MODE=0
TIKPAL_MPD_CUSTOM_PLAYBACK_STABILITY=1
TIKPAL_MPD_CUSTOM_MIXER_TYPE=
TIKPAL_MPD_CUSTOM_REPLAY_GAIN_HANDLER=
TIKPAL_MPD_CUSTOM_FORMAT=
TIKPAL_MPD_CUSTOM_FIXED_SAMPLE_RATE=48000
TIKPAL_MPD_CUSTOM_REPLAYGAIN=
TIKPAL_MPD_CUSTOM_CROSSFADE=
```

`Pure Listening` is intentionally not the default. It can make MPD software volume, Loopback spectrum, ReplayGain, and shared-output convenience unavailable. However, the Player/side-panel volume slider should remain usable on Gentoo when the output-volume helper can write the hardware or system output level. Roon, AirPlay, Spotify, DLNA, Explore, and provider audio are outside these MPD presets.

Profile switching must stay bounded. The helper now wraps `mpc` and `systemctl` calls with short timeouts, stops a stuck `mpd.service` with a bounded SIGTERM/SIGKILL fallback, enables only the selected Tikpal-managed MPD output, and applies ReplayGain/crossfade/volume settings through best-effort `mpc` calls. The API wraps profile changes in the MPD mutation lock, captures current MPD/Radio playback before the helper runs, then performs only a short best-effort restore instead of waiting indefinitely for MPD to prove `playing`. This avoids a successful profile change looking like a failed Settings action when MPD or a NAS-backed queue responds slowly.

Useful tuning knobs:

| Variable | Default | Purpose |
| --- | --- | --- |
| `TIKPAL_MPC_TIMEOUT_SECONDS` | `1` | Per-`mpc` command timeout inside the root helper. |
| `TIKPAL_MPD_STOP_TIMEOUT_SECONDS` | `2` | Time allowed for a clean MPD stop before forced recovery. |
| `TIKPAL_MPD_START_TIMEOUT_SECONDS` | `5` | Time allowed for MPD start after profile rewrite. |
| `TIKPAL_AUDIO_OUTPUT_RESTORE_MPC_TIMEOUT_MS` | `1000` | API-side `mpc` timeout during playback restore. |
| `TIKPAL_AUDIO_OUTPUT_RESTORE_ATTEMPTS` | `2` | API-side best-effort `mpc play` attempts after a profile switch. |
| `TIKPAL_AUDIO_OUTPUT_RESTORE_SETTLE_MS` | `200` | Short settle between restore attempts. |

Do not reintroduce long profile-change loops that block the Preferences request. The frontend allows a longer Preferences write timeout for real MPD profile changes, but the backend should normally return in a few seconds and let regular state polling refresh playback truth.

Validation:

```bash
sudo -n -E /usr/local/sbin/tikpal-audio-output-profile pure
mpc clear && mpc add "Codex/<known-flac-or-wav>" && mpc play
cat /proc/asound/card*/pcm*p/sub*/hw_params
sudo -n -E /usr/local/sbin/tikpal-audio-output-profile everyday
sudo -n -E /usr/local/sbin/tikpal-audio-output-profile sleep
sudo -n -E /usr/local/sbin/tikpal-audio-output-profile diagnostics
curl -fsS http://127.0.0.1:8787/api/v1/audio/output-diagnostics
```

API timing check from the Gentoo host:

```bash
for profile in everyday sleep custom pure; do
  start=$(date +%s%3N)
  curl -fsS -X PATCH http://127.0.0.1:8787/api/v1/preferences \
    -H "Content-Type: application/json" \
    --data "{\"audioOutputProfile\":\"$profile\"}" >/dev/null
  end=$(date +%s%3N)
  printf '%s %sms\n' "$profile" "$((end-start))"
  mpc status | sed -n '1,3p'
done
```

On the 2026-08-01 Gentoo `192.168.10.115` validation run, `Custom`, `Sleep`, and `Pure Listening` returned in roughly `0.7s-3.1s` after the bounded restore change. The first `Sleep -> Everyday` switch could still take around `7s-8s` while MPD reopened the shared output path, but it no longer timed out and playback recovered.

On the same host, Pure Listening / strict mode was validated with Radio playing: `POST /api/v1/playback/actions {"type":"volume_set","value":46}` moved `system.volume.percent` from `45` to `46`, and a second write restored `45` without interrupting Radio playback. This is the expected contract: MPD software volume stays locked for the direct-output profile, while the physical output level remains adjustable.

## Explore Provider Mode

Explore is not a restorable Tikpal audio source. It pauses local MPD/Radio, releases external receiver intakes, and opens a provider web player in a separate left Chromium window. The side panel remains a local Tikpal surface.

The physical layout is fixed:

| Surface | Geometry |
| --- | --- |
| Main Tikpal kiosk | `2560x720` at `0,0` |
| Explore provider | `1920x720` at `0,0` |
| Explore side panel | `640x720` at `1920,0` |

The physical Gentoo path uses a resident provider pool by default:

```conf
TIKPAL_WEB_MODE_PROVIDER_POOL=1
TIKPAL_WEB_MODE_PROVIDER_PREWARM_ENABLED=1
TIKPAL_WEB_MODE_PROVIDER_PREWARM_DELAY_SECONDS=0.75
TIKPAL_WEB_MODE_PROVIDER_PREWARM_LOCK_TIMEOUT_SECONDS=2
```

Opening Explore starts the requested provider first, then prewarms the remaining fixed providers in the offscreen stage at `2560,0`: Suno, Spotify, YouTube Music, Apple Music, TIDAL, Qobuz, Deezer, Amazon Music, QQ Music, and NetEase Cloud Music. Background prewarm is intentionally window/guard-only: it should not wait for a slow provider page to become fully ready before moving to the next provider, and it uses a short launch-lock wait so an existing YouTube Music launch cannot stall the rest of the queue. The launcher seeds queued providers as `Prewarming` before their individual launch turn, then the per-provider guard promotes them to `Ready` once CDP reports an expected real provider URL; `Opening` is reserved for the provider the user explicitly selected. When Proxy is off, the launcher must run a short direct reachability probe against each provider's own URL; only providers that fail that probe are marked internally as `check_proxy`, shown to the user as `Need Proxy On`, and skipped, while direct-reachable providers continue to open or prewarm. Switching to an already resident provider must stop the background prewarm job, reveal and focus the existing provider window, restart its per-provider guard, and update `activeProvider`; it must not re-run the first-load readiness gate or roll back to the previous provider just because a site like YouTube Music, Apple Music, TIDAL, or Deezer has a slow provider-ready probe. Background providers stay muted and page-paused through the provider audio gate. Returning to a resident provider must clear tab mute, unmute media elements, and resume only the media that was playing when the provider was hidden. Repeated inactive guard polling must not overwrite that resume intent after the page is already paused. If an offscreen prewarm times out before the SPA reaches its real host, the per-provider guard must later clear stale `check_setup` once CDP reports an expected provider URL such as `https://tidal.com/`. `deploy/chromium/tikpal-web-mode.sh close` is the boundary that closes all resident providers and the side panel.

Proxy On/Off is treated as a reachability change for the entire resident pool. After the extension applies the new proxy mode to the active provider, the launcher restarts background prewarm with a forced seed so inactive cards move back through `Prewarming` and re-evaluate to `Ready` or `Need Proxy On` instead of keeping stale status. Existing inactive provider processes are not killed, but forced prewarm navigates their CDP page target back to the provider URL so a previous Tikpal error page or network timeout is retried under the new proxy mode.

The proxy truth is `.tikpal/web-mode-settings.json`; the launcher fallback should prefer a proxy on the same Gentoo host:

```conf
TIKPAL_WEB_MODE_DEFAULT_PROXY_URL=http://127.0.0.1:7897
```

If the proxy runs on a separate LAN machine, set it in Settings -> Link -> Explore Proxy or in `.tikpal/web-mode-settings.json`, for example `http://192.168.10.148:7897`. Do not leave a DHCP-specific proxy IP hard-coded in the repo defaults.

Changing proxy state uses the MV3 extension and refreshes the active provider page while keeping its profile and window. The side panel toggle must read `Proxy On` or `Proxy Off`; do not use `Direct` as the visible switch state because direct mode still cannot reach several providers on this network. Cookies and login state stay in per-provider Chromium profiles under:

```bash
/home/moode/.config/tikpal-web-mode/providers/<provider>
```

The provider text-size control uses `providerTextScale`:

| UI | Value | Behavior |
| --- | --- | --- |
| Small | `1.00` | Restore provider text elements to original font sizes. |
| Medium | `1.10` | Increase detected text elements by 10 percent. |
| Large | `1.20` | Increase detected text elements by 20 percent. |

This must never use Chrome tab zoom or `--force-device-scale-factor`. The viewport must stay `1920x720`, `devicePixelRatio` must stay `1`, and Chromium must not show the top-right `-/+` zoom bubble. The content script only adjusts visible text-bearing elements and skips media, SVG, canvas, video, and script surfaces.

Provider guard behavior:

- Blocks browser zoom keyboard and gesture shortcuts inside provider pages.
- Retargets `_blank` links into the same provider window.
- Keeps QQ Music single-pane and closes duplicate QQ player windows.
- May close safe cookie/trial/client prompts, but must not click login, payment, membership, subscription, purchase, authorization, or native-client download actions.
- For QQ Music, may unmute the web player when playback is active but the QQ volume button is muted.
- QQ Music MV uses wrapper cinema mode by default: `TIKPAL_WEB_MODE_QQ_MV_CINEMA_MODE=1`, `TIKPAL_WEB_MODE_QQ_MV_AUTO_PLAY=1`, and `TIKPAL_WEB_MODE_QQ_MV_AUTO_FULLSCREEN=0`.
- MV cinema mode must not click QQ Music's fullscreen button, call `requestFullscreen()`, press `F11`, retile Chromium, or hide the right side panel. It only applies CSS/DOM inside the left `1920x720` provider page so the largest visible MV `<video>` sits on a black `100vw x 100vh` stage with `object-fit: contain`.
- MV cinema mode hides QQ page chrome, comments, feedback/report/player controls, and injects icon-only controls in the lower-right corner. The playlist icon keeps `aria-label/title="播放列表"` and uses provider history to return to the QQ playlist, with `https://y.qq.com/n/ryqq/player` as the fallback. The replay icon keeps `aria-label/title="重播"` and is visible only when the MV has ended or is within `0.75s` of the end; clicking it immediately hides the replay icon, seeks the current cinema video to `0`, calls `play()`, and refreshes state from video events. MV completion must not auto-return, auto-replay, or auto-start the next item.
- MV cinema mode computes the real video ratio and overlays subtle dark ambience only on the letterbox bars. It keeps `object-fit: contain`, does not crop subtitles or picture content, does not draw blue/cyan frame lines, and leaves the overlay `pointer-events:none` so video and controls remain clickable.
- MV auto-play is conditional: if cinema mode sees the video still paused near `0s` with no progress for about two seconds, it starts the selected cinema `<video>` once. QQ's video-center click path is not reliable on the Gentoo physical kiosk, so the guard does not depend on it. If the MV is already playing, has advanced past the start, or is manually paused after playback began, it does not start it again.
- If QQ shows `播放失败，请刷新页面重试` / `错误码undefined`, the guard removes the cinema wrapper and does not click retry. Stable playback has priority over visual automation.

## Input And Fonts

Gentoo uses Fcitx5 and Onboard for physical-kiosk input. The kiosk session exports:

```conf
GTK_IM_MODULE=fcitx
QT_IM_MODULE=fcitx
XMODIFIERS=@im=fcitx
```

The Fcitx5 profile contains these input methods:

```text
keyboard-us
pinyin
keyboard-de
keyboard-it
hangul
anthy
keyboard-es
```

Onboard cycles modes through one Tikpal IME key:

```text
EN -> Chinese -> German -> Italian -> Korean -> Japanese -> ES -> EN
```

Chinese and Japanese keep QWERTY letter keys because users type pinyin and romaji. German, Italian, Spanish, and Korean use visual keycap variants for their expected layouts: German shows QWERTZ plus `Ä/Ö/Ü/ß`, Italian shows `à/è/ì/ò/ù`, Spanish shows `Ñ`, `¡ ¿`, accent/dead-key hints, and `Ç`, and Korean shows 2-beolsik Hangul hints. The key labels change to reflect the current mode; the underlying Onboard key IDs stay compatible with XTest.

On Gentoo, Korean input needs `app-i18n/fcitx-hangul` in addition to the existing `app-i18n/fcitx`, `app-i18n/fcitx-chinese-addons`, `app-i18n/fcitx-anthy`, `app-i18n/fcitx-gtk`, and `app-i18n/fcitx-qt` packages. German, Italian, and Spanish are Fcitx keyboard layouts and do not need extra candidate engines.

Install and verify the multilingual UI font set before judging Chromium rendering:

```bash
emerge --ask=n media-fonts/noto-cjk media-fonts/noto-emoji media-fonts/source-han-sans media-fonts/wqy-zenhei media-fonts/inter media-fonts/roboto media-fonts/fira-sans media-fonts/nanum
fc-cache -fv
fc-match 'sans:lang=zh-cn'
fc-match 'sans:lang=ja'
fc-match 'sans:lang=ko'
fc-match 'serif:lang=zh-cn'
fc-match 'monospace:lang=zh-cn'
```

Tikpal's Settings -> Font presets are intentionally curated rather than a full system-font browser:

| Preset | Primary intent |
| --- | --- |
| System Neo | Inter plus Noto CJK fallback for the regular device UI. |
| CJK Sans | Noto Sans CJK SC / JP / KR for Chinese, Japanese, and Korean UI. |
| Source Han | Source Han Sans CN first, useful when Simplified Chinese is the dominant language. |
| Editorial CJK | Noto Serif CJK for lyric walls and warmer reading surfaces. |
| Modern Sans | Inter / Roboto / Fira Sans for Latin-language UI, with CJK fallback. |
| Mono Grid | Noto Sans Mono CJK plus mono fallbacks for technical-looking surfaces. |

Candidate fonts follow the active input mode: Chinese uses `Noto Sans CJK SC 16`, Japanese uses `Noto Sans CJK JP 16`, Korean uses `Noto Sans CJK KR 16`, and all fall back to `Source Han Sans CN 16` or `WenQuanYi Zen Hei 16`. The regular UI font stack must keep CJK coverage so Chromium does not fall back to Liberation for Chinese.

Onboard keycap labels should follow Settings -> Font. The kiosk writes the active `fontTheme` into `.tikpal/ui-preferences.json`; the API persists it through `/api/v1/preferences`, and `tikpalImeToggle.py` reads that file before setting Onboard's `org.onboard.theme-settings key-label-font`. Language changes still use `--set-mode` / `--set-locale`; font-only changes use the lighter `--sync` path so the user does not lose a temporary input-method choice.

The Onboard language key keeps its own runtime cycle state in `.tikpal/onboard-ime-state.json` and `~/.config/tikpal/onboard-ime-state.json`. This is deliberate: relying only on `fcitx5-remote -n` during a touch click can bounce between `keyboard-us` and `pinyin` while Onboard reloads layouts. The no-argument `tikpalImeToggle.py` path is the live Onboard key path; it reads that runtime state, advances to the next mode, writes Fcitx `DefaultIM`, switches the current input method, applies the matching layout, and asks Onboard to stay visible. `--set-mode`, `--set-locale`, and `--sync` remain safe for Settings/API preference sync and do not pop the keyboard open unexpectedly.

Local kiosk text fields, including Settings -> Library -> NAS Add/Edit, request Onboard with `keyboardTarget:"kiosk"`. The API passes this as `TIKPAL_WEB_MODE_KEYBOARD_TARGET=kiosk`, and `tikpal-web-mode.sh` restores X focus to the main kiosk Chromium profile after the Onboard window is raised. Provider pages keep the default `auto` target, so Explore login fields still use provider-focused recovery instead of stealing focus back to the kiosk.

The default API hooks on Gentoo are:

```conf
TIKPAL_UI_INPUT_METHOD_SYNC_COMMAND='if [ -f /usr/share/onboard/scripts/tikpalImeToggle.py ]; then TIKPAL_APP_DIR=%APP_DIR% TIKPAL_FONT_THEME=%FONT_THEME% python3 /usr/share/onboard/scripts/tikpalImeToggle.py --set-mode %INPUT_METHOD%; fi'
TIKPAL_UI_KEYBOARD_VISUAL_SYNC_COMMAND='if [ -f /usr/share/onboard/scripts/tikpalImeToggle.py ]; then TIKPAL_APP_DIR=%APP_DIR% TIKPAL_FONT_THEME=%FONT_THEME% python3 /usr/share/onboard/scripts/tikpalImeToggle.py --sync; fi'
```

Expected keycap font examples:

| Font preset | Typical Onboard `key-label-font` |
| --- | --- |
| System Neo | `Inter 12` |
| CJK Sans | `Noto Sans CJK SC 12` |
| Source Han | `Source Han Sans CN 12` |
| Editorial CJK | `Noto Serif CJK SC 12` |
| Modern Sans | `Inter 12`, `Roboto 12`, or `Fira Sans 12` depending on installed packages. |
| Mono Grid | `Noto Sans Mono CJK SC 11` |

Third-party fonts such as MiSans, HarmonyOS Sans, or LXGW WenKai are optional drop-ins. Place `.ttf` / `.otf` files under `/usr/local/share/fonts/tikpal/`, run `fc-cache -fv`, verify with `fc-match`, and only then add the family to Tikpal's font stack.

Tikpal UI language and font choice are device preferences, not browser-only settings. The backend stores them in:

```bash
/home/moode/code/tikpal/.tikpal/ui-preferences.json
```

The supported locales are `en`, `zh-CN`, `de`, `it`, `ko`, `ja`, and `es`. The supported font themes are `system`, `hardware`, `precision`, `sans`, `serif`, and `mono`. The kiosk, Explore side panel, portable Remote, and Tikpal-owned Explore error page read the same preference through `GET /api/v1/preferences`; only the local kiosk should write it through `PATCH /api/v1/preferences`. `GET /api/v1/system/state`, `/api/v1/remote/state`, and `/api/v1/web-mode/state` also include `preferences` so surfaces can stay in sync after polling.

Changing Settings -> Preferences -> Language also selects the matching default input method:

| Locale | Fcitx input method |
| --- | --- |
| `en` | `keyboard-us` |
| `zh-CN` | `pinyin` |
| `de` | `keyboard-de` |
| `it` | `keyboard-it` |
| `ko` | `hangul` |
| `ja` | `anthy` |
| `es` | `keyboard-es` |

`start-tikpal-kiosk-session.sh` reads `.tikpal/ui-preferences.json` before starting Fcitx5 and writes the matching `DefaultIM`. `tikpalImeToggle.py --set-locale <locale>` and `--set-mode <fcitx-id>` are the best-effort runtime sync hooks used after a language change; failure to sync the keyboard should be logged as a warning, not block saving the UI language.

Onboard should only appear for text-like fields after real focus or tap. It should stay hidden for buttons, checkboxes, selectors, provider entry, and LAN browsers that view `http://<gentoo-ip>:4173/`.

Never start Fcitx as root. `tikpalImeToggle.py` refuses root execution unless `TIKPAL_ALLOW_ROOT_IME_SYNC=1` is explicitly set for a controlled diagnostic. A root-owned Fcitx instance can steal the X/DBus input context from the `moode` kiosk session and make Chinese/Japanese/Korean candidate entry feel intermittent.

## Player Library UX

The Gentoo physical kiosk uses the same Player Library contract as moOde:

- `Local`, `NAS`, `USB`, `Favorites`, and `Recently Added` are flat storage/filter tabs.
- Local, NAS, and USB rows show compact audio/file information when the backend exposes codec, sample rate, bit depth, channel count, bitrate, or file size.
- Keep `TIKPAL_USB_LIBRARY_AUTO_UPDATE=0` on the physical Gentoo kiosk. Browsing USB can scan the mounted filesystem for visible rows, but it should not launch `mpc update USB` in the background while the user seeks or plays Local/NAS music. Gentoo may set `TIKPAL_USB_LIBRARY_AUTO_MOUNT=1` so the library sync helper waits briefly for newly inserted USB storage, mounts current partitions under `/run/media/tikpal/<label-or-uuid>`, then links them into `USB/<mount name>`; this is generic for swapped USB drives and is not tied to `/dev/sda1`. Do not keep legacy 30-second USB sync timers such as `tikpal-usb-audio-sync.timer` enabled on the physical kiosk; use Settings -> Library -> Scan library for an explicit MPD index refresh, with `TIKPAL_MPC_UPDATE_TIMEOUT_SECONDS=8` as the default guardrail.
- USB rows expose `Copy to Local`; the backend should not overwrite same-name Local files and should report `Already in Local` when no copy is needed. Copied files live under `Codex/USB Imports/...`; `tikpal-local-library-sync.sh` must protect that imports directory while still using `rsync --delete` for repo-owned Local music, so copied tracks survive reboot and service reinstall.
- Local rows expose `Delete`, but the first tap only reveals `Yes` and `No`. Only `Yes` performs deletion; `No`, storage changes, source changes, or closing Player must cancel the pending confirmation.
- Player -> Library has a compact search field beside volume/free-space/Back. It filters only the currently selected `Local`, `USB`, `NAS`, or `Favorites` tab using visible track metadata and path text; it must not send source-switch requests, change the MPD queue, or search Radio stations.
- The rightmost Library row checkmark represents the current MPD track, not just the row last selected for browsing. Previous/next playback must update the checkmark and scroll the current row into view without switching storage tabs.
- Long track lists keep a fixed right-side fast-scroll rail with `current / total` count and a draggable thumb. Dragging that rail only changes `scrollTop`; it must not select a track or auto-play on release.

NAS v1 is configured by the user in Settings rather than silently attached from a LAN scan. The backend may still read legacy manual roots from `TIKPAL_NAS_LIBRARY_ROOTS`, but those entries are marked `Manual` in Settings and should be treated as compatibility input. New setups should use Settings -> Library -> NAS:

```conf
TIKPAL_NAS_SOURCES_STATE_PATH=/home/moode/code/tikpal/.tikpal/nas-sources.json
TIKPAL_NAS_CREDENTIALS_DIR=/home/moode/code/tikpal/.tikpal/nas-credentials
TIKPAL_NAS_MOUNT_ROOT=/mnt/tikpal-nas
TIKPAL_NAS_MPD_ENTRY_ROOT=/var/lib/mpd/music/NAS
TIKPAL_NAS_AUTO_MOUNT=1
TIKPAL_NAS_MOUNT_COMMAND="sudo -n -E /usr/local/sbin/tikpal-nas-mount mount"
TIKPAL_NAS_UNMOUNT_COMMAND="sudo -n -E /usr/local/sbin/tikpal-nas-mount unmount"
TIKPAL_NAS_LIBRARY_MPD_PREFIX=NAS
TIKPAL_NAS_LIBRARY_MAX_TRACKS=500
```

Configured NAS sources are stored in `.tikpal/nas-sources.json`. Passwords are not returned to the frontend; username/password credentials are written under `.tikpal/nas-credentials/<id>.cred` with `0600` permissions. The UI password field is masked by default and has a show/hide control for setup. With `TIKPAL_NAS_AUTO_MOUNT=1`, every saved and enabled NAS source is mounted again when `tikpal-api` starts, so swapping to another saved NAS only requires saving/enabling that source once in Settings. A brand-new NAS should still go through Settings -> Library -> NAS -> Add/Test/Save; LAN discovery is only a candidate list and should not silently mount unknown shares.

NAS v1 supports SMB/Samba shares as a client by mounting them through Linux CIFS. Tikpal does not run a Samba server. Mount and test failures shown in Settings must be short and actionable in the NAS header and selected-source card, such as `Login failed. Check username, password, or Guest access.` or `Share or Folder not found. Check Share and Folder.` The raw `mount.cifs` or helper stderr is preserved as `lastRawError` in the API and as the UI `title`, but it should not be the primary visible text on the 2560 x 720 kiosk.

Discovery is only a candidate list. `POST /api/v1/nas/discover` may use `TIKPAL_NAS_DISCOVERY_HINTS` or a host-specific `TIKPAL_NAS_DISCOVERY_COMMAND`, but it must not save, mount, or scan anything until the user selects a candidate, runs `Test`, then uses `Save & Scan`.

Default mount behavior is read-only CIFS:

- Mount share at `/mnt/tikpal-nas/<id>`.
- Bind the selected folder into `/var/lib/mpd/music/NAS/<mountName>`.
- Expose track paths as `NAS/<mountName>/<relative-file>`.
- Try SMB `3.0`, then `2.1`, then `2.0`; save the version that works.
- Use `ro,uid=mpd,gid=audio,iocharset=utf8,nounix,soft`.

`TIKPAL_NAS_LIBRARY_ROOTS` remains only for manual/legacy local mount roots, such as a temporary fake NAS at `/mnt/tikpal-nas-test`; production Gentoo should prefer saved Settings NAS sources.

Install the repo helper as the root-owned command and allow `moode` to run only that helper with preserved `TIKPAL_NAS_*` environment:

```bash
install -o root -g root -m 0755 /home/moode/code/tikpal/deploy/moode/tikpal-nas-mount.sh /usr/local/sbin/tikpal-nas-mount
cat >/etc/sudoers.d/tikpal-nas <<'EOF'
Defaults:moode env_keep += "TIKPAL_NAS_ID TIKPAL_NAS_NAME TIKPAL_NAS_HOST TIKPAL_NAS_PORT TIKPAL_NAS_SHARE TIKPAL_NAS_PATH TIKPAL_NAS_AUTH_MODE TIKPAL_NAS_USERNAME TIKPAL_NAS_CREDENTIALS TIKPAL_NAS_REMOTE TIKPAL_NAS_MOUNT_POINT TIKPAL_NAS_CONTENT_ROOT TIKPAL_NAS_MPD_ENTRY TIKPAL_NAS_MPD_PATH TIKPAL_NAS_SMB_VERSION"
moode ALL=(root) NOPASSWD:SETENV: /usr/local/sbin/tikpal-nas-mount
EOF
chmod 0440 /etc/sudoers.d/tikpal-nas
visudo -cf /etc/sudoers.d/tikpal-nas
```

If a host needs different root policy, replace that helper command but keep the same `TIKPAL_NAS_*` environment contract. Tikpal passes source details through variables including `TIKPAL_NAS_REMOTE`, `TIKPAL_NAS_MOUNT_POINT`, `TIKPAL_NAS_CONTENT_ROOT`, `TIKPAL_NAS_MPD_ENTRY`, and `TIKPAL_NAS_CREDENTIALS`.

Temporary Gentoo validation can still use a high-port SMB share from a developer machine without enabling macOS system file sharing. Mount the test share read-only, expose it to MPD as `NAS/TikpalNAS`, then update MPD. The impacket test server currently negotiates SMB 2.0; a real NAS can use SMB 3.0 when supported.

```bash
mount -t cifs //192.168.10.103/TikpalNAS /mnt/tikpal-nas-test \
  -o port=1445,vers=2.0,guest,ro,uid=mpd,gid=audio,iocharset=utf8
mkdir -p /var/lib/mpd/music/NAS/TikpalNAS
mount --bind /mnt/tikpal-nas-test /var/lib/mpd/music/NAS/TikpalNAS
mpc update NAS
mpc listall NAS/TikpalNAS
curl -fsS 'http://127.0.0.1:8787/api/v1/audio/library?storage=nas&limit=10'
```

The API should expose NAS rows with `storage:"nas"` and `path:"NAS/TikpalNAS/<file>"`; Player Library can play them through MPD, but NAS rows do not show Local delete or USB copy actions. If no NAS is configured, Player -> Library -> NAS should say `Add NAS in Settings.`

Selecting a Library storage tab is a browse-only action. `Local`, `NAS`, `USB`, `Favorites`, and `Recently Added` must not send an empty `POST /api/v1/audio/source` request or restore a default MPD queue just because the user changed tabs. Playback starts only after a track row is tapped:

- Local rows post `{"target":"mpd","localTrackPath":"Codex/..."}` and show `Playing from Local.`
- NAS rows post `{"target":"mpd","localTrackPath":"NAS/<mountName>/..."}` and show `Playing from NAS.`
- USB rows post `{"target":"mpd","localTrackPath":"USB/<mountName>/..."}` and show `Playing from USB.`

This separation matters on the physical kiosk: an empty MPD switch while changing tabs can put the UI into a pending state, restore the wrong Local queue, and swallow the real NAS/USB track tap.

NAS playback should expose `play`, `pause`, `previous`, and `next`, but not `seek`. On CIFS/SMB streams MPD seek can block long enough to look like a broken UI, so `/api/v1/system/state` and `/api/v1/audio/source` responses should return `playback.transportCapabilities.seek=false` for current files under `NAS/...`, and `/api/v1/playback/actions {"type":"seek"}` should fail fast without calling `mpc seek`. If a user needs reliable seeking for a NAS file, copy it to Local first and play the `Codex/USB Imports/...` copy.

Targeted physical-kiosk DOM checks after deploying a frontend build:

```js
(() => {
  const shell = document.querySelector("[data-library-track-list-shell]");
  const list = document.querySelector("[data-library-track-list]");
  const rail = document.querySelector("[data-library-fast-scroll]");
  const thumb = document.querySelector("[data-library-fast-scroll-thumb]");
  return {
    fixedRail: shell instanceof HTMLElement
      && getComputedStyle(shell).gridTemplateColumns.split(" ").length === 2
      && rail instanceof HTMLElement
      && getComputedStyle(rail).position === "relative",
    scrollable: list instanceof HTMLElement && list.scrollHeight > list.clientHeight,
    thumb: thumb instanceof HTMLElement
  };
})()
```

For destructive actions, verify only the confirmation path unless a real deletion is intended:

```js
document.querySelector("[data-library-delete-local]")?.click();
document.querySelector("[data-library-delete-confirm-yes]") !== null;
document.querySelector("[data-library-delete-confirm-no]")?.click();
document.querySelector("[data-library-delete-confirm]") === null;
```

For NAS/USB playback-hint regressions, wrap `window.fetch` in the physical page or DevTools and confirm tab changes do not emit `/api/v1/audio/source`, while the first row tap does emit the right MPD-visible path:

```js
(() => {
  window.__tikpalFetchLog = [];
  const originalFetch = window.__tikpalOriginalFetch || window.fetch.bind(window);
  window.__tikpalOriginalFetch = originalFetch;
  window.fetch = async (...args) => {
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
    const init = args[1] || {};
    if (String(url || "").includes("/api/v1/audio/source")) {
      window.__tikpalFetchLog.push(String(init.body || ""));
    }
    return originalFetch(...args);
  };
  return true;
})()
```

After selecting `NAS` and tapping a NAS row, expect a body containing `NAS/<mountName>/...` and the Player hint `Playing from NAS.` Repeat with `USB/<mountName>/...` and `Playing from USB.`

## Display And Power

Brightness through DDC/CI is display-specific and can be non-linear. The Gentoo target should prefer conservative values that keep the screen visible; do not blindly map UI `100%` to raw DDC `100` if that target can black out or become unreadably dim during gesture changes.

Current low-power policy:

- Keep physical screen on for production use.
- Keep Nouveau and avoid proprietary NVIDIA unless retesting display risk.
- Keep CPU governor `schedutil`.
- Prefer `energy_perf_bias=12` over disabling turbo.
- Do not enable TLP or global USB autosuspend.
- Use DDC brightness conservatively; if a raw DDC value makes the panel unreadable, recover with a known visible value before changing UI mapping.

If the panel looks black while services and X still read healthy, recover the display path before rebooting:

```bash
/usr/local/sbin/tikpal-physical-display-prepare soft-kick
```

That soft-kick sequence:

- Sends DDC power on, brightness `45`, and contrast `50`.
- Leaves VCP `0x60` input source untouched by default because this panel can report a source code that does not match the live Xorg output. If a future unit needs forced HDMI-1, set `TIKPAL_PHYSICAL_DISPLAY_INPUT_SOURCE=0x11` only after confirming that code on the physical monitor.
- Treat DDC readbacks as advisory on this panel. `D6` can drift back to `x02` shortly after a successful power-on write while Xorg, Chromium, and the physical HDMI signal remain healthy, so watchdog recovery must not restart services from that value alone.
- Before kiosk start, waits for `/sys/class/drm/card0-HDMI-A-1/status` to become `connected` and for EDID to be readable, avoiding early Xorg `no screens found`.
- Runs `xset s off`, `xset s noblank`, `xset -dpms`, and `xset dpms force on`.
- Turns `HDMI-1` off briefly, switches it to `1280x720`, waits briefly, then switches back to `2560x720 primary`.
- Reapplies the safe RandR properties (`dithering depth=8 bpc`, `dithering mode=off`, `scaling mode=Full`) when the driver exposes them.
- Sets configured PCI display devices to `power/control=on`; on this host use `0000:03:00.0` for the GTX 750 Nouveau display function and `0000:03:00.1` for its HDMI audio function.
- Optionally sets `/sys/module/drm_kms_helper/parameters/poll` to `N` with `TIKPAL_PHYSICAL_DISPLAY_DRM_POLL=0`, reducing connector polling against unused DVI outputs.
- Raises the Chromium kiosk window.
- Runs delayed soft-kicks around `8s` and `25s` after kiosk start to mimic the part of a physical replug that wakes this panel after Chromium and Xorg settle.
- Uses `xkbcomp` to replace display power keysyms such as `XF86PowerOff`, `XF86Sleep`, `XF86Suspend`, `XF86Display`, and `XF86ScreenSaver` with `NoSymbol`; ordinary typing and Fcitx/Onboard input are left alone.

If `soft-kick` cannot recover a visible panel and a physical HDMI replug has been proven to fix it, the second-stage fallback is a Nouveau PCI rebind:

```bash
systemctl stop tikpal-kiosk.service
TIKPAL_KIOSK_ENV_FILE=/home/moode/code/tikpal/.env.kiosk \
  /usr/local/sbin/tikpal-physical-display-prepare nouveau-rebind
systemctl start tikpal-kiosk.service
```

The watchdog now runs the same helper in `--check` mode. If the physical display check fails, it tries `soft-kick` first, then an optional `nouveau-rebind` when `TIKPAL_KIOSK_PHYSICAL_DISPLAY_GPU_REBIND_BEFORE_RESTART=1`, and only restarts `tikpal-kiosk.service` when the display helper cannot recover the X/HDMI state. It still does not restart API, web, MPD, or audio services for ordinary display recovery.

Important limitation: this panel can be black to the eye while DRM, RandR, DDC, Chromium, and heartbeat all report healthy. In that exact state, software has no reliable visual sensor. The PCI `power/control=on` baseline and delayed kicks reduce the chance of recurrence; the proven recovery path is `nouveau-rebind`, with a physical HDMI replug as the final fallback if the panel receiver firmware ignores every software kick.

## Validation

2026-07-30 physical-kiosk validation on `192.168.10.117`:

- `systemctl is-system-running` returned `running`, and `systemctl --failed` returned `0`.
- `tikpal-api`, `tikpal-web`, `tikpal-kiosk`, and `mpd` were active after the library and seek fixes.
- `tikpal-usb-audio-sync.timer` was disabled and inactive. Keep it that way unless its helper is changed to avoid periodic `mpc update USB`.
- Local library sync preserved `Codex/USB Imports/...` while pruning stale repo-owned files. This protects `Copy to Local` imports across reboot and service reinstall.
- `/api/v1/audio/library?storage=local` returned Local tracks, and MPD `listall Codex` returned the same MPD-visible library root.
- Local MPD playback accepted repeated seek actions through `/api/v1/playback/actions` without an `mpc ... seek ... timed out` error after USB auto-update was disabled.
- Browsing USB via `/api/v1/audio/library?storage=usb` did not spawn a background `mpc update USB` process.
- The Player header should keep the Volume slider and Local storage meter aligned as one group, with a readable free-space label and visible spacing before the Back button.

Baseline service checks:

```bash
systemctl is-system-running
systemctl --failed
systemctl is-active tikpal-api tikpal-web tikpal-audio-adapt tikpal-library-sync tikpal-kiosk tikpal-kiosk-watchdog.timer
curl -fsS http://127.0.0.1:8787/api/v1/health
curl -fsSI http://127.0.0.1:4173/
```

Physical display checks:

```bash
DISPLAY=:0 XAUTHORITY=/home/moode/.Xauthority xrandr --query
DISPLAY=:0 XAUTHORITY=/home/moode/.Xauthority xdotool search --onlyvisible --name ".*" getwindowname %@ getwindowgeometry %@
curl -fsS http://127.0.0.1:8787/api/v1/kiosk/heartbeat | jq '{healthy,status,ageMs,reasons,ignoredReasons,visibility:.heartbeat.visibility,eventLoop:.heartbeat.eventLoop}'
```

When Explore is active, the main Tikpal kiosk page can become Chromium-hidden behind the visible provider / side-panel windows. Browser timer throttling may then report a large `eventLoop.lagMs` or delay the next heartbeat past the normal 30s visible-page stale threshold. These are diagnostic only and should appear under `ignoredReasons` as `event-loop-lag:hidden-page` or `heartbeat-stale:hidden-page`, not as restart reasons. Hidden pages use `TIKPAL_KIOSK_HEARTBEAT_HIDDEN_STALE_MS` (`120000` by default) before becoming truly stale. A stale visible heartbeat, visible-page event-loop lag, stuck pending action, or scene-video failure remains unhealthy.

Explore checks:

```bash
cd /home/moode/code/tikpal
deploy/chromium/tikpal-web-mode.sh --check
curl -fsS -X POST http://127.0.0.1:8787/api/v1/web-mode/actions \
  -H "Content-Type: application/json" \
  --data '{"type":"open","provider":"qq_music"}'
curl -fsS http://127.0.0.1:9241/json/list
```

Resident-provider switching checks should cover at least one Chinese provider and several slow western providers:

```bash
for provider in youtube_music apple_music tidal deezer qq_music; do
  curl -fsS -H "Content-Type: application/json" \
    -X POST http://127.0.0.1:8787/api/v1/web-mode/actions \
    --data "{\"type\":\"open\",\"provider\":\"$provider\"}" |
    jq '{activeProvider,lastError,current:.residentProviders[$activeProvider]}'
done

DISPLAY=:0 XAUTHORITY=/home/moode/.Xauthority \
  xdotool search --onlyvisible --class chromium \
  getwindowname %@ getwindowgeometry %@
```

Expected geometry after switching: the active provider is at `0,0 1920x720`, the side panel is at `1920,0 640x720`, and inactive resident providers remain at `2560,0 1920x720`.

To verify stale setup recovery, inject a temporary failed state for a provider that is already on its real site and wait for its guard to repair it:

```bash
node - <<'NODE'
const fs = require("fs");
const p = ".tikpal/web-mode-state.json";
const s = JSON.parse(fs.readFileSync(p, "utf8"));
s.residentProviders ||= {};
s.residentProviders.tidal = {
  ...(s.residentProviders.tidal || {}),
  status: "check_setup",
  lastError: "synthetic stale check_setup",
  updatedAt: new Date().toISOString()
};
s.updatedAt = new Date().toISOString();
fs.writeFileSync(p, `${JSON.stringify(s, null, 2)}\n`);
NODE
sleep 2
jq '.residentProviders.tidal' .tikpal/web-mode-state.json
```

Expected: the guard rewrites TIDAL to `active` or `ready` and clears `lastError` when its page is already on `tidal.com` / `listen.tidal.com`.

Use CDP to verify the resident provider audio gate after deploy:

```js
(() => ({
  version: window.__tikpalProviderAudioGate?.version || 0,
  status: window.__tikpalProviderAudioGate?.status?.() || null
}))()
```

Expected: `version=2`. The active provider reports `status.active=true`; inactive providers report `status.active=false`. When the user returns to a provider that was playing before it was hidden, it should become unmuted and continue playback. If the user paused the provider before switching away, returning to it should keep it paused.

Use CDP to verify provider text scaling without viewport scaling:

```js
(() => ({
  innerWidth,
  innerHeight,
  devicePixelRatio,
  htmlZoom: document.documentElement.style.zoom || "",
  datasetScale: document.documentElement.dataset.tikpalProviderTextScale || null,
  density: getComputedStyle(document.documentElement)
    .getPropertyValue("--tikpal-provider-text-density")
    .trim()
}))()
```

Expected values for the physical QQ provider are:

```text
innerWidth=1920
innerHeight=720
devicePixelRatio=1
htmlZoom=""
datasetScale="1.00" | "1.10" | "1.20"
```

Use CDP to verify QQ Music MV cinema mode stays scoped to the provider pane:

```js
(() => {
  const video = [...document.querySelectorAll("video")]
    .map((node) => ({ node, rect: node.getBoundingClientRect() }))
    .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height))[0];
  const playlistButton = document.querySelector("[data-tikpal-qq-mv-playlist-button]");
  const replayButton = document.querySelector("[data-tikpal-qq-mv-replay-button]");
  return {
    cinema: document.documentElement.dataset.tikpalQqMvCinema || "",
    playlistButton: Boolean(playlistButton),
    playlistText: playlistButton?.innerText || "",
    replayButton: Boolean(replayButton),
    replayVisible: replayButton ? !replayButton.hidden : false,
    frame: Boolean(document.querySelector("[data-tikpal-qq-mv-cinema-frame]")),
    letterbox: document.documentElement.dataset.tikpalQqMvLetterbox || "",
    nativeFullscreen: Boolean(document.fullscreenElement),
    playbackError: /播放失败|错误码undefined|刷新页面重试/.test(document.body?.innerText || ""),
    paused: video ? video.node.paused : null,
    ended: video ? video.node.ended : null,
    nearEnded: video ? (
      video.node.ended ||
      (Number.isFinite(video.node.duration) && video.node.duration > 0 &&
        video.node.duration - video.node.currentTime <= 0.75)
    ) : null,
    currentTime: video ? Math.round(video.node.currentTime * 10) / 10 : null,
    videoRect: video ? {
      width: Math.round(video.rect.width),
      height: Math.round(video.rect.height),
      left: Math.round(video.rect.left),
      top: Math.round(video.rect.top)
    } : null,
    viewport: { width: innerWidth, height: innerHeight }
  };
})()
```

Expected MV behavior: `cinema="1"`, `playlistButton=true`, `playlistText=""`, `frame=true`, `nativeFullscreen=false`, `playbackError=false`, `innerWidth=1920`, `innerHeight=720`, and the video rectangle nearly fills the provider viewport with dark, borderless letterboxing when needed. During playback, the replay icon may exist but stays hidden; at `ended=true` or `nearEnded=true`, `replayVisible=true`. Tapping replay must move the same MV back to the beginning and then report `ended=false`, `nearEnded=false`, and `replayVisible=false` once playback resumes. If the MV initially stalls at a play overlay, it should become `paused=false` after the one-shot auto-play gate. The right `640x720` side panel must remain visible. MV completion does not auto-return or auto-start the next item; use the playlist icon when returning to the list is desired.

Input checks:

```bash
pgrep -af fcitx5
su - moode -c 'DISPLAY=:0 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus fcitx5-remote -n'
gsettings get org.onboard layout
sudo -u moode -H env DISPLAY=:0 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus gsettings get org.onboard.theme-settings key-label-font
cat /home/moode/code/tikpal/.tikpal/onboard-ime-state.json 2>/dev/null || true
cat /home/moode/.config/tikpal/onboard-ime-state.json 2>/dev/null || true
```

Touch a provider search field and confirm Onboard appears above the provider, cycles through EN / Chinese / German / Italian / Korean / Japanese / ES, shows a larger CJK candidate window, and hides after outside tap, submit, or single-line Enter. Change Settings -> Font once and confirm `key-label-font` changes without resetting the current Fcitx mode.

Audio checks:

```bash
aplay -l
mpc status
sudo fuser -v /dev/snd/*
```

For QQ Music, manually click play if the provider was reopened during deploy. Confirm the QQ player is not muted, audio comes through BT66, and `fuser` shows Chromium holding the expected ALSA device.

## Rollback Notes

- To return from Explore to the main kiosk, use the side panel Back action or `deploy/chromium/tikpal-web-mode.sh close`.
- If provider layout looks compressed, confirm there is no `--force-device-scale-factor` in provider Chromium processes and no `chrome.tabs.setZoom` / `chrome.tabs.getZoom` reference in the deployed extension.
- If Onboard stops changing languages, run `deploy/chromium/tikpal-web-mode.sh --check`, then verify `/usr/share/onboard/scripts/tikpalImeToggle.py`, the generated `Tikpal-Compact-*.onboard` layouts, `fcitx5-remote -n`, and the two `onboard-ime-state.json` files. If `pgrep -af fcitx5` shows any root-owned Fcitx process, stop that process and resync as `moode`.
- If the display becomes too dim to use, recover the DDC value out of band before changing UI gesture mapping.
- If Chromium, MPD, AirPlay, or Spotify contend for BT66, use the Gentoo source handoff helper rather than killing random audio processes.
