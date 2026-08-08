# TURZX USB/EVDI Display

Tikpal can mirror or fall back to a TURZX USB display through EVDI. The kiosk
display scripts are repo-owned; the TURZX driver source/binary package is not
vendored here until its redistribution terms are confirmed.

## Driver Source

Place an approved TURZX driver source tree at:

```text
deploy/vendor/evdi-display-linux-turzx2/
```

or pass an explicit path:

```bash
sudo deploy/turzx/install-turzx-evdi-display.sh --source /root/evdi-display-linux-turzx2 install
```

The source tree must contain `Makefile`, `display_turzx-installer.sh`, and the
`display_*.c` files.

Brightness is controlled by the existing Ambient left-edge vertical swipe. The
backend sends the requested percentage to the installed helper, which writes a
5-byte HID output report to `/dev/hidraw1` by default:

```text
printf '\\x00\\xaa\\x55\\x30\\x0a' > /dev/hidraw1  # 10%
printf '\\x00\\xaa\\x55\\x30\\x32' > /dev/hidraw1  # 50%
printf '\\x00\\xaa\\x55\\x30\\x64' > /dev/hidraw1  # 100%
```

Set `TIKPAL_TURZX_HIDRAW_PATH` to a stable `/dev/hidraw/by-id/...` path if
enumeration changes across boots. The API remains the only component that
writes the HID device; the browser continues to use `brightness_set`.

Tikpal applies repo-owned patches before running the vendor installer. The
current patches add userspace brightness control and readback diagnostics to
`DisplayTURZXManager` through the existing `/tmp/TURZXPmMessagesPort_in` FIFO:

```text
S         suspend / DPMS off
R         resume / DPMS on
B45       set saved TURZX backlight to 45%
G         read hardware backlight when the panel reports it
```

The write path first uses the existing TURZX bulk display command
`DISPLAY_CMD_BLANK_VALUE`. On the current 8.8-inch panel, hardware readback
continues to report `100`, so Tikpal falls back to RandR visual brightness and
reports `transport:"turzx-soft"`. This does not save panel backlight power, but
it makes the user-facing brightness gesture visibly work. It does not add a
kernel HID/backlight driver and it does not depend on `/sys/class/backlight`.
Because this panel briefly blanks when the vendor brightness command is sent,
Tikpal defaults `TIKPAL_TURZX_HARDWARE_BRIGHTNESS_ENABLED=0` and goes straight
to the soft RandR path. Set it to `1` only after a specific TURZX panel has a
verified hardware backlight protocol.

The panel also exposes two HID interfaces. `hidraw2` is the touch device and
must stay read-only. `hidraw3` is a vendor HID interface with one 512-byte
Output report and one 512-byte Input report. Tikpal keeps a diagnostic probe at
`/usr/local/sbin/tikpal-turzx-hid-probe` for controlled reverse engineering:

```bash
sudo /usr/local/sbin/tikpal-turzx-hid-probe describe
sudo /usr/local/sbin/tikpal-turzx-hid-probe read --seconds 2
sudo /usr/local/sbin/tikpal-turzx-hid-probe try-brightness 25 --restore-percent 45
sudo /usr/local/sbin/tikpal-turzx-hid-probe try-brightness 25 \
  --no-report-id-prefix \
  --candidate turing-encrypted-brightness-id14 \
  --restore-percent 45
```

