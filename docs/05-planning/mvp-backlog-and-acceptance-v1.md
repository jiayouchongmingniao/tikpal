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
- Implement two-finger swipe down to playlist with threshold hint.
- Implement swipe up return.
- Implement long-press quick menu.
- Implement inactivity timers.

Acceptance:

- One-finger swipe reliably opens player.
- Two-finger swipe reliably opens playlist.
- Releasing below threshold cancels playlist.
- Swipe up returns from player, playlist, and quick settings, including gestures that start inside protected overlay panels.
- Playlist opens as a 2560 x 720 touch-first three-column hub with current songs, playlist library, and contextual actions.
- Playlist create/add/reorder/remove/rename/cover/duplicate/delete-confirm flows use large touch targets and do not depend on hover, right-click, or double-click.
- Playlist also works with desktop trackpads: horizontal two-finger swipes reveal the same card/song quick actions, and vertical trackpad scrolling stays inside the hub instead of returning to Ambient.
- Playlist metadata persists mood tags and cover settings; curated playlists remain read-only but can be duplicated into editable user playlists.
- Protected panel taps remain local control/settings clicks and do not count as blank-tap return.
- Player returns after 15 seconds idle.
- Playlist returns after 30 seconds idle.
- Quick settings returns after 30 seconds idle.
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

### Slice 6: Quick Settings

- Add card grid for Network, Preferences, and System categories covering network, audio output, DSP, display, font, skin, lyrics, library, system info, reboot, and shutdown.
- Add confirmation flow for dangerous actions.
- Add library update action where supported.

Acceptance:

- Network, Preferences, and System cards render from backend or mock state.
- Reboot and shutdown cannot run on first tap.
- Dangerous confirmation is visually distinct.

Current status note:

- Quick Settings is implemented as a fixed four-column 2560 x 720 card grid with no Home/Overview category; it opens directly to Preferences and keeps Network, Preferences, and System as the only categories.
- Skin presets currently include `warm-gold`, `graphite-silver`, and `ivory-studio`.
- Display brightness is reflected in system state and can now be adjusted both from the ambient right-edge gesture and from an in-panel Quick Settings control surface on DDC/CI-capable hardware.

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
- Two-finger swipe down opens playlist.
- Two-finger swipe has mistake prevention threshold feedback.
- Horizontal trackpad swipes open Playlist quick actions without requiring debug-mode toggles.
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

### Quick Settings

- Network state displays correctly.
- Preferences output state displays correctly.
- DSP state displays correctly.
- Library update entry is available.
- Display brightness state is visible.
- Reboot and shutdown require confirmation.
- Settings cannot accidentally trigger dangerous operations.

### Experience

- Daily playback does not require entering settings.
- Settings are reachable through at least two paths.
- Device returns to ambient after inactivity.
- Main screen remains readable from a distance.
- UI does not feel like a complex configuration center.

## Risks

| Risk | Mitigation |
| --- | --- |
| Ambient rendering cost is too high on Pi4 at 2560 x 720. | Keep media bitrate/decode cost bounded, retain the static fireplace image fallback, and reserve render scale / quality tier controls for future generated renderers. |
| Browser startup shows white or restore UI. | Set black HTML background, use dark Chromium flags, dedicated profile, and profile cleanup. |
| Two-finger gesture is hard to discover. | Keep a visible Playlist entry in Player and a weak gear for Quick Settings. |
| moOde data is inconsistent across sources. | Normalize source state and label passive renderers as status, not guaranteed switch actions. |
| Dangerous system actions are triggered accidentally. | Require explicit confirmation and separate dangerous actions visually. |
| Ambient live-control zones conflict with shell gestures. | Reserve protected left/right ambient edge bands so volume and brightness drags do not fall through to generic swipe-down navigation. |
| DDC/CI behavior differs across displays. | Treat brightness as capability-detected state, parse monitor-specific `ddcutil` output carefully, and degrade to unavailable feedback instead of issuing blind writes. |
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
- Playlist timeout: 30 seconds.
- Quick settings timeout: 30 seconds.
- Tap HUD boost: 5 seconds.
- Physical output: 2560 x 720.
- Frontend stack: Vite + React + TypeScript.
- Visual stack: fireplace image plus local MP4 ambience layers; optional generated renderers remain future-facing.
- Backend owner: local Node.js service.
- Audio owner: moOde / MPD.
