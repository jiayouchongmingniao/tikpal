# Raspberry Pi Kiosk Deploy v1

## Goal

Deploy Tikpal to a Raspberry Pi 4 running moOde so the device boots into the local 2560 x 720 Chromium kiosk experience.

This package installs three local services:

| Service | Port | Purpose |
| --- | --- | --- |
| `tikpal-api.service` | `8787` | Local Tikpal API and future moOde / MPD bridge. |
| `tikpal-web.service` | `4173` | Production static web server for `dist/`, with `/api` proxied to the API service. |
| `tikpal-kiosk.service` | display `:0` | Chromium kiosk session for the touch screen. |

## Local Preflight

Run this on the development machine before syncing to the Pi:

```bash
npm ci
npm run typecheck
npm run test:api
npm run test:kiosk
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
npm ci
npm run build
cp -n deploy/chromium/env.kiosk.example .env.kiosk
```

Inspect `.env.kiosk` and adjust the Chromium binary or display output if needed:

```bash
nano .env.kiosk
deploy/chromium/launch-tikpal-kiosk.sh --check
```

If the Pi should control real moOde playback instead of the local mock bridge, create `.env` with native MPD settings before restarting the API service:

```bash
cat > .env <<'EOF'
TIKPAL_PLAYER_BACKEND=mpc
TIKPAL_MPD_HOST=127.0.0.1
TIKPAL_MPD_PORT=6600
TIKPAL_MPC_BIN=mpc
TIKPAL_MPD_DEFAULT_QUEUE_PATH=Codex
TIKPAL_MPD_STARTUP_VOLUME=30
TIKPAL_OUTPUT_VOLUME_GET_COMMAND="amixer get PCM"
TIKPAL_OUTPUT_VOLUME_SET_COMMAND="amixer sset PCM %VALUE%%"
TIKPAL_DDCUTIL_BIN=ddcutil
TIKPAL_DDCUTIL_DISPLAY=""
TIKPAL_SPOTIFY_READY_COMMAND=""
TIKPAL_SPOTIFY_ACTIVE_COMMAND=""
TIKPAL_SPOTIFY_ACTIVATE_COMMAND=""
TIKPAL_SPOTIFY_DISABLE_COMMAND=""
TIKPAL_SPOTIFY_LABEL_COMMAND=""
TIKPAL_BLUETOOTH_READY_COMMAND="[ \"$(sqlite3 /var/local/www/db/moode-sqlite3.db \"SELECT value FROM cfg_system WHERE param='btsvc'\")\" = \"1\" ]"
TIKPAL_BLUETOOTH_ACTIVE_COMMAND="[ \"$(sqlite3 /var/local/www/db/moode-sqlite3.db \"SELECT value FROM cfg_system WHERE param='btactive'\")\" = \"1\" ]"
TIKPAL_BLUETOOTH_ENABLE_COMMAND="./deploy/moode/tikpal-bluetooth-enable.sh"
TIKPAL_BLUETOOTH_DISABLE_COMMAND="moodeutl -Ro --bluetooth off"
TIKPAL_BLUETOOTH_LABEL_COMMAND="./deploy/moode/tikpal-bluetooth-label.sh"
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
TIKPAL_AIRPLAY_METADATA_COMMAND="./deploy/moode/tikpal-airplay-metadata.sh"
TIKPAL_AIRPLAY_METADATA_MAX_AGE_SECONDS=3600
TIKPAL_AIRPLAY_METADATA_CLOCK_LEAD_MS=1000
TIKPAL_RECOGNITION_PROVIDER=acrcloud
TIKPAL_ACRCLOUD_HOST=identify-cn-north-1.acrcloud.com
TIKPAL_ACRCLOUD_ACCESS_KEY="YOUR_ACCESS_KEY"
TIKPAL_ACRCLOUD_ACCESS_SECRET="YOUR_ACCESS_SECRET"
TIKPAL_RADIO_ACTIVATE_COMMAND=""
TIKPAL_RADIO_DEFAULT_URI=""
TIKPAL_RADIO_LABEL="Last Station"
TIKPAL_SYSTEM_REBOOT_COMMAND="sudo systemctl reboot"
TIKPAL_SYSTEM_SHUTDOWN_COMMAND="sudo systemctl poweroff"
TIKPAL_DSP_PRESET=Unknown
EOF
```

