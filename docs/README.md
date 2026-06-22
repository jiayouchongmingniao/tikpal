# Tikpal Docs

This directory is the source of truth for Tikpal product, UX, visual, architecture, integration, marketing, and delivery planning.

## Status Labels

| Label | Meaning |
| --- | --- |
| Current reference | Use this as the current planning and implementation baseline. |
| Source reference | Original input material. Do not edit except to replace with a newer source. |
| Acceptance baseline | Use for implementation completion and device validation. |

## Current Scope

- Tikpal targets a Raspberry Pi 4 running Chromium kiosk at 2560 x 720.
- The current implementation uses Vite + React + TypeScript, a local Node API, and a fireplace image plus local MP4 ambience layer. WebGL remains an architecture/performance track for future renderers rather than the active flame surface.
- The default screen is an ambient flame screen, not a conventional app homepage.
- moOde / MPD remains the playback and system capability owner; Tikpal presents a focused touch UI over those capabilities.
- Batch 3 now includes a local API bridge, frontend API read/write path, a repo-owned Chromium kiosk package, and an optional native MPD backend for moOde devices.

## Document Index

### Product

| Document | Status | Purpose |
| --- | --- | --- |
| [Product brief v1](00-product/product-brief-v1.md) | Current reference | Product goal, hierarchy, MVP boundaries, and source-derived decisions. |

### UX

| Document | Status | Purpose |
| --- | --- | --- |
| [Interaction and state model v1](01-ux/interaction-and-state-model-v1.md) | Current reference | Gestures, app modes, timeout behavior, and mistake prevention. |

### Visual

| Document | Status | Purpose |
| --- | --- | --- |
| [Visual system and 2560 x 720 layout v1](02-visual/visual-system-and-2560x720-layout-v1.md) | Current reference | Layout proportions, colors, type, control sizing, and page composition. |

### Architecture

| Document | Status | Purpose |
| --- | --- | --- |
| [Pi4 kiosk runtime architecture v1](03-architecture/pi4-kiosk-webgl-architecture-v1.md) | Current reference | Runtime topology, rendering policy, kiosk packaging, and performance budget. |

### Integration

| Document | Status | Purpose |
| --- | --- | --- |
| [moOde capability mapping v1](04-integration/moode-capability-mapping-v1.md) | Current reference | Mapping moOde / MPD capabilities into Tikpal UI state and controls. |

### Planning

| Document | Status | Purpose |
| --- | --- | --- |
| [MVP backlog and acceptance v1](05-planning/mvp-backlog-and-acceptance-v1.md) | Acceptance baseline | Build slices, acceptance criteria, risks, and first implementation defaults. |

### Deployment

| Document | Status | Purpose |
| --- | --- | --- |
| [Raspberry Pi kiosk deploy v1](06-deployment/raspberry-pi-kiosk-deploy-v1.md) | Current reference | Pi sync, systemd install, Chromium kiosk launch, verification, and rollback. |

### Marketing

| Document | Status | Purpose |
| --- | --- | --- |
| [Facebook homepage content kit](07-marketing/facebook-homepage-content-kit.md) | Current marketing draft | Facebook Page bio, voice guide, 30-day content calendar, reusable post templates, crowdfunding series, and Meta scheduling CSV guidance. |
| [Meta Business Suite calendar CSV](07-marketing/meta-business-suite-calendar.csv) | Current marketing draft | 30-day Facebook scheduling export with post copy, media briefs, CTAs, timing defaults, and review status. |

### Source Assets

| Asset | Status | Purpose |
| --- | --- | --- |
| [moOde streamer UI product design PDF](assets/references/moode-streamer-ui-product-design-doc.pdf) | Source reference | Original 24-page Chinese product design document. |
| [UI reference board](assets/references/ui-reference-board.png) | Source reference | Visual reference board for layout, hierarchy, and interaction examples. |

## Public Interface Draft

The implementation exposes these concepts consistently across frontend state, local backend state, telemetry, and documentation:

