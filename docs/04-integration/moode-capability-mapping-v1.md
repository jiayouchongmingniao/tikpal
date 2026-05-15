# moOde Capability Mapping v1

## Summary

moOde / MPD owns playback and system capabilities. Tikpal owns a focused frontstage UI that displays and controls the subset appropriate for a 2560 x 720 touch device.

Tikpal should not copy the complete moOde Web UI. It should map high-frequency audio and system capabilities into ambient HUD, player overlay, quick settings, and future detail panels.

## Public State Draft

```ts
type PlaybackState = "playing" | "paused" | "stopped";

type SourceState =
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
| Playback source / renderer | Player top state, source panel | MPD, AirPlay, Spotify, Bluetooth, RoonBridge, UPnP, radio. |
| Network | Player status, quick settings | Ethernet/Wi-Fi, IP, connection state. |
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
- Volume.
- Audio spec.
- Output device.
- Weak progress.
- Time.

Avoid:

- Full queue.
- Settings controls.
- Dense source list.
- Admin diagnostics.

### Player Overlay

Allowed:

- Full current playback.
- Transport actions.
- Progress seek when supported.
- Volume adjustment.
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
| Spotify Connect - Living Room | Spotify renderer active. |
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
| `/api/v1/playback/status` | `GET` | Playback summary only. |
| `/api/v1/system/status` | `GET` | System summary only. |
| `/api/v1/system/runtime` | `GET` | Kiosk/runtime summary. |
| `/api/v1/playback/actions` | `POST` | Playback actions: `play_pause`, `play`, `pause`, `next`, `previous`, `seek`, `favorite_toggle`, and `volume_set`. |

The mock API preserves the frontend contract while the real moOde / MPD adapter is still pending.

## Errors and Fallbacks

| Condition | UI Behavior |
| --- | --- |
| No music playing | Keep ambient flame; show "Not Playing" weakly. |
| MPD unavailable | Show player empty state and backend unavailable status. |
| No DAC detected | Show output card warning and route to output settings. |
| Network offline | Show weak ambient warning and highlighted network card. |
| Library scanning | Show progress but do not block playback. |
| System overheated | Show warning state and non-blocking prompt. |

## Non-Goals

- Tikpal will not expose every moOde setting on the kiosk.
- Tikpal will not duplicate advanced Web management.
- Tikpal will not treat passive renderer services as always switchable local sources.
- Tikpal will not put maintenance logs or SSH controls in the ambient/player surfaces.
