#!/usr/bin/env python3
"""Direct libusb probe for TURZX interface 0.

The default command is read-only and does not claim the display interface. Use
raw bulk writes only in a lab session; the live DisplayTURZXManager owns
interface 0 while the kiosk is visible.
"""

from __future__ import annotations

import argparse
import ctypes
import ctypes.util
import json
from pathlib import Path
import re
import subprocess
import struct
import sys
import time


VID = 0x1A86
PID = 0xAD11
IFACE_DISPLAY = 0
REQ_GET_STATUS = 0x01
REQ_GET_EDID = 0x02
REQ_GET_BACKLIGHT = 0x04
DESC_TYPE_VENDOR = 0x5F
ENDPOINT_OUT = 0x01
CTRL_TIMEOUT_MS = 1000
DEFAULT_SERVICE = "display_turzx.service"
DES_KEY = b"slv3tuzx"

LIBUSB_ENDPOINT_IN = 0x80
LIBUSB_ENDPOINT_OUT = 0x00
LIBUSB_REQUEST_TYPE_STANDARD = 0x00
LIBUSB_REQUEST_TYPE_VENDOR = 0x40
LIBUSB_RECIPIENT_INTERFACE = 0x01
LIBUSB_REQUEST_GET_DESCRIPTOR = 0x06


class ProbeError(RuntimeError):
  pass


class DeviceDescriptor(ctypes.Structure):
  _fields_ = [
    ("bLength", ctypes.c_uint8),
    ("bDescriptorType", ctypes.c_uint8),
    ("bcdUSB", ctypes.c_uint16),
    ("bDeviceClass", ctypes.c_uint8),
    ("bDeviceSubClass", ctypes.c_uint8),
    ("bDeviceProtocol", ctypes.c_uint8),
    ("bMaxPacketSize0", ctypes.c_uint8),
    ("idVendor", ctypes.c_uint16),
    ("idProduct", ctypes.c_uint16),
    ("bcdDevice", ctypes.c_uint16),
    ("iManufacturer", ctypes.c_uint8),
    ("iProduct", ctypes.c_uint8),
    ("iSerialNumber", ctypes.c_uint8),
    ("bNumConfigurations", ctypes.c_uint8)
  ]


def load_libusb() -> ctypes.CDLL:
  path = ctypes.util.find_library("usb-1.0") or "libusb-1.0.so"
  lib = ctypes.CDLL(path)
  lib.libusb_init.argtypes = [ctypes.POINTER(ctypes.c_void_p)]
  lib.libusb_init.restype = ctypes.c_int
  lib.libusb_exit.argtypes = [ctypes.c_void_p]
  lib.libusb_get_device_list.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))]
  lib.libusb_get_device_list.restype = ctypes.c_ssize_t
  lib.libusb_free_device_list.argtypes = [ctypes.POINTER(ctypes.c_void_p), ctypes.c_int]
  lib.libusb_get_device_descriptor.argtypes = [ctypes.c_void_p, ctypes.POINTER(DeviceDescriptor)]
  lib.libusb_get_device_descriptor.restype = ctypes.c_int
  lib.libusb_get_bus_number.argtypes = [ctypes.c_void_p]
  lib.libusb_get_bus_number.restype = ctypes.c_uint8
  lib.libusb_get_device_address.argtypes = [ctypes.c_void_p]
  lib.libusb_get_device_address.restype = ctypes.c_uint8
  lib.libusb_open.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
  lib.libusb_open.restype = ctypes.c_int
  lib.libusb_close.argtypes = [ctypes.c_void_p]
  lib.libusb_control_transfer.argtypes = [
    ctypes.c_void_p, ctypes.c_uint8, ctypes.c_uint8, ctypes.c_uint16, ctypes.c_uint16,
    ctypes.POINTER(ctypes.c_ubyte), ctypes.c_uint16, ctypes.c_uint
  ]
  lib.libusb_control_transfer.restype = ctypes.c_int
  lib.libusb_claim_interface.argtypes = [ctypes.c_void_p, ctypes.c_int]
  lib.libusb_claim_interface.restype = ctypes.c_int
  lib.libusb_release_interface.argtypes = [ctypes.c_void_p, ctypes.c_int]
  lib.libusb_release_interface.restype = ctypes.c_int
  lib.libusb_bulk_transfer.argtypes = [
    ctypes.c_void_p, ctypes.c_ubyte, ctypes.POINTER(ctypes.c_ubyte), ctypes.c_int,
    ctypes.POINTER(ctypes.c_int), ctypes.c_uint
  ]
  lib.libusb_bulk_transfer.restype = ctypes.c_int
  lib.libusb_error_name.argtypes = [ctypes.c_int]
  lib.libusb_error_name.restype = ctypes.c_char_p
  return lib


