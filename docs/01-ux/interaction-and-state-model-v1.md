# Interaction and State Model v1

## Summary

Tikpal uses a small finite state machine. Only one primary overlay should be active at a time. This avoids stacked overlays, accidental setting changes, and app-like navigation complexity.

## App Modes

```ts
type AppMode = "ambient" | "player" | "quickSettings" | "quickMenu";
```

| Mode | Entry | Exit |
| --- | --- | --- |
| `ambient` | Default startup and timeout state. | One-finger swipe down, two-finger swipe down, long press, tap, optional horizontal swipe. |
| `player` | One-finger swipe down from `ambient`; quick menu item. | Swipe up, blank tap, 15s inactivity. |
| `quickSettings` | Two-finger swipe down from `ambient`; weak Console gear; quick menu item. | Swipe up, 30s inactivity, confirmed action completion. |
| `quickMenu` | Long press on `ambient`. | Select item, cancel, blank tap. |

## Gesture Contract

| Gesture | Target | Behavior |
| --- | --- | --- |
| One-finger swipe down | Ambient | Open player overlay. |
| Two-finger swipe down | Ambient | Open Console. |
| Swipe up | Player or Console | Return to ambient, including swipes that start inside the overlay panel. |
| Tap | Ambient | In Focus/Calm/Sleep, show the HUD and open the lightweight source picker; in Hi-Fi, toggle the HUD. The HUD and picker auto-hide after 5 seconds without input. |
| Long press | Ambient | Open quick menu. |
| Vertical drag in left ambient zone | Ambient | Live display brightness adjustment through DDC/CI when available. The overlay follows the hand immediately, but backend writes are coalesced to the final resting value. |
| Vertical drag in right ambient zone | Ambient | Live volume adjustment against moOde volume state. The overlay follows the hand immediately, but backend writes are coalesced to the final resting value. |
| Non-Hi-Fi Ambient center controls | Ambient HUD visible | Previous scene, Focus/Calm/Sleep label plus intent, lightweight source picker, Scene Sound mute/unmute, and next scene. The strip width should follow its content rather than a fixed playback-control width. |
| Hi-Fi Ambient center controls | Ambient HUD visible | Play mode, lightweight source picker, previous track, play/pause, next track, favorite, and lyrics. |
| Arrow keys | Ambient HUD visible | In Focus/Calm/Sleep, up/down/left/right change scene and Space/Enter toggles Scene Sound. In Hi-Fi, scene arrows switch EQ presets and track arrows keep playback behavior. |
| Volume range slider | Player | Update the same global volume state used by Ambient and scene video audio. |

## Gesture Thresholds

| Gesture | Recommended Threshold |
| --- | --- |
| One-finger swipe down | 80-120px vertical travel. |
| Two-finger swipe down | 120-160px vertical travel. |
| Long press | 800-1000ms. |
| Ambient HUD default dwell | 5000ms from startup before auto-hide. The startup room-mode chooser may auto-dismiss to the current persisted mode, but it must not re-send `set_mode` or replay room preset side effects unless the user taps a mode. |
| Tap-shown HUD dwell | 5000ms before auto-hide. |
| Player inactivity timeout | 15s. |
| Console inactivity timeout | 30s. |
| Dangerous confirmation timeout | No auto-close, or extend to 60s. |

## Two-Finger Mistake Prevention

The two-finger Console gesture must have process feedback:

- At about 40px travel, show a subtle top hint: continue down for Console.
- At about 130px travel, commit to Console.
- If released before the threshold, cancel and return to ambient.

This keeps Console discoverable without letting accidental two-finger contact feel like a mode jump.

## Fallback Entries

Console must not rely only on a hidden two-finger gesture. The product must support additional entries:

- Weak gear icon in the top-right corner.
- Long-press quick menu.
- Future remote Setup key.
- Future mobile / Web UI entry.

## State Transitions

```mermaid
stateDiagram-v2
  [*] --> ambient
  ambient --> player: one-finger swipe down
  ambient --> quickSettings: two-finger swipe down / weak gear
  ambient --> quickMenu: long press
  ambient --> ambient: tap / HUD show-hide
  player --> ambient: swipe up / blank tap / 15s idle
  quickSettings --> ambient: swipe up / 30s idle
  quickMenu --> player: choose player
  quickMenu --> quickSettings: choose Console
  quickMenu --> ambient: cancel / choose ambient
```

## Interaction Details

### Ambient

