# Pi4 Kiosk Runtime Architecture v1

## Summary

Tikpal should run as a local web app on Raspberry Pi 4 and be displayed by Chromium in kiosk mode. The implementation should keep the physical screen at 2560 x 720 and control visual cost through media-layer discipline, runtime diagnostics, and optional renderer budgets for future visual modes.

## Target Runtime

| Layer | Default |
| --- | --- |
| Device | Raspberry Pi 4 |
| OS role | moOde Audio host plus local Tikpal services |
| Display | HDMI touch screen, 2560 x 720 |
| Browser | Stock Chromium, kiosk mode |
| Frontend | Vite + React + TypeScript |
| Visual renderer | Fireplace image plus local MP4 ambience layers |
| Local service | Node.js HTTP API for playback/system/kiosk bridge |
| Audio owner | moOde / MPD |

## Repository Boundary

The repo now contains the local app, API, deploy package, and smoke tests. Keep these boundaries:

- `src/`: React UI, ambience media layer, touch state machine, player/settings overlays, and client data hooks.
- `server/`: local API, moOde / MPD adapters, system state, kiosk diagnostics, and safe system actions.
- `deploy/chromium/`: Chromium kiosk launcher, flags, managed policies, profile cleanup, and validation checks.
- `deploy/systemd/`: API, web, and kiosk services.
- `docs/`: product and implementation contract.

Current deployment package:

- `server/index.mjs`: local API with mock-by-default playback plus optional native `mpc` backend for moOde devices.
- `server/web.mjs`: production static server for `dist/`, with a full kiosk listener on `4173`, a portable remote listener on `4174`, and `/api` proxied to the API service under listener-specific access rules.
- `deploy/chromium/launch-tikpal-kiosk.sh`: Chromium launcher with `--check`, dedicated profile cleanup, dark startup flags, and display mode hooks.
- `deploy/chromium/tikpal-web-mode.sh`: optional Explore launcher for left-side official web players, right-side Tikpal panel, provider profiles, proxy flags, and `onboard` setup.
- `deploy/chromium/start-tikpal-kiosk-session.sh`: X-session entrypoint for systemd `startx`.
- `deploy/chromium/tikpal-kiosk-healthcheck.sh`: bounded X/Chromium/web/API/GPU-reset healthcheck used by the system watchdog.
- `deploy/systemd/install-systemd-services.sh`: installs `tikpal-api.service`, `tikpal-web.service`, and optionally `tikpal-kiosk.service`, kiosk diagnostics, and the kiosk watchdog timer.

## Kiosk Launch Goals

The kiosk must:

- Open the local web UI full screen.
- Hide browser chrome and restore prompts.
- Preserve `http://localhost` access.
- Start with a black background before CSS and JS load.
- Avoid showing kernel, systemd, udev, cursor, or tty/login artifacts during normal boot and reboot.
- Use a dedicated Chromium profile.
- Expose a `--check` style validation path before launch.

Recommended future environment names:

```bash
TIKPAL_KIOSK_URL=http://localhost:4173/
TIKPAL_WEB_REMOTE_PORT=4174
TIKPAL_KIOSK_WINDOW=2560x720
TIKPAL_KIOSK_DISPLAY=:0
TIKPAL_KIOSK_XRANDR_MODE=2560x720
TIKPAL_CHROMIUM_BIN=/usr/lib/chromium-browser/chromium-browser
TIKPAL_CHROMIUM_PROFILE_DIR=/home/moode/.config/tikpal-chromium-kiosk
TIKPAL_CHROMIUM_COLOR_SCHEME=dark
TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE=auto
TIKPAL_KIOSK_WATCHDOG_PAGE_HEARTBEAT_ENABLED=1
TIKPAL_KIOSK_WATCHDOG_PAGE_HEARTBEAT_URL=http://127.0.0.1:8787/api/v1/kiosk/heartbeat
TIKPAL_RENDERER=media
TIKPAL_RENDER_PROFILE=pi4-media
TIKPAL_WEB_MODE_DEFAULT_PROXY_URL=http://192.168.10.103:7897
TIKPAL_WEB_MODE_PROVIDER_TEXT_SCALE=1.10
TIKPAL_WEB_MODE_LEFT_WINDOW=1920x720
TIKPAL_WEB_MODE_PANEL_WINDOW=640x720
TIKPAL_PLAYER_BACKEND=mock
TIKPAL_MPD_HOST=127.0.0.1
TIKPAL_MPD_PORT=6600
TIKPAL_MPD_DEFAULT_QUEUE_PATH=Codex
```

