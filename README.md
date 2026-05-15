# Tikpal

Tikpal is a documentation-first product project for a Raspberry Pi 4 based moOde streamer touch UI. The target device is a 2560 x 720 ultra-wide kiosk screen that should feel like a quiet HiFi object first, and a playback controller only when the user asks for controls.

The first version is intentionally documentation-only. It defines the product, interaction, visual, architecture, integration, and acceptance baseline before any runnable UI is implemented.

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

Reference assets:

- [Original product design PDF](docs/assets/references/moode-streamer-ui-product-design-doc.pdf)
- [UI reference board](docs/assets/references/ui-reference-board.png)

## MVP Summary

The first implementation milestone should deliver:

- Ambient flame screen with clock and subtle playback HUD.
- One-finger player overlay and two-finger quick settings overlay.
- Playback state, cover art, transport controls, progress, volume, format, sample rate, bit depth, output device, and network status.
- Quick settings cards for network, output, DSP, library update, display, system info, reboot, and shutdown.
- Long-press quick menu and a weak top-right settings fallback.
- Kiosk-safe behavior on Raspberry Pi 4 with 2560 x 720 fullscreen output.

## Repository Status

This repository begins as a product specification and implementation contract. Do not add runnable frontend code until the documentation baseline has been reviewed and the first implementation slice is chosen.
