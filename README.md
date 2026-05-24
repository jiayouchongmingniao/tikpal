# Tikpal

Tikpal is a documentation-first product project for a Raspberry Pi 4 based moOde streamer touch UI. The target device is a 2560 x 720 ultra-wide kiosk screen that should feel like a quiet HiFi object first, and a playback controller only when the user asks for controls.

The project started documentation-first and now includes a runnable Vite + React + TypeScript kiosk app with a local Node API, MP4 fireplace ambience, kiosk-safe dark startup, fixed 2560 x 720 design rules, and moOde-oriented player/settings surfaces.

## Product Direction

- Target hardware: Raspberry Pi 4, touch screen, 2560 x 720 physical output.
- Runtime: Chromium kiosk, full screen, no browser chrome.
- Frontend baseline: Vite + React + TypeScript.
- Visual rendering baseline: fireplace image plus local MP4 ambience with crossfaded scene changes; WebGL remains a future/experimental renderer track, not the current flame surface.
- Audio backend baseline: moOde / MPD for playback, status, library, output, and system information.
- Product posture: not a copy of the moOde Web UI; Tikpal is a dedicated HiFi ambience and control surface for a 32:9 touch device.

## Core Experience

Tikpal has three primary levels:

| Level | Name | Purpose |
| --- | --- | --- |
| Level 0 | Ambient flame screen | Default long-dwell state with flame visual, time, and subtle playback HUD. |
| Level 1 | Player control overlay | Daily playback controls, cover art, transport, progress, volume, audio status, and output state. |
| Level 2 | Quick settings overlay | Low-frequency system cards for network, output, DSP, library update, display, and system actions. |

Primary gestures:

- One-finger swipe down opens the player control overlay.
- Two-finger swipe down opens quick settings.
- Swipe up returns to the ambient flame screen.
- Tap temporarily strengthens playback HUD information.
- Long press opens a quick menu.
- Left ambient zone swipe adjusts moOde volume live.
- Right ambient zone swipe adjusts display brightness live through DDC/CI when available.
- Inactivity returns the device to the ambient flame screen.

## Documentation

Start with [docs/README.md](docs/README.md).

Key documents:

- [Product brief](docs/00-product/product-brief-v1.md)
- [Interaction and state model](docs/01-ux/interaction-and-state-model-v1.md)
- [Visual system and 2560 x 720 layout](docs/02-visual/visual-system-and-2560x720-layout-v1.md)
- [Pi4 kiosk runtime architecture](docs/03-architecture/pi4-kiosk-webgl-architecture-v1.md)
- [moOde capability mapping](docs/04-integration/moode-capability-mapping-v1.md)
- [MVP backlog and acceptance](docs/05-planning/mvp-backlog-and-acceptance-v1.md)
- [Raspberry Pi kiosk deploy](docs/06-deployment/raspberry-pi-kiosk-deploy-v1.md)

Reference assets:

- [Original product design PDF](docs/assets/references/moode-streamer-ui-product-design-doc.pdf)
- [UI reference board](docs/assets/references/ui-reference-board.png)

## Run Locally

```bash
npm install
npm run dev:api
npm run dev:web
```

