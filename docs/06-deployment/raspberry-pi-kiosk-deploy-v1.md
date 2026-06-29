# Raspberry Pi Kiosk Deploy v1

## Goal

Deploy Tikpal to a Raspberry Pi 4 running moOde so the device boots into the local 2560 x 720 Chromium kiosk experience.

This package installs API/web plus kiosk support units when kiosk diagnostics are enabled:

| Unit | Port | Purpose |
| --- | --- | --- |
| `tikpal-api.service` | `8787` | Local Tikpal API and future moOde / MPD bridge. |
| `tikpal-web.service` | `4173` | Production static web server for `dist/`, with `/api` proxied to the API service. |
| `tikpal-kiosk.service` | display `:0` | Chromium kiosk session for the touch screen. |
| `tikpal-kiosk-viewer.service` | `6080` | Optional noVNC viewer for the full kiosk display. |
| `tikpal-kiosk-devtools.service` | `9222` | Optional LAN proxy for Chromium DevTools. |
| `tikpal-kiosk-watchdog.service` | local only | One-shot healthcheck that can restart only the kiosk display service. |
| `tikpal-kiosk-watchdog.timer` | local only | Runs the display watchdog every 60-90 seconds. |

## Local Preflight

Run this on the development machine before syncing to the Pi:

```bash
npm ci
npm run typecheck
npm run test:api
npm run test:kiosk
npm run test:ota:package:mp4
npm run build
```

Optional local production server check:

```bash
npm run start:api
npm run start:web
```

Open `http://localhost:4173/`.

## Sync To Pi

Choose a target directory. The recommended first install path is:

```bash
/home/moode/code/tikpal
```

Example direct sync:

```bash
rsync -a --delete --progress --stats \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '.tikpal/' \
  --exclude '.DS_Store' \
  ./ moode@<pi-ip>:/home/moode/code/tikpal/
```

If the Pi is only reachable through the local SOCKS proxy, use the same rsync command with SSH transport:

```bash
rsync -a --delete --progress --stats \
  -e "ssh -o ProxyCommand='nc -X 5 -x 127.0.0.1:7897 %h %p'" \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '.tikpal/' \
  --exclude '.DS_Store' \
  ./ moode@<pi-ip>:/home/moode/code/tikpal/
```

## Install On Pi

SSH into the Pi, then:

```bash
cd /home/moode/code/tikpal
sudo apt-get update
sudo apt-get install -y xvfb x11vnc novnc websockify socat
npm ci
npm run build
cp -n deploy/chromium/env.kiosk.example .env.kiosk
```

Inspect `.env.kiosk` and adjust the Chromium binary or display output if needed:

```bash
nano .env.kiosk
deploy/chromium/start-tikpal-kiosk-display.sh --check
deploy/chromium/start-tikpal-kiosk-viewer.sh --check
deploy/chromium/start-tikpal-kiosk-devtools-proxy.sh --check
deploy/chromium/tikpal-kiosk-healthcheck.sh --check
deploy/chromium/launch-tikpal-kiosk.sh --check
```

For Scene Sound on the local kiosk, keep Chromium on the same `_audioout` route that moOde uses, and configure the API to release Chromium's AudioService before Tikpal starts MPD-backed sources such as Library or Radio:

```bash
sed -i 's|^TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE=.*|TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE=_audioout|' .env.kiosk
deploy/chromium/launch-tikpal-kiosk.sh --check
```

Chromium may keep an ALSA `audio.mojom.AudioService` process open after the active scene video is muted. The API-side release command below is what prevents that stale browser process from leaving MPD Radio in `Device or resource busy`.

If the Pi should control real moOde playback instead of the local mock bridge, create `.env` with native MPD settings before restarting the API service:

```bash
cat > .env <<'EOF'
TIKPAL_PLAYER_BACKEND=mpc
TIKPAL_MPD_HOST=127.0.0.1
TIKPAL_MPD_PORT=6600
TIKPAL_MPC_BIN=mpc
TIKPAL_MPD_DEFAULT_QUEUE_PATH=Codex
TIKPAL_MPD_STARTUP_VOLUME=30
TIKPAL_STARTUP_SCENE_SOUND_ENABLED=1
TIKPAL_ALSA_LOOPBACK_ALLOW_HDMI=0
TIKPAL_OUTPUT_VOLUME_GET_COMMAND="./deploy/moode/tikpal-output-volume.sh get"
TIKPAL_OUTPUT_VOLUME_SET_COMMAND="./deploy/moode/tikpal-output-volume.sh set %VALUE%"
TIKPAL_WEB_ALLOW_REMOTE_UI_API=0
TIKPAL_SCENE_CONTEXT_GEO_URL=https://ipapi.co/json/
TIKPAL_SCENE_CONTEXT_GEO_TIMEOUT_MS=3000
TIKPAL_SCENE_CONTEXT_GEO_CACHE_MS=3600000
TIKPAL_SCENE_CONTEXT_WEATHER_URL=https://api.open-meteo.com/v1/forecast
TIKPAL_SCENE_CONTEXT_WEATHER_TIMEOUT_MS=3000
TIKPAL_SCENE_CONTEXT_WEATHER_CACHE_MS=900000
TIKPAL_HIFI_EQ_APPLY_COMMAND=""
TIKPAL_HIFI_SPECTRUM_COMMAND="./deploy/moode/tikpal-hifi-spectrum-capture.sh"
TIKPAL_HIFI_SPECTRUM_DEVICE=""
TIKPAL_HIFI_SPECTRUM_CAPTURE_COMMAND=""
TIKPAL_HIFI_SPECTRUM_CACHE_MS=900
TIKPAL_HIFI_SPECTRUM_GAIN=12
TIKPAL_STATE_SNAPSHOT_REFRESH_MS=3000
TIKPAL_DDCUTIL_BIN=ddcutil
TIKPAL_DDCUTIL_DISPLAY=""
TIKPAL_DDCUTIL_READ_CACHE_MS=300000
TIKPAL_DDCUTIL_READ_TIMEOUT_MS=3500
TIKPAL_DDCUTIL_SUPPRESS_READ_WARNINGS=1
TIKPAL_DDCUTIL_SUPPRESS_SYSLOG=1
TIKPAL_SPOTIFY_READY_COMMAND=""
TIKPAL_SPOTIFY_ACTIVE_COMMAND="pgrep -x librespot >/dev/null"
TIKPAL_SPOTIFY_ACTIVATE_COMMAND="moodeutl -Ro --spotify on"
TIKPAL_SPOTIFY_DISABLE_COMMAND="moodeutl -Ro --spotify off"
TIKPAL_SPOTIFY_LABEL_COMMAND=""
TIKPAL_BLUETOOTH_READY_COMMAND="[ \"$(sqlite3 /var/local/www/db/moode-sqlite3.db \"SELECT value FROM cfg_system WHERE param='btsvc'\")\" = \"1\" ]"
TIKPAL_BLUETOOTH_ACTIVE_COMMAND="[ \"$(sqlite3 /var/local/www/db/moode-sqlite3.db \"SELECT value FROM cfg_system WHERE param='btactive'\")\" = \"1\" ]"
TIKPAL_BLUETOOTH_ENABLE_COMMAND="./deploy/moode/tikpal-bluetooth-enable.sh"
TIKPAL_BLUETOOTH_DISABLE_COMMAND="moodeutl -Ro --bluetooth off"
TIKPAL_BLUETOOTH_LABEL_COMMAND="./deploy/moode/tikpal-bluetooth-label.sh"
TIKPAL_BLUETOOTH_LABEL_TIMEOUT_SECONDS=2
TIKPAL_BLUETOOTH_METADATA_COMMAND="./deploy/moode/tikpal-bluetooth-metadata.sh"
TIKPAL_BLUETOOTH_CAPTURE_COMMAND="./deploy/moode/tikpal-bluetooth-capture.sh"
TIKPAL_BLUETOOTH_CAPTURE_DURATION_SECONDS=10
TIKPAL_BLUETOOTH_RECOGNITION_SETTLE_MS=4000
TIKPAL_BLUETOOTH_RECOGNITION_RETRY_MS=45000
TIKPAL_BLUETOOTH_RECOGNITION_NOT_FOUND_RETRY_MS=30000
TIKPAL_AIRPLAY_READY_COMMAND="[ \"$(sqlite3 /var/local/www/db/moode-sqlite3.db \"SELECT value FROM cfg_system WHERE param='airplaysvc'\")\" = \"1\" ]"
TIKPAL_AIRPLAY_ACTIVE_COMMAND="[ \"$(sqlite3 /var/local/www/db/moode-sqlite3.db \"SELECT value FROM cfg_system WHERE param='aplactive'\")\" = \"1\" ]"
TIKPAL_AIRPLAY_ENABLE_COMMAND="./deploy/moode/tikpal-airplay-enable.sh"
TIKPAL_AIRPLAY_DISABLE_COMMAND="moodeutl -Ro --airplay off"
TIKPAL_AIRPLAY_RECEIVER_ACTIVE_COMMAND="systemctl is-active --quiet shairport-sync.service"
TIKPAL_AIRPLAY_ALSA_OUTPUT_DEVICE=_audioout
TIKPAL_AIRPLAY_METADATA_COMMAND="./deploy/moode/tikpal-airplay-metadata.sh"
TIKPAL_AIRPLAY_TRANSPORT_AVAILABLE_COMMAND="./deploy/moode/tikpal-airplay-transport.sh available"
TIKPAL_AIRPLAY_PLAY_PAUSE_COMMAND="./deploy/moode/tikpal-airplay-transport.sh play-pause"
TIKPAL_AIRPLAY_PLAY_COMMAND="./deploy/moode/tikpal-airplay-transport.sh play"
TIKPAL_AIRPLAY_PAUSE_COMMAND="./deploy/moode/tikpal-airplay-transport.sh pause"
TIKPAL_AIRPLAY_NEXT_COMMAND="./deploy/moode/tikpal-airplay-transport.sh next"
TIKPAL_AIRPLAY_PREVIOUS_COMMAND="./deploy/moode/tikpal-airplay-transport.sh previous"
TIKPAL_AIRPLAY_METADATA_MAX_AGE_SECONDS=3600
TIKPAL_AIRPLAY_ARTWORK_MAX_LAG_SECONDS=1
TIKPAL_AIRPLAY_METADATA_CLOCK_LEAD_MS=1000
TIKPAL_AIRPLAY_DIRECT_METADATA_REFRESH_MIN_MS=1000
TIKPAL_AIRPLAY_CAPTURE_COMMAND=""
TIKPAL_AIRPLAY_CAPTURE_DURATION_SECONDS=6
TIKPAL_AIRPLAY_RECOGNITION_SETTLE_MS=1000
TIKPAL_UPNP_READY_COMMAND=""
TIKPAL_UPNP_ACTIVE_COMMAND=""
TIKPAL_UPNP_ENABLE_COMMAND=""
TIKPAL_UPNP_DISABLE_COMMAND=""
TIKPAL_UPNP_LABEL_COMMAND=""
TIKPAL_RECOGNITION_PROVIDER=acrcloud
TIKPAL_ACRCLOUD_HOST=identify-cn-north-1.acrcloud.com
TIKPAL_ACRCLOUD_ACCESS_KEY="YOUR_ACCESS_KEY"
TIKPAL_ACRCLOUD_ACCESS_SECRET="YOUR_ACCESS_SECRET"
TIKPAL_RADIO_ACTIVATE_COMMAND=""
TIKPAL_RADIO_DEFAULT_URI=""
TIKPAL_RADIO_LABEL="Last Station"
TIKPAL_RADIO_LOGO_DIR="/var/local/www/imagesw/radio-logos"
TIKPAL_RADIO_VOLUME_DEFAULT_PERCENT=35
TIKPAL_RADIO_AUTO_SKIP_VERIFY_WINDOW_MS=1500
TIKPAL_RADIO_AUTO_SKIP_POST_START_SETTLE_MS=500
TIKPAL_RADIO_AUTO_SKIP_RETRY_DELAYS_MS=""
TIKPAL_RADIO_LATE_PLAY_NUDGE_DELAYS_MS="1500,3000,5000,8000,12000,16000"
TIKPAL_KIOSK_AUDIO_RELEASE_COMMAND="./deploy/moode/tikpal-release-kiosk-audio.sh"
TIKPAL_KIOSK_AUDIO_RELEASE_SETTLE_MS=500
TIKPAL_SYSTEM_REBOOT_COMMAND="sudo systemctl reboot"
TIKPAL_SYSTEM_SHUTDOWN_COMMAND="sudo systemctl poweroff"
TIKPAL_DSP_PRESET=Unknown
TIKPAL_PORTABLE_API_KEY="CHANGE_ME_LONG_RANDOM_REMOTE_KEY"
EOF
```