- In Focus/Calm/Sleep, a tap shows the HUD and opens a lightweight source picker with six music/input choices: `Library`, `Radio`, `Spotify`, `AirPlay`, `Bluetooth`, and `DLNA`.
- The source picker floats centered above the temporary center strip, closes after a successful selection, outside click, Escape, or 5 seconds without interaction, and must show active, pending, and unavailable/error state.
- Source picker labels map internal source ids to user language: `mpd` is `Library`, and `upnp` is `DLNA`. It does not expose `scene` or `audio` as selectable music sources.
- Selecting `Spotify`, `AirPlay`, `Bluetooth`, or `DLNA` enters the same external handoff state in Player and Hi-Fi: hide the normal source choices, show a "Waiting for connection" card with the advertised receiver name when available, keep polling the shared source state, and close only when the source is ready or the handoff times out and rolls back to the previous playable source. In Focus/Calm/Sleep, the picker closes immediately after the handoff starts and a lower-left source pill carries the waiting or connected state so the scene video stays immersive.
- Switching from one external intake to another should feel target-first: once the requested intake is armed or connected, the UI can show that target while the previous external receiver is cleaned up in the background. Switching back to Library or Radio is stricter: the backend must wait for MPD-backed playback/source truth so stale external waiting state cannot keep the surface stuck on Spotify, AirPlay, Bluetooth, or DLNA.
- Startup should show the HUD briefly, then let the flame scene return to a quieter default after 5 seconds.
- Scene controls stay inside the temporary HUD. They do not open a scene browser or playlist drawer.
- The bottom HUD is a mode switcher for Focus, Calm, Sleep, and Hi-Fi.
- Focus, Calm, and Sleep use a content-sized center strip with the mode name and intent: `Focus / Deep work & reading`, `Calm / Unwind & relax`, and `Sleep / Dim, timer, fade-out`.
- Focus, Calm, and Sleep each remember the last scene selected inside that mode. The mode preset supplies the first scene only; returning from Hi-Fi or another mode should restore the remembered scene instead of forcing the preset default such as Calm's Rainy Window.
- When the clock is visible, the weak Ambient caption may include daypart, scene, and weather/location context from `/api/v1/scene/context`, but it remains decorative copy and must not change room mode, source, timer, or Auto Night behavior.
- Focus, Calm, and Sleep do not show music playback buttons, favorite, playlist, queue, seek progress, or lyrics on Ambient. Lyrics remain a Hi-Fi playback affordance only.
- Hi-Fi uses the larger playback center controls: playback mode, source picker, previous/next, play/pause, favorite, and lyrics. Entering Hi-Fi restores the global remembered visible source from `audio.rememberedSource`: a saved Library track is retried with a plain Library fallback, a saved Radio station reopens by `radioStationId`, and saved Spotify/AirPlay/Bluetooth/DLNA sources reopen their waiting handoff state. The same restore applies when the app or API restarts while persisted room mode is already Hi-Fi, so a late-arriving `rememberedSource` must still be honored instead of leaving the room at `Not Playing`. During that startup restore, the first state visible to the kiosk should already reflect the recovered Library/Radio playback instead of a stale `stopped` snapshot. While Hi-Fi remains active, the backend should also recover remembered Library/Radio playback if MPD falls back to `stopped` or the wrong source; an explicit `paused` state and external-source waiting states are user intent and must not be auto-resumed. Hi-Fi source picker selections should release their pending UI as soon as backend state confirms the selected source, so switching from AirPlay to Bluetooth or back to Library never leaves the source button disabled. Library memory follows the actual local song after manual selection, playlist play, next, and previous; current-track checks may match by queue file path or by the remembered track's title / artist / duration so an internal queue id does not trigger a duplicate Library restore. Radio memory follows the final station that actually plays, even after the user returns to Library. Returning to either music source from Focus/Calm/Sleep should resume that source's last position without showing a blocking overlay.
- Hi-Fi defaults to centered now-playing artwork and metadata. When the lyrics toggle is on and `lyrics.status === "ready"` with at least one non-empty line, the main visual may switch to a shared cover-plus-lyrics wall; Bluetooth and AirPlay both use this same input-lyrics wall instead of source-specific lyric layouts. The compact rolling lyrics ticker is reserved for Focus/Calm/Sleep and must not appear under the Hi-Fi wall. The wall may include a decorative CSS-only mini EQ centered under the cover art, progress line, elapsed/duration readout, and capability-gated playback controls. That mini EQ should feel alive through deterministic per-bar timing and amplitude variation, but it must not claim to be real spectrum data and must pause with playback. When lyrics are unavailable, empty, or explicitly hidden, it must return to centered now-playing and hide lyrics surfaces. Old kiosk hidden-state storage is auto-restored once so a stale `lyricsVisible=false` value does not suppress newly ready lyrics forever. The centered fallback must still show a non-interactive playing-state motion cue that is visible at low volume and does not depend on audio amplitude.
- Synced Hi-Fi lyrics should project the active line from the shared `playback.elapsedSeconds` clock between backend snapshot refreshes, then re-anchor on the next playback update. If the backend has ready lyrics but no usable active line, the wall should stay visible and browse static lyrics locally without an active-line highlight. AirPlay should prefer trusted MPRIS `Position`, but when Shairport reports `Position=0`, a pause-aware `positionConfidence:"estimated"` clock may drive provider-synced timestamps only. Plain lyrics without provider timestamps stay static for every source; Tikpal must not manufacture line timing from track duration or visually imply that a rotating line is synchronized. Wildly overrun inferred positions must still be discarded instead of wrapped back into the duration, because wrapped time can highlight the wrong lyric line while the title / artist are correct. Both paths must derive from the same `lyrics` object so Ambient, Player, and portable remote state do not invent separate track truth.
- AirPlay playback must refresh title, artist, album, cover art, elapsed time, and lyrics from the same backend metadata snapshot, but only after the AirPlay source is truly `connected`; `armed` means waiting and must not drive the lyrics wall. When the AirPlay track changes, all surfaces should prefer a temporary no-cover, recognizing, or `not_found` state over showing stale cover art, old lyrics, or same-title lyrics from a different artist with the new title.
- Ambient must not show queue or playlist content; queue preview stays in the Player overlay.
- The kiosk UI does not expose playlist editing, playlist reordering, or a ritual-builder overlay. Library track selection stays in Player's Library source panel and uses `target=mpd` with `localTrackPath`.
- Choosing any non-scene source from Ambient immediately switches through `/api/v1/audio/source`, keeps the current scene video visible in Focus/Calm/Sleep, clears persisted `sceneSoundEnabled` so browser scene audio stays muted, and displays only a compact source pill after the picker closes.
- Scene previous/next in Focus/Calm/Sleep persists through `/api/v1/experience/actions { type:"set_scene" }`; if Scene Sound is active, the audible `scene` source follows the newly selected video.
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
- While a Radio source switch, next, or previous action is pending, Player and Hi-Fi should accept the backend's primed active-station state as display truth for station label and artwork. The station cover may change before MPD has fully verified playback; if the stream later fails and the backend auto-advances, the cover and label must move again with the recovered station.
- Player volume uses a 0-100 range slider instead of step buttons. Dragging the slider should update UI immediately, then send the final resting value through `volume_set` as the single global volume action.
- The displayed volume percent should match `system.volume.percent`, including while Scene Sound is active.
- Focus, Calm, Sleep, and Hi-Fi mode changes must preserve the current global volume. Sleep-specific fade-out or automatic low-volume behavior is a future feature, not part of the current mode switch contract.
- Player, Ambient Hi-Fi, and portable remote summaries must keep now-playing title, artist, album, artwork, source label, progress, favorite state, and queue position aligned with backend playback truth. Browsing a source or arming an external intake must not overwrite the displayed track until the backend confirms playback/source truth. Radio is the exception for station-level presentation only: a backend-primed station switch can update the Radio label and logo early, while final playback state still waits for MPD verification.
- Bluetooth and AirPlay metadata-backed lyrics use `sourceScope: "bluetooth_input"` / `"airplay_input"` and the shared playback clock, so portable remote refreshes and the kiosk Hi-Fi wall stay anchored to the same track. AirPlay may use `positionConfidence:"estimated"` when true MPRIS position is unavailable; paused/stopped states must freeze or clear that clock rather than advancing through silence. Ready external-input lyrics must have the same title/artist identity as playback; if LRCLIB only has a same-title different-artist result, the UI should keep the centered now-playing state.