The probe refuses the touch interface and writes only to the `hid-generic`
TURZX vendor node. Current low-risk candidates write successfully, including
the encrypted command-id `14` pattern documented by the unofficial
[`turing-smart-screen-cli`](https://github.com/phstudy/turing-smart-screen-cli)
work. This panel's report descriptor has no Report ID, so the probe supports
both 513-byte report-id-prefixed writes and exact 512-byte
`--no-report-id-prefix` writes. Both forms were tested against `hidraw3`; they
do not return input reports and the panel still reports hardware brightness
`100`. A direct `HIDIOCSFEATURE` feature-report attempt also returns
`Broken pipe`, which matches the descriptor having only Input/Output reports.
Therefore this HID path is not enabled in production yet. Use
`--include-persistent` only for lab work because it tries device settings
commands that may persist on the panel.

For interface-0 evidence, Tikpal also installs a usbmon capture wrapper. It
does not write raw USB payloads; it only records traffic while the existing
brightness helper sends a value and restores the safe default:

```bash
sudo /usr/local/sbin/tikpal-turzx-usb-probe read
sudo /usr/local/sbin/tikpal-turzx-usbmon-capture 33
sudo /usr/local/sbin/tikpal-turzx-usb-probe try-brightness-exclusive 25 \
  --exclusive \
  --candidate bulk-turing-usb-brightness-id14 \
  --restore-percent 45
```

On the current panel, direct libusb reads return status `0x18`, EDID data, and
backlight `0x64` (`100`). Usbmon confirms the helper sends
`AF 20 1F 01 AF 20 05 21` for brightness `33`, and
`AF 20 1F 01 AF 20 05 2D` when restored to `45`. The matching vendor control
read `c1 04` still returns `0x64`, so the command reaches the device but does
not control this panel's hardware backlight. In an exclusive lab run where
`display_turzx.service` is stopped briefly, interface-0 bulk candidates
including `AF 20` register forms, a full mode-set-plus-blank-value payload, and
the Turing USB DES-CBC command-id `14` brightness packet write successfully, but
the hardware readback still remains `100`. Vendor control-OUT requests `0x04`
and `0x05` stall with `LIBUSB_ERROR_PIPE`.

The direct probe can also scan read-only vendor control requests:

```bash
sudo /usr/local/sbin/tikpal-turzx-usb-probe scan-controls --start 0x00 --end 0x3f --length 4 --only-nonzero
```

On this panel, the scan only finds `0x01=status`, `0x02=EDID`, and
`0x04=backlight readback`. There is no alternate short vendor-IN backlight
readback in `0x00..0x3f`.

## Gentoo Install

The installer wrapper prepares the Gentoo EVDI prerequisites, calls the TURZX
source tree's `make install`, then starts `display_turzx.service`:

```bash
sudo deploy/turzx/install-turzx-evdi-display.sh install
```

Use a proxy by exporting the usual Portage fetch variables before installing,
for example:

```bash
export http_proxy=http://127.0.0.1:7897
export https_proxy=http://127.0.0.1:7897
sudo -E deploy/turzx/install-turzx-evdi-display.sh install
```

The wrapper also installs the root-owned helper:

```bash
sudo /usr/local/sbin/tikpal-turzx-brightness status
sudo /usr/local/sbin/tikpal-turzx-brightness set 45
sudo /usr/local/sbin/tikpal-turzx-hid-probe describe
sudo /usr/local/sbin/tikpal-turzx-usb-probe read
sudo /usr/local/sbin/tikpal-turzx-usbmon-capture 33
```

Set `TIKPAL_TURZX_APPLY_PATCHES=0` only when intentionally installing an
unmodified vendor tree for rollback.

## Verification

```bash
systemctl is-active display_turzx.service
lsmod | grep evdi
DISPLAY=:0 XAUTHORITY=/home/moode/.Xauthority xrandr --query
sudo /usr/local/sbin/tikpal-turzx-brightness status
sudo /usr/local/sbin/tikpal-turzx-brightness set 25
sudo /usr/local/sbin/tikpal-turzx-brightness set 45
sudo /usr/local/sbin/tikpal-turzx-brightness set 75
```

Expected USB output names can change across boots, such as `DVI-I-1-1` or
`DVI-I-1-2`. Keep Tikpal display config on `auto` instead of hardcoding one of
those names.

When the primary RandR output is a TURZX `DVI-I-*` / `DVI-D-*` output and
`TIKPAL_TURZX_BRIGHTNESS_COMMAND` points at the helper, Tikpal's existing
`brightness_set` action controls the USB panel brightness path. If the hardware
backlight accepts the value, state reports `transport:"turzx"`; if hardware
readback stays fixed, the helper applies `xrandr --brightness` and state reports
`transport:"turzx-soft"`. HDMI/DDC displays continue to use the DDC/CI path.
User-facing brightness should stay above zero; use Screen Sleep for a
touch-wake black screen.

For the current `1a86:ad11` EVDI panel, keep:

```bash
export TIKPAL_TURZX_HARDWARE_BRIGHTNESS_ENABLED=0
```

This avoids the visible black flash that happens when the unverified hardware
brightness command is sent before the soft fallback.

## Boot Enumeration Recovery

If `display_turzx.service` is active and `evdi` is loaded but no `/dev/dri/card1`
or EVDI RandR output appears, check USB enumeration before debugging Tikpal:

```bash
lsusb -t
dmesg -T | grep -Ei 'usb .*error -71|unable to enumerate|evdi|turzx' | tail -80
```

`device descriptor read/64, error -71` means the TURZX USB device did not
enumerate. On the Gentoo target, Tikpal can perform one guarded controller
rebind during kiosk startup:

```conf
TIKPAL_TURZX_USB_RECOVERY_ENABLED=1
TIKPAL_TURZX_USB_RECOVERY_PCI_DEVICE=0000:00:1a.0
```

If the same USB error remains after that recovery and a reboot, the failure is
below EVDI; physically replug or power-cycle the USB display path.