`TIKPAL_MPD_DEFAULT_QUEUE_PATH=Codex` tells the backend which local library path to queue first when MPD is empty.
`TIKPAL_MPD_STARTUP_VOLUME=30` makes Tikpal set MPD to 30% before auto-resuming playback when the API starts and playback is not already running.
`TIKPAL_STARTUP_SCENE_SOUND_ENABLED=1` makes the Pi open Scene Sound as the default startup source for Focus, Calm, and Sleep room modes. The startup path writes `sceneSoundEnabled=true` when needed and switches to `target=scene`; choosing Library, Radio, Bluetooth, AirPlay, Spotify, or DLNA later still clears Scene Sound for that session.
`TIKPAL_AUDIO_SOURCE_MEMORY_STATE_PATH` defaults to `.tikpal/audio-source-memory.json` and stores the last visible source for Hi-Fi restore. It records only `mpd`, `radio`, `spotify`, `bluetooth`, `airplay`, and `upnp`; internal `scene` and `audio` are ignored so startup Scene Sound and Scene Sound toggles do not erase the user's last Library track, Radio station, or external waiting source.
`TIKPAL_ALSA_LOOPBACK_ALLOW_HDMI=0` keeps Tikpal from re-enabling a stale moOde ALSA Loopback override when `_audioout` routes only to HDMI. Most Tikpal installs should select the USB speaker or USB amplifier in moOde first, then let `_audioout` follow that current output while mirroring to Loopback for AirPlay, Bluetooth, and Hi-Fi spectrum. Set this to `1` only for an intentional HDMI-output install. For Chromium Scene Sound, set `TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE=_audioout` and keep `TIKPAL_KIOSK_AUDIO_RELEASE_COMMAND` enabled; this lets scene ambience play through the same output while giving MPD/Radio a clean handoff when the user leaves Scene Sound.
`TIKPAL_KIOSK_AUDIO_RELEASE_COMMAND` is run only before MPD-backed sources (`mpd` and `radio`) start. The checked-in `deploy/moode/tikpal-release-kiosk-audio.sh` helper kills Chromium's `audio.mojom.AudioService` utility process with a safe process pattern, then the backend waits `TIKPAL_KIOSK_AUDIO_RELEASE_SETTLE_MS` before issuing `mpc clear/add/play`. Use it on Pi installs where Scene Sound is browser audio and MPD Radio otherwise reports `_audioout: Device or resource busy`.
`TIKPAL_OUTPUT_VOLUME_GET_COMMAND` and `TIKPAL_OUTPUT_VOLUME_SET_COMMAND` should control the physical `_audioout` output, not only ALSA Loopback. On moOde installs with ALSA Loopback enabled, the checked-in `deploy/moode/tikpal-output-volume.sh` helper reads the current `/etc/alsa/conf.d/_sndaloop.conf` / `_audioout.conf` route, gets volume from the physical output, and mirrors writes to Loopback so renderer intakes and Hi-Fi spectrum use the same level. Browser Scene Sound reaches the same physical output through Chromium's `dmix` route. Avoid bare `amixer get PCM` on these installs because it can hit the Loopback card while the USB output remains at 100%.
Keep `TIKPAL_WEB_ALLOW_REMOTE_UI_API=0` for the normal Pi install: the production web service serves the full kiosk UI to loopback clients such as the Pi browser, while LAN browsers opening `http://<pi-ip>:4173/` receive the portable remote UI and are limited to `/api/v1/remote/*`. Remote mode is selected when the socket remote address is not loopback or when the HTTP `Host` is not `localhost`, `127.0.0.1`, or `[::1]`, so SSH tunnels, reverse proxies, and port mappings still receive the portable remote UI when the browser uses the Pi IP or a public domain as the Host. Set it to `1` only when trusted LAN clients should receive the full kiosk API surface.
`TIKPAL_SCENE_CONTEXT_GEO_*` and `TIKPAL_SCENE_CONTEXT_WEATHER_*` control the cached `/api/v1/scene/context` lookups used for weak Ambient clock copy. The endpoint prefers IP-derived timezone/location when available, falls back to the caller's `timeZone` query or the room-experience default when unavailable, and caches provider failures briefly so a slow network cannot stall normal state reads.
Kiosk display diagnostics are separate from `4173`: `TIKPAL_KIOSK_REMOTE_DEBUG=1` exposes Chromium DevTools on `TIKPAL_KIOSK_REMOTE_DEBUG_ADDRESS:TIKPAL_KIOSK_REMOTE_DEBUG_PORT`, proxying to Chromium's local `TIKPAL_KIOSK_REMOTE_DEBUG_CHROMIUM_ADDRESS:TIKPAL_KIOSK_REMOTE_DEBUG_CHROMIUM_PORT`, and `TIKPAL_KIOSK_VIEWER=novnc` exposes the full kiosk screen through noVNC on `TIKPAL_KIOSK_NOVNC_ADDRESS:TIKPAL_KIOSK_NOVNC_PORT`. Keep `TIKPAL_KIOSK_REMOTE_DEBUG=0` for normal use and enable it only while actively debugging; DevTools can inspect and control the kiosk browser.
`TIKPAL_KIOSK_DISPLAY_MODE=auto` starts a physical `startx` session when a DRM display is connected, or when `ddcutil detect --brief` can see a local monitor even though KMS reports HDMI as disconnected, and falls back to `Xvfb` when the Pi is headless. Set `TIKPAL_KIOSK_LOCAL_SCREEN=1` or `0` only for devices where detection is wrong and you need to force the auto decision without changing the broader display mode.
`TIKPAL_HIFI_EQ_APPLY_COMMAND` enables real Hi-Fi EQ preset control in `mpc` mode. Until this is set, `set_hifi_eq` is intentionally rejected on the Pi instead of pretending the DSP changed. The command receives `%PRESET%`, `%LABEL%`, and `%VISUAL%` placeholders, so a future Pi hook can map `flat`, `warm`, and `vocal` to local CamillaDSP configs. A CamillaDSP-based hook may use the official WebSocket control path, where `SetConfigName` selects a config and `Reload` applies it: [CamillaDSP WebSocket docs](https://www.camilladsp.com/docs/camilladsp/1.0.1/websocket/).
`TIKPAL_HIFI_SPECTRUM_COMMAND` enables real Hi-Fi spectrum sampling for the `/api/v1/audio/spectrum` backend contract. The checked-in `deploy/moode/tikpal-hifi-spectrum-capture.sh` helper captures a short PCM window from a readable ALSA device, calculates 32 normalized spectrum bands plus normalized `peaks.left` / `peaks.right`, and returns JSON for any future meter surface that consumes that endpoint. The helper first honors `TIKPAL_HIFI_SPECTRUM_CAPTURE_COMMAND` when a custom Pi pipeline is needed; otherwise it tries `TIKPAL_HIFI_SPECTRUM_DEVICE` / `TIKPAL_HIFI_SPECTRUM_DEVICES` and then common ALSA loopback devices such as `plughw:Loopback,1,0`. `TIKPAL_HIFI_SPECTRUM_CACHE_MS` keeps the API from launching overlapping analyzer commands, and `TIKPAL_HIFI_SPECTRUM_GAIN` raises low Loopback PCM levels without substituting mock data. In `mpc` mode Tikpal rejects the spectrum endpoint when this command is unset, so the Pi does not silently show mock EQ data. Validate the device path with `./deploy/moode/tikpal-hifi-spectrum-capture.sh | jq .` before restarting `tikpal-api.service`.
`TIKPAL_STATE_SNAPSHOT_REFRESH_MS` controls the background runtime snapshot collector. In `mpc` mode, read APIs such as `/api/v1/system/state`, `/api/v1/playback/status`, `/api/v1/system/status`, `/api/v1/audio/sources`, and the portable remote state return the latest in-memory snapshot instead of running `systemctl`, `ddcutil`, metadata, or source-status probes in the request path. Keep the interval low enough that status cards feel fresh, but high enough that slow Pi probes cannot pile up; `3000` ms is the current default.
`TIKPAL_DDCUTIL_BIN` and optional `TIKPAL_DDCUTIL_DISPLAY` control the ambient left-edge brightness gesture path when the display exposes DDC/CI VCP `0x10`. `TIKPAL_DDCUTIL_READ_CACHE_MS` keeps status polling from blocking the kiosk on frequent I2C reads, `TIKPAL_DDCUTIL_SUPPRESS_READ_WARNINGS=1` keeps repeated ddcutil stderr warnings out of normal service logs, `TIKPAL_DDCUTIL_SUPPRESS_SYSLOG=1` adds `--syslog=NEVER` for ddcutil versions that otherwise log every probe to journald, and brightness writes still apply immediately.
`TIKPAL_PORTABLE_API_KEY` protects portable-controller writes through `POST /api/v1/remote/actions`. Keep `tikpal-api.service` bound to `127.0.0.1` and let portable controllers enter through the production web service at `http://<pi>:4173/api/v1/remote/*`; the web proxy blocks external clients from calling the full internal kiosk API. When the key is configured, the LAN-facing remote UI can submit safe remote actions through the web proxy without exposing the full kiosk API.
`TIKPAL_SPOTIFY_*` lets the Pi expose Spotify Connect as a truthful ready/active handoff target without using Spotify Web API. On moOde, use `moodeutl -Ro --spotify on` and `moodeutl -Ro --spotify off` for activate/disable, and an active probe such as `pgrep -x librespot >/dev/null`. This matters for Scene Sound because a running `librespot --device _audioout` process can keep the USB output busy after the user has switched back to `scene`.
`TIKPAL_BLUETOOTH_*`, `TIKPAL_AIRPLAY_*`, and `TIKPAL_UPNP_*` let Tikpal enforce the armed-only source gate against moOde's renderer services. On moOde, the checked-in `deploy/moode/tikpal-bluetooth-enable.sh` script is the preferred Bluetooth enable path because it both enables the renderer and re-arms the controller to `power on`, `discoverable on`, and `pairable on`. `deploy/moode/tikpal-airplay-enable.sh` is the preferred AirPlay enable path because it enables the renderer and then nudges `shairport-sync.service` into the running state that actually advertises the receiver. `deploy/moode/tikpal-bluetooth-label.sh` reads the current broadcast name from `bluetoothctl show` so the frontend can tell the user what name to search for on their phone; `TIKPAL_BLUETOOTH_LABEL_TIMEOUT_SECONDS` keeps a stuck BlueZ client from accumulating orphaned `bluetoothctl` processes during frequent runtime polling. `TIKPAL_UPNP_*` should point at the target moOde UPnP/DLNA renderer controls; Tikpal treats this as DLNA casting intake, not media-server browsing. For all four external intake surfaces, `*_READY_COMMAND` means the receiver can be opened, `*_ACTIVE_COMMAND` means a real client is connected, and the UI keeps Ambient, Player, and Remote consistent by showing `armed` as waiting until `connected` is true. `moodeutl -Ro --bluetooth off` and `moodeutl -Ro --airplay off` remain the practical disable commands, while `cfg_system` values `btsvc`, `btactive`, `airplaysvc`, and `aplactive` plus `TIKPAL_AIRPLAY_RECEIVER_ACTIVE_COMMAND` keep the UI honest about whether AirPlay is really up.
`TIKPAL_BLUETOOTH_METADATA_COMMAND` points to the BlueZ / AVRCP metadata probe. Tikpal uses this first when Bluetooth is connected, so phones that expose title / artist metadata can resolve lyrics through LRCLIB without audio fingerprint credentials. When BlueZ also exposes `Position` and `Duration`, Tikpal maps those into playback progress so synced LRCLIB lyrics can follow Bluetooth playback timing instead of falling back to a fixed text rotation.
`TIKPAL_AIRPLAY_METADATA_COMMAND` points to moOde's AirPlay metadata bridge. The checked-in `deploy/moode/tikpal-airplay-metadata.sh` treats Shairport Sync MPRIS as the current playback truth on moOde 5, then uses fresh `/var/local/www/aplmeta.json` or legacy `/var/local/www/aplmeta.txt` only to fill missing fields for the same title / artist. It emits title / artist / album / artwork fields plus `metadataSource` diagnostics that Tikpal can use for playback truth and LRCLIB lyrics lookup. AirPlay lyrics should be fast but strict about identity: metadata lookup must not return `ready` lyrics when LRCLIB only finds the same title from a different artist. AirPlay duration is treated as timing guidance instead of an identity gate because some Shairport/MPRIS sessions report unreliable durations; once title and artist are trusted, Tikpal may prefer LRCLIB's duration for lyric line timing. `TIKPAL_AIRPLAY_DIRECT_METADATA_REFRESH_MIN_MS=1000` keeps connected AirPlay metadata fresh without returning to per-request heavy polling. `TIKPAL_AIRPLAY_METADATA_CLOCK_LEAD_MS` compensates for moOde's metadata write delay when Tikpal has to infer AirPlay progress from metadata mtime; when moOde logs `spspre` and `spspost` in the same second but metadata is fresh, `clockStartReason=metadata_mtime` or `persisted_metadata_mtime` and advancing `positionMs` are valid. `TIKPAL_AIRPLAY_ARTWORK_MAX_LAG_SECONDS` prevents stale cover files from being paired with a newer title. `TIKPAL_AIRPLAY_ALSA_OUTPUT_DEVICE` defaults AirPlay to moOde's `_audioout` chain, so Shairport Sync reaches the physical output while the Loopback mirror remains available for the real Hi-Fi spectrum meter.
`TIKPAL_AIRPLAY_TRANSPORT_AVAILABLE_COMMAND`, `TIKPAL_AIRPLAY_PLAY_PAUSE_COMMAND`, `TIKPAL_AIRPLAY_PLAY_COMMAND`, `TIKPAL_AIRPLAY_PAUSE_COMMAND`, `TIKPAL_AIRPLAY_NEXT_COMMAND`, and `TIKPAL_AIRPLAY_PREVIOUS_COMMAND` route Tikpal transport buttons to the AirPlay sender while AirPlay is the current source. The checked-in `deploy/moode/tikpal-airplay-transport.sh` helper probes Shairport Sync's native D-Bus `org.gnome.ShairportSync.RemoteControl.Available` property before calling `PlayPause`, `Play`, `Pause`, `Next`, or `Previous`. Some AirPlay 2 senders expose metadata but no DACP remote-control channel; in that case Tikpal disables previous / play-pause / next instead of returning a fake-success action that cannot change the sender's queue.
`TIKPAL_BLUETOOTH_CAPTURE_COMMAND` points to the local PCM capture script used for Bluetooth fingerprint recognition when Bluetooth metadata is unavailable. The checked-in `deploy/moode/tikpal-bluetooth-capture.sh` first tries `ffmpeg` against the connected BlueALSA device and then falls back to `arecord`; if moOde exposes a different ALSA capture path, override `TIKPAL_BLUETOOTH_CAPTURE_DEVICE` in the service environment before restarting `tikpal-api.service`.
`TIKPAL_RECOGNITION_PROVIDER=acrcloud` plus the `TIKPAL_ACRCLOUD_*` credentials enable the online fingerprint fallback. Tikpal waits `TIKPAL_BLUETOOTH_RECOGNITION_SETTLE_MS` after the Bluetooth connection becomes active, captures `TIKPAL_BLUETOOTH_CAPTURE_DURATION_SECONDS` seconds of audio, sends it to ACRCloud, and then reuses the same LRCLIB lyrics path once a track is identified. AirPlay should normally resolve from metadata; if `TIKPAL_AIRPLAY_CAPTURE_COMMAND` is configured as a fallback, it uses its own faster `TIKPAL_AIRPLAY_RECOGNITION_SETTLE_MS` and `TIKPAL_AIRPLAY_CAPTURE_DURATION_SECONDS` values so Bluetooth recognition stability is not changed. When AirPlay capture is unset, Tikpal reports metadata unavailable instead of staying in a long fingerprint-recognition state. `TIKPAL_BLUETOOTH_RECOGNITION_NOT_FOUND_RETRY_MS` keeps the receiver trying again when the first sample catches silence or a transition instead of permanently pinning Ambient to "not found".
moOde `cfg_radio` presets are still the Radio source list, and `POST /api/v1/audio/source` can switch directly by `radioStationId`. Tikpal reads the full moOde table, then defaults `/api/v1/audio/radios` to `scope=tikpal`, which returns the curated Tikpal rows grouped as `Focus`, `Calm`, `Sleep`, `Hi-Fi`, `Jazz`, `Classical`, and `News`. Use `scope=all` when the Player needs the full moOde catalog; Tikpal rows remain first. Active Radio summaries expose `audio.currentSource.radioStationId` so Hi-Fi can restore the exact remembered station.
`TIKPAL_RADIO_LOGO_DIR` points at moOde's local station-logo folder. `/api/v1/media/radio-logo?stationId=radio-<id>` serves only known station ids, first by exact station-name logo file and then by the repo-owned alias map for curated Tikpal station names. Radio logo responses are cacheable for a day so Player / Hi-Fi cover switches can reuse decoded station artwork instead of reloading the same local file on every station change. Radio playback uses this official logo URL as `playback.albumArtUrl` when available; generated cover art remains only the fallback when the local logo is missing or fails to load.
Radio uses MPD's software mixer. If `mpc status` shows `volume: 0%`, Tikpal restores the last nonzero MPD volume recorded in `.tikpal/audio-volume-state.json` before starting Radio. If that state does not exist yet, it falls back to the current room-mode volume and then to `TIKPAL_RADIO_VOLUME_DEFAULT_PERCENT`. While Radio is active, playback `next` and `previous` select adjacent Tikpal station ids through the API instead of asking MPD to advance a one-item stream queue. If a stream has already failed and `mpc current` is empty, Tikpal keeps the failed URL from `mpc status` as the active Radio context; if the next candidate station also fails to start, it keeps walking the curated station list before surfacing an error. When MPD reports a clear stream failure such as `Failed to decode` or connection timeout, Tikpal treats that station as unreachable, auto-advances to the next station from the late-check timer, and refreshes the cached state so the UI label follows the new station. `TIKPAL_RADIO_AUTO_SKIP_*` controls the shorter verification window used while skipping bad candidates; keep it shorter than the normal Radio start window so dead presets do not feel sticky. The Radio catalog should mark the selected station `active:true`, and fast playback or volume refreshes should keep the selected station label instead of falling back to the generic `TIKPAL_RADIO_LABEL`. `TIKPAL_MPD_STARTUP_VOLUME` still applies only to startup priming, and `TIKPAL_RADIO_DEFAULT_URI` stays as a fallback preset when moOde radio rows are unavailable.
If `mpc update` is not the right library refresh command on the device, also set `TIKPAL_LIBRARY_SCAN_COMMAND`.

## DDC/CI Brightness Setup

Real display brightness writes require `TIKPAL_PLAYER_BACKEND=mpc`; in mock mode Tikpal only updates the local API state. After `.env` exists, run the repo-owned DDC/CI helper on the Pi:

```bash
cd /home/moode/code/tikpal
sudo deploy/moode/tikpal-ddcci-enable.sh
sudo systemctl restart tikpal-api.service
```

The helper installs `ddcutil` and `i2c-tools`, loads `i2c-dev`, persists `dtparam=i2c_arm=on`, grants the service user access to `/dev/i2c-*`, writes `TIKPAL_DDCUTIL_BIN` and `TIKPAL_DDCUTIL_DISPLAY` into `.env`, and probes VCP `0x10`.

If the display should be selected explicitly, pass the display id observed from `ddcutil detect --brief`:

```bash
sudo TIKPAL_DDCUTIL_DISPLAY=1 deploy/moode/tikpal-ddcci-enable.sh
```

Validated target evidence from the current Raspberry Pi path:

```text
Display 1
   I2C bus:          /dev/i2c-20
   DRM connector:    card1-HDMI-A-1
   Monitor:          CRX:XENEON EDGE:207726065656
VCP 10 C 80 100
```

Resource-only OTA packages can update the local music library and add ambient scene videos without changing application code. Package layout defaults to:

```text
resource-ota/
├─ manifest.json
└─ assets
   ├─ scenes
   │  ├─ _metadata/scene_videos.json
   │  └─ Rainy-Window.mp4
   └─ music
      ├─ _metadata/library_manifest.json
      ├─ Focus/Lo-fi Ambient/folder.jpg
      ├─ Focus/Lo-fi Ambient/*.mp3
      ├─ Meditation/Breathing/*.mp3
      └─ Rest/Rain Ocean Forest/*.mp3
```

Apply it on the device from the app checkout:

```bash
npm run ota:resources -- /path/to/resource-ota
```

To create scene-only packages from local MP4 files, run:

```bash
npm run ota:package:mp4 -- /path/to/mp4-scenes --recursive --bundle --default Forest-Cabin.mp4
```

The generator writes packages under `.tikpal/resource-ota-packages` unless `--output` is provided. Split mode creates one package per MP4; `--bundle` creates one package that installs the whole folder together. Each generated scene entry includes an id, filename, label, order, optional default marker, and `sha256`. The generator normalizes scene MP4s for the Pi kiosk path: keep the physical `2560x720` target, use H.264 Main Profile Level 4.1, `yuv420p`, a closed GOP around 48 frames, no B-frames, bounded video bitrate around `4500k`, AAC stereo around `96k`, and `+faststart`. If a source video has an audible or visible loop boundary, first run `npm run media:loop -- --input <mp4> --crossfade 0.9`; this requires `ffmpeg` / `ffprobe` and keeps an in-place backup under `.codex-artifacts/media-backups`. At runtime, `FlameScene` also uses two video slots for each looping scene, preparing the standby slot about 1.2 seconds before the tail and revealing it about 0.42 seconds before the tail with a 360ms visual / 340ms Scene Sound crossfade. In Pi `mpc` stable-loop mode, loop playback stays on the single-video path, but scene switches still mount a separate incoming layer and keep the outgoing scene visible until the incoming layer is drawable. The video element watchdog can recover ordinary playback stalls and exposes `data-flame-video-health`; repeated-stall logo fallback is retried by the page and cleared on the next scene source change so Focus / Calm / Sleep switches do not remain on the logo while waiting for the systemd watchdog. If the full X/Chromium/V3D display stack stops responding, the systemd kiosk watchdog handles recovery by restarting only `tikpal-kiosk.service`.

The script validates `assets/music/_metadata/library_manifest.json`, checks that manifest track and optional cover paths are safe and present in the package or already installed library, validates scene MP4 `sha256` checksums from `assets/scenes/_metadata/scene_videos.json`, validates the legacy replacement MP4 when present, writes `public/assets`, syncs `dist/assets` when a production build is present, and records `.tikpal/resource-ota-state.json`. The API reads the local music manifest on each `/api/v1/audio/library` request and lists scene videos from both `public/assets/*.mp4` and `public/assets/scenes/_metadata/scene_videos.json`; Ambient refreshes that scene catalog every 30 seconds and when the page becomes visible, so newly added scene videos appear in the previous / next scene controls without a page reload. The default Ambient scene catalog no longer depends on a bundled `output*.mp4`; when the scene catalog is empty, the scene video layer stays off until a new scene package is installed.

To clear installed scene videos without touching music assets, run `npm run scene:clear`. The command removes `assets/scenes` under the configured public assets root, mirrors the clear into `dist/assets/scenes` when that build output exists, writes an empty `scene_videos.json`, and records `.tikpal/scene-video-clear-state.json`.

Install and restart API + web services:

```bash
sudo deploy/systemd/install-systemd-services.sh \
  --app-dir /home/moode/code/tikpal \
  --user moode \
  --restart
```

Verify:

```bash
systemctl is-active tikpal-api.service tikpal-web.service
curl -fsS http://127.0.0.1:8787/api/v1/health
curl -fsSI http://127.0.0.1:4173/
```

### Validated Proxy Deploy Checkpoint

2026-06-09 validation on `192.168.2.141` used the SOCKS proxy SSH route with `moode@192.168.2.141` and confirmed the live service tree before syncing:

```text
ProxyCommand: nc -X 5 -x 127.0.0.1:7897 %h %p
WorkingDirectory: /home/moode/code/tikpal
tikpal-api.service: active
tikpal-web.service: active
tikpal-kiosk.service: active
```

The deploy synced the current workspace mirror, including `public/` and the local `dist/` build, while preserving device-local `.env`, `.env.*`, and `.tikpal/` state. Post-restart validation returned `{"ok":true,"service":"tikpal-api","mode":"mpc"}`, reported `kioskWindow:"2560x720"` from `/api/v1/system/runtime`, returned `/api/v1/system/state` in about `0.041s`, served `http://127.0.0.1:4173/` with `200 OK`, and served `http://192.168.2.141:4173/` through the proxy with `__TIKPAL_REMOTE_MODE__=true`.

When `TIKPAL_PLAYER_BACKEND=mpc` is active, also verify the real device path:

```bash
systemctl show tikpal-api.service -p Environment --no-pager
mpc status
mpc current
curl -fsS -X POST http://127.0.0.1:8787/api/v1/playback/actions \
  -H "Content-Type: application/json" \
  --data '{"type":"next"}'
mpc status
curl -fsS http://127.0.0.1:8787/api/v1/playback/status
curl -fsS http://127.0.0.1:8787/api/v1/system/status
curl -fsS http://127.0.0.1:8787/api/v1/system/runtime
curl -fsS -o /tmp/tikpal-state.json -w '%{time_total}\n' http://127.0.0.1:8787/api/v1/system/state
```

`next`, `previous`, playlist play, local track switch, and startup queue priming are serialized through the API and verify MPD reaches `[playing]` after `play`, so a status line that remains `[paused]` after one of those actions is a real regression to investigate before accepting the deploy. If MPD reports `Failed to open ALSA device "_audioout"`, verify that moOde sees the USB speaker or amplifier in `aplay -l`, that moOde's selected output is that USB output, and that `snd-aloop` is loaded when `/etc/alsa/conf.d/_sndaloop.conf` is active. Tikpal's Loopback helpers refuse HDMI-only `_audioout` routes by default; set `TIKPAL_ALSA_LOOPBACK_ALLOW_HDMI=1` only when HDMI output is deliberate.

For Pi responsiveness, the timed `/api/v1/system/state` check should return from the in-memory snapshot instead of waiting for slow runtime probes. If it takes seconds, inspect whether a read endpoint is still executing `systemctl`, `ddcutil`, source status commands, AirPlay/Bluetooth metadata helpers, or media metadata probes in the request path. A background collector may still be running those commands, but repeated state reads should not increase stuck helper process counts.

For AirPlay lyrics validation, compare the helper, playback API, lyrics API, and kiosk visibility state before accepting a deploy:

```bash
./deploy/moode/tikpal-airplay-metadata.sh
curl -fsS http://127.0.0.1:8787/api/v1/playback/status
curl -fsS http://127.0.0.1:8787/api/v1/lyrics/status
curl -fsS http://127.0.0.1:8787/api/v1/system/state
```

When lyrics exist, `/api/v1/lyrics/status` should be `ready` with `lines.length > 0`, `sourceScope: "airplay_input"`, and title / artist identity matching `/api/v1/playback/status`. If the provider only has a same-title different-artist result, `not_found` or continued `recognizing` is the correct state. The Hi-Fi wall defaults visible through `tikpal.lyricsVisible.v3`; an old kiosk `tikpal.lyricsVisible.v2=false` value must not hide a ready non-empty lyrics wall. If a ready AirPlay lyric has no projected active line because the raw position is missing, the wall should still show static rotating lyrics while `positionMs` / `elapsedSeconds` advance from the metadata clock.

Verify the portable remote facade locally and through the LAN-facing web proxy:

```bash
curl -fsS http://127.0.0.1:8787/api/v1/openapi.json
curl -fsS http://127.0.0.1:8787/api/v1/remote/state
curl -fsS http://127.0.0.1:4173/api/v1/remote/catalog
curl -fsS -H "Host: <pi-ip>:4173" http://127.0.0.1:4173/ | grep __TIKPAL_REMOTE_MODE__
curl -fsS -X POST http://127.0.0.1:4173/api/v1/remote/actions \
  -H "Content-Type: application/json" \
  -H "X-Tikpal-Key: $TIKPAL_PORTABLE_API_KEY" \
  --data '{"type":"playback.play_pause"}'
```

For multi-surface sync, validate volume and source writes from both the local API and the LAN-facing remote facade. `system.volume.percent` should match after each write, and external intake sources should keep the same `armed` / `connected` state in `/api/v1/system/state`, `/api/v1/audio/sources`, and `/api/v1/remote/state`:

```bash
curl -fsS -X POST http://127.0.0.1:8787/api/v1/playback/actions \
  -H "Content-Type: application/json" \
  --data '{"type":"volume_set","value":44}' | jq '.system.volume.percent,.audio.currentSource'
curl -fsS -X POST http://127.0.0.1:4173/api/v1/remote/actions \
  -H "Content-Type: application/json" \
  -H "X-Tikpal-Key: $TIKPAL_PORTABLE_API_KEY" \
  --data '{"type":"volume_set","value":43}' | jq '.volume.percent,.source'
curl -fsS http://127.0.0.1:8787/api/v1/system/state | jq '.system.volume.percent,.audio.currentSource,.audio.rememberedSource'
curl -fsS http://127.0.0.1:8787/api/v1/audio/sources | jq '.currentSource,.rememberedSource'
curl -fsS http://127.0.0.1:4173/api/v1/remote/state | jq '.volume.percent,.source'
```

Validate the curated Radio path after importing or editing moOde presets:

```bash
curl -fsS 'http://127.0.0.1:8787/api/v1/audio/radios?limit=80' \
  | jq '.scope,.total,.categories,.stations[0:5] | .'
curl -fsS 'http://127.0.0.1:8787/api/v1/audio/radios?scope=all&limit=5' \
  | jq '.total,.stations[].catalogSource'
curl -I -fsS 'http://127.0.0.1:8787/api/v1/media/radio-logo?stationId=radio-511'
curl -fsS -D - -o /dev/null 'http://127.0.0.1:8787/api/v1/media/radio-logo?stationId=radio-511' \
  | grep -Ei 'cache-control|access-control-allow-methods'
curl -fsS -X POST http://127.0.0.1:8787/api/v1/audio/source \
  -H "Content-Type: application/json" \
  --data '{"target":"radio","radioStationId":"radio-511"}' \
  | jq '.system.volume,.playback.source,.playback.albumArtUrl,.audio.currentSource'
curl -fsS -X POST http://127.0.0.1:8787/api/v1/playback/actions \
  -H "Content-Type: application/json" \
  --data '{"type":"next"}' \
  | jq '.audio.currentSource.radioStationId,.audio.currentSource.secondaryStatus,.playback.albumArtUrl'
curl -fsS http://127.0.0.1:8787/api/v1/system/state \
  | jq '.playback.source,.playback.state,.playback.albumArtUrl,.audio.currentSource.radioStationId,.audio.currentSource.secondaryStatus'
mpc current -f '%file%'
mpc status
curl -fsS http://127.0.0.1:8787/api/v1/audio/spectrum | jq '.source,.bands[0:8]'
```

Expected result: the default Radio catalog reports the curated Tikpal count and categories, `scope=all` still exposes moOde rows, the radio-logo endpoint returns an image with `Cache-Control: public, max-age=86400` and `GET,HEAD,OPTIONS` allowed, MPD volume is nonzero after the Radio switch, the chosen station is `active:true` in `/api/v1/audio/radios`, Radio `next` changes the active station, logo, and `mpc current -f '%file%'`, a failed stream still recovers through Radio `next` instead of falling back to MPD `Not playing`, `/api/v1/system/state` exposes the new Radio `albumArtUrl` as soon as the backend has primed the active station, and spectrum bands are nonzero when the station is audible.

Verify Quick Settings actions from the API before relying on the kiosk UI:

```bash
curl -fsS -X POST http://127.0.0.1:8787/api/v1/system/actions \
  -H 'Content-Type: application/json' \
  -d '{"type":"library_scan"}'
```

If ambient brightness gestures should work on the target display, also verify the DDC/CI path explicitly:

```bash
systemctl show tikpal-api.service -p Environment --no-pager
ddcutil getvcp 10 --brief
curl -fsS http://127.0.0.1:8787/api/v1/system/status
curl -fsS -X POST http://127.0.0.1:8787/api/v1/system/actions \
  -H 'Content-Type: application/json' \
  -d '{"type":"brightness_set","value":80}'
curl -fsS http://127.0.0.1:8787/api/v1/system/state
```

Success means `/api/v1/health` reports `mode:"mpc"`, `/api/v1/system/status` reports `display.controllable=true` and `display.transport="ddcci"`, the `brightness_set` response and the immediate `/api/v1/system/state` response both show the written brightness, and `ddcutil getvcp 10 --brief` returns the same value after the API action. If `/dev/i2c-*` is absent or VCP `0x10` is unreadable, reboot once after the helper writes `dtparam=i2c_arm=on`, then re-run the probe before assuming the display lacks DDC/CI.

## Scene Sound Audio Verification

Scene Sound is browser audio from the active Ambient MP4, not MPD audio. If Scene Sound is on, the video is moving, and the API reports `source:"scene"` but the speaker is silent, split the diagnosis into frontend state, Chromium ALSA output, moOde `_audioout`, and competing renderer ownership.

First confirm the Pi source state and basic audio devices:

```bash
curl -fsS http://127.0.0.1:8787/api/v1/playback/status
curl -fsS http://127.0.0.1:8787/api/v1/system/state
aplay -l
aplay -L | grep -E '^(_audioout|dmix|default|plughw|hw)' -A2
grep -E '^TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE|^TIKPAL_KIOSK_REMOTE_DEBUG' /home/moode/code/tikpal/.env.kiosk
```

Then inspect the kiosk log. `PcmOpen: _audioout,No such device` means `_sndaloop.conf` expects Loopback but `snd-aloop` is missing. `PcmOpen: _audioout,Device or resource busy` means Chromium reached ALSA but could not use the Loopback-backed composite route reliably or another renderer is holding the device:

```bash
journalctl -u tikpal-kiosk.service --since '10 minutes ago' --no-pager \
  | grep -Ei 'PcmOpen|alsa output|_audioout|dmix|Loopback|alsa' || true
cat /proc/asound/cards
lsmod | grep -E 'snd_aloop|snd_usb_audio' || true
fuser -v /dev/snd/* 2>&1 || true
pgrep -af 'librespot|shairport|bluealsa|upmpd|squeezelite' || true
```

Recovery rules:

- If Loopback is missing while `/etc/alsa/conf.d/_sndaloop.conf` references `hw:Loopback,0`, run `sudo ./deploy/moode/tikpal-snd-aloop-enable.sh`, then restart the affected service.
- If `librespot --device _audioout` is still running after the source is `scene`, run `moodeutl -Ro --spotify off`, set `TIKPAL_SPOTIFY_DISABLE_COMMAND="moodeutl -Ro --spotify off"`, and restart `tikpal-api.service`.
- If Chromium logs `PcmOpen: _audioout,Device or resource busy`, set `TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE=dmix:CARD=<USB_CARD>,DEV=0` in `.env.kiosk`, keep DevTools disabled, and restart `tikpal-kiosk.service`.
- If MPD reports `Failed to open ALSA device "_audioout"`, fix `_audioout` separately before judging Scene Sound; MPD and Chromium can fail for different reasons.

After recovery, success looks like this:

```bash
systemctl is-active tikpal-api.service tikpal-web.service tikpal-kiosk.service tikpal-kiosk-watchdog.timer
curl -fsS http://127.0.0.1:8787/api/v1/playback/status
journalctl -u tikpal-kiosk.service --since '2 minutes ago' --no-pager \
  | grep -Ei 'PcmOpen|alsa output|_audioout|dmix|alsa' || true
for f in /proc/asound/<USB_CARD>/pcm0p/sub*/status; do echo "---$f"; cat "$f"; done
pgrep -x librespot >/dev/null && echo 'Spotify still owns output' || echo 'Spotify renderer closed'
```

The USB PCM status should be `RUNNING` while Scene Sound is active, and recent kiosk logs should show the selected `dmix:CARD=...` output without new `PcmOpen` errors. If the DOM video needs inspection, enable `TIKPAL_KIOSK_REMOTE_DEBUG=1` only temporarily, inspect the active `video.flame-video` for `muted=false`, `paused=false`, `readyState>=2`, and nonzero `data-scene-volume`, then turn DevTools back off.

For visual scene-switch verification on the physical kiosk, prefer a frame capture on `DISPLAY=:0` instead of relying only on API state. This is the high-signal check for the white-flash class of bugs:

```bash
RUN_DIR=$(mktemp -d /tmp/tikpal-scene-verify.XXXXXX)
mkdir -p "$RUN_DIR/frames"
DISPLAY=:0 ffmpeg -y -hide_banner -loglevel error \
  -f x11grab -video_size 2560x720 -framerate 4 -t 40 -i :0.0 \
  "$RUN_DIR/frames/frame-%03d.png" &
FFMPEG_PID=$!

curl -fsS -H 'Content-Type: application/json' \
  -d '{"type":"set_mode","mode":"focus"}' \
  http://127.0.0.1:8787/api/v1/experience/actions >/dev/null
sleep 6
curl -fsS -H 'Content-Type: application/json' \
  -d '{"type":"set_mode","mode":"calm"}' \
  http://127.0.0.1:8787/api/v1/experience/actions >/dev/null
sleep 6
curl -fsS -H 'Content-Type: application/json' \
  -d '{"type":"set_mode","mode":"sleep"}' \
  http://127.0.0.1:8787/api/v1/experience/actions >/dev/null
wait "$FFMPEG_PID"
```

Then analyze the captured PNGs with Pillow or a similar image tool. A healthy run should have no high-ratio white frames; recent Pi validation on `192.168.10.178` captured 158 frames while cycling room modes and scene ids, with `max_white ratio=0.0000`, `max_mean=134.4`, and the darkest frames corresponding to the intentional black dim/reveal transition rather than browser-white exposure. Keep the temporary frame directory only long enough to inspect failures.

## Quiet Boot And Reboot

To keep the HDMI kiosk screen from showing kernel, systemd, udev, cursor, or `tty1 login` text while the Raspberry Pi boots or reboots, run the repo-owned quiet boot helper on the Pi:

```bash
cd /home/moode/code/tikpal
sudo deploy/moode/tikpal-quiet-boot-enable.sh
```

The helper backs up the detected cmdline file (`/boot/firmware/cmdline.txt` or `/boot/cmdline.txt`), removes visible `tty1` console routing, adds quiet boot flags, writes a systemd manager drop-in with `ShowStatus=no`, writes a quiet console `sysctl` drop-in, and disables `getty@tty1.service`. SSH remains available.

Verify the installed quiet boot state:

```bash
grep -E 'quiet|console=tty3|systemd.show_status=false|vt.global_cursor_default=0' /boot/firmware/cmdline.txt /boot/cmdline.txt 2>/dev/null
systemctl is-enabled getty@tty1.service || true
systemctl is-active getty@tty1.service || true
cat /etc/systemd/system.conf.d/tikpal-quiet-boot.conf
cat /etc/sysctl.d/99-tikpal-quiet-console.conf
```

Reboot once for the cmdline changes to take effect. Emergency kernel failures can still show critical text; normal boot and reboot should stay visually quiet until Chromium takes over.

## Enable Kiosk

Only enable the kiosk service after API and web are healthy.

First check whether another kiosk service already owns the X session:

```bash
systemctl status kiosk.service --no-pager
systemctl cat kiosk.service
```

Then install and restart the Tikpal kiosk service:

```bash
sudo deploy/systemd/install-systemd-services.sh \
  --app-dir /home/moode/code/tikpal \
  --user moode \
  --enable-kiosk \
  --restart
```

Verify the live display path:

```bash
systemctl status tikpal-kiosk.service --no-pager
systemctl status tikpal-kiosk-viewer.service --no-pager
systemctl status tikpal-kiosk-devtools.service --no-pager
systemctl status tikpal-kiosk-watchdog.timer --no-pager
journalctl -u tikpal-kiosk.service -n 80 --no-pager
journalctl -u tikpal-kiosk-viewer.service -n 80 --no-pager
journalctl -u tikpal-kiosk-devtools.service -n 80 --no-pager
journalctl -u tikpal-kiosk-watchdog.service -n 80 --no-pager
ps -ef | grep '[c]hrom'
timeout -k 2s 5s env DISPLAY=:0 xdpyinfo >/dev/null && echo "X display responsive"
deploy/chromium/tikpal-kiosk-healthcheck.sh --check
```

The effective Chromium command line should include these window flags:

```text
--start-fullscreen --window-position=0,0 --window-size=2560,720
```

The launcher accepts `TIKPAL_KIOSK_WINDOW=2560x720` in `.env.kiosk`, but normalizes it to Chromium's `2560,720` format during launch.

If the physical panel suddenly shows a 4:3 view or a cropped Ambient scene, verify the actual X root window before changing React layout code:

```bash
timeout -k 2s 5s env DISPLAY=:0 xrandr --query
timeout -k 2s 5s env DISPLAY=:0 xdpyinfo | grep -E 'dimensions|resolution'
ps -eo pid,args | grep '[c]hromium-browser'
grep -E '^TIKPAL_KIOSK_XRANDR_MODE|^TIKPAL_KIOSK_XRANDR_OUTPUT|^TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS' \
  /home/moode/code/tikpal/.env.kiosk /etc/tikpal-kiosk.env 2>/dev/null || true
cat /proc/cmdline | tr ' ' '\n' | grep '^video=' || true
```

The high-signal failure pattern is `xrandr` reporting `current 1024 x 768` while `2560x720` is still listed as an available HDMI mode and Chromium was launched with `--window-size=2560,720`. In that case the display mode was not enforced after X started. On a physical HDMI kiosk, keep the Pi app env aligned with the system override:

```bash
cd /home/moode/code/tikpal
cp .env.kiosk ".env.kiosk.bak-$(date +%Y%m%d-%H%M%S)"
sed -i 's/^TIKPAL_KIOSK_XRANDR_MODE=.*/TIKPAL_KIOSK_XRANDR_MODE=2560x720/' .env.kiosk
grep -q '^TIKPAL_KIOSK_XRANDR_OUTPUT=' .env.kiosk \
  && sed -i 's/^TIKPAL_KIOSK_XRANDR_OUTPUT=.*/TIKPAL_KIOSK_XRANDR_OUTPUT=HDMI-1/' .env.kiosk \
  || printf 'TIKPAL_KIOSK_XRANDR_OUTPUT=HDMI-1\n' >> .env.kiosk
grep -q '^TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS=' .env.kiosk \
  && sed -i 's/^TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS=.*/TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS=5/' .env.kiosk \
  || printf 'TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS=5\n' >> .env.kiosk
sudo systemctl restart tikpal-kiosk.service
timeout -k 2s 5s env DISPLAY=:0 xrandr --query | sed -n '1,8p'
```

Do not leave `TIKPAL_KIOSK_XRANDR_MODE=none` on a physical-screen unit unless the display mode is intentionally managed somewhere else. The systemd kiosk unit sets `TIKPAL_KIOSK_SKIP_ENV_SOURCE=1` so a service-level drop-in such as `/etc/tikpal-kiosk.env` can override the app `.env.kiosk` once at process start; after changing the template, reinstall the systemd units before relying on that override order.

## Remote Kiosk Diagnostics

noVNC adds CPU and network load, so keep it off by default and only enable it while recording or debugging. Use the viewer control helper on the Pi:

```bash
cd /home/moode/code/tikpal
sudo deploy/chromium/tikpal-kiosk-viewerctl.sh start
sudo deploy/chromium/tikpal-kiosk-viewerctl.sh status
```

When noVNC is enabled, use these checks from the Pi:

```bash
curl -fsSI http://127.0.0.1:6080/
```

From a trusted LAN browser, open `http://<pi-ip>:6080/` to view and operate the full kiosk UI. After recording, disable noVNC again:

```bash
cd /home/moode/code/tikpal
sudo deploy/chromium/tikpal-kiosk-viewerctl.sh stop
sudo deploy/chromium/tikpal-kiosk-viewerctl.sh status
```

For DOM, console, network, and media debugging, separately enable `TIKPAL_KIOSK_REMOTE_DEBUG=1`, restart `tikpal-kiosk-devtools.service`, verify `curl -fsS http://127.0.0.1:9222/json/version`, and add `<pi-ip>:9222` in Chrome's `chrome://inspect`.

`http://<pi-ip>:4173/` remains the portable remote controller and intentionally does not expose the full kiosk API surface while `TIKPAL_WEB_ALLOW_REMOTE_UI_API=0`.

To verify the no-screen path without unplugging hardware, temporarily set `TIKPAL_KIOSK_DISPLAY_MODE=virtual`, restart `tikpal-kiosk.service`, `tikpal-kiosk-viewer.service`, and `tikpal-kiosk-devtools.service`, then open noVNC again. Restore `auto` after the test unless the device should always run headless.

Disable DevTools again after a diagnostic session:

```bash
cd /home/moode/code/tikpal
sed -i 's/^TIKPAL_KIOSK_REMOTE_DEBUG=.*/TIKPAL_KIOSK_REMOTE_DEBUG=0/' .env.kiosk
sudo systemctl disable --now tikpal-kiosk-devtools.service
sudo systemctl restart tikpal-kiosk.service
ss -ltnp | grep -E ':(9222|9223)\b' || true
```

If Chromium or Xorg does not exit cleanly, first confirm `tikpal-kiosk.service` is stuck in `deactivating`, then kill only that service cgroup before starting it again:

```bash
sudo systemctl kill -s SIGKILL tikpal-kiosk.service
sudo systemctl reset-failed tikpal-kiosk.service tikpal-kiosk-devtools.service
sudo systemctl start tikpal-kiosk.service
```

## Long-Run Scene Video Freeze Recovery

If Scene Video is still `playing` in the API but the physical kiosk frame is frozen after hours of unattended playback, treat it as a display-stack problem before changing React video code. The high-signal pattern is: API reads stay fast, temperature and memory are normal, `xdpyinfo` on `DISPLAY=:0` times out, and kernel logs show `v3d`, `drm_sched_job_timedout`, or `Resetting GPU for hang`.

There is one separate long-run failure mode: X11 and Chromium are still alive, but the React page stops consuming state or events. In that case `/api/v1/health`, `/api/v1/system/runtime`, and `xdpyinfo` can all look healthy while source changes, Focus/Calm/Sleep/Hi-Fi, or scene switching no longer work. The kiosk page reports a loopback-only heartbeat so the watchdog can distinguish this page-semi-dead state from a full display-stack hang.

Use bounded probes only; avoid periodic `xrandr --query` or `ffmpeg x11grab` because they can hang behind the same X/V3D failure:

```bash
curl --max-time 3 -fsS http://127.0.0.1:8787/api/v1/health
curl --max-time 5 -fsS http://127.0.0.1:8787/api/v1/system/runtime
curl --max-time 5 -fsS http://127.0.0.1:8787/api/v1/playback/status
curl --max-time 3 -fsS http://127.0.0.1:8787/api/v1/kiosk/heartbeat | jq '{healthy,status,ageMs,reasons,scene:.heartbeat.scene,statusDetail:.heartbeat.status,eventLoop:.heartbeat.eventLoop,video:.heartbeat.activeSceneVideo}'
timeout -k 2s 5s env DISPLAY=:0 xdpyinfo >/dev/null && echo "X display responsive"
dmesg -T | grep -Ei 'v3d|drm_sched|gpu reset|Resetting GPU' | tail -40
journalctl -u tikpal-kiosk-watchdog.service -u tikpal-kiosk.service -b --no-pager | tail -120
pgrep -af 'ffmpeg .*x11grab|xdpyinfo|xrandr' || true
```

Interpret the heartbeat this way:

- `status:"unseen"` means the API has not received a page heartbeat since restart. This is expected briefly while Chromium starts, but not after the kiosk has been visible for more than about 30 seconds.
- `status:"stale"` or reason `heartbeat-stale` means the page stopped posting heartbeats. If X is still responsive, this is the typical Chromium page semi-dead signature.
- `pending-stuck:<kind>` means the page believes a source, room, playback, system, or Scene Sound action has been pending past the watchdog threshold.
- `event-loop-lag` means the page event loop is badly delayed even though the process still exists.
- `scene-video-stalled`, `scene-video-fallback`, or `scene-video-error` means the front-end video watchdog already detected a local media failure and the kiosk watchdog should refresh the page process if it persists.
- `scene-video-missing` while `playback.source:"scene"` and Scene Video is enabled means the page currently has no active `<video>` element. If the physical screen shows only the Tikpal logo, first wait for the page-level fallback retry or change room scenes once; if the reason persists, let the kiosk watchdog restart only `tikpal-kiosk.service`.
- Remote LAN or portable-controller callers should not be able to read this endpoint; it is intentionally loopback-only and outside `/api/v1/remote/*`.

The watchdog timer is installed with `--enable-kiosk` and should stay enabled for unattended scene playback:

```bash
systemctl is-active tikpal-kiosk-watchdog.timer
systemctl list-timers tikpal-kiosk-watchdog.timer
sudo systemctl start tikpal-kiosk-watchdog.service
sudo deploy/chromium/tikpal-kiosk-healthcheck.sh --check
journalctl -u tikpal-kiosk-watchdog.service -n 80 --no-pager
```

When the watchdog finds `x-unresponsive`, `chromium-missing`, `web-unhealthy`, `api-unhealthy`, `page-unhealthy:<reason>`, or a new `v3d-reset`, it first restarts only `tikpal-kiosk.service`. If the normal restart times out because Chromium or Xorg is stuck in `deactivating`, it kills that service cgroup, resets the failed state, and starts the kiosk again. API, web, MPD, and moOde audio services are left alone during normal display/page recovery, so Scene Sound and source truth survive a kiosk restart.

`page-unhealthy` is intentionally kiosk-only recovery. It does not trigger reboot escalation by itself because it points at a page runtime failure, not a wedged KMS/GPU stack.

If the kernel GPU/KMS state is wedged hard enough that Xorg restarts but never reaches Chromium, repeated kiosk restarts are not enough. `TIKPAL_KIOSK_WATCHDOG_REBOOT_AFTER_RESTARTS=3` allows the watchdog to reboot the Pi only after repeated `x-unresponsive` or `v3d-reset` display-stack failures within `TIKPAL_KIOSK_WATCHDOG_REBOOT_WINDOW_SECONDS=900`. Set it to `0` to disable reboot escalation while debugging.

The kiosk session and launcher bound their own `xset` and `xrandr` calls with `TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS=5`. This prevents a half-responsive X server from leaving `startx -> xinit -> Xorg` alive while Chromium never starts. If `/tmp/.X11-unix/X0` exists but `timeout 5 env DISPLAY=:0 xdpyinfo` hangs and `pgrep -af chromium-browser` is empty, treat the failure as display-stack wedged rather than a React page issue. First restart `tikpal-kiosk.service`; if X still accepts no clients after the restart, reboot the Pi to clear the KMS/Xorg state, then confirm Chromium and the heartbeat return.

After a watchdog recovery, confirm the display path is clean and no diagnostic helpers were left behind:

```bash
systemctl is-active tikpal-api.service tikpal-web.service tikpal-kiosk.service tikpal-kiosk-watchdog.timer
timeout -k 2s 5s env DISPLAY=:0 xdpyinfo >/dev/null && echo "X display responsive"
pgrep -af 'ffmpeg .*x11grab|xdpyinfo|xrandr' || true
curl --max-time 5 -fsS http://127.0.0.1:8787/api/v1/playback/status
curl --max-time 3 -fsS http://127.0.0.1:8787/api/v1/kiosk/heartbeat | jq '{healthy,status,ageMs,reasons}'
```

## Pi Resource Triage

When the kiosk becomes very slow, capture CPU, thermal, GPU, I/O, and service state before changing application code:

```bash
uptime
vcgencmd measure_temp
vcgencmd get_throttled
vmstat 1 5
ps -eo pid,ppid,user,stat,pcpu,pmem,rss,comm,args --sort=-pcpu | head -30
journalctl -b -p warning --no-pager -n 120
journalctl -u tikpal-kiosk.service -b --since '10 minutes ago' --no-pager | tail -120
df -hT
curl --max-time 3 -fsS http://127.0.0.1:8787/api/v1/health
curl --max-time 5 -fsS http://127.0.0.1:8787/api/v1/system/runtime
pgrep -af 'bluetoothctl|tikpal-bluetooth-label.sh' | tail -40
```

Interpret the common high-signal findings this way:

- `vcgencmd get_throttled` values with `0x8` set mean the CPU is currently under soft temperature limiting; values with `0x2`, `0x4`, or `0x6` in the historical bits mean the Pi already hit frequency or thermal caps earlier in the boot.
- Repeated `v3d ... Resetting GPU for hang`, `gbm_wrapper`, or `GpuControl.CreateCommandBuffer` messages point at Chromium / GPU instability. Stop DevTools first, then reboot once if the kiosk is still stuck with Xorg but no Chromium process.
- Hundreds of `tikpal-bluetooth-label.sh` or `bluetoothctl` processes mean the Bluetooth label probe is wedged. Confirm `TIKPAL_BLUETOOTH_LABEL_TIMEOUT_SECONDS` is set, deploy the current script, and reboot to clear already-orphaned processes.
- Plenty of free memory and zero swap means the slowdown is not memory pressure; focus on Chromium CPU, temperature, GPU logs, process leaks, and storage pressure.
- A root filesystem above roughly 90% full is not usually the first cause of UI jank, but it should be cleaned before long unattended kiosk sessions.

After rebooting for resource recovery, verify the Pi came back cleanly:

```bash
systemctl is-active tikpal-api.service tikpal-web.service tikpal-kiosk.service
systemctl is-active tikpal-kiosk-devtools.service || true
ss -ltnp | grep -E ':(4173|8787|9222|9223)\b' || true
curl -fsS http://127.0.0.1:8787/api/v1/health
curl --max-time 5 -fsS http://127.0.0.1:8787/api/v1/system/runtime
vcgencmd measure_temp
vcgencmd get_throttled
```

## Rollback

Stop Tikpal kiosk without removing API/web:

```bash
sudo systemctl disable --now tikpal-kiosk-devtools.service tikpal-kiosk-viewer.service tikpal-kiosk.service
```

Stop all Tikpal services:

```bash
sudo systemctl disable --now tikpal-kiosk-devtools.service tikpal-kiosk-viewer.service tikpal-kiosk.service tikpal-web.service tikpal-api.service
```

The Chromium profile is dedicated to Tikpal and defaults to:

```bash
/home/moode/.config/tikpal-chromium-kiosk
```
