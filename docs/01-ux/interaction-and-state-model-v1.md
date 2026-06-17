# Interaction and State Model v1

## Summary

Tikpal uses a small finite state machine. Only one primary overlay should be active at a time. This avoids stacked overlays, accidental setting changes, and app-like navigation complexity.

## App Modes

```ts
type AppMode = "ambient" | "player" | "playlist" | "quickSettings" | "quickMenu";
```

| Mode | Entry | Exit |
| --- | --- | --- |
| `ambient` | Default startup and timeout state. | One-finger swipe down, two-finger swipe down, long press, tap, optional horizontal swipe. |
| `player` | One-finger swipe down from `ambient`; quick menu item. | Swipe up, blank tap, 15s inactivity. |
| `playlist` | Two-finger swipe down from `ambient`; Player playlist entry. | Swipe up, blank tap, 30s inactivity. |
| `quickSettings` | Weak gear; quick menu item. | Swipe up, 30s inactivity, confirmed action completion. |
| `quickMenu` | Long press on `ambient`. | Select item, cancel, blank tap. |

## Gesture Contract

| Gesture | Target | Behavior |
| --- | --- | --- |
| One-finger swipe down | Ambient | Open player overlay. |
| Two-finger swipe down | Ambient | Open playlist / Scene Library overlay. |
| Swipe up | Player, playlist, or quick settings | Return to ambient, including swipes that start inside the overlay panel. |
| Tap | Ambient | In Focus/Calm/Sleep, show the HUD and open the lightweight source picker; in Hi-Fi, toggle the HUD. The HUD and picker auto-hide after 5 seconds without input. |
| Long press | Ambient | Open quick menu. |
| Vertical drag in left ambient zone | Ambient | Live display brightness adjustment through DDC/CI when available. |
| Vertical drag in right ambient zone | Ambient | Live volume adjustment against moOde volume state. |
| Non-Hi-Fi Ambient center controls | Ambient HUD visible | Previous scene, Focus/Calm/Sleep label plus intent, lightweight source picker, Scene Sound mute/unmute, and next scene. The strip width should follow its content rather than a fixed playback-control width. |
| Hi-Fi Ambient center controls | Ambient HUD visible | Play mode, lightweight source picker, previous track, play/pause, next track, favorite, playlist, and lyrics. |
| Arrow keys | Ambient HUD visible | In Focus/Calm/Sleep, up/down/left/right change scene and Space/Enter toggles Scene Sound. In Hi-Fi, scene arrows switch EQ presets and track arrows keep playback behavior. |
| Volume range slider | Player | Update the same global volume state used by Ambient and scene video audio. |

## Gesture Thresholds

| Gesture | Recommended Threshold |
| --- | --- |
| One-finger swipe down | 80-120px vertical travel. |
| Two-finger swipe down | 120-160px vertical travel. |
| Long press | 800-1000ms. |
| Ambient HUD default dwell | 5000ms from startup before auto-hide. |
| Tap-shown HUD dwell | 5000ms before auto-hide. |
| Player inactivity timeout | 15s. |
| Quick settings inactivity timeout | 30s. |
| Dangerous confirmation timeout | No auto-close, or extend to 60s. |

## Two-Finger Mistake Prevention

The two-finger Scene Library gesture must have process feedback:

- At about 40px travel, show a subtle top hint: continue down for playlist.
- At about 130px travel, commit to playlist.
- If released before the threshold, cancel and return to ambient.

This keeps ritual and playlist management discoverable without letting accidental two-finger contact feel like a mode jump.

## Fallback Entries

System settings must not rely only on a hidden two-finger gesture. The product must support at least one additional entry, preferably more:

- Weak gear icon in the top-right corner.
- Long-press quick menu.
- Future remote Setup key.
- Future mobile / Web UI entry.

## State Transitions