Open [http://localhost:4173/](http://localhost:4173/).

The Vite app proxies `/api` to the local Tikpal API on port `8787`. If the API is not running, the UI stays usable with bundled fallback state and marks the data source as fallback.

Validation entry points:

- Ambient: [http://localhost:4173/](http://localhost:4173/)
- Player overlay: [http://localhost:4173/?mode=player](http://localhost:4173/?mode=player)
- Quick settings: [http://localhost:4173/?mode=quickSettings](http://localhost:4173/?mode=quickSettings)

## Build

```bash
npm run build
```

## API Smoke Test

Validate the Batch 3 local API bridge:

```bash
npm run test:api
```

The smoke test starts a temporary mock API, checks state endpoints, verifies playback actions, validates source/library contracts, and confirms invalid action handling. For local music taxonomy-only changes, run `npm run test:library` as well; it checks that the ignored `public/assets/music` manifest, covers, MP3 paths, and playlists still match the curated Local tree.

## Kiosk Package Smoke Test

Validate the Raspberry Pi service and Chromium kiosk package:

```bash
npm run test:kiosk
```

The smoke test checks the production static server path, systemd templates, kiosk launcher, managed policy files, and `launch-tikpal-kiosk.sh --check`.

## Raspberry Pi Deploy

Build locally, sync the repo to the Pi, and install the services from the repo-owned deploy package:

```bash
npm run typecheck
npm run test:api
npm run test:kiosk
npm run build
```

On the Pi:

```bash
cd /home/moode/code/tikpal
npm ci
npm run build
cp -n deploy/chromium/env.kiosk.example .env.kiosk
deploy/chromium/launch-tikpal-kiosk.sh --check
sudo deploy/systemd/install-systemd-services.sh --app-dir /home/moode/code/tikpal --user moode --enable-kiosk --restart
```

See the full deploy and rollback runbook in [docs/06-deployment/raspberry-pi-kiosk-deploy-v1.md](docs/06-deployment/raspberry-pi-kiosk-deploy-v1.md).

## Interaction Smoke Test

With the dev server running, verify the Batch 2 kiosk interaction contract:

```bash
npm run test:interaction
```

The smoke test drives Chrome through the DevTools protocol and checks wheel/trackpad-style entry, ambient HUD controls, playback truth display, the Player source workspace, Library taxonomy, surface skin highlight states, overlay return, protected panel clicks, and Quick Settings detail panels.

## MVP Summary

The first implementation milestone should deliver:

- Ambient fireplace screen with clock and subtle playback HUD.
- One-finger player overlay and two-finger quick settings overlay.
- Playback state, cover art, transport controls, progress, volume, format, sample rate, bit depth, output device, and network status.
- Quick settings cards for network, output, DSP, library update, display, system info, reboot, and shutdown.
- Long-press quick menu and a weak top-right settings fallback.
- Kiosk-safe behavior on Raspberry Pi 4 with 2560 x 720 fullscreen output.

## Repository Status

The local API exposes a first-class audio-source model for `Library`, internal `Audio`, `Radio`, `Spotify Connect`, `Bluetooth`, `AirPlay`, and `DLNA`. The frontend reads current source summary from `/api/v1/system/state`, inspects compact source state through `GET /api/v1/audio/sources`, renders six visible source tabs (`Library`, `Radio`, `Spotify`, `AirPlay`, `Bluetooth`, `DLNA`), fetches the searchable radio catalog through `GET /api/v1/audio/radios`, fetches the manifest-backed local music library through `GET /api/v1/audio/library`, posts source switches to `POST /api/v1/audio/source`, and still uses `/api/v1/playback/actions` plus `/api/v1/system/actions` for transport and system cards.

The real moOde / MPD adapter remains the audio owner. In `mpc` mode, Tikpal keeps MPD/library control as the default path, treats Radio as a searchable station catalog with direct `radioStationId` switching, and now models Spotify Connect, Bluetooth, AirPlay, and DLNA as armed-only intake paths: they are connectable only while explicitly selected. The player source rail is ordered as `Library`, `Radio`, `Spotify`, `AirPlay`, `Bluetooth`, and `DLNA`; Library then separates storage (`Local`, `NAS`, `USB`, `Favorites`, `Recently Added`) from Local taxonomy (`Focus`, `Meditation`, `Rest`, then subfolders). The current Local tree is `Focus` -> `Lo-fi / Ambient`, `Classical / Piano`, `Binaural / Alpha / Theta`, `White Noise / Brown Noise`; `Meditation` -> `Guided Meditation`, `Breathing`, `Singing Bowl`, `Nature Sounds`; and `Rest` -> `Nap`, `Sleep`, `Rain / Ocean / Forest`, `Deep Sleep Long Tracks`. `TIKPAL_RADIO_DEFAULT_URI` stays as a fallback when moOde presets are unavailable, while Bluetooth / AirPlay / DLNA gating is wired through environment-configured enable/disable and status commands. DLNA means Tikpal/moOde acts as a UPnP/DLNA renderer for external casting, not as a DLNA media-server browser. Bluetooth state now also carries the local advertised device name so the frontend can tell the user exactly what to look for on their phone while pairing.

Ambient lyrics now have two recognition paths behind the same `lyrics` state. Local `MPD` / `Radio` playback still resolves lyrics from metadata through LRCLIB, while Bluetooth first tries BlueZ / AVRCP title metadata and playback position, then can fall back to a short local PCM sample identified through ACRCloud before reusing the same LRCLIB lyrics lookup. The Bluetooth recognition path is only armed while Bluetooth is the selected source and the input is actually connected, and it keeps its own `bluetooth_input` scope so source truth stays separate from `audio.currentSource` and `playback.source`.

Quick Settings now includes local font presets and surface skin presets (`warm-gold`, `graphite-silver`, `ivory-studio`), and the ambient flame screen has split live-control zones: left for volume, right for DDC/CI brightness on supported displays. When the Ambient HUD is visible, the center control row stays intentionally shallow for the 2560 x 720 kiosk layout: previous scene, playback mode, previous track, play/pause, next track, favorite, lyrics, and next scene. Playback mode is a single mutually exclusive `playMode` value: `sequence`, `repeat_one`, or `shuffle`.

The Player and Ambient HUD both display playback truth from the active `playback.source` and current track metadata, rather than showing whichever Library item or source panel is selected for browsing. Generated fallback cover art still follows the selected font preset, while real playback artwork wins whenever the backend provides it.

Ambient background videos are discovered from `public/assets/*.mp4` and OTA-managed `public/assets/scenes/*.mp4` through `GET /api/v1/media/background-videos`. Scene changes mount the next video layer, seek it to `playback.elapsedSeconds % video.duration`, then crossfade; paused playback stays frozen on the new scene frame, while playing playback resumes the video after alignment. Within one looping scene, `FlameScene` keeps two video slots: the standby slot is prepared about 1.2 seconds before the natural tail, revealed about 0.42 seconds before the tail, and held through a 360ms visual / 340ms Scene Sound crossfade so Chromium does not hit the native MP4 loop boundary first. The web server serves MP4 files with byte-range support so browser video seeking works reliably. Ambient refreshes the scene catalog every 30 seconds and whenever the page becomes visible, so newly applied scene OTA packages join the previous / next scene controls without a page reload.

Resource OTA updates are handled by `npm run ota:resources -- <package-dir>`. A resource OTA package can replace `assets/music/_metadata/library_manifest.csv`, copy the referenced local music files under `assets/music/`, and add scene videos from `assets/scenes/` using `assets/scenes/_metadata/scene_videos.json`. Older packages may still include the legacy mutable fireplace video at `assets/output_2560x720-4k.mp4`, but the default Ambient scene catalog no longer depends on an `output*.mp4` file. The script validates music paths, scene MP4 checksums, and MP4 headers before writing, syncs `public/assets`, also syncs `dist/assets` when a production build exists, and records the result in `.tikpal/resource-ota-state.json`.

Scene MP4 OTA packages can be generated from a folder of `.mp4` files:

```bash
npm run ota:package:mp4 -- /path/to/mp4-scenes --recursive --bundle --default Forest-Cabin.mp4
```

By default the generator writes packages under `.tikpal/resource-ota-packages`, creates `assets/scenes/_metadata/scene_videos.json`, assigns stable scene ids from filenames, and records `sha256` checksums that `npm run ota:resources` verifies before installing. Use `npm run media:loop -- --input <mp4>` when a source scene needs a soft loop rewrite before packaging; the helper requires `ffmpeg` / `ffprobe` and writes a backup under `.codex-artifacts/media-backups` when it updates a file in place.

Use `npm run scene:clear` to remove installed Ambient scene videos from `public/assets/scenes`, mirror the clear into `dist/assets/scenes` when a production build exists, and leave an empty `scene_videos.json` so the UI returns to the black video-off state until the next scene package is installed.

## Current Gaps

The repo is no longer mock-only, but a few visible pieces are still only partial:

- The source model is still intentionally focused. The UI exposes six frontstage tabs (`Library`, `Radio`, `Spotify`, `AirPlay`, `Bluetooth`, `DLNA`), while internal `Audio` remains state/API truth rather than a visible browser category.
- The ambient right-side brightness gesture depends on working DDC/CI on the target display. When `ddcutil` cannot read or set VCP `0x10`, Tikpal currently degrades to read-only/unavailable status instead of offering a fallback brightness path.
- Ambient deliberately does not expose playlist or queue UI; queue preview belongs in the Player overlay so the default 720px-high dwell screen stays calm.
