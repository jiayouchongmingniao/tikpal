# Product Brief v1

## Summary

Tikpal is a moOde streamer frontstage UI for a 2560 x 720 ultra-wide touch screen. The default state is an ambient flame screen that can stay visible in a living room or listening room for a long time without feeling like a tablet app. Playback controls and system settings appear as overlays only when the user calls them with gestures or fallback entry points.

The product should feel high-end, calm, restrained, and warm. It should make the device read as a HiFi home object, not a general-purpose computer.

## Product Goals

- Create a premium HiFi streamer interface for a 32:9 screen.
- Keep the default screen visually pleasant and low information density.
- Make daily playback controls fast and direct.
- Separate playback operations from system settings to reduce mistakes.
- Surface moOde playback and system capabilities without copying the moOde Web UI.
- Design specifically for 2560 x 720 instead of stretching a normal app layout.
- Keep dangerous system actions behind clear confirmation.

## Experience Principles

| Principle | Product Meaning |
| --- | --- |
| See = ambient flame | The default mode is visual atmosphere and subtle status. |
| Listen = player control | Playback controls are available quickly but not always dominant. |
| Manage = quick settings | System operations are separate, lower-frequency, and card-based. |

Tikpal should use a clear hierarchy:

| Level | Mode | Description |
| --- | --- | --- |
| Level 0 | `ambient` | Flame ambience screen with time, playback status, weak progress, and fallback settings entry. |
| Level 1 | `player` | Playback control overlay with cover art, metadata, progress, transport, volume, and audio status. |
| Level 2 | `quickSettings` | System quick settings overlay with Network, Preferences, and System categories. |
| Level 3 | Advanced management | Advanced Web/admin surfaces outside the main touch UI. |

## Target Device

- Device class: Raspberry Pi 4 streamer with moOde Audio.
- Screen: 2560 x 720, approximately 32:9.
- Orientation: landscape.
- Usage: desktop, living room, listening room, or audio rack.
- Input: touch first, with future compatibility for remote control, rotary control, and Web management.
- Runtime: Chromium kiosk full screen.

## Product Surfaces

### Ambient Flame Screen

The ambient flame screen is the default and most important product surface.

Required content:

- Dynamic flame ambience: current implementation uses a fireplace image plus local MP4 video layers; future generated renderers can remain optional.
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

### Player Control Overlay

The player overlay is the highest-frequency control surface. It is opened by one-finger swipe down from the ambient screen.

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

### Quick Settings Overlay

The quick settings overlay is opened by two-finger swipe down. It should be a compact system settings surface, not a full configuration center.

Settings has no Home or Overview category. It opens directly to Preferences, then lets the user switch between three fixed categories:

- Network: network state and System/API status.
- Preferences: audio output, DSP / CamillaDSP, display, font, skin, and lyrics.
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
- Two-finger swipe down to quick settings overlay.
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
