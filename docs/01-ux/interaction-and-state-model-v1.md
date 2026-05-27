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
| Tap | Ambient | Toggle the weak playback HUD. When shown, the HUD auto-hides after 5 seconds. |
| Long press | Ambient | Open quick menu. |
| Vertical drag in left ambient zone | Ambient | Live volume adjustment against moOde volume state. |
| Vertical drag in right ambient zone | Ambient | Live display brightness adjustment through DDC/CI when available. |
| Non-Hi-Fi Ambient center controls | Ambient HUD visible | Previous scene, Focus/Calm/Sleep label plus intent, Scene Sound mute/unmute, and next scene. The strip width should follow its content rather than a fixed playback-control width. |
| Hi-Fi Ambient center controls | Ambient HUD visible | Play mode, previous track, play/pause, next track, favorite, playlist, lyrics, and Hi-Fi EQ preset switching. |
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

- Tap does not open controls; it only toggles the weak playback HUD.
- Startup should show the HUD briefly, then let the flame scene return to a quieter default after 5 seconds.
- Scene controls stay inside the temporary HUD. They do not open a scene browser or playlist drawer.
- The bottom HUD is a mode switcher for Focus, Calm, Sleep, and Hi-Fi.
- Focus, Calm, and Sleep use a content-sized center strip with the mode name and intent: `Focus / Deep work & reading`, `Calm / Unwind & relax`, and `Sleep / Dim, timer, fade-out`.
- Focus, Calm, and Sleep do not show music playback buttons, favorite, playlist, queue, seek progress, or lyrics on Ambient. Lyrics remain a Hi-Fi playback affordance only.
- Hi-Fi uses the larger playback center controls: playback mode, previous/next, play/pause, favorite, playlist, lyrics, and EQ preset switching.
- Ambient must not show queue or playlist content; queue preview stays in the Player overlay.
- The left edge band is reserved for live volume drag and should not fall through to the generic one-finger swipe-down player gesture.
- The right edge band is reserved for live brightness drag and should not fall through to the generic one-finger swipe-down player gesture.
- If DDC/CI brightness is unavailable on the target display, the right-side control zone should show unavailable feedback instead of behaving like a normal ambient gesture lane.
- Horizontal swipe is reserved for ambience mode switching after MVP.
- The weak top-right settings entry should be visible enough to discover but not visually compete with the flame scene.

### Player

- Blank tap returns to ambient because player is a temporary overlay.
- Swipe up returns to ambient even when the gesture starts inside the protected player panel.
- Button-sized taps inside the protected player panel must remain local control actions, not blank-tap returns.
- Transport controls must never be smaller than 72 x 72px.
- Play / pause should be the dominant control, 96-112px.
- Queue, source, audio status, and volume can expand panels from within player.
- Player volume uses a 0-100 range slider instead of step buttons. Dragging the slider should update UI immediately and send `volume_set` as the single global volume action.
- The displayed volume percent should match `system.volume.percent`, including while Scene Sound is active.

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
- Hi-Fi mode disables Scene Video and Scene Sound controls; the Ambient scene previous/next controls switch real Hi-Fi EQ presets instead of mounting MP4 scenes.
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
