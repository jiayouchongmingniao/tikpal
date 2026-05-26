# Product Brief v1

## Summary

Tikpal is an all-in-one Hi-Fi speaker with a 2560 x 720 ultra-wide ambient display. Its software should behave like a room-state operating system: sound is the primary capability, the display is the room canvas, and the core task is shifting the room into Focus, Calm, or Sleep without making the device feel like a tablet app. Playback controls and system settings appear only when the user calls them with gestures or fallback entry points.

The product should feel high-end, calm, restrained, and warm. It should make the device read as a HiFi home object, not a general-purpose computer.

## Product Goals

- Create a premium HiFi speaker experience for a 32:9 ambient display.
- Keep the default screen visually pleasant, low information density, and centered on room state.
- Make Focus, Calm, and Sleep the primary experience modes.
- Make daily playback controls fast and direct.
- Separate playback operations from system settings to reduce mistakes.
- Surface moOde playback and system capabilities without copying the moOde Web UI.
- Design specifically for 2560 x 720 instead of stretching a normal app layout.
- Keep dangerous system actions behind clear confirmation.

## Experience Principles

| Principle | Product Meaning |
| --- | --- |
| Room Canvas | The default surface transforms the room with scene video, subtle status, and short-lived controls. |
| Hi-Fi Console | Playback controls stay fast and precise, but they are temporary overlays rather than the product center. |
| Scene Library / Ritual Builder | Playlists and curated content are organized around Focus, Calm, and Sleep rituals. |
| Device Settings | System operations are separate, lower-frequency, fixed-grid, and never the daily home surface. |

Tikpal should use a clear hierarchy:

| Level | Mode | Description |
| --- | --- | --- |
| Level 0 | `ambient` / Room Canvas | Scene ambience screen with room mode, time, playback status, weak progress, and fallback settings entry. |
| Level 1 | `player` / Hi-Fi Console | Playback control overlay with cover art, metadata, progress, transport, volume, source, and audio status. |
| Level 1 | `playlist` / Scene Library | Playlist and ritual management organized around Focus, Calm, and Sleep. |
| Level 2 | `quickSettings` / Device Settings | System quick settings overlay with Network, Preferences, and System categories. |
| Level 3 | Advanced management | Advanced Web/admin surfaces outside the main touch UI. |

## Room Experience Model

Tikpal owns a small experience state alongside playback state:

```ts
type RoomMode = "focus" | "calm" | "sleep" | "hifi";
type RoomSessionPhase = "idle" | "preparing" | "active" | "windDown";
```

Focus, Calm, and Sleep bind a scene video, optional scene sound, preferred playlist, volume level, brightness level, and timer. Hi-Fi binds a real EQ preset (`flat`, `warm`, or `vocal`) instead of a scene video and never turns on Scene Sound; its visual style is derived from that EQ preset for compatibility. The same state also owns the user-selected timezone and Auto Night window so the room can dim itself without interrupting the current source. This state is exposed by `/api/v1/experience/state` and changed through `/api/v1/experience/actions`. The API may apply volume, brightness, scene-source, and configured Pi EQ command-hook changes through existing playback/source/system actions, but playback truth remains owned by the playback state model.

This model is wellness-oriented but non-medical. Tikpal should not claim to diagnose sleep, mood, stress, or health. Personalization can later come from portable voice capture, user mood, inspiration notes, and conversation memory, not from imaginary biometric sensors.

## Target Device

- Device class: Raspberry Pi 4 streamer with moOde Audio.
- Screen: 2560 x 720, approximately 32:9.
- Orientation: landscape.
- Usage: desktop, living room, listening room, or audio rack.
- Input: touch first, with future compatibility for remote control, rotary control, and Web management.
- Runtime: Chromium kiosk full screen.

## Product Surfaces

### Room Canvas

The Room Canvas is the default and most important product surface.

Required content:

- Dynamic flame ambience: current implementation uses a fireplace image plus local MP4 video layers; future generated renderers can remain optional.
- Current room mode: Focus, Calm, or Sleep.
- Current time.
- Playback / pause / stopped status.
- Volume.

Recommended content:

- Track title and artist.
- Audio specification.
- Output device.
- Weak playback progress.

Optional content:

- Network status.
- Current source.

The HUD should be subtle by default and become stronger for a short time after a tap.

For Focus, Calm, and Sleep, the temporary center strip is a room control, not a music transport. It shows only scene previous/next, Scene Sound, and the mode copy (`Focus / Deep work & reading`, `Calm / Unwind & relax`, or `Sleep / Dim, timer, fade-out`). Its width follows the content so the strip does not read like a full playback bar. Lyrics, favorite, play/pause, and track controls stay out of these modes on the Room Canvas and remain part of Hi-Fi playback.

### Hi-Fi Console

The Hi-Fi Console is the highest-frequency control surface. It is opened by one-finger swipe down from the Room Canvas.

Required capabilities:

- Current track, artist, album, and cover art.
- Play / pause / previous / next.
- Progress and playback time.
- Volume display and adjustment.
- Playback queue entry.
- Source status.
- Audio format, bit depth, sample rate.
- Output device.
- Favorite / like action when supported.

Playlist management stays outside the Hi-Fi Console. The Console may keep a compact playlist entry, but it should not absorb queue and playlist editing into the main source rail.

### Scene Library / Ritual Builder

The Playlist surface is the ritual management surface for room modes. It should recommend curated Focus, Calm, Sleep, and Hi-Fi content, preserve user playlists, and keep large touch targets for creating, duplicating, editing, and playing lists. Hi-Fi EQ presets are selectable here as audio presets, not as playable scene sources.

The local music taxonomy remains manifest-backed: `Focus`, `Meditation`, and `Rest` are library categories, while `Focus`, `Calm`, `Sleep`, and `Hi-Fi` are experience modes.

### Quick Settings Overlay

The quick settings overlay is a compact Device Settings surface, not a full configuration center and not a daily home view.

Settings has no Home or Overview category. It opens directly to Preferences, then lets the user switch between three fixed categories:

- Network: network state and System/API status.
- Preferences: audio output, DSP / CamillaDSP, display, Time & Night, font, skin, and lyrics.
- System: library update, reboot, and shutdown.

Dangerous actions must require confirmation.

### Quick Menu

Long press on the ambient screen opens a quick menu with discoverable fallback controls:

- Player controls.
- System settings.
- Ambient effect switch.
- Screen off.
- Return to ambient.

The quick menu lowers the learning cost for hidden gestures.

## MVP Scope

The first runnable implementation must include:

- Ambient flame screen.
- Current time.
- Weak current playback information.
- One-finger swipe down to player overlay.
- Two-finger swipe down to Scene Library / Ritual Builder.
- Settings reachable through the weak gear and quick menu fallback.
- Play / pause / previous / next.
- Playback progress.
- Volume display and adjustment.
- Audio format, sample rate, and bit depth.
- Output device.
- Network status.
- Swipe up to return to ambient.
- Inactivity timeout back to ambient.
- Long-press quick menu.

## v2 Enhancements

- Queue management.
- Internet radio entry.
- Music library browsing.
- Source detail panel.
- DSP / CamillaDSP switch and status.
- Brightness setting.
- Flame intensity setting.
- Horizontal swipe to switch ambience mode.

## Later Advanced Capabilities

- Multiple ambience modes: flame, spectrum, clock, blurred cover, lyrics.
- Full remote control adaptation.
- Rotary control support.
- User themes.
- Multi-language UI.
- Complex EQ / CamillaDSP graphical editing.

## Product Decision

Tikpal should not become a direct replacement skin for the full moOde Web UI. moOde owns the deep playback and system capabilities. Tikpal owns the frontstage: a calm, touch-first, 2560 x 720 HiFi ambience and control experience.