`TIKPAL_MPD_DEFAULT_QUEUE_PATH=Codex` tells the backend which local library path to queue first when MPD is empty.
`TIKPAL_MPD_STARTUP_VOLUME=30` makes Tikpal set MPD to 30% before auto-resuming playback when the API starts and playback is not already running.
`TIKPAL_DDCUTIL_BIN` and optional `TIKPAL_DDCUTIL_DISPLAY` control the ambient right-edge brightness gesture path when the display exposes DDC/CI VCP `0x10`.
`TIKPAL_SPOTIFY_*` lets the Pi expose Spotify Connect as a truthful ready/active handoff target without using Spotify Web API. Leave it closed by default and provide activate/disable commands when Spotify should only accept connections after the user selects that source.
`TIKPAL_BLUETOOTH_*` and `TIKPAL_AIRPLAY_*` let Tikpal enforce the armed-only source gate against moOde's renderer services. On moOde, the checked-in `deploy/moode/tikpal-bluetooth-enable.sh` script is the preferred Bluetooth enable path because it both enables the renderer and re-arms the controller to `power on`, `discoverable on`, and `pairable on`. `deploy/moode/tikpal-airplay-enable.sh` is the preferred AirPlay enable path because it enables the renderer and then nudges `shairport-sync.service` into the running state that actually advertises the receiver. `deploy/moode/tikpal-bluetooth-label.sh` reads the current broadcast name from `bluetoothctl show` so the frontend can tell the user what name to search for on their phone. `moodeutl -Ro --bluetooth off` and `moodeutl -Ro --airplay off` remain the practical disable commands, while `cfg_system` values `btsvc`, `btactive`, `airplaysvc`, and `aplactive` plus `TIKPAL_AIRPLAY_RECEIVER_ACTIVE_COMMAND` keep the UI honest about whether AirPlay is really up.
`TIKPAL_BLUETOOTH_METADATA_COMMAND` points to the BlueZ / AVRCP metadata probe. Tikpal uses this first when Bluetooth is connected, so phones that expose title / artist metadata can resolve lyrics through LRCLIB without audio fingerprint credentials. When BlueZ also exposes `Position` and `Duration`, Tikpal maps those into playback progress so synced LRCLIB lyrics can follow Bluetooth playback timing instead of falling back to a fixed text rotation.
`TIKPAL_AIRPLAY_METADATA_COMMAND` points to moOde's AirPlay metadata bridge. The checked-in `deploy/moode/tikpal-airplay-metadata.sh` reads `/var/local/www/aplmeta.txt`, which is maintained by moOde's `aplmeta-reader.sh` process, and emits title / artist / album fields that Tikpal can use for LRCLIB lyrics lookup. `TIKPAL_AIRPLAY_METADATA_CLOCK_LEAD_MS` compensates for moOde's metadata file write delay when Tikpal has to infer AirPlay progress from the metadata mtime.
`TIKPAL_BLUETOOTH_CAPTURE_COMMAND` points to the local PCM capture script used for Bluetooth fingerprint recognition when Bluetooth metadata is unavailable. The checked-in `deploy/moode/tikpal-bluetooth-capture.sh` first tries `ffmpeg` against the connected BlueALSA device and then falls back to `arecord`; if moOde exposes a different ALSA capture path, override `TIKPAL_BLUETOOTH_CAPTURE_DEVICE` in the service environment before restarting `tikpal-api.service`.
`TIKPAL_RECOGNITION_PROVIDER=acrcloud` plus the `TIKPAL_ACRCLOUD_*` credentials enable the online fingerprint fallback. Tikpal waits `TIKPAL_BLUETOOTH_RECOGNITION_SETTLE_MS` after the Bluetooth connection becomes active, captures `TIKPAL_BLUETOOTH_CAPTURE_DURATION_SECONDS` seconds of audio, sends it to ACRCloud, and then reuses the same LRCLIB lyrics path once a track is identified. `TIKPAL_BLUETOOTH_RECOGNITION_NOT_FOUND_RETRY_MS` keeps the receiver trying again when the first sample catches silence or a transition instead of permanently pinning Ambient to "not found".
moOde `cfg_radio` presets are now the primary Radio source list for the source panel, and `POST /api/v1/audio/source` can switch directly by `radioStationId`.
`TIKPAL_RADIO_PRESET_LIMIT` caps how many moOde radio presets Tikpal reads into the panel. Keep it at `250` on the Raspberry Pi so Tikpal can expose the real moOde network-radio catalog instead of only a small demo subset.
`TIKPAL_RADIO_DEFAULT_URI` stays as a fallback preset when moOde radio rows are unavailable, and `TIKPAL_RADIO_ACTIVATE_COMMAND` is only used when no switchable preset URI is available.
If `mpc update` is not the right library refresh command on the device, also set `TIKPAL_LIBRARY_SCAN_COMMAND`.

