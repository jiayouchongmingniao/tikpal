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

1. WebGL flame visual background.
2. Low-contrast vignette and readability layer.
3. Playback HUD.
4. Weak settings fallback entry.

Default HUD:

- Text opacity around 40-60%.
- Progress line 2-4px.
- Main status text 24-32px.
- Time 36-52px.

Tap-boost HUD:

- Increase opacity and information density for 3 seconds.
- Fade in/out over 200-300ms.
- Do not open player controls on tap.

Suggested composition:

- Flame visual occupies the full viewport.
- Playback capsule or HUD sits low-left.
- Time and date sit high-right or right-side depending on final composition.
- Progress can stretch near the bottom edge without becoming a full player.

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
  - Center pane: source-specific content, especially searchable radio catalog and large touch targets.
  - Right pane: source detail, connection policy, readiness, and active session label.
- Library browsing should keep the storage tier distinct from local taxonomy: storage uses `Local`, `NAS`, `USB`, `Favorites`, and `Recently Added`; Local then exposes the larger `Focus`, `Meditation`, and `Rest` categories with smaller subfolder chips beneath them.
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

Purpose: low-frequency system overview.

Use a two-row card grid:

| Row | Cards |
| --- | --- |
| Row 1 | Network, audio output, DSP, library update. |
| Row 2 | Display, system info, reboot, shutdown. |

Design rules:

- Show the current state first, not configuration lists.
- Cards can open detail panels later.
- Dangerous actions show confirmation before execution.
- Use warning/error color only for real warnings.

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
