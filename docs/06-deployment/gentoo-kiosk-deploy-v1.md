# Gentoo Kiosk Deploy v1

## Goal

Deploy Tikpal on a Gentoo systemd host as the production 2560 x 720 physical kiosk while keeping the existing Raspberry Pi / moOde deployment path intact.

This runbook records the Gentoo migration baseline validated on `192.168.10.117` and later DHCP address `192.168.10.115` in July 2026. The app path stays compatible with the moOde host:

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
TIKPAL_KIOSK_XRANDR_OUTPUT=auto
TIKPAL_KIOSK_XRANDR_MODE=2560x720
TIKPAL_KIOSK_XRANDR_CLONE_OUTPUTS=auto
TIKPAL_KIOSK_XRANDR_PRIMARY_PREFERRED_OUTPUTS="HDMI-1 HDMI-A-1"
TIKPAL_KIOSK_XRANDR_FALLBACK_TO_CONNECTED=1
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

Expected high-signal line with both screens attached:

```text
HDMI-1 connected primary 2560x720+0+0
```

With only the TURZX USB/EVDI screen attached, HDMI may be absent. The long-term contract is still one `2560x720` kiosk, but the primary output falls back to the connected EVDI RandR output, for example:

```text
DVI-I-1-1 connected primary 2560x720+0+0
```

When a TURZX USB/EVDI screen is installed and should mirror the main HDMI kiosk, leave the primary output on `auto`, prefer HDMI, and clone any other connected output:

```conf
TIKPAL_DISPLAY_MIRROR_ENABLED=1
TIKPAL_DISPLAY_MIRROR_OUTPUT=auto
TIKPAL_DISPLAY_PRIMARY_OUTPUT=auto
TIKPAL_DISPLAY_MODE=2560x720
```

Use `auto` rather than a fixed EVDI output name on this Gentoo host. The same TURZX device has appeared as both `DVI-I-1-2` and `DVI-I-1-1` across service install and reboot; the helper resolves the currently connected non-primary output each time.

USB 2.0 TURZX/EVDI output is CPU and bandwidth sensitive at `2560x720`. The
display helper leaves HDMI at its normal refresh, but defaults USB-style RandR
outputs such as `DVI-I-1-1` to `TIKPAL_KIOSK_XRANDR_USB_RATE=29.95`. Set this
to `none` only for temporary recording or animation checks where the extra CPU
cost is acceptable.

On units where the TURZX panel occasionally fails to enumerate at boot, enable
one guarded USB recovery pass in `.env.kiosk`. Keep the PCI device explicit on
the current Gentoo host so recovery only touches the USB controller that owns
the TURZX/BT66 branch:

```conf
TIKPAL_TURZX_USB_RECOVERY_ENABLED=1
TIKPAL_TURZX_USB_RECOVERY_PCI_DEVICE=0000:00:1a.0
TIKPAL_TURZX_USB_RECOVERY_REQUIRE_ERROR=0
TIKPAL_TURZX_USB_RECOVERY_AFTER_SECONDS=8
TIKPAL_TURZX_USB_RECOVERY_SETTLE_SECONDS=8
TIKPAL_TURZX_USB_RECOVERY_MIN_INTERVAL_SECONDS=300
```

This recovery is intentionally guarded and infrequent. It briefly disconnects the
USB devices on that controller, then restarts `display_turzx.service` and waits
again for DRM. A `/run` cooldown keeps automatic restart loops from repeatedly
resetting the USB bus. `TIKPAL_TURZX_USB_RECOVERY_REQUIRE_ERROR=0` is only for
machines where the target USB controller has been confirmed; leave it at the
default `1` on generic hosts so Tikpal does not reset unrelated USB hardware.
If `dmesg` still shows `device descriptor read/64, error -71` or
`unable to enumerate USB device`, the failure is before EVDI and the remaining
field recovery is a physical USB/display power replug.

The safe HDMI-only rollback is:

```bash
DISPLAY=:0 XAUTHORITY=/home/moode/.Xauthority \
  xrandr --output DVI-I-1-1 --off --output DVI-I-1-2 --off \
    --output HDMI-1 --primary --mode 2560x720 --pos 0x0
```

### TURZX USB/EVDI Driver

The TURZX USB panel uses EVDI and `display_turzx.service`. Keep the Tikpal-owned
install wrapper in the repo, and place the approved TURZX source tree under
`deploy/vendor/evdi-display-linux-turzx2/` once redistribution is cleared:

```bash
sudo /home/moode/code/tikpal/deploy/turzx/install-turzx-evdi-display.sh install
```

For one-off field recovery from an already copied source tree:

```bash
sudo /home/moode/code/tikpal/deploy/turzx/install-turzx-evdi-display.sh \
  --source /root/evdi-display-linux-turzx2 install
```

The wrapper installs Gentoo prerequisites such as `x11-drivers/evdi`, verifies
`libevdi.so.1`, calls the TURZX source tree's `make install`, and starts
`display_turzx.service`. The kiosk drop-in soft-depends on this service with
`Wants=display_turzx.service` and `After=display_turzx.service`; HDMI-only hosts
continue to boot even if the TURZX service is absent.

The wrapper also applies Tikpal's TURZX userspace brightness patches before
installing the vendor manager. The patches keep `S`/`R` power messages, add
`B<1-100>` brightness writes, and add a `G` hardware readback diagnostic on
`/tmp/TURZXPmMessagesPort_in`. The write path first sends the existing
`DISPLAY_CMD_BLANK_VALUE` bulk command, so it does not reset mode, restart EVDI,
or touch the HID touch interface. On the current 8.8-inch TURZX panel,
`GET_BACKLIGHT` readback stays at `100` after writes, so the helper falls back
to RandR visual brightness and Tikpal reports `transport:"turzx-soft"`. This is
a perceptual dimming fallback, not panel backlight power saving. The helper
installed at `/usr/local/sbin/tikpal-turzx-brightness` persists the last-known
value under `/var/lib/tikpal/turzx-brightness.json`.

On this `1a86:ad11` panel, sending the unverified vendor brightness command can
make the screen briefly blank before the soft fallback applies. Keep
`TIKPAL_TURZX_HARDWARE_BRIGHTNESS_ENABLED=0` unless a specific unit has a
verified hardware backlight protocol.

For hardware backlight reverse engineering, the current USB panel exposes
`hidraw2` as `hid-multitouch` and `hidraw3` as the `hid-generic` vendor report
interface. Do not write to `hidraw2`. The diagnostic probe installed by the
TURZX wrapper targets only `hidraw3` after checking `HID_NAME=TURZX USB Display`,
`1a86:ad11`, and the `hid-generic` driver:

```bash
sudo /usr/local/sbin/tikpal-turzx-hid-probe describe
sudo /usr/local/sbin/tikpal-turzx-hid-probe read --seconds 2
sudo /usr/local/sbin/tikpal-turzx-hid-probe try-brightness 25 --restore-percent 45
sudo /usr/local/sbin/tikpal-turzx-hid-probe try-brightness 25 \
  --no-report-id-prefix \
  --candidate turing-encrypted-brightness-id14 \
  --restore-percent 45
```

