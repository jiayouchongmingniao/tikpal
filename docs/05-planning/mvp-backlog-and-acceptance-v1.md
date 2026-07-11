# MVP Backlog and Acceptance v1

## Summary

This document turns the product design into buildable slices. The first repo commit is documentation-only. The first runnable implementation should be selected from these slices after the documentation baseline is reviewed.

## MVP Backlog

### Slice 1: Project Scaffold

- Create Vite + React + TypeScript app.
- Add the ambient visual stack and keep future renderer hooks isolated from the shell.
- Add fixed 2560 x 720 design viewport rules.
- Add black startup background in HTML before React loads.
- Add app mode state machine with `ambient`, `player`, `quickSettings`, and `quickMenu`.

Acceptance:

- Local app opens at the root route.
- No browser-white flash during initial load.
- App mode transitions can be exercised with temporary dev controls or test hooks.

### Slice 2: Ambient Flame Screen

- Implement the ambient flame visual. The current implementation uses a fireplace image plus local MP4 layers rather than generated WebGL flames.
- Add time display.
- Add weak playback HUD.
- Add tap-to-boost HUD behavior.
- Add renderer fallback and diagnostic fields.

Acceptance:

- Default entry is ambient.
- Flame animation is visible and does not obscure HUD text.
- Tapping strengthens playback HUD for 5 seconds and fades back.
- Renderer fallback keeps the page usable.

### Slice 3: Gesture State Machine

- Implement one-finger swipe down to player.
- Implement two-finger swipe down to Console with threshold hint.
- Implement swipe up return.
- Implement long-press quick menu.
- Implement inactivity timers.

Acceptance:

- One-finger swipe reliably opens player.
- Two-finger swipe reliably opens Console.
- Releasing below threshold cancels Console.
- Swipe up returns from player and Console, including gestures that start inside protected overlay panels.
- The kiosk UI does not expose playlist editing or ritual-builder flows; Library browsing remains the direct track-selection path.
- Protected panel taps remain local control/Console clicks and do not count as blank-tap return.
- Player returns after 15 seconds idle.
- Console returns after 30 seconds idle.
- Long press opens quick menu.

### Slice 4: Player Overlay

- Add 720 / 1240 / 600 horizontal layout.
- Add cover art area.
- Add current track metadata.
- Add progress and time.
- Add transport controls.
- Add right-side audio/status cards.

Acceptance:

- Title, artist, album, cover, playback state, progress, volume, format, output, network, and DSP states are visible from mock or backend data.
- Transport controls meet minimum touch size.
- Blank tap or swipe up returns to ambient; transport/control taps stay actionable inside the protected panel.

### Slice 5: moOde / MPD Playback Bridge

- Add local backend.
- Read MPD playback state.
- Implement play, pause, previous, next, seek, and volume actions where supported.
- Normalize source and audio state.

Acceptance:

- Current song and playback state match MPD.
- Transport controls affect real playback.
- Volume display matches actual output.
- Backend unavailable state is visible and graceful.

Batch 3 implementation note:

- Local Node API bridge is now implemented in mock mode.
- Frontend reads `/api/v1/system/state` and posts playback actions to `/api/v1/playback/actions`.
- API unavailable state falls back to bundled data and is visible in the UI.
- Real MPD/moOde adapter wiring remains required before this slice is fully device-accepted.
- The current repo has moved beyond this note: `mpc` mode is live on the Pi, radio presets are wired into the source panel, and ambient edge gestures now issue live `volume_set` updates against the same API contract.

### Slice 6: Console

- Add listening-first Console with Preferences, Library, Link, and Care chips covering audio output, DSP, display, font, skin, lyrics, library/NAS status, network, system info, reboot, and shutdown.
- Add confirmation flow for dangerous actions.
- Add library update action where supported.

Acceptance:

- Preferences, Library, Link, and Care tiles render from backend or mock state.
- Console shows current source/playback and audio format using existing state.
- Reboot and shutdown cannot run on first tap.
- Dangerous confirmation is visually distinct.

Current status note:

- Console is implemented as a fixed 2560 x 720 listening console with no Home/Overview category; it opens directly to Preferences, uses Preferences / Library / Link / Care chips, and keeps the internal `quickSettings` route for compatibility.
- Skin presets currently include `warm-gold`, `graphite-silver`, and `ivory-studio`.
- Display brightness is reflected in system state and can now be adjusted both from the ambient left-edge gesture and from an in-panel Console drawer on DDC/CI-capable hardware. The Pi deploy helper `deploy/moode/tikpal-ddcci-enable.sh` installs `ddcutil`, enables I2C access, writes `TIKPAL_DDCUTIL_*`, and has been validated on the XENEON EDGE target with `display.transport="ddcci"`.
- Console Link now owns Explore proxy and Keyboard setup. Explore itself is a browser wrapper with a 1920 x 720 provider window plus 640 x 720 side panel, and it deliberately does not become a Tikpal source or remembered playback state.

### Slice 7: Pi4 Kiosk Package

- Add Chromium launcher.
- Add managed policies and flags.
- Add dedicated Chromium profile cleanup.
- Add systemd services for API, web, and kiosk.
- Add kiosk validation command.

Acceptance:

- Kiosk launches local app full screen.
- Window size is 2560 x 720.
- Browser chrome and restore prompts do not show during normal startup.
- App starts with a dark background.
- Services restart cleanly.

Batch 4 deployment note:

- Repo-owned Chromium launcher, flags, managed policy, and `.env.kiosk` example are implemented under `deploy/chromium/`.
- `deploy/chromium/tikpal-web-mode.sh` launches optional Explore provider/side-panel windows, reads `.tikpal/web-mode-settings.json`, writes `.tikpal/web-mode-state.json`, applies the configured HTTP proxy to the provider window only, and surfaces `onboard` for login/password input.
- Explore acceptance: one visible provider window at 1920 x 720, one side panel at 640 x 720, no stale provider highlight, and no persistent second provider page after a site tries to open playback in a new window. The bundled Explore extension should keep common `_blank` links in the left pane; Chromium popup/ad settings are a best-effort guard, not a promise to remove every site promotion.
- API, production web, and kiosk service templates plus installer are implemented under `deploy/systemd/`.
- `server/web.mjs` serves `dist/` on port `4173` and proxies `/api` to the local API on port `8787`, so the Pi does not need the Vite dev server.
- `npm run test:kiosk` validates the local packaging contract; real fullscreen/window-size acceptance still requires the target Pi display.

## MVP Acceptance Criteria

### Ambient

- Default entry is the flame screen.
- Flame animation is smooth enough on the target device.
- Current time is correct.
- Playback information does not disturb the ambient visual.
- Tap strengthens playback information and fades it back automatically.

### Gestures

- One-finger swipe down opens player.
- Two-finger swipe down opens Console.
- Two-finger swipe has mistake prevention threshold feedback.
- Swipe up returns to ambient.
- Long press opens quick menu.
- Inactivity returns to ambient.

### Playback

- Song, artist, album, and cover display correctly.
- Play / pause state is synchronized.
- Previous and next work.
- Progress and playback time synchronize.
- Volume display matches real output.
- Format, sample rate, and bit depth display correctly.
- Output device displays correctly.

### Console

- Network state displays correctly.
- Preferences output state displays correctly.
- DSP state displays correctly.
- Library update entry is available.
- Display brightness state is visible.
- Reboot and shutdown require confirmation.
- Console cannot accidentally trigger dangerous operations.

### Experience

- Daily playback does not require entering settings.
- Console is reachable through at least two paths.
- Device returns to ambient after inactivity.
- Main screen remains readable from a distance.
- UI does not feel like a complex configuration center.

## Risks

| Risk | Mitigation |
| --- | --- |
| Ambient rendering cost is too high on Pi4 at 2560 x 720. | Keep media bitrate/decode cost bounded, retain the static fireplace image fallback, and reserve render scale / quality tier controls for future generated renderers. |
| Browser startup shows white or restore UI. | Set black HTML background, use dark Chromium flags, dedicated profile, and profile cleanup. |
| Two-finger gesture is hard to discover. | Keep the weak gear and long-press quick menu as visible settings fallbacks. |
| moOde data is inconsistent across sources. | Normalize source state and label passive renderers as status, not guaranteed switch actions. |
| Dangerous system actions are triggered accidentally. | Require explicit confirmation and separate dangerous actions visually. |
| Ambient live-control zones conflict with shell gestures. | Reserve protected edge bands so left brightness and right volume drags do not fall through to generic swipe-down navigation. |
| DDC/CI behavior differs across displays. | Treat brightness as capability-detected state, parse monitor-specific `ddcutil` output carefully, and degrade to unavailable feedback instead of issuing blind writes. |
| Scene Sound is enabled but silent on Pi. | Confirm the DOM video is unmuted and decoding, then verify Chromium is routed to the physical USB `dmix` output, `snd-aloop` is loaded for Loopback users, and external renderers such as `librespot` are closed when leaving their source. |
| Physical screen geometry is wrong. | Validate Chromium window size, xrandr output, and actual viewport on-device. |

## Visible Gaps

These gaps are obvious from the current repo state and should be treated as follow-up work rather than assumed complete:

- The player `Queue` button opens a preview panel, but queue management/editing is still outside the current kiosk contract.
- The source model is intentionally incomplete relative to full moOde. Six frontstage tabs are surfaced (`Library`, `Radio`, `Spotify`, `AirPlay`, `Bluetooth`, `DLNA`), but broader renderer/source administration is still outside the kiosk contract.

## Documentation Completeness Check

Before implementation starts, confirm:

- Product goals and non-goals are documented.
- Page hierarchy is documented.
- Gesture thresholds are documented.
- Visual layout proportions are documented.
- moOde capability mapping is documented.
- MVP and v2 boundaries are documented.
- Pi4 kiosk runtime assumptions are documented.
- Acceptance criteria are documented.

## Initial Defaults

- App mode: `ambient`.
- Player timeout: 15 seconds.
- Console timeout: 30 seconds.
- Tap HUD boost: 5 seconds.
- Physical output: 2560 x 720.
- Frontend stack: Vite + React + TypeScript.
- Visual stack: fireplace image plus local MP4 ambience layers; optional generated renderers remain future-facing.
- Backend owner: local Node.js service.
- Audio owner: moOde / MPD.