```ts
type AppMode = "ambient" | "player" | "playlist" | "quickSettings" | "quickMenu";
type SurfaceTheme = "warm-gold" | "graphite-silver" | "ivory-studio";
type PlaybackState = "playing" | "paused" | "stopped";
type SourceState =
  | "audio"
  | "scene"
  | "mpd"
  | "airplay"
  | "spotify"
  | "bluetooth"
  | "roonbridge"
  | "upnp"
  | "radio";

type SourceSwitchTarget =
  | "mpd"
  | "audio"
  | "scene"
  | "radio"
  | "spotify"
  | "bluetooth"
  | "airplay"
  | "upnp";

interface SystemState {
  network: NetworkState;
  outputDevice: OutputDeviceState;
  volume: VolumeState;
  audioFormat: AudioFormatState;
  sampleRate: number | null;
  bitDepth: number | null;
  cpuTemp: number | null;
  dspState: DspState;
}
```

The local backend boundary should reserve endpoints or adapters for playback control, system state, library scan, kiosk status, and runtime diagnostics.

## Current Implementation Checkpoints

- Root app: Vite + React + TypeScript.
- Visual layer: image-backed scene fallback with local MP4 video layers, playback-time alignment, crossfaded scene changes, Pi single-loop scene handoffs that keep the outgoing layer until the incoming frame is drawable, no-logo normal playback, and stall/fallback health via `data-flame-video-health`.
- State model: `ambient`, `player`, `quickSettings`, and `quickMenu`.
- Validation routes: `/`, `/?mode=player`, `/?mode=quickSettings`.
- Interaction validation: `npm run test:interaction` while the dev server is running.
- Local library validation: `npm run test:library` checks the ignored `public/assets/music` manifest, covers, playlists, and MP3 paths for the curated Focus / Meditation / Rest taxonomy.
- Kiosk guard: root-level context menu, drag, selection, browser zoom, and multi-touch browser default suppression.
- Ambient HUD: visible on startup, auto-hides after 5s, and can be shown again with a single tap.
- Ambient Room Canvas: Focus, Calm, and Sleep center controls show scene previous/next, a six-choice source picker, Scene Sound, contextual clock copy, and the content-sized mode label/intent strip; they do not show track transport or lyrics. Hi-Fi keeps music transport, lyrics, and the same source picker.
- Playback backend: `mock` by default, `mpc` when the Pi runtime sets `TIKPAL_PLAYER_BACKEND=mpc`.
- Source workspace: visible tabs are Library, Radio, Spotify, AirPlay, Bluetooth, and DLNA; DLNA uses runtime source id `upnp` and means renderer intake, not media-server browsing. Spotify Connect, AirPlay, Bluetooth, and DLNA share one handoff rule across Ambient, Player, Remote, and Pi API state: `armed` waits, `connected` completes.
- Appearance: font presets and surface skin presets are persisted locally and applied across ambient, player, and settings surfaces.
- Room experience: startup offers Focus, Calm, Sleep, and Hi-Fi; Focus/Calm/Sleep open Scene Sound by default on boot, and selecting a music/input source keeps the scene video visible while muting scene audio. Hi-Fi applies `flat`, `warm`, or `vocal` EQ presets when the Pi command hook is configured, centers now-playing artwork and metadata, and never enables Scene Sound. Auto Night dims by selected timezone without changing sources.
- Device brightness: DDC/CI-capable displays are prepared by `deploy/moode/tikpal-ddcci-enable.sh`; `mpc` mode reports `display.transport="ddcci"` when `ddcutil getvcp 10 --brief` can read VCP `0x10`, and the Ambient left edge is the brightness gesture lane.
- Scene Sound on Pi: the active browser video supplies scene audio, so Chromium should route directly to the physical USB `dmix` device through `TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE`; moOde `_audioout` / Loopback remains for MPD, renderer intakes, and spectrum capture.
- Pi status reads: in `mpc` mode, combined state, playback status, system status, runtime, audio source, and portable remote reads return the latest in-memory runtime snapshot while slow probes run in a low-frequency background collector.
- AirPlay playback truth: title metadata, versioned cover art, elapsed position, and `airplay_input` lyrics refresh from the same backend snapshot so Ambient, Player, Hi-Fi, and portable remote stay aligned on the active AirPlay track. AirPlay lyrics use strict LRCLIB title/artist matching, and Hi-Fi lyrics visibility defaults on with `tikpal.lyricsVisible.v3` so stale older local storage cannot hide a ready lyrics wall.
- Scene context reads: `/api/v1/scene/context` returns cached timezone/daypart/location/weather copy for Ambient without changing Auto Night, room mode, source, or playback truth.
