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

The physical display prepare helper should run after kiosk start. Its job is to wait for `:0`, disable DPMS/screen saver, retile `HDMI-1` to `2560x720`, and apply the safe HDMI properties that stopped black-screen recovery churn on the Gentoo target.

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

## Display And Power

Brightness through DDC/CI is display-specific and can be non-linear. The Gentoo target should prefer conservative values that keep the screen visible; do not blindly map UI `100%` to raw DDC `100` if that target can black out or become unreadably dim during gesture changes.

Current low-power policy:

- Keep physical screen on for production use.
- Keep Nouveau and avoid proprietary NVIDIA unless retesting display risk.
- Keep CPU governor `schedutil`.
- Prefer `energy_perf_bias=12` over disabling turbo.
- Do not enable TLP or global USB autosuspend.
- Use DDC brightness conservatively; if a raw DDC value makes the panel unreadable, recover with a known visible value before changing UI mapping.

## Validation

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
curl -fsS http://127.0.0.1:8787/api/v1/kiosk/heartbeat
```

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
