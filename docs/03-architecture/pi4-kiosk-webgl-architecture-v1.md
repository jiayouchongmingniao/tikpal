# Pi4 Kiosk WebGL Architecture v1

## Summary

Tikpal should run as a local web app on Raspberry Pi 4 and be displayed by Chromium in kiosk mode. The implementation should keep the physical screen at 2560 x 720 and control visual cost through render budgets, WebGL detail levels, and runtime diagnostics.

## Target Runtime

| Layer | Default |
| --- | --- |
| Device | Raspberry Pi 4 |
| OS role | moOde Audio host plus local Tikpal services |
| Display | HDMI touch screen, 2560 x 720 |
| Browser | Stock Chromium, kiosk mode |
| Frontend | Vite + React + TypeScript |
| Visual renderer | Three.js / WebGL |
| Local service | Node.js HTTP API for playback/system/kiosk bridge |
| Audio owner | moOde / MPD |

## Repository Boundary

The first commit is documentation-only. The future implementation should keep these boundaries:

- `src/`: React UI, Three.js/WebGL visual layer, touch state machine, and client data hooks.
- `server/`: local API, moOde / MPD adapters, system state, kiosk diagnostics, and safe system actions.
- `deploy/chromium/`: Chromium kiosk launcher, flags, managed policies, profile cleanup, and validation checks.
- `deploy/systemd/`: API, web, and kiosk services.
- `docs/`: product and implementation contract.

Current deployment package:

- `server/index.mjs`: local mock API and future adapter boundary.
- `server/web.mjs`: production static server for `dist/`, with `/api` proxied to the API service.
- `deploy/chromium/launch-tikpal-kiosk.sh`: Chromium launcher with `--check`, dedicated profile cleanup, dark startup flags, and display mode hooks.
- `deploy/chromium/start-tikpal-kiosk-session.sh`: X-session entrypoint for systemd `startx`.
- `deploy/systemd/install-systemd-services.sh`: installs `tikpal-api.service`, `tikpal-web.service`, and optionally `tikpal-kiosk.service`.

## Kiosk Launch Goals

The kiosk must:

- Open the local web UI full screen.
- Hide browser chrome and restore prompts.
- Preserve `http://localhost` access.
- Start with a black background before CSS and JS load.
- Avoid showing tty/login artifacts during normal boot.
- Use a dedicated Chromium profile.
- Expose a `--check` style validation path before launch.

Recommended future environment names:

```bash
TIKPAL_KIOSK_URL=http://localhost:4173/
TIKPAL_KIOSK_WINDOW=2560x720
TIKPAL_KIOSK_DISPLAY=:0
TIKPAL_KIOSK_XRANDR_MODE=2560x720
TIKPAL_CHROMIUM_BIN=/usr/lib/chromium-browser/chromium-browser
TIKPAL_CHROMIUM_PROFILE_DIR=/home/moode/.config/tikpal-chromium-kiosk
TIKPAL_CHROMIUM_COLOR_SCHEME=dark
TIKPAL_RENDERER=webgl
TIKPAL_RENDER_PROFILE=pi4-balanced
```

These names are now used by `deploy/chromium/env.kiosk.example`.

## WebGL Policy

WebGL should power the ambient flame visual, but the UI should not depend on an all-or-nothing renderer.

Renderer requirements:

- Prefer WebGL2 when available.
- Fall back to lower-detail WebGL or a static/image ambience if initialization fails.
- Report renderer type and fallback reason.
- Handle context loss without crashing the whole UI.
- Keep HUD and controls readable if the visual layer degrades.

Three.js should be used for the primary flame scene because it provides a stable rendering layer and a familiar ecosystem for future visual modes.

## Performance Budget

The Pi4 target should be treated as a constrained kiosk, not a desktop browser.

Initial goals:

| Surface | Target |
| --- | --- |
| Ambient flame | Stable 24-30fps minimum on Pi4 at 2560 x 720 output. |
| Player overlay | Controls remain responsive under 100-150ms perceived input latency. |
| Quick settings | No heavy continuous animation. |
| Status polling | Low frequency, event-driven where possible. |
| Progress bar | 1Hz update is enough. |
| Audio/system status | Refresh on change or slow interval, not high-frequency polling. |

Performance controls:

- Flame quality tier.
- Particle count tier.
- Internal render scale.
- Frame-rate cap.
- Reduced motion / low power mode.
- Static fallback.

## Runtime Diagnostics

The implementation should expose a debug/status surface for:

- Effective render profile.
- Renderer type: `webgl`, `webgl-low`, `image`, `static`, or fallback.
- Average FPS, p10 FPS, and last frame interval.
- WebGL init errors.
- Context lost count.
- Current viewport and physical display size.
- Chromium experiment/profile name.
- Kiosk URL and launch mode.
- API/web/kiosk service status when available.

## Local API Boundary

Reserve local APIs for:

- Playback state and transport actions.
- System state and status cards.
- Library scan/update.
- Audio output and DSP status.
- Kiosk/runtime diagnostics.
- Safe system actions with confirmation and authorization.

The UI should not shell out directly or call moOde internals from the browser. Browser code should talk to the local backend.

## Startup Experience

Startup should feel intentional:

- Browser background is black before app CSS loads.
- Initial screen should show a short branded dark loading state when needed.
- Default entry is ambient, not an old route or stale overlay.
- After initial sync, backend state can update playback HUD and overlays.

## Implementation Defaults

- Use stock Chromium; do not fork Chromium.
- Keep physical output at 2560 x 720 unless the user explicitly asks for resolution experiments.
- Prefer app/render-scale tuning over permanent physical resolution reduction.
- Keep kiosk hardening repo-owned so deployment is repeatable.
- Validate on the actual Pi before declaring performance solved.
