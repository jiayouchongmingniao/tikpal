# Tikpal

Tikpal is a documentation-first product project for a Raspberry Pi 4 based moOde streamer touch UI. The target device is a 2560 x 720 ultra-wide kiosk screen that should feel like a quiet HiFi object first, and a playback controller only when the user asks for controls.

The project started documentation-first and now includes a runnable Vite + React + TypeScript kiosk app with a local Node API, MP4 fireplace ambience, kiosk-safe dark startup, fixed 2560 x 720 design rules, moOde-oriented player/Console surfaces, and a Gentoo systemd physical-kiosk migration path.

## Product Direction

- Target hardware: Raspberry Pi 4 or Gentoo systemd host, touch screen, 2560 x 720 physical output.
- Runtime: Chromium kiosk, full screen, no browser chrome.
- Frontend baseline: Vite + React + TypeScript.
- Visual rendering baseline: fireplace image plus local MP4 ambience with crossfaded scene changes; WebGL remains a future/experimental renderer track, not the current flame surface.
- Audio backend baseline: moOde / MPD for playback, status, library, output, and system information.
- Product posture: not a copy of the moOde Web UI; Tikpal is a dedicated HiFi ambience and control surface for a 32:9 touch device.

## Core Experience

Tikpal has three primary levels:

| Level | Name | Purpose |
| --- | --- | --- |
| Level 0 | Ambient flame screen | Default long-dwell state with flame visual, time, and subtle playback HUD. |
| Level 1 | Player control overlay | Daily playback controls, cover art, transport, progress, volume, audio status, and output state. |
| Level 1 | Playlist page | Playlist creation, editing, ordering, local-track adds, and playlist playback. |
| Level 2 | Console overlay | Low-frequency listening console for signal, library/NAS status, link health, and guarded care actions. |

Primary gestures:

- One-finger swipe down opens the player control overlay.
- Two-finger swipe down opens the playlist page.
- Swipe up returns to the ambient flame screen.
- Tap temporarily strengthens playback HUD information.
- Long press opens a quick menu.
- Left ambient zone swipe adjusts display brightness live through DDC/CI when available.
- Right ambient zone swipe adjusts moOde/global volume live.
- Inactivity returns the device to the ambient flame screen.

## Documentation

Start with [docs/README.md](docs/README.md).

Key documents:

- [Product brief](docs/00-product/product-brief-v1.md)
- [Interaction and state model](docs/01-ux/interaction-and-state-model-v1.md)
- [Visual system and 2560 x 720 layout](docs/02-visual/visual-system-and-2560x720-layout-v1.md)
- [Pi4 kiosk runtime architecture](docs/03-architecture/pi4-kiosk-webgl-architecture-v1.md)
- [moOde capability mapping](docs/04-integration/moode-capability-mapping-v1.md)
- [MVP backlog and acceptance](docs/05-planning/mvp-backlog-and-acceptance-v1.md)
- [Raspberry Pi kiosk deploy](docs/06-deployment/raspberry-pi-kiosk-deploy-v1.md)
- [Gentoo kiosk deploy](docs/06-deployment/gentoo-kiosk-deploy-v1.md)

Reference assets:

- [Original product design PDF](docs/assets/references/moode-streamer-ui-product-design-doc.pdf)
- [UI reference board](docs/assets/references/ui-reference-board.png)

## Run Locally

```bash
npm install
npm run dev:api
npm run dev:web
```