class UsbContext:
  def __init__(self) -> None:
    self.lib = load_libusb()
    self.ctx = ctypes.c_void_p()
    ret = self.lib.libusb_init(ctypes.byref(self.ctx))
    if ret != 0:
      raise ProbeError(f"libusb_init failed: {self.error_name(ret)}")

  def close(self) -> None:
    if self.ctx:
      self.lib.libusb_exit(self.ctx)
      self.ctx = ctypes.c_void_p()

  def __enter__(self) -> "UsbContext":
    return self

  def __exit__(self, *_exc: object) -> None:
    self.close()

  def error_name(self, ret: int) -> str:
    raw = self.lib.libusb_error_name(ret)
    return raw.decode(errors="replace") if raw else str(ret)


class UsbDevice:
  def __init__(self, ctx: UsbContext) -> None:
    self.ctx = ctx
    self.handle = ctypes.c_void_p()
    self.bus = 0
    self.address = 0
    self.descriptor: DeviceDescriptor | None = None
    self._open_target()

  def _open_target(self) -> None:
    devices = ctypes.POINTER(ctypes.c_void_p)()
    count = self.ctx.lib.libusb_get_device_list(self.ctx.ctx, ctypes.byref(devices))
    if count < 0:
      raise ProbeError(f"libusb_get_device_list failed: {self.ctx.error_name(count)}")
    try:
      for index in range(count):
        dev = devices[index]
        desc = DeviceDescriptor()
        ret = self.ctx.lib.libusb_get_device_descriptor(dev, ctypes.byref(desc))
        if ret != 0:
          continue
        if desc.idVendor != VID or desc.idProduct != PID:
          continue
        handle = ctypes.c_void_p()
        ret = self.ctx.lib.libusb_open(dev, ctypes.byref(handle))
        if ret != 0:
          raise ProbeError(f"libusb_open failed: {self.ctx.error_name(ret)}")
        self.handle = handle
        self.bus = int(self.ctx.lib.libusb_get_bus_number(dev))
        self.address = int(self.ctx.lib.libusb_get_device_address(dev))
        self.descriptor = desc
        return
    finally:
      self.ctx.lib.libusb_free_device_list(devices, 1)
    raise ProbeError(f"TURZX USB display {VID:04x}:{PID:04x} not found")

  def close(self) -> None:
    if self.handle:
      self.ctx.lib.libusb_close(self.handle)
      self.handle = ctypes.c_void_p()

  def __enter__(self) -> "UsbDevice":
    return self

  def __exit__(self, *_exc: object) -> None:
    self.close()

  def control_read(self, request_type: int, request: int, value: int, index: int, length: int) -> bytes:
    buf = (ctypes.c_ubyte * length)()
    ret = self.ctx.lib.libusb_control_transfer(
      self.handle, request_type, request, value, index, buf, length, CTRL_TIMEOUT_MS
    )
    if ret < 0:
      raise ProbeError(f"control read request 0x{request:02x} failed: {self.ctx.error_name(ret)}")
    return bytes(buf[:ret])

  def control_write(self, request_type: int, request: int, value: int, index: int, payload: bytes = b"") -> int:
    if payload:
      buf = (ctypes.c_ubyte * len(payload)).from_buffer_copy(payload)
      data = ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte))
    else:
      data = ctypes.POINTER(ctypes.c_ubyte)()
    ret = self.ctx.lib.libusb_control_transfer(
      self.handle, request_type, request, value, index, data, len(payload), CTRL_TIMEOUT_MS
    )
    if ret < 0:
      raise ProbeError(f"control write request 0x{request:02x} failed: {self.ctx.error_name(ret)}")
    return int(ret)

  def claim_display(self) -> None:
    ret = self.ctx.lib.libusb_claim_interface(self.handle, IFACE_DISPLAY)
    if ret != 0:
      raise ProbeError(f"claim interface 0 failed: {self.ctx.error_name(ret)}")

  def release_display(self) -> None:
    self.ctx.lib.libusb_release_interface(self.handle, IFACE_DISPLAY)

  def bulk_write(self, payload: bytes, timeout_ms: int = 1000) -> int:
    data = (ctypes.c_ubyte * len(payload)).from_buffer_copy(payload)
    transferred = ctypes.c_int()
    ret = self.ctx.lib.libusb_bulk_transfer(
      self.handle, ENDPOINT_OUT, data, len(payload), ctypes.byref(transferred), timeout_ms
    )
    if ret != 0:
      raise ProbeError(f"bulk write failed: {self.ctx.error_name(ret)}")
    return int(transferred.value)


