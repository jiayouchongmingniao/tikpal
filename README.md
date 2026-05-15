# Tikpal

Tikpal is a documentation-first product project for a Raspberry Pi 4 based moOde streamer touch UI. The target device is a 2560 x 720 ultra-wide kiosk screen that should feel like a quiet HiFi object first, and a playback controller only when the user asks for controls.

The project started documentation-first and now includes the first runnable frontend scaffold: a Vite + React + TypeScript app with a Three.js/WebGL ambient layer, kiosk-safe dark startup, fixed 2560 x 720 design rules, and mock player/settings surfaces.

## Product Direction

- Target hardware: Raspberry Pi 4, touch screen, 2560 x 720 physical output.
- Runtime: Chromium kiosk, full screen, no browser chrome.
- Frontend baseline: Vite + React + TypeScript.
- Visual rendering baseline: Three.js / WebGL for the ambient flame layer.
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
- Inactivity returns the device to the ambient flame screen.

## Documentation

Start with [docs/README.md](docs/README.md).

Key documents:

- [Product brief](docs/00-product/product-brief-v1.md)
- [Interaction and state model](docs/01-ux/interaction-and-state-model-v1.md)
- [Visual system and 2560 x 720 layout](docs/02-visual/visual-system-and-2560x720-layout-v1.md)
- [Pi4 kiosk WebGL architecture](docs/03-architecture/pi4-kiosk-webgl-architecture-v1.md)
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

The smoke test starts a temporary mock API, checks state endpoints, verifies playback actions, and confirms invalid action handling.

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

The smoke test drives Chrome through the DevTools protocol and checks wheel/trackpad-style entry, overlay return, protected panel clicks, and the quick settings fallback path.

## MVP Summary

The first implementation milestone should deliver:

- Ambient flame screen with clock and subtle playback HUD.
- One-finger player overlay and two-finger quick settings overlay.
- Playback state, cover art, transport controls, progress, volume, format, sample rate, bit depth, output device, and network status.
- Quick settings cards for network, output, DSP, library update, display, system info, reboot, and shutdown.
- Long-press quick menu and a weak top-right settings fallback.
- Kiosk-safe behavior on Raspberry Pi 4 with 2560 x 720 fullscreen output.

## Repository Status

Batch 3 local API bridge is implemented in mock mode: the frontend reads Tikpal state from `/api/v1/system/state`, playback controls post to `/api/v1/playback/actions`, and the UI falls back gracefully when the API is unavailable. The repo now also includes the Raspberry Pi kiosk deploy package for API, web, and Chromium services.

The real moOde / MPD adapter is still the next backend step. The current API shape is intended to be the stable contract for that adapter.
