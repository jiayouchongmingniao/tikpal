# moOde Capability Mapping v1

## Summary

moOde / MPD owns playback and system capabilities. Tikpal owns a focused frontstage UI that displays and controls the subset appropriate for a 2560 x 720 touch device.

Tikpal should not copy the complete moOde Web UI. It should map high-frequency audio and system capabilities into ambient HUD, player overlay, Console, and future detail panels.

## Public State Draft

```ts
type PlaybackState = "playing" | "paused" | "stopped";

type SourceState =
  | "audio"
  | "scene"
  | "mpd"
  | "airplay"
  | "spotify"
  | "bluetooth"
  | "roonbridge"
  | "lyrion"
  | "tikpal_multiroom"
  | "music_assistant"
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
  source: SourceState;
}

type HifiEqPresetId = "flat" | "warm" | "vocal";

interface AudioSpectrumFrame {
  bands: number[];
  peaks: {
    left: number;
    right: number;
  };
  source: "mock" | "command" | "fallback";
  bandCount: 32;
  updatedAt: string;
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
| Volume | Ambient status, player source header, volume panel, portable remote | `system.volume.percent` is the global truth; Ambient edge gestures, Player and Remote range sliders, and scene video audio all sync through `volume_set`. |
| Audio format | Player status card | Format, bit depth, sample rate. |
| Output device | Player status card, Console | USB, I2S, HDMI, DAC name, volume mode. |
| Playback source / renderer | Ambient source picker, Player top state, source workspace | Six visible frontstage choices: Library, Radio, Spotify, AirPlay, Bluetooth, DLNA; internal Audio remains backend/status truth. |
| Scene ambience audio | Ambient video layer, Player current source | Scene Sound is the automatic Ambient default backed by the active background MP4; selecting any visible music/input source replaces it and remutes the browser video. Customers do not get a separate Scene Sound switch. On Pi, Chromium should use the physical USB `dmix` output, while moOde/MPD keeps `_audioout` for Library, Radio, renderer intakes, and Hi-Fi capture. |
| Network | Player status, Console Link | Ethernet/Wi-Fi, IP, connection state. |
| Display brightness | Ambient edge gesture, Console Preferences display tile | DDC/CI brightness percent when the monitor exposes VCP `0x10`. |
| DSP / CamillaDSP | Player status, Console Preferences, Hi-Fi room mode | ON/OFF, selected EQ preset id/label, controllability, and available `flat` / `warm` / `vocal` preset summaries. |
| Library scan | Console Library | Update/rescan status and progress. |
| System info | Console Link | Version, uptime, CPU temperature, storage. |
| Power actions | Console Care | Reboot and shutdown with confirmation. |

## Frontend Surface Rules

### Ambient HUD

Allowed:

- Current track.
- Artist.
- Playback state.
- Lightweight six-choice source picker for `mpd`, `radio`, `spotify`, `airplay`, `bluetooth`, and `upnp`, displayed as Library, Radio, Spotify, AirPlay, Bluetooth, and DLNA.
- Unified external handoff state for Spotify Connect, AirPlay, Bluetooth, and DLNA: `armed` means the receiver is open and waiting, while only `connected` ends the waiting UI. Ambient, Player, and the portable remote must read the same source summary instead of inventing separate local readiness. External-to-external switches return the requested target after that intake opens, while old external receivers are cleaned up in the background with target protection; Library and Radio still close external receivers synchronously before reclaiming `_audioout`. AirPlay metadata, artwork, and lyrics are display truth only after AirPlay is `connected`; switching away from AirPlay must close both the moOde renderer and the Shairport receiver, then clear any failed Shairport unit marker, so the next source does not inherit stale AirPlay state.
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
- Library browser for direct track selection.
- Console controls.
- Dense source list.
- Admin diagnostics.

Ambient background videos:

- `GET /api/v1/media/background-videos` lists legacy MP4 files under `public/assets` and OTA-managed scene MP4 files declared by `public/assets/scenes/_metadata/scene_videos.json`.
- The frontend treats scene video as a looped ambience layer, not as a music video.
- Scene entries may include `order`, `default`, and `source=scene`; the response also includes `catalogVersion` and `defaultVideoId` so Ambient can preserve the current scene while noticing newly installed OTA videos.
- `GET /api/v1/scene/context` may add IP-derived timezone, daypart, coarse location label, country code, weather label, precipitation, and optional rounded Celsius temperature for weak Ambient clock copy. This is context for wording only; Auto Night still follows the stored room-experience timezone and the endpoint must cache provider reads so a slow network lookup does not block the normal state snapshot path.
- On scene switch, the incoming video should seek to `playback.elapsedSeconds % video.duration` before it is revealed.
- Normal video playback should not expose the static logo/backdrop during scene switches; that surface is reserved for static-only mode and repeated-stall fallback.
- On Pi `mpc` stable-loop playback, repeated-stall fallback is recoverable. The frontend should retry the current scene after briefly showing the logo, and changing the room scene through `/api/v1/experience/actions` must clear fallback state so the next Focus / Calm / Sleep video can mount.
- The visual ambience layer can keep looping independently from music playback state; Scene Sound controls whether the active layer is audible.
- The local web server must support `Range` requests for MP4 files so browser seeks can land on the requested frame instead of falling back to the first frame.
- Scene Sound starts automatically at Ambient boot when no connected external input or Hi-Fi recovery takes precedence. Customer UIs do not expose a Scene Sound switch; the local `set_scene_sound` action remains for automation and compatibility. Scene previous/next writes the current mode's scene through `set_scene`, which updates per-mode scene memory and retargets audible Scene Sound when it is active. When Scene Sound is enabled, the backend marks `scene` as the active source and the browser unmutes only the active video layer.
- When Scene Sound is active, moving between Focus, Calm, and Sleep keeps it audible and retargets it to that room mode's scene. If Library, Radio, Bluetooth, AirPlay, Spotify, or DLNA is active, room-mode switches preserve it instead. Returning to Hi-Fi turns Scene Sound off and preserves the visible source; a paused, stopped, or disconnected user-selected source never automatically hands playback back to Scene Sound.
- The active video element must expose `data-scene-volume = system.volume.percent / 100` so Ambient and Player share one global level. The native `video.volume` may apply per-scene gain and is mirrored as `data-scene-effective-volume`; at `0%`, the video remains muted.
- The active video element should own unmute at runtime rather than relying on JSX `muted` attributes; repeated React renders must not accidentally re-mute a healthy Scene Sound path.
- Turning Scene Sound off should restore the remembered visible source: the last Library track, the last successful Radio station, or an external waiting source. If that restore fails, the backend falls back through `target=mpd` so playback does not remain stopped on `scene`. Turning Scene Video off while Scene Sound is active follows the same remembered-source resume path before hiding the video surface.
- Selecting any Ambient music/input source uses the existing `/api/v1/audio/source` contract, clears persisted `sceneSoundEnabled`, keeps Focus/Calm/Sleep scene video visible, and closes Scene Sound as the audible source. Focus/Calm/Sleep then show only a compact lower-left source pill for the active or waiting source instead of keeping the source picker over the video.
- Hi-Fi mode sits over the current visible source. Ordinary entry into Hi-Fi must preserve active Library, Radio, Spotify, Bluetooth, AirPlay, or DLNA rather than restoring over it. The Pi startup policy can still restore `audio.rememberedSource` when persisted room state is already `hifi`; connected external renderers win first, while Scene Sound and MPD queue priming are fallbacks. While that restore is in flight, `/api/v1/system/state` should wait for the recovered Library or Radio snapshot instead of publishing a transient stale `stopped` state. During steady-state Hi-Fi, the background MPD snapshot collector should recover remembered Library/Radio playback if MPD reports `stopped`, the wrong source, or a clearly different remembered station/track; it must not resume an explicit `paused` state, reopen external handoff targets, or reload a currently playing Radio stream just because the station id is temporarily missing. Internal `scene` and `audio` sources must not overwrite that memory; playlist playback counts as Library, Radio memory follows the final station that actually started, and external renderer memory reopens the waiting handoff state. `rememberedSource.localTrackPath` follows the last actual local Library song, and `rememberedSource.radioStationId` follows the last successful Radio station; both are preserved across other visible targets so bare returns to Library or Radio resume the user's last position.
- External renderer intake commands should be closed when leaving those sources. In particular, a running `librespot --device _audioout` process can keep the physical output busy even after `playback.source` has returned to `scene`, so the Spotify disable command is part of Scene Sound reliability.

### Player Overlay

Allowed:

- Full current playback.
- Transport actions.
- Progress seek when supported.
- Global volume adjustment through a 0-100 range slider in the source header.
- Live ambient edge controls for volume and brightness when the target hardware supports them.
- Queue entry.
- Source status entry.
- Audio/output/network/DSP cards.

Avoid:

- Full system admin.
- Complex MPD configuration.
- Full CamillaDSP editing.

### Console

Allowed:

- Console keeps the internal `quickSettings` route but presents Preferences, Library, Link, and Care chips rather than a left sidebar.
- Preferences: audio output summary, DSP summary, display controls, Time & Night, font presets, surface skin presets, and lyrics settings.
- Library: local library health, NAS source status, USB readiness, and library scan.
- Link: network summary, System/API status, and Explore proxy state; text inputs summon Onboard automatically.
- Care: reboot/shutdown with confirmation.
- The top status band shows current source/playback truth plus icon-and-text shortcuts for Focus, Calm, Sleep, Hi-Fi, and Explore. Room shortcuts reuse `set_mode`, and Explore reuses the existing open action; no Console-only backend route is added.
- NAS on the kiosk is status-first. Console can show the current library source and send users to the existing Library Scan action, but complex SMB/NFS setup, credentials, mount editing, and logs belong to authenticated remote/admin flows.
- Explore controls in Console are limited to provider/proxy support. Its text fields and provider inputs use the shared automatic Onboard behavior; the physical Explore side panel has no manual keyboard control.

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
| DLNA - Ready | UPnP/DLNA renderer ready for external casting. |
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
| `/api/v1/openapi.json` / `/api/v1/swagger.json` | `GET` | Swagger-compatible OpenAPI document for the portable remote facade. |
| `/api/v1/docs` | `GET` | Lightweight local HTML page pointing to the OpenAPI document. |
| `/api/v1/remote/state` | `GET` | Safe portable-controller state: playback, volume, room mode, scene, current source, source list, display brightness, Hi-Fi EQ, Explore active-provider/error status plus `proxyEnabled`, and runtime. It does not expose the Explore proxy URL or provider URLs. |
| `/api/v1/remote/catalog` | `GET` | Safe portable-controller catalog: allowed action ids, playback modes, source targets, source summaries, room-mode presets, scene videos, and Hi-Fi EQ presets. `sourceTargets` intentionally remains limited to `mpd`, `radio`, `spotify`, `bluetooth`, `airplay`, and `upnp`; `scene` remains an internal compatibility source rather than a Remote customer control. |
| `/api/v1/remote/actions` | `POST` | Single portable-controller write path protected by `X-Tikpal-Key`. It supports playback transport, seek, play mode, volume, source selection, room mode/session/timer, scene selection, Hi-Fi EQ, display brightness, lyrics refresh, and `explore.open` / `explore.close` / `explore.proxy_set`. The legacy scene-sound action remains API-compatible for automation but is not exposed in the Remote UI. Explore open defaults to QQ Music, close reuses the physical side panel's Close behavior, and proxy changes refresh the active provider without replacing its Chromium process/window/profile; the URL stays private. Direct remote `/api/v1/web-mode/*`, reboot, shutdown, library scan, and playlist CRUD remain blocked. |

Production web access uses fixed listeners: `4173` is the full trusted kiosk UI/API proxy, while `4174` is the portable remote UI and restricted `/api/v1/remote/*` proxy. `TIKPAL_WEB_REMOTE_PORT` configures the latter and must not equal `TIKPAL_WEB_PORT`.
| `/api/v1/system/state` | `GET` | Combined playback, system, and runtime state for the UI. |
| `/api/v1/web-mode/state` | `GET` | Explore provider catalog, active provider, last error, and proxy settings. Explore is a browser wrapper and is intentionally separate from audio source truth; the launcher also writes the same runtime state so `/side-panel` does not highlight a stale provider after direct script actions. |
| `/api/v1/web-mode/actions` | `POST` | Opens or closes Explore, controls Onboard, or applies the shared boolean `proxy` action. Automatic input focus sends `keyboard` with `enabled=true` to show Onboard and `false` to hide it; the side panel has no manual keyboard action. `open` pauses local MPD files, stops active HTTP Radio streams, closes external renderer intakes and Scene Sound, then hides Onboard, keeps the existing `/side-panel`, and stages the target provider behind a left-screen transition; failure to release Tikpal audio blocks the provider open. While `activeProvider` is set, playback `volume_set` uses output-volume truth so the side-panel slider controls provider Chromium rather than stale MPD/Radio software volume. Hi-Fi runtime recovery stays suspended while Explore is opening or active. With the MV3 extension enabled, the local bootstrap waits for the current proxy revision before navigating. `proxy` applies `direct` / `fixed_servers`, waits up to five seconds for extension confirmation, and refreshes the provider page without restarting Chromium. It does not write `audio.rememberedSource` or change `audio.currentSource`. Provider cards report `Ready`, rotating `Opening`, then stable `Active`. `close` clears `activeProvider` and returns immediately, then passes the current room mode to a background launcher cleanup so the neutral room-return veil can cover both provider and side panel while Chromium processes and playback handoff are cleaned up. It hides Onboard and does not make the side panel wait on an unresponsive provider renderer. |
| `/api/v1/web-mode/settings` | `PATCH` | Persists Explore proxy settings in `.tikpal/web-mode-settings.json`. Persisted settings are runtime truth and must be updated when the proxy host's LAN address changes; the 2026-07-19 `192.168.2.138` validation used `proxyEnabled=true` with `http://192.168.2.172:7897`. Console changes debounce-save automatically. |
| `/api/v1/web-mode/proxy-applied` | `POST` | Loopback-only MV3 extension acknowledgement for the current settings `updatedAt` revision. The acknowledgement is stored internally as `proxyAppliedSettingsUpdatedAt`; it is not exposed by the `4174` remote state and remote calls remain forbidden. |
| `/api/v1/web-mode/proxy-test` | `POST` | Validates the configured Explore proxy URL and, when explicitly enabled in runtime env, performs a light connectivity check. |
| `/api/v1/audio/sources` | `GET` | Compact source list plus current source summary for `mpd`, `scene`, `audio`, `radio`, `spotify`, `bluetooth`, `airplay`, and `upnp`, including armed / connected state, `rememberedSource`, and any advertised receiver name that the frontend should surface during handoff or pairing. The Radio source summary carries `radioStationId` when a concrete station is active so Hi-Fi restore can compare stations instead of only comparing `source.id`. The Player source browser renders `mpd`, `radio`, `spotify`, `airplay`, `bluetooth`, and `upnp` as the six visible primary tabs; `scene` and `audio` remain internal/status state. |
| `/api/v1/scene/context` | `GET` | Cached ambient context for copy: timezone, daypart, local hour, optional location/country, and optional weather condition plus `temperatureCelsius` when available. A `timeZone` query parameter is only a fallback when IP geolocation has no timezone. |
| `/api/v1/audio/spectrum` | `GET` | Returns one frame with 32 normalized bands plus normalized L/R peaks. Mock mode remains mock-backed for local UI development; `mpc` mode requires `TIKPAL_HIFI_SPECTRUM_COMMAND`, which can point at `deploy/moode/tikpal-hifi-spectrum-capture.sh` to capture the Pi's real PCM stream without changing the UI. |
| `/api/v1/audio/radios` | `GET` | Searchable radio catalog with query filters for text, category, genre, bitrate, scope, and paging window. The default catalog is a curated single-layer Radio set grouped as Focus, Calm, Sleep, Jazz, Classical, News, Hi-Fi, Blues, Rock, World, Electronic, and Podcast, with a final Random page that samples three real curated stations without changing their original category. `scope=all` remains for compatibility when a client needs the full moOde catalog. |
| `/api/v1/audio/library` | `GET` | Manifest-backed local music library plus NAS queue preview and removable USB tracks with storage, category, subcategory, limit, and offset filters. Storage values are `local`, `nas`, `usb`, `favorites`, and `recently_added`; category/subcategory remain metadata for packaging and future tooling, but the Player Library surface renders these storage/filter tabs as flat track lists. Track summaries may expose codec, sample rate, bit depth, channel count, bitrate, and file size for row-level audio details. The response `storages[].trackCount` is the shared count truth for Player Library browsing, Console / Settings Library cards, and portable summaries. Do not treat `/api/v1/system/state.library.trackCount` as a NAS count; in `mpc` mode it is MPD's whole database status and can include Local, USB, hidden AppleDouble files, or other MPD-visible roots. |
| `/api/v1/audio/playlists` | `GET` / `POST` | Backend-compatible playlist catalog and creation endpoint for local tools or future non-kiosk management. The kiosk UI no longer exposes a playlist editor or Player playlist entry. |
| `/api/v1/audio/playlist-actions` | `POST` | Backend-compatible playlist actions, including play, edit, duplicate, reorder, and delete. Playing a playlist still loads the MPD/local queue, but kiosk track selection should prefer `/api/v1/audio/library` plus `POST /api/v1/audio/source { target:"mpd", localTrackPath }`. |
| `/api/v1/experience/state` | `GET` | Returns room mode, scene video id, optional per-mode `sceneVideoByMode`, Hi-Fi EQ preset id plus derived compatibility visual preset, timer state, and Auto Night schedule with selected IANA timezone. |
| `/api/v1/experience/actions` | `POST` | Changes room modes, starts/stops timers, persists the current scene with `set_scene`, applies Hi-Fi EQ presets with `set_hifi_eq`, updates Scene Sound with legacy-compatible `set_scene_sound`, and updates Auto Night schedule. Focus/Calm/Sleep preserve active music/input sources; if Scene Sound is already active, they retarget it to the new room scene. Hi-Fi never switches to `scene` and must not clear saved scene choices for the other modes. |
| `/api/v1/audio/source` | `POST` | Switches source intake. `target=mpd` can include `localTrackPath` from the current local library manifest to clear/queue/play that local track and immediately update playback metadata. A bare `target=mpd` coming back from a non-Library source should retry the remembered `localTrackPath` first and fall back to the ordinary MPD queue if the file is gone. Stale paths from a replaced Library package are treated only as candidates and must not be written back after manifest validation fails. `target=radio` can include `radioStationId`; a bare `target=radio` should retry the remembered station first, then fall back through the normal catalog/default route. If the selected station fails and fallback advances, `rememberedSource.radioStationId` must be the recovered station. When the MPD snapshot later confirms a concrete Radio station is actually `playing`, state collection also syncs `rememberedSource.radioStationId` to that station so the UI and Hi-Fi restore do not drift from playback truth. `target=scene` can include the current background video id/label/src so Scene Sound metadata follows the active Ambient video. Switching to any non-scene target clears persisted `sceneSoundEnabled`; only visible source targets update `.tikpal/audio-source-memory.json`. Explore is intentionally not a source target; it uses `/api/v1/web-mode/*` and leaves this source state untouched. |
| `/api/v1/media/background-videos` | `GET` | Lists MP4 fireplace/background videos found under `public/assets` and scene OTA videos under `public/assets/scenes`, with optional `order`, `default`, and `catalogVersion` metadata so Ambient can switch the active background without a rebuild. |
| `/api/v1/media/radio-logo` | `GET` / `HEAD` | Serves official local radio logos by `stationId=radio-<id>`. The API resolves only known moOde station ids, first by exact station-name image file and then by a repo-owned alias map for curated Tikpal station names. It never accepts arbitrary filesystem paths. Successful responses should be cacheable for one day so repeated Radio cover switches can reuse local artwork quickly. |
| `/api/v1/playback/status` | `GET` | Playback summary only. |
| `/api/v1/lyrics/status` | `GET` | Current lyrics summary. For AirPlay and Bluetooth input scopes this must stay tied to the same title/artist/source truth as playback state. |
| `/api/v1/lyrics/refresh` | `POST` | Forces lyrics recognition/lookup for the current playback candidate. AirPlay normally uses trusted metadata first; fingerprint capture is only a fallback when configured. |
| `/api/v1/system/status` | `GET` | System summary only. |
| `/api/v1/system/runtime` | `GET` | Kiosk/runtime summary. |
| `/api/v1/playback/actions` | `POST` | Playback actions: `play_pause`, `play`, `pause`, `next`, `previous`, `seek`, `favorite_toggle`, `play_mode_set` with `mode=sequence\|repeat_one\|shuffle`, and global `volume_set`. While Radio is active, `next` and `previous` cycle adjacent curated station ids instead of sending queue commands to MPD's single stream item. For scene/external handoff sources, `volume_set` targets output volume truth rather than an MPD-only mixer. |
| `/api/v1/system/actions` | `POST` | System actions including `library_scan`, `reboot`, `shutdown`, and `brightness_set`. |

In `mpc` mode, the read endpoints above use a cached runtime snapshot instead of shelling out for every request. `/api/v1/system/state`, `/api/v1/playback/status`, `/api/v1/system/status`, `/api/v1/system/runtime`, `/api/v1/audio/sources`, `/api/v1/remote/state`, and `/api/v1/remote/catalog` should return from memory and schedule background refresh work when needed. The background collector is allowed to run slower probes such as `systemctl`, `ddcutil`, source ready/active commands, AirPlay/Bluetooth metadata helpers, network checks, and media-artwork resolution. Radio source switches are allowed to prime the cached active station immediately with station label and `albumArtUrl`; this is display truth for station identity while MPD still verifies whether the stream will remain playing.

AirPlay lyrics are identity-strict: the metadata path may return `ready` only when the configured provider chain matches the normalized title and artist for the current AirPlay playback snapshot. The default chain is `lrclib,lyricsovh`; `lyrics.ovh` is plain-lyrics fallback only and never runs title-only lookup. `TIKPAL_LYRICS_CUSTOM_URL_TEMPLATE` can add an authorized/self-hosted provider before `lyricsovh`. Duration is timing guidance, not an identity veto. If the current song has no trusted lyrics, `not_found` is correct and preferable to displaying same-title lyrics from a different artist.

`volume_set` must stay multi-surface. Local kiosk actions and portable remote actions both write through the backend, then refresh output volume status when the active source is `scene`, Spotify Connect, Bluetooth, AirPlay, or DLNA. The response should carry the freshly read `system.volume.percent` so Ambient, Player, Remote, and browser Scene Sound do not drift into separate local slider state. Room-mode changes preserve this global volume; Sleep-specific fade-out or low-volume automation is intentionally deferred. On Pi, this percent controls both the system output helper and the active scene video element; audible failure should be diagnosed as an output-route problem only after the DOM video is confirmed `muted=false`, `paused=false`, and `data-scene-volume` is nonzero. Radio is MPD-backed, so Tikpal also tracks the last nonzero MPD software volume in `.tikpal/audio-volume-state.json`; selecting Radio while MPD reports `volume: 0%` restores that last nonzero value, then the current global `system.volume.percent`, before using the radio default.

Action endpoints are different: playback, source, room, display, library scan, reboot, shutdown, playlist, and remote-action writes still run the command or persistence change needed for the requested action. After a successful external source write, Spotify Connect, AirPlay, Bluetooth, and DLNA refresh source-runtime status immediately enough for the UI to know whether the intake is already `connected`; when switching from one external intake to another, the target source becomes current before slow non-target shutdown commands finish. Otherwise the client keeps the shared waiting handoff state until a later cached refresh reports `connected` or the client times out and rolls back. During Radio source/next/previous actions, the client may poll state faster than the default interval so the newly primed station logo reaches Player and Hi-Fi before the long MPD verification path completes. A DLNA renderer that is only `armed` / `Ready` remains a source button state, not now-playing truth: if MPD is still playing a known Radio preset or local Library file, `audio.currentSource` and `playback.source` must stay on that real playback source. DLNA becomes current only from a real connected probe or MPD playback that appears after the DLNA release/open step, then its MPD metadata can feed artwork and lyrics. Radio start failures split into source and runtime recovery: stream decode/connect failures can auto-advance to the next station, repeated MPD decoder/xrun stalls while Radio is playing are treated as weak-network station failure after a short grace window, `mpc` communication timeouts may run `TIKPAL_MPD_RECOVERY_COMMAND` once before retry, and `_audioout` ALSA busy states rerun `TIKPAL_KIOSK_AUDIO_RELEASE_COMMAND` before another `mpc play` nudge. The user-facing tradeoff is intentional: status cards may lag by one snapshot interval, but a stuck monitor, renderer, or metadata probe should not make the kiosk UI appear frozen.

The mock API preserves the frontend contract while the real moOde / MPD adapter is still pending, and the `mpc` runtime now uses the same API shape for a first-pass source workspace. The portable remote facade is intentionally narrower than this internal API: it packages the stable read model into `/api/v1/remote/state` and `/api/v1/remote/catalog`, then funnels all portable writes through keyed `/api/v1/remote/actions`. Local library browsing is backed by `public/assets/music/_metadata/library_manifest.json`, which can be replaced by a resource OTA package together with the referenced audio files. USB library browsing is backed by MPD-visible `USB/<mount name>/...` paths generated from mounted removable roots; a disk can be named `Music`, `JazzDisk`, `Untitled`, or anything else, and Apple `._*` resource-fork files are ignored. The frontend renders Library as a storage/filter tier only: `Local`, `NAS`, `USB`, `Favorites`, and `Recently Added` each display flat rows, while category/subcategory stay row metadata instead of frontstage navigation. Settings / Console must not re-derive NAS or USB readiness from `/api/v1/system/state.library`; it should read `/api/v1/audio/library?storage=all&limit=1` and reuse `storages[].trackCount` so all surfaces stay in sync. The kiosk UI no longer exposes a playlist-editing surface, hidden playlist gesture, or Player/Hi-Fi playlist entry; direct song choice is handled by Player Library browsing and `target=mpd` source switches with `localTrackPath`. Local and USB rows expose audio/file metadata when present; USB copy writes into Local only when the target name does not already exist, and Local delete is a two-step `Delete` then `Yes` confirmation. Backend playlist endpoints and `.tikpal/music-library-state.json` remain as compatibility storage for local tools or future non-kiosk management, and playlist play plus Library next/previous still update the remembered local track to the song that is actually playing while preserving the last Radio station bookmark. Radio is modeled as a single-layer curated station catalog with `radioStationId` direct switching and a default stream URI only as fallback; bare Radio source switches resume the last successful station when that id still exists in the current catalog. The station summary carries `category`, `categoryLabel`, `tags`, `broadcaster`, `logoUrl`, and `catalogSource`; the Player Radio panel exposes `Focus`, `Calm`, `Sleep`, `Jazz`, `Classical`, `News`, `Hi-Fi`, `Blues`, `Rock`, `World`, `Electronic`, `Podcast`, and final `Random` category tabs, while `scope=all` remains an API compatibility path for the full moOde catalog. The `Random` tab returns three sampled curated stations and each row keeps its real category for display and next/previous cycling. Radio transport next/previous cycles station ids inside the current curated category because MPD itself only has the active stream in its queue. For Radio display, `logoUrl` is also the preferred active playback artwork; the backend primes that station artwork as soon as the switch is accepted, while final playback state still depends on MPD start verification and possible auto-skip recovery. Scene Sound is modeled as an exclusive local source that closes external intakes and stops MPD while the active Ambient MP4 supplies browser audio; closing Scene Sound restores the remembered visible source, including the exact Radio station id, with a Library fallback if that restore fails. Hi-Fi is an EQ mode over the current music source: `flat`, `warm`, and `vocal` are real preset ids, `hifiVisualPresetId` is retained only as a compatibility presentation id, and it does not mount scene MP4s or switch to Scene Sound. Auto Night stores an IANA timezone and lowers display brightness only; it must not switch source or mode. Spotify Connect, Bluetooth, AirPlay, and DLNA are modeled as armed-only intake paths: Tikpal only opens them for new connections while the user has explicitly selected that source, and switching away closes the intake again. Across Ambient, Player, and Remote, `armed` is a waiting state and `connected` is the only completed handoff state; DLNA follows this same rule even though its runtime id is `upnp`. DLNA means renderer intake, not DLNA media-server browsing. The same local system surface now also carries display brightness state so the ambient left-edge gesture can talk to DDC/CI through the Node service instead of the browser pretending to own the monitor.

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
| DDC/CI brightness unavailable | Keep the left ambient control lane non-destructive and show unavailable feedback instead of silently acting like a generic ambient swipe. |
| Scene Sound enabled but silent | Keep Scene Sound state honest, then diagnose Chromium ALSA output, `_audioout` / Loopback, and competing renderer processes instead of showing fake playback success. |

## Non-Goals

- Tikpal will not expose every moOde setting on the kiosk.
- Tikpal will not duplicate advanced Web management.
- Tikpal will not treat passive renderer services as always switchable local sources.
- Tikpal will not put maintenance logs or SSH controls in the ambient/player surfaces.
