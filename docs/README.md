# Tikpal Docs

This directory is the source of truth for Tikpal product, UX, visual, architecture, integration, and delivery planning.

## Status Labels

| Label | Meaning |
| --- | --- |
| Current reference | Use this as the current planning and implementation baseline. |
| Source reference | Original input material. Do not edit except to replace with a newer source. |
| Acceptance baseline | Use for implementation completion and device validation. |

## Current Scope

- Tikpal targets a Raspberry Pi 4 running Chromium kiosk at 2560 x 720.
- The first implementation should use Vite + React + TypeScript and Three.js / WebGL.
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
| [Pi4 kiosk WebGL architecture v1](03-architecture/pi4-kiosk-webgl-architecture-v1.md) | Current reference | Runtime topology, rendering policy, kiosk packaging, and performance budget. |

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

### Source Assets

| Asset | Status | Purpose |
| --- | --- | --- |
| [moOde streamer UI product design PDF](assets/references/moode-streamer-ui-product-design-doc.pdf) | Source reference | Original 24-page Chinese product design document. |
| [UI reference board](assets/references/ui-reference-board.png) | Source reference | Visual reference board for layout, hierarchy, and interaction examples. |

## Public Interface Draft

The implementation exposes these concepts consistently across frontend state, local backend state, telemetry, and documentation:

```ts
type AppMode = "ambient" | "player" | "quickSettings" | "quickMenu";
type PlaybackState = "playing" | "paused" | "stopped";
type SourceState =
  | "mpd"
  | "airplay"
  | "spotify"
  | "bluetooth"
  | "roonbridge"
  | "upnp"
  | "radio";

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
- Visual layer: Three.js/WebGL flame scene with CSS-backed fireplace art and CSS fallback when WebGL is unavailable.
- State model: `ambient`, `player`, `quickSettings`, and `quickMenu`.
- Validation routes: `/`, `/?mode=player`, `/?mode=quickSettings`.
- Interaction validation: `npm run test:interaction` while the dev server is running.
- Kiosk guard: root-level context menu, drag, selection, browser zoom, and multi-touch browser default suppression.
- Ambient HUD: visible on startup, auto-hides after 5s, and can be shown again with a single tap.
- Playback backend: `mock` by default, `mpc` when the Pi runtime sets `TIKPAL_PLAYER_BACKEND=mpc`.