```mermaid
stateDiagram-v2
  [*] --> ambient
  ambient --> player: one-finger swipe down
  ambient --> playlist: two-finger swipe down
  ambient --> quickSettings: weak gear
  ambient --> quickMenu: long press
  ambient --> ambient: tap / HUD show-hide
  player --> ambient: swipe up / blank tap / 15s idle
  playlist --> ambient: swipe up / blank tap / 30s idle
  quickSettings --> ambient: swipe up / 30s idle
  quickMenu --> player: choose player
  quickMenu --> quickSettings: choose settings
  quickMenu --> ambient: cancel / choose ambient
```

## Interaction Details

### Ambient

- In Focus/Calm/Sleep, a tap shows the HUD and opens a lightweight source picker with six music/input choices: `Library`, `Radio`, `Spotify`, `AirPlay`, `Bluetooth`, and `DLNA`.
- The source picker floats centered above the temporary center strip, closes after a successful selection, outside click, Escape, or 5 seconds without interaction, and must show active, pending, and unavailable/error state.
- Source picker labels map internal source ids to user language: `mpd` is `Library`, and `upnp` is `DLNA`. It does not expose `scene` or `audio` as selectable music sources.
- Selecting `Spotify`, `AirPlay`, `Bluetooth`, or `DLNA` enters the same external handoff state in Ambient and Player: hide the normal source choices, show a "Waiting for connection" card with the advertised receiver name when available, keep polling the shared source state, and close only when `connectionState` becomes `connected` or the handoff times out and rolls back to the previous playable source.
- Startup should show the HUD briefly, then let the flame scene return to a quieter default after 5 seconds.
- Scene controls stay inside the temporary HUD. They do not open a scene browser or playlist drawer.
- The bottom HUD is a mode switcher for Focus, Calm, Sleep, and Hi-Fi.
- Focus, Calm, and Sleep use a content-sized center strip with the mode name and intent: `Focus / Deep work & reading`, `Calm / Unwind & relax`, and `Sleep / Dim, timer, fade-out`.
- When the clock is visible, the weak Ambient caption may include daypart, scene, and weather/location context from `/api/v1/scene/context`, but it remains decorative copy and must not change room mode, source, timer, or Auto Night behavior.
- Focus, Calm, and Sleep do not show music playback buttons, favorite, playlist, queue, seek progress, or lyrics on Ambient. Lyrics remain a Hi-Fi playback affordance only.
- Hi-Fi uses the larger playback center controls: playback mode, source picker, previous/next, play/pause, favorite, playlist, and lyrics.
- Hi-Fi defaults to centered now-playing artwork and metadata. When the lyrics toggle is on and `lyrics.status === "ready"` with at least one non-empty line, the main visual may switch to a cover-plus-lyrics wall while the bottom rolling ticker remains visible with the same current lyric line; when lyrics are unavailable, empty, or explicitly hidden, it must return to centered now-playing and hide both lyrics surfaces.
- Synced Hi-Fi lyrics should project the active line from the shared `playback.elapsedSeconds` clock between backend snapshot refreshes, then re-anchor on the next playback update. If the backend has ready lyrics but no reliable active line, the wall and ticker should stay visible and rotate a static active line locally. Both paths must derive from the same `lyrics` object so Ambient, Player, and portable remote state do not invent separate track truth.
- AirPlay playback must refresh title, artist, album, cover art, elapsed time, and lyrics from the same backend metadata snapshot. When the AirPlay track changes, all surfaces should prefer a temporary no-cover, recognizing, or `not_found` state over showing stale cover art, old lyrics, or same-title lyrics from a different artist with the new title.
- Ambient must not show queue or playlist content; queue preview stays in the Player overlay.
- Choosing any non-scene source from Ambient immediately switches through `/api/v1/audio/source`, keeps the current scene video visible in Focus/Calm/Sleep, and clears persisted `sceneSoundEnabled` so browser scene audio stays muted.
- The left edge band is reserved for live brightness drag and should not fall through to the generic one-finger swipe-down player gesture.
- The right edge band is reserved for live volume drag and should not fall through to the generic one-finger swipe-down player gesture.
- If DDC/CI brightness is unavailable on the target display, the left-side control zone should show unavailable feedback instead of behaving like a normal ambient gesture lane.
- Horizontal swipe is reserved for ambience mode switching after MVP.
- The weak top-right settings entry should be visible enough to discover but not visually compete with the flame scene.