The descriptor on the Gentoo target has a 512-byte Output report and a 512-byte
Input report and no Report ID. Current candidates include both 513-byte
report-id-prefixed writes and exact 512-byte `--no-report-id-prefix` writes for
the existing TURZX register payload `AF 20 05 <value>` and the encrypted command
id `14` pattern documented by the unofficial
[`turing-smart-screen-cli`](https://github.com/phstudy/turing-smart-screen-cli)
work. They do not produce an input report or change the `GET_BACKLIGHT=100`
readback. A direct `HIDIOCSFEATURE` attempt returns `Broken pipe`, consistent
with this descriptor not exposing Feature reports. Until a real hardware report
is verified, do not wire HID writes into the production brightness path; keep
the helper's `turzx-soft` fallback active.

Interface-0 usbmon proof is available through the installed capture helper:

```bash
sudo /usr/local/sbin/tikpal-turzx-usb-probe read
sudo /usr/local/sbin/tikpal-turzx-usbmon-capture 33
sudo /usr/local/sbin/tikpal-turzx-usb-probe try-brightness-exclusive 25 \
  --exclusive \
  --candidate bulk-turing-usb-brightness-id14 \
  --restore-percent 45
```

On the current panel, direct libusb reads return status `0x18`, EDID data, and
backlight `0x64` (`100`). Usbmon shows the patched helper sending
`AF 20 1F 01 AF 20 05 21` for brightness `33`, then
`AF 20 1F 01 AF 20 05 2D` for restore-to-`45`. The following vendor control
read `c1 04` returns `0x64`. That proves the bulk command reaches interface 0,
but it is not the real hardware backlight control for this screen. With the USB
screen allowed to briefly black/flash, the exclusive bulk probe stops
`display_turzx.service`, claims interface 0, tests bounded candidates, then
starts the service and restores brightness `45`. `AF 20` register forms, a full
mode-set-plus-blank-value payload, and the Turing USB DES-CBC command-id `14`
brightness packet all write successfully, but hardware readback remains `100`.
Vendor control-OUT requests `0x04` and `0x05` stall with `LIBUSB_ERROR_PIPE`.

The direct probe can scan read-only vendor control requests:

```bash
sudo /usr/local/sbin/tikpal-turzx-usb-probe scan-controls --start 0x00 --end 0x3f --length 4 --only-nonzero
```

On the Gentoo target, that scan only returns `0x01=status`, `0x02=EDID`, and
`0x04=backlight readback`. There is no alternate short vendor-IN backlight
readback in `0x00..0x3f`.

Gentoo `.env` should expose that helper to the API when the USB panel may be the
primary kiosk output:

```conf
TIKPAL_TURZX_BRIGHTNESS_COMMAND="sudo -n -E /usr/local/sbin/tikpal-turzx-brightness"
TIKPAL_TURZX_BRIGHTNESS_TIMEOUT_MS=2500
TIKPAL_TURZX_DEFAULT_BRIGHTNESS=45
TIKPAL_TURZX_HARDWARE_BRIGHTNESS_ENABLED=0
TIKPAL_TURZX_SOFT_BRIGHTNESS_MIN=0.35
```

The systemd installer installs a dedicated sudoers rule for this one helper.
Tikpal only selects the TURZX brightness path when helper status is available
and the current RandR primary output is `DVI-I-*` or `DVI-D-*`; HDMI/DDC screens
continue through `ddcutil`.

The physical display prepare helper should run before and after kiosk start. Its job is to wait for any configured physical display candidate, prefer HDMI when it is connected, fall back to the connected USB/EVDI output when HDMI is absent, disable DPMS/screen saver, keep the Nouveau PCI path awake, retile the selected primary output to `2560x720`, and apply the safe HDMI properties that stopped black-screen recovery churn on the Gentoo target.

Install the repo-owned helper as the root command used by the systemd drop-in:

```bash
install -o root -g root -m 0755 \
  /home/moode/code/tikpal/deploy/chromium/tikpal-physical-display-prepare.sh \
  /usr/local/sbin/tikpal-physical-display-prepare
mkdir -p /etc/systemd/system/tikpal-kiosk.service.d
cat >/etc/systemd/system/tikpal-kiosk.service.d/physical-display.conf <<'EOF'
[Unit]
Wants=display_turzx.service
After=display_turzx.service

[Service]
Environment=TIKPAL_KIOSK_ENV_FILE=/home/moode/code/tikpal/.env.kiosk
ExecStartPre=+/usr/local/sbin/tikpal-physical-display-prepare wait-ready
ExecStartPost=+/bin/sh -c 'systemctl stop tikpal-physical-display-kick.service >/dev/null 2>&1 || true; systemd-run --quiet --collect --no-block --unit=tikpal-physical-display-kick --property=Type=oneshot --setenv=TIKPAL_KIOSK_ENV_FILE="$TIKPAL_KIOSK_ENV_FILE" --setenv=HOME=/root /usr/local/sbin/tikpal-physical-display-prepare delayed-soft-kick'
EOF
systemctl daemon-reload
```

`deploy/systemd/install-systemd-services.sh --enable-kiosk` installs the same helper and drop-in. The `+` prefix keeps the command root-owned even though `tikpal-kiosk.service` itself runs Chromium as `moode`. The delayed helper is launched as a short transient unit so `tikpal-kiosk.service` does not block, but it is disabled by default and exits without touching the display. Set `TIKPAL_PHYSICAL_DISPLAY_DELAYED_KICK_SECONDS` to a numeric schedule such as `"8 25"` only after proving that a specific display needs a post-start recovery reset; the reset deliberately turns the output off and can otherwise cause a visible black flash. Manual `soft-kick` and watchdog-triggered recovery remain available for an actually black display.

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

## Quiet Boot And No TTY

The production kiosk should not show kernel, systemd, udev, cursor, or `tty1 login` text on the physical screen during normal boot. Run the repo-owned quiet boot helper on Gentoo after GRUB is installed:

```bash
cd /home/moode/code/tikpal
sudo deploy/moode/tikpal-quiet-boot-enable.sh
```

On Gentoo the helper detects `/etc/default/grub`, backs it up, removes visible `console=tty*` routing from `GRUB_CMDLINE_LINUX_DEFAULT`, adds quiet boot flags, sets `GRUB_TIMEOUT_STYLE=hidden` and `GRUB_TIMEOUT=0`, regenerates `/boot/grub/grub.cfg` when `grub-mkconfig` is available, writes systemd/logind/sysctl quiet-console drop-ins, and masks `getty@tty1.service`, `getty@tty2.service`, and `getty@tty3.service`. SSH remains available.

Verify after installation:

```bash
grep -E 'quiet|systemd.show_status=false|rd.systemd.show_status=false|vt.global_cursor_default=0' /etc/default/grub
grep -E 'GRUB_TIMEOUT_STYLE=hidden|GRUB_TIMEOUT=0' /etc/default/grub
grep -E 'console=tty[0-9]*' /etc/default/grub && echo "unexpected visible tty console"
systemctl is-enabled getty@tty1.service getty@tty2.service getty@tty3.service || true
systemctl is-active getty@tty1.service getty@tty2.service getty@tty3.service || true
cat /etc/systemd/system.conf.d/tikpal-quiet-boot.conf
cat /etc/systemd/logind.conf.d/tikpal-quiet-vts.conf
cat /etc/sysctl.d/99-tikpal-quiet-console.conf
```

Reboot once for the GRUB command line to take effect. Emergency kernel failures may still show critical text; ordinary boot should stay quiet until Xorg/Chromium owns the screen.

## Screen Sleep

Tikpal's user-facing Screen Sleep is a soft screen saver, not X11 DPMS power-off. This is intentional for sold kiosk devices that may not ship with a keyboard: the first touch wakes the screen saver and is swallowed, so it does not activate the control underneath.

Automatic Screen Sleep is disabled while Explore has an active provider. Provider login, MV playback, or web-player browsing can be long-running, and the visible provider/side-panel windows sit above the main kiosk. When Explore closes, the kiosk resets the idle timer and resumes the user's configured sleep interval.

On real screen-off entry, Tikpal should briefly show a faint `Touch to wake` hint for the first few seconds, then fade it away. This keeps the saver calm while making it clear that the device is asleep, not black-screened.

Preferences are stored in `.tikpal/ui-preferences.json`:

| Preference | Values | Default |
| --- | --- | --- |
| `displaySleepEnabled` | `true` / `false` | `true` |
| `displaySleepMinutes` | `5`, `10`, `15`, `30`, `60` | `10` |
| `displaySleepStyle` | `meteor_shower`, `clock`, `now_playing`, `starfield`, `signal` | `meteor_shower` |

The selectable styles are intentionally classic and low-risk:

- `meteor_shower`: low-brightness meteor streaks for a living dark screen without looking like a panel fault.
- `clock`: date and clock.
- `now_playing`: current track, artwork, and progress.
- `starfield`: subtle classic starfield animation.
- `signal`: slow music-signal bars with a subdued grid.

Legacy `blank` / `dim_waves` preferences migrate to `meteor_shower`; legacy `dvd` / `dvd_bounce` preferences migrate to `signal`.

Keep `tikpal-physical-display-prepare` disabling DPMS after every soft-kick. Do not expose DPMS/deep power-off as the normal Screen Sleep mode unless touch wake has been revalidated on the target hardware.

## Startup Wizard

The first-use Wizard is a local kiosk guide stored with the browser key
`tikpal.onboardingDismissed.v1`. It is intentionally not a backend preference:
finishing the Wizard hides it on later kiosk reloads, while Settings can still
open it again for training or demos.

The Wizard is a calm gesture preview, not another control surface. It should
always open with the Ambient background visually hidden and scene sound muted,
so first boot does not flash video or start audio unexpectedly. Do not add
visible background/sound toggles to the Wizard; the footer should only expose
the navigation actions `Previous`, `Next`, and `Finish` in the selected UI
language.

Wizard gestures are scoped to the Tikpal room screen. They do not apply inside
Explore provider or side-panel Chromium windows, where the web player owns
touch events. If Settings opens Wizard while Explore is active, Tikpal should
close Explore first through the room-return close path, then show the Wizard on
the restored Focus, Calm, Sleep, or Hi-Fi room screen.

All user-visible Wizard text, including the sample labels inside the gesture
preview, must be translated for the supported device locales: `en`, `zh-CN`,
`de`, `it`, `ko`, `ja`, and `es`. Keep the copy short enough for the
`2560x720` physical kiosk. The sample may keep brand words such as `Tikpal`,
`Ambient`, and `Player`, but helper labels like brightness, volume, previous,
next, and finish should use the active locale.

## Audio Services

The Gentoo audio base uses ALSA direct output to the BT66 USB DAC. The validated `_audioout` route points at BT66, and Chromium provider audio uses the shareable `tikpal_bt66_dmix` device.

Keep these receiver names unique while the old moOde host remains online:

| Receiver | Name |
| --- | --- |
| UPnP / DLNA | `Tikpal-Gentoo-UPnP/AV` |
| AirPlay | `Tikpal-Gentoo-Airplay` |
| Spotify Connect | `Tikpal-Gentoo-Spotify` |
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

### Multi-room Audio

Multi-room Audio is optional and is controlled from Settings -> Preferences -> Multi-room Audio. Roon, Lyrion, and Tikpal Multi-room can be enabled at the same time and wait for playback; Music Assistant is a coming-soon placeholder in the first release. None of these ecosystems appear in the Player source rail, because playback selection and transport remain in their own apps.

Install Roon Bridge with Roon's official Linux installer, then keep the service name as `roonbridge.service`. Lyrion is a Squeezelite endpoint (`squeezelite.service`), not a local Lyrion server. Tikpal Multi-room is a Snapcast endpoint on Gentoo: `tikpal-multiroom.service` runs `snapclient` against the configured Snapcast server or future Tikpal room coordinator, and the Settings card should describe it as `Based on: Snapcast endpoint`.

```bash
systemctl status roonbridge.service
systemctl status squeezelite.service
systemctl status tikpal-multiroom.service
test -d /opt/RoonBridge
test -d /var/roon/RoonBridge
```

For the production Gentoo kiosk, install the root-owned helpers and allow only those helpers through sudo:

```bash
install -o root -g root -m 0755 /home/moode/code/tikpal/deploy/moode/tikpal-multiroom-state.sh /usr/local/sbin/tikpal-multiroom-state
install -o root -g root -m 0755 /home/moode/code/tikpal/deploy/moode/tikpal-roonbridge-state.sh /usr/local/sbin/tikpal-roonbridge-state
install -o root -g root -m 0755 /home/moode/code/tikpal/deploy/moode/tikpal-audio-output-profile.sh /usr/local/sbin/tikpal-audio-output-profile
install -o root -g root -m 0755 /home/moode/code/tikpal/deploy/moode/tikpal-mpd-bitperfect-profile.sh /usr/local/sbin/tikpal-mpd-bitperfect-profile
cat >/etc/sudoers.d/tikpal-roonbridge-mpd <<'EOF'
Defaults:moode env_keep += "TIKPAL_MULTIROOM_ROON_SERVICE TIKPAL_MULTIROOM_ROON_LABEL TIKPAL_MULTIROOM_LYRION_SERVICE TIKPAL_MULTIROOM_LYRION_LABEL TIKPAL_MULTIROOM_TIKPAL_SERVICE TIKPAL_MULTIROOM_TIKPAL_LABEL TIKPAL_ROONBRIDGE_SERVICE TIKPAL_ROONBRIDGE_LABEL TIKPAL_MPD_CONF TIKPAL_MPD_STANDARD_ALSA_DEVICE TIKPAL_MPD_PURE_ALSA_DEVICE TIKPAL_MPD_BITPERFECT_ALSA_DEVICE TIKPAL_MPD_SLEEP_SAMPLE_RATE TIKPAL_MPD_SLEEP_VOLUME_LIMIT TIKPAL_MPD_CUSTOM_OUTPUT_NAME TIKPAL_MPD_CUSTOM_ALSA_DEVICE TIKPAL_MPD_CUSTOM_PURE_DIRECT TIKPAL_MPD_CUSTOM_VOLUME_NORMALIZATION TIKPAL_MPD_CUSTOM_SMOOTH_TRANSITION TIKPAL_MPD_CUSTOM_AUTOMATIC_SAMPLE_RATE TIKPAL_MPD_CUSTOM_DSD_MODE TIKPAL_MPD_CUSTOM_PLAYBACK_STABILITY TIKPAL_MPD_CUSTOM_MIXER_TYPE TIKPAL_MPD_CUSTOM_REPLAY_GAIN_HANDLER TIKPAL_MPD_CUSTOM_FORMAT TIKPAL_MPD_CUSTOM_FIXED_SAMPLE_RATE TIKPAL_MPD_CUSTOM_REPLAYGAIN TIKPAL_MPD_CUSTOM_CROSSFADE TIKPAL_AUDIO_CARD_FORCE"
moode ALL=(root) NOPASSWD:SETENV: /usr/local/sbin/tikpal-multiroom-state, /usr/local/sbin/tikpal-roonbridge-state, /usr/local/sbin/tikpal-audio-output-profile, /usr/local/sbin/tikpal-mpd-bitperfect-profile
EOF
chmod 0440 /etc/sudoers.d/tikpal-roonbridge-mpd
visudo -cf /etc/sudoers.d/tikpal-roonbridge-mpd
```

Recommended Gentoo `.env` values:

```conf
TIKPAL_MULTIROOM_ROON_SERVICE=roonbridge.service
TIKPAL_MULTIROOM_ROON_READY_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state roon ready"
TIKPAL_MULTIROOM_ROON_ACTIVE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state roon active"
TIKPAL_MULTIROOM_ROON_ENABLE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state roon enable"
TIKPAL_MULTIROOM_ROON_DISABLE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state roon disable"
TIKPAL_MULTIROOM_ROON_LABEL_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state roon label"
TIKPAL_MULTIROOM_LYRION_SERVICE=squeezelite.service
TIKPAL_MULTIROOM_LYRION_READY_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state lyrion ready"
TIKPAL_MULTIROOM_LYRION_ACTIVE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state lyrion active"
TIKPAL_MULTIROOM_LYRION_ENABLE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state lyrion enable"
TIKPAL_MULTIROOM_LYRION_DISABLE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state lyrion disable"
TIKPAL_MULTIROOM_LYRION_LABEL_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state lyrion label"
TIKPAL_MULTIROOM_TIKPAL_SERVICE=tikpal-multiroom.service
TIKPAL_MULTIROOM_TIKPAL_READY_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state tikpal ready"
TIKPAL_MULTIROOM_TIKPAL_ACTIVE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state tikpal active"
TIKPAL_MULTIROOM_TIKPAL_ENABLE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state tikpal enable"
TIKPAL_MULTIROOM_TIKPAL_DISABLE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state tikpal disable"
TIKPAL_MULTIROOM_TIKPAL_LABEL_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state tikpal label"
TIKPAL_ROONBRIDGE_SERVICE=roonbridge.service
TIKPAL_ROONBRIDGE_READY_COMMAND="sudo -n -E /usr/local/sbin/tikpal-roonbridge-state ready"
TIKPAL_ROONBRIDGE_ACTIVE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-roonbridge-state active"
TIKPAL_ROONBRIDGE_ENABLE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-roonbridge-state enable"
TIKPAL_ROONBRIDGE_DISABLE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-roonbridge-state disable"
TIKPAL_ROONBRIDGE_LABEL_COMMAND="sudo -n -E /usr/local/sbin/tikpal-roonbridge-state label"
```

Active multi-room playback means the ecosystem process is holding an ALSA PCM device, not merely that a systemd service is running. Roon matches `RoonBridge|RAATServer`, Lyrion matches `squeezelite`, and Tikpal Multi-room matches `tikpal-multiroom|snapclient|snapserver`. When active, Tikpal reports the ecosystem as the current playback source, pauses local MPD files, stops MPD Radio streams, and does not claim fake metadata, artwork, or lyrics. Stopping an ecosystem restores only the MPD/Radio playback that was active when that same ecosystem was started, and only if no other multi-room player is active.

If `tikpal-multiroom.service` is installed as a local Snapcast endpoint, keep it disabled by default until the user turns Tikpal Multi-room on in Settings. The service should be safe to start and stop repeatedly; the active check still depends on ALSA ownership so an idle `snapclient` does not make Tikpal claim room playback.

Validation:

```bash
curl -fsS http://127.0.0.1:8787/api/v1/multiroom
curl -fsS http://127.0.0.1:8787/api/v1/roonbridge
sudo -n -E /usr/local/sbin/tikpal-multiroom-state roon active
sudo -n -E /usr/local/sbin/tikpal-multiroom-state lyrion ready
sudo -n -E /usr/local/sbin/tikpal-roonbridge-state active
sudo fuser -v /dev/snd/*
mpc status
```

### Audio Output Profiles

Settings -> Preferences -> Audio Output exposes four MPD listening profiles:

- `Pure Listening` rewrites only the Tikpal-managed MPD output block, backs up `/etc/mpd.conf`, uses a real hardware ALSA device such as `hw:CARD=BT66,DEV=0`, sets `mixer_type "none"`, disables ReplayGain handling, avoids output `format` conversion, and locks MPD software volume. User-facing volume still adjusts the output level through `TIKPAL_OUTPUT_VOLUME_SET_COMMAND` when that helper is configured; it must not be silently disabled just because MPD software volume is locked.
- `Everyday` is the default. It keeps `_audioout`, MPD software volume, ReplayGain auto, two-second crossfade, and the shared route that works well with Tikpal Library and Radio.
- `Sleep / Meditation` keeps `_audioout`, sets MPD output `format "48000:*:*"`, uses ReplayGain track, five-second crossfade, caps MPD/Radio volume at `45%`, and schedules MPD stop after 60 minutes. [MPD documents audio output `format`](https://mpd.readthedocs.io/en/stable/mpd.conf.5.html#audio-output) as `sample_rate:bits:channels`, and any field can be `*` when it should not be forced.
- `Custom` uses six user-facing switches saved in `.tikpal/ui-preferences.json`: `Pure Direct`, `Volume Normalization`, `Smooth Transition`, `Automatic Sample Rate`, `DSD Mode`, and `Playback Stability`. The API passes those switches to the root helper as `TIKPAL_MPD_CUSTOM_*` environment flags whenever Custom is applied. Keep lower-level buffer, IRQ, and resampler details in Audio Diagnostics, not in the normal user flow.

Custom is intentionally treated as an advanced path. The kiosk UI shows a short red caution line above the custom switches, and copy should stay concise enough that it does not push the switch grid below the 2560 x 720 Settings viewport.

Custom switch mapping:

- `Pure Direct`: uses the real hardware ALSA device and `mixer_type "none"`.
- `Volume Normalization`: uses MPD ReplayGain auto unless Pure Direct is on.
- `Smooth Transition`: sets MPD crossfade to 2 seconds.
- `Automatic Sample Rate`: leaves MPD output `format` unset; when off, Custom fixes `format` to `48000:*:*` by default.
- `DSD Mode`: writes MPD ALSA `dop "yes"` for DSD-over-PCM. Only enable it for DACs known to support DoP.
- `Playback Stability`: writes conservative ALSA `buffer_time` / `period_time` values for fewer underruns.

The legacy `tikpal-mpd-bitperfect-profile` helper remains as a wrapper: `strict` maps to `pure`, and `standard` maps to `everyday`.

Recommended Gentoo `.env` values:

```conf
TIKPAL_AUDIO_OUTPUT_PROFILE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-audio-output-profile %PROFILE%"
TIKPAL_MPD_BITPERFECT_PROFILE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-mpd-bitperfect-profile %MODE%"
TIKPAL_MPD_STANDARD_ALSA_DEVICE=_audioout
TIKPAL_MPD_PURE_ALSA_DEVICE=hw:CARD=BT66,DEV=0
TIKPAL_MPD_BITPERFECT_ALSA_DEVICE=hw:CARD=BT66,DEV=0
TIKPAL_MPD_SLEEP_SAMPLE_RATE=48000
TIKPAL_MPD_SLEEP_VOLUME_LIMIT=45
TIKPAL_MPD_CUSTOM_OUTPUT_NAME="Tikpal Custom"
TIKPAL_MPD_CUSTOM_ALSA_DEVICE=_audioout
TIKPAL_MPD_CUSTOM_PURE_DIRECT=0
TIKPAL_MPD_CUSTOM_VOLUME_NORMALIZATION=1
TIKPAL_MPD_CUSTOM_SMOOTH_TRANSITION=1
TIKPAL_MPD_CUSTOM_AUTOMATIC_SAMPLE_RATE=1
TIKPAL_MPD_CUSTOM_DSD_MODE=0
TIKPAL_MPD_CUSTOM_PLAYBACK_STABILITY=1
TIKPAL_MPD_CUSTOM_MIXER_TYPE=
TIKPAL_MPD_CUSTOM_REPLAY_GAIN_HANDLER=
TIKPAL_MPD_CUSTOM_FORMAT=
TIKPAL_MPD_CUSTOM_FIXED_SAMPLE_RATE=48000
TIKPAL_MPD_CUSTOM_REPLAYGAIN=
TIKPAL_MPD_CUSTOM_CROSSFADE=
```

`Pure Listening` is intentionally not the default. It can make MPD software volume, Loopback spectrum, ReplayGain, and shared-output convenience unavailable. However, the Player/side-panel volume slider should remain usable on Gentoo when the output-volume helper can write the hardware or system output level. Roon, AirPlay, Spotify, DLNA, Explore, and provider audio are outside these MPD presets.

Profile switching must stay bounded. The helper now wraps `mpc` and `systemctl` calls with short timeouts, stops a stuck `mpd.service` with a bounded SIGTERM/SIGKILL fallback, enables only the selected Tikpal-managed MPD output, and applies ReplayGain/crossfade/volume settings through best-effort `mpc` calls. The API wraps profile changes in the MPD mutation lock, captures current MPD/Radio playback before the helper runs, then performs only a short best-effort restore instead of waiting indefinitely for MPD to prove `playing`. This avoids a successful profile change looking like a failed Settings action when MPD or a NAS-backed queue responds slowly.

Useful tuning knobs:

| Variable | Default | Purpose |
| --- | --- | --- |
| `TIKPAL_MPC_TIMEOUT_SECONDS` | `1` | Per-`mpc` command timeout inside the root helper. |
| `TIKPAL_MPD_STOP_TIMEOUT_SECONDS` | `2` | Time allowed for a clean MPD stop before forced recovery. |
| `TIKPAL_MPD_START_TIMEOUT_SECONDS` | `5` | Time allowed for MPD start after profile rewrite. |
| `TIKPAL_AUDIO_OUTPUT_RESTORE_MPC_TIMEOUT_MS` | `1000` | API-side `mpc` timeout during playback restore. |
| `TIKPAL_AUDIO_OUTPUT_RESTORE_ATTEMPTS` | `2` | API-side best-effort `mpc play` attempts after a profile switch. |
| `TIKPAL_AUDIO_OUTPUT_RESTORE_SETTLE_MS` | `200` | Short settle between restore attempts. |

Do not reintroduce long profile-change loops that block the Preferences request. The frontend allows a longer Preferences write timeout for real MPD profile changes, but the backend should normally return in a few seconds and let regular state polling refresh playback truth.

Validation:

```bash
sudo -n -E /usr/local/sbin/tikpal-audio-output-profile pure
mpc clear && mpc add "Codex/<known-flac-or-wav>" && mpc play
cat /proc/asound/card*/pcm*p/sub*/hw_params
sudo -n -E /usr/local/sbin/tikpal-audio-output-profile everyday
sudo -n -E /usr/local/sbin/tikpal-audio-output-profile sleep
sudo -n -E /usr/local/sbin/tikpal-audio-output-profile diagnostics
curl -fsS http://127.0.0.1:8787/api/v1/audio/output-diagnostics
```

API timing check from the Gentoo host:

```bash
for profile in everyday sleep custom pure; do
  start=$(date +%s%3N)
  curl -fsS -X PATCH http://127.0.0.1:8787/api/v1/preferences \
    -H "Content-Type: application/json" \
    --data "{\"audioOutputProfile\":\"$profile\"}" >/dev/null
  end=$(date +%s%3N)
  printf '%s %sms\n' "$profile" "$((end-start))"
  mpc status | sed -n '1,3p'
done
```

On the 2026-08-01 Gentoo `192.168.10.115` validation run, `Custom`, `Sleep`, and `Pure Listening` returned in roughly `0.7s-3.1s` after the bounded restore change. The first `Sleep -> Everyday` switch could still take around `7s-8s` while MPD reopened the shared output path, but it no longer timed out and playback recovered.

On the same host, Pure Listening / strict mode was validated with Radio playing: `POST /api/v1/playback/actions {"type":"volume_set","value":46}` moved `system.volume.percent` from `45` to `46`, and a second write restored `45` without interrupting Radio playback. This is the expected contract: MPD software volume stays locked for the direct-output profile, while the physical output level remains adjustable.

Startup volume is deliberately conservative. Keep `TIKPAL_MPD_STARTUP_VOLUME=30` in the Gentoo environment: on `tikpal-api` start, the backend first sets MPD software volume and the configured output-volume helper to 30% before any remembered Library/Radio/Scene restore runs. This is the reboot anti-blast guard, not a new remembered playback volume; the user's last nonzero volume in `.tikpal/audio-volume-state.json` remains available for later playback restore. If the physical helper is unavailable, MPD is still primed and the failure is logged without blocking boot.

## Explore Provider Mode

Explore is not a restorable Tikpal audio source. It pauses local MPD/Radio, releases external receiver intakes, and opens a provider web player in a separate left Chromium window. The side panel remains a local Tikpal surface.

The physical layout is fixed:

| Surface | Geometry |
| --- | --- |
| Main Tikpal kiosk | `2560x720` at `0,0` |
| Explore provider | `1920x720` at `0,0` |
| Explore side panel | `640x720` at `1920,0` |

The physical Gentoo path uses a resident provider pool by default:

```conf
TIKPAL_WEB_MODE_PROVIDER_POOL=1
TIKPAL_WEB_MODE_PROVIDER_IDLE_POOL_ENABLED=1
TIKPAL_WEB_MODE_PROVIDER_PREWARM_ENABLED=1
TIKPAL_WEB_MODE_PROVIDER_PREWARM_CONTINUE_AFTER_CLOSE=1
TIKPAL_WEB_MODE_PROVIDER_PREWARM_DELAY_SECONDS=0.75
TIKPAL_WEB_MODE_PROVIDER_PREWARM_MAX_CONCURRENT_LAUNCHES=2
TIKPAL_WEB_MODE_PROVIDER_PREWARM_LOCK_TIMEOUT_SECONDS=2
TIKPAL_WEB_MODE_CLOSE_WARM_ENABLED=1
TIKPAL_WEB_MODE_CLOSE_KEEP_RESIDENT=1
TIKPAL_WEB_MODE_CLOSE_WARM_TTL_SECONDS=45
TIKPAL_WEB_MODE_CLOSE_AUDIO_GATE_SETTLE_SECONDS=0.35
TIKPAL_WEB_MODE_CLOSE_REFILL_PROVIDER_POOL_ENABLED=1
TIKPAL_WEB_MODE_X11_SYNC_WINDOW_OPS=0
TIKPAL_WEB_MODE_RESIDENT_SWITCH_SETTLE_SECONDS=0.16
TIKPAL_WEB_MODE_PROVIDER_SWITCH_FADE_SECONDS=0.16
TIKPAL_WEB_MODE_TRANSITION_MIN_VISIBLE_SECONDS=0.75
TIKPAL_WEB_MODE_BOOT_PREWARM_ENABLED=1
TIKPAL_WEB_MODE_BOOT_PREWARM_READY_TIMEOUT_SECONDS=30
TIKPAL_WEB_MODE_BOOT_PREWARM_INITIAL_DELAY_SECONDS=5
```

Opening Explore places the right side panel at its final geometry while Tikpal audio is released, then opens the requested provider and prewarms the remaining fixed providers in the offscreen stage at `2560,0`: Suno, Spotify, YouTube Music, Apple Music, TIDAL, Qobuz, Deezer, Amazon Music, QQ Music, and NetEase Cloud Music. Initial entry has no full-screen veil: the provider waits for a first painted surface (or the bounded `TIKPAL_WEB_MODE_ENTRY_PROVIDER_PAINT_TIMEOUT_SECONDS`) before it is revealed after `TIKPAL_WEB_MODE_ENTRY_REVEAL_SETTLE_SECONDS`. If audio release fails, the prepared panel is parked and the provider open is rejected. The branded background and transition pages are safety underlays for provider-to-provider switching, not initial entry. They must not draw visible signal rails, logo-floor edge lines, or repeated vertical texture lines; provider identity is carried by typography and tone only, so the left pane never shows a stray vertical line during slow X11 paints. Once a real provider window is visible, the window guard must park this branded background offscreen and lower it; keeping both the background and active provider at `0,0 1920x720` can make the left pane flicker between the two windows on X11/EVDI mirror setups. The guard also reasserts provider and side-panel stacking above the full-screen kiosk periodically without stealing focus, because X11/EVDI mirror setups can occasionally leave a correctly tiled provider behind the main kiosk window. `deploy/chromium/tikpal-web-mode.sh close` uses the warm return path by default: it parks resident providers and the side panel offscreen in parallel, removes any stale legacy `exit-stage` profile, and schedules delayed full cleanup if Explore is not reopened.

Boot prewarm begins only after the main kiosk Chromium profile has a visible X11 window in two consecutive samples. It waits at most `TIKPAL_WEB_MODE_BOOT_PREWARM_READY_TIMEOUT_SECONDS` (30 seconds by default), then applies `TIKPAL_WEB_MODE_BOOT_PREWARM_INITIAL_DELAY_SECONDS` (5 seconds by default) as a post-stability delay; a missing or disappearing kiosk window skips that boot's prewarm rather than adding load to a failed startup. Background prewarm uses the fixed provider order with a `0.75` second stagger and at most `TIKPAL_WEB_MODE_PROVIDER_PREWARM_MAX_CONCURRENT_LAUNCHES=2` workers. A worker waits for the full readiness probe before it writes `Ready`: a real HTTPS CDP page, `document` no longer loading, and either 80 body characters or three visible interactive/media elements in two samples 200 ms apart, bounded by `TIKPAL_WEB_MODE_PROVIDER_READY_TIMEOUT_SECONDS` (18 seconds by default). The same probe gates sync and guard promotions. The background prewarm process remains detached from the active open command with `setsid` or `nohup`, otherwise a finished active open can still look slow while the background queue continues. With `TIKPAL_WEB_MODE_PROVIDER_PREWARM_CONTINUE_AFTER_CLOSE=1`, that detached prewarm queue continues after a user closes Explore, so opened provider processes are not killed merely because the visible stage returned to the main room; windows must remain offscreen at `2560,0` until the user explicitly selects that provider or runs `close-full`. A foreground non-resident open cancels the remaining queue before it launches another background worker. Active provider opens still use their first-paint gate for visible entry; full readiness is promoted independently. The launcher seeds queued providers as `Prewarming` before their individual launch turn, records `prewarmComplete` only after the entire queue and final reconciliation finish, and the Ambient source picker requires both this queue marker and terminal card states. `Opening` is reserved for the provider the user explicitly selected. Short state-write locking plus the final pool sync preserve concurrent workers' `residentProviders` updates. When Proxy is off, the launcher must run a short direct reachability probe against each provider's own URL; only providers that fail that probe are marked internally as `check_proxy`, shown to the user as `Needs proxy`, and skipped, while direct-reachable providers continue to open or prewarm. QQ Music and NetEase Cloud Music are direct-preferred providers: even when global Proxy is on, the launcher and MV3 extension keep these two providers in direct mode, including after navigation to `y.qq.com` or `music.163.com`; they also direct-launch their official URL, skip the transition URL bootstrap gate, and rely only on the short first-paint gate before reveal.

Every real provider switch pauses the old provider's media via CDP `__tikpalProviderAudioGate.setActive(false)` to prevent audio mixing. A real HTTPS CDP page allows the resident path to skip the cold fade/paint gate, but CDP readiness is not physical-window readiness. The foreground switch must validate the target, previous, and panel windows, move the target from the `2560,0` stage into `0,0 1920x720`, keep the panel at `1920,0 640x720`, hide and park the previous provider, then write `activeProvider`. It must not rely on a later guard scan to make those surfaces true. Detached reconcile still checks ownership before and after its work so stale jobs cannot overwrite a newer choice. Synchronous `xdotool --sync` remains a compatibility fallback; the normal path may use asynchronous X11 movement only when subsequent physical geometry proves it completed.

Resident state is page-based, not process-based: `Ready` requires a CDP `type:"page"` target at a real `https://` provider URL, a complete document, and either 80 body characters or three visible interactive/media elements in two samples 200 ms apart. A cached Chromium window, local transition page, error page, or a real page that has not passed both full probes must remain `Prewarming` or show `Check setup`; the side panel never promotes a stale bootstrap surface. State files are atomically replaced, and inactive guards may not change `activeProvider`; together with the active-provider check around detached reconcile work, this prevents concurrent guards or older prewarm jobs from overwriting a newer selection. A provider error page whose reason is `region_unavailable` is retained as that explicit state instead of being reduced to `Check setup`: the side panel and error page tell the user to choose a Proxy exit that supports the service. QQ's scoped `QQ音乐提醒您` reminder may press only its `取消` control; login, client-download, payment, membership, and authorization prompts remain manual.

Background providers stay muted and page-paused through the provider audio gate. Returning to a resident provider must clear tab mute, unmute media elements, and resume only the media that was playing when the provider was hidden. Repeated inactive guard polling must not overwrite that resume intent after the page is already paused. Provider guard replacement must wait for the old guard to exit and force-kill it if needed; duplicate guards polling the same QQ Music page can amplify flicker and high CPU on X11/EVDI mirror setups. If an offscreen prewarm times out before the SPA reaches its real host, the per-provider guard must later clear stale `check_setup` once CDP reports an expected provider URL such as `https://tidal.com/`.

When close or prewarm discovers provider profile processes already running, it resyncs `residentProviders` through the same full probe. This keeps the side panel aligned with the resident pool after API restarts or warm closes without marking an offscreen provider `Ready` before its page is actually usable.

Provider profiles keep their login state and normal Chromium disk cache across a system shutdown, including cookies, local storage, IndexedDB, and service-worker resources. A reboot still needs to restart browser processes, restore network sessions, and revalidate provider/DRM state; it does not reuse media payloads as offline content. Before launching a provider, the launcher only repairs an empty or missing Widevine CDM directory by copying `WidevineCdm` from the first existing Chromium or provider profile that already has `libwidevinecdm.so`; it must not delete the provider profile to solve protected-playback failures such as TIDAL `S6001`.

Close uses the warm resident path by default: it moves the right side panel and resident provider windows offscreen directly, leaves per-provider guards running so inactive pages stay paused/muted, and keeps the provider pool alive for the next Explore open. The already-running main kiosk returns directly to Ambient; the room-state chooser is startup-only, so close introduces no extra return card, overlay, or visible delay. With `TIKPAL_WEB_MODE_CLOSE_REFILL_PROVIDER_POOL_ENABLED=1`, warm close also starts an idle offscreen `warm-pool`, so a user who exits before background prewarm finishes still ends up with all ten provider profiles resident. The idle refill must pause if Explore becomes active again, letting the foreground open command own the visible provider and side panel. If `TIKPAL_WEB_MODE_CLOSE_KEEP_RESIDENT=0`, delayed full cleanup runs after `TIKPAL_WEB_MODE_CLOSE_WARM_TTL_SECONDS` when Explore is not reopened. This makes close -> immediate reopen feel like a reveal from a warm pool instead of a full Chromium cold start. API-side close cleanup carries a runtime `closeRequestId`: if the user opens Explore again before cleanup and playback restore finish, the stale close must not clear the newer `activeProvider`, close the newly revealed provider through the window guard, or resume MPD/Radio behind it. Closing also removes any legacy `exit-stage` window from earlier versions.

Proxy On/Off is treated as a reachability change for the entire resident pool. In Settings -> Link -> Explore Proxy, changing the local switch first asks the user to confirm the target state; confirmation persists the setting and immediately restarts the system, while cancellation changes nothing. The Proxy URL draft still saves automatically without a restart. The guarded Remote path remains an immediate runtime change. The Explore side panel only displays read-only `Proxy On` / `Proxy Off` status and must not hot-toggle proxy while the provider pool is resident. Error pages should point users to Settings, not to the side panel. After a Remote change applies the new proxy mode to the active provider, the launcher restarts background prewarm with a forced seed so inactive cards move back through `Prewarming` and re-evaluate to `Ready` or `Needs proxy` instead of keeping stale status. Existing inactive provider processes are not killed, but forced prewarm navigates their CDP page target back to the provider URL so a previous Tikpal error page or network timeout is retried under the new proxy mode.

The proxy truth is `.tikpal/web-mode-settings.json`; the launcher fallback should prefer a proxy on the same Gentoo host:

```conf
TIKPAL_WEB_MODE_DEFAULT_PROXY_URL=http://127.0.0.1:7897
```

If the proxy runs on a separate LAN machine, set it in Settings -> Link -> Explore Proxy or in `.tikpal/web-mode-settings.json`, for example `http://192.168.10.148:7897`. Do not leave a DHCP-specific proxy IP hard-coded in the repo defaults.

Remote proxy changes use the MV3 extension and refresh the active provider page while keeping its profile and window. The side panel status must read `Proxy On` or `Proxy Off`; do not use `Direct` as the visible state because direct mode still cannot reach several providers on this network. Cookies and login state stay in per-provider Chromium profiles under:

```bash
/home/moode/.config/tikpal-web-mode/providers/<provider>
```

The Explore side-panel provider text-size control uses `providerTextScale`; the local Console proxy page intentionally does not expose it:

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
- May close safe cookie/trial/client prompts, but must not click login, payment, membership, subscription, purchase, authorization, or native-client download actions. Trial context and the candidate action label are checked separately, so a dismiss-looking element inside a `Try it free`, `$0.00`, unlimited-access, or subscription action is never clicked.
- For QQ Music, may unmute the web player when playback is active but the QQ volume button is muted.
- QQ Music ordinary playback uses `TIKPAL_WEB_MODE_QQ_MUSIC_AUTO_PLAY=1` to start a paused resident QQ player. The guard treats the bottom global play button as insufficient by itself: if QQ shows a false playing state but has no current row or recent playback resource, it clicks the first real queue-row play button instead. After real playback is detected, `TIKPAL_WEB_MODE_QQ_AUDIO_PRIME=1` keeps a very-low-gain WebAudio keepalive running while QQ is playing so Chromium does not release the ALSA device mid-track. The one-shot play gate prevents Tikpal from fighting a later manual pause, and the keepalive closes when QQ is paused, muted, or hidden. QQ Music MV uses wrapper cinema mode by default: `TIKPAL_WEB_MODE_QQ_MV_CINEMA_MODE=1`, `TIKPAL_WEB_MODE_QQ_MV_AUTO_PLAY=1`, and `TIKPAL_WEB_MODE_QQ_MV_AUTO_FULLSCREEN=0`.
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

The Fcitx5 profile contains these input methods:

```text
keyboard-us
pinyin
keyboard-de
keyboard-it
hangul
anthy
keyboard-es
```

Onboard starts in English and uses one Tikpal IME key to toggle only between English and the current UI language's input method:

```text
EN <-> selected UI language
```

Chinese and Japanese keep QWERTY letter keys because users type pinyin and romaji. German, Italian, Spanish, and Korean use visual keycap variants for their expected layouts: German shows QWERTZ plus `Ä/Ö/Ü/ß`, Italian shows `à/è/ì/ò/ù`, Spanish shows `Ñ`, `¡ ¿`, accent/dead-key hints, and `Ç`, and Korean shows 2-beolsik Hangul hints. The key labels change to reflect the current mode; the underlying Onboard key IDs stay compatible with XTest.

On Gentoo, Korean input needs `app-i18n/fcitx-hangul` in addition to the existing `app-i18n/fcitx`, `app-i18n/fcitx-chinese-addons`, `app-i18n/fcitx-anthy`, `app-i18n/fcitx-gtk`, and `app-i18n/fcitx-qt` packages. German, Italian, and Spanish are Fcitx keyboard layouts and do not need extra candidate engines.

Install and verify the multilingual UI font set before judging Chromium rendering:

```bash
emerge --ask=n media-fonts/noto-cjk media-fonts/noto-emoji media-fonts/source-han-sans media-fonts/wqy-zenhei media-fonts/inter media-fonts/roboto media-fonts/fira-sans media-fonts/nanum
fc-cache -fv
fc-match 'sans:lang=zh-cn'
fc-match 'sans:lang=ja'
fc-match 'sans:lang=ko'
fc-match 'serif:lang=zh-cn'
fc-match 'monospace:lang=zh-cn'
```

Tikpal's Settings -> Font presets are intentionally curated rather than a full system-font browser:

| Preset | Primary intent |
| --- | --- |
| System Neo | Inter plus Noto CJK fallback for the regular device UI. |
| CJK Sans | Noto Sans CJK SC / JP / KR for Chinese, Japanese, and Korean UI. |
| Source Han | Source Han Sans CN first, useful when Simplified Chinese is the dominant language. |
| Editorial CJK | Noto Serif CJK for lyric walls and warmer reading surfaces. |
| Modern Sans | Inter / Roboto / Fira Sans for Latin-language UI, with CJK fallback. |
| Mono Grid | Noto Sans Mono CJK plus mono fallbacks for technical-looking surfaces. |

Candidate fonts follow the active input mode: Chinese uses `Noto Sans CJK SC 16`, Japanese uses `Noto Sans CJK JP 16`, Korean uses `Noto Sans CJK KR 16`, and all fall back to `Source Han Sans CN 16` or `WenQuanYi Zen Hei 16`. The regular UI font stack must keep CJK coverage so Chromium does not fall back to Liberation for Chinese.

Onboard keycap labels should follow Settings -> Font. The kiosk writes the active `fontTheme` into `.tikpal/ui-preferences.json`; the API persists it through `/api/v1/preferences`, and `tikpalImeToggle.py` reads that file before setting Onboard's `org.onboard.theme-settings key-label-font`. Language changes use `--set-locale` to keep English as the default mode while updating the selected-language pair; font-only changes use the lighter `--sync` path so the user does not lose a temporary input-method choice.

The Onboard language key keeps its own runtime pair state in `.tikpal/onboard-ime-state.json` and `~/.config/tikpal/onboard-ime-state.json`. This is deliberate: relying only on `fcitx5-remote -n` during a touch click can bounce between `keyboard-us` and `pinyin` while Onboard reloads layouts. The no-argument `tikpalImeToggle.py` path is the live Onboard key path; it reads the current UI locale target, toggles between `keyboard-us` and that target, writes Fcitx `DefaultIM`, switches the current input method, applies the matching layout, and asks Onboard to stay visible. `--set-mode`, `--set-locale`, and `--sync` remain safe for Settings/API preference sync and do not pop the keyboard open unexpectedly.

Local kiosk text fields, including Settings -> Library -> NAS Add/Edit, request Onboard with `keyboardTarget:"kiosk"`. The API passes this as `TIKPAL_WEB_MODE_KEYBOARD_TARGET=kiosk`, and `tikpal-web-mode.sh` restores X focus to the main kiosk Chromium profile after the Onboard window is raised. Provider pages keep the default `auto` target, so Explore login fields still use provider-focused recovery instead of stealing focus back to the kiosk.

The default API hooks on Gentoo are:

```conf
TIKPAL_UI_INPUT_METHOD_SYNC_COMMAND='if [ -f /usr/share/onboard/scripts/tikpalImeToggle.py ]; then TIKPAL_APP_DIR=%APP_DIR% TIKPAL_FONT_THEME=%FONT_THEME% python3 /usr/share/onboard/scripts/tikpalImeToggle.py --set-locale %LOCALE%; fi'
TIKPAL_UI_KEYBOARD_VISUAL_SYNC_COMMAND='if [ -f /usr/share/onboard/scripts/tikpalImeToggle.py ]; then TIKPAL_APP_DIR=%APP_DIR% TIKPAL_FONT_THEME=%FONT_THEME% python3 /usr/share/onboard/scripts/tikpalImeToggle.py --sync; fi'
```

Expected keycap font examples:

| Font preset | Typical Onboard `key-label-font` |
| --- | --- |
| System Neo | `Inter 12` |
| CJK Sans | `Noto Sans CJK SC 12` |
| Source Han | `Source Han Sans CN 12` |
| Editorial CJK | `Noto Serif CJK SC 12` |
| Modern Sans | `Inter 12`, `Roboto 12`, or `Fira Sans 12` depending on installed packages. |
| Mono Grid | `Noto Sans Mono CJK SC 11` |

Third-party fonts such as MiSans, HarmonyOS Sans, or LXGW WenKai are optional drop-ins. Place `.ttf` / `.otf` files under `/usr/local/share/fonts/tikpal/`, run `fc-cache -fv`, verify with `fc-match`, and only then add the family to Tikpal's font stack.

Tikpal UI language and font choice are device preferences, not browser-only settings. The backend stores them in:

```bash
/home/moode/code/tikpal/.tikpal/ui-preferences.json
```

The supported locales are `en`, `zh-CN`, `de`, `it`, `ko`, `ja`, and `es`. The supported font themes are `system`, `hardware`, `precision`, `sans`, `serif`, and `mono`. The kiosk, Explore side panel, portable Remote, and Tikpal-owned Explore error page read the same preference through `GET /api/v1/preferences`; only the local kiosk should write it through `PATCH /api/v1/preferences`. `GET /api/v1/system/state`, `/api/v1/remote/state`, and `/api/v1/web-mode/state` also include `preferences` so surfaces can stay in sync after polling.

The local kiosk also caches the last validated locale in browser storage as `tikpal.locale`. At startup, any valid cached value from the complete supported locale set is the first rendered language; the later preference fetch remains authoritative and replaces it if another local user or device setting has changed it. With no valid cache, the kiosk leaves the React surface unrendered until `GET /api/v1/preferences` resolves. This prevents the old English-first frame followed by a Chinese, German, Italian, Korean, Japanese, or Spanish repaint.

Changing Settings -> Preferences -> Language keeps the default input method as English and updates the language key's paired target:

| Locale | Language-key target |
| --- | --- |
| `en` | `keyboard-us` |
| `zh-CN` | `pinyin` |
| `de` | `keyboard-de` |
| `it` | `keyboard-it` |
| `ko` | `hangul` |
| `ja` | `anthy` |
| `es` | `keyboard-es` |

`start-tikpal-kiosk-session.sh` reads `.tikpal/ui-preferences.json` before starting Fcitx5 and writes `DefaultIM=keyboard-us`. `tikpalImeToggle.py --set-locale <locale>` is the best-effort runtime hook used after a language change; it keeps the current/default mode English and stores the matching target for the language key. `--set-mode <fcitx-id>` remains available for diagnostics or explicit one-off switching. Failure to sync the keyboard should be logged as a warning, not block saving the UI language.

Onboard should only appear for text-like fields after real focus or tap. It should stay hidden for buttons, checkboxes, selectors, provider entry, and LAN browsers that view `http://<gentoo-ip>:4173/`.

Never start Fcitx as root. `tikpalImeToggle.py` refuses root execution unless `TIKPAL_ALLOW_ROOT_IME_SYNC=1` is explicitly set for a controlled diagnostic. A root-owned Fcitx instance can steal the X/DBus input context from the `moode` kiosk session and make Chinese/Japanese/Korean candidate entry feel intermittent.

## Player Library UX

The Gentoo physical kiosk uses the same Player Library contract as moOde:

- `Local`, `NAS`, `USB`, `Favorites`, and `Recently Added` are flat storage/filter tabs.
- Local, NAS, and USB rows show compact audio/file information when the backend exposes codec, sample rate, bit depth, channel count, bitrate, or file size.
- Keep `TIKPAL_USB_LIBRARY_AUTO_UPDATE=0` on the physical Gentoo kiosk. Browsing USB can scan the mounted filesystem for visible rows, but it should not launch `mpc update USB` in the background while the user seeks or plays Local/NAS music. `TIKPAL_USB_LIBRARY_AUTO_MOUNT` defaults to `1`: the library sync helper waits briefly for newly inserted USB storage, mounts current partitions under `/run/media/tikpal/<label-or-uuid>`, then links them into `USB/<mount name>`. This is generic for swapped USB drives and is not tied to `/dev/sda1`; if mounting fails, the helper warns and continues without blocking Local/NAS. Do not keep legacy 30-second USB sync timers such as `tikpal-usb-audio-sync.timer` enabled on the physical kiosk; use Settings -> Library -> Scan library for an explicit MPD index refresh, with `TIKPAL_MPC_UPDATE_TIMEOUT_SECONDS=8` as the default guardrail.
- USB rows expose `Copy to Local`; the backend should not overwrite same-name Local files and should report `Already in Local` when no copy is needed. Copied files live under `Codex/USB Imports/...`; `tikpal-local-library-sync.sh` must protect that imports directory while still using `rsync --delete` for repo-owned Local music, so copied tracks survive reboot and service reinstall.
- Local rows expose `Delete`, but the first tap only reveals `Yes` and `No`. Only `Yes` performs deletion; `No`, storage changes, source changes, or closing Player must cancel the pending confirmation.
- Player -> Library has a compact search field beside volume/free-space/Close. It filters only the currently selected `Local`, `USB`, `NAS`, or `Favorites` tab using visible track metadata and path text; it must not send source-switch requests, change the MPD queue, or search Radio stations. The search input is `data-onboard-sticky`: after touch focus it sends a short Onboard keepalive instead of repeatedly reconfiguring the keyboard, so typing one character should not make Onboard close. The keepalive must not keep moving the Onboard window or reopen it after the user closes it; the user can still drag or dismiss the keyboard. Hidden Settings/Console overlays must not dispatch `keyboard-context-clear` during ordinary rerenders; they should clear the keyboard only on an actual open-to-close transition. The API also protects sticky keyboard sessions for `TIKPAL_WEB_MODE_KEYBOARD_STICKY_PROTECT_MS` so stray non-dismiss hide requests cannot collapse the keyboard mid-entry.
- The rightmost Library row checkmark represents the current MPD track, not just the row last selected for browsing. Previous/next playback must update the checkmark and scroll the current row into view without switching storage tabs.
- Long track lists keep a fixed right-side fast-scroll rail with `current / total` count and a draggable thumb. Dragging that rail only changes `scrollTop`; it must not select a track or auto-play on release.

NAS v1 is configured by the user in Settings rather than silently attached from a LAN scan. The backend may still read legacy manual roots from `TIKPAL_NAS_LIBRARY_ROOTS`, but those entries are marked `Manual` in Settings and should be treated as compatibility input. New setups should use Settings -> Library -> NAS:

```conf
TIKPAL_NAS_SOURCES_STATE_PATH=/home/moode/code/tikpal/.tikpal/nas-sources.json
TIKPAL_NAS_CREDENTIALS_DIR=/home/moode/code/tikpal/.tikpal/nas-credentials
TIKPAL_NAS_MOUNT_ROOT=/mnt/tikpal-nas
TIKPAL_NAS_MPD_ENTRY_ROOT=/var/lib/mpd/music/NAS
TIKPAL_NAS_AUTO_MOUNT=1
TIKPAL_NAS_AUTO_MOUNT_ATTEMPTS=3
TIKPAL_NAS_AUTO_MOUNT_RETRY_DELAY_MS=12000
TIKPAL_NAS_MOUNT_COMMAND="sudo -n -E /usr/local/sbin/tikpal-nas-mount mount"
TIKPAL_NAS_UNMOUNT_COMMAND="sudo -n -E /usr/local/sbin/tikpal-nas-mount unmount"
TIKPAL_NAS_LIBRARY_MPD_PREFIX=NAS
TIKPAL_NAS_LIBRARY_MAX_TRACKS=500
```

Configured NAS sources are stored in `.tikpal/nas-sources.json`. Passwords are not returned to the frontend; username/password credentials are written under `.tikpal/nas-credentials/<id>.cred` with `0600` permissions. The UI password field is masked by default and has a show/hide control for setup. With `TIKPAL_NAS_AUTO_MOUNT=1`, every saved and enabled NAS source is mounted again when `tikpal-api` starts, so swapping to another saved NAS only requires saving/enabling that source once in Settings. Startup mount is best effort: Tikpal marks the source as `Checking`, retries a few times while the network and NAS wake up, then skips the share and shows `Check setup` if it still cannot mount. A brand-new NAS should still go through Settings -> Library -> NAS -> Add/Test/Save; LAN discovery is only a candidate list and should not silently mount unknown shares.

NAS v1 supports SMB/Samba shares as a client by mounting them through Linux CIFS. Tikpal does not run a Samba server. Mount and test failures shown in Settings must be short and actionable in the NAS header and selected-source card, such as `Login failed. Check username, password, or Guest access.` or `Share or Folder not found. Check Share and Folder.` The raw `mount.cifs` or helper stderr is preserved as `lastRawError` in the API and as the UI `title`, but it should not be the primary visible text on the 2560 x 720 kiosk.

Discovery is only a candidate list. `POST /api/v1/nas/discover` may use `TIKPAL_NAS_DISCOVERY_HINTS` or a host-specific `TIKPAL_NAS_DISCOVERY_COMMAND`, but it must not save, mount, or scan anything until the user selects a candidate, runs `Test`, then uses `Save & Scan`.

Default mount behavior is read-only CIFS:

- Mount share at `/mnt/tikpal-nas/<id>`.
- Bind the selected folder into `/var/lib/mpd/music/NAS/<mountName>`.
- Expose track paths as `NAS/<mountName>/<relative-file>`.
- Try SMB `3.0`, then `2.1`, then `2.0`; save the version that works.
- Use `ro,uid=mpd,gid=audio,iocharset=utf8,nounix,soft`.

`TIKPAL_NAS_LIBRARY_ROOTS` remains only for manual/legacy local mount roots, such as a temporary fake NAS at `/mnt/tikpal-nas-test`; production Gentoo should prefer saved Settings NAS sources.

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

NAS playback should expose `play`, `pause`, `previous`, and `next`, but not `seek`. On CIFS/SMB streams MPD seek can block long enough to look like a broken UI, so `/api/v1/system/state` and `/api/v1/audio/source` responses should return `playback.transportCapabilities.seek=false` for current files under `NAS/...`, and `/api/v1/playback/actions {"type":"seek"}` should fail fast without calling `mpc seek`. If a user needs reliable seeking for a NAS file, copy it to Local first and play the `Codex/USB Imports/...` copy.

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

For TURZX USB/EVDI panels, brightness is not exposed through
`/sys/class/backlight`; use the patched manager helper instead. Check both the
saved value and hardware readback:

```bash
sudo /usr/local/sbin/tikpal-turzx-brightness status
sudo /usr/local/sbin/tikpal-turzx-brightness set 25
sudo /usr/local/sbin/tikpal-turzx-brightness set 45
sudo /usr/local/sbin/tikpal-turzx-brightness set 75
sudo /usr/local/sbin/tikpal-turzx-hid-probe describe
sudo /usr/local/sbin/tikpal-turzx-usb-probe read
sudo /usr/local/sbin/tikpal-turzx-usbmon-capture 33
```

If status shows `hardwareBrightnessPercent` fixed at `100` while
`softBrightnessActive:true`, the helper is using `xrandr --brightness` as a
visible fallback and `/api/v1/system/state` should report
`transport:"turzx-soft"`. For the current Gentoo TURZX screen, hardware writes
are disabled by default to avoid a black flash during left-edge brightness
dragging. Do not expose `0%` as a user brightness target. Screen Sleep stays a
soft touch-wake overlay; TURZX backlight values below `1%` are reserved for the
driver's DPMS-off path.

Ambient physical-screen gestures keep the left edge for brightness and the right edge for volume. Their transient adjustment overlay should be readable while the user is dragging, but it must return to the scene on its own after roughly three idle seconds so touch users do not need to hunt for Close.

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
- Before kiosk start, waits for HDMI or USB/EVDI DRM connectors to become `connected` with readable EDID, avoiding early Xorg `no screens found`.
- If enabled, runs one TURZX USB controller recovery pass when recent boot logs show USB descriptor/enum errors before any DRM connector becomes ready.
- Runs `xset s off`, `xset s noblank`, `xset -dpms`, and `xset dpms force on`.
- Resolves the primary RandR output from `auto`: HDMI first when present, otherwise the connected USB/EVDI output.
- Turns the selected primary output off briefly, switches it to `1280x720` when that mode exists, waits briefly, then switches back to `2560x720 primary`.
- Reapplies any configured `TIKPAL_KIOSK_XRANDR_CLONE_OUTPUTS` only on the final target mode, so USB/EVDI panels that advertise only `2560x720` do not break the temporary `1280x720` wake step.
- Applies `TIKPAL_KIOSK_XRANDR_USB_RATE=29.95` to `DVI-I-*` / `DVI-D-*` USB/EVDI outputs by default, reducing TURZX CPU load and USB 2.0 traffic while preserving the `2560x720` layout.
- Reapplies the safe RandR properties (`dithering depth=8 bpc`, `dithering mode=off`, `scaling mode=Full`) when the driver exposes them.
- Sets configured PCI display devices to `power/control=on`; on this host use `0000:03:00.0` for the GTX 750 Nouveau display function and `0000:03:00.1` for its HDMI audio function.
- Optionally sets `/sys/module/drm_kms_helper/parameters/poll` to `N` with `TIKPAL_PHYSICAL_DISPLAY_DRM_POLL=0`, reducing connector polling against unused DVI outputs.
- Raises the Chromium kiosk window.
- Optionally runs delayed soft-kicks only when `TIKPAL_PHYSICAL_DISPLAY_DELAYED_KICK_SECONDS` is set to a numeric schedule such as `"8 25"`. The checked-in default is `none`, so normal startup does not deliberately blank the display; enable this only after a physical panel has proved it needs a post-start recovery reset.
- Uses `xkbcomp` to replace display power keysyms such as `XF86PowerOff`, `XF86Sleep`, `XF86Suspend`, `XF86Display`, and `XF86ScreenSaver` with `NoSymbol`; ordinary typing and Fcitx/Onboard input are left alone.

If `soft-kick` cannot recover a visible panel and a physical HDMI replug has been proven to fix it, the second-stage fallback is a Nouveau PCI rebind:

```bash
systemctl stop tikpal-kiosk.service
TIKPAL_KIOSK_ENV_FILE=/home/moode/code/tikpal/.env.kiosk \
  /usr/local/sbin/tikpal-physical-display-prepare nouveau-rebind
systemctl start tikpal-kiosk.service
```

The watchdog now runs the same helper in `--check` mode. If the physical display check fails, it tries `soft-kick` first, then an optional `nouveau-rebind` when `TIKPAL_KIOSK_PHYSICAL_DISPLAY_GPU_REBIND_BEFORE_RESTART=1`, and only restarts `tikpal-kiosk.service` when the display helper cannot recover the X/HDMI state. It still does not restart API, web, MPD, or audio services for ordinary display recovery.

Important limitation: this panel can be black to the eye while DRM, RandR, DDC, Chromium, and heartbeat all report healthy. In that exact state, software has no reliable visual sensor. The PCI `power/control=on` baseline and an explicitly enabled delayed kick schedule can reduce the chance of recurrence; the proven recovery path is `nouveau-rebind`, with a physical HDMI replug as the final fallback if the panel receiver firmware ignores every software kick.

## Validation

### Startup Scene And Locale Readiness

The four-card startup / Explore-return room chooser is a visual cover while the current Ambient scene becomes drawable. It must remain visible until the active scene video reports a decoded frame (`data-flame-frame-ready="true"` and `readyState >= 2`). On the single-loop Gentoo path, the health must also be `ok`; `recovering`, `stalled`, and `fallback` are not safe to reveal behind. In particular, `health="recovering"`, `currentTime=0`, and `readyState=1` mean the user would see the static fireplace fallback, so the cards must stay up instead of auto-dismissing.

After a room-card selection, the cards remain pending until that selected scene reaches the same readiness condition. This avoids closing the cover on an old decoded scene and exposing a static frame during recovery. The 8-second idle dismissal timer starts only after readiness; it does not force an unsafe reveal.

On the physical kiosk, inspect the active scene and chooser through the main kiosk DevTools page rather than service liveness alone:

```js
(() => {
  const scene = document.querySelector(".flame-scene");
  const video = document.querySelector('.flame-video[data-flame-layer="active"][data-flame-loop-role="active"]');
  const chooser = document.querySelector(".startup-mode-chooser");
  return {
    chooserVisible: chooser instanceof HTMLElement,
    chooserContext: chooser?.getAttribute("data-room-mode-chooser-context") ?? null,
    health: scene?.getAttribute("data-flame-video-health") ?? null,
    frameReady: video?.getAttribute("data-flame-frame-ready") ?? null,
    readyState: video instanceof HTMLVideoElement ? video.readyState : null,
    currentTime: video instanceof HTMLVideoElement ? video.currentTime : null
  };
})()
```

Expected safe reveal: `chooserVisible=false`, `frameReady="true"`, and `readyState >= 2`; for single-loop video, `health="ok"`. Verify a saved non-English preference by reloading the kiosk with `localStorage.getItem("tikpal.locale")` set to one of the seven valid values and confirming the first visible startup-card title is already in that language.

2026-07-30 physical-kiosk validation on `192.168.10.117`:

- `systemctl is-system-running` returned `running`, and `systemctl --failed` returned `0`.
- `tikpal-api`, `tikpal-web`, `tikpal-kiosk`, and `mpd` were active after the library and seek fixes.
- `tikpal-usb-audio-sync.timer` was disabled and inactive. Keep it that way unless its helper is changed to avoid periodic `mpc update USB`.
- Local library sync preserved `Codex/USB Imports/...` while pruning stale repo-owned files. This protects `Copy to Local` imports across reboot and service reinstall.
- `/api/v1/audio/library?storage=local` returned Local tracks, and MPD `listall Codex` returned the same MPD-visible library root.
- Local MPD playback accepted repeated seek actions through `/api/v1/playback/actions` without an `mpc ... seek ... timed out` error after USB auto-update was disabled.
- Browsing USB via `/api/v1/audio/library?storage=usb` did not spawn a background `mpc update USB` process.
- The Player header should keep the Volume slider and Local storage meter aligned as one group, with a readable free-space label and visible spacing before the Close button.

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

On a normal installation, confirm that the default delayed reset is a no-op. Do
not enable a numeric schedule merely to make this check pass:

```bash
TIKPAL_KIOSK_ENV_FILE=/home/moode/code/tikpal/.env.kiosk \
  /usr/local/sbin/tikpal-physical-display-prepare delayed-soft-kick
```

Expected default log: `delayed soft-kick is disabled`. If a particular panel
has physical proof that it needs the reset, set a numeric schedule in
`.env.kiosk`, restart the kiosk, and verify the resulting black flash and
recovery on that device before retaining the override.

When Explore is active, the main Tikpal kiosk page can become Chromium-hidden behind the visible provider / side-panel windows. Browser timer throttling may then report a large `eventLoop.lagMs` or delay the next heartbeat past the normal 30s visible-page stale threshold. These are diagnostic only and should appear under `ignoredReasons` as `event-loop-lag:hidden-page` or `heartbeat-stale:hidden-page`, not as restart reasons. Hidden pages use `TIKPAL_KIOSK_HEARTBEAT_HIDDEN_STALE_MS` (`120000` by default) before becoming truly stale. A stale visible heartbeat, visible-page event-loop lag, stuck pending action, or scene-video failure remains unhealthy.

Explore checks:

```bash
cd /home/moode/code/tikpal
deploy/chromium/tikpal-web-mode.sh --check
curl -fsS -X POST http://127.0.0.1:8787/api/v1/web-mode/actions \
  -H "Content-Type: application/json" \
  --data '{"type":"open","provider":"qq_music"}'
curl -fsS http://127.0.0.1:9241/json/list | node -e '
  let body = "";
  process.stdin.on("data", (chunk) => body += chunk);
  process.stdin.on("end", () => {
    const targets = JSON.parse(body);
    const page = targets.find((target) => target.type === "page" && String(target.url || "").startsWith("https://"));
    if (!page) process.exit(1);
    console.log(page.url);
  });
'
```

The final command must print a real `https://` provider page. A Chromium
process, cached X11 window id, local transition page, or Tikpal error page is
not readiness evidence and should remain `Check setup` (or the explicit
regional-unavailable state) until CDP reports the provider page.

API-only resident-provider diagnostics should cover at least one Chinese provider and several slow western providers:

```bash
for provider in youtube_music apple_music tidal deezer qq_music; do
  curl -fsS -H "Content-Type: application/json" \
    -X POST http://127.0.0.1:8787/api/v1/web-mode/actions \
    --data "{\"type\":\"open\",\"provider\":\"$provider\"}" |
    jq '{activeProvider,lastError,current:.residentProviders[$activeProvider]}'
done

DISPLAY=:0 XAUTHORITY=/home/moode/.Xauthority \
  xdotool search --onlyvisible --class chromium \
  getwindowname %@ getwindowgeometry %@
```

The geometry snapshot after each diagnostic action should show the active provider at `0,0 1920x720`, the side panel at `1920,0 640x720`, and inactive resident providers at `2560,0 1920x720`. This snapshot is useful for debugging but does not establish click-to-settled physical performance.

For one API/command diagnostic lap across all ten resident providers, with a single 30fps recording, API round-trip timing, responses, and one X11 geometry snapshot per target, start from any active provider after the pool is warm:

```bash
cd /home/moode/code/tikpal
DISPLAY=:0 XAUTHORITY=/home/moode/.Xauthority \
  deploy/chromium/tikpal-explore-switch-acceptance.sh
```

The command returns to the starting provider and writes a diagnostic directory under `.tikpal/` containing `explore-ten-provider-switches.mp4`, `switches.tsv`, `summary.txt`, API responses, X11 geometry snapshots, and the recorder log. A failed API switch is retained in the TSV instead of being silently skipped. Because this script posts API actions rather than performing real X11 panel clicks, its timing and video cannot accept physical switch performance.

To verify stale setup recovery, inject a temporary failed state for a provider that is already on its real site and wait for its guard to repair it:

```bash
node - <<'NODE'
const fs = require("fs");
const p = ".tikpal/web-mode-state.json";
const s = JSON.parse(fs.readFileSync(p, "utf8"));
s.residentProviders ||= {};
s.residentProviders.tidal = {
  ...(s.residentProviders.tidal || {}),
  status: "check_setup",
  lastError: "synthetic stale check_setup",
  updatedAt: new Date().toISOString()
};
s.updatedAt = new Date().toISOString();
fs.writeFileSync(p, `${JSON.stringify(s, null, 2)}\n`);
NODE
sleep 2
jq '.residentProviders.tidal' .tikpal/web-mode-state.json
```

Expected: the guard rewrites TIDAL to `active` or `ready` and clears `lastError` only after its HTTPS page passes the full two-sample document/content probe.

Use CDP to verify the resident provider audio gate after deploy:

```js
(() => ({
  version: window.__tikpalProviderAudioGate?.version || 0,
  status: window.__tikpalProviderAudioGate?.status?.() || null
}))()
```

Expected: `version=2`. The active provider reports `status.active=true`; inactive providers report `status.active=false`. When the user returns to a provider that was playing before it was hidden, it should become unmuted and continue playback. If the user paused the provider before switching away, returning to it should keep it paused.

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

QQ Music's playlist MV glyphs are physically small on a `2560x720` touch panel. The provider guard enlarges the effective hit area in-page around original MV links to about `72x44` without adding a cross-window transparent overlay. This keeps taps tied to the real QQ link and avoids accidentally activating an offscreen resident provider.

Input checks:

```bash
pgrep -af fcitx5
su - moode -c 'DISPLAY=:0 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus fcitx5-remote -n'
gsettings get org.onboard layout
sudo -u moode -H env DISPLAY=:0 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus gsettings get org.onboard.theme-settings key-label-font
cat /home/moode/code/tikpal/.tikpal/onboard-ime-state.json 2>/dev/null || true
cat /home/moode/.config/tikpal/onboard-ime-state.json 2>/dev/null || true
```

Touch a provider search field and confirm Onboard appears above the provider, cycles through EN / Chinese / German / Italian / Korean / Japanese / ES, shows a larger CJK candidate window, and hides after outside tap, submit, or single-line Enter. Change Settings -> Font once and confirm `key-label-font` changes without resetting the current Fcitx mode.

Audio checks:

```bash
aplay -l
mpc status
sudo fuser -v /dev/snd/*
```

For QQ Music, manually click play if the provider was reopened during deploy. Confirm the QQ player is not muted, audio comes through BT66, and `fuser` shows Chromium holding the expected ALSA device.

## Rollback Notes

- To return from Explore to the main kiosk, use the side panel Close action or `deploy/chromium/tikpal-web-mode.sh close`.
- If provider layout looks compressed, confirm there is no `--force-device-scale-factor` in provider Chromium processes and no `chrome.tabs.setZoom` / `chrome.tabs.getZoom` reference in the deployed extension.
- If Onboard stops changing languages, run `deploy/chromium/tikpal-web-mode.sh --check`, then verify `/usr/share/onboard/scripts/tikpalImeToggle.py`, the generated `Tikpal-Compact-*.onboard` layouts, `fcitx5-remote -n`, and the two `onboard-ime-state.json` files. If `pgrep -af fcitx5` shows any root-owned Fcitx process, stop that process and resync as `moode`.
- If the display becomes too dim to use, recover the DDC value out of band before changing UI gesture mapping.
- If Chromium, MPD, AirPlay, or Spotify contend for BT66, use the Gentoo source handoff helper rather than killing random audio processes.

## Explore Transition Debug Port (August 2026)

When `TIKPAL_WEB_MODE_TRANSITION_DEBUG_PORT=9250` is set in the web-mode environment, the shell script exposes a raw CDP debug port for inspecting the transition page. (Note: the transition veil has been removed; this port is now only used for provider page inspection.)

Use this to diagnose stalls where the left pane stays black or the cover does not appear:

```bash
curl -s http://127.0.0.1:9250/json/list | jq '.[0].url'
```

If the URL is `about:blank` after a provider switch command, the provider navigation did not fire — check the shell script logs.

## Resident Provider Optimistic Switch (August 2026)

When switching between two providers that are both already loaded (resident), `server/index.mjs` returns the switch response immediately to the frontend and runs the shell-level provider switch command in the background. This removes the old API blocking delay, but it does not measure when the physical provider window becomes visible or settled.

The frontend side panel uses this fast response to update the active provider highlight immediately. The actual Chromium tab focus/visibility change happens asynchronously in the background.

If the background shell command fails (e.g. target provider crashed), the next `web-mode-state.json` poll will show the stale provider, and the side panel will correct its highlight on the next read cycle.

## Explore Chromium Flags (August 2026)

All Explore provider Chromium processes share `chromium_base_args()` flags:

```bash
--force-dark-mode
--enable-features=WebUIDarkMode
--default-background-color=000000
--disable-features=StatusBubble
```

`StatusBubble` hides the bottom-left URL tooltip that appears on link hover. Additional per-process `--disable-features` flags (Translate, InterestFeedContentSuggestions, MediaRouter, OptimizationHints) are applied via the Chromium profile preferences.

## Explore Process Race Condition Fix (August 2026)

Provider switching was hanging for 100+ seconds when the X server was under load from 20+ Chromium windows. Root cause: `xdotool` calls had no timeout, and window enumeration was repeated 5-8 times per switch.

Fixes applied in `tikpal-web-mode.sh`:

- **`xdotool_safe()`**: wraps every `xdotool` call with `timeout 3` (74 call sites)
- **`cached_chromium_windows()`**: caches the window list per switch operation, invalidated at switch boundaries
- **CDP paint check skip**: `provider_has_real_provider_page` proves page content via CDP, skipping unreliable X11 paint check
- **`--disable-features=StatusBubble`**: hides bottom-left link hover URL bar

Architecture details: `docs/03-architecture/explore-provider-pool-v1.md`

## Deploy Script (August 2026)

`deploy/deploy-gentoo.sh` is the standard deployment path for Gentoo. It replaces manual rsync commands and prevents two recurring issues:

1. **`.env.kiosk` deletion**: `rsync --delete` previously wiped `.env.kiosk` on the remote because it was gitignored. The script now excludes `.env`, `.env.*`, and `.tikpal/` from rsync.
2. **Permission breakage**: rsync runs as root, changing all files to `root:root`. The kiosk service runs as `User=moode`, causing EACCES on `.tikpal/web-mode-state.json`. The script runs `chown -R moode:` after rsync.

It builds `dist` before syncing, fixes the service-user ownership, then runs the synchronized systemd installer for API, web, audio-adapt, and library-sync units before restarting the physical kiosk. This keeps updated unit files (including the API's device-local `.env.kiosk` load) aligned with the copied backend and frontend. The installer does not replace a kiosk unit during an ordinary release, so the deploy script restarts the existing physical kiosk only after the non-kiosk services are installed. The source tree is otherwise synced with `--delete`, but device runtime state (`.env*`, `.env.kiosk`, `.tikpal/`), Git metadata, dependencies, Codex work artifacts, and local `tikpal-web-mode.sh` backup copies are deliberately excluded. A release must never treat a screenshot or a hand-made rollback copy as deployable product code.

Usage:

```bash
./deploy/deploy-gentoo.sh                           # defaults: 192.168.10.115, root, proxy 127.0.0.1:7897
./deploy/deploy-gentoo.sh --host 192.168.10.99       # custom host
./deploy/deploy-gentoo.sh --proxy ""                  # no proxy
```

The script first tries normal SSH-agent/key authentication. For a one-off password-authenticated run, read the password interactively into `TIKPAL_DEPLOY_PASSWORD`; do not write the value into `.env`, `.env.kiosk`, Git, shell history, or documentation:

```bash
read -rs TIKPAL_DEPLOY_PASSWORD
export TIKPAL_DEPLOY_PASSWORD
./deploy/deploy-gentoo.sh
unset TIKPAL_DEPLOY_PASSWORD
```

Each deploy backs up the remote `.env.kiosk` with a timestamp suffix (e.g. `.env.kiosk.bak.20260817190900`) before syncing.

After the script succeeds, verify the running device rather than only the rsync exit status:

```bash
systemctl is-active tikpal-api tikpal-kiosk
curl -fsS http://127.0.0.1:8787/api/v1/health
curl -fsS http://127.0.0.1:8787/api/v1/web-mode/state
```

The script treats a non-active API, web, or kiosk service, or a failed API-health request, as a failed release. To confirm that the running unit and the copied API are the same release, run the following on 115 after deployment:

```bash
systemctl cat tikpal-api.service | grep -F 'EnvironmentFile=-/home/moode/code/tikpal/.env.kiosk'
sha256sum /home/moode/code/tikpal/server/index.mjs
find /home/moode/code/tikpal/dist/assets -maxdepth 1 -type f -name 'index-*.js' -print -exec sha256sum {} \;
```

For this release, Settings -> Link -> Explore Proxy validates a candidate URL through Google, Apple Music, and Spotify before Proxy On can persist and request a reboot. All three checks must pass. The manual `Check Proxy` action has no side effects; failed or cancelled validation must not save settings or restart the kiosk. During a provider open, `/api/v1/web-mode/state.openingProvider` is the transient truth; keep the side panel in `Opening` until it becomes `activeProvider` or reports an error.

At `2560x720`, the Explore Proxy detail keeps all controls and the pre-reboot confirmation inside the visible settings panel without vertical page scrolling. The status card says `Proxy On` or `Proxy Off`: enabled is a green high-contrast state, disabled is neutral gray. Touching the Proxy URL places the `900x280` Onboard window at the top (`y=24`) before considering the normal default position, so it does not cover the field. Starting validation or opening the enable/disable confirmation blurs the URL input and hides the keyboard; the validated restart confirmation scrolls into the remaining panel viewport. The separate `640x720` Side Panel reserves at least `352px` for the ten provider cards and keeps the bottom QQ Music/NetEase cards complete above the font/volume controls.

### `.env.kiosk` Recovery

The `.env.kiosk` file is machine-local and gitignored. If lost, copy from `.env.example` and set Gentoo-specific overrides:

```conf
TIKPAL_CHROMIUM_BIN=/usr/bin/chromium-browser
TIKPAL_KIOSK_XRANDR_OUTPUT=DVI-I-1-1
TIKPAL_KIOSK_XRANDR_MODE=2560x720
TIKPAL_KIOSK_XRANDR_RATE=29.95
TIKPAL_PHYSICAL_DISPLAY_ALLOW_NO_EDID=1
TIKPAL_PHYSICAL_DISPLAY_DRM_PREFERRED_CONNECTORS=card1-DVI-I-1
```

**Critical**: `TIKPAL_KIOSK_XRANDR_OUTPUT=`, `TIKPAL_KIOSK_XRANDR_MODE=`, and `TIKPAL_KIOSK_XRANDR_RATE=` in `.env.kiosk` must be left empty or set to actual values. An explicit empty value (e.g. `TIKPAL_KIOSK_XRANDR_OUTPUT=`) overrides the script default (`auto`) and breaks mode detection, causing xrandr to fail with "Size 2560x720 not found in available modes".

### Screen Brightness (TURZX USB)

The TURZX USB screen brightness is controlled via `/usr/local/sbin/tikpal-turzx-brightness` (installed from `deploy/turzx/tikpal-turzx-brightness.sh` by the systemd installer). The script writes directly to `/dev/hidraw1`:

```bash
# Brightness commands (hidraw1)
printf '\x00\xaa\x55\x30\x64' > /dev/hidraw1   # 100%
printf '\x00\xaa\x55\x30\x32' > /dev/hidraw1   # 50%
printf '\x00\xaa\x55\x30\x0a' > /dev/hidraw1   # 10%
```

The API calls `sudo -n -E /usr/local/sbin/tikpal-turzx-brightness set <1-100>`. The `TIKPAL_TURZX_BRIGHTNESS_COMMAND` env var is not used by the brightness script; brightness is handled by the installed helper directly.

## Explore Launch Optimization (August 2026)

The entry-stage veil (a separate 1920x720 Chromium instance used to cover the left side during first Explore open) has been removed. The frontend now handles the full-screen fade-to-black via a JS `requestAnimationFrame` overlay (3000ms ease-in, z-index 9999) that runs in parallel with the API call to `sendWebModeAction({ type: "open" })`. Both the animation and API call complete via `Promise.all`, after which the overlay is removed immediately.

This eliminates one Chromium instance from the Explore cold-start path and removes the `entry-stage-guard` watchdog that continuously raised the left-side veil.

Provider switching between already-loaded providers uses CDP only to prove that a real provider page exists and to control media. A correct hot path must still tile the target on-screen and park the old provider itself; `raise` on an off-screen resident window is insufficient. The legacy fade-then-reveal flow is reserved for cold or unverified pages.

## Volume Control Device Discovery Fix (August 2026)

On Gentoo, the ALSA output config lives in `/etc/asound.conf` (not `/etc/alsa/conf.d/_audioout.conf` like on moOde). The volume helper `deploy/moode/tikpal-output-volume.sh` previously only read from `/etc/alsa/conf.d/`, causing it to fall back to `discover_first_playback_card` which picked card 1 (HDA Intel) instead of card 2 (BT66 USB). The UI showed volume numbers changing but actual audio was unaffected.

Fix: added `/etc/asound.conf` to the default search path in `discover_cards_from_config`. The script now finds `CARD=BT66` from the Gentoo asound.conf automatically. `TIKPAL_OUTPUT_VOLUME_CARDS` is no longer needed in `.env.kiosk` for this host.

## Explore Kiosk Window Stacking Fix (August 2026)

When switching to a provider in Explore, the main kiosk window ("Tikpal - Chromium") stayed on top, covering the provider with a persistent black background. The window guard (`tile_visible_web_mode_windows`) correctly lowered background windows but never handled the kiosk window because `is_tikpal_window_title` caused it to be skipped entirely.

Fix: added kiosk window lowering logic after the background windows loop in `tile_visible_web_mode_windows()`. When provider windows are present, the function now finds the kiosk window via `kiosk_browser_window()` and calls `xdotool windowlower`, matching the existing background window handling pattern.

## Explore Guard Race Fix (August 2026)

When switching to a provider that shows `check_setup` (e.g. NetEase Cloud Music), the side panel could end up parked offscreen at `2560,0`, causing the right side of the screen to appear empty/black.

Root cause: `stop_window_guard` sends SIGTERM to the bash window guard, but the guard may be mid-tiling-cycle. It finishes tiling, loops back, reads `active_provider=""` (already cleared by `open_provider_pool`), and calls `close_web_mode_from_guard` which parks all surfaces offscreen (since `CLOSE_KEEP_RESIDENT=1`).

Fix: before calling `close_web_mode_from_guard`, the guard now verifies the PID file still contains its own PID (`$$`). If `stop_window_guard` already removed the PID file, the guard exits cleanly without parking surfaces. This prevents the race between `stop_window_guard` and the guard's tiling cycle.

## Historical Veil/PID Optimization (August 2026)

~~The `close_transition_veil`, `close_error_veil`, and `close_background_veil` functions previously used `pkill -f "--user-data-dir=$profile"` to terminate veil Chromium processes.~~ All transition, background, error, and close-overlay veil functions were later removed. The following measurements describe that historical optimization sequence; they are not current physical acceptance results.

### Historical Timing Validation (2026-08-18)

Two rounds of random provider switching (20 total) on Gentoo `192.168.10.115`:

| Round | Min | Max | Median | Notes |
| --- | --- | --- | --- | --- |
| Round 1 | ~200ms | ~500ms | ~1,600ms | CDP fast path, no paint check timeout |
| Round 2 | 2,063ms | 2,638ms | 2,215ms | Sequential, all resident=1 |

Before that PID-file experiment, a single provider switch after a NetEase failure took 42,900ms. Its API/script-log boundary later reported 20 switches in `2.0–2.8 s`. Keep this as dated 2026-08-18 history only: it did not wait for physical geometry, a nonblank frame, state/lock convergence, and old-window parking, and the 2026-08-24 physical test disproved it as a description of the current user-visible path.

Historical diagnostic commands were:
```bash
# Monitor reveal timing in real-time
journalctl -t tikpal-web-mode -f | grep reveal_ms

# Exercise the API path only; this is not physical acceptance.
curl -s -X POST http://127.0.0.1:8787/api/v1/web-mode/actions \
  -H 'Content-Type: application/json' \
  -d '{"type":"open","provider":"netease_music"}'
```

The removed veil PID files must not be used as a current verification step. `reveal_ms` and API return remain diagnostic stage timers, not physical convergence.

### Post-Reboot Validation (2026-08-18, after wait-for-exit fix)

Gentoo `192.168.10.115` rebooted, kiosk cold-started, boot prewarm completed, then all 10 providers switched sequentially:

| # | Provider | reveal_ms |
| --- | --- | --- |
| 1 | netease_music | 1,823 |
| 2 | qq_music | 2,005 |
| 3 | spotify | 1,959 |
| 4 | tidal | 2,020 |
| 5 | deezer | 1,973 |
| 6 | apple_music | 1,979 |
| 7 | youtube_music | 1,988 |
| 8 | qobuz | 1,947 |
| 9 | suno | 1,954 |
| 10 | amazon_music | 2,020 |

That dated run reported every script-level switch under 2.1 seconds. It does not establish the current physical latency or prove that the post-NetEase delay remains fixed.

### Historical 100-Switch Stress Test (2026-08-18)

After eliminating the remaining `xdotool search --class chromium` bottleneck (~9s per call scanning 27+ windows), the API/script harness ran 10 rounds × 10 providers = 100 sequential switches. This was not a real-panel physical-convergence test:

| Metric | Value |
| --- | --- |
| Total switches | 100 |
| Min | 1,801ms |
| Max | 2,820ms |
| Median | 1,974ms |
| Average | 2,050ms |
| Over 5s | 0 |

Distribution:
- <2s: 75 (75%)
- 2-2.5s: 18 (18%)
- 2.5-5s: 7 (7%)
- \>5s: 0 (0%)

**Root causes addressed in that historical build:**

1. `pkill -f` scanning all 510 processes → PID file + targeted kill
2. `xdotool search --pid` in `close_transition_veil` scanning 27 windows (~9s) → removed; fire-and-forget kill
3. `wait_for_profile_window` → `first_window_for_profile` → `all_chromium_windows` → `xdotool search --class chromium` (~9s per call) → replaced with `xdotool search --pid` using the just-spawned Chromium PID
4. Chromium profile lock contention after killing old process → unique profile directories per transition (`transition.$(date +%s%N)`)
5. `StatusBubble` feature flag overridden by duplicate `--disable-features` → merged into single flag in `chromium-flags.conf`

**Key design decisions:**
- Transition veil uses a unique profile directory each time; old profiles are cleaned up in the background (keep last 3)
- PID file is stored at a fixed path (`transition-veil.pid`) outside the unique profile directory
- `close_transition_veil` is fire-and-forget (no wait, no xdotool); the unique profile approach makes stale-lock waits unnecessary
- `launch_transition_veil` uses `xdotool search --pid` with the spawned PID instead of `wait_for_profile_window` to avoid the O(n) window scan

### Physical Baseline Before the Known-ID Repair (2026-08-24)

The current field result on Gentoo `192.168.10.115` used real X11 clicks on the right-side provider cards. API and CDP were read-only evidence. The fixed ten-provider sequence ran twice and all 20 rounds eventually reached the correct provider, panel, state, lock, nonblank frame, and audio-gate state:

| Boundary | min | median | p95 | max |
| --- | ---: | ---: | ---: | ---: |
| click command return | 107 ms | 110 ms | 127 ms | 133 ms |
| API accepts switch | 128 ms | 131 ms | 224 ms | 235 ms |
| target geometry at `0,0` | 16,601 ms | 18,275 ms | 34,875 ms | 36,696 ms |
| first nonblank target frame | 17,079 ms | 18,848 ms | 35,555 ms | 40,558 ms |
| fully settled | 18,321 ms | 20,219 ms | 36,832 ms | 41,622 ms |

In rounded terms, the API median was `131 ms`, target geometry median was `18.28 s`, first nonblank frame median was `18.85 s`, and full stability median was `20.22 s`; full-stability p95 was `36.83 s` and maximum was `41.62 s`. The first ten settled at a 20,175 ms median and the second ten at 20,219 ms, so a second warm pass did not improve the result. The historical 2026-08-23 `600–620 ms`, 2026-08-18 `2.0–2.8 s`, and 100-switch roughly-`2 s` results must not be quoted as current performance or as a final optimization result.

The field evidence invalidated five assumptions: window-ID reuse risk is small enough for geometry-only cache validation; a `250 ms` guard can correct the physical layout within `250 ms`; `raise` can reveal an off-screen target without a preceding tile; old-window parking can be left entirely to the guard; and the panel is already stable and needs no explicit once-per-switch placement.

`deploy/chromium/tikpal-explore-switch-acceptance.sh` posts API actions and is useful for API/command diagnostics only. It cannot establish physical switch performance. Physical acceptance must use X11 card clicks and retain per-round API timing, X11 geometry, nonblank frames, CDP URL/audio evidence, lock state, and the final visible-surface count; stop at the first mismatch.

### Current Resident Hot-Switch Implementation (2026-08-25)

The known-ID repair described above is implemented in `tikpal-web-mode.sh` and its kiosk smoke coverage:

- Cached XIDs retain real `xdotool` failure status and are validated against PID/profile ownership and usable geometry. A cache miss searches only the target Chromium profile tree.
- The normal guard consumes atomically published provider/panel/kiosk IDs from `guard-windows.tsv`; one combined X11 query checks those known surfaces, PID/profile ownership is refreshed every fourth tick, and only invalid-ID recovery may enumerate visible Chromium windows. The first four post-switch ticks use `250 ms`; stable ticks use one second.
- A switch stops the old guard and child X11 process, keeps the right Side Panel at `1920,0 640x720`, restores target opacity when needed, and moves/raises the target while parking the previous provider in one ordered `xdotool` transaction.
- The existing panel geometry read is reused: exact `1920,0 640x720` skips the retile, while a mismatch, incomplete result, or read failure preserves the original repair. The existing opacity read is also reused: absent/full opacity skips `xprop -set`, while non-full, malformed, or unreadable values preserve the original restore. Neither optimization adds a second read.
- The foreground path writes `last-physical-reveal.tsv` immediately after that transaction and verifies final target/previous geometry before committing state.
- The first streamed CDP page result is reused by reveal. HTTPS readiness can skip the slow paint-wait fallback, but it cannot skip physical geometry, the acceptance frame, state, lock, or audio-gate checks.
- Close preserves `activeProvider` until all provider and panel surfaces are off-screen. The API waits for the close command; a residual physical surface returns an error instead of reporting a successful close.

The latest skip-only field deployment atomically updated only `deploy/chromium/tikpal-web-mode.sh` and `scripts/kiosk-package-smoke.mjs`, with no service, provider Chromium, or guard restart. The acceptance observer change was already present and was not part of that two-file deployment. Product source/build health, isolated staging, deployed hashes, and the next physical run remain separate acceptance layers.

### Physical Timestamp Contract

The reveal stamp has exactly four tab-separated fields:

```text
provider<TAB>target_xid<TAB>previous_xid<TAB>absolute_epoch_ms
```

The acceptance tool clears the prior stamp before the real Side Panel click. It rejects missing, malformed/half-written, stale, future, wrong-provider, wrong-target, and wrong-previous stamps. It then waits for lock release, checks target `0,0 1920x720`, previous `2560,0 1920x720`, panel `1920,0 640x720`, captures a nonblank frame, confirms runtime/API state, inspects all real HTTPS CDP pages and audio gates, and retains the complete round directory. Empty or incomplete fields from a busy combined geometry query are retried at most three times with `150 ms` spacing; a complete wrong geometry still fails immediately. This observer retry never changes the physical stamp or the `5 s` gate.

`rounds.tsv` records physical `visible_ms`, independent `observer_delay_ms`, and full `settled_elapsed_ms`. Only the physical stamp decides the per-round `<=5 s` ceiling; observer overhead must never be substituted for physical time or used to excuse a slow physical reveal.

### Resident Physical Acceptance Commands

Run syntax and fixtures locally before any field click:

```bash
bash -n deploy/chromium/tikpal-web-mode.sh
bash -n deploy/chromium/tikpal-explore-physical-acceptance.sh
deploy/chromium/tikpal-explore-physical-acceptance.sh stamp-fixtures
npm run test:kiosk
git diff --check
```

Use `switch-once` to test one explicit direction without weakening any preflight or correctness gate:

```bash
cd /home/moode/code/tikpal
TIKPAL_EXPLORE_ACCEPTANCE_SWITCH_ROUNDS=1 \
TIKPAL_EXPLORE_ACCEPTANCE_SEQUENCE=suno \
TIKPAL_EXPLORE_ACCEPTANCE_OUTPUT_DIR="$PWD/.tikpal/explore-physical-acceptance-single-netease-to-suno-$(date +%Y%m%d-%H%M%S)" \
./deploy/chromium/tikpal-explore-physical-acceptance.sh switch-once
```

`switch-only` is the formal path. It requires exactly 20 rounds and, without an explicit sequence, starts after the current provider and covers all ten providers twice:

```bash
cd /home/moode/code/tikpal
TIKPAL_EXPLORE_ACCEPTANCE_OUTPUT_DIR="$PWD/.tikpal/explore-physical-acceptance-formal-20-$(date +%Y%m%d-%H%M%S)" \
./deploy/chromium/tikpal-explore-physical-acceptance.sh switch-only
```

Do not run the full script under `bash -x`; per-command tracing changes device load and can invalidate timing. API and CDP remain read-only evidence channels. Stop on the first timestamp, geometry, surface, frame, state, lock, HTTPS, or audio mismatch and retain the partial directory.

### Current Field Baseline (2026-08-25)

| Run | Direction | Physical time | Observer extra delay | Result |
| --- | --- | ---: | ---: | --- |
| initial one-round validation | QQ Music → NetEase | 3,895 ms | 5,885 ms | passed |
| formal 20-round run, round 1 | NetEase → Suno | 7,426 ms | 8,744 ms | failed `visible-over-5s` |
| post-CDP reverse validation | Suno → NetEase | 4,073 ms | 5,614 ms | passed |
| post-CDP same-direction retry | NetEase → Suno | 7,471 ms | 7,672 ms | failed `visible-over-5s` |
| one-shot segment probe after guard tuning | NetEase → Suno | 7,439 ms | not retried | failed `visible-over-5s` |
| setup before skip-only deployment | Suno → NetEase | 5,662 ms | three incomplete observer geometry reads | failed `visible-over-5s` |

The formal run stopped immediately after round 1: planned `20`, executed `1`, passed `0`, failed `1`, not executed `19`. This remains the formal rollback baseline and must be reported as **not accepted**. The two later actions were bounded diagnostics, not additional formal rounds; neither passed the physical ceiling.

The before/after stage comparison for NetEase → Suno was:

| Stage | Before CDP reuse | After CDP reuse | Delta |
| --- | ---: | ---: | ---: |
| `open_pool_init` | 2,779 ms | 2,856 ms | +77 ms |
| reveal opacity/readiness aggregate | 1,057 ms | 990 ms | -67 ms |
| ordered X11 transaction before physical stamp | 2,340 ms | 2,348 ms | +8 ms |
| click to physical stamp | 7,426 ms | 7,471 ms | +45 ms |
| geometry confirmation after stamp | 3,381 ms | 3,360 ms | -21 ms |
| command tail after reveal | 2,680 ms | 1,464 ms | -1,216 ms |

The CDP reuse saved at most `67 ms` inside the reveal aggregate and did not improve the physical result. The `1,216 ms` command-tail improvement occurred after the stamp and explains the shorter observer/lock delay.

The one-shot timing marker `TIKPAL_WEB_MODE_SWITCH_SEGMENT_TIMING_ONCE_PATH` was then added. It records cache, first-CDP, guard-stop, panel, opacity, combined-X11, and stamp-write details for one resident switch, emits the consolidated result after the physical stamp, and consumes both the marker and `.details` file. The sole marked NetEase → Suno action was `7,439 ms`; its useful segments were `first_cdp_ms=12`, `guard_stop_ms=71`, `target_opacity_ms=962`, and `combined_x11_ms=2292`. The initial `cached_xid_ms=2788` and `panel_retile_ms=811` remain contaminated upper bounds because the approved action was not retried.

The following Suno → NetEase setup took `5,662 ms`: click → runtime start `265 ms`, runtime → `open_pool_init` `2,043 ms`, init → transition `838 ms`, transition → reveal `225 ms`, reveal → CDP ready `976 ms`, and CDP ready → physical stamp `1,315 ms`. Runtime geometry confirmation followed `1,792 ms` later and command return another `1,432 ms` later. Final windows, HTTPS, audio, state, and lock were correct; the observer's three incomplete geometry reads were a secondary X11-congestion failure and do not cancel the physical overrun.

The panel-retile and target-opacity skips were selected from that evidence and deployed, but no physical provider click has run afterward. The next field action is exactly one NetEase → Suno switch with an atomically created one-shot marker. Stop at the first mismatch or any physical time over `5,000 ms`; do not retry, switch back, or start the 20-round sequence. If it fails, use the new `.details` record to choose between cached-XID validation, PID/profile parsing, and the combined X11 mutation.

Scope remains already-prewarmed resident switching. It says nothing about first Explore entry, cold launch, or Close. Historical `600–620 ms` shell timing is not current physical acceptance.

### Snapshot Validation Before Publication (2026-08-25)

The current skip-only snapshot was checked with the following local and remote results:

- Passed locally: `bash -n` for both modified shell scripts, Node syntax for `scripts/kiosk-package-smoke.mjs`, `git diff --check`, and `npm run test:kiosk` (`kiosk package smoke passed`).
- Passed in isolated Gentoo staging: candidate SHA-256 `7bcd413323fcdb0551db079a118c5293d202ee77f0dedf8c9dd6613468a9630b` for web-mode and `6d82370cee8340402e7f3b943826ac043fecf0c51f8b1bd23f0509e06b551c16` for smoke, shell/Node syntax, isolated CDP port `19334`, and the complete kiosk smoke. The staging tree contained hard-linked deployed dependencies and only the two independent candidate files; it did not copy `.env.kiosk`, `.tikpal`, or `node_modules`.
- Staging caveat: the existing watchdog smoke inherits `TIKPAL_WEB_MODE_STATE_PATH` in one branch. With `.tikpal` deliberately absent, the first staging run exposed that implicit local-state dependency. The green rerun injected a temporary synthetic active-provider state explicitly; it did not read the live device state or change either candidate hash.
- Passed after atomic deployment: formal hashes matched the candidates; backups `tikpal-web-mode.sh.bak.20260825T133628Z` and `kiosk-package-smoke.mjs.bak.20260825T133628Z` retained the previous hashes and modes; `tikpal-api`, `tikpal-web`, `tikpal-kiosk`, all ten provider Chromium processes, and all provider/window guards retained their PIDs.
- Passed in the post-deploy read-only field check: NetEase remained active at `0,0 1920x720`, Suno remained parked at `2560,0 1920x720`, the Panel remained at `1920,0 640x720`, all three opacity values were `4294967295`, every provider had a real HTTPS CDP page, the lock was free, and neither `.once` nor `.details` existed.
- Prior build note: the last production Vite build completed successfully and retained its existing warning that the main minified JavaScript chunk is larger than `500 kB`; the skip-only snapshot does not change frontend/build inputs.
- Not green: `npm run test:api` still stops at `scene context should prefer IP timezone over a conflicting requested timezone`. This is the existing timezone assertion and is not evidence that the Explore physical path passed or failed.
- Not green: the full interaction smoke passed the Quick Menu skin/toggle assertion in this run, then stopped at `single tap wakes the quick menu screen overlay`. Because the suite stopped there, later Proxy and `640x720` Side Panel assertions were not reached in that complete run; static kiosk smoke and the retained physical frame evidence are separate checks, not a substitute for a green full suite.

These failures are part of the published baseline. Do not describe the snapshot as fully green, and do not silently move either assertion while working on the next NetEase → Suno timing change.

### Close Overlay PID File Fix (2026-08-19)

The `close_close_overlay_veil` and `with_web_mode_lock` functions used `pkill -f "close-overlay"` to terminate the full-screen close overlay Chromium process. On Gentoo, Node.js `execFileAsync("sh", ["-lc", commandWithEnv])` passes environment variables as part of the command line, so `TIKPAL_WEB_MODE_CLOSE_OVERLAY_URL=...close-overlay.html` appeared in `/proc/PID/cmdline`. This caused `pkill -f "close-overlay"` to match the parent `sh -lc` process instead of the Chromium process, sending SIGHUP to the shell and interrupting the `sleep 3.5s` in `park_web_mode_surfaces_for_reopen`.

Fix: replace all `pkill -f "close-overlay"` / `pgrep -f "user-data-dir.*close-overlay\."` with PID-file-only cleanup:
- `with_web_mode_lock`: reads `close-overlay-veil.pid`, kills children via `pkill -P`, kills parent via `kill`
- `close_close_overlay_veil`: keeps existing PID-file kill, removes `pkill -f` fallback (orphan cleanup handled by `with_web_mode_lock` at next entry)

Also fixed fragile `sleep "$(awk ...)"` inline substitution by assigning to a local variable first.

Validation: after open → close cycles, `ps aux | grep close-overlay | grep -v grep | wc -l` returns 0 and the PID file is cleaned up.

### External Source Platform Compatibility (2026-08-20)

`moodeutl` is a moOde-only renderer command. A Gentoo `.env` or `.env.kiosk` must never invoke it directly for Spotify, Bluetooth, AirPlay, or UPnP. A bare command fails under Gentoo before the source helper can reach its native systemd or local-receiver path, which can make a selectable source appear impossible to open.

The `deploy/moode/` directory contains the shared source helpers, not a Gentoo dependency on moOde. Their common `tikpal-moodeutl.sh` shim calls the renderer command only when it exists; on Gentoo it is a successful no-op, so the helpers continue with the platform-native flow.

Use these source hooks on Gentoo:

```conf
TIKPAL_SPOTIFY_ACTIVATE_COMMAND="./deploy/moode/tikpal-spotify-enable.sh"
TIKPAL_SPOTIFY_DISABLE_COMMAND="./deploy/moode/tikpal-spotify-disable.sh"
TIKPAL_BLUETOOTH_ENABLE_COMMAND="./deploy/moode/tikpal-bluetooth-enable.sh"
TIKPAL_BLUETOOTH_DISABLE_COMMAND="./deploy/moode/tikpal-bluetooth-disable.sh"
TIKPAL_AIRPLAY_ENABLE_COMMAND="./deploy/moode/tikpal-airplay-enable.sh"
TIKPAL_AIRPLAY_DISABLE_COMMAND="./deploy/moode/tikpal-airplay-disable.sh"
TIKPAL_UPNP_ENABLE_COMMAND="./deploy/moode/tikpal-upnp-enable.sh"
TIKPAL_UPNP_DISABLE_COMMAND="./deploy/moode/tikpal-upnp-disable.sh"
```

`deploy/deploy-gentoo.sh` checks both device-local `.env` and `.env.kiosk` before it builds or syncs. It rejects bare `moodeutl` in any Spotify/Bluetooth/AirPlay/UPnP activate, enable, or disable hook and prints only the offending file and key. Replace that key with the corresponding helper before retrying. The environment files are deliberately excluded from rsync, so correcting an existing device remains a manual configuration change.

After deploying the helpers, select each available external source once and confirm `/api/v1/system/state` reports it as `armed`/`waiting`; only an actual sender connection may promote it to `connected`. AirPlay additionally requires `shairport-sync.service` to be active after selection. Do not treat an inactive optional receiver before selection as a failed deployment.

### DLNA Fingerprint Recognition And Cross-Surface State (2026-08-22)

A connected DLNA stream first uses trustworthy DIDL metadata for immediate lyrics. When the stream has no usable title/artist, Tikpal may capture six seconds through an MPD `httpd` tap bound only to `127.0.0.1:8001` and send that bounded audio sample to the configured recognition provider. The result remains `lyrics.sourceScope: "upnp_input"`, so Ambient, Player, Hi-Fi, and the portable Remote consume the same artwork/lyrics state rather than introducing a DLNA-only UI path. Recognition is valid only for the current DLNA connection and is refreshed at `TIKPAL_UPNP_RECOGNITION_REFRESH_MS` (default `90000` milliseconds).

The ordinary deploy invokes the existing guarded installer. It installs `Tikpal DLNA Recognition Tap` outside the managed physical-audio output block, leaves the tap disabled at rest, and sets `TIKPAL_UPNP_CAPTURE_COMMAND` in the existing device-local environment only after MPD, MPC, FFmpeg, the MPD `httpd` plugin, and FLAC encoder preflight successfully. A failed preflight leaves capture disabled; DIDL metadata behaviour and the real DAC route remain unchanged. The first successful install restarts MPD once, so schedule it outside active listening when possible.

On 115, check the safe idle state before accepting the feature:

```bash
cd /home/moode/code/tikpal
./deploy/moode/tikpal-upnp-capture-install.sh check
mpc outputs
ss -ltnp '( sport = :8001 )' # no listener while the tap is disabled
```

Run a manual capture only while a real DLNA sender is playing; it enables the tap for the bounded recording and disables it on success, error, or signal:

```bash
capture="$(mktemp --suffix=.wav)"
./deploy/moode/tikpal-upnp-capture.sh "$capture" 6
file "$capture"
rm -f "$capture"
ss -ltnp '( sport = :8001 )' # still no listener after capture
```

### AirPlay Session Truth And Lyrics Wall (2026-08-21)

Gentoo's standalone Shairport Sync does not write moOde's `cfg_system.aplactive` flag. `deploy/moode/tikpal-airplay-state.sh active` therefore treats a sender as connected only when Shairport's system-bus MPRIS player reports `Playing` or `Paused` **and** `ss` shows an established RAOP client on TCP `5000` or `7000`. The script falls back to `aplactive=1` only when that MPRIS/socket path is unavailable, preserving the moOde deployment contract.

The paired MPRIS/socket check matters because cached MPRIS title, artwork, or `Playing` state can briefly survive after a sender disconnects. A listening Shairport service alone is only `armed`; it must not promote stale metadata or lyrics to the physical screen. Verify the live session before accepting AirPlay metadata or the shared Hi-Fi lyrics wall:

```bash
./deploy/moode/tikpal-airplay-state.sh active
busctl --system get-property org.gnome.ShairportSync /org/mpris/MediaPlayer2 \
  org.mpris.MediaPlayer2.Player PlaybackStatus
ss -Htn | awk '$1 == "ESTAB" && $4 ~ /:(5000|7000)$/ { print }'
curl -fsS http://127.0.0.1:8787/api/v1/system/state \
  | jq '.audio.currentSource.connectionState,.playback,.lyrics.status,(.lyrics.lines | length)'
```

For the 115 acceptance run, `Guess Some Dreams Come True — Logan Ryan Band` advanced as an `airplay` `connected` source with current artwork and `lrclib` ready synced lyrics (40 lines); the 2560 x 720 kiosk frame showed the cover-plus-lyrics wall and an advancing highlighted line. Spotify, Bluetooth, and DLNA retain their own active/stream checks and remain `armed` until those independent checks prove a real sender.
