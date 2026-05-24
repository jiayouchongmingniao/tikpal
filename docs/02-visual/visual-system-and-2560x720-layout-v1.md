# Visual System and 2560 x 720 Layout v1

## Summary

Tikpal is designed for a 2560 x 720 ultra-wide screen. The layout should use horizontal space confidently and keep vertical complexity low. The product should read as deep, warm, quiet, and HiFi-oriented.

Reference board: [ui-reference-board.png](../assets/references/ui-reference-board.png)

## Visual Keywords

- Dark.
- Premium.
- Quiet.
- Restrained.
- Warm.
- HiFi.
- Ambient.
- Touch-first.

## Color Tokens

| Token | Value | Use |
| --- | --- | --- |
| Background black | `#080A0F` | App and pre-CSS browser background. |
| Deep gray | `#101217` | Panels and dark structure. |
| Card background | `rgba(255,255,255,0.06)` | Glass-like cards. |
| Divider | `rgba(255,255,255,0.10)` | Hairlines and card borders. |
| Primary text | `#FFFFFF` | Main readable text. |
| Secondary text | `#A8ADB7` | Descriptions and status metadata. |
| Weak text | `#6F7580` | Low-emphasis ambient labels. |
| Gold accent | `#D4AF37` | Active controls, progress, selected state. |
| Cyan status | `#22D3EE` | Connected / network / active DSP status. |
| Warning | `#F59E0B` | Warning state. |
| Error | `#EF4444` | Dangerous and error state. |

## Surface Skins

The current UI supports three persisted surface skins:

| Skin | Use |
| --- | --- |
| `warm-gold` | Default amber glass and warm HiFi highlights. |
| `graphite-silver` | Cooler graphite controls with silver highlight contrast. |
| `ivory-studio` | Softer light studio shell while retaining kiosk contrast. |

Skin changes must affect the shell, cards, buttons, source highlight states, progress, and settings detail panels as one coordinated surface. Source tabs need distinct idle, selected, active, and selected-active states in every skin.

## Typography

Preferred Chinese fonts:

- Source Han Sans.
- HarmonyOS Sans.
- MiSans.
- PingFang SC.

Preferred English fonts:

- Inter.
- SF Pro.
- Helvetica Neue.

Recommended sizes:

| Element | Size |
| --- | --- |
| Ambient time | 36-52px |
| Ambient status text | 24-32px |
| Track title | 64-88px |
| Artist | 36-48px |
| Album metadata | 26-32px |
| Status label | 18-22px |
| Status value | 32-44px |
| Quick settings title | 32-40px |
| List row text | 24-30px |

## Layout Rules

- Canvas size: 2560 x 720.
- Safe margin: 48px.
- Touch button minimum: 72 x 72px.
- Play / pause button: 96-112px.
- List row height: 72-88px.
- Card radius: 16-28px.
- Module gap: 32-48px.
- Avoid tall vertical lists in primary surfaces.
- Avoid dense admin UI on the kiosk screen.

## Ambient Flame Screen

Purpose: long-dwell visual state.

Layering:

1. Full-viewport fireplace image and MP4 video background.
2. Low-contrast vignette and readability layer.
3. Playback HUD.
4. Weak settings fallback entry.

Default HUD:

- Text opacity around 40-60%.
- Progress line 2-4px.
- Main status text 24-32px.
- Time 36-52px.

Tap-boost HUD:

- Increase opacity and information density for 5 seconds.
- Fade in/out over 200-300ms.
- Do not open player controls on tap.

Suggested composition:

- Flame visual occupies the full viewport.
- Playback capsule or HUD sits low-left.
- Time and date sit high-right or right-side depending on final composition.
- Progress can stretch near the bottom edge without becoming a full player.
- Temporary transport controls sit in one shallow horizontal row so the 720px height does not feel crowded.
- The row can include scene previous/next, playback mode, previous/play/next, favorite, and lyrics visibility, but not queue or playlist content.
- Playback mode should read as one segmented control with exactly one active state: sequence, repeat-one, or shuffle.
- Ambient metadata, progress, and cover art should follow active playback truth from the backend. Source browsing state must not overwrite the long-dwell now-playing display.

Scene switching:

- The incoming video should first seek to the current music elapsed time modulo its own duration.
- Paused playback should freeze on the new scene frame after the seek.
- Playing playback should resume video playback after the seek and crossfade from the previous scene.

## Player Control Overlay

