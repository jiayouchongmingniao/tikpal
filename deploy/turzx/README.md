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

## Verification

```bash
systemctl is-active display_turzx.service
lsmod | grep evdi
DISPLAY=:0 XAUTHORITY=/home/moode/.Xauthority xrandr --query
```

Expected USB output names can change across boots, such as `DVI-I-1-1` or
`DVI-I-1-2`. Keep Tikpal display config on `auto` instead of hardcoding one of
those names.

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