Open [http://localhost:4173/](http://localhost:4173/).

The Vite app proxies `/api` to the local Tikpal API on port `8787`. If the API is not running, the UI stays usable with bundled fallback state and marks the data source as fallback.

On the production Pi service, `http://<pi-ip>:4173/` is the full kiosk UI for trusted-LAN viewing and macOS screen recording; `http://<pi-ip>:4174/` is the narrower portable remote. The `4173` view is browser-rendered from shared backend state and does not require noVNC.

Validation entry points:

- Ambient: [http://localhost:4173/](http://localhost:4173/)
- Player overlay: [http://localhost:4173/?mode=player](http://localhost:4173/?mode=player)
- Playlist page: [http://localhost:4173/?mode=playlist](http://localhost:4173/?mode=playlist)
- Console: [http://localhost:4173/?mode=quickSettings](http://localhost:4173/?mode=quickSettings)
- Explore side panel: [http://localhost:4173/side-panel](http://localhost:4173/side-panel)

## Build

```bash
npm run build
```

## API Smoke Test

Validate the Batch 3 local API bridge:

```bash
npm run test:api
```

The smoke test starts a temporary mock API, checks state endpoints, verifies playback actions, validates source/library contracts, and confirms invalid action handling. For local music manifest changes, run `npm run test:library` as well; it checks that the ignored `public/assets/music` manifest, covers, MP3 paths, and playlists still match the packaged library assets.

## Portable Remote API

Portable controllers should use the safe facade instead of the kiosk's full internal API:

```bash
curl -fsS http://127.0.0.1:8787/api/v1/openapi.json
curl -fsS http://127.0.0.1:8787/api/v1/remote/state
curl -fsS -X POST http://127.0.0.1:8787/api/v1/remote/actions \
  -H "Content-Type: application/json" \
  -H "X-Tikpal-Key: $TIKPAL_PORTABLE_API_KEY" \
  --data '{"type":"playback.play_pause"}'
```

`GET /api/v1/remote/state` and `GET /api/v1/remote/catalog` expose playback, volume, room mode, scene, source, display, Hi-Fi EQ, Explore, and runtime state for a portable remote. `POST /api/v1/remote/actions` is the only portable write path and requires `TIKPAL_PORTABLE_API_KEY` through the `X-Tikpal-Key` header. The API and web services must receive the same non-empty key; a later systemd `EnvironmentFile` overrides `.env`, so validate both running process environments after deployment. Port `4174` keeps the Remote key field visible and preserves action errors across background state polling. `explore.open` starts QQ Music through the existing physical-kiosk Explore wrapper, `explore.close` performs the same return action as the Explore side panel without navigating the remote browser away from `4174`, and `explore.proxy_set` exposes only the proxy on/off state. With the Explore extension enabled, changing proxy state applies Chromium's runtime proxy setting and refreshes the current provider page without replacing its process, window, profile, or URL; playback on that page is briefly interrupted by the refresh. The proxy URL remains local-only. Direct remote access to `/api/v1/web-mode/*`, reboot, shutdown, library scan, and playlist CRUD stays blocked. Swagger-compatible JSON is available at `/api/v1/openapi.json` and `/api/v1/swagger.json`; `/api/v1/docs` is a lightweight local documentation page.

## Kiosk Package Smoke Test

Validate the Raspberry Pi service and Chromium kiosk package:

```bash
npm run test:kiosk
```

The smoke test checks the production static server path, systemd templates, kiosk launcher, Explore launcher, watchdog timer, managed policy files, and `launch-tikpal-kiosk.sh --check`.

## Scene Video Stability

Scene Video is optimized for the Pi kiosk path: imported scene MP4s are normalized to Pi-friendly H.264, the foreground video layer waits for a drawable frame before reveal, and `FlameScene` exposes `data-flame-video-health` for ordinary video-element stalls. In Pi `mpc` stable-loop mode, scene changes keep the outgoing video mounted while the incoming scene decodes in a hidden layer; the incoming layer is not promoted until it has a drawable frame, so Focus / Calm / Sleep changes and manual scene changes do not expose the browser background. Single-loop stall recovery seeks and resumes the existing video element instead of calling `video.load()`, which can accumulate orphaned Chromium media-decoder threads during long-running Pi sessions. If repeated stalls force the static logo fallback, a scene source change clears the fallback and the current scene retries after a short delay instead of waiting for the systemd watchdog to restart Chromium. The browser page also posts a loopback-only kiosk heartbeat to `POST /api/v1/kiosk/heartbeat` about every 10 seconds with room mode, playback/source state, pending actions, event-loop lag, and active scene-video health.

`GET /api/v1/kiosk/heartbeat` is intentionally local-only and is not part of the portable remote API. The systemd kiosk watchdog reads it from `127.0.0.1`; stale heartbeats, stuck pending actions, high page event-loop lag, or scene-video stall/fallback health are treated as `page-unhealthy` and recover by restarting only `tikpal-kiosk.service`.

## Raspberry Pi Deploy

Build locally, sync the repo to the Pi, and install the services from the repo-owned deploy package:

```bash
npm run typecheck
npm run test:api
npm run test:kiosk
npm run test:ota:package:mp4
npm run build
```

On the Pi:

```bash
cd /home/moode/code/tikpal
npm ci
npm run build
cp -n deploy/chromium/env.kiosk.example .env.kiosk
sudo deploy/moode/tikpal-locale-enable.sh
sudo deploy/moode/tikpal-ddcci-enable.sh
deploy/chromium/launch-tikpal-kiosk.sh --check
sudo deploy/moode/tikpal-quiet-boot-enable.sh
sudo deploy/systemd/install-systemd-services.sh --app-dir /home/moode/code/tikpal --user moode --enable-kiosk --restart
```

`deploy/moode/tikpal-locale-enable.sh` forces SSH sessions to `C.UTF-8` so macOS clients that send `LC_CTYPE=UTF-8` do not print login-shell locale warnings. The systemd installer also runs it automatically unless `TIKPAL_INSTALL_LOCALE_FIX=0` is set.

For Scene Sound on moOde, keep `TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE=auto` in `.env.kiosk` so the launcher detects the current non-HDMI USB output and routes Chromium to that card's `dmix` device. Keep moOde's Loopback-backed `_audioout` for MPD/AirPlay/Bluetooth/Spotify/Hi-Fi capture paths, but do not point Chromium Scene Sound at `_audioout`; Chromium can decode the MP4 audio while logging `PcmOpen: _audioout,Device or resource busy` and producing no audible output.

`deploy/moode/tikpal-ddcci-enable.sh` installs `ddcutil` / `i2c-tools`, enables `i2c-dev`, grants the service user access to `/dev/i2c-*`, writes `TIKPAL_DDCUTIL_*` into `.env`, and probes VCP `0x10`. Reboot if the script cannot see `/dev/i2c-*` after first install.

`deploy/moode/tikpal-quiet-boot-enable.sh` suppresses normal boot/reboot console text on the HDMI kiosk display by quieting the kernel/systemd console path, disabling the visible `tty1` login prompt, and masking `tty2` login fallback. On Gentoo it applies the same policy through `/etc/default/grub`, hides the GRUB text menu, regenerates GRUB when available, and disables visible TTY gettys.

See the full deploy and rollback runbook in [docs/06-deployment/raspberry-pi-kiosk-deploy-v1.md](docs/06-deployment/raspberry-pi-kiosk-deploy-v1.md).

## Gentoo Deploy

The Gentoo migration path keeps the same app directory and systemd units, but replaces the moOde package assumptions with Portage, ALSA direct output, a physical `:0` Xorg kiosk, and Gentoo-specific audio receiver setup. The validated physical layout is a main `2560x720` kiosk with Explore split into a `1920x720` provider window plus a `640x720` side panel.

Gentoo Explore provider text sizing must not use Chrome tab zoom or `--force-device-scale-factor`; Small, Medium, and Large adjust detected provider text elements while preserving the provider viewport and avoiding Chromium's `-/+` zoom bubble. See [docs/06-deployment/gentoo-kiosk-deploy-v1.md](docs/06-deployment/gentoo-kiosk-deploy-v1.md).

Tikpal-owned kiosk UI, Explore side panel, portable Remote, and local Explore error pages share the device language preference from `.tikpal/ui-preferences.json`. Supported UI languages are English, Chinese, German, Italian, Korean, Japanese, and Spanish; Onboard/Fcitx defaults follow the selected language on the physical kiosk. Settings -> Font also syncs the selected font preset into device preferences so Onboard keycap labels use the same visual family as the kiosk UI. The Onboard language key keeps a small runtime cycle state so touch users can move through EN / Chinese / German / Italian / Korean / Japanese / ES without bouncing on transient Fcitx state.

Gentoo Settings also owns the production-only device preferences that differ from moOde: soft touch-wake Screen Sleep with selectable saver styles, SMB NAS configuration, MPD Audio Output profiles, and Multi-room Audio service intent. Screen Sleep is suspended while Explore has an active provider so a login, MV, or web-player session is not covered by the saver; the idle timer restarts after Explore closes. When the saver starts, Tikpal briefly shows a faint `Touch to wake` cue before fading into the selected saver, so the display does not feel like a fault. Audio Output profile changes are bounded so `Everyday` / `Custom` switching does not leave the Settings UI waiting on slow MPD or NAS-backed queues; Tikpal restores MPD/Radio playback best-effort and lets normal state polling settle the final status. `Pure Listening` locks MPD software volume, but the visible volume control still adjusts the configured output level when the Gentoo output-volume helper is available.

## Interaction Smoke Test

With the dev server running, verify the Batch 2 kiosk interaction contract:

```bash
npm run test:interaction
```

The smoke test drives Chrome through the DevTools protocol and checks wheel/trackpad-style overlay entry, ambient HUD controls, playback truth display, the Player source workspace, Library storage browsing, surface skin highlight states, overlay return, protected panel clicks, and Console detail drawers.

## MVP Summary

The first implementation milestone should deliver:

- Ambient fireplace screen with clock and subtle playback HUD.
- One-finger player overlay and explicit Console entry through gesture and weak gear fallback.
- Playback state, cover art, transport controls, progress, volume, format, sample rate, bit depth, output device, and network status.
- Console chips for Preferences, Library, Link, and Care, with listening status, Audio Output profiles, Multi-room Audio, display, library/NAS status, API health, reboot, and shutdown.
- Long-press Quick Menu with large `Screen`, `Volume`, `Time`, and `Sleep` controls; `Screen` / `Sleep` use black tap-to-wake overlays, and the weak top-right Console fallback remains available.
- Kiosk-safe behavior on Raspberry Pi 4 with 2560 x 720 fullscreen output.

## Repository Status

The local API exposes a first-class audio-source model for `Library`, internal `Audio`, `Radio`, `Spotify Connect`, `Bluetooth`, `AirPlay`, and `DLNA`. The frontend reads current source summary from `/api/v1/system/state`, inspects compact source state through `GET /api/v1/audio/sources`, renders six visible source tabs (`Library`, `Radio`, `Spotify`, `AirPlay`, `Bluetooth`, `DLNA`), fetches the searchable radio catalog through `GET /api/v1/audio/radios`, fetches official station logos through `/api/v1/media/radio-logo`, fetches the manifest-backed local music library plus NAS/USB storage counts through `GET /api/v1/audio/library`, manages user-confirmed SMB NAS setup through `/api/v1/nas/sources` and `/api/v1/nas/discover`, manages the touch-first Playlist Hub through `/api/v1/audio/playlists` and `/api/v1/audio/playlist-actions`, posts source switches to `POST /api/v1/audio/source`, and still uses `/api/v1/playback/actions` plus `/api/v1/system/actions` for transport and system cards. Multi-room Audio is Settings-controlled, not a visible Player source tab: `/api/v1/multiroom` controls Roon, Lyrion, and Tikpal Multi-room service intent, Music Assistant is a coming-soon placeholder, `/api/v1/roonbridge` remains a compatibility endpoint, and active room playback appears as the current status source while Tikpal releases MPD/Radio without faking metadata, artwork, or lyrics. `AudioState.rememberedSource` persists the last visible source (`mpd`, `radio`, `spotify`, `bluetooth`, `airplay`, or `upnp`) in `.tikpal/audio-source-memory.json` so Scene Sound exit and Hi-Fi startup/recovery can restore the last Library track, Radio station, or external waiting state without letting internal `scene` / `audio` overwrite it. Portable remotes use `/api/v1/remote/*` plus `X-Tikpal-Key` for safe LAN control; the full internal API remains local-kiosk-only when accessed through the production web proxy. Player Library browsing, Console / Settings Library cards, and portable summaries must treat `/api/v1/audio/library.storages` as the shared library-count truth, so USB/NAS/local readiness does not drift between screens. Library storage tabs are browse-only; only a track tap switches MPD, and the UI confirms the selected storage with `Playing from Local.`, `Playing from NAS.`, or `Playing from USB.` while sending MPD-visible `Codex/...`, `NAS/...`, or `USB/...` paths.

Explore is separate from that source model. It opens Suno and official music web players in a left Chromium window with a stable Tikpal `/side-panel` controller in the 640 x 720 right column; an unspecified open starts QQ Music. It releases local MPD/Radio playback, external renderer intakes, Scene Sound, and Hi-Fi recovery before provider audio starts, blocks opening if that release fails, does not write `rememberedSource`, and stores only Explore provider/proxy state in `.tikpal/web-mode-*.json`. Provider cards show `Ready`, background `Prewarming`, active-request `Opening`, stable `Active`, and user-facing `Need Proxy On` only after a short direct reachability probe fails while Proxy is off; platforms that work directly are allowed to continue opening and warming without a hard-coded allow/deny list. The Gentoo physical kiosk keeps a resident pool of the ten provider profiles, reveals the selected provider into `0,0 1920x720`, and keeps inactive providers offscreen at `2560,0` with tab mute plus page pause. Background prewarm seeds every queued provider as `Prewarming` before its launch turn, then launches provider windows and guards with a short stagger instead of waiting for each slow site to become fully ready, so YouTube Music cannot block Apple Music, TIDAL, Deezer, Amazon Music, or NetEase from starting. Switching to a resident provider stops background prewarm, restarts that provider's guard, and focuses the existing window instead of re-running first-load readiness probes, so slow YouTube Music / Apple Music / TIDAL / Deezer readiness checks cannot roll the UI back to the previous provider. Returning to a resident provider clears tab mute, unmutes media elements, and resumes only the media that was playing when the provider was hidden; inactive guard polling must not overwrite that resume intent after the page has already been paused. A per-provider guard also clears stale `check_setup` state when its resident page later reaches the expected real provider host, so a slow prewarm cannot leave TIDAL or similar providers permanently marked as setup failures. New provider profiles first load the local transition page, then the fixed-id MV3 extension applies `direct` or `fixed_servers` through `chrome.proxy.settings` before navigating to the provider. The installer removes the legacy Tikpal policy file that used a wildcard extension blocklist, because Chromium does not allow unpacked extensions to bypass that policy. Proxy On/Off changes use the same action from the side panel and `4174`: the active provider refreshes once, while its Chromium PID, X window, login profile, and current URL are retained; the side panel labels the toggle `Proxy On` or `Proxy Off` rather than the ambiguous `Direct`. The Console proxy switch and complete URL drafts save automatically after a short debounce and report `Saving`, `Saved automatically`, or the validation error inline; there are no Save or Test buttons. Its only guidance is: `Saves automatically. If a provider won’t open, toggle Web Proxy and retry.` The extension confirms the settings revision through the loopback-only `/api/v1/web-mode/proxy-applied` endpoint; a missing confirmation is bounded to five seconds and rolls the setting back. Set `TIKPAL_WEB_MODE_EXTENSION_ENABLED=0` and reopen the provider once to use the command-line proxy/restart fallback. The provider guard starts as soon as the provider window has CDP, blocks desktop-browser gestures, accepts explicit accept-all/agree cookie consent buttons for every provider when the surrounding context is cookie/privacy consent, preserves OAuth navigation, and replaces only clear failures or progress-stalled blank pages with Tikpal's error surface. Login, payment, purchase, membership, authorization, service-terms, and subscription actions remain manual. Text-like fields across provider pages and the local kiosk/Console explicitly show the floating always-on-top `onboard` keyboard on focus, including active editable fields inside same-origin iframes or shadow DOM, then hide it on blur, submit, or single-line Enter; switching between text fields keeps it visible, while checkboxes, selectors, and buttons never summon it. The Explore panel has no manual keyboard control; Console and provider pages rely on automatic input focus. Close remains only in the top-right header, while Onboard Show/Hide keeps the hidden keyboard process resident. LAN browsers using the full kiosk UI on `4173` do not control Onboard on the Pi. On QQ Music, a dialog that contains both `打开客户端` and `下载客户端` is closed through its explicit close control, then the same Play action is retried once after the close; a repeated dialog is closed without another retry, and neither client action is clicked. The `下载客户端体验更多内容` prompt requires login and remains visible for user action; Tikpal does not auto-dismiss or click it. Hi-Fi runtime recovery stays suspended while Explore is opening or active, so MPD cannot resume behind provider audio. Provider hang dialogs are disabled. Close returns to Tikpal and gives provider and side-panel processes a short graceful-exit window, then force-kills any Chromium process that remains so a manually opened Explore panel cannot cover the restored kiosk. `.tikpal/web-mode-settings.json` is runtime proxy truth and must follow the proxy host's current LAN address; the 2026-07-19 `192.168.2.138` validation used `http://192.168.2.172:7897`.

Explore proxy toggles are network condition changes: after Proxy On/Off applies to the active provider, the resident provider pool is forced back through `Prewarming` so every card can re-check direct/proxy reachability and update to `Ready` or `Need Proxy On` from fresh state. Existing inactive provider processes stay alive but are navigated back to their provider URL so old timeout/error pages retry under the new proxy mode.

When the optional Explore A/B ALSA soft-volume buses are installed, provider handoff fades the old web player down while bringing the ready target up. Unavailable mixer support falls back to the direct output without blocking Explore. In the resident provider pool, inactive providers stay offscreen with tab mute plus page pause so multiple web players cannot remain audible; non-pool fallback deployments may still close the old provider after a successful switch. Suno's page-driven startup autofocus is ignored, so Onboard appears there only after the user taps an input.

Explore audio release distinguishes local files from live streams: local MPD playback is paused, while an active HTTP Radio stream is stopped before provider Chromium opens so QQ Music and Radio cannot share the physical output. Bluetooth, AirPlay, Spotify Connect, and DLNA must be closed through non-empty disable hooks before the provider opens; failure to release Tikpal audio is a provider-open failure, not a reason to restore Bluetooth automatically. While Explore remains active, `volume_set` reads and writes the system output-volume helper rather than stale MPD/Radio software volume, so the side-panel slider controls provider Chromium's physical output and reports the same value it applied. The provider guard is launched with Node's `--experimental-websocket` flag so the CDP focus path works on the supported Node.js 20 runtime. Onboard opens on a new editable-field click/focus, but it is not continuously forced visible; its own close key or a page-background tap keeps it hidden until the user interacts with an editable field again.

The real moOde / MPD adapter remains the audio owner. In `mpc` mode, Tikpal keeps MPD/library control as the default path, treats Radio as a curated station catalog with direct `radioStationId` switching, and now models Spotify Connect, Bluetooth, AirPlay, and DLNA as armed-only intake paths: they are connectable only while explicitly selected. Settings -> Preferences -> Audio Output exposes four user-facing MPD behavior profiles: `Pure Listening` for hardware direct output with MPD software volume locked and output-level volume still available through the configured helper, `Everyday` as the default shared-output route with ReplayGain auto and two-second crossfade, `Sleep / Meditation` with fixed `48000:*:*` MPD output format, ReplayGain track, five-second crossfade, a 45 percent MPD volume cap, and 60-minute auto-stop, plus `Custom` for support-tuned MPD helper overrides. Custom is an advanced path and must show a short red caution in the UI so users know to use it carefully; its six switches remain usable while the selected state stays visually locked during apply. Profile switching uses bounded helper/API restore timeouts so successful `Everyday` or `Custom` changes do not present as frontend timeouts when MPD is reopening ALSA or reading a NAS-backed queue. The legacy `mpdBitPerfectMode` field remains compatible: `strict` maps to `pure`, while `standard` maps to `everyday`. Long-pressing the Audio Output title opens hidden `Audio Diagnostics` for MPD output block, ReplayGain, crossfade, ALSA `hw_params`, and DAC owner checks. External-to-external switches are target-first, so Tikpal returns the requested Spotify / Bluetooth / AirPlay / DLNA intake once it opens and cleans up old external receivers in the background; switches back to Library or Radio still close external receivers synchronously and prefer a confirmed MPD current file so stale external armed state cannot mask local playback. Radio defaults to the Tikpal-organized moOde presets, grouped as `Focus`, `Calm`, `Sleep`, `Jazz`, `Classical`, `News`, `Hi-Fi`, `Blues`, `Rock`, `World`, `Electronic`, and `Podcast`, plus a final `Random` page that samples three real curated stations without starting playback; `scope=all` keeps the full moOde catalog available with Tikpal rows first. Active Radio playback uses the station logo from moOde's local radio-logo library when available and falls back to generated cover art only after the official logo path fails. Radio switches prime the active station cache before the MPD stream has fully settled, and the browser polls faster while Radio source/next/previous actions are pending, so Player and Hi-Fi can show the new station logo before long stream verification finishes. Radio logo media supports GET and HEAD with a one-day cache window, letting repeated station changes reuse local artwork quickly. When Radio is selected while MPD software volume is `0%`, Tikpal restores the last nonzero MPD volume from `.tikpal/audio-volume-state.json`, or the current room-mode volume, before starting playback so a muted preset does not look like a broken source. While Radio is active, playback `next` and `previous` cycle through adjacent Tikpal stations inside the playing station's real category instead of sending MPD queue commands to a single stream item; if MPD has already dropped the current stream from `mpc current`, Tikpal still keeps the failed stream URI from `mpc status` as Radio context and skips candidate stations that fail to start before returning an error. Clear stream failures such as `Failed to decode` or connection timeouts also trigger an automatic late-check advance to the next station, with a source-aware state refresh so the UI does not keep showing the dead station label. The player source rail is ordered as `Library`, `Radio`, `Spotify`, `AirPlay`, `Bluetooth`, and `DLNA`; Playlist is a separate three-column management page opened from Player or Ambient. Playlist user state persists name, mood tags, cover type/value, description, and track order in `.tikpal/music-library-state.json`; curated playlists stay read-only and can be duplicated into editable user playlists. The Playlist page supports both touchscreen gestures and desktop trackpad use: horizontal two-finger swipes reveal card/song quick actions, while vertical trackpad scrolling stays inside the readable columns instead of returning to Ambient. Library browsing is storage-first and flat in Player: `Local`, `NAS`, `USB`, `Favorites`, and `Recently Added` show track rows directly instead of frontstage Local category/subfolder tabs. Local and USB rows expose audio file details when available; USB rows can `Copy to Local` and skip duplicate names, while Local rows require a `Yes` confirmation before deleting. Long Library lists keep a fixed right-side drag rail for rapid first-to-last scrolling without selecting or auto-playing tracks. USB storage is MPD-visible under `USB/<mount name>` and can come from any mounted removable folder, not only a disk named `Music`; Player rows, Console cards, and remote summaries all reuse the same storage counts. `TIKPAL_RADIO_DEFAULT_URI` stays as a fallback when moOde presets are unavailable, while Bluetooth / AirPlay / DLNA gating is wired through environment-configured enable/disable and status commands. DLNA means Tikpal/moOde acts as a UPnP/DLNA renderer for external casting, not as a DLNA media-server browser. Bluetooth state now also carries the local advertised device name so the frontend can tell the user exactly what to look for on their phone while pairing.

Settings -> Library -> NAS configures SMB/Samba shares explicitly as a CIFS client: LAN scan only proposes candidates, `Test` verifies access, and `Save & Scan` mounts the selected share read-only before it appears in Player -> Library -> NAS. Passwords stay out of API responses and live in `.tikpal/nas-credentials/*.cred` with `0600` permissions. On API startup, saved and enabled NAS sources are mounted in the background with short retries; failures are skipped and surfaced as `Check setup` so Local/USB and the rest of Tikpal still start normally. Visible mount errors stay short and actionable in the NAS header/card, while raw `mount.cifs` output is preserved as `lastRawError` for diagnostics. Legacy `TIKPAL_NAS_LIBRARY_ROOTS` still works as `Manual`, but configured NAS sources are preferred and expose MPD-visible `NAS/<name>/...` paths so the NAS tab plays exactly what MPD indexes.

Ambient lyrics now have shared recognition paths behind the same `lyrics` state. Local `MPD` / `Radio` playback still resolves lyrics from metadata through LRCLIB, while Bluetooth and AirPlay first use trusted input metadata plus playback position before falling back to short local PCM identification when a capture command is configured. Radio, Bluetooth, and AirPlay share the same Hi-Fi cover-plus-lyrics wall once `lyrics.status === "ready"` with displayable lines; Radio uses `local_playback` metadata when the stream exposes a real title / artist, Bluetooth uses `bluetooth_input`, AirPlay uses `airplay_input`, and none of these sources gets a separate visual branch. Bluetooth and AirPlay lyrics matching preserves Unicode letters and numbers, so Chinese title / artist metadata can use the same strict LRCLIB identity path as English tracks. AirPlay cover art, title metadata, elapsed clock, and lyrics refresh from the same metadata snapshot, so Ambient, Player, Hi-Fi, and portable remote surfaces do not pair stale cover art or old lyrics with a new AirPlay track. AirPlay LRCLIB results must match the normalized title and artist before returning `ready`; same-title / different-artist results stay `recognizing` or `not_found`. AirPlay uses trusted MPRIS `Position` when available; when Shairport only reports `Position=0`, Tikpal uses a pause-aware estimated clock for the lyrics wall and falls back to static only when no usable clock exists. Bluetooth treats very short reported durations as timing hints, not identity truth, because some senders report `60s` for full tracks; LRCLIB provider duration can keep synced lyrics intact.

On moOde, `deploy/moode/tikpal-airplay-enable.sh` also normalizes Shairport Sync's active-state hooks, `wait_for_completion`, `_audioout`, and `cover_art_cache_directory`. This keeps `aplactive`, MPRIS artwork, the proxied AirPlay cover endpoint, and strict title/artist lyrics lookup on the same live session after a fresh device install.

Console now includes a listening-first status header, local font presets, and surface skin presets (`warm-gold`, `graphite-silver`, `ivory-studio`), while the internal route remains `quickSettings` for compatibility. Reboot and shutdown still require the second confirmation tap, but the API schedules those power commands in the background and returns immediately so Settings does not remain stuck in a pending state while systemd stops services. The ambient flame screen has split live-control zones: left for DDC/CI brightness on supported displays, right for volume. The Pi deploy path includes a repo-owned DDC/CI helper that installs `ddcutil`, enables I2C access, and lets `mpc` mode report `display.transport: "ddcci"` when the monitor exposes VCP `0x10`. When the Ambient HUD is visible, the Hi-Fi center row includes music transport, favorite, playlist, lyrics, and EQ preset switching; Focus, Calm, and Sleep stay on the lighter scene strip. Scene previous/next persists per room mode, so a Calm fireplace selection survives Hi-Fi and API/kiosk restarts instead of being overwritten by the Rainy Window preset. Choosing Library, Radio, or an external intake from Focus/Calm/Sleep closes the picker and leaves only a small lower-left source pill, so the scene video remains the visual focus while the selected source or waiting state stays visible.

The Player and Ambient HUD both display playback truth from the active `playback.source` and current track metadata, rather than showing whichever Library item or source panel is selected for browsing. The Player Library row checkmark is tied to that same current-track truth, so previous/next playback updates move the checkmark and bring the current row back into view without changing the user's storage tab. Hi-Fi uses that same truth for its centered now-playing view, lyrics wall, AirPlay artwork, and Bluetooth no-cover poster, and entering Hi-Fi restores the remembered visible source if the current mode had been playing Scene Sound: a saved Library track is retried with a plain Library fallback, a saved Radio station is reopened by `radioStationId`, and saved Spotify/AirPlay/Bluetooth/DLNA sources reopen their waiting handoff state. Ready lyrics replace the centered layout with a cover-plus-lyrics wall; the compact rolling lyrics ticker is reserved for Focus/Calm/Sleep instead of appearing under the Hi-Fi wall. Synced Hi-Fi lyrics advance from the shared playback clock between snapshot refreshes, AirPlay estimated lyrics can advance from a pause-aware inferred clock, static lyrics keep the wall visible when no usable active line can be projected, and real artwork always wins over generated art. The shared lyrics wall includes a lightweight CSS-only mini EQ centered under the cover art, progress line, elapsed/duration readout, and capability-gated playback controls; the mini EQ uses deterministic per-bar timing/amplitude variation for a more organic simulation, but it does not depend on real spectrum capture. When lyrics are unavailable and Hi-Fi returns to centered now-playing, a non-interactive playback presence cue keeps the playing state visible even at low volume; paused or stopped playback keeps that cue, the wave lines, and particles static. Lyrics visibility defaults on for new kiosk storage (`tikpal.lyricsVisible.v3`), old hidden external-input lyrics are restored visible once through `tikpal.lyricsVisible.readyRestored.v1`, and later explicit user toggles remain respected. Generated fallback cover art still follows the selected font preset outside the Bluetooth Hi-Fi fallback, while real playback artwork wins whenever the backend provides it.

Ambient background videos are discovered from `public/assets/*.mp4` and OTA-managed `public/assets/scenes/*.mp4` through `GET /api/v1/media/background-videos`. Scene changes mount the next video layer, seek it to `playback.elapsedSeconds % video.duration`, then crossfade; paused playback stays frozen on the new scene frame, while playing playback resumes the video after alignment. Within one looping scene, `FlameScene` keeps two video slots: the standby slot is prepared about 1.2 seconds before the natural tail, revealed about 0.42 seconds before the tail, and held through a 360ms visual / 340ms Scene Sound crossfade so Chromium does not hit the native MP4 loop boundary first. On Pi stable-loop mode, loop playback stays on the simpler single-video path, but scene switching still mounts a separate incoming layer, waits for `readyState >= 2`, nonzero video dimensions, and `data-flame-frame-ready="true"`, then dims, promotes, reveals, and cleans up only after the handoff. The normal video path keeps the static logo/backdrop hidden so scene switching does not flash white while a new source decodes; the logo surface remains only for static-only and repeated-stall fallback states. The Scene video surface exposes lightweight health through `data-flame-video-health`, retries stalled playback, and falls back to the static logo surface if the browser video element stops advancing repeatedly; that fallback must recover by remounting video on the next retry or scene change so a later Focus / Calm / Sleep switch cannot stay stuck on the logo. Scene Sound unmutes only the active video element, follows `system.volume.percent`, and depends on the kiosk Chromium ALSA route reaching the physical USB output. The Pi deploy package also installs an optional kiosk watchdog timer that recovers the full X/Chromium display stack when long-running Scene playback hits a V3D/GPU hang that frontend code cannot recover from. The web server serves MP4 files with byte-range support so browser video seeking works reliably. Ambient refreshes the scene catalog every 30 seconds and whenever the page becomes visible, so newly applied scene OTA packages join the previous / next scene controls without a page reload.

Resource OTA updates are handled by `npm run ota:resources -- <package-dir>`. A resource OTA package must provide `assets/music/_metadata/library_manifest.json`, copy the referenced local music files under `assets/music/`, and can add scene videos from `assets/scenes/` using `assets/scenes/_metadata/scene_videos.json`. Older packages may still include the legacy mutable fireplace video at `assets/output_2560x720-4k.mp4`, but the default Ambient scene catalog no longer depends on an `output*.mp4` file. The script validates music paths, scene MP4 checksums, and MP4 headers before writing, syncs `public/assets`, also syncs `dist/assets` when a production build exists, and records the result in `.tikpal/resource-ota-state.json`.

Scene MP4 OTA packages can be generated from a folder of `.mp4` files:

```bash
npm run ota:package:mp4 -- /path/to/mp4-scenes --recursive --bundle --default Forest-Cabin.mp4
```

By default the generator writes packages under `.tikpal/resource-ota-packages`, creates `assets/scenes/_metadata/scene_videos.json`, assigns stable scene ids from filenames, records `sha256` checksums that `npm run ota:resources` verifies before installing, and normalizes imported videos to Pi-friendly H.264 Main Profile Level 4.1 with bounded bitrate. Use `npm run media:loop -- --input <mp4>` when a source scene needs a soft loop rewrite before packaging; the helper requires `ffmpeg` / `ffprobe` and writes a backup under `.codex-artifacts/media-backups` when it updates a file in place.

Use `npm run scene:clear` to remove installed Ambient scene videos from `public/assets/scenes`, mirror the clear into `dist/assets/scenes` when a production build exists, and leave an empty `scene_videos.json` so the UI returns to the black video-off state until the next scene package is installed.

## Current Gaps

The repo is no longer mock-only, but a few visible pieces are still only partial:

- The source model is still intentionally focused. The UI exposes six frontstage tabs (`Library`, `Radio`, `Spotify`, `AirPlay`, `Bluetooth`, `DLNA`), while internal `Audio` remains state/API truth rather than a visible browser category.
- The ambient left-side brightness gesture depends on working DDC/CI on the target display. The validated XENEON EDGE target reports `VCP 10 C 80 100`; when `ddcutil` cannot read or set VCP `0x10`, Tikpal degrades to read-only/unavailable status instead of offering a fallback brightness path.
- Ambient deliberately does not render playlist or queue panels inline; playlist opens as its own page, and queue preview belongs in the Player overlay so the default 720px-high dwell screen stays calm.
