# Gentoo Kiosk Deploy v1

## Goal

Deploy Tikpal on a Gentoo systemd host as the production 2560 x 720 physical kiosk while keeping the existing Raspberry Pi / moOde deployment path intact.

This runbook records the Gentoo migration baseline validated on `192.168.10.117` in July 2026. The app path stays compatible with the moOde host:

```bash
/home/moode/code/tikpal
```

The Git branch for Gentoo-specific repo work is `gentoo`. Runtime files such as `.env`, `.env.kiosk`, and `.tikpal/*` remain machine-local and must not be copied back into Git.

## Runtime Baseline

Core services use the same repo-owned systemd units as the Pi path:

| Unit | Purpose |
| --- | --- |
| `tikpal-api.service` | Local API on `127.0.0.1:8787`. |
| `tikpal-web.service` | Web UI on `4173` and portable remote on `4174`. |
| `tikpal-audio-adapt.service` | Preserves and reports the Gentoo ALSA output route. |
| `tikpal-library-sync.service` | Keeps MPD library state fresh. |
| `tikpal-kiosk.service` | Physical Chromium kiosk on display `:0`. |
| `tikpal-kiosk-watchdog.timer` | Display watchdog. |

The Gentoo target uses systemd, Portage-managed Xorg/Chromium, and ALSA direct output. Keep the production `.env.kiosk` aligned with the physical screen:

```conf
TIKPAL_KIOSK_DISPLAY=:0
TIKPAL_KIOSK_DISPLAY_MODE=physical
TIKPAL_KIOSK_LOCAL_SCREEN=1
TIKPAL_KIOSK_WINDOW=2560x720
TIKPAL_KIOSK_XRANDR_OUTPUT=HDMI-1
TIKPAL_KIOSK_XRANDR_MODE=2560x720
TIKPAL_KIOSK_VIEWER=none
TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE=_audioout
TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE=tikpal_bt66_dmix
```

Keep `.env` in `mpc` mode and allow the backend to read the real DRM display mode:

```conf
TIKPAL_PLAYER_BACKEND=mpc
TIKPAL_MPD_HOST=127.0.0.1
TIKPAL_MPD_PORT=6600
TIKPAL_RUNTIME_DRM_MODE_ENABLED=1
TIKPAL_AUDIO_CARD_FORCE=BT66
TIKPAL_OUTPUT_VOLUME_CARDS=BT66
```

If a future Gentoo host runs virtual kiosk only, set `TIKPAL_KIOSK_DISPLAY=:1`, `TIKPAL_KIOSK_DISPLAY_MODE=virtual`, `TIKPAL_KIOSK_LOCAL_SCREEN=0`, and keep noVNC enabled only for debugging.

## Gentoo System Setup

Install the base audio and kiosk dependencies with Portage. The validated stack includes ALSA tools/plugins, MPD/MPC, Avahi, upmpdcli, BlueZ/bluez-alsa where hardware exists, ffmpeg, sqlite, jq, sudo, Node.js, Chromium, Xorg/Xvfb, xdotool, wmctrl, x11vnc, noVNC, websockify, and socat.

Gentoo package choices are intentionally conservative:

- Keep Nouveau for the GTX 750 class display path. Do not install `x11-drivers/nvidia-drivers` unless the display path is being revalidated.
- Enable Xorg `suid` through Portage instead of manually keeping `/usr/bin/Xorg` chmodded.
- Keep `snd_aloop` persistent for Loopback-backed capture and compatibility paths.
- Do not enable global USB autosuspend; BT66 DAC, touch, keyboard, and network devices should remain awake.
- Install `sys-power/powertop` for measurement, not for automatic `powertop --auto-tune`.

The long-term display expectation is:

```bash
DISPLAY=:0 XAUTHORITY=/home/moode/.Xauthority xrandr --query
```

Expected high-signal line:

```text
HDMI-1 connected primary 2560x720+0+0
```

The physical display prepare helper should run before and after kiosk start. Its job is to wait for the HDMI DRM connector and EDID at boot, disable DPMS/screen saver, keep the Nouveau PCI path awake, retile `HDMI-1` to `2560x720`, and apply the safe HDMI properties that stopped black-screen recovery churn on the Gentoo target.

Install the repo-owned helper as the root command used by the systemd drop-in:

```bash
install -o root -g root -m 0755 \
  /home/moode/code/tikpal/deploy/chromium/tikpal-physical-display-prepare.sh \
  /usr/local/sbin/tikpal-physical-display-prepare
mkdir -p /etc/systemd/system/tikpal-kiosk.service.d
cat >/etc/systemd/system/tikpal-kiosk.service.d/physical-display.conf <<'EOF'
[Service]
Environment=TIKPAL_KIOSK_ENV_FILE=/home/moode/code/tikpal/.env.kiosk
ExecStartPre=+/usr/local/sbin/tikpal-physical-display-prepare wait-ready
ExecStartPost=+/bin/sh -c 'systemctl stop tikpal-physical-display-kick.service >/dev/null 2>&1 || true; systemd-run --quiet --collect --no-block --unit=tikpal-physical-display-kick --property=Type=oneshot --setenv=TIKPAL_KIOSK_ENV_FILE="$TIKPAL_KIOSK_ENV_FILE" --setenv=HOME=/root /usr/local/sbin/tikpal-physical-display-prepare delayed-soft-kick'
EOF
systemctl daemon-reload
```

`deploy/systemd/install-systemd-services.sh --enable-kiosk` installs the same helper and drop-in. The `+` prefix keeps the command root-owned even though `tikpal-kiosk.service` itself runs Chromium as `moode`. The delayed kick is launched as a short transient unit so `tikpal-kiosk.service` does not block on the full delay window.

The installer also creates `tikpal-display-stability.service`, an enabled oneshot that runs before the kiosk and calls:

```bash
/usr/local/sbin/tikpal-physical-display-prepare pci-stabilize
```

On the Gentoo target, set these production values in `.env.kiosk`:

```conf
TIKPAL_PHYSICAL_DISPLAY_PCI_POWER_DEVICES="0000:03:00.0 0000:03:00.1"
TIKPAL_PHYSICAL_DISPLAY_PCIE_ASPM_POLICY=performance
TIKPAL_PHYSICAL_DISPLAY_DRM_POLL=0
TIKPAL_PHYSICAL_DISPLAY_NOUVEAU_PCI_ID=0000:03:00.0
TIKPAL_KIOSK_PHYSICAL_DISPLAY_CHECK_ENABLED=0
TIKPAL_KIOSK_PHYSICAL_DISPLAY_GPU_REBIND_BEFORE_RESTART=1
```

If the kernel refuses a runtime ASPM policy write, the helper logs it as optional and continues. The important baseline is that both Nouveau GPU and HDMI-audio PCI functions stay at `power/control=on`.

On this GTX 750 host, avoid periodic physical `xrandr --query` probing from the watchdog. Repeated probing can trigger Nouveau DDC reads against the unused `DVI-I-1` connector (`DDC responded, but no EDID for DVI-I-1`) on roughly the watchdog cadence. Because this panel can be black while RandR still reports healthy, that periodic probe adds risk without giving a reliable visual signal. Keep `TIKPAL_KIOSK_PHYSICAL_DISPLAY_CHECK_ENABLED=0` and use the recovery helper manually or from an explicit service when the screen is visibly black.

## Audio Services

The Gentoo audio base uses ALSA direct output to the BT66 USB DAC. The validated `_audioout` route points at BT66, and Chromium provider audio uses the shareable `tikpal_bt66_dmix` device.

Keep these receiver names unique while the old moOde host remains online:

| Receiver | Name |
| --- | --- |
| UPnP / DLNA | `Tikpal-Gentoo UPNP` |
| AirPlay | `Tikpal-Gentoo-Airplay` |
| Spotify Connect | `Tikpal-Gentoo Spotify` |
| Bluetooth | `Tikpal-Gentoo-Bluetooth` |

Bluetooth remains unavailable unless `bluetoothctl list` shows a real HCI controller. Do not make the UI claim Bluetooth is ready before a USB Bluetooth dongle is present and paired through BlueZ/bluez-alsa.

Use the Gentoo source handoff helper to avoid ALSA output contention:

- AirPlay stops MPD and Spotify, then starts or restarts Shairport Sync.
- Spotify stops MPD and AirPlay, then starts or restarts go-librespot.
- UPnP stops direct web receivers and lets MPD/upmpdcli own playback.
- Library and Radio stop direct web receivers and keep MPD active.

Validation:

```bash
systemctl is-active mpd avahi-daemon upmpdcli shairport-sync
aplay -l
mpc status
sudo fuser -v /dev/snd/*
```

When QQ Music or another Explore provider is playing, the expected owner is a Chromium audio process holding BT66. When MPD or Radio is playing, the expected owner is MPD.