Resource-only OTA packages can update the local music library and add ambient scene videos without changing application code. Package layout defaults to:

```text
resource-ota/
├─ manifest.json
└─ assets
   ├─ scenes
   │  ├─ _metadata/scene_videos.json
   │  └─ Rainy-Window.mp4
   └─ music
      ├─ _metadata/library_manifest.csv
      ├─ Focus/folder.jpg
      ├─ Focus/.../folder.jpg
      └─ Focus/.../*.mp3
```

Apply it on the device from the app checkout:

```bash
npm run ota:resources -- /path/to/resource-ota
```

To create scene-only packages from local MP4 files, run:

```bash
npm run ota:package:mp4 -- /path/to/mp4-scenes --recursive --bundle --default Forest-Cabin.mp4
```

The generator writes packages under `.tikpal/resource-ota-packages` unless `--output` is provided. Split mode creates one package per MP4; `--bundle` creates one package that installs the whole folder together. Each generated scene entry includes an id, filename, label, order, optional default marker, and `sha256`. If a source video has an audible or visible loop boundary, first run `npm run media:loop -- --input <mp4> --crossfade 0.9`; this requires `ffmpeg` / `ffprobe` and keeps an in-place backup under `.codex-artifacts/media-backups`. At runtime, `FlameScene` also uses two video slots for each looping scene, preparing the standby slot about 1.2 seconds before the tail and revealing it about 0.42 seconds before the tail with a 360ms visual / 340ms Scene Sound crossfade.

The script validates `assets/music/_metadata/library_manifest.csv`, checks that manifest track and optional cover paths are safe and present in the package or already installed library, validates scene MP4 `sha256` checksums from `assets/scenes/_metadata/scene_videos.json`, validates the legacy replacement MP4 when present, writes `public/assets`, syncs `dist/assets` when a production build is present, and records `.tikpal/resource-ota-state.json`. The API reads the local music manifest on each `/api/v1/audio/library` request and lists scene videos from both `public/assets/*.mp4` and `public/assets/scenes/_metadata/scene_videos.json`; Ambient refreshes that scene catalog every 30 seconds and when the page becomes visible, so newly added scene videos appear in the previous / next scene controls without a page reload. The default Ambient scene catalog no longer depends on a bundled `output*.mp4`; when the scene catalog is empty, the scene video layer stays off until a new scene package is installed.

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

When `TIKPAL_PLAYER_BACKEND=mpc` is active, also verify the real device path:

```bash
systemctl show tikpal-api.service -p Environment --no-pager
mpc status
mpc current
curl -fsS http://127.0.0.1:8787/api/v1/playback/status
curl -fsS http://127.0.0.1:8787/api/v1/system/status
curl -fsS http://127.0.0.1:8787/api/v1/system/runtime
```

Verify Quick Settings actions from the API before relying on the kiosk UI:

```bash
curl -fsS -X POST http://127.0.0.1:8787/api/v1/system/actions \
  -H 'Content-Type: application/json' \
  -d '{"type":"library_scan"}'
```

If ambient brightness gestures should work on the target display, also verify the DDC/CI path explicitly:

```bash
ddcutil getvcp 10 --brief
curl -fsS http://127.0.0.1:8787/api/v1/system/status
curl -fsS -X POST http://127.0.0.1:8787/api/v1/system/actions \
  -H 'Content-Type: application/json' \
  -d '{"type":"brightness_set","value":80}'
```

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
journalctl -u tikpal-kiosk.service -n 80 --no-pager
ps -ef | grep '[c]hrom'
xrandr --query
```

The effective Chromium command line should include these window flags:

```text
--start-fullscreen --window-position=0,0 --window-size=2560,720
```

The launcher accepts `TIKPAL_KIOSK_WINDOW=2560x720` in `.env.kiosk`, but normalizes it to Chromium's `2560,720` format during launch.

## Rollback

Stop Tikpal kiosk without removing API/web:

```bash
sudo systemctl disable --now tikpal-kiosk.service
```

Stop all Tikpal services:

```bash
sudo systemctl disable --now tikpal-kiosk.service tikpal-web.service tikpal-api.service
```

The Chromium profile is dedicated to Tikpal and defaults to:

```bash
/home/moode/.config/tikpal-chromium-kiosk
```
