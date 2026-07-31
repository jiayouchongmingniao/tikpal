# Raspberry Pi Kiosk Deploy v1

## Goal

Deploy Tikpal to a Raspberry Pi 4 running moOde so the device boots into the local 2560 x 720 Chromium kiosk experience.

This runbook remains moOde / Raspberry Pi specific. For the Gentoo systemd migration path, use [Gentoo kiosk deploy v1](gentoo-kiosk-deploy-v1.md); the two paths share repo-owned Tikpal units and Explore behavior, but differ in OS package management, audio receiver setup, display preparation, and input-method installation.

This package installs API/web plus kiosk support units when kiosk diagnostics are enabled:

| Unit | Port | Purpose |
| --- | --- | --- |
| `tikpal-api.service` | `8787` | Local Tikpal API and future moOde / MPD bridge. |
| `tikpal-web.service` | `4173`, `4174` | Full kiosk UI for local/LAN recording on `4173`; portable remote control on `4174`; both proxy `/api` to the API service with separate access boundaries. |
| `tikpal-kiosk.service` | display `:0` | Chromium kiosk session for the touch screen. |
| `tikpal-kiosk-viewer.service` | `6080` | Optional noVNC viewer for the full kiosk display. |
| `tikpal-kiosk-devtools.service` | `9222` | Optional LAN proxy for Chromium DevTools. |
| `tikpal-kiosk-watchdog.service` | local only | One-shot healthcheck that can restart only the kiosk display service. |
| `tikpal-kiosk-watchdog.timer` | local only | Runs the display watchdog every 60-90 seconds. |

## Local Preflight

Run this on the development machine before syncing to the Pi:

```bash
npm ci
npm run typecheck
npm run test:api
npm run test:kiosk
npm run test:ota:package:mp4
npm run build
```

Optional local production server check:

```bash
npm run start:api
npm run start:web
```

Open `http://localhost:4173/`.

On a deployed Pi, open `http://<pi-ip>:4173/` from macOS for the full browser-rendered kiosk UI, or `http://<pi-ip>:4174/` for the portable remote control. The `4173` path shares backend playback, room, scene, artwork, and lyrics state with the physical kiosk without running VNC/noVNC; it is a second browser renderer, not a framebuffer stream.

## Sync To Pi

Choose a target directory. The recommended first install path is:

```bash
/home/moode/code/tikpal
```

Example direct sync:

```bash
rsync -a --delete --progress --stats \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '.tikpal/' \
  --exclude '.DS_Store' \
  ./ moode@<pi-ip>:/home/moode/code/tikpal/
```

If the Pi is only reachable through the local SOCKS proxy, use the same rsync command with SSH transport:

```bash
rsync -a --delete --progress --stats \
  -e "ssh -o ProxyCommand='nc -X 5 -x 127.0.0.1:7897 %h %p'" \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '.tikpal/' \
  --exclude '.DS_Store' \
  ./ moode@<pi-ip>:/home/moode/code/tikpal/
```

## Install On Pi

SSH into the Pi, then:

```bash
cd /home/moode/code/tikpal
sudo apt-get update
sudo apt-get install -y xvfb x11vnc novnc websockify socat
npm ci
npm run build
cp -n deploy/chromium/env.kiosk.example .env.kiosk
sudo deploy/moode/tikpal-locale-enable.sh
```

`deploy/moode/tikpal-locale-enable.sh` should be run on new moOde Pi installs before the final service install. It writes `/etc/ssh/sshd_config.d/99-tikpal-locale.conf`, sets the default locale to `C.UTF-8`, reloads `ssh.service`, and prevents macOS SSH clients that send `LC_CTYPE=UTF-8` from causing repeated login-shell warnings. `deploy/systemd/install-systemd-services.sh` also runs this helper automatically unless `TIKPAL_INSTALL_LOCALE_FIX=0` is set.

`sudo deploy/systemd/install-systemd-services.sh --enable-kiosk` installs the kiosk and Explore runtime packages, including `xdotool`, Onboard, Fcitx5, noVNC, and the local X helpers, unless `TIKPAL_INSTALL_KIOSK_PACKAGES=0` is set. If you skip that installer step, install the base packages above, then add the Explore touch/login helpers manually:

```bash
sudo apt-get install -y --no-install-recommends onboard wmctrl xdotool fcitx5 fcitx5-chinese-addons fcitx5-frontend-gtk3
```

Inspect `.env.kiosk` and adjust the Chromium binary or display output if needed:

```bash
nano .env.kiosk
deploy/chromium/start-tikpal-kiosk-display.sh --check
deploy/chromium/start-tikpal-kiosk-viewer.sh --check
deploy/chromium/start-tikpal-kiosk-devtools-proxy.sh --check
deploy/chromium/tikpal-kiosk-healthcheck.sh --check
deploy/chromium/launch-tikpal-kiosk.sh --check
deploy/chromium/tikpal-web-mode.sh --check
```

For Scene Sound on the local kiosk, route Chromium to the current physical USB `dmix` output instead of moOde's Loopback-backed `_audioout`. MPD, AirPlay, Bluetooth, Spotify, and Hi-Fi capture can keep using `_audioout`; browser Scene Sound should not hold that device while Tikpal starts MPD-backed sources such as Library or Radio:

```bash
sed -i 's|^TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE=.*|TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE=auto|' .env.kiosk
deploy/chromium/launch-tikpal-kiosk.sh --check
```

Chromium may keep an ALSA `audio.mojom.AudioService` process open after the active scene video is muted. If it is routed to `_audioout`, MPD Radio can later land in `paused` with `Failed to open audio output`; treat that as an output-route/runtime-env problem before blaming the radio station.

Explore opens Suno and official music web players in a separate 1920 x 720 left Chromium window and a Tikpal `/side-panel` in the right 640px column. The provider window uses `.tikpal/web-mode-settings.json` for proxy configuration; the launcher fallback is HTTP `http://192.168.10.103:7897`, while the Tikpal side panel stays local on `localhost:4173` and does not use that proxy. Persisted settings are runtime truth, so update the file or Console whenever the proxy host's DHCP address changes. Console accepts either a full proxy URL or bare `host:port`; bare values such as `192.168.10.103:7897` are normalized to HTTP before saving. `providerTextScale` defaults from `TIKPAL_WEB_MODE_PROVIDER_TEXT_SCALE=1.10` and supports `1.00`, `1.10`, and `1.20`; the extension applies it only to detected text-bearing elements in the left provider page. It must not use Chrome tab zoom, `--force-device-scale-factor`, the 640px side panel, or the main kiosk profile, so the provider viewport remains 1920 x 720 and Chromium does not show the `-/+` zoom bubble. Each provider launch refreshes only the profile's extension service-worker cache and Tikpal extension registration entry, preserving cookies and localStorage while preventing Chromium from running a stale unpacked extension after deploy. The Console Proxy switch, provider text-size control, and complete URL drafts save automatically after 700ms and report state inline; there are no Save or Test actions. The short guidance reads `Saves automatically. If a provider won’t open, toggle Web Proxy and retry.` The two-column control layout keeps both settings and the guidance fully visible on the 2560 x 720 kiosk. The side panel starts first and remains alive during staged provider switches; the target opens behind a transition veil, becomes `Active` only after its real window is ready, then the old provider is closed. A failed target never becomes `Active`; if reopening the current provider fails after its old process was closed, `activeProvider` is cleared so the side panel shows `Failed` instead of a stale active tile. Provider-window detection is bounded by `TIKPAL_WEB_MODE_PROVIDER_WINDOW_TIMEOUT_SECONDS=30`, while the API open-command timeout is longer, so the launcher can clean failed provider, transition, and side-panel windows itself instead of being killed mid-cleanup. `TIKPAL_KIOSK_RESET_WEB_MODE_ON_START=1` makes the physical kiosk session close Explore and clear runtime provider state before returning to the main 2560 x 720 Tikpal window, so service restarts cannot leave `.tikpal/web-mode-state.json` claiming a provider is active after the provider windows are gone. The provider window, not the side panel, exposes a local-only per-provider CDP port derived from `127.0.0.1:9234` so `deploy/chromium/tikpal-web-mode-guard.mjs` can enforce kiosk interaction rules and provider-specific safety behavior:

The installer uses `deploy/moode/tikpal-web-mode-crossfade.sh` to create two ALSA soft-volume outputs over `TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE`. With `TIKPAL_WEB_MODE_AUDIO_CROSSFADE_ENABLED=1`, the launcher keeps the current provider audible while the target loads offscreen, waits up to `TIKPAL_WEB_MODE_PROVIDER_READY_TIMEOUT_SECONDS` for a populated provider surface, then fades between the A/B buses over `TIKPAL_WEB_MODE_AUDIO_CROSSFADE_MS`. A failed target is muted and discarded while the current provider remains active. If ALSA mixer controls cannot be installed or detected, Explore logs the condition and uses the existing direct output path instead of blocking provider access. Stable runtime still retains only the active provider, so the crossfade does not turn into multiple web players continuing in the background.

```bash
cat .tikpal/web-mode-settings.json 2>/dev/null || true
deploy/chromium/tikpal-web-mode.sh --check
deploy/chromium/tikpal-web-mode.sh open spotify
deploy/chromium/tikpal-web-mode.sh open qq_music
curl -fsS http://127.0.0.1:9234/json | head
curl -fsS http://127.0.0.1:9241/json/list | head
node deploy/chromium/tikpal-web-mode-guard.mjs --check
deploy/chromium/tikpal-web-mode.sh keyboard
deploy/chromium/tikpal-web-mode.sh close
```

The provider guard is not a generic ad blocker and does not promise every web player can load. Proxy only changes the network path; Amazon Music, YouTube Music, Apple Music, and regional providers may still fail because of region, TLS, DRM, account, proxy, or Chromium policy. Clear Chromium and provider-native failures redirect to Tikpal's friendly error page. A short or gray SPA shell redirects only after 18 seconds with no DOM length, resource count, visible-element count, or text progress; this prevents normal Amazon Music and Deezer startup from becoming `empty_page_timeout`. Ordinary OAuth navigation aborts are ignored. The guard starts before the provider-ready gate and may accept explicit accept-all/agree cookie prompts for every provider when the surrounding context is cookie/privacy consent. Reject, manage, preference, settings, login, purchase, membership, authorization, service-terms, agreement, recharge, and subscription actions remain manual. The provider text-size control is shared with the Gentoo path: it must preserve the left provider viewport, avoid Chrome tab zoom and `--force-device-scale-factor`, and only adjust detected provider text elements for Small / Medium / Large.

With `TIKPAL_WEB_MODE_ONBOARD_AUTO_FOCUS=1`, focus on text-like provider fields (`text`, `search`, URL, email, password, telephone, `number`, `textarea`, textbox roles, and editable content) explicitly shows Onboard, including active editable fields inside same-origin iframes or shadow DOM. Suno is deliberately stricter because its landing page autofocuses an editable surface during startup: Suno only shows Onboard after an actual input tap, not page-driven focus. The same rule covers local physical kiosk and Console fields; Console fields send their focused rectangle to the API so the launcher can place Onboard above or below the field instead of covering controls such as Link / Explore Proxy URL.

Opening the Console Explore Proxy settings detail preloads the resident Onboard process without displaying it; entering Explore or switching to a provider does not preload the keyboard. Keyboard show / hide actions use a dedicated `TIKPAL_WEB_MODE_ONBOARD_LOCK_TIMEOUT_SECONDS` lock instead of the provider-switch lock, so the first Proxy URL tap is not delayed by Explore provider startup or audio-device auto-detection. Provider window blur caused by Onboard itself must not hide the keyboard; both the extension content script and provider guard keep fields such as Google OAuth login typeable while Onboard is raised above Chromium and the provider keeps X focus. The provider input session remains active until an explicit outside provider tap, form submit, or single-line Enter, so Onboard's own X focus changes do not make it flash closed. Blur after an outside provider tap, form submit, and single-line Enter hide it; moving between text fields keeps it visible, while checkboxes, radio controls, selectors, ranges, and buttons never summon it. A LAN/macOS browser rendering the full UI through `http://<pi-ip>:4173/` cannot control Onboard on the Pi.

When Fcitx5 is installed, the kiosk session starts with English input and supports the repo-owned Onboard script path. Current layouts cycle `EN -> Chinese -> German -> Italian -> Korean -> Japanese -> ES -> EN` through `keyboard-us`, `pinyin`, `keyboard-de`, `keyboard-it`, `hangul`, `anthy`, and `keyboard-es`; Chinese and Japanese keep QWERTY labels for pinyin/romaji, German uses QWERTZ labels, Italian and Spanish show their visual key differences, and Korean shows 2-beolsik Hangul hints. Ctrl+Space remains a hardware-keyboard fallback. The launcher installs Tikpal's Onboard color scheme and generated Compact layout variants. The candidate window appears only while composing and uses the configured CJK font for the 720px physical display. If Fcitx5, the Tikpal Onboard script, or packaged layout assets are unavailable, Onboard falls back to the original Compact layout.

The launcher binds Onboard to the kiosk user's DBus session, turns on Onboard's Always on Top and Sticky window settings on every show, disables Onboard's key-press hide and inactive transparency, uses `XInput` pointer events with XTest key synthesis for browser login fields, and calls `Show` twice without xdotool-remapping the window so a stale X window cannot be mistaken for a drawn keyboard; Hide keeps the process resident. The window guard raises Onboard again only after it actually retitles provider or side-panel Chromium windows, closes duplicate provider windows, or starts a fresh guard pass; steady 250ms polling leaves the keyboard stack alone, so periodic provider recovery cannot push the keyboard behind Spotify or Google OAuth and cannot make it flicker. Onboard's status icon, floating palette, and Fcitx input-method switch notifications remain hidden. The right panel and Console have no manual Keyboard button. Provider Chromium also uses `--disable-hang-monitor`. Returning to Tikpal hides Onboard, gives provider and side-panel processes 200ms to exit normally, then force-terminates any remainder instead of waiting on a `Page Unresponsive` dialog or leaving the right panel over the kiosk.

The QQ helper features inside the guard are allowlisted for ordinary prompts only. They may click visible `确定`, `确认`, `取消`, `关闭`, `知道了`, `我知道了`, `好的`, `好`, `开始播放`, or `继续播放` buttons inside `y.qq.com` dialogs. Dialogs mentioning login, payment, purchase, authorization, privacy/agreement, VIP, recharge, or subscription must not be accepted automatically; only dismiss-style buttons such as `取消`, `关闭`, or `知道了` may be clicked in those contexts. A client promotion dialog is handled only when the same visible dialog contains both `打开客户端` and `下载客户端` and exposes an explicit close control. Tikpal remembers the user's last trusted `播放` or `播放全部` action, closes the dialog, and retries that action once after the close; if the dialog returns, Tikpal closes it without retrying again. It never clicks either client button. The `下载客户端体验更多内容` copy requires login and remains visible for user action; Tikpal does not auto-dismiss or click it. This lets Tikpal close QQ trial/VIP and client reminders without consenting to membership, purchase, authorization, account changes, downloads, or native-client launch. QQ links are retargeted into the existing left pane by rewriting `y.qq.com` `window.open` and `_blank` navigation, then hidden duplicate QQ player pages are closed if the site still opens more than one `y.qq.com/n/ryqq...` target. This prevents two web players from playing at once and avoids small non-fullscreen QQ windows. It is not a blind coordinate clicker.

Acceptance checks on the physical kiosk are: confirm Onboard starts hidden; focus QQ Music or Spotify search and a Console text setting and confirm it becomes fully drawn above Chromium; focus Link / Explore Proxy URL and confirm the input remains visible while Onboard is open; confirm English is initially active, tap the Tikpal IME key through EN, Chinese, German, Italian, Korean, Japanese, ES, and back to EN, type `zhongwen` in Pinyin, validate Korean Hangul composition, validate Anthy conversion in Japanese mode, and confirm German, Italian, and Spanish modes expose the expected visual key labels; blur or submit and confirm the keyboard and any candidate window hide within the provider guard's 250ms polling cadence; switch between text fields and confirm Onboard stays visible; click a checkbox or button and confirm it stays hidden; confirm there is no Onboard/Fcitx status icon and neither the Explore panel nor Console shows a manual Keyboard button. Trigger the existing QQ client dialog and confirm it closes with one bounded playback retry; trigger the `下载客户端体验更多内容` variant and confirm it remains visible for user login without any automatic click. Repeat the text-focus check from a Mac on `http://<pi-ip>:4173/` and confirm it cannot summon the Pi's Onboard window.

