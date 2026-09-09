# FT8201P Linux touchscreen module

Status at the 2026-09-09 `207` source checkpoint: provisional implementation;
kernel compilation, installation, report-format validation, and physical
touch acceptance have not been completed in this work. The USB `27c0:0859`
touchscreen observed during HDMI brightness testing does not establish that
this I2C driver is applicable or validated. This source is not deployed by the
HDMI brightness change.

This is an out-of-tree I2C input driver for the touch interface in FocalTech's
FT8201P integrated display-touch controller. It is intentionally separate from
the Tikpal application: building or installing it does not change the kiosk,
audio, or display services.

The requested panel defaults to a 2560 x 720 coordinate space and ten input
slots. `touchscreen-size-x`, `touchscreen-size-y`, and the generic
`touchscreen-inverted-x`, `touchscreen-inverted-y`, and `touchscreen-swapped-x-y`
properties override the defaults when firmware supplies them.

## Protocol used

The supplied application note establishes these parts of the contract:

- Host touch communication uses I2C or SPI; this module implements I2C only.
- `TP_INT` is falling-edge triggered.
- Touch data is read from working-mode register `0x01`.
- `TP_EXT_RSTN` resets the controller and is the only documented way to exit
  sleep mode.
- Register `0xA5` uses `0x03` for sleep and `0x00` for active mode.

The document refers to a separate *CTPM Register Map* for the point-record
layout but does not include it. The module therefore uses the standard
FocalTech CTPM layout used by the matching working-mode interface:

| Register range | Meaning |
| --- | --- |
| `0x02` | Number of contacts in bits `[3:0]` |
| `0x03..0x08` | First contact: event/X, X, ID/Y, Y, weight, area |
| Next contacts | The same six-byte record, repeated to contact 10 at `0x3e` |
| `0xa5` | Power mode (`0x00` active, `0x03` sleep) |
| `0xa6` | Firmware version |

Before production use, capture one `0x01` report while touching the panel and
confirm the address, contact count, coordinate byte order, and event flags.
The FT8201P application note does **not** state the seven-bit I2C address, so
the address must come from the panel schematic or a non-destructive bus probe.

## Firmware description

For Device Tree systems, use the panel's actual I2C address and GPIO controller
instead of the placeholders below. `reset-gpios` must be present and must
describe the active-low `TP_EXT_RSTN` line.

```dts
&i2c2 {
	status = "okay";

	touchscreen@38 {
		compatible = "focaltech,ft8201p";
		reg = <0x38>; /* Example only: verify from the panel documentation. */

		interrupt-parent = <&gpio0>;
		interrupts = <17 IRQ_TYPE_EDGE_FALLING>; /* TP_INT */
		reset-gpios = <&gpio0 18 GPIO_ACTIVE_LOW>; /* TP_EXT_RSTN */

		touchscreen-size-x = <2560>;
		touchscreen-size-y = <720>;
	};
};
```

For the Gentoo x86 target, ACPI is common. The platform firmware must expose
an I2C child with `compatible = "focaltech,ft8201p"` (for example through a
`PRP0001` ACPI device property). For initial bench testing, create the client
only after verifying the bus number and address:

```sh
BUS=2                 # Replace with the adapter containing TP_I2C_SCL/SDA.
ADDRESS=0x38          # Replace with the verified 7-bit address.
sudo modprobe i2c-dev
sudo i2cdetect -y "$BUS"
echo "ft8201p $ADDRESS" | sudo tee "/sys/bus/i2c/devices/i2c-$BUS/new_device"
```

## Build and verify

On Gentoo, install the matching kernel build tree first. The target kernel must
match `uname -r` exactly.

```sh
cd hardware/ft8201p
make -C /lib/modules/"$(uname -r)"/build M="$PWD" modules
sudo insmod ft8201p.ko

sudo dmesg | tail -n 50
sudo evtest
sudo libinput list-devices
```

Expected evidence is a `FocalTech FT8201P Touchscreen` input node and changing
`ABS_MT_POSITION_X` / `ABS_MT_POSITION_Y` values in `evtest`. Test one contact,
then ten simultaneous contacts, and verify each coordinate stays inside
`0..2559` x `0..719`.

To detach a manually created bench client:

```sh
echo "$ADDRESS" | sudo tee "/sys/bus/i2c/devices/i2c-$BUS/delete_device"
```

This module intentionally does not program LCD initialization or TP firmware.
Those are panel/firmware artifacts handled by the controller's external flash,
not the Linux input path.
