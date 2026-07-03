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
| Level 1 | Playlist page | Playlist creation, editing, ordering, local-track adds, and playlist playback. |
| Level 2 | Quick settings overlay | Low-frequency system cards for network, output, DSP, library update, display, and system actions. |

Primary gestures:

- One-finger swipe down opens the player control overlay.
- Two-finger swipe down opens the playlist page.
- Swipe up returns to the ambient flame screen.
- Tap temporarily strengthens playback HUD information.
- Long press opens a quick menu.
- Left ambient zone swipe adjusts display brightness live through DDC/CI when available.
- Right ambient zone swipe adjusts moOde/global volume live.
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
- Playlist page: [http://localhost:4173/?mode=playlist](http://localhost:4173/?mode=playlist)
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

## Portable Remote API

Portable controllers should use the safe facade instead of the kiosk's full internal API:

```bash
curl -fsS http://127.0.0.1:8787/api/v1/openapi.json
curl -fsS http://127.0.0.1:8787/api/v1/remote/state
curl -fsS -X POST http://127.0.0.1:8787/api/v1/remote/actions \
  -H "Content-Type: application/json" \
  -H "X-Tikpal-Key: $TIKPAL_PORTABLE_API_KEY" \
  --data '{"type":"playback.play_pause"}'
```

`GET /api/v1/remote/state` and `GET /api/v1/remote/catalog` expose playback, volume, room mode, scene, source, display, Hi-Fi EQ, and runtime state for a portable remote. `POST /api/v1/remote/actions` is the only portable write path and requires `TIKPAL_PORTABLE_API_KEY` through the `X-Tikpal-Key` header. Reboot, shutdown, library scan, and playlist CRUD stay local-only. Swagger-compatible JSON is available at `/api/v1/openapi.json` and `/api/v1/swagger.json`; `/api/v1/docs` is a lightweight local documentation page.

## Kiosk Package Smoke Test

Validate the Raspberry Pi service and Chromium kiosk package:

```bash
npm run test:kiosk
```

The smoke test checks the production static server path, systemd templates, kiosk launcher, watchdog timer, managed policy files, and `launch-tikpal-kiosk.sh --check`.

## Scene Video Stability

Scene Video is optimized for the Pi kiosk path: imported scene MP4s are normalized to Pi-friendly H.264, the foreground video layer waits for a drawable frame before reveal, and `FlameScene` exposes `data-flame-video-health` for ordinary video-element stalls. In Pi `mpc` stable-loop mode, scene changes keep the outgoing video mounted while the incoming scene decodes in a hidden layer; the incoming layer is not promoted until it has a drawable frame, so Focus / Calm / Sleep changes and manual scene changes do not expose the browser background. If repeated stalls force the static logo fallback, the single-loop path treats it as recoverable: a scene source change clears the fallback and the current scene retries after a short delay instead of waiting for the systemd watchdog to restart Chromium. The browser page also posts a loopback-only kiosk heartbeat to `POST /api/v1/kiosk/heartbeat` about every 10 seconds with room mode, playback/source state, pending actions, event-loop lag, and active scene-video health.

`GET /api/v1/kiosk/heartbeat` is intentionally local-only and is not part of the portable remote API. The systemd kiosk watchdog reads it from `127.0.0.1`; stale heartbeats, stuck pending actions, high page event-loop lag, or scene-video stall/fallback health are treated as `page-unhealthy` and recover by restarting only `tikpal-kiosk.service`.

## Raspberry Pi Deploy

Build locally, sync the repo to the Pi, and install the services from the repo-owned deploy package:

```bash
npm run typecheck
npm run test:api
npm run test:kiosk
npm run test:ota:package:mp4
npm run build
```

On the Pi:

```bash
cd /home/moode/code/tikpal
npm ci
npm run build
cp -n deploy/chromium/env.kiosk.example .env.kiosk
sudo deploy/moode/tikpal-ddcci-enable.sh
deploy/chromium/launch-tikpal-kiosk.sh --check
sudo deploy/moode/tikpal-quiet-boot-enable.sh
sudo deploy/systemd/install-systemd-services.sh --app-dir /home/moode/code/tikpal --user moode --enable-kiosk --restart
```

For Scene Sound on moOde, set `TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE` in `.env.kiosk` to the physical USB output's `dmix` device, for example `dmix:CARD=BT66,DEV=0`. Keep moOde's Loopback-backed `_audioout` for MPD/AirPlay/Bluetooth/Spotify/Hi-Fi capture paths, but do not point Chromium Scene Sound at `_audioout`; Chromium can decode the MP4 audio while logging `PcmOpen: _audioout,Device or resource busy` and producing no audible output.

`deploy/moode/tikpal-ddcci-enable.sh` installs `ddcutil` / `i2c-tools`, enables `i2c-dev`, grants the service user access to `/dev/i2c-*`, writes `TIKPAL_DDCUTIL_*` into `.env`, and probes VCP `0x10`. Reboot if the script cannot see `/dev/i2c-*` after first install.

`deploy/moode/tikpal-quiet-boot-enable.sh` suppresses normal boot/reboot console text on the HDMI kiosk display by quieting the kernel/systemd console path and disabling the visible `tty1` login prompt.

See the full deploy and rollback runbook in [docs/06-deployment/raspberry-pi-kiosk-deploy-v1.md](docs/06-deployment/raspberry-pi-kiosk-deploy-v1.md).

## Interaction Smoke Test

With the dev server running, verify the Batch 2 kiosk interaction contract:

```bash
npm run test:interaction
```

The smoke test drives Chrome through the DevTools protocol and checks wheel/trackpad-style playlist entry, ambient HUD controls, playback truth display, the Player source workspace, the three-column Playlist Hub create/add/reorder/delete-confirm flow, horizontal trackpad swipes for playlist/song quick actions, vertical trackpad scrolling inside Playlist without accidental exit, Library taxonomy, surface skin highlight states, overlay return, protected panel clicks, and Quick Settings detail panels.

## MVP Summary

The first implementation milestone should deliver:

- Ambient fireplace screen with clock and subtle playback HUD.
- One-finger player overlay, two-finger playlist page, and explicit quick settings entry.
- Playback state, cover art, transport controls, progress, volume, format, sample rate, bit depth, output device, and network status.
- Quick settings cards for network, output, DSP, library update, display, system info, reboot, and shutdown.
- Long-press quick menu and a weak top-right settings fallback.
- Kiosk-safe behavior on Raspberry Pi 4 with 2560 x 720 fullscreen output.

## Repository Status

The local API exposes a first-class audio-source model for `Library`, internal `Audio`, `Radio`, `Spotify Connect`, `Bluetooth`, `AirPlay`, and `DLNA`. The frontend reads current source summary from `/api/v1/system/state`, inspects compact source state through `GET /api/v1/audio/sources`, renders six visible source tabs (`Library`, `Radio`, `Spotify`, `AirPlay`, `Bluetooth`, `DLNA`), fetches the searchable radio catalog through `GET /api/v1/audio/radios`, fetches official station logos through `/api/v1/media/radio-logo`, fetches the manifest-backed local music library through `GET /api/v1/audio/library`, manages the touch-first Playlist Hub through `/api/v1/audio/playlists` and `/api/v1/audio/playlist-actions`, posts source switches to `POST /api/v1/audio/source`, and still uses `/api/v1/playback/actions` plus `/api/v1/system/actions` for transport and system cards. `AudioState.rememberedSource` persists the last visible source (`mpd`, `radio`, `spotify`, `bluetooth`, `airplay`, or `upnp`) in `.tikpal/audio-source-memory.json` so Hi-Fi can restore the last Library track, Radio station, or external waiting state without letting internal `scene` / `audio` overwrite it. Portable remotes use `/api/v1/remote/*` plus `X-Tikpal-Key` for safe LAN control; the full internal API remains local-kiosk-only when accessed through the production web proxy.

The real moOde / MPD adapter remains the audio owner. In `mpc` mode, Tikpal keeps MPD/library control as the default path, treats Radio as a curated station catalog with direct `radioStationId` switching, and now models Spotify Connect, Bluetooth, AirPlay, and DLNA as armed-only intake paths: they are connectable only while explicitly selected. External-to-external switches are target-first, so Tikpal returns the requested Spotify / Bluetooth / AirPlay / DLNA intake once it opens and cleans up old external receivers in the background; switches back to Library or Radio still close external receivers synchronously and prefer a confirmed MPD current file so stale external armed state cannot mask local playback. Radio defaults to the Tikpal-organized moOde presets, grouped as `Focus`, `Calm`, `Sleep`, `Hi-Fi`, `Jazz`, `Classical`, and `News`; `scope=all` keeps the full moOde catalog available with Tikpal rows first. Active Radio playback uses the station logo from moOde's local radio-logo library when available and falls back to generated cover art only after the official logo path fails. Radio switches prime the active station cache before the MPD stream has fully settled, and the browser polls faster while Radio source/next/previous actions are pending, so Player and Hi-Fi can show the new station logo before long stream verification finishes. Radio logo media supports GET and HEAD with a one-day cache window, letting repeated station changes reuse local artwork quickly. When Radio is selected while MPD software volume is `0%`, Tikpal restores the last nonzero MPD volume from `.tikpal/audio-volume-state.json`, or the current room-mode volume, before starting playback so a muted preset does not look like a broken source. While Radio is active, playback `next` and `previous` cycle through adjacent Tikpal stations instead of sending MPD queue commands to a single stream item; if MPD has already dropped the current stream from `mpc current`, Tikpal still keeps the failed stream URI from `mpc status` as Radio context and skips candidate stations that fail to start before returning an error. Clear stream failures such as `Failed to decode` or connection timeouts also trigger an automatic late-check advance to the next station, with a source-aware state refresh so the UI does not keep showing the dead station label. The player source rail is ordered as `Library`, `Radio`, `Spotify`, `AirPlay`, `Bluetooth`, and `DLNA`; Playlist is a separate three-column management page opened from Player or Ambient. Playlist user state persists name, mood tags, cover type/value, description, and track order in `.tikpal/music-library-state.json`; curated playlists stay read-only and can be duplicated into editable user playlists. The Playlist page supports both touchscreen gestures and desktop trackpad use: horizontal two-finger swipes reveal card/song quick actions, while vertical trackpad scrolling stays inside the readable columns instead of returning to Ambient. Library then separates storage (`Local`, `NAS`, `USB`, `Favorites`, `Recently Added`) from Local taxonomy (`Focus`, `Meditation`, `Rest`, then subfolders). The current Local tree is `Focus` -> `Lo-fi / Ambient`, `Classical / Piano`, `Binaural / Alpha / Theta`, `White Noise / Brown Noise`; `Meditation` -> `Guided Meditation`, `Breathing`, `Singing Bowl`, `Nature Sounds`; and `Rest` -> `Nap`, `Sleep`, `Rain / Ocean / Forest`, `Deep Sleep Long Tracks`. `TIKPAL_RADIO_DEFAULT_URI` stays as a fallback when moOde presets are unavailable, while Bluetooth / AirPlay / DLNA gating is wired through environment-configured enable/disable and status commands. DLNA means Tikpal/moOde acts as a UPnP/DLNA renderer for external casting, not as a DLNA media-server browser. Bluetooth state now also carries the local advertised device name so the frontend can tell the user exactly what to look for on their phone while pairing.

Ambient lyrics now have shared recognition paths behind the same `lyrics` state. Local `MPD` / `Radio` playback still resolves lyrics from metadata through LRCLIB, while Bluetooth and AirPlay first use trusted input metadata plus playback position before falling back to short local PCM identification when a capture command is configured. AirPlay cover art, title metadata, elapsed clock, and lyrics refresh from the same metadata snapshot, so Ambient, Player, Hi-Fi, and portable remote surfaces do not pair stale cover art or old lyrics with a new AirPlay track. AirPlay LRCLIB results must match the normalized title and artist before returning `ready`; same-title / different-artist results stay `recognizing` or `not_found`.

Quick Settings now includes local font presets and surface skin presets (`warm-gold`, `graphite-silver`, `ivory-studio`), and the ambient flame screen has split live-control zones: left for DDC/CI brightness on supported displays, right for volume. The Pi deploy path includes a repo-owned DDC/CI helper that installs `ddcutil`, enables I2C access, and lets `mpc` mode report `display.transport: "ddcci"` when the monitor exposes VCP `0x10`. When the Ambient HUD is visible, the Hi-Fi center row includes music transport, favorite, playlist, lyrics, and EQ preset switching; Focus, Calm, and Sleep stay on the lighter scene strip. Choosing Library, Radio, or an external intake from Focus/Calm/Sleep closes the picker and leaves only a small lower-left source pill, so the scene video remains the visual focus while the selected source or waiting state stays visible.

The Player and Ambient HUD both display playback truth from the active `playback.source` and current track metadata, rather than showing whichever Library item or source panel is selected for browsing. Hi-Fi uses that same truth for its centered now-playing view, lyrics wall, rolling lyrics ticker, AirPlay artwork, and Bluetooth no-cover poster, and entering Hi-Fi restores the remembered visible source if the current mode had been playing Scene Sound: a saved Library track is retried with a plain Library fallback, a saved Radio station is reopened by `radioStationId`, and saved Spotify/AirPlay/Bluetooth/DLNA sources reopen their waiting handoff state. Ready lyrics can replace the centered layout with a cover-plus-lyrics wall while keeping the bottom ticker on the same current line, synced lyrics advance from the shared playback clock between snapshot refreshes, static lyrics keep both lyrics surfaces visible when no active line can be projected, and real artwork always wins over generated art. When lyrics are unavailable and Hi-Fi returns to centered now-playing, a non-interactive playback presence cue keeps the playing state visible even at low volume; paused or stopped playback keeps that cue, the wave lines, and particles static. Lyrics visibility defaults on for new kiosk storage (`tikpal.lyricsVisible.v3`) and only the explicit user toggle should hide ready non-empty lyrics. Generated fallback cover art still follows the selected font preset outside the Bluetooth Hi-Fi fallback, while real playback artwork wins whenever the backend provides it.

Ambient background videos are discovered from `public/assets/*.mp4` and OTA-managed `public/assets/scenes/*.mp4` through `GET /api/v1/media/background-videos`. Scene changes mount the next video layer, seek it to `playback.elapsedSeconds % video.duration`, then crossfade; paused playback stays frozen on the new scene frame, while playing playback resumes the video after alignment. Within one looping scene, `FlameScene` keeps two video slots: the standby slot is prepared about 1.2 seconds before the natural tail, revealed about 0.42 seconds before the tail, and held through a 360ms visual / 340ms Scene Sound crossfade so Chromium does not hit the native MP4 loop boundary first. On Pi stable-loop mode, loop playback stays on the simpler single-video path, but scene switching still mounts a separate incoming layer, waits for `readyState >= 2`, nonzero video dimensions, and `data-flame-frame-ready="true"`, then dims, promotes, reveals, and cleans up only after the handoff. The normal video path keeps the static logo/backdrop hidden so scene switching does not flash white while a new source decodes; the logo surface remains only for static-only and repeated-stall fallback states. The Scene video surface exposes lightweight health through `data-flame-video-health`, retries stalled playback, and falls back to the static logo surface if the browser video element stops advancing repeatedly; that fallback must recover by remounting video on the next retry or scene change so a later Focus / Calm / Sleep switch cannot stay stuck on the logo. Scene Sound unmutes only the active video element, follows `system.volume.percent`, and depends on the kiosk Chromium ALSA route reaching the physical USB output. The Pi deploy package also installs an optional kiosk watchdog timer that recovers the full X/Chromium display stack when long-running Scene playback hits a V3D/GPU hang that frontend code cannot recover from. The web server serves MP4 files with byte-range support so browser video seeking works reliably. Ambient refreshes the scene catalog every 30 seconds and whenever the page becomes visible, so newly applied scene OTA packages join the previous / next scene controls without a page reload.

Resource OTA updates are handled by `npm run ota:resources -- <package-dir>`. A resource OTA package must provide `assets/music/_metadata/library_manifest.json`, copy the referenced local music files under `assets/music/`, and can add scene videos from `assets/scenes/` using `assets/scenes/_metadata/scene_videos.json`. Older packages may still include the legacy mutable fireplace video at `assets/output_2560x720-4k.mp4`, but the default Ambient scene catalog no longer depends on an `output*.mp4` file. The script validates music paths, scene MP4 checksums, and MP4 headers before writing, syncs `public/assets`, also syncs `dist/assets` when a production build exists, and records the result in `.tikpal/resource-ota-state.json`.

Scene MP4 OTA packages can be generated from a folder of `.mp4` files:

```bash
npm run ota:package:mp4 -- /path/to/mp4-scenes --recursive --bundle --default Forest-Cabin.mp4
```

By default the generator writes packages under `.tikpal/resource-ota-packages`, creates `assets/scenes/_metadata/scene_videos.json`, assigns stable scene ids from filenames, records `sha256` checksums that `npm run ota:resources` verifies before installing, and normalizes imported videos to Pi-friendly H.264 Main Profile Level 4.1 with bounded bitrate. Use `npm run media:loop -- --input <mp4>` when a source scene needs a soft loop rewrite before packaging; the helper requires `ffmpeg` / `ffprobe` and writes a backup under `.codex-artifacts/media-backups` when it updates a file in place.

Use `npm run scene:clear` to remove installed Ambient scene videos from `public/assets/scenes`, mirror the clear into `dist/assets/scenes` when a production build exists, and leave an empty `scene_videos.json` so the UI returns to the black video-off state until the next scene package is installed.

## Current Gaps

The repo is no longer mock-only, but a few visible pieces are still only partial:

- The source model is still intentionally focused. The UI exposes six frontstage tabs (`Library`, `Radio`, `Spotify`, `AirPlay`, `Bluetooth`, `DLNA`), while internal `Audio` remains state/API truth rather than a visible browser category.
- The ambient left-side brightness gesture depends on working DDC/CI on the target display. The validated XENEON EDGE target reports `VCP 10 C 80 100`; when `ddcutil` cannot read or set VCP `0x10`, Tikpal degrades to read-only/unavailable status instead of offering a fallback brightness path.
- Ambient deliberately does not render playlist or queue panels inline; playlist opens as its own page, and queue preview belongs in the Player overlay so the default 720px-high dwell screen stays calm.