Purpose: daily playback control.

Use a three-zone horizontal layout:

| Zone | Width | Role |
| --- | --- | --- |
| Cover zone | 720px | Cover art, blurred cover background, visual anchor. |
| Playback zone | 1240px | Source, title, artist, album, progress, transport. |
| Status zone | 600px | Audio, output, volume, network, DSP, system cards. |

Left cover zone:

- Region size: 720 x 720.
- Cover size: 560-640px.
- Radius: 20-32px.
- Background may use blurred cover plus dark overlay.

Center playback zone:

- Top: source / renderer state.
- Middle: track title, artist, album.
- Lower: progress and time.
- Bottom: transport controls.
- Source workspace: when opened, replace the old compact source list with a three-column workspace.
  - Left rail: `Library`, `Radio`, `Spotify`, `AirPlay`, `Bluetooth`.
  - `Audio` can remain part of the backend state model, but it is not a visible primary tab in the source browser.
  - Center pane: source-specific content, especially searchable radio catalog and large touch targets.
  - Right pane: source detail, connection policy, readiness, and active session label.
- Library browsing should keep the storage tier distinct from local taxonomy: storage uses `Local`, `NAS`, `USB`, `Favorites`, and `Recently Added`; Local then exposes the larger `Focus`, `Meditation`, and `Rest` categories with smaller subfolder chips beneath them.
- Local subfolder chips use the manifest-backed curated order: `Focus` shows `Lo-fi / Ambient`, `Classical / Piano`, `Binaural / Alpha / Theta`, and `White Noise / Brown Noise`; `Meditation` shows `Guided Meditation`, `Breathing`, `Singing Bowl`, and `Nature Sounds`; `Rest` shows `Nap`, `Sleep`, `Rain / Ocean / Forest`, and `Deep Sleep Long Tracks`.
- Local category folders should remain manifest-backed. `Meditation` should not absorb Rest folders such as Sleep, Rain, Ocean, Forest, Nap, or Deep Sleep long tracks unless the manifest itself categorizes them there.
- Radio browsing must support 200+ stations without feeling like a dense admin table.
  - Keep search and filters visible near the top of the workspace.
  - Use large row height, quick-scan metadata pills, and obvious active/pending state.
- Bluetooth and AirPlay should read like gated intake modes, not ordinary playlists.
  - Unselected: blocked for new connections.
  - Selected: armed and waiting, or connected when a device/session is present.

Right status zone:

- Use stacked status cards.
- Card examples: AUDIO, OUTPUT, VOLUME, NETWORK, SYSTEM, DSP.
- Keep card text short and scan-friendly.

Transport controls:

- Previous.
- Play / pause.
- Next.
- Queue.
- Favorite.
- Volume.

The play / pause button should be visually dominant and easy to hit.

## Quick Settings Overlay

Purpose: low-frequency system settings without a Home or Overview category.

Settings opens directly to Preferences and uses a 2560 x 720 fixed kiosk layout. The summary card grid is always four columns wide; short categories leave empty cells instead of changing to two or three columns.

| Category | Cards |
| --- | --- |
| Network | Network, System/API status. |
| Preferences | Audio output, DSP, Display, Font, Skin, Lyrics. |
| System | Library update, Reboot, Shutdown. |

Design rules:

- Show the current state first, not configuration lists.
- Keep summary cards at a fixed width and height in the four-column grid.
- Do not add vertical page scrolling to the shell or content area.
- Cards can open detail panels later.
- Dangerous actions show confirmation before execution.
- Use warning/error color only for real warnings.
- Font and skin presets live in detail panels and must fit within the 720px kiosk height without requiring vertical page scrolling.

## Empty and Error States

No playback:

- Ambient: "Not Playing" and "Choose music or connect a source".
- Player: "No Music Playing" and available source/library actions.

Network offline:

- Ambient: weak "Network Offline" status.
- Quick settings: network card highlighted.

No DAC:

- Audio status card: "No DAC Detected".
- Tap opens audio output settings when implemented.

Library scanning:

- Show progress in quick settings or player status.
- Do not block playback.

Thermal warning:

- System card: "CPU 78C - High" in warning color.
- Consider a non-blocking prompt when exceeding the configured threshold.

## Visual Non-Goals

- No ordinary app navbar as the main structure.
- No full admin table on the kiosk.
- No bright browser-white startup flash.
- No visually busy permanent HUD.
- No moOde Web UI clone.
