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

Preferred multilingual fonts:

- Inter for the default Latin UI.
- Noto Sans CJK SC / JP / KR for Chinese, Japanese, and Korean coverage.
- Source Han Sans CN for Simplified Chinese-forward surfaces.
- Noto Serif CJK for editorial lyric walls and reading surfaces.
- Noto Sans Mono CJK for mono / technical surfaces.
- WenQuanYi Zen Hei as the Linux CJK fallback.

Optional drop-in fonts:

- HarmonyOS Sans.
- MiSans.
- LXGW WenKai.

Do not add optional fonts to the default stack until they are installed, `fc-cache` has run, and `fc-match` proves the family resolves on the target kiosk.

Settings -> Font is a product-level visual choice, not just a browser CSS toggle. Generated artwork and Gentoo Onboard keycap labels should use the selected preset family as well, with smaller keycap sizes than the main UI so translated labels do not crowd the compact keyboard.

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
| Console title | 34-48px |
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

## Explore Wrapper

Explore is the only approved third-party web-player wrapper for the 2560 x 720 kiosk. It should not open official music sites full-width because most web players are designed for ordinary laptop aspect ratios and become cramped on a 720px-tall 32:9 screen.

Use a split-window composition:

- Left provider browser: 1920 x 720 at `0,0`.
- Right Tikpal side panel: 640 x 720 at `1920,0`.
- The side panel uses Tikpal-native controls only: provider grid, global volume, Keyboard, proxy state, and Back/Close.
- Provider navigation remains inside the left pane. New official-player windows should be pulled back to 1920 x 720 or closed in favor of the latest provider window, so the right panel remains stable and the user never sees two web players competing.
- The active provider tile is a runtime indicator, not a default decoration: no provider should be highlighted until Explore state says it is active.
- Provider icons should use generic local glyphs plus brand-color accents, not downloaded official logos.
- Explore must not show Tikpal lyrics, fake transport controls, or third-party artwork truth.

## Ambient Flame Screen

Purpose: long-dwell visual state.

Layering:

1. Full-viewport fireplace image and MP4 video background.
2. Low-contrast vignette and readability layer.
3. Playback HUD.
4. Weak Console fallback entry.

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

Hi-Fi visual rules:

- Default Hi-Fi should stay as a centered now-playing composition with cover art, metadata, source, time, format, and volume.
- Ready lyrics with at least one displayable line may switch Hi-Fi into a left-cover / right-lyrics wall. The compact rolling ticker is reserved for Focus/Calm/Sleep and must be hidden while the Hi-Fi wall is visible; Radio, Bluetooth, and AirPlay lyrics must use this same wall instead of separate source-specific layouts.
- The lyrics wall may add a low-cost CSS mini EQ, progress line, elapsed/duration readout, and playback controls near the lower artwork area, raised above the physical bottom edge. On the 2560x720 kiosk layout this footer group sits about 100px to the right of the older left edge so it reads as a shared control strip rather than a hard lower-left element. The mini EQ stays horizontally centered under the cover art, uses deterministic per-bar timing/amplitude variation so the motion feels organic without sampling real audio, pauses with playback, and respects reduced motion; the controls must use the same transport capability gating as the rest of Hi-Fi.
- If synced lyrics cannot project an active line from playback time, the wall remains visible and uses the static rotation active index instead of disappearing.
- If lyrics are not ready, empty, or explicitly hidden, Hi-Fi returns to the centered now-playing composition and hides both lyrics surfaces.
- The centered no-lyrics composition must keep playback readable at low volume: when `playback.state === "playing"`, use a subtle non-interactive motion cue behind the cover/text in addition to the small metadata state. When playback is paused or stopped, that cue, the background wave lines, and the particles must be static.
- Real `albumArtUrl` always wins. Bluetooth may use metadata-derived remote artwork from the backend cache when BlueZ does not expose embedded cover art, and should fall back to the deterministic generated record poster only when no real or cached artwork is available. Radio uses official station logos as real artwork; during Radio source/next/previous pending states, Player and Hi-Fi should swap to the backend-primed station logo quickly instead of holding the previous station cover until MPD finishes stream verification.
- Generated fallback artwork must be a full-square SVG bitmap with an opaque root background. Rounded corners, clipping, and final radius belong to the `.cover-art` / `.hifi-cover-art` containers so Hi-Fi, Player, and lyrics-wall surfaces do not show double-rounded or transparent dirty corners.
- AirPlay cover art must arrive through the backend `albumArtUrl` truth, using the versioned `/api/v1/media/airplay-artwork` URL when available. Hi-Fi, Ambient HUD, Player, and portable remote should all show the same AirPlay artwork state for the active track.
- Hi-Fi background waves, particles, and sampled theme colors are decorative and non-interactive; they must stay below the transport and text layers and respect reduced-motion preferences.

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
  - Left rail: `Library`, `Radio`, `Spotify`, `AirPlay`, `Bluetooth`, `DLNA`.
  - `Audio` can remain part of the backend state model, but it is not a visible primary tab in the source browser.
  - Center pane: source-specific content, especially curated Radio category rows and large touch targets.
  - Right pane: source detail, connection policy, readiness, and active session label.