These names are now used by `deploy/chromium/env.kiosk.example`.

`server/web.mjs` owns two fixed production listeners. Port `4173` always serves the full kiosk UI and trusted full API proxy; port `4174` always injects portable remote mode and limits its proxy to `/api/v1/remote/*`. This replaces Host/address-based UI selection, and `TIKPAL_WEB_REMOTE_PORT` must differ from `TIKPAL_WEB_PORT`.

## Explore Runtime

Explore is browser orchestration, not an audio source backend. The API stores provider/proxy state in `.tikpal/web-mode-state.json` and `.tikpal/web-mode-settings.json`, then calls `deploy/chromium/tikpal-web-mode.sh` to open or close the provider and side-panel windows. The launcher also writes runtime provider state after direct script actions, so `/side-panel` does not get stuck highlighting an old provider. The left provider Chromium gets `--proxy-server=<proxyUrl>` when proxy is enabled; the right `/side-panel` Chromium stays local and does not use the Explore proxy.

The side panel is a separate React root at `/side-panel`, not the main kiosk `App`, so it must not post kiosk heartbeats. Opening Explore pauses a local MPD file, stops an active HTTP Radio stream, closes Bluetooth / AirPlay / Spotify / DLNA renderer intakes through their disable hooks, and disables audible Scene Sound, but does not change `audio.currentSource` or `audio.rememberedSource`. While a provider is active, volume actions route through the system output helper and snapshots prefer that output value even if source truth still says `mpd`, `radio`, or a previously armed external intake; this lets the side-panel slider control Chromium's physical output. The side panel is opened first and remains alive while the target provider starts behind a left-screen transition veil; only the last successful target becomes `Active`. Every provider switch uses the same `xdotool` window lookup, per-provider CDP port, real-provider URL check, and readiness check before the target replaces the current window. The launcher keeps one visible 1920 x 720 provider after the staged switch, closes the old provider so it cannot keep playing, and leaves the 640 x 720 side panel untouched.

Each provider gets its own loopback Chrome DevTools Protocol port derived from `TIKPAL_WEB_MODE_PROVIDER_DEBUG_PORT`; the side panel has no CDP endpoint. `deploy/chromium/tikpal-web-mode-guard.mjs` is launched with `node --experimental-websocket` so the same guard runs on Node.js 20 as well as newer Node releases. It starts once the provider window exposes CDP, blocks browser-like context menus and shortcuts, accepts explicit accept-all/agree cookie consent buttons for every provider when the surrounding context is cookie/privacy consent, ignores normal OAuth navigation aborts, and redirects clear Chromium or provider failures to `/web-mode-error.html`. A short or blank SPA shell is redirected only after 18 seconds without DOM, resource, visible-element, or text progress, preventing slow Amazon Music and Deezer startup from being classified as `empty_page_timeout`. QQ Music additionally gets allowlisted prompt handling, same-pane navigation, and duplicate player pruning. Login, payment, purchase, membership, authorization, service terms, agreement, recharge, and subscription actions remain manual.

Provider input focus is observed through the same guard. A new click or focus on an editable field calls the existing launcher `keyboard` action, maps the full `onboard` window to the configured size and position, and keeps it above Chromium. The side panel has no manual Keyboard button. Onboard's own close key and a provider-background tap keep it hidden until another editable-field interaction instead of being defeated by focus polling. Provider Chromium uses `--disable-hang-monitor`, and Explore close force-terminates a provider that remains after a 200ms normal-exit grace period, so returning to Tikpal cannot stall on a `Page Unresponsive` dialog.

## Ambience Renderer Policy

The current ambient scene surface is media-backed: a static logo/fallback surface under local MP4 scene layers. Scene changes mount the incoming video, align it to `playback.elapsedSeconds % video.duration`, and reveal only after a drawable frame is ready. During normal playback the static logo/backdrop is hidden so a source change cannot expose a white/bright fallback frame; it is visible only for static-only and repeated-stall fallback states. In the Pi single-loop path, that logo fallback is a temporary degradation state: the current scene retries after a short delay, and a new scene source must clear the fallback so Focus / Calm / Sleep switching can remount video without requiring a kiosk restart.

Renderer requirements:

- Support byte-range MP4 serving so browser seeks can land on the aligned frame.
- Keep the logo/static surface as the always-available degraded visual state.
- Keep HUD and controls readable while video metadata or seeking is settling.
- Keep scene video rendering independent from music source playback; Scene Sound decides whether the active scene layer is audible.
- Unmute only the active video layer when `scene` is the playback source, and keep volume synced to `system.volume.percent`.
- On Pi, use the single-loop/stable scene path and `data-flame-video-health` to recover ordinary video-element stalls. Repeated stalls may briefly show the logo fallback, but that state must retry video mounting and must be cleared by scene changes. Full X/Chromium/V3D hangs are outside React's recovery boundary and belong to the systemd kiosk watchdog.
- Post a local kiosk heartbeat from the page and keep `/api/v1/kiosk/heartbeat` loopback-only. The watchdog can use stale heartbeats, stuck pending actions, event-loop lag, and scene-video health as a page-runtime signal without exposing that state to the portable remote API.
- Keep future WebGL/canvas visual modes optional and isolated from the player/settings shell.

Future renderer requirements:

- Prefer WebGL2 when available.
- Fall back to lower-detail WebGL, canvas, image, or static ambience if initialization fails.
- Report renderer type and fallback reason.
- Handle context loss without crashing the whole UI.
- Keep HUD and controls readable if the visual layer degrades.

## Performance Budget

The Pi4 target should be treated as a constrained kiosk, not a desktop browser.

Initial goals:

| Surface | Target |
| --- | --- |
| Ambient flame/video | Stable 24-30fps minimum on Pi4 at 2560 x 720 output. |
| Player overlay | Controls remain responsive under 100-150ms perceived input latency. |
| Console | No heavy continuous animation. |
| Status polling | Low frequency, event-driven where possible. |
| Progress bar | 1Hz update is enough. |
| Audio/system status | Refresh on change or slow interval, not high-frequency polling. |

Performance controls:

- Video decode cost and asset bitrate.
- Pi-friendly MP4 encoding: H.264 Main Profile Level 4.1, `yuv420p`, closed GOP, no B-frames, bounded bitrate, AAC stereo, and `+faststart`.
- Avoiding Chromium native short-MP4 loop boundaries through prepared standby frames or the Pi stable-loop fallback.
- Flame quality tier for future generated renderers.
- Particle count tier for future generated renderers.
- Internal render scale.
- Frame-rate cap.
- Reduced motion / low power mode.
- Static fallback.

## Runtime Diagnostics

The implementation should expose a debug/status surface for:

- Effective render profile.
- Renderer type: `media`, `webgl`, `webgl-low`, `image`, `static`, or fallback.
- Average FPS, p10 FPS, and last frame interval.
- Media seek/metadata readiness for the active background video.
- Scene video health through `data-flame-video-health`, frame-ready state, loop role, and active audio role.
- WebGL init errors for optional generated renderers.
- Context lost count.
- Current viewport and physical display size.
- Chromium experiment/profile name.
- Kiosk URL and launch mode.
- API/web/kiosk service status when available.
- Kiosk Chromium ALSA output device and recent `PcmOpen` errors when Scene Sound appears silent.

## Local API Boundary

Reserve local APIs for:

- Playback state and transport actions.
- System state and status cards.
- Library scan/update.
- Audio output and DSP status.
- Kiosk/runtime diagnostics.
- Safe system actions with confirmation and authorization.

The UI should not shell out directly or call moOde internals from the browser. Browser code should talk to the local backend.

For moOde deployments, the backend may switch from `mock` to `mpc` through `.env`. In that mode the server owns queue seeding, real transport actions, and passive playback reads through `mpc`, while the browser contract stays unchanged.

In `mpc` mode, status reads should be stale-while-refresh. The API keeps an in-memory Tikpal state snapshot and refreshes slow runtime facts in a background collector controlled by `TIKPAL_STATE_SNAPSHOT_REFRESH_MS`. Read endpoints such as `/api/v1/system/state`, `/api/v1/playback/status`, `/api/v1/system/status`, `/api/v1/system/runtime`, `/api/v1/audio/sources`, and the portable remote state should return the cached snapshot immediately. Slow probes such as `systemctl`, `ddcutil`, source status commands, and external metadata helpers must not sit in the browser request path.

Write endpoints still execute the required control command synchronously when the user asks for an action, then update a lightweight snapshot from fast playback state and let the full collector catch up. This keeps transport, volume, source, and brightness actions honest without letting a blocked diagnostics command freeze the whole kiosk page.

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
