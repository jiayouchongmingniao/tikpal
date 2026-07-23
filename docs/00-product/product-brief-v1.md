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
| Library Browsing | Local/NAS music selection stays direct and playback-oriented, without a separate playlist-editing surface in the kiosk UI. |
| Console | Low-frequency device care stays separate from daily playback, but the surface still feels like a Hi-Fi control panel rather than a backend admin page. |

Tikpal should use a clear hierarchy:

| Level | Mode | Description |
| --- | --- | --- |
| Level 0 | `ambient` / Room Canvas | Scene ambience screen with room mode, time, playback status, weak progress, and fallback settings entry. |
| Level 1 | `player` / Hi-Fi Console | Playback control overlay with cover art, metadata, progress, transport, volume, source, and audio status. |
| Level 2 | `quickSettings` / Console | Listening-first device console with Preferences, Library, Link, and Care sections. |
| Level 3 | Advanced management | Advanced Web/admin surfaces outside the main touch UI. |

## Room Experience Model

Tikpal owns a small experience state alongside playback state:

```ts
type RoomMode = "focus" | "calm" | "sleep" | "hifi";
type RoomSessionPhase = "idle" | "preparing" | "active" | "windDown";
```

Focus, Calm, and Sleep bind a scene video, optional scene sound, preferred music/source intent, brightness level, and timer. Each mode has a default scene, but user scene choices are remembered per mode so returning to Calm does not reset a previously chosen fireplace scene back to the rain preset. Hi-Fi binds a real EQ preset (`flat`, `warm`, or `vocal`) instead of a scene video and never turns on Scene Sound; the derived `hifiVisualPresetId` remains a compatibility field, not a separate scene source. The same state also owns the user-selected timezone and Auto Night window so the room can dim itself without interrupting the current source. This state is exposed by `/api/v1/experience/state` and changed through `/api/v1/experience/actions`. Room-mode changes may apply brightness, scene-source, and configured Pi EQ command-hook changes through existing source/system actions, but they must not actively change output volume. Playback truth remains owned by the playback state model.

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

For Focus, Calm, and Sleep, the temporary center strip is a room control, not a music transport. A tap opens a centered, lightweight source picker with `Library`, `Radio`, `Spotify`, `AirPlay`, `Bluetooth`, and `DLNA`, plus scene previous/next, Scene Sound, and the mode copy (`Focus / Deep work & reading`, `Calm / Unwind & relax`, or `Sleep / Dim, timer, fade-out`). Its width follows the content so the strip does not read like a full playback bar. Lyrics, favorite, play/pause, and track controls stay out of these modes on the Room Canvas and remain part of Hi-Fi playback. Radio station changes should make the station identity and cover art feel immediate even when MPD needs longer to confirm the stream.

Scene video and music source are independent unless Scene Sound is explicitly enabled. Focus, Calm, and Sleep default to scene video only: selecting a music/input source keeps the selected scene visible but mutes scene audio; turning Scene Sound on makes the scene MP4 the exclusive `scene` source and closes other intakes. Scene previous/next is a persistent room choice through `set_scene`, not just a local visual shuffle, and Hi-Fi does not clear the saved scene for the other modes.

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

Playlist management is not part of the kiosk Hi-Fi Console. The Console should keep source switching, transport, lyrics, and Library single-track selection fast instead of exposing queue or playlist editing.

### Library Browsing

The kiosk UI does not ship a playlist-editing or ritual-builder surface. Library browsing remains available in Player for selecting a specific local/NAS track to play, while playlist CRUD stays a backend compatibility capability for local tools or future non-kiosk management.

The local music taxonomy remains manifest-backed: `Focus`, `Meditation`, and `Rest` are library categories, while `Focus`, `Calm`, `Sleep`, and `Hi-Fi` are experience modes.

### Console Overlay

The Console overlay is a compact device surface, not a full configuration center and not a daily home view. The internal route and app mode remain `quickSettings` for compatibility, but the visible product language is Console.

Console has no Home or Overview category. It opens directly to Preferences, shows a listening status header with current source/playback truth, then lets the user switch between four fixed chips:

- Preferences: audio output, DSP / CamillaDSP, display, Time & Night, font, skin, and lyrics.
- Library: local library health, NAS source status, USB readiness, and library scan.
- Link: network state, System/API status, and Explore proxy/keyboard setup.
- Care: reboot and shutdown.

The Console surface is a refined listening panel, not a full NAS administration console. Kiosk NAS controls show current source health and can point users toward Library Scan, but complex SMB/NFS setup, credentials, mount editing, and scan logs belong to authenticated remote/admin flows.

Explore is a convenience wrapper for official web players, not a Tikpal audio source. It opens providers such as Suno, Spotify, YouTube Music, Apple Music, TIDAL, Qobuz, Deezer, Amazon Music, QQ Music, and NetEase Cloud Music in a left browser window while a 640 x 720 Tikpal panel stays on the right for provider switching, global volume, and proxy status; an unspecified open starts QQ Music. Provider cards move from `Ready` to a rotating `Opening` state immediately after touch, then become stable `Active` only after the left window is ready. Entering Explore pauses local Tikpal playback, closes external renderer intakes and Scene Sound, and does not update `audio.rememberedSource`. Web access uses the configured HTTP proxy when enabled; the persisted Console setting remains runtime truth, and switch/URL edits save automatically.

Dangerous actions must require confirmation.

### Quick Menu

Long press on the ambient screen opens a quick menu with discoverable fallback controls:

- Screen.
- Volume.
- Time.
- Sleep.

The quick menu lowers the learning cost for hidden gestures without becoming a second settings tree.

## MVP Scope

The first runnable implementation must include:

- Ambient flame screen.
- Current time.
- Weak current playback information.
- One-finger swipe down to player overlay.
- Two-finger swipe down to Console.
- Console reachable through the weak gear and quick menu fallback.
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