### Console

- Cards are summary-first.
- The visible surface is Console, while the internal app mode remains `quickSettings` for compatibility.
- Console has no Home or Overview category and opens directly to Preferences.
- The only chips are Preferences, Library, Link, and Care, rendered as a listening console rather than a left sidebar.
- The header shows current source/playback truth and a top-right `Focus / Calm / Sleep / Hi-Fi / Explore` shortcut group. Selecting the current room mode returns to Ambient without another API write; selecting another mode applies it before returning, while Explore reuses the existing provider flow.
- Library/NAS controls stay status-first on the kiosk; complex SMB/NFS setup and credentials belong to remote/admin flows.
- Swipe up returns to ambient even when the gesture starts inside the protected Console panel.
- Button-sized taps inside the protected Console panel must remain local Console actions, not blank-tap returns.
- Dangerous actions require a confirmation state inside the card or a modal.
- Reboot, shutdown, database rebuild, audio output switch, network reset, and reset defaults are dangerous.

### Quick Menu

- Quick menu is a fallback, not a second navigation system.
- It should never expose deep Console drawers directly.
- It should close cleanly on cancel or after choosing an item.
- Quick Menu may expose shallow scene toggles: Scene Video, Clock, and Scene Sound.
- Turning Scene Sound on forces Scene Video on, switches playback source truth to `scene`, and unmutes only the active Ambient video layer.
- Turning Scene Sound off restores the remembered visible source: the last Library song, the last successful Radio station, or an external waiting source. If that restore fails, playback falls back to Library/MPD instead of staying stopped on `scene`.
- Turning Scene Video off while Scene Sound is active also stops Scene Sound, follows the same remembered-source resume path, and returns the video surface to a black quiet state.
- Hi-Fi mode disables Scene Video and Scene Sound controls and does not mount MP4 scenes.
- Auto Night uses the selected timezone to lower display brightness only. It must not switch modes, start Scene Sound, or interrupt Hi-Fi playback.