## Explore Provider Mode

Explore is not a restorable Tikpal audio source. It pauses local MPD/Radio, releases external receiver intakes, and opens a provider web player in a separate left Chromium window. The side panel remains a local Tikpal surface.

The physical layout is fixed:

| Surface | Geometry |
| --- | --- |
| Main Tikpal kiosk | `2560x720` at `0,0` |
| Explore provider | `1920x720` at `0,0` |
| Explore side panel | `640x720` at `1920,0` |

The proxy truth is `.tikpal/web-mode-settings.json`; the current Gentoo fallback is:

```conf
TIKPAL_WEB_MODE_DEFAULT_PROXY_URL=http://192.168.10.103:7897
```

Changing proxy state uses the MV3 extension and refreshes the active provider page while keeping its profile and window. Cookies and login state stay in per-provider Chromium profiles under:

```bash
/home/moode/.config/tikpal-web-mode/providers/<provider>
```

The provider text-size control uses `providerTextScale`:

| UI | Value | Behavior |
| --- | --- | --- |
| Small | `1.00` | Restore provider text elements to original font sizes. |
| Medium | `1.10` | Increase detected text elements by 10 percent. |
| Large | `1.20` | Increase detected text elements by 20 percent. |

This must never use Chrome tab zoom or `--force-device-scale-factor`. The viewport must stay `1920x720`, `devicePixelRatio` must stay `1`, and Chromium must not show the top-right `-/+` zoom bubble. The content script only adjusts visible text-bearing elements and skips media, SVG, canvas, video, and script surfaces.

Provider guard behavior:

- Blocks browser zoom keyboard and gesture shortcuts inside provider pages.
- Retargets `_blank` links into the same provider window.
- Keeps QQ Music single-pane and closes duplicate QQ player windows.
- May close safe cookie/trial/client prompts, but must not click login, payment, membership, subscription, purchase, authorization, or native-client download actions.
- For QQ Music, may unmute the web player when playback is active but the QQ volume button is muted.
- QQ Music MV uses wrapper cinema mode by default: `TIKPAL_WEB_MODE_QQ_MV_CINEMA_MODE=1`, `TIKPAL_WEB_MODE_QQ_MV_AUTO_PLAY=1`, and `TIKPAL_WEB_MODE_QQ_MV_AUTO_FULLSCREEN=0`.
- MV cinema mode must not click QQ Music's fullscreen button, call `requestFullscreen()`, press `F11`, retile Chromium, or hide the right side panel. It only applies CSS/DOM inside the left `1920x720` provider page so the largest visible MV `<video>` sits on a black `100vw x 100vh` stage with `object-fit: contain`.
- MV cinema mode hides QQ page chrome, comments, feedback/report/player controls, and injects icon-only controls in the lower-right corner. The playlist icon keeps `aria-label/title="播放列表"` and uses provider history to return to the QQ playlist, with `https://y.qq.com/n/ryqq/player` as the fallback. The replay icon keeps `aria-label/title="重播"` and is visible only when the MV has ended or is within `0.75s` of the end; clicking it immediately hides the replay icon, seeks the current cinema video to `0`, calls `play()`, and refreshes state from video events. MV completion must not auto-return, auto-replay, or auto-start the next item.
- MV cinema mode computes the real video ratio and overlays subtle dark ambience only on the letterbox bars. It keeps `object-fit: contain`, does not crop subtitles or picture content, does not draw blue/cyan frame lines, and leaves the overlay `pointer-events:none` so video and controls remain clickable.
- MV auto-play is conditional: if cinema mode sees the video still paused near `0s` with no progress for about two seconds, it starts the selected cinema `<video>` once. QQ's video-center click path is not reliable on the Gentoo physical kiosk, so the guard does not depend on it. If the MV is already playing, has advanced past the start, or is manually paused after playback began, it does not start it again.
- If QQ shows `播放失败，请刷新页面重试` / `错误码undefined`, the guard removes the cinema wrapper and does not click retry. Stable playback has priority over visual automation.

## Input And Fonts

Gentoo uses Fcitx5 and Onboard for physical-kiosk input. The kiosk session exports:

```conf
GTK_IM_MODULE=fcitx
QT_IM_MODULE=fcitx
XMODIFIERS=@im=fcitx
```

The Fcitx5 profile contains four input methods:

```text
keyboard-us
pinyin
anthy
keyboard-es
```

Onboard cycles modes through one Tikpal IME key:

```text
EN -> Chinese -> Japanese -> ES -> EN
```

Chinese and Japanese keep QWERTY letter keys because users type pinyin and romaji. Spanish uses a visual Spanish variant for keys such as `Ñ`, `¡ ¿`, accent/dead-key hints, and `Ç`. The key labels change to reflect the current mode; the underlying Onboard key IDs stay compatible with XTest.

Candidate fonts should prefer `Noto Sans CJK SC 16` when Noto CJK is installed, otherwise `Source Han Sans CN 16`. The regular UI font stack should have CJK coverage so Chromium does not fall back to Liberation for Chinese.

Onboard should only appear for text-like fields after real focus or tap. It should stay hidden for buttons, checkboxes, selectors, provider entry, and LAN browsers that view `http://<gentoo-ip>:4173/`.

## Player Library UX

The Gentoo physical kiosk uses the same Player Library contract as moOde:

- `Local`, `NAS`, `USB`, `Favorites`, and `Recently Added` are flat storage/filter tabs.
- Local, NAS, and USB rows show compact audio/file information when the backend exposes codec, sample rate, bit depth, channel count, bitrate, or file size.
- Keep `TIKPAL_USB_LIBRARY_AUTO_UPDATE=0` on the physical Gentoo kiosk. Browsing USB can scan the mounted filesystem for visible rows, but it should not launch `mpc update USB` in the background while the user seeks or plays Local/NAS music. Do not keep legacy 30-second USB sync timers such as `tikpal-usb-audio-sync.timer` enabled on the physical kiosk; use Settings -> Library -> Scan library for an explicit MPD index refresh, with `TIKPAL_MPC_UPDATE_TIMEOUT_SECONDS=8` as the default guardrail.
- USB rows expose `Copy to Local`; the backend should not overwrite same-name Local files and should report `Already in Local` when no copy is needed. Copied files live under `Codex/USB Imports/...`; `tikpal-local-library-sync.sh` must protect that imports directory while still using `rsync --delete` for repo-owned Local music, so copied tracks survive reboot and service reinstall.
- Local rows expose `Delete`, but the first tap only reveals `Yes` and `No`. Only `Yes` performs deletion; `No`, storage changes, source changes, or closing Player must cancel the pending confirmation.
- Long track lists keep a fixed right-side fast-scroll rail with `current / total` count and a draggable thumb. Dragging that rail only changes `scrollTop`; it must not select a track or auto-play on release.

NAS v1 is configured by the user in Settings rather than silently attached from a LAN scan. The backend may still read legacy manual roots from `TIKPAL_NAS_LIBRARY_ROOTS`, but those entries are marked `Manual` in Settings and should be treated as compatibility input. New setups should use Settings -> Library -> NAS:

```conf
TIKPAL_NAS_SOURCES_STATE_PATH=/home/moode/code/tikpal/.tikpal/nas-sources.json
TIKPAL_NAS_CREDENTIALS_DIR=/home/moode/code/tikpal/.tikpal/nas-credentials
TIKPAL_NAS_MOUNT_ROOT=/mnt/tikpal-nas
TIKPAL_NAS_MPD_ENTRY_ROOT=/var/lib/mpd/music/NAS
TIKPAL_NAS_MOUNT_COMMAND="sudo -n -E /usr/local/sbin/tikpal-nas-mount mount"
TIKPAL_NAS_UNMOUNT_COMMAND="sudo -n -E /usr/local/sbin/tikpal-nas-mount unmount"
TIKPAL_NAS_LIBRARY_ROOTS=/mnt/tikpal-nas-test
TIKPAL_NAS_LIBRARY_MPD_PREFIX=NAS
TIKPAL_NAS_LIBRARY_MAX_TRACKS=500
```

Configured NAS sources are stored in `.tikpal/nas-sources.json`. Passwords are not returned to the frontend; username/password credentials are written under `.tikpal/nas-credentials/<id>.cred` with `0600` permissions. The UI password field is masked by default and has a show/hide control for setup.

Discovery is only a candidate list. `POST /api/v1/nas/discover` may use `TIKPAL_NAS_DISCOVERY_HINTS` or a host-specific `TIKPAL_NAS_DISCOVERY_COMMAND`, but it must not save, mount, or scan anything until the user selects a candidate, runs `Test`, then uses `Save & Scan`.

Default mount behavior is read-only CIFS:

- Mount share at `/mnt/tikpal-nas/<id>`.
- Bind the selected folder into `/var/lib/mpd/music/NAS/<mountName>`.
- Expose track paths as `NAS/<mountName>/<relative-file>`.
- Try SMB `3.0`, then `2.1`, then `2.0`; save the version that works.
- Use `ro,uid=mpd,gid=audio,iocharset=utf8,nounix,soft`.

Install the repo helper as the root-owned command and allow `moode` to run only that helper with preserved `TIKPAL_NAS_*` environment:

```bash
install -o root -g root -m 0755 /home/moode/code/tikpal/deploy/moode/tikpal-nas-mount.sh /usr/local/sbin/tikpal-nas-mount
cat >/etc/sudoers.d/tikpal-nas <<'EOF'
Defaults:moode env_keep += "TIKPAL_NAS_ID TIKPAL_NAS_NAME TIKPAL_NAS_HOST TIKPAL_NAS_PORT TIKPAL_NAS_SHARE TIKPAL_NAS_PATH TIKPAL_NAS_AUTH_MODE TIKPAL_NAS_USERNAME TIKPAL_NAS_CREDENTIALS TIKPAL_NAS_REMOTE TIKPAL_NAS_MOUNT_POINT TIKPAL_NAS_CONTENT_ROOT TIKPAL_NAS_MPD_ENTRY TIKPAL_NAS_MPD_PATH TIKPAL_NAS_SMB_VERSION"
moode ALL=(root) NOPASSWD:SETENV: /usr/local/sbin/tikpal-nas-mount
EOF
chmod 0440 /etc/sudoers.d/tikpal-nas
visudo -cf /etc/sudoers.d/tikpal-nas
```

If a host needs different root policy, replace that helper command but keep the same `TIKPAL_NAS_*` environment contract. Tikpal passes source details through variables including `TIKPAL_NAS_REMOTE`, `TIKPAL_NAS_MOUNT_POINT`, `TIKPAL_NAS_CONTENT_ROOT`, `TIKPAL_NAS_MPD_ENTRY`, and `TIKPAL_NAS_CREDENTIALS`.

Temporary Gentoo validation can still use a high-port SMB share from a developer machine without enabling macOS system file sharing. Mount the test share read-only, expose it to MPD as `NAS/TikpalNAS`, then update MPD. The impacket test server currently negotiates SMB 2.0; a real NAS can use SMB 3.0 when supported.

```bash
mount -t cifs //192.168.10.103/TikpalNAS /mnt/tikpal-nas-test \
  -o port=1445,vers=2.0,guest,ro,uid=mpd,gid=audio,iocharset=utf8
mkdir -p /var/lib/mpd/music/NAS/TikpalNAS
mount --bind /mnt/tikpal-nas-test /var/lib/mpd/music/NAS/TikpalNAS
mpc update NAS
mpc listall NAS/TikpalNAS
curl -fsS 'http://127.0.0.1:8787/api/v1/audio/library?storage=nas&limit=10'
```

The API should expose NAS rows with `storage:"nas"` and `path:"NAS/TikpalNAS/<file>"`; Player Library can play them through MPD, but NAS rows do not show Local delete or USB copy actions. If no NAS is configured, Player -> Library -> NAS should say `Add NAS in Settings.`

Selecting a Library storage tab is a browse-only action. `Local`, `NAS`, `USB`, `Favorites`, and `Recently Added` must not send an empty `POST /api/v1/audio/source` request or restore a default MPD queue just because the user changed tabs. Playback starts only after a track row is tapped:

- Local rows post `{"target":"mpd","localTrackPath":"Codex/..."}` and show `Playing from Local.`
- NAS rows post `{"target":"mpd","localTrackPath":"NAS/<mountName>/..."}` and show `Playing from NAS.`
- USB rows post `{"target":"mpd","localTrackPath":"USB/<mountName>/..."}` and show `Playing from USB.`

This separation matters on the physical kiosk: an empty MPD switch while changing tabs can put the UI into a pending state, restore the wrong Local queue, and swallow the real NAS/USB track tap.

Targeted physical-kiosk DOM checks after deploying a frontend build:

```js
(() => {
  const shell = document.querySelector("[data-library-track-list-shell]");
  const list = document.querySelector("[data-library-track-list]");
  const rail = document.querySelector("[data-library-fast-scroll]");
  const thumb = document.querySelector("[data-library-fast-scroll-thumb]");
  return {
    fixedRail: shell instanceof HTMLElement
      && getComputedStyle(shell).gridTemplateColumns.split(" ").length === 2
      && rail instanceof HTMLElement
      && getComputedStyle(rail).position === "relative",
    scrollable: list instanceof HTMLElement && list.scrollHeight > list.clientHeight,
    thumb: thumb instanceof HTMLElement
  };
})()
```