- Library browsing should keep the storage tier visible and flat: `Local`, `NAS`, `USB`, `Favorites`, and `Recently Added` are storage/filter tabs, and each tab renders track rows directly instead of adding a second category/subfolder chip layer.
- Local and USB rows should include compact audio/file details when the backend exposes them. USB rows use a `Copy to Local` action; Local rows use `Delete`, but destructive deletion must first swap the action into explicit `Yes` / `No` confirmation buttons.
- Long Library lists should reserve a fixed right-side fast-scroll rail, with a count and draggable thumb. Dragging the rail only scrolls; it must not preselect a track, auto-play on release, or cover Favorite / Copy / Delete controls.
- Radio browsing is a curated listening surface, not a dense station directory.
  - Do not show search, genre filters, bitrate filters, or other second-layer controls in Player Radio.
  - Use one Radio category layer: `Focus`, `Calm`, `Sleep`, `Jazz`, `Classical`, `News`, `Hi-Fi`, `Blues`, `Rock`, `World`, `Electronic`, `Podcast`, and final `Random`. Do not expose a Tikpal/moOde scope switch in Player.
  - Use official station logo thumbnails when the backend exposes `logoUrl`; generated covers are only a fallback when the logo file is unavailable.
  - Use large row height, broadcaster copy, quick-scan metadata pills, and obvious active/pending state.
- Bluetooth, AirPlay, and DLNA should read like gated intake modes, not ordinary playlists.
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

## Console Overlay

Purpose: low-frequency signal, library, link, and device-care controls without a Home or Overview category.

Console opens directly to Preferences and uses a 2560 x 720 fixed kiosk layout. The internal route remains `quickSettings`, but the visible surface is a listening console: a top status band shows current source/playback truth, source artwork or glyph, API health, and audio format before the user reaches device controls. It uses Preferences, Library, Link, and Care chips instead of a left sidebar, so the surface reads like a Hi-Fi device panel rather than a desktop settings app. The summary tile grid is always four columns wide; short categories leave empty cells instead of changing to two or three columns.

| Category | Cards |
| --- | --- |
| Preferences | Audio output, DSP, Display, Time & Night, Font, Skin, Lyrics. |
| Library | Local Library, NAS Sources, USB, Library Scan. |
| Link | Network, System/API status. |
| Care | Reboot, Shutdown. |

Design rules:

- Show the current state first, not configuration lists.
- Keep summary tiles at a fixed width and height in the four-column grid.
- Do not use heavy backdrop blur; Pi responsiveness is more important than glass effects.
- Touch hover/focus must not make more than one section chip look active.
- Do not add vertical page scrolling to the shell or content area.
- Cards can open detail panels later.
- NAS detail panels can show status and the remote/admin boundary, but must not become credential-heavy forms on the kiosk surface.
- Dangerous actions show confirmation before execution.
- Use warning/error color only for real warnings.
- Font and skin presets live in detail panels and must fit within the 720px kiosk height without requiring vertical page scrolling.

## Empty and Error States

No playback:

- Ambient: "Not Playing" and "Choose music or connect a source".
- Player: "No Music Playing" and available source/library actions.

Network offline:

- Ambient: weak "Network Offline" status.
- Console: Link chip and network tile highlighted.

No DAC:

- Audio status card: "No DAC Detected".
- Tap opens audio output settings when implemented.

Library scanning:

- Show progress in Console or player status.
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