The Explore launcher keeps a separate Chromium profile for each provider so login state and accepted-cookie state can survive provider switches. Closing or switching providers kills only Chromium processes for that profile; it must not remove the profile directory under `.config/tikpal-web-mode/providers/<provider>`. It is not a Tikpal source: opening it pauses Tikpal playback, closes external renderer intakes through their `TIKPAL_*_DISABLE_COMMAND` hooks, and does not change `.tikpal/audio-source-memory.json`. While Explore is active, MPD Radio auto-advance, late-start nudges, and weak-network recovery stay suspended so a stale Radio stream cannot reclaim the shared audio output; normal recovery resumes after Explore closes. Provider switches to Spotify, YouTube Music, Apple Music, TIDAL, Qobuz, Deezer, Amazon Music, Suno, NetEase, or back to QQ Music must use the same external-source release, `xdotool` window detection, per-provider CDP, real URL, cookie-consent guard, and readiness checks before the side panel marks the provider `Active`. For 2560 x 720 validation, `xdotool search --onlyvisible --class chromium` should show the main kiosk window, one 1920 x 720 provider window at `0,0`, and one 640 x 720 side-panel window at `1920,0`; it should not show two visible provider windows after a site opens a playback page. If any provider reports `did not open` and only the right `/side-panel?opening=<provider>` window remains, make sure `xdotool` is installed, check `.tikpal/web-mode-settings.json` for `proxyEnabled`, confirm the provider CDP endpoint derived from `127.0.0.1:9234`, and verify `TIKPAL_BLUETOOTH_DISABLE_COMMAND` / `TIKPAL_AIRPLAY_DISABLE_COMMAND` are not empty before chasing Chromium.

If clicking a provider item, especially a Spotify song, leaves the right side panel active but the left side visually returns to the Tikpal main kiosk, do not treat it as a provider-load failure first. Check `xwininfo -root -tree` and `xdotool getwindowgeometry`: the provider CDP page may still be alive while its X window has fallen behind the full-screen kiosk or collapsed to Chromium's small placeholder window. The window guard must raise the provider and side panel without stealing focus, then retile the provider to `0,0 1920x720`.

While an Explore provider window is active, the main kiosk page may be hidden and its heartbeat can briefly look stale. The kiosk watchdog should not restart X or `tikpal-kiosk.service` for `page-unhealthy` in that state, because doing so kills the left provider window and stops web-player audio. Leave `TIKPAL_KIOSK_WATCHDOG_WEB_MODE_HEARTBEAT_BYPASS=1` enabled unless you are debugging the watchdog itself; X, Chromium-process, API, web URL, and GPU-reset checks still run. The bypass detects provider Chromium processes by their `--user-data-dir=.../providers/...` argument and includes the moOde user profile path, so it still works when the watchdog runs as root under systemd.

If the Pi should control real moOde playback instead of the local mock bridge, create `.env` with native MPD settings before restarting the API service:

```bash
cat > .env <<'EOF'
TIKPAL_PLAYER_BACKEND=mpc
TIKPAL_MPD_HOST=127.0.0.1
TIKPAL_MPD_PORT=6600
TIKPAL_MPC_BIN=mpc
TIKPAL_MPD_DEFAULT_QUEUE_PATH=Codex
TIKPAL_MPD_STARTUP_VOLUME=30
TIKPAL_MPD_RECOVERY_COMMAND="sudo systemctl kill -s SIGKILL mpd.service 2>/dev/null || true; sudo systemctl reset-failed mpd.service 2>/dev/null || true; sudo systemctl start mpd.service"
TIKPAL_MPD_RECOVERY_SETTLE_MS=2500
TIKPAL_STARTUP_SCENE_SOUND_ENABLED=1
TIKPAL_ALSA_LOOPBACK_ALLOW_HDMI=0
TIKPAL_OUTPUT_VOLUME_GET_COMMAND="./deploy/moode/tikpal-output-volume.sh get"
TIKPAL_OUTPUT_VOLUME_SET_COMMAND="./deploy/moode/tikpal-output-volume.sh set %VALUE%"
TIKPAL_OUTPUT_VOLUME_FALLBACK_MPC=1
TIKPAL_WEB_REMOTE_PORT=4174
TIKPAL_SCENE_CONTEXT_GEO_URL=https://ipapi.co/json/
TIKPAL_SCENE_CONTEXT_GEO_TIMEOUT_MS=3000
TIKPAL_SCENE_CONTEXT_GEO_CACHE_MS=3600000
TIKPAL_SCENE_CONTEXT_WEATHER_URL=https://api.open-meteo.com/v1/forecast
TIKPAL_SCENE_CONTEXT_WEATHER_TIMEOUT_MS=3000
TIKPAL_SCENE_CONTEXT_WEATHER_CACHE_MS=900000
TIKPAL_HIFI_EQ_APPLY_COMMAND=""
TIKPAL_HIFI_SPECTRUM_COMMAND="./deploy/moode/tikpal-hifi-spectrum-capture.sh"
TIKPAL_HIFI_SPECTRUM_DEVICE=""
TIKPAL_HIFI_SPECTRUM_CAPTURE_COMMAND=""
TIKPAL_HIFI_SPECTRUM_CACHE_MS=900
TIKPAL_HIFI_SPECTRUM_GAIN=12
TIKPAL_STATE_SNAPSHOT_REFRESH_MS=3000
TIKPAL_DDCUTIL_BIN=ddcutil
TIKPAL_DDCUTIL_DISPLAY=""
TIKPAL_DDCUTIL_READ_CACHE_MS=300000
TIKPAL_DDCUTIL_READ_TIMEOUT_MS=3500
TIKPAL_DDCUTIL_SUPPRESS_READ_WARNINGS=1
TIKPAL_DDCUTIL_SUPPRESS_SYSLOG=1
TIKPAL_SPOTIFY_READY_COMMAND="./deploy/moode/tikpal-spotify-ready.sh"
TIKPAL_SPOTIFY_ACTIVE_COMMAND="./deploy/moode/tikpal-spotify-active.sh"
TIKPAL_SPOTIFY_ACTIVATE_COMMAND="./deploy/moode/tikpal-spotify-enable.sh"
TIKPAL_SPOTIFY_DISABLE_COMMAND="./deploy/moode/tikpal-spotify-disable.sh"
TIKPAL_SPOTIFY_LABEL_COMMAND="./deploy/moode/tikpal-spotify-label.sh"
TIKPAL_SPOTIFY_ZEROCONF_PORT=9000
TIKPAL_BLUETOOTH_READY_COMMAND="[ \"$(sqlite3 /var/local/www/db/moode-sqlite3.db \"SELECT value FROM cfg_system WHERE param='btsvc'\")\" = \"1\" ]"
TIKPAL_BLUETOOTH_ACTIVE_COMMAND="[ \"$(sqlite3 /var/local/www/db/moode-sqlite3.db \"SELECT value FROM cfg_system WHERE param='btactive'\")\" = \"1\" ]"
TIKPAL_BLUETOOTH_DEVICE_NAME=Tikpal-Speaker-Bluetooth
TIKPAL_BLUETOOTH_ENABLE_COMMAND="./deploy/moode/tikpal-bluetooth-enable.sh"
TIKPAL_BLUETOOTH_DISABLE_COMMAND="moodeutl -Ro --bluetooth off"
TIKPAL_BLUETOOTH_LABEL_COMMAND="./deploy/moode/tikpal-bluetooth-label.sh"
TIKPAL_BLUETOOTH_LABEL_TIMEOUT_SECONDS=2
TIKPAL_BLUETOOTH_METADATA_COMMAND="./deploy/moode/tikpal-bluetooth-metadata.sh"
TIKPAL_BLUETOOTH_LYRICS_UNRELIABLE_DURATION_MS=90000
TIKPAL_BLUETOOTH_TRANSPORT_AVAILABLE_COMMAND="./deploy/moode/tikpal-bluetooth-transport.sh available"
TIKPAL_BLUETOOTH_PLAY_PAUSE_COMMAND="./deploy/moode/tikpal-bluetooth-transport.sh play-pause"
TIKPAL_BLUETOOTH_PLAY_COMMAND="./deploy/moode/tikpal-bluetooth-transport.sh play"
TIKPAL_BLUETOOTH_PAUSE_COMMAND="./deploy/moode/tikpal-bluetooth-transport.sh pause"
TIKPAL_BLUETOOTH_NEXT_COMMAND="./deploy/moode/tikpal-bluetooth-transport.sh next"
TIKPAL_BLUETOOTH_PREVIOUS_COMMAND="./deploy/moode/tikpal-bluetooth-transport.sh previous"
TIKPAL_BLUETOOTH_CAPTURE_COMMAND="./deploy/moode/tikpal-bluetooth-capture.sh"
TIKPAL_BLUETOOTH_CAPTURE_DURATION_SECONDS=10
TIKPAL_BLUETOOTH_RECOGNITION_SETTLE_MS=4000
TIKPAL_BLUETOOTH_RECOGNITION_RETRY_MS=45000
TIKPAL_BLUETOOTH_RECOGNITION_NOT_FOUND_RETRY_MS=30000
TIKPAL_AIRPLAY_READY_COMMAND="./deploy/moode/tikpal-airplay-state.sh ready"
TIKPAL_AIRPLAY_ACTIVE_COMMAND="./deploy/moode/tikpal-airplay-state.sh active"
TIKPAL_AIRPLAY_ENABLE_COMMAND="./deploy/moode/tikpal-airplay-enable.sh"
TIKPAL_AIRPLAY_DISABLE_COMMAND="moodeutl -Ro --airplay off"
TIKPAL_AIRPLAY_RECEIVER_ACTIVE_COMMAND="./deploy/moode/tikpal-airplay-state.sh receiver"
TIKPAL_AIRPLAY_SERVICE_NAME=Tikpal-Speaker-Airplay
TIKPAL_AIRPLAY_SERVICE_TYPE=classic
TIKPAL_AIRPLAY_LABEL_COMMAND="./deploy/moode/tikpal-airplay-label.sh"
TIKPAL_AIRPLAY_ALSA_OUTPUT_DEVICE=_audioout
TIKPAL_AIRPLAY_IGNORE_VOLUME_CONTROL=no
TIKPAL_AIRPLAY_DEFAULT_VOLUME_DB=0.0
TIKPAL_AIRPLAY_VOLUME_RANGE_DB=30
TIKPAL_AIRPLAY_VOLUME_CONTROL_PROFILE=flat
TIKPAL_AIRPLAY_METADATA_COMMAND="./deploy/moode/tikpal-airplay-metadata.sh"
TIKPAL_AIRPLAY_METADATA_PIPE=/tmp/shairport-sync-metadata
TIKPAL_AIRPLAY_TRANSPORT_AVAILABLE_COMMAND="./deploy/moode/tikpal-airplay-transport.sh available"
TIKPAL_AIRPLAY_PLAY_PAUSE_COMMAND="./deploy/moode/tikpal-airplay-transport.sh play-pause"
TIKPAL_AIRPLAY_PLAY_COMMAND="./deploy/moode/tikpal-airplay-transport.sh play"
TIKPAL_AIRPLAY_PAUSE_COMMAND="./deploy/moode/tikpal-airplay-transport.sh pause"
TIKPAL_AIRPLAY_NEXT_COMMAND="./deploy/moode/tikpal-airplay-transport.sh next"
TIKPAL_AIRPLAY_PREVIOUS_COMMAND="./deploy/moode/tikpal-airplay-transport.sh previous"
TIKPAL_AIRPLAY_METADATA_MAX_AGE_SECONDS=300
TIKPAL_AIRPLAY_ARTWORK_MAX_LAG_SECONDS=1
TIKPAL_AIRPLAY_METADATA_CLOCK_LEAD_MS=1000
TIKPAL_AIRPLAY_DIRECT_METADATA_REFRESH_MIN_MS=1000
TIKPAL_AIRPLAY_CAPTURE_COMMAND=""
TIKPAL_AIRPLAY_CAPTURE_DURATION_SECONDS=6
TIKPAL_AIRPLAY_RECOGNITION_SETTLE_MS=1000
TIKPAL_UPNP_READY_COMMAND="./deploy/moode/tikpal-upnp-ready.sh"
TIKPAL_UPNP_ACTIVE_COMMAND=""
TIKPAL_UPNP_CONFIGURE_COMMAND="./deploy/moode/tikpal-upnp-configure.sh"
TIKPAL_UPNP_FRIENDLY_NAME=""
TIKPAL_UPNP_AV_FRIENDLY_NAME=""
TIKPAL_UPNP_CHECK_CONTENT_FORMAT=0
TIKPAL_UPNP_ENABLE_COMMAND="./deploy/moode/tikpal-upnp-enable.sh"
TIKPAL_UPNP_DISABLE_COMMAND="./deploy/moode/tikpal-upnp-disable.sh"
TIKPAL_UPNP_LABEL_COMMAND="./deploy/moode/tikpal-upnp-label.sh"
TIKPAL_UPNP_METADATA_COMMAND="./deploy/moode/tikpal-upnp-metadata.sh"
TIKPAL_RECOGNITION_PROVIDER=acrcloud
TIKPAL_ACRCLOUD_HOST=identify-cn-north-1.acrcloud.com
TIKPAL_ACRCLOUD_ACCESS_KEY="YOUR_ACCESS_KEY"
TIKPAL_ACRCLOUD_ACCESS_SECRET="YOUR_ACCESS_SECRET"
TIKPAL_LYRICS_PROVIDER_CHAIN=lrclib,lyricsovh
TIKPAL_LRCLIB_BASE_URL=https://lrclib.net
TIKPAL_LYRICS_OVH_BASE_URL=https://api.lyrics.ovh
TIKPAL_LYRICS_CUSTOM_URL_TEMPLATE=""
TIKPAL_LYRICS_CUSTOM_AUTH_HEADER=""
TIKPAL_RADIO_ACTIVATE_COMMAND=""
TIKPAL_RADIO_DEFAULT_URI=""
TIKPAL_RADIO_LABEL="Last Station"
TIKPAL_RADIO_LOGO_DIR="/var/local/www/imagesw/radio-logos"
TIKPAL_RADIO_VOLUME_DEFAULT_PERCENT=35
TIKPAL_RADIO_AUTO_SKIP_VERIFY_WINDOW_MS=1500
TIKPAL_RADIO_AUTO_SKIP_POST_START_SETTLE_MS=500
TIKPAL_RADIO_AUTO_SKIP_RETRY_DELAYS_MS=""
TIKPAL_RADIO_LATE_PLAY_NUDGE_DELAYS_MS="1500,3000,5000,8000,12000,16000"
TIKPAL_KIOSK_AUDIO_RELEASE_COMMAND="./deploy/moode/tikpal-release-kiosk-audio.sh"
TIKPAL_KIOSK_AUDIO_RELEASE_SETTLE_MS=500
TIKPAL_SYSTEM_REBOOT_COMMAND="sudo -n systemctl --no-wall --no-block reboot"
TIKPAL_SYSTEM_SHUTDOWN_COMMAND="sudo -n systemctl --no-wall --no-block poweroff"
TIKPAL_DSP_PRESET=Unknown
TIKPAL_PORTABLE_API_KEY="CHANGE_ME_LONG_RANDOM_REMOTE_KEY"
EOF
```