def service_active(service: str) -> bool:
  return subprocess.run(["systemctl", "is-active", "--quiet", service]).returncode == 0


def parse_hex(raw: str) -> bytes:
  compact = re.sub(r"[^0-9a-fA-F]", "", raw)
  if len(compact) % 2:
    raise ProbeError("hex payload has odd length")
  return bytes.fromhex(compact)


def read_all() -> dict[str, object]:
  with UsbContext() as ctx, UsbDevice(ctx) as dev:
    reads: dict[str, bytes] = {}
    errors: dict[str, str] = {}

    def safe_read(name: str, request_type: int, request: int, value: int, index: int, length: int) -> bytes:
      try:
        data = dev.control_read(request_type, request, value, index, length)
        reads[name] = data
        return data
      except ProbeError as exc:
        errors[name] = str(exc)
        return b""

    status = safe_read(
      "status",
      LIBUSB_ENDPOINT_IN | LIBUSB_REQUEST_TYPE_VENDOR | LIBUSB_RECIPIENT_INTERFACE,
      REQ_GET_STATUS, 0, 0, 4
    )
    backlight = safe_read(
      "backlight",
      LIBUSB_ENDPOINT_IN | LIBUSB_REQUEST_TYPE_VENDOR | LIBUSB_RECIPIENT_INTERFACE,
      REQ_GET_BACKLIGHT, 0, IFACE_DISPLAY, 4
    )
    vendor_descriptor = safe_read(
      "vendorDescriptor",
      LIBUSB_ENDPOINT_IN | LIBUSB_REQUEST_TYPE_STANDARD | LIBUSB_RECIPIENT_INTERFACE,
      LIBUSB_REQUEST_GET_DESCRIPTOR, DESC_TYPE_VENDOR << 8, IFACE_DISPLAY, 512
    )
    edid = safe_read(
      "edid",
      LIBUSB_ENDPOINT_IN | LIBUSB_REQUEST_TYPE_VENDOR | LIBUSB_RECIPIENT_INTERFACE,
      REQ_GET_EDID, 0, IFACE_DISPLAY, 128
    )
    desc = dev.descriptor
    return {
      "bus": dev.bus,
      "address": dev.address,
      "device": {
        "vid": f"{VID:04x}",
        "pid": f"{PID:04x}",
        "bcdDevice": f"{desc.bcdDevice:04x}" if desc else None
      },
      "statusHex": status.hex(),
      "statusLe32": int.from_bytes(status.ljust(4, b"\x00"), "little"),
      "backlightHex": backlight.hex(),
      "backlightFirstByte": backlight[0] if backlight else None,
      "vendorDescriptorLength": len(vendor_descriptor),
      "vendorDescriptorPrefixHex": vendor_descriptor[:64].hex(),
      "edidLength": len(edid),
      "edidPrefixHex": edid[:32].hex(),
      "errors": errors,
      "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }


def do_bulk_write(args: argparse.Namespace) -> dict[str, object]:
  if service_active(args.service) and not args.allow_service_active:
    raise ProbeError(f"{args.service} is active; stop it or pass --allow-service-active")
  payload = parse_hex(args.hex)
  if len(payload) > args.max_bytes:
    raise ProbeError(f"payload too long: {len(payload)} > {args.max_bytes}")
  with UsbContext() as ctx, UsbDevice(ctx) as dev:
    dev.claim_display()
    try:
      written = dev.bulk_write(payload, timeout_ms=args.timeout_ms)
    finally:
      dev.release_display()
    return {"bus": dev.bus, "address": dev.address, "writtenBytes": written, "payloadHex": payload.hex()}


def clamp_percent(value: int | str) -> int:
  try:
    parsed = int(value)
  except (TypeError, ValueError):
    raise ProbeError("brightness must be an integer") from None
  return max(1, min(100, parsed))


def register_write(register: int, value: int) -> bytes:
  return bytes([0xAF, 0x20, register & 0xFF, value & 0xFF])


def display_mode_payload(percent: int, *, width: int = 2560, height: int = 720) -> bytes:
  # This mirrors DisplayTURZXManager's normal mode setup command stream.
  payload = bytearray()
  payload += register_write(0x00, 0x02)  # XRGB888
  payload += register_write(0x01, width >> 8)
  payload += register_write(0x02, width)
  payload += register_write(0x03, height >> 8)
  payload += register_write(0x04, height)
  payload += register_write(0x06, 0x01)
  payload += register_write(0x11, 0x01)  # MJPEG on, matching this host's patched setup
  payload += register_write(0x1F, 0x01)
  payload += register_write(0x05, percent)
  return bytes(payload)


def command_packet(command_id: int, value: int | None = None) -> bytearray:
  packet = bytearray(500)
  packet[0] = command_id & 0xFF
  packet[2] = 0x1A
  packet[3] = 0x6D
  now = time.localtime()
  midnight = time.mktime((now.tm_year, now.tm_mon, now.tm_mday, 0, 0, 0, now.tm_wday, now.tm_yday, now.tm_isdst))
  packet[4:8] = struct.pack("<I", int((time.time() - midnight) * 1000))
  if value is not None:
    packet[8] = value & 0xFF
  return packet


def encrypt_des_cbc_with_openssl(data: bytes) -> bytes:
  padded = data.ljust(((len(data) + 7) // 8) * 8, b"\x00")
  key_hex = DES_KEY.hex()
  command = [
    "openssl", "enc", "-des-cbc", "-provider", "legacy", "-provider", "default",
    "-K", key_hex, "-iv", key_hex, "-nosalt", "-nopad"
  ]
  proc = subprocess.run(command, input=padded, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
  if proc.returncode != 0:
    raise ProbeError(f"openssl DES failed: {proc.stderr.decode(errors='replace').strip()}")
  return proc.stdout


def turing_usb_command_payload(command_id: int, value: int | None = None) -> bytes:
  encrypted = encrypt_des_cbc_with_openssl(bytes(command_packet(command_id, value)))
  payload = bytearray(512)
  payload[:len(encrypted)] = encrypted[:512]
  payload[510] = 0xA1
  payload[511] = 0x1A
  return bytes(payload)


def brightness_candidates(percent: int) -> list[dict[str, object]]:
  return [
    {
      "name": "bulk-blank-register",
      "kind": "bulk",
      "payload": register_write(0x05, percent),
    },
    {
      "name": "bulk-on-plus-blank-register",
      "kind": "bulk",
      "payload": register_write(0x1F, 0x01) + register_write(0x05, percent),
    },
    {
      "name": "bulk-off-on-plus-blank-register",
      "kind": "bulk",
      "payload": register_write(0x1F, 0x02) + register_write(0x1F, 0x01) + register_write(0x05, percent),
    },
    {
      "name": "bulk-full-mode-plus-blank",
      "kind": "bulk",
      "payload": display_mode_payload(percent),
    },
    {
      "name": "bulk-turing-usb-brightness-id14",
      "kind": "bulk",
      "payload": turing_usb_command_payload(14, int(percent / 100 * 102)),
    },
    {
      "name": "control-out-request-04-value",
      "kind": "control",
      "request": 0x04,
      "value": percent,
      "index": IFACE_DISPLAY,
      "payload": b"",
    },
    {
      "name": "control-out-request-05-value",
      "kind": "control",
      "request": 0x05,
      "value": percent,
      "index": IFACE_DISPLAY,
      "payload": b"",
    },
    {
      "name": "control-out-request-04-byte",
      "kind": "control",
      "request": 0x04,
      "value": 0,
      "index": IFACE_DISPLAY,
      "payload": bytes([percent]),
    },
    {
      "name": "control-out-request-05-byte",
      "kind": "control",
      "request": 0x05,
      "value": 0,
      "index": IFACE_DISPLAY,
      "payload": bytes([percent]),
    },
  ]


def run_systemctl(action: str, service: str) -> dict[str, object]:
  proc = subprocess.run(["systemctl", action, service], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
  return {
    "action": action,
    "service": service,
    "returncode": proc.returncode,
    "stdout": proc.stdout.strip(),
    "stderr": proc.stderr.strip(),
  }


def run_helper_restore(helper: str, percent: int) -> dict[str, object]:
  proc = subprocess.run([helper, "set", str(percent)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
  return {
    "command": [helper, "set", str(percent)],
    "returncode": proc.returncode,
    "stdout": proc.stdout.strip(),
    "stderr": proc.stderr.strip(),
  }


def run_candidate(dev: UsbDevice, candidate: dict[str, object], timeout_ms: int) -> dict[str, object]:
  kind = str(candidate["kind"])
  if kind == "bulk":
    payload = candidate["payload"]
    assert isinstance(payload, bytes)
    written = dev.bulk_write(payload, timeout_ms=timeout_ms)
    return {"kind": kind, "writtenBytes": written, "payloadHex": payload.hex()}
  if kind == "control":
    payload = candidate["payload"]
    assert isinstance(payload, bytes)
    request = int(candidate["request"])
    value = int(candidate["value"])
    index = int(candidate["index"])
    written = dev.control_write(
      LIBUSB_ENDPOINT_OUT | LIBUSB_REQUEST_TYPE_VENDOR | LIBUSB_RECIPIENT_INTERFACE,
      request,
      value,
      index,
      payload,
    )
    return {
      "kind": kind,
      "writtenBytes": written,
      "request": f"0x{request:02x}",
      "value": f"0x{value:04x}",
      "index": f"0x{index:04x}",
      "payloadHex": payload.hex(),
    }
  raise ProbeError(f"unknown candidate kind: {kind}")


def try_brightness_exclusive(args: argparse.Namespace) -> dict[str, object]:
  if not args.exclusive:
    raise ProbeError("exclusive brightness probing requires --exclusive")

  percent = clamp_percent(args.percent)
  restore_percent = clamp_percent(args.restore_percent)
  selected = set(args.candidate or [])
  candidates = [item for item in brightness_candidates(percent) if not selected or item["name"] in selected]
  if not candidates:
    raise ProbeError("no matching candidates selected")

  service_was_active = service_active(args.service)
  records: list[dict[str, object]] = []
  stop_result: dict[str, object] | None = None
  start_result: dict[str, object] | None = None
  restore_result: dict[str, object] | None = None

  before = read_all()
  try:
    if service_was_active:
      stop_result = run_systemctl("stop", args.service)
      if stop_result["returncode"] != 0:
        raise ProbeError(f"failed to stop {args.service}: {stop_result['stderr']}")
      time.sleep(args.stop_settle_seconds)

    with UsbContext() as ctx, UsbDevice(ctx) as dev:
      dev.claim_display()
      try:
        for candidate in candidates:
          record: dict[str, object] = {"candidate": candidate["name"], "percent": percent}
          try:
            record.update(run_candidate(dev, candidate, args.timeout_ms))
            time.sleep(args.settle_seconds)
            try:
              readback = dev.control_read(
                LIBUSB_ENDPOINT_IN | LIBUSB_REQUEST_TYPE_VENDOR | LIBUSB_RECIPIENT_INTERFACE,
                REQ_GET_BACKLIGHT, 0, IFACE_DISPLAY, 4
              )
              record["backlightHex"] = readback.hex()
              record["backlightFirstByte"] = readback[0] if readback else None
            except ProbeError as exc:
              record["readbackError"] = str(exc)
          except ProbeError as exc:
            record["error"] = str(exc)
          record["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
          records.append(record)
      finally:
        dev.release_display()
  finally:
    if service_was_active or args.start_after:
      start_result = run_systemctl("start", args.service)
      time.sleep(args.start_settle_seconds)
    if args.restore_helper:
      restore_result = run_helper_restore(args.restore_helper, restore_percent)

  return {
    "bus": before.get("bus"),
    "address": before.get("address"),
    "before": before,
    "serviceWasActive": service_was_active,
    "stop": stop_result,
    "records": records,
    "start": start_result,
    "restore": restore_result,
    "after": read_all(),
    "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
  }


def parse_int(raw: str) -> int:
  return int(raw, 0)


def scan_controls(args: argparse.Namespace) -> dict[str, object]:
  requests = range(parse_int(args.start), parse_int(args.end) + 1)
  indexes = [parse_int(item) for item in args.index]
  results: list[dict[str, object]] = []
  with UsbContext() as ctx, UsbDevice(ctx) as dev:
    for request in requests:
      for index in indexes:
        try:
          data = dev.control_read(
            LIBUSB_ENDPOINT_IN | LIBUSB_REQUEST_TYPE_VENDOR | LIBUSB_RECIPIENT_INTERFACE,
            request, parse_int(args.value), index, args.length
          )
        except ProbeError:
          continue
        if args.only_nonzero and not any(data):
          continue
        results.append({
          "request": f"0x{request:02x}",
          "value": f"0x{parse_int(args.value):04x}",
          "index": f"0x{index:04x}",
          "length": len(data),
          "hex": data.hex(),
          "firstByte": data[0] if data else None,
          "le32": int.from_bytes(data[:4].ljust(4, b"\x00"), "little") if data else None
        })
  return {
    "requestRange": [args.start, args.end],
    "indexes": args.index,
    "results": results,
    "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
  }


def main() -> int:
  parser = argparse.ArgumentParser(description="Direct TURZX libusb probe")
  subparsers = parser.add_subparsers(dest="command")
  subparsers.add_parser("read", help="read status, backlight, vendor descriptor, and EDID")

  write_parser = subparsers.add_parser("bulk-write", help="explicit interface-0 bulk write; lab use only")
  write_parser.add_argument("--hex", required=True)
  write_parser.add_argument("--service", default=DEFAULT_SERVICE)
  write_parser.add_argument("--allow-service-active", action="store_true")
  write_parser.add_argument("--max-bytes", type=int, default=16)
  write_parser.add_argument("--timeout-ms", type=int, default=1000)

  exclusive_parser = subparsers.add_parser(
    "try-brightness-exclusive",
    help="stop DisplayTURZXManager briefly and test bounded interface-0 brightness candidates"
  )
  exclusive_parser.add_argument("percent", type=int)
  exclusive_parser.add_argument("--exclusive", action="store_true", help="required safety acknowledgement")
  exclusive_parser.add_argument("--candidate", action="append", help="limit to one or more candidate names")
  exclusive_parser.add_argument("--service", default=DEFAULT_SERVICE)
  exclusive_parser.add_argument("--restore-percent", type=int, default=45)
  exclusive_parser.add_argument("--restore-helper", default="/usr/local/sbin/tikpal-turzx-brightness")
  exclusive_parser.add_argument("--start-after", action="store_true", help="start service even if it was inactive")
  exclusive_parser.add_argument("--stop-settle-seconds", type=float, default=1.0)
  exclusive_parser.add_argument("--start-settle-seconds", type=float, default=2.0)
  exclusive_parser.add_argument("--settle-seconds", type=float, default=0.6)
  exclusive_parser.add_argument("--timeout-ms", type=int, default=1000)

  scan_parser = subparsers.add_parser("scan-controls", help="read-only vendor IN request scan")
  scan_parser.add_argument("--start", default="0x00")
  scan_parser.add_argument("--end", default="0x3f")
  scan_parser.add_argument("--value", default="0x0000")
  scan_parser.add_argument("--index", action="append", default=["0x0000", "0x0001", "0x0002"])
  scan_parser.add_argument("--length", type=int, default=4)
  scan_parser.add_argument("--only-nonzero", action="store_true")

  args = parser.parse_args()
  command = args.command or "read"
  try:
    if command == "read":
      print(json.dumps(read_all(), indent=2, sort_keys=True))
      return 0
    if command == "bulk-write":
      print(json.dumps(do_bulk_write(args), indent=2, sort_keys=True))
      return 0
    if command == "try-brightness-exclusive":
      print(json.dumps(try_brightness_exclusive(args), indent=2, sort_keys=True))
      return 0
    if command == "scan-controls":
      print(json.dumps(scan_controls(args), indent=2, sort_keys=True))
      return 0
  except ProbeError as exc:
    print(f"ERROR: {exc}", file=sys.stderr)
    return 2
  return 2


if __name__ == "__main__":
  raise SystemExit(main())