For destructive actions, verify only the confirmation path unless a real deletion is intended:

```js
document.querySelector("[data-library-delete-local]")?.click();
document.querySelector("[data-library-delete-confirm-yes]") !== null;
document.querySelector("[data-library-delete-confirm-no]")?.click();
document.querySelector("[data-library-delete-confirm]") === null;
```

For NAS/USB playback-hint regressions, wrap `window.fetch` in the physical page or DevTools and confirm tab changes do not emit `/api/v1/audio/source`, while the first row tap does emit the right MPD-visible path:

```js
(() => {
  window.__tikpalFetchLog = [];
  const originalFetch = window.__tikpalOriginalFetch || window.fetch.bind(window);
  window.__tikpalOriginalFetch = originalFetch;
  window.fetch = async (...args) => {
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
    const init = args[1] || {};
    if (String(url || "").includes("/api/v1/audio/source")) {
      window.__tikpalFetchLog.push(String(init.body || ""));
    }
    return originalFetch(...args);
  };
  return true;
})()
```

After selecting `NAS` and tapping a NAS row, expect a body containing `NAS/<mountName>/...` and the Player hint `Playing from NAS.` Repeat with `USB/<mountName>/...` and `Playing from USB.`

## Display And Power

Brightness through DDC/CI is display-specific and can be non-linear. The Gentoo target should prefer conservative values that keep the screen visible; do not blindly map UI `100%` to raw DDC `100` if that target can black out or become unreadably dim during gesture changes.

Current low-power policy:

- Keep physical screen on for production use.
- Keep Nouveau and avoid proprietary NVIDIA unless retesting display risk.
- Keep CPU governor `schedutil`.
- Prefer `energy_perf_bias=12` over disabling turbo.
- Do not enable TLP or global USB autosuspend.
- Use DDC brightness conservatively; if a raw DDC value makes the panel unreadable, recover with a known visible value before changing UI mapping.

If the panel looks black while services and X still read healthy, recover the display path before rebooting:

```bash
/usr/local/sbin/tikpal-physical-display-prepare soft-kick
```

That soft-kick sequence:

- Sends DDC power on, brightness `45`, and contrast `50`.
- Leaves VCP `0x60` input source untouched by default because this panel can report a source code that does not match the live Xorg output. If a future unit needs forced HDMI-1, set `TIKPAL_PHYSICAL_DISPLAY_INPUT_SOURCE=0x11` only after confirming that code on the physical monitor.
- Treat DDC readbacks as advisory on this panel. `D6` can drift back to `x02` shortly after a successful power-on write while Xorg, Chromium, and the physical HDMI signal remain healthy, so watchdog recovery must not restart services from that value alone.
- Before kiosk start, waits for `/sys/class/drm/card0-HDMI-A-1/status` to become `connected` and for EDID to be readable, avoiding early Xorg `no screens found`.
- Runs `xset s off`, `xset s noblank`, `xset -dpms`, and `xset dpms force on`.
- Turns `HDMI-1` off briefly, switches it to `1280x720`, waits briefly, then switches back to `2560x720 primary`.
- Reapplies the safe RandR properties (`dithering depth=8 bpc`, `dithering mode=off`, `scaling mode=Full`) when the driver exposes them.
- Sets configured PCI display devices to `power/control=on`; on this host use `0000:03:00.0` for the GTX 750 Nouveau display function and `0000:03:00.1` for its HDMI audio function.
- Optionally sets `/sys/module/drm_kms_helper/parameters/poll` to `N` with `TIKPAL_PHYSICAL_DISPLAY_DRM_POLL=0`, reducing connector polling against unused DVI outputs.
- Raises the Chromium kiosk window.
- Runs delayed soft-kicks around `8s` and `25s` after kiosk start to mimic the part of a physical replug that wakes this panel after Chromium and Xorg settle.
- Uses `xkbcomp` to replace display power keysyms such as `XF86PowerOff`, `XF86Sleep`, `XF86Suspend`, `XF86Display`, and `XF86ScreenSaver` with `NoSymbol`; ordinary typing and Fcitx/Onboard input are left alone.

If `soft-kick` cannot recover a visible panel and a physical HDMI replug has been proven to fix it, the second-stage fallback is a Nouveau PCI rebind:

```bash
systemctl stop tikpal-kiosk.service
TIKPAL_KIOSK_ENV_FILE=/home/moode/code/tikpal/.env.kiosk \
  /usr/local/sbin/tikpal-physical-display-prepare nouveau-rebind
systemctl start tikpal-kiosk.service
```

The watchdog now runs the same helper in `--check` mode. If the physical display check fails, it tries `soft-kick` first, then an optional `nouveau-rebind` when `TIKPAL_KIOSK_PHYSICAL_DISPLAY_GPU_REBIND_BEFORE_RESTART=1`, and only restarts `tikpal-kiosk.service` when the display helper cannot recover the X/HDMI state. It still does not restart API, web, MPD, or audio services for ordinary display recovery.

Important limitation: this panel can be black to the eye while DRM, RandR, DDC, Chromium, and heartbeat all report healthy. In that exact state, software has no reliable visual sensor. The PCI `power/control=on` baseline and delayed kicks reduce the chance of recurrence; the proven recovery path is `nouveau-rebind`, with a physical HDMI replug as the final fallback if the panel receiver firmware ignores every software kick.

## Validation

2026-07-30 physical-kiosk validation on `192.168.10.117`:

- `systemctl is-system-running` returned `running`, and `systemctl --failed` returned `0`.
- `tikpal-api`, `tikpal-web`, `tikpal-kiosk`, and `mpd` were active after the library and seek fixes.
- `tikpal-usb-audio-sync.timer` was disabled and inactive. Keep it that way unless its helper is changed to avoid periodic `mpc update USB`.
- Local library sync preserved `Codex/USB Imports/...` while pruning stale repo-owned files. This protects `Copy to Local` imports across reboot and service reinstall.
- `/api/v1/audio/library?storage=local` returned Local tracks, and MPD `listall Codex` returned the same MPD-visible library root.
- Local MPD playback accepted repeated seek actions through `/api/v1/playback/actions` without an `mpc ... seek ... timed out` error after USB auto-update was disabled.
- Browsing USB via `/api/v1/audio/library?storage=usb` did not spawn a background `mpc update USB` process.
- The Player header should keep the Volume slider and Local storage meter aligned as one group, with a readable free-space label and visible spacing before the Back button.

Baseline service checks:

```bash
systemctl is-system-running
systemctl --failed
systemctl is-active tikpal-api tikpal-web tikpal-audio-adapt tikpal-library-sync tikpal-kiosk tikpal-kiosk-watchdog.timer
curl -fsS http://127.0.0.1:8787/api/v1/health
curl -fsSI http://127.0.0.1:4173/
```

Physical display checks:

```bash
DISPLAY=:0 XAUTHORITY=/home/moode/.Xauthority xrandr --query
DISPLAY=:0 XAUTHORITY=/home/moode/.Xauthority xdotool search --onlyvisible --name ".*" getwindowname %@ getwindowgeometry %@
curl -fsS http://127.0.0.1:8787/api/v1/kiosk/heartbeat | jq '{healthy,status,ageMs,reasons,ignoredReasons,visibility:.heartbeat.visibility,eventLoop:.heartbeat.eventLoop}'
```

When Explore is active, the main Tikpal kiosk page can become Chromium-hidden behind the visible provider / side-panel windows. Browser timer throttling may then report a large `eventLoop.lagMs` or delay the next heartbeat past the normal 30s visible-page stale threshold. These are diagnostic only and should appear under `ignoredReasons` as `event-loop-lag:hidden-page` or `heartbeat-stale:hidden-page`, not as restart reasons. Hidden pages use `TIKPAL_KIOSK_HEARTBEAT_HIDDEN_STALE_MS` (`120000` by default) before becoming truly stale. A stale visible heartbeat, visible-page event-loop lag, stuck pending action, or scene-video failure remains unhealthy.

Explore checks:

```bash
cd /home/moode/code/tikpal
deploy/chromium/tikpal-web-mode.sh --check
curl -fsS -X POST http://127.0.0.1:8787/api/v1/web-mode/actions \
  -H "Content-Type: application/json" \
  --data '{"type":"open","provider":"qq_music"}'
curl -fsS http://127.0.0.1:9241/json/list
```

Use CDP to verify provider text scaling without viewport scaling:

```js
(() => ({
  innerWidth,
  innerHeight,
  devicePixelRatio,
  htmlZoom: document.documentElement.style.zoom || "",
  datasetScale: document.documentElement.dataset.tikpalProviderTextScale || null,
  density: getComputedStyle(document.documentElement)
    .getPropertyValue("--tikpal-provider-text-density")
    .trim()
}))()
```

Expected values for the physical QQ provider are:

```text
innerWidth=1920
innerHeight=720
devicePixelRatio=1
htmlZoom=""
datasetScale="1.00" | "1.10" | "1.20"
```

Use CDP to verify QQ Music MV cinema mode stays scoped to the provider pane:

```js
(() => {
  const video = [...document.querySelectorAll("video")]
    .map((node) => ({ node, rect: node.getBoundingClientRect() }))
    .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height))[0];
  const playlistButton = document.querySelector("[data-tikpal-qq-mv-playlist-button]");
  const replayButton = document.querySelector("[data-tikpal-qq-mv-replay-button]");
  return {
    cinema: document.documentElement.dataset.tikpalQqMvCinema || "",
    playlistButton: Boolean(playlistButton),
    playlistText: playlistButton?.innerText || "",
    replayButton: Boolean(replayButton),
    replayVisible: replayButton ? !replayButton.hidden : false,
    frame: Boolean(document.querySelector("[data-tikpal-qq-mv-cinema-frame]")),
    letterbox: document.documentElement.dataset.tikpalQqMvLetterbox || "",
    nativeFullscreen: Boolean(document.fullscreenElement),
    playbackError: /播放失败|错误码undefined|刷新页面重试/.test(document.body?.innerText || ""),
    paused: video ? video.node.paused : null,
    ended: video ? video.node.ended : null,
    nearEnded: video ? (
      video.node.ended ||
      (Number.isFinite(video.node.duration) && video.node.duration > 0 &&
        video.node.duration - video.node.currentTime <= 0.75)
    ) : null,
    currentTime: video ? Math.round(video.node.currentTime * 10) / 10 : null,
    videoRect: video ? {
      width: Math.round(video.rect.width),
      height: Math.round(video.rect.height),
      left: Math.round(video.rect.left),
      top: Math.round(video.rect.top)
    } : null,
    viewport: { width: innerWidth, height: innerHeight }
  };
})()
```

Expected MV behavior: `cinema="1"`, `playlistButton=true`, `playlistText=""`, `frame=true`, `nativeFullscreen=false`, `playbackError=false`, `innerWidth=1920`, `innerHeight=720`, and the video rectangle nearly fills the provider viewport with dark, borderless letterboxing when needed. During playback, the replay icon may exist but stays hidden; at `ended=true` or `nearEnded=true`, `replayVisible=true`. Tapping replay must move the same MV back to the beginning and then report `ended=false`, `nearEnded=false`, and `replayVisible=false` once playback resumes. If the MV initially stalls at a play overlay, it should become `paused=false` after the one-shot auto-play gate. The right `640x720` side panel must remain visible. MV completion does not auto-return or auto-start the next item; use the playlist icon when returning to the list is desired.

Input checks:

```bash
pgrep -af fcitx5
su - moode -c 'DISPLAY=:0 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus fcitx5-remote -n'
gsettings get org.onboard layout
```

Touch a provider search field and confirm Onboard appears above the provider, cycles through EN / Chinese / Japanese / ES, shows a larger CJK candidate window, and hides after outside tap, submit, or single-line Enter.

Audio checks:

```bash
aplay -l
mpc status
sudo fuser -v /dev/snd/*
```

For QQ Music, manually click play if the provider was reopened during deploy. Confirm the QQ player is not muted, audio comes through BT66, and `fuser` shows Chromium holding the expected ALSA device.

## Rollback Notes

- To return from Explore to the main kiosk, use the side panel Back action or `deploy/chromium/tikpal-web-mode.sh close`.
- If provider layout looks compressed, confirm there is no `--force-device-scale-factor` in provider Chromium processes and no `chrome.tabs.setZoom` / `chrome.tabs.getZoom` reference in the deployed extension.
- If Onboard stops changing languages, run `deploy/chromium/tikpal-web-mode.sh --check`, then verify `/usr/share/onboard/scripts/tikpalImeToggle.py`, the generated `Tikpal-Compact-*.onboard` layouts, and `fcitx5-remote -n`.
- If the display becomes too dim to use, recover the DDC value out of band before changing UI gesture mapping.
- If Chromium, MPD, AirPlay, or Spotify contend for BT66, use the Gentoo source handoff helper rather than killing random audio processes.