`TIKPAL_MPD_DEFAULT_QUEUE_PATH=Codex` tells the backend which local library path to queue first when MPD is empty.
`TIKPAL_MPD_STARTUP_VOLUME=30` makes Tikpal set MPD to 30% before auto-resuming playback when the API starts and playback is not already running.
`TIKPAL_STARTUP_SCENE_SOUND_ENABLED=1` makes the Pi open Scene Sound as the default startup source for Focus, Calm, and Sleep room modes. The startup path writes `sceneSoundEnabled=true` when needed and switches to `target=scene`; choosing Library, Radio, Bluetooth, AirPlay, Spotify, or DLNA later still clears Scene Sound for that session.
`TIKPAL_AUDIO_SOURCE_MEMORY_STATE_PATH` defaults to `.tikpal/audio-source-memory.json` and stores the last visible source for Hi-Fi restore and Scene Sound exit. It records only `mpd`, `radio`, `spotify`, `bluetooth`, `airplay`, and `upnp`; internal `scene` and `audio` are ignored so startup Scene Sound and Scene Sound toggles do not erase the user's last Library track, Radio station, or external waiting source. When Scene Sound is turned off or Hi-Fi disables it, the backend restores this remembered source first and falls back to `mpd` only if that restore fails. `localTrackPath` is the last actual local Library song and is preserved while Radio or an external source is remembered, so returning to Library can resume that song before falling back to `TIKPAL_MPD_DEFAULT_QUEUE_PATH`. `radioStationId` is the last successful Radio station and is preserved while Library or an external source is remembered, so a bare Radio source switch can resume that station before falling back to the catalog/default route. After a resource OTA or full Library replacement, the backend validates the local path against the current manifest before reuse and refreshes memory to the new current song or clears it when no local song can be mapped; after Radio catalog changes, stale station ids are ignored and replaced by the final station that actually starts.
`TIKPAL_AUDIO_ADAPT_MODE=auto` makes the Pi repair the active USB audio route at startup. The adapter prefers `TIKPAL_AUDIO_CARD_PRIORITY=BT66,Crimson`, honors `TIKPAL_AUDIO_CARD_FORCE` when set, accepts one unknown non-HDMI USB card, and refuses to pick randomly when multiple unknown USB cards are present. It writes moOde's selected card, `_audioout`, and Tikpal's Loopback mirror before MPD/API/kiosk start. The systemd unit also performs a short Loopback preflight before running the adapter, so a reboot where `systemd-modules-load` claims `snd_aloop` but `/proc/asound/cards` still lacks `Loopback` fails early instead of letting AirPlay or MPD silently open a broken `_audioout`. Use `deploy/moode/tikpal-audio-adapt.sh check` to see the selected card, browser PCM, moOde PCM, mixer strategy, and Loopback visibility.
`TIKPAL_ALSA_LOOPBACK_ALLOW_HDMI=0` keeps Tikpal from re-enabling a stale moOde ALSA Loopback override when `_audioout` routes only to HDMI. Most Tikpal installs should select the USB speaker or USB amplifier in moOde first, then let `_audioout` follow that current output while mirroring to Loopback for AirPlay, Bluetooth, and Hi-Fi spectrum. Set this to `1` only for an intentional HDMI-output install. For Chromium Scene Sound and Explore, leave `TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE=auto` and `TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE=auto` so the launcher asks the audio adapter for the current card's safest browser PCM. BT66 can use `dmix:CARD=BT66,DEV=0`; SPL Crimson uses Tikpal's generated `tikpal_browser_output` shared PCM, which wraps `dmix` in `plug` so Chromium's common 16-bit output is converted to the card's required 24-bit format without letting the kiosk and Explore provider block each other.
`TIKPAL_KIOSK_AUDIO_RELEASE_COMMAND` is run only before MPD-backed sources (`mpd` and `radio`) start. The checked-in `deploy/moode/tikpal-release-kiosk-audio.sh` helper kills Chromium's `audio.mojom.AudioService` utility process with a safe process pattern, then the backend waits `TIKPAL_KIOSK_AUDIO_RELEASE_SETTLE_MS` before issuing `mpc clear/add/play`. If Radio later reports `_audioout: Device or resource busy`, the delayed Radio recovery path runs the same release command again before retrying `mpc play`. Use it on Pi installs where Scene Sound is browser audio and MPD Radio otherwise reports `_audioout: Device or resource busy`.
`TIKPAL_OUTPUT_VOLUME_GET_COMMAND` and `TIKPAL_OUTPUT_VOLUME_SET_COMMAND` should control the physical `_audioout` output, not only ALSA Loopback. On moOde installs with ALSA Loopback enabled, the checked-in `deploy/moode/tikpal-output-volume.sh` helper reads the current `/etc/alsa/conf.d/_sndaloop.conf` / `_audioout.conf` route, gets volume from the physical output, and mirrors writes to Loopback so renderer intakes and Hi-Fi spectrum use the same level. It tries `TIKPAL_OUTPUT_VOLUME_CONTROLS` (`PCM,Master,Digital,Speaker,Headphone,Line Out` by default); if the selected USB DAC exposes no writable ALSA mixer, such as SPL Crimson with `amixname=none`, the helper falls back to MPD's software mixer by default and returns an amixer-style `[NN%]` line that Tikpal can parse. Set `TIKPAL_OUTPUT_VOLUME_FALLBACK_MPC=0` only when this fallback is intentionally unwanted. Avoid bare `amixer get PCM` on these installs because it can hit the Loopback card while the USB output remains at 100%.
`TIKPAL_SYSTEM_REBOOT_COMMAND` and `TIKPAL_SYSTEM_SHUTDOWN_COMMAND` run in the background after the confirmed Console tap, so Settings does not wait on systemd while services and child processes stop.
`TIKPAL_WEB_PORT=4173` is the full kiosk surface for both the Pi browser and trusted LAN browsers, while `TIKPAL_WEB_REMOTE_PORT=4174` always injects the portable remote UI and keeps its proxy limited to `/api/v1/remote/*`. The LAN kiosk surface intentionally blocks remote reads and writes to `/api/v1/kiosk/heartbeat`, so a macOS recording page cannot make the watchdog mistake a frozen physical kiosk for a healthy one. Because `4173` exposes the kiosk's full control API, keep it on a trusted LAN or enforce the same boundary at the network/firewall layer; do not publish it directly to the internet.
`TIKPAL_SCENE_CONTEXT_GEO_*` and `TIKPAL_SCENE_CONTEXT_WEATHER_*` control the cached `/api/v1/scene/context` lookups used for weak Ambient clock copy. The endpoint prefers IP-derived timezone/location when available, falls back to the caller's `timeZone` query or the room-experience default when unavailable, and caches provider failures briefly so a slow network cannot stall normal state reads.
Kiosk display diagnostics are separate from `4173`: `TIKPAL_KIOSK_REMOTE_DEBUG=1` exposes Chromium DevTools on `TIKPAL_KIOSK_REMOTE_DEBUG_ADDRESS:TIKPAL_KIOSK_REMOTE_DEBUG_PORT`, proxying to Chromium's local `TIKPAL_KIOSK_REMOTE_DEBUG_CHROMIUM_ADDRESS:TIKPAL_KIOSK_REMOTE_DEBUG_CHROMIUM_PORT`, and `TIKPAL_KIOSK_VIEWER=novnc` exposes the full kiosk screen through noVNC on `TIKPAL_KIOSK_NOVNC_ADDRESS:TIKPAL_KIOSK_NOVNC_PORT`. Keep `TIKPAL_KIOSK_REMOTE_DEBUG=0` for normal use and enable it only while actively debugging; DevTools can inspect and control the kiosk browser.
`TIKPAL_KIOSK_DISPLAY_MODE=auto` starts a physical `startx` session when a DRM display is connected, or when `ddcutil detect --brief` can see a local monitor even though KMS reports HDMI as disconnected, and falls back to `Xvfb` when the Pi is headless. Set `TIKPAL_KIOSK_LOCAL_SCREEN=1` or `0` only for devices where detection is wrong and you need to force the auto decision without changing the broader display mode.
`TIKPAL_HIFI_EQ_APPLY_COMMAND` enables real Hi-Fi EQ preset control in `mpc` mode. Until this is set, `set_hifi_eq` is intentionally rejected on the Pi instead of pretending the DSP changed. The command receives `%PRESET%`, `%LABEL%`, and `%VISUAL%` placeholders, so a future Pi hook can map `flat`, `warm`, and `vocal` to local CamillaDSP configs. A CamillaDSP-based hook may use the official WebSocket control path, where `SetConfigName` selects a config and `Reload` applies it: [CamillaDSP WebSocket docs](https://www.camilladsp.com/docs/camilladsp/1.0.1/websocket/).
`TIKPAL_HIFI_SPECTRUM_COMMAND` enables real Hi-Fi spectrum sampling for the `/api/v1/audio/spectrum` backend contract. The checked-in `deploy/moode/tikpal-hifi-spectrum-capture.sh` helper captures a short PCM window from a readable ALSA device, calculates 32 normalized spectrum bands plus normalized `peaks.left` / `peaks.right`, and returns JSON for any future meter surface that consumes that endpoint. The helper first honors `TIKPAL_HIFI_SPECTRUM_CAPTURE_COMMAND` when a custom Pi pipeline is needed; otherwise it tries `TIKPAL_HIFI_SPECTRUM_DEVICE` / `TIKPAL_HIFI_SPECTRUM_DEVICES` and then common ALSA loopback devices such as `plughw:Loopback,1,0`. `TIKPAL_HIFI_SPECTRUM_CACHE_MS` keeps the API from launching overlapping analyzer commands, and `TIKPAL_HIFI_SPECTRUM_GAIN` raises low Loopback PCM levels without substituting mock data. In `mpc` mode Tikpal rejects the spectrum endpoint when this command is unset, so the Pi does not silently show mock EQ data. Validate the device path with `./deploy/moode/tikpal-hifi-spectrum-capture.sh | jq .` before restarting `tikpal-api.service`.
`TIKPAL_STATE_SNAPSHOT_REFRESH_MS` controls the background runtime snapshot collector. In `mpc` mode, read APIs such as `/api/v1/system/state`, `/api/v1/playback/status`, `/api/v1/system/status`, `/api/v1/audio/sources`, and the portable remote state return the latest in-memory snapshot instead of running `systemctl`, `ddcutil`, metadata, or source-status probes in the request path. Keep the interval low enough that status cards feel fresh, but high enough that slow Pi probes cannot pile up; `3000` ms is the current default.
`TIKPAL_DDCUTIL_BIN` and optional `TIKPAL_DDCUTIL_DISPLAY` control the ambient left-edge brightness gesture path when the display exposes DDC/CI VCP `0x10`. `TIKPAL_DDCUTIL_READ_CACHE_MS` keeps status polling from blocking the kiosk on frequent I2C reads, `TIKPAL_DDCUTIL_SUPPRESS_READ_WARNINGS=1` keeps repeated ddcutil stderr warnings out of normal service logs, `TIKPAL_DDCUTIL_SUPPRESS_SYSLOG=1` adds `--syslog=NEVER` for ddcutil versions that otherwise log every probe to journald, and brightness writes still apply immediately.
`TIKPAL_PORTABLE_API_KEY` protects portable-controller writes through `POST /api/v1/remote/actions`. Keep `tikpal-api.service` bound to `127.0.0.1` and let portable controllers enter through the production web service at `http://<pi>:4174/api/v1/remote/*`; the `4174` proxy blocks clients from calling the full internal kiosk API. The same key must be present in both the API service environment and the web service environment: the API validates direct keyed actions, while the web proxy injects that key for LAN remote UI actions. If `/api/v1/remote/state` works but `/api/v1/remote/actions` returns `TIKPAL_PORTABLE_API_KEY is not configured on this device`, check both systemd env files before debugging React.
`TIKPAL_SPOTIFY_*` lets the Pi expose Spotify Connect as a truthful ready/active handoff target without using Spotify Web API. On moOde, use `deploy/moode/tikpal-spotify-enable.sh` for activate, `moodeutl -Ro --spotify off` for disable, `deploy/moode/tikpal-spotify-ready.sh` for renderer readiness, and `deploy/moode/tikpal-spotify-active.sh` for active session probing. The enable helper is idempotent when librespot is already listening, clears stale `spotactive` / `spotmeta.json` only before a real open, and forces moOde Spotify Connect to a fixed zeroconf port (`TIKPAL_SPOTIFY_ZEROCONF_PORT`, default `9000`), so phones do not cache a dead random port after renderer restarts. The active helper requires a real librespot `activeUser`, so a stale moOde `spotactive=1` cannot make Tikpal display a fake connected state. This matters for Scene Sound because a running `librespot --device _audioout` process can keep the USB output busy after the user has switched back to `scene`.
`TIKPAL_BLUETOOTH_*`, `TIKPAL_AIRPLAY_*`, and `TIKPAL_UPNP_*` let Tikpal enforce the armed-only source gate against moOde's renderer services. On moOde, the checked-in `deploy/moode/tikpal-bluetooth-enable.sh` script is the preferred Bluetooth enable path because it both enables the renderer, writes the advertised name from `TIKPAL_BLUETOOTH_DEVICE_NAME` into moOde's `btname`, updates the BlueZ pretty hostname used by the hostname plugin, starts `bluetooth.service` / `bt-agent.service` / `bluealsa.service`, and re-arms the controller to `system-alias`, `power on`, `discoverable on`, and `pairable on`. `deploy/moode/tikpal-airplay-enable.sh` is the preferred AirPlay enable path because it enables the renderer, accepts an already-running moOde Shairport receiver on TCP 7000, and only starts `shairport-sync.service` when no receiver is already listening. `deploy/moode/tikpal-bluetooth-label.sh` reads the current broadcast name from `bluetoothctl show` so the frontend can tell the user what name to search for on their phone; `TIKPAL_BLUETOOTH_LABEL_TIMEOUT_SECONDS` keeps a stuck BlueZ client from accumulating orphaned `bluetoothctl` processes during frequent runtime polling. `deploy/moode/tikpal-upnp-ready.sh`, `deploy/moode/tikpal-upnp-enable.sh`, `deploy/moode/tikpal-upnp-disable.sh`, `deploy/moode/tikpal-upnp-label.sh`, and `deploy/moode/tikpal-upnp-metadata.sh` are the default moOde DLNA hooks over `upmpdcli.service`; keep `TIKPAL_UPNP_ACTIVE_COMMAND` empty unless the install has a reliable real-client probe, because service-running alone must not be reported as a connected DLNA sender. Tikpal treats DLNA as casting intake, not media-server browsing. DLNA is MPD-backed on moOde: selecting it first stops the old MPD/Radio stream, then opens `upmpdcli`, and later DLNA playback is read back from MPD plus `TIKPAL_UPNP_METADATA_COMMAND`. A renderer that is merely `Ready` / `armed` must not replace a still-playing Radio or Library source; only a real connected probe or MPD playback that appears after the DLNA release step should become current `upnp` playback. For all four external intake surfaces, `*_READY_COMMAND` means the receiver can be opened, `*_ACTIVE_COMMAND` means a real client is connected, and the UI keeps Ambient, Player, and Remote consistent by showing `armed` as waiting until `connected` is true. External-to-external switches use a target-first gate: Tikpal waits only for the requested Spotify / Bluetooth / AirPlay / DLNA intake to open, returns that source as current, then closes non-target external receivers in a single background cleanup queue. Cleanup checks the latest target before each disable so a quick user reversal does not turn off the source they just selected. Re-selecting an external source that is already current and either `armed` or `connected` is intentionally a no-op for its receiver: Tikpal may release MPD, but it must not reopen AirPlay / Bluetooth / Spotify / DLNA and interrupt the sender during room-mode changes such as Focus to Hi-Fi. When switching from MPD-backed playback to Spotify / Bluetooth / AirPlay, Tikpal stops MPD after opening the renderer; for DLNA it stops MPD before opening `upmpdcli` so it cannot stop a phone's freshly submitted DLNA queue. If `mpc stop` times out because MPD is wedged while holding `_audioout`, it runs `TIKPAL_MPD_RECOVERY_COMMAND` once and retries the stop so external renderers can actually reach the physical output. Switching to local Library, Radio, or MPD remains synchronous about closing external receivers because those modes must reliably reclaim `_audioout`. Switching away from AirPlay must close both the moOde AirPlay renderer and the `shairport-sync.service` receiver, then clear the receiver unit's failed marker; otherwise AirPlay can stay sticky and block later handoff. `moodeutl -Ro --bluetooth off` and `moodeutl -Ro --airplay off` remain the practical disable commands, while `cfg_system` values `btsvc`, `btactive`, `airplaysvc`, and `aplactive` plus `TIKPAL_AIRPLAY_RECEIVER_ACTIVE_COMMAND` keep the UI honest about whether AirPlay is really up.

On a fresh moOde image, the AirPlay enable helper also repairs the Shairport Sync configuration that metadata truth depends on: `_audioout`, `run_this_before_entering_active_state`, `run_this_after_exiting_active_state`, `wait_for_completion`, and `cover_art_cache_directory`. The hooks keep `aplactive` aligned with the sender session, while the cache directory keeps MPRIS artwork under `/var/local/www/imagesw/airplay-covers` with `shairport-sync:shairport-sync` ownership for `/api/v1/media/airplay-artwork`.

Run `deploy/moode/tikpal-upnp-configure.sh` during moOde deployment or when DLNA discovery looks stale. It writes the renderer-facing `friendlyname`, the UPnP/AV-specific `avfriendlyname` (`<hostname> UPNP-UPnP/AV` by default), `upnpav=1`, `openhome=0`, and `checkcontentformat=0`, then restarts `upmpdcli.service` and `avahi-daemon.service`. Keep this out of the normal source-switch hot path because restarting `upmpdcli` interrupts active senders. For discovery debugging, compare the phone-visible name with the actual SSDP `LOCATION` instead of assuming the first Tikpal-looking device is the current Pi:

```bash
deploy/moode/tikpal-upnp-configure.sh
python3 - <<'PY'
import socket
msg = "\r\n".join([
    "M-SEARCH * HTTP/1.1",
    "HOST: 239.255.255.250:1900",
    "MAN: \"ssdp:discover\"",
    "MX: 1",
    "ST: urn:schemas-upnp-org:device:MediaRenderer:1",
    "", ""
]).encode()
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
s.settimeout(2)
s.sendto(msg, ("239.255.255.250", 1900))
while True:
    try:
        data, addr = s.recvfrom(8192)
    except Exception:
        break
    text = data.decode("utf-8", "replace")
    if "Tikpal" in text or "MediaRenderer" in text:
        print(addr)
        print("\n".join(line for line in text.splitlines() if line.lower().startswith(("location:", "st:", "usn:", "server:"))))
PY
sudo timeout 20 tcpdump -ni wlan0 -s 0 -A 'udp port 1900 or tcp port 49152'
```

If the phone lists `Tikpal-Gentoo UPNP-UPnP/AV`, that is the renderer at `192.168.10.117` in the current lab network, not the target `192.168.10.246` Pi. The target Pi's self-test should return a `LOCATION` under its own address and a description whose `friendlyName` matches the phone list. If the Pi emits `ssdp:alive` but the phone never sends `M-SEARCH` to the Pi and never fetches the Pi's `description.xml`, fix the Wi-Fi multicast / AP isolation / cached device-list problem before changing Tikpal state logic. If the phone reaches `SetAVTransportURI` but upmpdcli logs empty `uri` or empty `protocolInfo`, the sender has provided metadata without a playable stream.

Explore's provider guard requires the Chrome DevTools Protocol WebSocket client. The supported Debian Node.js 20 runtime must launch it through `node --experimental-websocket`; `deploy/chromium/tikpal-web-mode.sh` does this automatically. Provider input clicks/focus show Onboard, while its own close key, page-background taps, blur, submit, and single-line Enter may hide it without a 250 ms focus poll immediately reopening it. Re-clicking the same input is a new interaction and shows it again. When Explore takes audio ownership, local MPD files are paused, HTTP Radio streams are stopped, and Bluetooth / AirPlay / Spotify / DLNA intakes must be closed so a provider such as QQ Music cannot play over an existing sender. On moOde this depends on non-empty disable hooks such as `TIKPAL_BLUETOOTH_DISABLE_COMMAND="moodeutl -Ro --bluetooth off"` and `TIKPAL_AIRPLAY_DISABLE_COMMAND="moodeutl -Ro --airplay off"`. Keep `TIKPAL_OUTPUT_VOLUME_GET_COMMAND` and `TIKPAL_OUTPUT_VOLUME_SET_COMMAND` configured: while Explore is active the side-panel slider intentionally uses this output path, not MPD's software mixer, and the returned state should echo the applied output percentage.
`TIKPAL_BLUETOOTH_METADATA_COMMAND` points to the BlueZ / AVRCP metadata probe. Tikpal uses this first when Bluetooth is connected, so phones that expose title / artist metadata can resolve lyrics through LRCLIB without audio fingerprint credentials. When BlueZ also exposes `Position` and `Duration`, Tikpal maps those into playback progress so synced LRCLIB lyrics can follow Bluetooth playback timing instead of falling back to a fixed text rotation. Some Android apps expose a placeholder `Duration=60000` for full songs; durations at or below `TIKPAL_BLUETOOTH_LYRICS_UNRELIABLE_DURATION_MS` are treated like AirPlay's weak timing guidance and are left out of the lyrics identity key so LRCLIB provider timing can keep the lyrics wall synced. The title / artist matcher preserves Unicode letters and numbers, so Chinese song and artist names from BlueZ metadata must not collapse to empty lookup keys.
`TIKPAL_BLUETOOTH_TRANSPORT_AVAILABLE_COMMAND`, `TIKPAL_BLUETOOTH_PLAY_PAUSE_COMMAND`, `TIKPAL_BLUETOOTH_PLAY_COMMAND`, `TIKPAL_BLUETOOTH_PAUSE_COMMAND`, `TIKPAL_BLUETOOTH_NEXT_COMMAND`, and `TIKPAL_BLUETOOTH_PREVIOUS_COMMAND` route Tikpal transport buttons to the current Bluetooth sender through BlueZ AVRCP `org.bluez.MediaPlayer1`. The checked-in `deploy/moode/tikpal-bluetooth-transport.sh` helper enables buttons only when BlueZ exposes a player path, then calls `PlayPause`, `Play`, `Pause`, `Next`, or `Previous`. Phone and app support varies; if no BlueZ player exists or the sender rejects a method, Tikpal disables or fails the action with a clear reason instead of pretending the queue changed.
`TIKPAL_AIRPLAY_METADATA_COMMAND` points to moOde's AirPlay metadata bridge. The checked-in `deploy/moode/tikpal-airplay-metadata.sh` treats Shairport Sync MPRIS as the current playback truth on moOde 5, then uses fresh `/var/local/www/aplmeta.json` or legacy `/var/local/www/aplmeta.txt` only to fill missing fields and provide weak progress for the same title / artist. MPRIS artwork file mtimes are never playback-clock truth, because a whole album can reuse one cover file while tracks keep changing. It emits title / artist / album / artwork fields plus `metadataSource`, `positionTrusted`, and `positionConfidence` diagnostics that Tikpal can use for playback truth and lyrics lookup. Tikpal uses AirPlay metadata for now-playing and lyrics only when the AirPlay source is `connected`; `armed` remains a waiting state. Metadata that is clearly stale, such as non-MPRIS playback position far beyond the reported duration, is ignored so Hi-Fi does not show old lyrics or old artwork while AirPlay is only waiting. Live MPRIS metadata is handled more gently: if Shairport reports `Playing` and trusted title / artist but the inferred position has drifted far past duration, Tikpal keeps the current song visible but drops the elapsed time so synced lyrics degrade to a static wall instead of highlighting the wrong line. When MPRIS `Position > 0`, helper output should mark `positionTrusted=true` and `positionConfidence=trusted`; when Shairport reports `Position=0`, the helper may emit a pause-aware `positionConfidence=estimated` clock so provider-synced lyrics can follow playback without counting paused time. AirPlay lyrics should be fast but strict about identity: metadata lookup must not return `ready` lyrics when the provider chain only finds the same title from a different artist. `TIKPAL_LYRICS_PROVIDER_CHAIN` defaults to `lrclib,lyricsovh`; `lyrics.ovh` is plain-lyrics fallback only and never performs title-only lookup. Plain lyrics without provider timestamps stay static across Library, Radio, Bluetooth, and AirPlay instead of receiving estimated line timing. Put `custom` in the chain and set `TIKPAL_LYRICS_CUSTOM_URL_TEMPLATE` plus optional `TIKPAL_LYRICS_CUSTOM_AUTH_HEADER` when a higher-coverage authorized lyrics source is available. AirPlay duration is treated as timing guidance instead of an identity gate because some Shairport/MPRIS sessions report unreliable durations; short MPRIS durations around 30 seconds are ignored for the lyrics cache key and exact provider query, and once title and artist are trusted Tikpal may prefer provider duration for lyric line timing. `TIKPAL_AIRPLAY_DIRECT_METADATA_REFRESH_MIN_MS=1000` keeps connected AirPlay metadata fresh without returning to per-request heavy polling. `TIKPAL_AIRPLAY_METADATA_CLOCK_LEAD_MS` compensates for moOde's metadata write delay when Tikpal has to infer AirPlay progress from metadata mtime; that inferred `positionMs` is usable only with provider-synced lyrics when `positionConfidence=estimated`. `TIKPAL_AIRPLAY_ARTWORK_MAX_LAG_SECONDS` prevents stale non-MPRIS cover files from being paired with a newer title. `TIKPAL_AIRPLAY_ALSA_OUTPUT_DEVICE` defaults AirPlay to moOde's `_audioout` chain, so Shairport Sync reaches the physical output while the Loopback mirror remains available for the real Hi-Fi spectrum meter. `TIKPAL_AIRPLAY_IGNORE_VOLUME_CONTROL=no` keeps iPhone AirPlay volume control enabled; set it to `yes` only for a diagnostic run where Tikpal must ignore a sender volume stuck near zero. `TIKPAL_AIRPLAY_DEFAULT_VOLUME_DB=0.0` keeps a newly reset receiver from starting at Shairport's quiet default while still allowing the phone to lower the session volume after connection. `TIKPAL_AIRPLAY_VOLUME_RANGE_DB=30` and `TIKPAL_AIRPLAY_VOLUME_CONTROL_PROFILE=flat` keep the sender volume control usable without making mid-phone-volume AirPlay sessions nearly silent after reboot.

Some AirPlay senders, especially while a lyrics view is active on the phone, may report the current lyric line in `title` while putting the stable identity in `artist` as `Track title — Artist`. Tikpal normalizes that AirPlay-only shape before playback and lyrics lookup, so the Hi-Fi screen enters the lyrics wall for the real track instead of showing a centered now-playing title like a lyric line.
`TIKPAL_AIRPLAY_TRANSPORT_AVAILABLE_COMMAND`, `TIKPAL_AIRPLAY_PLAY_PAUSE_COMMAND`, `TIKPAL_AIRPLAY_PLAY_COMMAND`, `TIKPAL_AIRPLAY_PAUSE_COMMAND`, `TIKPAL_AIRPLAY_NEXT_COMMAND`, and `TIKPAL_AIRPLAY_PREVIOUS_COMMAND` route Tikpal transport buttons to the AirPlay sender while AirPlay is the current source. The checked-in `deploy/moode/tikpal-airplay-transport.sh` helper probes Shairport Sync's native D-Bus `org.gnome.ShairportSync.RemoteControl.Available` property before calling `PlayPause`, `Play`, `Pause`, `Next`, or `Previous`. Some AirPlay 2 senders expose metadata but no DACP remote-control channel; in that case Tikpal disables previous / play-pause / next instead of returning a fake-success action that cannot change the sender's queue.
`TIKPAL_UPNP_METADATA_COMMAND` points to moOde's DLNA metadata bridge. The checked-in `deploy/moode/tikpal-upnp-metadata.sh` reads fresh upmpdcli / UPnP metadata files such as `/var/local/www/upnpmeta.json` or `/var/local/www/upnpmeta.txt`, then falls back to recent `upmpdcli.service` journal DIDL metadata for senders such as QQ Music / QPlay that only log metadata. It must not infer a DLNA track from generic `mpc current`, because an armed DLNA renderer can coexist with an old Radio or Library stream that is still the real playback. The helper emits title / artist / album / sender artwork URL / elapsed / duration plus `metadataSource=upmpdcli`, `positionTrusted`, and `positionConfidence` when the UPnP metadata provides them. When the journal line is an `unsupported format` / empty-`protocolInfo` rejection, it also emits `metadataOnly=true` and `streamAvailable=false`; Tikpal may use that metadata for diagnostics but must not mark DLNA `connected` or `playing` until MPD has a real current URI or the helper explicitly reports `streamAvailable=true`. Tikpal then reuses the same artwork and LRCLIB lyrics path as AirPlay and Bluetooth: sender artwork wins, remote album-art lookup is a fallback, and generated SVG covers are only used when no real artwork exists. Synced lyrics can highlight on the Hi-Fi lyrics wall only when DLNA playback has a real elapsed clock; if the sender exposes a title but no clock, Tikpal may show ready lyrics statically rather than estimating the wrong active line. If the phone says it is connected but the screen still says Radio, verify `mpc status` and `./deploy/moode/tikpal-upnp-metadata.sh`: old Radio playback means MPD was not released for DLNA, while a new MPD current file after selecting DLNA plus fresh UPnP metadata should promote the current source to `upnp`.
`TIKPAL_BLUETOOTH_CAPTURE_COMMAND` points to the local PCM capture script used for Bluetooth fingerprint recognition when Bluetooth metadata is unavailable. The checked-in `deploy/moode/tikpal-bluetooth-capture.sh` first tries `ffmpeg` against the connected BlueALSA device and then falls back to `arecord`; if moOde exposes a different ALSA capture path, override `TIKPAL_BLUETOOTH_CAPTURE_DEVICE` in the service environment before restarting `tikpal-api.service`.
`TIKPAL_RECOGNITION_PROVIDER=acrcloud` plus the `TIKPAL_ACRCLOUD_*` credentials enable the online fingerprint fallback. Tikpal waits `TIKPAL_BLUETOOTH_RECOGNITION_SETTLE_MS` after the Bluetooth connection becomes active, captures `TIKPAL_BLUETOOTH_CAPTURE_DURATION_SECONDS` seconds of audio, sends it to ACRCloud, and then reuses the same LRCLIB lyrics path once a track is identified. AirPlay should normally resolve from metadata; if `TIKPAL_AIRPLAY_CAPTURE_COMMAND` is configured as a fallback, it uses its own faster `TIKPAL_AIRPLAY_RECOGNITION_SETTLE_MS` and `TIKPAL_AIRPLAY_CAPTURE_DURATION_SECONDS` values so Bluetooth recognition stability is not changed. When AirPlay capture is unset, Tikpal reports metadata unavailable instead of staying in a long fingerprint-recognition state. `TIKPAL_BLUETOOTH_RECOGNITION_NOT_FOUND_RETRY_MS` keeps the receiver trying again when the first sample catches silence or a transition instead of permanently pinning Ambient to "not found".
moOde `cfg_radio` presets are still the Radio source list, and `POST /api/v1/audio/source` can switch directly by `radioStationId`. A bare Radio source switch restores `.tikpal/audio-source-memory.json`'s last valid `radioStationId` before falling back to the catalog/default route. Tikpal installs a curated 500+ preset range with `deploy/moode/tikpal-radio-presets-sync.sh`, then defaults `/api/v1/audio/radios` to the single-layer categories `Focus`, `Calm`, `Sleep`, `Jazz`, `Classical`, `News`, `Hi-Fi`, `Blues`, `Rock`, `World`, `Electronic`, and `Podcast`, plus a final `Random` tab that samples three real curated stations without auto-playing. The curated set intentionally stays small: each real category carries three stations, while Random keeps the sampled station's real category for display and Radio next/previous behavior. The Player no longer exposes search, Tikpal/moOde scope, genre, or bitrate controls. `scope=all` remains available for older clients that need the full moOde catalog. Active Radio summaries expose `audio.currentSource.radioStationId` so Hi-Fi can restore the exact remembered station.
`TIKPAL_RADIO_LOGO_DIR` points at moOde's local station-logo folder. `/api/v1/media/radio-logo?stationId=radio-<id>` serves only known station ids, first by exact station-name logo file and then by the repo-owned alias map for curated station names. Radio logo responses are cacheable for a day so Player / Hi-Fi cover switches can reuse decoded station artwork instead of reloading the same local file on every station change. Radio playback uses this official logo URL as `playback.albumArtUrl` when available; generated cover art remains only the fallback when the local logo is missing or fails to load.
Radio uses MPD's software mixer. If `mpc status` shows `volume: 0%`, Tikpal restores the last nonzero MPD volume recorded in `.tikpal/audio-volume-state.json` before starting Radio. If that state does not exist yet, it falls back to the current room-mode volume and then to `TIKPAL_RADIO_VOLUME_DEFAULT_PERCENT`. While Radio is active, playback `next` and `previous` select adjacent station ids inside the current category through the API instead of asking MPD to advance a one-item stream queue. If a stream has already failed and `mpc current` is empty, Tikpal keeps the failed URL from `mpc status` as the active Radio context; if the next candidate station also fails to start, it keeps walking the curated category before surfacing an error. When MPD reports a clear stream failure such as `Failed to decode` or connection timeout, Tikpal treats that station as unreachable, auto-advances to the next station from the late-check timer, and refreshes the cached state so the UI label follows the new station. While Radio is already playing, Tikpal also watches recent MPD log lines for repeated `Decoder is too slow` / xrun stalls; a short burst is tolerated as weak-network buffering grace, but repeated stalls inside the window auto-advance to the next station and remember the recovered station. If `mpc` itself times out while Radio is starting, `TIKPAL_MPD_RECOVERY_COMMAND` lets Tikpal hard-recover MPD once and retry before it skips or reports failure. `TIKPAL_RADIO_AUTO_SKIP_*` controls the shorter verification window used while skipping bad candidates; keep it shorter than the normal Radio start window so dead presets do not feel sticky. `TIKPAL_RADIO_XRUN_GRACE_MS`, `TIKPAL_RADIO_XRUN_WINDOW_MS`, and `TIKPAL_RADIO_XRUN_SKIP_THRESHOLD` control the weak-network stall window. Larger MPD buffers such as `audio_buffer_size` or `buffer_before_play` can smooth short network jitter, but if the Pi's sustained stream throughput is lower than the station bitrate, Tikpal should skip or choose a lower-bitrate station instead of buffering forever. The Radio catalog should mark the selected station `active:true`, and fast playback or volume refreshes should keep the selected station label instead of falling back to the generic `TIKPAL_RADIO_LABEL`. `TIKPAL_MPD_STARTUP_VOLUME` still applies only to startup priming, and `TIKPAL_RADIO_DEFAULT_URI` stays as a fallback preset when moOde radio rows are unavailable.
If `mpc update` is not the right library refresh command on the device, also set `TIKPAL_LIBRARY_SCAN_COMMAND`.

For Local and removable USB music, use `deploy/moode/tikpal-library-sync.sh` as the Pi library scan hook. The combined helper first mirrors repo-owned Local music from `public/assets/music` into a real MPD directory at `TIKPAL_MPD_DEFAULT_QUEUE_PATH` / `TIKPAL_LOCAL_LIBRARY_MPD_PREFIX` (default `Codex`), then runs the USB helper. Do not leave `Codex` as a symlink into `/home/moode/code/tikpal/public/assets/music`: moOde MPD may run without permission to traverse `/home/moode`, so the API can show manifest tracks while MPD returns `No such directory` or `Permission denied` when a Local track is tapped. `tikpal-local-library-sync.sh` replaces an old `Codex` symlink with a real directory, copies the music package with `rsync --delete`, excludes Apple `._*` resource-fork files, fixes MPD-readable ownership, and refreshes `mpc update Codex`.

The USB helper discovers mounted directories under `TIKPAL_USB_LIBRARY_AUTO_ROOTS` (default `/media,/run/media`) and maps each non-system partition into MPD as `TIKPAL_USB_LIBRARY_MPD_PREFIX/<mount name>` (default `USB/<mount name>`). It deliberately does not require the disk label or top-level folder to be `Music`: `/media/JazzDisk/song.flac`, `/media/Untitled/Album/track.m4a`, and similar mounts all become playable library paths such as `USB/JazzDisk/song.flac`. This is not a media copy step: USB tracks stay on the removable disk, and Tikpal only creates MPD-visible links under `/var/lib/mpd/music/USB` before running `mpc update USB`. The helper skips `boot`, `bootfs`, `root`, and `rootfs` partitions so a flashed OS disk mounted beside the music partition does not leak system sounds into the USB tab. If an older deployment has `/var/lib/mpd/music/USB` as a symlink to `/media`, the helper replaces it with a real directory before linking only the active removable roots. When a deployment needs a custom mount point, set `TIKPAL_USB_LIBRARY_ROOTS` to a comma-separated list of explicit directories; otherwise leave it empty so only currently mounted removable roots are scanned. Player Library, Settings Library cards, and portable summaries should all read `/api/v1/audio/library.storages` for Local/NAS/USB counts; `/api/v1/system/state.library` is only a coarse system summary and must not be used as USB readiness truth.

Tikpal can detect USB audio files from the mounted filesystem before MPD has refreshed its own database. Keep `TIKPAL_USB_LIBRARY_AUTO_UPDATE=0` for kiosk stability: browsing the USB tab should show filesystem-discovered tracks, but it should not run `mpc update USB` in the background while the user is seeking or playing Local music. Use Settings -> Library -> Scan library when MPD needs a real index refresh. Tapping a USB track still performs one explicit USB refresh and retry before surfacing `Local library track is not available in MPD`. This keeps the UI behavior close to direct USB playback while respecting MPD's local-file access rules; on moOde, `mpc` over TCP cannot add arbitrary `/media/...` or `file:///media/...` paths unless they are inside MPD's configured music directory. The combined `tikpal-library-sync.sh` still runs Local and USB maintenance, but USB is not skipped just because Local sync fails, and each `mpc update` is time-bound by `TIKPAL_MPC_UPDATE_TIMEOUT_SECONDS`. The systemd installer installs `tikpal-library-sync.service` before `tikpal-api.service` and upgrades an empty or old USB-only `TIKPAL_LIBRARY_SCAN_COMMAND` to the combined helper. The recommended moOde Pi hook is:

```bash
TIKPAL_LIBRARY_SCAN_COMMAND=/home/moode/code/tikpal/deploy/moode/tikpal-library-sync.sh
TIKPAL_LOCAL_LIBRARY_SOURCE_ROOT=
TIKPAL_LOCAL_LIBRARY_MPD_PREFIX=Codex
TIKPAL_MPD_LIBRARY_OWNER=mpd:audio
TIKPAL_USB_LIBRARY_SCAN_COMMAND=/home/moode/code/tikpal/deploy/moode/tikpal-usb-library-sync.sh
TIKPAL_USB_LIBRARY_AUTO_UPDATE=0
TIKPAL_USB_LIBRARY_AUTO_UPDATE_MIN_MS=15000
TIKPAL_MPC_UPDATE_TIMEOUT_SECONDS=8
TIKPAL_USB_LIBRARY_ROOTS=
TIKPAL_USB_LIBRARY_AUTO_ROOTS=/media,/run/media
TIKPAL_USB_LIBRARY_MPD_PREFIX=USB
```

### Explore Onboard runtime notes

The MV3 extension forwards provider focus changes to the loopback keyboard action immediately, while the provider guard keeps a polling fallback. Provider fields use the configured `500,420 900,280` default and GTK/XTest input delivery so provider login receives keys without the keyboard jumping to its old default position. Local Console fields may pass a one-shot `TIKPAL_WEB_MODE_ONBOARD_ACTION_POSITION` / `TIKPAL_WEB_MODE_ONBOARD_ACTION_WINDOW` override through the API; the launcher validates it after sourcing `.env.kiosk` and moves the already visible Onboard window without taking Chromium focus so low Console fields, including Link / Explore Proxy URL, are not hidden by the keyboard. The Console Explore Proxy settings detail sends a `keyboard preload` action to start and hide the resident keyboard before the first input tap; Explore provider launch does not preload Onboard. Later show / hide requests use `onboard.lock`, not `web-mode.lock`, and do not run Explore audio auto-detection, so text entry stays responsive while provider switching is busy. Kiosk installation enables systemd user lingering for the service user so the hidden Onboard process remains available between API calls; `Hide` uses DBus only and does not unmap or reconfigure the live window. The installer and launcher both install `deploy/chromium/onboard-scripts/tikpalImeToggle.py` into `/usr/share/onboard/scripts/`; the Tikpal IME key uses that script because F9 and Ctrl+Space can be swallowed by Chromium or fail when the Fcitx input context is inactive. The launcher also installs `Tikpal-Classic.colors` and keeps generated `Tikpal-Compact-EN.onboard`, `Tikpal-Compact-Pinyin.onboard`, `Tikpal-Compact-German.onboard`, `Tikpal-Compact-Italian.onboard`, `Tikpal-Compact-Korean.onboard`, `Tikpal-Compact-Japanese.onboard`, and `Tikpal-Compact-Spanish.onboard` layouts in the kiosk user's Onboard data directory, so the same script click updates both real Fcitx state and the selected key color/label. Onboard's own status icon and floating icon palette are disabled; the Explore side panel has no manual keyboard control and keeps only the top-right Back button. Explore must not open until MPD, renderer intakes, and Scene Sound have released audio, and Hi-Fi recovery must not restart playback behind an active provider.

## DDC/CI Brightness Setup

Real display brightness writes require `TIKPAL_PLAYER_BACKEND=mpc`; in mock mode Tikpal only updates the local API state. After `.env` exists, run the repo-owned DDC/CI helper on the Pi:

```bash
cd /home/moode/code/tikpal
sudo deploy/moode/tikpal-ddcci-enable.sh
sudo systemctl restart tikpal-api.service
```

The helper installs `ddcutil` and `i2c-tools`, loads `i2c-dev`, persists `dtparam=i2c_arm=on`, grants the service user access to `/dev/i2c-*`, writes `TIKPAL_DDCUTIL_BIN` and `TIKPAL_DDCUTIL_DISPLAY` into `.env`, and probes VCP `0x10`.

If the display should be selected explicitly, pass the display id observed from `ddcutil detect --brief`:

```bash
sudo TIKPAL_DDCUTIL_DISPLAY=1 deploy/moode/tikpal-ddcci-enable.sh
```

Validated target evidence from the current Raspberry Pi path:

```text
Display 1
   I2C bus:          /dev/i2c-20
   DRM connector:    card1-HDMI-A-1
   Monitor:          CRX:XENEON EDGE:207726065656
VCP 10 C 80 100
```

Resource-only OTA packages can update the local music library and add ambient scene videos without changing application code. Package layout defaults to:

```text
resource-ota/
├─ manifest.json
└─ assets
   ├─ scenes
   │  ├─ _metadata/scene_videos.json
   │  └─ Rainy-Window.mp4
   └─ music
      ├─ _metadata/library_manifest.json
      ├─ Focus/Lo-fi Ambient/folder.jpg
      ├─ Focus/Lo-fi Ambient/*.mp3
      ├─ Meditation/Breathing/*.mp3
      └─ Rest/Rain Ocean Forest/*.mp3
```

Apply it on the device from the app checkout:

```bash
npm run ota:resources -- /path/to/resource-ota
```

To create scene-only packages from local MP4 files, run:

```bash
npm run ota:package:mp4 -- /path/to/mp4-scenes --recursive --bundle --default Forest-Cabin.mp4
```

The generator writes packages under `.tikpal/resource-ota-packages` unless `--output` is provided. Split mode creates one package per MP4; `--bundle` creates one package that installs the whole folder together. Each generated scene entry includes an id, filename, label, order, optional default marker, and `sha256`. The generator normalizes scene MP4s for the Pi kiosk path: keep the physical `2560x720` target, use H.264 Main Profile Level 4.1, `yuv420p`, a closed GOP around 48 frames, no B-frames, bounded video bitrate around `4500k`, AAC stereo around `96k`, and `+faststart`. If a source video has an audible or visible loop boundary, first run `npm run media:loop -- --input <mp4> --crossfade 0.9`; this requires `ffmpeg` / `ffprobe` and keeps an in-place backup under `.codex-artifacts/media-backups`. At runtime, `FlameScene` also uses two video slots for each looping scene, preparing the standby slot about 1.2 seconds before the tail and revealing it about 0.42 seconds before the tail with a 360ms visual / 340ms Scene Sound crossfade. In Pi `mpc` stable-loop mode, loop playback stays on the single-video path, but scene switches still mount a separate incoming layer and keep the outgoing scene visible until the incoming layer is drawable. The video element watchdog can recover ordinary playback stalls and exposes `data-flame-video-health`; it seeks and resumes the existing single-loop element instead of calling `video.load()`, because repeated reloads can accumulate Chromium Media threads and drive Pi load far above the normal one-core software-decode baseline. Repeated-stall logo fallback is retried by the page and cleared on the next scene source change so Focus / Calm / Sleep switches do not remain on the logo while waiting for the systemd watchdog. If the full X/Chromium/V3D display stack stops responding, the systemd kiosk watchdog handles recovery by restarting only `tikpal-kiosk.service`.

The script validates `assets/music/_metadata/library_manifest.json`, checks that manifest track and optional cover paths are safe and present in the package or already installed library, validates scene MP4 `sha256` checksums from `assets/scenes/_metadata/scene_videos.json`, validates the legacy replacement MP4 when present, writes `public/assets`, syncs `dist/assets` when a production build is present, and records `.tikpal/resource-ota-state.json`. The API reads the local music manifest on each `/api/v1/audio/library` request and lists scene videos from both `public/assets/*.mp4` and `public/assets/scenes/_metadata/scene_videos.json`; Ambient refreshes that scene catalog every 30 seconds and when the page becomes visible, so newly added scene videos appear in the previous / next scene controls without a page reload. The default Ambient scene catalog no longer depends on a bundled `output*.mp4`; when the scene catalog is empty, the scene video layer stays off until a new scene package is installed.

To clear installed scene videos without touching music assets, run `npm run scene:clear`. The command removes `assets/scenes` under the configured public assets root, mirrors the clear into `dist/assets/scenes` when that build output exists, writes an empty `scene_videos.json`, and records `.tikpal/scene-video-clear-state.json`.

Install and restart API + web services:

```bash
sudo deploy/systemd/install-systemd-services.sh \
  --app-dir /home/moode/code/tikpal \
  --user moode \
  --restart
```

Verify:

```bash
systemctl is-active tikpal-api.service tikpal-web.service
curl -fsS http://127.0.0.1:8787/api/v1/health
curl -fsSI http://127.0.0.1:4173/
curl -fsSI http://127.0.0.1:4174/
```

### Validated Proxy Deploy Checkpoint

2026-06-09 validation on `192.168.2.141` used the SOCKS proxy SSH route with `moode@192.168.2.141` and confirmed the live service tree before syncing:

```text
ProxyCommand: nc -X 5 -x 127.0.0.1:7897 %h %p
WorkingDirectory: /home/moode/code/tikpal
tikpal-api.service: active
tikpal-web.service: active
tikpal-kiosk.service: active
```

The deploy synced the current workspace mirror, including `public/` and the local `dist/` build, while preserving device-local `.env`, `.env.*`, and `.tikpal/` state. Post-restart validation returned `{"ok":true,"service":"tikpal-api","mode":"mpc"}`, reported `kioskWindow:"2560x720"` from `/api/v1/system/runtime`, returned `/api/v1/system/state` in about `0.041s`, served `http://127.0.0.1:4173/` with `200 OK`, and served `http://192.168.2.141:4173/` through the proxy with `__TIKPAL_REMOTE_MODE__=true`.

When `TIKPAL_PLAYER_BACKEND=mpc` is active, also verify the real device path:

```bash
systemctl show tikpal-api.service -p Environment --no-pager
mpc status
mpc current
curl -fsS -X POST http://127.0.0.1:8787/api/v1/playback/actions \
  -H "Content-Type: application/json" \
  --data '{"type":"next"}'
mpc status
curl -fsS http://127.0.0.1:8787/api/v1/playback/status
curl -fsS http://127.0.0.1:8787/api/v1/system/status
curl -fsS http://127.0.0.1:8787/api/v1/system/runtime
curl -fsS -o /tmp/tikpal-state.json -w '%{time_total}\n' http://127.0.0.1:8787/api/v1/system/state
```

`next`, `previous`, playlist play, local track switch, and startup queue priming are serialized through the API and verify MPD reaches `[playing]` after `play`, so a status line that remains `[paused]` after one of those actions is a real regression to investigate before accepting the deploy. If MPD reports `Failed to open ALSA device "_audioout"`, verify that moOde sees the USB speaker or amplifier in `aplay -l`, that moOde's selected output is that USB output, that `snd_aloop` is loaded when `/etc/alsa/conf.d/_sndaloop.conf` is active, and that `/etc/modules-load.d/tikpal-snd-aloop.conf` contains the kernel module name `snd_aloop` for reboot persistence. Tikpal's audio adapter runs before MPD and fails the deploy-time audio step if Loopback is still hidden after apply. The kiosk runtime env should also not force Chromium to `TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE=_audioout`. Tikpal's Loopback helpers refuse HDMI-only `_audioout` routes by default; set `TIKPAL_ALSA_LOOPBACK_ALLOW_HDMI=1` only when HDMI output is deliberate.

For Pi responsiveness, the timed `/api/v1/system/state` check should return from the in-memory snapshot instead of waiting for slow runtime probes. If it takes seconds, inspect whether a read endpoint is still executing `systemctl`, `ddcutil`, source status commands, AirPlay/Bluetooth metadata helpers, or media metadata probes in the request path. A background collector may still be running those commands, but repeated state reads should not increase stuck helper process counts.

For AirPlay lyrics validation, compare the helper, playback API, lyrics API, and kiosk visibility state before accepting a deploy:

```bash
./deploy/moode/tikpal-airplay-metadata.sh
curl -fsS http://127.0.0.1:8787/api/v1/playback/status
curl -fsS http://127.0.0.1:8787/api/v1/lyrics/status
curl -fsS http://127.0.0.1:8787/api/v1/system/state
```

When lyrics exist, `/api/v1/lyrics/status` should be `ready` with `lines.length > 0`, `sourceScope: "airplay_input"`, and title / artist identity matching `/api/v1/playback/status`. If the provider only has a same-title different-artist result, `not_found` or continued `recognizing` is the correct state. If lyrics stay `idle` with a message like `Waiting for AirPlay audio`, first check `audio.currentSource.connectionState`; the lyrics wall intentionally stays hidden while AirPlay is only `armed`. If the wall shows the right song but the highlighted line does not move, compare helper `positionMs`, `positionTrusted`, `positionConfidence`, `clockStartReason`, playback `elapsedSeconds`, and the lyric line timestamps before changing provider logic. `positionConfidence=none` with an old `clockStartReason=airplay_event` usually means Shairport did not provide a native MPRIS position and the helper failed to reset the estimated clock for the current track. The Hi-Fi wall defaults visible through `tikpal.lyricsVisible.v3`; old hidden-state storage is restored visible once through `tikpal.lyricsVisible.autoRestored.v1`, old hidden external-input lyrics are restored visible once more through `tikpal.lyricsVisible.readyRestored.v1`, and later manual hides remain respected. If ready lyrics have no provider timestamps, every source must show them statically. If provider-synced lyrics have no trusted position but AirPlay reports `positionConfidence=estimated`, the wall may use that pause-aware clock; if the clock is missing, stale, paused without stored elapsed, or discarded as overrun, the wall should remain static rather than wrapping elapsed time and highlighting a false line.

For Bluetooth, DLNA, and Radio parity, use the same cover / lyrics wall acceptance instead of treating AirPlay as a one-off. Bluetooth should report the active sender as `audio.currentSource.id:"bluetooth"` with `connectionState:"connected"`, real `playback.albumArtUrl` from BlueZ metadata or the cached remote artwork endpoint when available, and `lyrics.sourceScope:"bluetooth_input"` once metadata or fingerprint recognition identifies a track. DLNA should report `audio.currentSource.id:"upnp"` only after a real connected probe or new MPD playback appears after selecting DLNA, then expose title / artist / album / elapsed through `deploy/moode/tikpal-upnp-metadata.sh` with `lyrics.sourceScope:"upnp_input"` when metadata identifies a track. If DLNA is only `armed` / `Ready` while old Radio is still playing, the current source should remain Radio. Radio should report `audio.currentSource.id:"radio"`, the selected `radioStationId`, and a non-empty `playback.albumArtUrl` from `/api/v1/media/radio-logo`. Radio lyrics use `sourceScope:"local_playback"` and should only become `ready` when the stream exposes real song title / artist metadata; a station label such as `Internet Radio` with no track identity should stay centered now-playing with the station logo, not fake a lyrics wall.

```bash
./deploy/moode/tikpal-bluetooth-metadata.sh || true
./deploy/moode/tikpal-upnp-metadata.sh || true
curl -fsS http://127.0.0.1:8787/api/v1/system/state \
  | jq '.audio.currentSource,.playback.source,.playback.title,.playback.artist,.playback.albumArtUrl,.lyrics.sourceScope,.lyrics.status,(.lyrics.lines | length)'
deploy/moode/tikpal-radio-presets-sync.sh check
curl -fsS 'http://127.0.0.1:8787/api/v1/audio/radios?limit=80' | jq '.total,.categories,.stations[0:7] | .'
curl -fsS http://127.0.0.1:8787/api/v1/system/state \
  | jq '.audio.currentSource.radioStationId,.playback.albumArtUrl,.lyrics.sourceScope,.lyrics.status,(.lyrics.lines | length)'
```

If these APIs show ready lyrics and a real artwork URL but the physical display stays centered, capture the kiosk frame and inspect `mode:"hifi"` plus the Chromium `tikpal.lyricsVisible.v3` value before changing source-specific code; Radio, Bluetooth, and AirPlay are expected to render through the same Hi-Fi lyrics wall component.

### AirPlay 5.1 Classic Output And Lyrics Wall Verification

On moOde 10 / Shairport Sync 5.1, an AirPlay 2 control session can appear as `Playing` on the sender while the Pi receives no decryptable PCM stream, no usable title / artwork metadata, and no sound-device ownership. Treat sender-side `Playing` as weak evidence until the Pi proves the audio and metadata path locally. For this Tikpal path, set `TIKPAL_AIRPLAY_SERVICE_TYPE=classic`, keep `TIKPAL_AIRPLAY_ALSA_OUTPUT_DEVICE=_audioout`, and keep the service name stable through `TIKPAL_AIRPLAY_SERVICE_NAME=Tikpal-Speaker-Airplay`.

After enabling AirPlay, verify the receiver identity, output route, metadata, and physical screen together:

```bash
shairport-sync -V
grep -nE 'service_type|name|output_device|metadata|pipe_name|include_cover_art|cover_art_cache_directory|run_this' /etc/shairport-sync.conf
ss -ltnp | grep -E ':5000|:7000|:4173|:4174'
sqlite3 /var/local/www/db/moode-sqlite3.db "select param,value from cfg_system where param in ('airplaysvc','aplactive','adevname','cardnum','amixname','alsavolume') order by param;"
sudo fuser -v /dev/snd/* 2>&1 || true
./deploy/moode/tikpal-airplay-metadata.sh
curl -fsS http://127.0.0.1:8787/api/v1/system/state > /tmp/tikpal-state.json
python3 - <<'PY'
import json
s = json.load(open("/tmp/tikpal-state.json"))
print(s["audio"]["currentSource"])
print(s["playback"]["source"], s["playback"]["state"], s["playback"]["title"], "-", s["playback"]["artist"])
print(s["playback"].get("albumArtUrl"))
print("lyrics", s["lyrics"]["status"], "lines", len(s["lyrics"].get("lines") or []), "synced", s["lyrics"].get("synced"))
PY
```

Success means Shairport Sync is listening as the Tikpal AirPlay endpoint, the connected session drives `aplactive=1`, `sudo fuser` shows `shairport-sync` owning both the current USB playback device and the Loopback mirror, the helper emits current title / artist / artwork from `metadataSource=mpris`, and `/api/v1/system/state` reports `audio.currentSource.id:"airplay"`, `connectionState:"connected"`, `playback.source:"airplay"`, a non-empty `albumArtUrl`, and `lyrics.status:"ready"` with displayable lines when lyrics exist. If Shairport listens on TCP 5000 in classic mode, that is expected; TCP 7000 belongs to the AirPlay 2 path and is not required for this fallback.

The AirPlay artwork endpoint is a GET media endpoint; validate it by downloading bytes instead of using `HEAD`:

```bash
art_url="$(python3 - <<'PY'
import json
s = json.load(open("/tmp/tikpal-state.json"))
print(s["playback"].get("albumArtUrl") or "")
PY
)"
[ -n "$art_url" ] && curl -fsS "http://127.0.0.1:8787${art_url}" | wc -c
```

To prove real PCM is flowing into Tikpal's capture path, sample the Loopback capture side while the phone is playing:

```bash
timeout 3 arecord -q -D hw:CARD=Loopback,DEV=1 -f S16_LE -r 48000 -c 2 -d 2 /tmp/tikpal-airplay-loop.wav
ls -lh /tmp/tikpal-airplay-loop.wav
```

The loopback WAV should be larger than a header-only file and Shairport should still own the USB playback PCM. This proves software audio reached `_audioout` and the Loopback mirror; it cannot prove a downstream amplifier, speaker input, or cable is audible. If those checks pass but the room is silent, test the physical output separately with an intentional low-volume speaker test.

Finally, prove the physical kiosk has the cover and lyrics wall instead of relying only on API JSON:

```bash
DISPLAY=:0 XAUTHORITY=/home/moode/.Xauthority \
  timeout 8 ffmpeg -hide_banner -loglevel error -y \
  -video_size 2560x720 -f x11grab -i :0 -frames:v 1 /tmp/tikpal-airplay-hifi.png
ls -lh /tmp/tikpal-airplay-hifi.png
```

The captured frame should show Hi-Fi mode with real AirPlay cover art and the lyrics wall. If the API is ready but the wall is absent, inspect `/api/v1/experience/state` for `mode:"hifi"` and the Chromium profile's `tikpal.lyricsVisible.v3` key before changing lyrics provider code.

2026-07-19 validation on `192.168.2.138` used the SOCKS proxy route and confirmed `shairport-sync -V` reported `5.1-AirPlay2`, `/etc/shairport-sync.conf` had `service_type = "classic"` and `output_device = "_audioout"`, the advertised endpoint was `Tikpal-Speaker-Airplay` on TCP 5000, `sudo fuser` showed `shairport-sync` on the physical USB card and Loopback, Loopback capture produced nonzero PCM, `/api/v1/system/state` reported AirPlay playing with a versioned cover URL and ready synced lyrics, and a `DISPLAY=:0` screenshot showed the album cover plus Hi-Fi lyrics wall.

2026-07-21 Bluetooth lyrics validation on `192.168.10.246` used the SOCKS proxy route and preserved Pi-local `.env*` / `.tikpal` during rsync. The live `.env` had `TIKPAL_BLUETOOTH_METADATA_COMMAND="./deploy/moode/tikpal-bluetooth-metadata.sh"` while `TIKPAL_BLUETOOTH_ACTIVE_COMMAND` was empty, so the acceptance path explicitly proved BlueZ / AVRCP metadata could promote the active Bluetooth source to `connectionState:"connected"` without a separate active hook. `./deploy/moode/tikpal-bluetooth-metadata.sh` reported live title / artist / album plus `positionMs` and the common short `durationMs=60000`; `/api/v1/system/state` then reported `audio.currentSource.id:"bluetooth"`, `lyrics.sourceScope:"bluetooth_input"`, and `lyrics.status:"ready"`. A later poll on the same connected sender resolved `Yesterday Once More` through LRCLIB with `lyrics.synced:true` and 53 lines, and a `DISPLAY=:0` screenshot showed the shared Hi-Fi cover-plus-lyrics wall with the active line highlighted. If a future Bluetooth session has ready lyrics in the API but stays centered on the physical screen, check the Chromium lyrics visibility keys before changing Bluetooth-specific UI; if the source remains only `armed` while the helper has live metadata, inspect the metadata promotion path before adding a device-specific active command.

2026-07-19 follow-up on `192.168.2.138` split AirPlay no-sound into four separate checks. First, repeated `usb ... over-current change` events proved that the USB Display and BT66 audio dongle could be reset together by the Pi's USB power domain; moving the audio dongle behind a powered USB hub stopped the automatic reset. Second, the audio adapter preflight was simplified to `grep Loopback` plus a real `snd_aloop` load / wait loop because `systemd-modules-load` can claim success while `/proc/asound/cards` still lacks the Loopback card. Third, Shairport Sync should keep `ignore_volume_control = "no"` so the iPhone volume slider remains usable, while `default_airplay_volume = 0.0` avoids a quiet receiver default after reset. Fourth, Shairport's software volume curve should use `volume_range_db = 30` and `volume_control_profile = "flat"`; otherwise a phone volume around one third can produce real but extremely quiet PCM and look like silence on the physical speaker. The acceptance sequence is: `cat /proc/asound/cards` lists `Loopback` and the current USB card, `deploy/moode/tikpal-audio-adapt.sh check` reports `loopbackVisible=1`, `sudo fuser -v /dev/snd/*` shows `shairport-sync` on Loopback and the USB card once the phone is connected, `busctl --system get-property org.mpris.MediaPlayer2.ShairportSync /org/mpris/MediaPlayer2 org.mpris.MediaPlayer2.Player Volume` changes when the iPhone volume changes, and `arecord -D hw:Loopback,1,0` captures nonzero PCM. If those are true but the room is silent, inspect the USB DAC's analog cable, amplifier input, and speaker volume before changing AirPlay code.

2026-07-19 Explore validation on `192.168.2.138` used the same SOCKS route, preserved Pi-local `.env*` and `.tikpal` during rsync, then ran `sudo deploy/systemd/install-systemd-services.sh --enable-kiosk --restart`. The installer filled the missing kiosk package set, including `xdotool`, `wmctrl`, `onboard`, `fcitx5`, `xvfb`, `x11vnc`, `novnc`, `websockify`, and `socat`. Runtime `.env.kiosk` kept `TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE=auto` and `TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE=auto`; the `--check` output resolved the current physical card as `dmix:CARD=BT66,DEV=0`, proving this was auto-detection rather than a checked-in device pin. `.env` had `TIKPAL_BLUETOOTH_DISABLE_COMMAND="moodeutl -Ro --bluetooth off"` and `TIKPAL_AIRPLAY_DISABLE_COMMAND="moodeutl -Ro --airplay off"`, and `.tikpal/web-mode-settings.json` had `proxyEnabled=true` with `proxyUrl="http://192.168.2.172:7897"`. A follow-up kiosk check focused Console Link / Explore Proxy URL and verified Onboard at `1208,157 900,280`, leaving the input visible instead of covering it from the default bottom position.
The same `192.168.2.138` follow-up replaced the Onboard `中/EN` hotkey path with `tikpalImeToggle.py` because `xdotool key F9` and `Ctrl+Space` did not change Fcitx state while `fcitx5-remote -t` did. Physical Onboard clicks on `中/EN` were then verified to switch from `keyboard-us` / inactive to `pinyin` / active and back to `keyboard-us` / inactive. A later `192.168.2.138` pass added and verified the `Tikpal-Classic.colors` scheme plus the active `Tikpal-Compact-Pinyin.onboard` layout: after a real X click on the Onboard IME key, gsettings switched to the Pinyin layout and a root screenshot showed the same key as a teal `中文` selected button; a second click returned it to the normal `中/EN` layout.

Current Onboard script behavior is shared with the Gentoo path: `tikpalImeToggle.py` supports `--set-locale` and `--set-mode`, and the language cycle is `EN -> Chinese -> German -> Italian -> Korean -> Japanese -> ES -> EN`. Pi package names and install steps differ from Gentoo, so use the Gentoo runbook only for Portage/Fcitx package details.

The Explore acceptance run confirmed `curl -fsSI http://127.0.0.1:4173/` returned `HTTP/1.1 200 OK`; posting `{"type":"open"}` to `/api/v1/web-mode/actions` returned `HTTP 200` with `activeProvider:"qq_music"` and `lastError:null`; `http://127.0.0.1:9241/json/list` showed the QQ page at `https://y.qq.com/n/ryqq_v2/player`; and `DISPLAY=:0 xwininfo -root -tree` showed the left 1920 x 720 QQ Music provider plus the right 640 x 720 Tikpal side panel. The same run's `tikpal-api.service` journal showed `renderer-onoff.php --bluetooth off` and `renderer-onoff.php --airplay off` after opening Explore. `/api/v1/system/state` and `.tikpal/audio-source-memory.json` still remembered Bluetooth rather than writing Explore as a source, which is the intended public contract: Explore takes playback output while active, but it is not a restorable Tikpal source.

Provider-switch validation on the same Pi then switched QQ Music to Spotify with `{"type":"open","provider":"spotify"}` and back to QQ Music with `{"type":"open","provider":"qq_music"}`. Both calls returned `HTTP 200` with `lastError:null`; Spotify exposed `https://open.spotify.com/` on `127.0.0.1:9234/json/list`, QQ Music exposed `https://y.qq.com/n/ryqq/player` on `127.0.0.1:9241/json/list`, and `xwininfo` showed exactly one left provider window plus the right side panel after each switch. The journal again showed renderer disable hooks during the Spotify switch, so non-default providers are covered by the same external-source release path as the QQ default.

2026-07-19 volume validation on `192.168.31.110` confirmed the selected USB card was `SPL Crimson`, while moOde reported `amixname=none`, `alsavolume=none`, and MPD `mpdmixer=software`. The old output-volume helper failed `volume_set` because no `PCM` ALSA mixer existed on the card, leaving Scene Sound volume effectively stuck at MPD `0%`. The helper now normalizes `default:CARD=...` card tokens and falls back to `mpc volume` when no ALSA mixer accepts the write; `./deploy/moode/tikpal-output-volume.sh get` returned `mpc software [35%]`, `POST /api/v1/playback/actions {"type":"volume_set","value":36}` returned `system.volume.percent=36`, and `mpc status` matched `volume: 36%`.
2026-07-19 audio-adapter validation on `192.168.31.110` deployed `tikpal-audio-adapt.service`, reset `.env.kiosk` audio outputs back to `auto`, and confirmed the adapter selected `SPL Crimson` by priority. `check` reported `browserPcm=tikpal_browser_output`, `browserSharedFormat=S24_3LE`, `audiooutPcm=plughw:CARD=Crimson,DEV=0`, `mixerControl=none`, `volumeStrategy=mpd-software`, and `loopbackVisible=1`; Explore crossfade declined the non-raw-`dmix` output and fell back to direct provider audio, while both kiosk Chromium and provider Chromium could still share the generated browser PCM. A low-level `_audioout` WAV captured through `hw:Loopback,1,0` produced nonzero PCM with no new USB over-current events. After a reboot, validate that `cat /proc/asound/cards` still lists `Loopback`, `lsmod` lists `snd_aloop`, `/etc/modules-load.d/tikpal-snd-aloop.conf` contains `snd_aloop`, and `mpc status` no longer reports `_audioout: No such device`.

Verify the portable remote facade locally and through the LAN-facing web proxy:

Set the same non-empty `TIKPAL_PORTABLE_API_KEY` for both `tikpal-api.service` and `tikpal-web.service`. Check every later systemd `EnvironmentFile` override (`/etc/tikpal-api.env`, `/etc/tikpal-web.env`, or deployment-specific equivalents), then restart both services. Port `4174` keeps the key field visible near the top, stores the entered value in browser local storage, and keeps action errors visible until another action clears them.

```bash
curl -fsS http://127.0.0.1:8787/api/v1/openapi.json
curl -fsS http://127.0.0.1:8787/api/v1/remote/state
curl -fsS http://127.0.0.1:4174/api/v1/remote/catalog
curl -fsS http://127.0.0.1:4174/ | grep __TIKPAL_REMOTE_MODE__
curl -fsS -X POST http://127.0.0.1:4174/api/v1/remote/actions \
  -H "Content-Type: application/json" \
  -H "X-Tikpal-Key: $TIKPAL_PORTABLE_API_KEY" \
  --data '{"type":"playback.play_pause"}'
```

For multi-surface sync, validate volume and source writes from both the local API and the LAN-facing remote facade. `system.volume.percent` should match after each write, and external intake sources should keep the same `armed` / `connected` state in `/api/v1/system/state`, `/api/v1/audio/sources`, and `/api/v1/remote/state`:

```bash
curl -fsS -X POST http://127.0.0.1:8787/api/v1/playback/actions \
  -H "Content-Type: application/json" \
  --data '{"type":"volume_set","value":44}' | jq '.system.volume.percent,.audio.currentSource'
curl -fsS -X POST http://127.0.0.1:4174/api/v1/remote/actions \
  -H "Content-Type: application/json" \
  -H "X-Tikpal-Key: $TIKPAL_PORTABLE_API_KEY" \
  --data '{"type":"volume_set","value":43}' | jq '.volume.percent,.source'
curl -fsS http://127.0.0.1:8787/api/v1/system/state | jq '.system.volume.percent,.audio.currentSource,.audio.rememberedSource,.playback.title'
curl -fsS http://127.0.0.1:8787/api/v1/audio/sources | jq '.currentSource,.rememberedSource'
curl -fsS http://127.0.0.1:4174/api/v1/remote/state | jq '.volume.percent,.source'
```

For a Hi-Fi `Not Playing` regression after service restart, verify persisted room mode and remembered source together: when `.tikpal/room-experience-state.json` has `mode:"hifi"`, `tikpal-api` startup must restore `.tikpal/audio-source-memory.json` before Scene Sound or MPD queue priming, and `/api/v1/system/state` should not publish an initial stale `stopped` snapshot while that restore is still running. A remembered Radio source should come back as `audio.currentSource.id == "radio"`, with matching `radioStationId` and `playback.state == "playing"` unless the station has failed and the normal Radio fallback advanced to the next playable station. A remembered Library track may fall back to the default MPD queue if the local library package was replaced and the saved `localTrackPath` no longer exists. If Hi-Fi is already running and MPD later falls back to `stopped`, the background snapshot collector should recover remembered Library/Radio within the next refresh/cooldown window; it should leave an explicit `paused` state, a currently playing Radio stream with temporarily missing station id, and Spotify/AirPlay/Bluetooth/DLNA waiting states alone.

For Radio stutter, check the stream path before changing UI code: inspect `mpc status`, `mpc current -f '%file%'`, `/var/log/mpd/log`, the station's advertised bitrate (`icy-br` from `curl -D -`), Pi-side download speed, and packet loss to the gateway/public internet. `Decoder is too slow; playing silence to avoid xrun` means MPD is starving the output. If the stream bitrate is higher than the sustained Pi download speed, bigger buffers can delay the dropout but cannot make the station stable; expect Tikpal to skip that station after repeated xrun events.

Validate the curated Radio path after importing or editing moOde presets:

```bash
curl -fsS 'http://127.0.0.1:8787/api/v1/audio/radios?limit=80' \
  | jq '.scope,.total,.categories,.stations[0:5] | .'
curl -fsS 'http://127.0.0.1:8787/api/v1/audio/radios?scope=all&limit=5' \
  | jq '.total,.stations[].catalogSource'
curl -fsS 'http://127.0.0.1:8787/api/v1/audio/radios?category=random' \
  | jq '.total,.stations[].category'
curl -I -fsS 'http://127.0.0.1:8787/api/v1/media/radio-logo?stationId=radio-511'
curl -fsS -D - -o /dev/null 'http://127.0.0.1:8787/api/v1/media/radio-logo?stationId=radio-511' \
  | grep -Ei 'cache-control|access-control-allow-methods'
curl -fsS -X POST http://127.0.0.1:8787/api/v1/audio/source \
  -H "Content-Type: application/json" \
  --data '{"target":"radio","radioStationId":"radio-511"}' \
  | jq '.system.volume,.playback.source,.playback.albumArtUrl,.audio.currentSource'
curl -fsS -X POST http://127.0.0.1:8787/api/v1/playback/actions \
  -H "Content-Type: application/json" \
  --data '{"type":"next"}' \
  | jq '.audio.currentSource.radioStationId,.audio.currentSource.secondaryStatus,.playback.albumArtUrl'
curl -fsS http://127.0.0.1:8787/api/v1/system/state \
  | jq '.playback.source,.playback.state,.playback.albumArtUrl,.audio.currentSource.radioStationId,.audio.currentSource.secondaryStatus'
mpc current -f '%file%'
mpc status
curl -fsS http://127.0.0.1:8787/api/v1/audio/spectrum | jq '.source,.bands[0:8]'
```

Expected result: the default Radio catalog reports 36 curated stations across `Focus`, `Calm`, `Sleep`, `Jazz`, `Classical`, `News`, `Hi-Fi`, `Blues`, `Rock`, `World`, `Electronic`, and `Podcast`, plus a final `Random` page that returns three sampled stations whose `category` values stay real; `scope=all` still exposes full moOde rows for compatibility, the radio-logo endpoint returns an image with `Cache-Control: public, max-age=86400` and `GET,HEAD,OPTIONS` allowed, MPD volume is nonzero after the Radio switch, the chosen station is `active:true` in `/api/v1/audio/radios`, Radio `next` changes to another station inside the same category, a failed stream still recovers through Radio `next` instead of falling back to MPD `Not playing`, `/api/v1/system/state` exposes the new Radio `albumArtUrl` as soon as the backend has primed the active station, and spectrum bands are nonzero when the station is audible.

Player Library behavior is shared with the Gentoo runbook: storage tabs are flat, Local and USB rows show compact audio/file information, USB `Copy to Local` must not overwrite same-name Local files, copied tracks under `Codex/USB Imports/...` must survive later Local sync / reboot, Local `Delete` requires the `Yes` / `No` confirmation path, and long lists keep the fixed fast-scroll rail. Validate those DOM hooks after a frontend deploy with `[data-library-track-list-shell]`, `[data-library-fast-scroll]`, `[data-library-delete-confirm-yes]`, and `[data-library-delete-confirm-no]`.

Verify Console actions from the API before relying on the kiosk UI:

```bash
curl -fsS -X POST http://127.0.0.1:8787/api/v1/system/actions \
  -H 'Content-Type: application/json' \
  -d '{"type":"library_scan"}'
```

If ambient brightness gestures should work on the target display, also verify the DDC/CI path explicitly:

```bash
systemctl show tikpal-api.service -p Environment --no-pager
ddcutil getvcp 10 --brief
curl -fsS http://127.0.0.1:8787/api/v1/system/status
curl -fsS -X POST http://127.0.0.1:8787/api/v1/system/actions \
  -H 'Content-Type: application/json' \
  -d '{"type":"brightness_set","value":80}'
curl -fsS http://127.0.0.1:8787/api/v1/system/state
```

Success means `/api/v1/health` reports `mode:"mpc"`, `/api/v1/system/status` reports `display.controllable=true` and `display.transport="ddcci"`, the `brightness_set` response and the immediate `/api/v1/system/state` response both show the written brightness, and `ddcutil getvcp 10 --brief` returns the same value after the API action. If `/dev/i2c-*` is absent or VCP `0x10` is unreadable, reboot once after the helper writes `dtparam=i2c_arm=on`, then re-run the probe before assuming the display lacks DDC/CI.

## Scene Sound Audio Verification

Scene Sound is browser audio from the active Ambient MP4, not MPD audio. If Scene Sound is on, the video is moving, and the API reports `source:"scene"` but the speaker is silent, split the diagnosis into frontend state, Chromium ALSA output, moOde `_audioout`, and competing renderer ownership.

First confirm the Pi source state and basic audio devices:

```bash
curl -fsS http://127.0.0.1:8787/api/v1/playback/status
curl -fsS http://127.0.0.1:8787/api/v1/system/state
aplay -l
aplay -L | grep -E '^(_audioout|dmix|default|plughw|hw)' -A2
grep -E '^TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE|^TIKPAL_KIOSK_REMOTE_DEBUG' /home/moode/code/tikpal/.env.kiosk
```

Then inspect the kiosk log. `PcmOpen: _audioout,No such device` means `_sndaloop.conf` expects Loopback but `snd_aloop` is missing or was not loaded from `/etc/modules-load.d/tikpal-snd-aloop.conf`. `PcmOpen: _audioout,Device or resource busy` means Chromium reached ALSA but could not use the Loopback-backed composite route reliably or another renderer is holding the device:

```bash
journalctl -u tikpal-kiosk.service --since '10 minutes ago' --no-pager \
  | grep -Ei 'PcmOpen|alsa output|_audioout|dmix|Loopback|alsa' || true
cat /proc/asound/cards
lsmod | grep -E 'snd_aloop|snd_usb_audio' || true
fuser -v /dev/snd/* 2>&1 || true
pgrep -af 'librespot|shairport|bluealsa|upmpd|squeezelite' || true
```

Recovery rules:

- If Loopback is missing while `/etc/alsa/conf.d/_sndaloop.conf` references `hw:Loopback,0`, run `sudo ./deploy/moode/tikpal-snd-aloop-enable.sh`; it should write `snd_aloop` to `/etc/modules-load.d/tikpal-snd-aloop.conf`, load the module immediately, and fail instead of silently succeeding if `aplay -l` still cannot see Loopback. Then restart the affected service.
- If `librespot --device _audioout` is still running after the source is `scene`, run `moodeutl -Ro --spotify off`, set `TIKPAL_SPOTIFY_DISABLE_COMMAND="moodeutl -Ro --spotify off"`, and restart `tikpal-api.service`.
- If Chromium logs `PcmOpen: _audioout,Device or resource busy`, set `TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE=auto` in `.env.kiosk`, run `deploy/moode/tikpal-audio-adapt.sh check`, keep DevTools disabled, and restart `tikpal-kiosk.service`. Override with `TIKPAL_AUDIO_CARD_FORCE=<CARD>` when the install intentionally pins one known card; avoid hard-coding `dmix` for cards such as SPL Crimson that need `plughw`.
- If MPD reports `Failed to open ALSA device "_audioout"`, fix `_audioout` separately before judging Scene Sound; MPD and Chromium can fail for different reasons.

After recovery, success looks like this:

```bash
systemctl is-active tikpal-api.service tikpal-web.service tikpal-kiosk.service tikpal-kiosk-watchdog.timer
curl -fsS http://127.0.0.1:8787/api/v1/playback/status
journalctl -u tikpal-kiosk.service --since '2 minutes ago' --no-pager \
  | grep -Ei 'PcmOpen|alsa output|_audioout|dmix|alsa' || true
for f in /proc/asound/<USB_CARD>/pcm0p/sub*/status; do echo "---$f"; cat "$f"; done
pgrep -x librespot >/dev/null && echo 'Spotify still owns output' || echo 'Spotify renderer closed'
```

The USB PCM status should be `RUNNING` while Scene Sound is active, and recent kiosk logs should show the adapter-selected `dmix:CARD=...` or `plughw:CARD=...` output without new `PcmOpen` errors. If the DOM video needs inspection, enable `TIKPAL_KIOSK_REMOTE_DEBUG=1` only temporarily, inspect the active `video.flame-video` for `muted=false`, `paused=false`, `readyState>=2`, and nonzero `data-scene-volume`, then turn DevTools back off.

For visual scene-switch verification on the physical kiosk, prefer a frame capture on `DISPLAY=:0` instead of relying only on API state. This is the high-signal check for the white-flash class of bugs:

```bash
RUN_DIR=$(mktemp -d /tmp/tikpal-scene-verify.XXXXXX)
mkdir -p "$RUN_DIR/frames"
DISPLAY=:0 ffmpeg -y -hide_banner -loglevel error \
  -f x11grab -video_size 2560x720 -framerate 4 -t 40 -i :0.0 \
  "$RUN_DIR/frames/frame-%03d.png" &
FFMPEG_PID=$!

curl -fsS -H 'Content-Type: application/json' \
  -d '{"type":"set_mode","mode":"focus"}' \
  http://127.0.0.1:8787/api/v1/experience/actions >/dev/null
sleep 6
curl -fsS -H 'Content-Type: application/json' \
  -d '{"type":"set_mode","mode":"calm"}' \
  http://127.0.0.1:8787/api/v1/experience/actions >/dev/null
sleep 6
curl -fsS -H 'Content-Type: application/json' \
  -d '{"type":"set_mode","mode":"sleep"}' \
  http://127.0.0.1:8787/api/v1/experience/actions >/dev/null
wait "$FFMPEG_PID"
```

Then analyze the captured PNGs with Pillow or a similar image tool. A healthy run should have no high-ratio white frames; recent Pi validation on `192.168.10.178` captured 158 frames while cycling room modes and scene ids, with `max_white ratio=0.0000`, `max_mean=134.4`, and the darkest frames corresponding to the intentional black dim/reveal transition rather than browser-white exposure. Keep the temporary frame directory only long enough to inspect failures.

## Quiet Boot And Reboot

To keep the HDMI kiosk screen from showing kernel, systemd, udev, cursor, or `tty1 login` text while the Raspberry Pi boots or reboots, run the repo-owned quiet boot helper on the Pi:

```bash
cd /home/moode/code/tikpal
sudo deploy/moode/tikpal-quiet-boot-enable.sh
```

The helper backs up the detected cmdline file (`/boot/firmware/cmdline.txt` or `/boot/cmdline.txt`), removes visible `console=tty*` routing from the kernel command line, adds quiet boot flags, writes a systemd manager drop-in with `ShowStatus=no`, writes a quiet console `sysctl` drop-in, disables automatic VT allocation, and masks `getty@tty1.service`, `getty@tty2.service`, and `getty@tty3.service`. This keeps the physical HDMI screen from falling back to `tty1`, `tty2`, or `tty3` text during boot or reboot; SSH remains available.

Verify the installed quiet boot state:

```bash
grep -E 'quiet|systemd.show_status=false|vt.global_cursor_default=0' /boot/firmware/cmdline.txt /boot/cmdline.txt 2>/dev/null
grep -E 'console=tty[0-9]*' /boot/firmware/cmdline.txt /boot/cmdline.txt 2>/dev/null && echo "unexpected visible tty console"
systemctl is-enabled getty@tty1.service || true
systemctl is-active getty@tty1.service || true
systemctl is-enabled getty@tty2.service || true
systemctl is-active getty@tty2.service || true
systemctl is-enabled getty@tty3.service || true
systemctl is-active getty@tty3.service || true
cat /etc/systemd/system.conf.d/tikpal-quiet-boot.conf
cat /etc/systemd/logind.conf.d/tikpal-quiet-vts.conf
cat /etc/sysctl.d/99-tikpal-quiet-console.conf
```

Reboot once for the cmdline changes to take effect. Emergency kernel failures can still show critical text; normal boot and reboot should stay visually quiet until Chromium takes over.

## Enable Kiosk

Only enable the kiosk service after API and web are healthy.

First check whether another kiosk service already owns the X session:

```bash
systemctl status kiosk.service --no-pager
systemctl cat kiosk.service
```

Then install and restart the Tikpal kiosk service:

```bash
sudo deploy/systemd/install-systemd-services.sh \
  --app-dir /home/moode/code/tikpal \
  --user moode \
  --enable-kiosk \
  --restart
```

Verify the live display path:

```bash
systemctl status tikpal-kiosk.service --no-pager
systemctl status tikpal-kiosk-viewer.service --no-pager
systemctl status tikpal-kiosk-devtools.service --no-pager
systemctl status tikpal-kiosk-watchdog.timer --no-pager
journalctl -u tikpal-kiosk.service -n 80 --no-pager
journalctl -u tikpal-kiosk-viewer.service -n 80 --no-pager
journalctl -u tikpal-kiosk-devtools.service -n 80 --no-pager
journalctl -u tikpal-kiosk-watchdog.service -n 80 --no-pager
ps -ef | grep '[c]hrom'
timeout -k 2s 5s env DISPLAY=:0 xdpyinfo >/dev/null && echo "X display responsive"
deploy/chromium/tikpal-kiosk-healthcheck.sh --check
```

The effective Chromium command line should include these window flags:

```text
--start-fullscreen --window-position=0,0 --window-size=2560,720
```

The launcher accepts `TIKPAL_KIOSK_WINDOW=2560x720` in `.env.kiosk`, but normalizes it to Chromium's `2560,720` format during launch.

If the physical panel suddenly shows a 4:3 view or a cropped Ambient scene, verify the actual X root window before changing React layout code:

```bash
timeout -k 2s 5s env DISPLAY=:0 xrandr --query
timeout -k 2s 5s env DISPLAY=:0 xdpyinfo | grep -E 'dimensions|resolution'
ps -eo pid,args | grep '[c]hromium-browser'
grep -E '^TIKPAL_KIOSK_XRANDR_MODE|^TIKPAL_KIOSK_XRANDR_OUTPUT|^TIKPAL_KIOSK_XRANDR_CLONE_OUTPUTS|^TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS' \
  /home/moode/code/tikpal/.env.kiosk /etc/tikpal-kiosk.env 2>/dev/null || true
cat /proc/cmdline | tr ' ' '\n' | grep '^video=' || true
```

The high-signal failure pattern is `xrandr` reporting `current 1024 x 768` while `2560x720` is still listed as an available HDMI mode and Chromium was launched with `--window-size=2560,720`. In that case the display mode was not enforced after X started. On a physical HDMI kiosk, keep the Pi app env aligned with the system override:

```bash
cd /home/moode/code/tikpal
cp .env.kiosk ".env.kiosk.bak-$(date +%Y%m%d-%H%M%S)"
sed -i 's/^TIKPAL_KIOSK_XRANDR_MODE=.*/TIKPAL_KIOSK_XRANDR_MODE=2560x720/' .env.kiosk
grep -q '^TIKPAL_KIOSK_XRANDR_OUTPUT=' .env.kiosk \
  && sed -i 's/^TIKPAL_KIOSK_XRANDR_OUTPUT=.*/TIKPAL_KIOSK_XRANDR_OUTPUT=HDMI-1/' .env.kiosk \
  || printf 'TIKPAL_KIOSK_XRANDR_OUTPUT=HDMI-1\n' >> .env.kiosk
grep -q '^TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS=' .env.kiosk \
  && sed -i 's/^TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS=.*/TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS=5/' .env.kiosk \
  || printf 'TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS=5\n' >> .env.kiosk
sudo systemctl restart tikpal-kiosk.service
timeout -k 2s 5s env DISPLAY=:0 xrandr --query | sed -n '1,8p'
```

Some ultrawide touch panels expose their visible framebuffer through a USB display bridge rather than the Pi HDMI connector. On this hardware X may show the physical panel as an `evdi` output such as `DVI-I-1-1`, while HDMI still appears connected because it carries EDID or an unused boot console. If the API, Chromium, and heartbeat are healthy but the panel is black after reboot, check `xrandr --listmonitors`: a healthy clone setup should show the active 2560 x 720 output at `+0+0`. Keep the normal HDMI mode as the primary output and mirror the USB display bridge when both outputs need to stay active:

```bash
grep -q '^TIKPAL_KIOSK_XRANDR_OUTPUT=' /etc/tikpal-kiosk.env \
  && sudo sed -i 's/^TIKPAL_KIOSK_XRANDR_OUTPUT=.*/TIKPAL_KIOSK_XRANDR_OUTPUT=HDMI-1/' /etc/tikpal-kiosk.env \
  || printf 'TIKPAL_KIOSK_XRANDR_OUTPUT=HDMI-1\n' | sudo tee -a /etc/tikpal-kiosk.env >/dev/null
grep -q '^TIKPAL_KIOSK_XRANDR_CLONE_OUTPUTS=' /etc/tikpal-kiosk.env \
  && sudo sed -i 's/^TIKPAL_KIOSK_XRANDR_CLONE_OUTPUTS=.*/TIKPAL_KIOSK_XRANDR_CLONE_OUTPUTS=DVI-I-1-1/' /etc/tikpal-kiosk.env \
  || printf 'TIKPAL_KIOSK_XRANDR_CLONE_OUTPUTS=DVI-I-1-1\n' | sudo tee -a /etc/tikpal-kiosk.env >/dev/null
sudo systemctl restart tikpal-kiosk.service
timeout -k 2s 5s env DISPLAY=:0 xrandr --listmonitors
```

Do not leave `TIKPAL_KIOSK_XRANDR_MODE=none` on a physical-screen unit unless the display mode is intentionally managed somewhere else. The systemd kiosk unit sets `TIKPAL_KIOSK_SKIP_ENV_SOURCE=1` so a service-level drop-in such as `/etc/tikpal-kiosk.env` can override the app `.env.kiosk` once at process start; after changing the template, reinstall the systemd units before relying on that override order.

## Remote Kiosk Diagnostics

noVNC adds CPU and network load, so keep it off by default and only enable it while recording or debugging. Use the viewer control helper on the Pi:

```bash
cd /home/moode/code/tikpal
sudo deploy/chromium/tikpal-kiosk-viewerctl.sh start
sudo deploy/chromium/tikpal-kiosk-viewerctl.sh status
```

When noVNC is enabled, use these checks from the Pi:

```bash
curl -fsSI http://127.0.0.1:6080/
```

From a trusted LAN browser, open `http://<pi-ip>:6080/` to view and operate the full kiosk UI. After recording, disable noVNC again:

```bash
cd /home/moode/code/tikpal
sudo deploy/chromium/tikpal-kiosk-viewerctl.sh stop
sudo deploy/chromium/tikpal-kiosk-viewerctl.sh status
```

For DOM, console, network, and media debugging, separately enable `TIKPAL_KIOSK_REMOTE_DEBUG=1`, restart `tikpal-kiosk-devtools.service`, verify `curl -fsS http://127.0.0.1:9222/json/version`, and add `<pi-ip>:9222` in Chrome's `chrome://inspect`.

For low-latency macOS recording, leave the viewer stopped and open `http://<pi-ip>:4173/` directly. This renders the full kiosk app locally in the Mac browser and therefore avoids the `Xvfb` / `x11vnc` / `websockify` work used by noVNC. Use `http://<pi-ip>:4174/` when the narrower portable remote is desired instead.

To verify the no-screen path without unplugging hardware, temporarily set `TIKPAL_KIOSK_DISPLAY_MODE=virtual`, restart `tikpal-kiosk.service`, `tikpal-kiosk-viewer.service`, and `tikpal-kiosk-devtools.service`, then open noVNC again. Restore `auto` after the test unless the device should always run headless.

Disable DevTools again after a diagnostic session:

```bash
cd /home/moode/code/tikpal
sed -i 's/^TIKPAL_KIOSK_REMOTE_DEBUG=.*/TIKPAL_KIOSK_REMOTE_DEBUG=0/' .env.kiosk
sudo systemctl disable --now tikpal-kiosk-devtools.service
sudo systemctl restart tikpal-kiosk.service
ss -ltnp | grep -E ':(9222|9223)\b' || true
```

If Chromium or Xorg does not exit cleanly, first confirm `tikpal-kiosk.service` is stuck in `deactivating`, then kill only that service cgroup before starting it again:

```bash
sudo systemctl kill -s SIGKILL tikpal-kiosk.service
sudo systemctl reset-failed tikpal-kiosk.service tikpal-kiosk-devtools.service
sudo systemctl start tikpal-kiosk.service
```

## Long-Run Scene Video Freeze Recovery

If Scene Video is still `playing` in the API but the physical kiosk frame is frozen after hours of unattended playback, treat it as a display-stack problem before changing React video code. The high-signal pattern is: API reads stay fast, temperature and memory are normal, `xdpyinfo` on `DISPLAY=:0` times out, and kernel logs show `v3d`, `drm_sched_job_timedout`, or `Resetting GPU for hang`.

There is one separate long-run failure mode: X11 and Chromium are still alive, but the React page stops consuming state or events. In that case `/api/v1/health`, `/api/v1/system/runtime`, and `xdpyinfo` can all look healthy while source changes, Focus/Calm/Sleep/Hi-Fi, or scene switching no longer work. The kiosk page reports a loopback-only heartbeat so the watchdog can distinguish this page-semi-dead state from a full display-stack hang.

Use bounded probes only; avoid periodic `xrandr --query` or `ffmpeg x11grab` because they can hang behind the same X/V3D failure:

```bash
curl --max-time 3 -fsS http://127.0.0.1:8787/api/v1/health
curl --max-time 5 -fsS http://127.0.0.1:8787/api/v1/system/runtime
curl --max-time 5 -fsS http://127.0.0.1:8787/api/v1/playback/status
curl --max-time 3 -fsS http://127.0.0.1:8787/api/v1/kiosk/heartbeat | jq '{healthy,status,ageMs,reasons,scene:.heartbeat.scene,statusDetail:.heartbeat.status,eventLoop:.heartbeat.eventLoop,video:.heartbeat.activeSceneVideo}'
timeout -k 2s 5s env DISPLAY=:0 xdpyinfo >/dev/null && echo "X display responsive"
dmesg -T | grep -Ei 'v3d|drm_sched|gpu reset|Resetting GPU' | tail -40
journalctl -u tikpal-kiosk-watchdog.service -u tikpal-kiosk.service -b --no-pager | tail -120
pgrep -af 'ffmpeg .*x11grab|xdpyinfo|xrandr' || true
```

Interpret the heartbeat this way:

- `status:"unseen"` means the API has not received a page heartbeat since restart. This is expected briefly while Chromium starts, but not after the kiosk has been visible for more than about 30 seconds.
- `status:"stale"` or reason `heartbeat-stale` means the page stopped posting heartbeats. If X is still responsive, this is the typical Chromium page semi-dead signature.
- `pending-stuck:<kind>` means the page believes a source, room, playback, system, or Scene Sound action has been pending past the watchdog threshold.
- `event-loop-lag` means the page event loop is badly delayed even though the process still exists.
- `scene-video-stalled`, `scene-video-fallback`, or `scene-video-error` means the front-end video watchdog already detected a local media failure and the kiosk watchdog should refresh the page process if it persists.
- `scene-video-missing` while `playback.source:"scene"` and Scene Video is enabled means the page currently has no active `<video>` element. If the physical screen shows only the Tikpal logo, first wait for the page-level fallback retry or change room scenes once; if the reason persists, let the kiosk watchdog restart only `tikpal-kiosk.service`.
- Remote LAN or portable-controller callers should not be able to read this endpoint; it is intentionally loopback-only and outside `/api/v1/remote/*`.

The watchdog timer is installed with `--enable-kiosk` and should stay enabled for unattended scene playback:

```bash
systemctl is-active tikpal-kiosk-watchdog.timer
systemctl list-timers tikpal-kiosk-watchdog.timer
sudo systemctl start tikpal-kiosk-watchdog.service
sudo deploy/chromium/tikpal-kiosk-healthcheck.sh --check
journalctl -u tikpal-kiosk-watchdog.service -n 80 --no-pager
```

When the watchdog finds `x-unresponsive`, `chromium-missing`, `web-unhealthy`, `api-unhealthy`, `page-unhealthy:<reason>`, or a new `v3d-reset`, it first restarts only `tikpal-kiosk.service`. If the normal restart times out because Chromium or Xorg is stuck in `deactivating`, it kills that service cgroup, resets the failed state, and starts the kiosk again. API, web, MPD, and moOde audio services are left alone during normal display/page recovery, so Scene Sound and source truth survive a kiosk restart.

`page-unhealthy` is intentionally kiosk-only recovery. It does not trigger reboot escalation by itself because it points at a page runtime failure, not a wedged KMS/GPU stack.

If the kernel GPU/KMS state is wedged hard enough that Xorg restarts but never reaches Chromium, repeated kiosk restarts are not enough. `TIKPAL_KIOSK_WATCHDOG_REBOOT_AFTER_RESTARTS=3` allows the watchdog to reboot the Pi only after repeated `x-unresponsive` or `v3d-reset` display-stack failures within `TIKPAL_KIOSK_WATCHDOG_REBOOT_WINDOW_SECONDS=900`. Set it to `0` to disable reboot escalation while debugging.

The kiosk session and launcher bound their own `xset` and `xrandr` calls with `TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS=5`. This prevents a half-responsive X server from leaving `startx -> xinit -> Xorg` alive while Chromium never starts. If `/tmp/.X11-unix/X0` exists but `timeout 5 env DISPLAY=:0 xdpyinfo` hangs and `pgrep -af chromium-browser` is empty, treat the failure as display-stack wedged rather than a React page issue. First restart `tikpal-kiosk.service`; if X still accepts no clients after the restart, reboot the Pi to clear the KMS/Xorg state, then confirm Chromium and the heartbeat return.

After a watchdog recovery, confirm the display path is clean and no diagnostic helpers were left behind:

```bash
systemctl is-active tikpal-api.service tikpal-web.service tikpal-kiosk.service tikpal-kiosk-watchdog.timer
timeout -k 2s 5s env DISPLAY=:0 xdpyinfo >/dev/null && echo "X display responsive"
pgrep -af 'ffmpeg .*x11grab|xdpyinfo|xrandr' || true
curl --max-time 5 -fsS http://127.0.0.1:8787/api/v1/playback/status
curl --max-time 3 -fsS http://127.0.0.1:8787/api/v1/kiosk/heartbeat | jq '{healthy,status,ageMs,reasons}'
```

## Pi Resource Triage

When the kiosk becomes very slow, capture CPU, thermal, GPU, I/O, and service state before changing application code:

```bash
uptime
vcgencmd measure_temp
vcgencmd get_throttled
vmstat 1 5
ps -eo pid,ppid,user,stat,pcpu,pmem,rss,comm,args --sort=-pcpu | head -30
journalctl -b -p warning --no-pager -n 120
journalctl -u tikpal-kiosk.service -b --since '10 minutes ago' --no-pager | tail -120
df -hT
curl --max-time 3 -fsS http://127.0.0.1:8787/api/v1/health
curl --max-time 5 -fsS http://127.0.0.1:8787/api/v1/system/runtime
pgrep -af 'bluetoothctl|tikpal-bluetooth-label.sh' | tail -40
```

Interpret the common high-signal findings this way:

- `vcgencmd get_throttled` values with `0x8` set mean the CPU is currently under soft temperature limiting; values with `0x2`, `0x4`, or `0x6` in the historical bits mean the Pi already hit frequency or thermal caps earlier in the boot.
- Repeated `v3d ... Resetting GPU for hang`, `gbm_wrapper`, or `GpuControl.CreateCommandBuffer` messages point at Chromium / GPU instability. Stop DevTools first, then reboot once if the kiosk is still stuck with Xorg but no Chromium process.
- Hundreds of `tikpal-bluetooth-label.sh` or `bluetoothctl` processes mean the Bluetooth label probe is wedged. Confirm `TIKPAL_BLUETOOTH_LABEL_TIMEOUT_SECONDS` is set, deploy the current script, and reboot to clear already-orphaned processes.
- Plenty of free memory and zero swap means the slowdown is not memory pressure; focus on Chromium CPU, temperature, GPU logs, process leaks, and storage pressure.
- A root filesystem above roughly 90% full is not usually the first cause of UI jank, but it should be cleaned before long unattended kiosk sessions.

After rebooting for resource recovery, verify the Pi came back cleanly:

```bash
systemctl is-active tikpal-api.service tikpal-web.service tikpal-kiosk.service
systemctl is-active tikpal-kiosk-devtools.service || true
ss -ltnp | grep -E ':(4173|4174|8787|9222|9223)\b' || true
curl -fsS http://127.0.0.1:8787/api/v1/health
curl --max-time 5 -fsS http://127.0.0.1:8787/api/v1/system/runtime
vcgencmd measure_temp
vcgencmd get_throttled
```

## Rollback

Stop Tikpal kiosk without removing API/web:

```bash
sudo systemctl disable --now tikpal-kiosk-devtools.service tikpal-kiosk-viewer.service tikpal-kiosk.service
```

Stop all Tikpal services:

```bash
sudo systemctl disable --now tikpal-kiosk-devtools.service tikpal-kiosk-viewer.service tikpal-kiosk.service tikpal-web.service tikpal-api.service
```

The Chromium profile is dedicated to Tikpal and defaults to:

```bash
/home/moode/.config/tikpal-chromium-kiosk
```
