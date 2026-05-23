# moOde Capability Mapping v1

## Summary

moOde / MPD owns playback and system capabilities. Tikpal owns a focused frontstage UI that displays and controls the subset appropriate for a 2560 x 720 touch device.

Tikpal should not copy the complete moOde Web UI. It should map high-frequency audio and system capabilities into ambient HUD, player overlay, quick settings, and future detail panels.

## Public State Draft

```ts
type PlaybackState = "playing" | "paused" | "stopped";

type SourceState =
  | "audio"
  | "mpd"
  | "airplay"
  | "spotify"
  | "bluetooth"
  | "roonbridge"
  | "upnp"
  | "radio";

interface PlaybackSummary {
  state: PlaybackState;
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtUrl: string | null;
  elapsedSeconds: number | null;
  durationSeconds: number | null;
  volume: VolumeState;
  source: SourceState;
}

interface SystemState {
  network: NetworkState;
  display: {
    brightnessPercent: number;
    controllable: boolean;
    transport: "ddcci" | "mock" | "unavailable";
  };
  outputDevice: OutputDeviceState;
  volume: VolumeState;
  audioFormat: AudioFormatState;
  sampleRate: number | null;
  bitDepth: number | null;
  cpuTemp: number | null;
  dspState: DspState;
}
```

Exact wire shapes should be finalized during implementation, but these concepts should remain stable.

## Capability Matrix

| moOde / MPD Capability | Tikpal Surface | UI Treatment |
| --- | --- | --- |
| Current title / artist / album | Ambient HUD, player center | Weak ambient text; dominant player metadata. |
| Album cover | Player left zone | Large cover art with dark/blurred support background. |
| Playback state | Ambient HUD, player controls | Playing / paused / stopped status and play button state. |
| Progress | Ambient weak progress, player full progress | 1Hz update is enough. |
| Volume | Ambient status, player status card, volume panel | dB or percent according to backend truth. |
| Audio format | Player status card | Format, bit depth, sample rate. |
| Output device | Player status card, quick settings | USB, I2S, HDMI, DAC name, volume mode. |
| Playback source / renderer | Player top state, source workspace | Five visible frontstage tabs: Library, Radio, Spotify, AirPlay, Bluetooth; internal Audio remains backend/status truth. |
| Network | Player status, quick settings | Ethernet/Wi-Fi, IP, connection state. |
| Display brightness | Ambient edge gesture, quick settings display card | DDC/CI brightness percent when the monitor exposes VCP `0x10`. |
| DSP / CamillaDSP | Player status, quick settings | ON/OFF, preset. |
| Library scan | Quick settings | Update/rescan status and progress. |
| System info | Quick settings | Version, uptime, CPU temperature, storage. |
| Power actions | Quick settings | Reboot and shutdown with confirmation. |

## Frontend Surface Rules

### Ambient HUD

Allowed:

- Current track.
- Artist.
- Playback state.
- Mutually exclusive playback mode: `sequence`, `repeat_one`, or `shuffle`.
- Volume.
- Audio spec.
- Output device.
- Weak progress.
- Time.
- Ambient scene previous / next controls.
- Lyrics visibility toggle.
- Favorite toggle.

Avoid:

- Full queue.
- Playlist browser.
- Settings controls.
- Dense source list.
- Admin diagnostics.

Ambient background videos:

- `GET /api/v1/media/background-videos` lists MP4 files under `public/assets`.
- The frontend treats scene video as a looped ambience layer, not as a music video.
- On scene switch, the incoming video should seek to `playback.elapsedSeconds % video.duration` before it is revealed.
- Paused playback keeps the incoming layer paused on that aligned frame; playing playback calls `play()` after alignment.
- The local web server must support `Range` requests for MP4 files so browser seeks can land on the requested frame instead of falling back to the first frame.

### Player Overlay

Allowed:

- Full current playback.
- Transport actions.
- Progress seek when supported.
- Volume adjustment.
- Live ambient edge controls for volume and brightness when the target hardware supports them.
- Queue entry.
- Source status entry.
- Audio/output/network/DSP cards.

Avoid:

- Full system admin.
- Complex MPD configuration.
- Full CamillaDSP editing.

### Quick Settings

Allowed:

- Network overview and entry.
- Audio output overview.
- DSP overview.
- Library update.
- Display controls.
- Font and surface skin presets.
- System info.
- Reboot/shutdown with confirmation.

Avoid:

- SSH/permissions maintenance.
- Full logs.
- Plugin/service admin.
- Low-level ALSA or MPD parameters.

## Source Semantics

Not every renderer/source can be controlled the same way. Some sources are active local choices; others are passive receivers.

Use language like:

- Source Status.
- Current Source.
- Renderer Ready.
- Connected.

Avoid claiming every source can be actively switched or forced to play from Tikpal.

Example statuses:

| Status | Meaning |
| --- | --- |
| MPD - NAS - Music Library | Local library playback. |
| AirPlay - iPhone | Passive AirPlay session. |
| Bluetooth - Connected | Bluetooth source connected. |
| RoonBridge - Ready | Renderer ready or active. |

## Local Backend Boundary

Future local backend responsibilities:

- Read MPD playback state.
- Send play, pause, next, previous, seek, and volume commands.
- Read moOde/system status for output, network, DSP, library, and thermal cards.
- Normalize source and renderer state into Tikpal terms.
- Provide library update actions.
- Provide reboot/shutdown through explicit safe commands.
- Provide runtime/kiosk diagnostics.

Browser responsibilities:

- Render surfaces.
- Track gesture state.
- Send local API commands.
- Display optimistic states only when backed by API confirmation or short pending-state logic.

Current Batch 3 mock API contract:

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/v1/health` | `GET` | Local API health and mode. |
| `/api/v1/system/state` | `GET` | Combined playback, system, and runtime state for the UI. |
| `/api/v1/audio/sources` | `GET` | Compact source list plus current source summary for `mpd`, `audio`, `radio`, `spotify`, `bluetooth`, and `airplay`, including armed / connected state and any advertised receiver name that the frontend should surface during handoff or pairing. The Player source browser renders `mpd`, `radio`, `spotify`, `airplay`, and `bluetooth` as the five visible primary tabs; `audio` remains internal/status state. |
| `/api/v1/audio/radios` | `GET` | Searchable radio catalog with query filters for text, genre, bitrate, and paging window, sized for moOde catalogs with 200+ presets. |
| `/api/v1/audio/library` | `GET` | Manifest-backed local music library plus NAS queue preview with storage, category, subcategory, limit, and offset filters. Storage values are `local`, `nas`, `usb`, `favorites`, and `recently_added`; `local` tracks keep `focus`, `meditation`, and `rest` category ids plus manifest subfolders. |
| `/api/v1/audio/source` | `POST` | Switches source intake. `target=mpd` can include `localTrackPath` from the local library manifest to clear/queue/play that local track and immediately update playback metadata. |
| `/api/v1/media/background-videos` | `GET` | Lists MP4 fireplace/background videos found under `public/assets` so Ambient can switch the active background without a rebuild. |
| `/api/v1/playback/status` | `GET` | Playback summary only. |
| `/api/v1/system/status` | `GET` | System summary only. |
| `/api/v1/system/runtime` | `GET` | Kiosk/runtime summary. |
| `/api/v1/playback/actions` | `POST` | Playback actions: `play_pause`, `play`, `pause`, `next`, `previous`, `seek`, `favorite_toggle`, `play_mode_set` with `mode=sequence\|repeat_one\|shuffle`, and `volume_set`. |
| `/api/v1/system/actions` | `POST` | System actions including `library_scan`, `reboot`, `shutdown`, and `brightness_set`. |

The mock API preserves the frontend contract while the real moOde / MPD adapter is still pending, and the `mpc` runtime now uses the same API shape for a first-pass source workspace. Local library browsing is backed by `public/assets/music/_metadata/library_manifest.csv`, which can be replaced by a resource OTA package together with the referenced audio files. The frontend renders Library as a storage tier first, then a Local category tier, then subfolder chips; those tiers should stay visually distinct because they mean different things in the backend contract. Category ids should come from the manifest category column rather than heuristic reclassification, so Rest folders do not leak into Meditation unless the manifest says so. Radio is modeled as a searchable station catalog with `radioStationId` direct switching and a default stream URI only as fallback. Bluetooth and AirPlay are modeled as armed-only intake paths: Tikpal only opens them for new connections while the user has explicitly selected that source, and switching away closes the intake again. The same local system surface now also carries display brightness state so the ambient right-edge gesture can talk to DDC/CI through the Node service instead of the browser pretending to own the monitor.

Both Ambient and Player use the playback summary as display truth for now-playing title, artist, album, artwork, progress, source label, and queue position. Source-panel selection and Library browsing can change the user's workspace, but they should not replace the displayed current track unless a backend source switch or playback update confirms it.

## Errors and Fallbacks

| Condition | UI Behavior |
| --- | --- |
| No music playing | Keep ambient flame; show "Not Playing" weakly. |
| MPD unavailable | Show player empty state and backend unavailable status. |
| No DAC detected | Show output card warning and route to output settings. |
| Network offline | Show weak ambient warning and highlighted network card. |
| Library scanning | Show progress but do not block playback. |
| System overheated | Show warning state and non-blocking prompt. |
| DDC/CI brightness unavailable | Keep the right ambient control lane non-destructive and show unavailable feedback instead of silently acting like a generic ambient swipe. |

## Non-Goals

- Tikpal will not expose every moOde setting on the kiosk.
- Tikpal will not duplicate advanced Web management.
- Tikpal will not treat passive renderer services as always switchable local sources.
- Tikpal will not put maintenance logs or SSH controls in the ambient/player surfaces.