### Player

- Blank tap returns to ambient because player is a temporary overlay.
- Swipe up returns to ambient even when the gesture starts inside the protected player panel.
- Button-sized taps inside the protected player panel must remain local control actions, not blank-tap returns.
- Transport controls must never be smaller than 72 x 72px.
- Play / pause should be the dominant control, 96-112px.
- Queue, source, audio status, and volume can expand panels from within player.
- Player source tabs use the same external handoff rule as Ambient for Spotify Connect, AirPlay, Bluetooth, and DLNA. A pending handoff replaces the source tabs with the waiting card so the user does not see a source as selected on one surface and merely armed on another.
- Player volume uses a 0-100 range slider instead of step buttons. Dragging the slider should update UI immediately and send `volume_set` as the single global volume action.
- The displayed volume percent should match `system.volume.percent`, including while Scene Sound is active.
- Player, Ambient Hi-Fi, and portable remote summaries must keep now-playing title, artist, album, artwork, source label, progress, favorite state, and queue position aligned with backend playback truth. Browsing a source, arming an external intake, or previewing a playlist must not overwrite the displayed track until the backend confirms playback/source truth.
- AirPlay metadata-backed lyrics use `sourceScope: "airplay_input"` and the shared playback clock, so portable remote refreshes and the kiosk Hi-Fi wall stay anchored to the same track. A ready AirPlay lyrics state must have the same title/artist identity as playback; if LRCLIB only has a same-title different-artist result, the UI should keep the centered now-playing state.

### Quick Settings

- Cards are summary-first.
- Settings has no Home or Overview category and opens directly to Preferences.
- The only categories are Network, Preferences, and System.
- Swipe up returns to ambient even when the gesture starts inside the protected settings panel.
- Button-sized taps inside the protected settings panel must remain local settings actions, not blank-tap returns.
- Dangerous actions require a confirmation state inside the card or a modal.
- Reboot, shutdown, database rebuild, audio output switch, network reset, and reset defaults are dangerous.

### Quick Menu

- Quick menu is a fallback, not a second navigation system.
- It should never expose deep settings directly.
- It should close cleanly on cancel or after choosing an item.
- Quick Menu may expose shallow scene toggles: Scene Video, Clock, and Scene Sound.
- Turning Scene Sound on forces Scene Video on, switches playback source truth to `scene`, and unmutes only the active Ambient video layer.
- Turning Scene Sound off returns playback to Library/MPD.
- Turning Scene Video off while Scene Sound is active also stops Scene Sound, returns playback to Library/MPD, and returns the video surface to a black quiet state.
- Hi-Fi mode disables Scene Video and Scene Sound controls and does not mount MP4 scenes.
- Auto Night uses the selected timezone to lower display brightness only. It must not switch modes, start Scene Sound, or interrupt Hi-Fi playback.

## Input Compatibility

MVP is touch-first. The state model should still reserve clean mappings for:

- Remote control: directional navigation, select, back, setup.
- Rotary control: volume, selection, press to confirm.
- Browser/dev input: mouse or touchpad simulation for local development.

Current desktop validation mappings:

- Wheel / trackpad up from ambient opens `player`.
- Wheel / trackpad down from ambient opens `playlist`.
- Shift + wheel from ambient also opens `playlist`.
- Wheel / trackpad up from an overlay returns to `ambient`.
- Clicks inside protected overlay panels do not count as blank-tap return.
- Drag / touch-swipe up inside protected player or settings panels returns to `ambient`.

## Non-Goals

- No multi-window navigation.
- No stacked player and settings overlays.
- No full moOde admin surface in the kiosk UI.
- No dangerous operation on first tap.