### Explore

- Explore is the only deliberate multi-window exception: the official web player opens on the left 1920 x 720 area, while Tikpal keeps a 640 x 720 side panel on the right.
- Ambient and Player expose a single Explore entry. The side panel, not the source picker, handles provider switching among Spotify, YouTube Music, Apple Music, TIDAL, Qobuz, Deezer, Amazon Music, QQ Music, and NetEase Cloud Music.
- Only one official-provider window should remain visible at a time. Sites that try to open a new playback page should be redirected into the same left pane, and any extra provider window should be closed so two pages cannot keep playing in parallel.
- The side panel's active provider highlight follows `.tikpal/web-mode-state.json`. It must not invent Spotify as a fallback when runtime state is missing; stale state is worse than no active highlight.
- Entering Explore must pause MPD, close external renderer intakes, and close audible Scene Sound before the provider opens. If Tikpal cannot release audio, Explore stays closed; Hi-Fi runtime recovery remains suspended while Explore is opening or active.
- Explore does not show Tikpal lyrics, artwork truth, fake transport controls, or a manual keyboard toggle for the third-party site. It only offers provider switching, global volume, proxy status, and one Back control in the top-right header.
- Console Link owns Explore proxy settings. Focusing its proxy URL or a provider text field shows `onboard`; blur, submit, or single-line Enter hides it.
- The left provider pane must not expose Chromium-native error pages. If a provider fails to load, show the local Tikpal Explore error page with provider name, Proxy/Direct state, and a short retry hint.
- The left provider pane should feel kiosk-like, not desktop-browser-like: disable right-click context menus, drag/select affordances, and common zoom/refresh shortcuts while preserving normal touch, scrolling, login input, and playback clicks.
- QQ Music may show trial or VIP upsell reminders while playback continues. Explore can auto-dismiss those with visible `取消`, `关闭`, or similar close buttons, but it must never auto-accept login, purchase, membership, authorization, agreement, recharge, or subscription prompts.
- QQ Music's `下载客户端体验更多内容` prompt requires login and must remain visible for user action; Explore must not auto-dismiss or click it.

## Input Compatibility

MVP is touch-first. The state model should still reserve clean mappings for:

- Remote control: directional navigation, select, back, setup.
- Rotary control: volume, selection, press to confirm.
- Browser/dev input: mouse or touchpad simulation for local development.

Current desktop validation mappings:

- Wheel / trackpad up from ambient opens `player`.
- Wheel / trackpad down from ambient opens `quickSettings` / Console.
- Wheel / trackpad up from an overlay returns to `ambient`.
- Clicks inside protected overlay panels do not count as blank-tap return.
- Drag / touch-swipe up inside protected player or Console panels returns to `ambient`.

## Non-Goals

- No multi-window navigation except Explore's deliberate official-player-plus-side-panel layout.
- No stacked player and Console overlays.
- No full moOde admin surface in the kiosk UI.
- No dangerous operation on first tap.
