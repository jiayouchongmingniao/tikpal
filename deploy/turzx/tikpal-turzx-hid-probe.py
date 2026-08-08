#!/usr/bin/env python3
"""Probe the TURZX vendor HID interface without touching the touch hidraw node.

This tool is intentionally conservative. The default command is read-only; any
write path first verifies that the selected hidraw node is the TURZX hid-generic
vendor interface, not the hid-multitouch touch interface.
"""

from __future__ import annotations

import argparse
import binascii
import errno
import fcntl
import json
import os
from pathlib import Path
import re
import select
import struct
import subprocess
import sys
import time
from typing import Iterable


USB_ID = "1a86:ad11"
HID_NAME = "TURZX USB Display"
HID_DRIVER = "hid-generic"
HID_OUTPUT_REPORT_BYTES = 512
HIDRAW_WRITE_BYTES = HID_OUTPUT_REPORT_BYTES + 1
DEFAULT_LOG_PATH = Path("/tmp/tikpal-turzx-hid-probe.jsonl")
DEFAULT_HELPER = "/usr/local/sbin/tikpal-turzx-brightness"
DES_KEY = b"slv3tuzx"


class ProbeError(RuntimeError):
  pass


def read_text(path: Path) -> str:
  try:
    return path.read_text(errors="replace").strip()
  except OSError:
    return ""


def parse_uevent(path: Path) -> dict[str, str]:
  result: dict[str, str] = {}
  for line in read_text(path).splitlines():
    if "=" not in line:
      continue
    key, value = line.split("=", 1)
    result[key] = value
  return result


def symlink_target_name(path: Path) -> str:
  try:
    return Path(os.readlink(path)).name
  except OSError:
    return ""


def descriptor_hex(device_sysfs: Path) -> str:
  try:
    return (device_sysfs / "report_descriptor").read_bytes().hex()
  except OSError:
    return ""


def parse_interface_from_sysfs(device_sysfs: Path) -> str | None:
  # Example path segment: 2-1.6:1.2, where "2" is the USB interface number.
  for part in device_sysfs.resolve().parts:
    match = re.search(r":\d+\.(\d+)$", part)
    if match:
      return match.group(1).zfill(2)
  return None


def find_devices() -> list[dict[str, object]]:
  devices: list[dict[str, object]] = []
  for hidraw_sysfs in sorted(Path("/sys/class/hidraw").glob("hidraw*")):
    device_sysfs = hidraw_sysfs / "device"
    uevent = parse_uevent(device_sysfs / "uevent")
    driver = uevent.get("DRIVER") or symlink_target_name(device_sysfs / "driver")
    hid_id = uevent.get("HID_ID", "")
    devname = f"/dev/{hidraw_sysfs.name}"
    interface_num = parse_interface_from_sysfs(device_sysfs)
    devices.append({
      "hidraw": devname,
      "sysfs": str(device_sysfs.resolve()),
      "driver": driver,
      "hidName": uevent.get("HID_NAME", ""),
      "hidId": hid_id,
      "hidPhys": uevent.get("HID_PHYS", ""),
      "hidUniq": uevent.get("HID_UNIQ", ""),
      "interface": interface_num,
      "descriptorHex": descriptor_hex(device_sysfs),
      "isTarget": driver == HID_DRIVER and uevent.get("HID_NAME") == HID_NAME and "00001A86" in hid_id.upper() and "0000AD11" in hid_id.upper(),
      "isTouch": driver == "hid-multitouch"
    })
  return devices


def select_device(path: str | None = None) -> dict[str, object]:
  devices = find_devices()
  if path:
    for device in devices:
      if device["hidraw"] == path:
        assert_safe_target(device)
        return device
    raise ProbeError(f"{path} is not a known hidraw device")

  targets = [device for device in devices if device["isTarget"]]
  if not targets:
    raise ProbeError("TURZX hid-generic vendor hidraw device was not found")
  if len(targets) > 1:
    preferred = [device for device in targets if device.get("interface") == "02"]
    if len(preferred) == 1:
      return preferred[0]
    raise ProbeError(f"multiple TURZX vendor hidraw devices found: {[d['hidraw'] for d in targets]}")
  return targets[0]


def assert_safe_target(device: dict[str, object]) -> None:
  if device.get("isTouch"):
    raise ProbeError(f"refusing to write to touch interface {device.get('hidraw')}")
  if device.get("driver") != HID_DRIVER:
    raise ProbeError(f"refusing non-vendor HID driver {device.get('driver')} at {device.get('hidraw')}")
  if device.get("hidName") != HID_NAME:
    raise ProbeError(f"refusing non-TURZX hidraw device {device.get('hidraw')}")
  hid_id = str(device.get("hidId", "")).upper()
  if "00001A86" not in hid_id or "0000AD11" not in hid_id:
    raise ProbeError(f"refusing unexpected HID id {device.get('hidId')} at {device.get('hidraw')}")


def helper_json(command: Iterable[str]) -> object | None:
  try:
    output = subprocess.check_output(list(command), text=True, stderr=subprocess.STDOUT, timeout=3)
  except (OSError, subprocess.SubprocessError):
    return None
  try:
    return json.loads(output)
  except json.JSONDecodeError:
    return output.strip()


def describe(helper: str = DEFAULT_HELPER) -> dict[str, object]:
  status = helper_json([helper, "status"]) if helper else None
  return {
    "usbId": USB_ID,
    "devices": find_devices(),
    "target": select_device(),
    "helperStatus": status,
    "updatedAt": utc_timestamp()
  }


def utc_timestamp() -> str:
  return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def hexdump(data: bytes, width: int = 16) -> str:
  lines: list[str] = []
  for offset in range(0, len(data), width):
    chunk = data[offset:offset + width]
    hex_part = " ".join(f"{byte:02x}" for byte in chunk)
    lines.append(f"{offset:04x}: {hex_part}")
  return "\n".join(lines)


def read_nonblocking(hidraw: str, seconds: float) -> list[str]:
  deadline = time.monotonic() + seconds
  chunks: list[str] = []
  fd = os.open(hidraw, os.O_RDONLY | os.O_NONBLOCK)
  try:
    while time.monotonic() < deadline:
      timeout = max(0, min(0.2, deadline - time.monotonic()))
      readable, _, _ = select.select([fd], [], [], timeout)
      if not readable:
        continue
      try:
        data = os.read(fd, HID_OUTPUT_REPORT_BYTES)
      except BlockingIOError:
        continue
      if data:
        chunks.append(data.hex())
  finally:
    os.close(fd)
  return chunks


def normalize_payload(payload: bytes, *, allow_prefixed: bool = False, report_id_prefix: bool = True) -> bytes:
  if not report_id_prefix:
    if len(payload) == HID_OUTPUT_REPORT_BYTES:
      return payload
    raise ProbeError(f"unprefixed payload must be {HID_OUTPUT_REPORT_BYTES} bytes, got {len(payload)}")
  if len(payload) == HID_OUTPUT_REPORT_BYTES:
    return b"\x00" + payload
  if allow_prefixed and len(payload) == HIDRAW_WRITE_BYTES:
    if payload[0] != 0:
      raise ProbeError("only report id 0x00 is allowed for this descriptor")
    return payload
  raise ProbeError(f"payload must be {HID_OUTPUT_REPORT_BYTES} bytes, got {len(payload)}")


def write_output_report(hidraw: str, payload: bytes, *, report_id_prefix: bool = True) -> int:
  report = normalize_payload(payload, report_id_prefix=report_id_prefix)
  fd = os.open(hidraw, os.O_WRONLY | os.O_NONBLOCK)
  try:
    try:
      return os.write(fd, report)
    except OSError as exc:
      if exc.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
        _, writable, _ = select.select([], [fd], [], 1)
        if writable:
          return os.write(fd, report)
      raise
  finally:
    os.close(fd)


def command_packet(command_id: int, value: int | None = None) -> bytearray:
  packet = bytearray(500)
  packet[0] = command_id & 0xff
  packet[2] = 0x1A
  packet[3] = 0x6D
  now = time.localtime()
  midnight = time.mktime((now.tm_year, now.tm_mon, now.tm_mday, 0, 0, 0, now.tm_wday, now.tm_yday, now.tm_isdst))
  timestamp_ms = int((time.time() - midnight) * 1000)
  packet[4:8] = struct.pack("<I", timestamp_ms)
  if value is not None:
    packet[8] = value & 0xff
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


def encrypted_turing_payload(command_id: int, value: int | None = None) -> bytes:
  encrypted = encrypt_des_cbc_with_openssl(bytes(command_packet(command_id, value)))
  payload = bytearray(HID_OUTPUT_REPORT_BYTES)
  payload[:len(encrypted)] = encrypted[:HID_OUTPUT_REPORT_BYTES]
  payload[510] = 0xA1
  payload[511] = 0x1A
  return bytes(payload)


def candidate_payloads(percent: int, *, include_persistent: bool = False) -> list[tuple[str, bytes]]:
  payloads: list[tuple[str, bytes]] = []

  def blank(name: str, entries: Iterable[int]) -> None:
    payload = bytearray(HID_OUTPUT_REPORT_BYTES)
    for idx, byte in enumerate(entries):
      payload[idx] = byte & 0xff
    payloads.append((name, bytes(payload)))

  blank("all-zero", [])
  blank("value-at-0", [percent])
  blank("cmd05-value", [0x05, percent])
  blank("value-cmd05", [percent, 0x05])
  blank("turzx-register-blank-value", [0xAF, 0x20, 0x05, percent])
  blank("turzx-register-on-blank-value", [0xAF, 0x20, 0x1F, 0x01, 0xAF, 0x20, 0x05, percent])
  blank("vendor-len-cmd-value", [0x00, 0x04, 0xAF, 0x20, 0x05, percent])
  payloads.append(("turing-encrypted-brightness-id14", encrypted_turing_payload(14, percent)))
  if include_persistent:
    payloads.append(("turing-encrypted-save-settings-id125", encrypted_turing_payload(125, percent)))
  return payloads


def append_log(path: Path, record: dict[str, object]) -> None:
  path.parent.mkdir(parents=True, exist_ok=True)
  with path.open("a") as handle:
    handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")


def run_restore(helper: str, percent: int) -> object | None:
  if not helper:
    return None
  try:
    output = subprocess.check_output([helper, "set", str(percent)], stderr=subprocess.STDOUT, text=True, timeout=4)
    return output.strip()
  except (OSError, subprocess.SubprocessError) as exc:
    return f"restore failed: {exc}"


def reset_soft_brightness() -> None:
  env = os.environ.copy()
  env.setdefault("DISPLAY", ":0")
  env.setdefault("XAUTHORITY", "/home/moode/.Xauthority")
  try:
    output = subprocess.check_output(["xrandr", "--query"], env=env, stderr=subprocess.DEVNULL, text=True, timeout=2)
  except (OSError, subprocess.SubprocessError):
    return
  primary = ""
  for line in output.splitlines():
    if " connected primary" in line:
      primary = line.split()[0]
      break
  if not primary:
    return
  subprocess.run(["xrandr", "--output", primary, "--brightness", "1"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=2)


def try_brightness(args: argparse.Namespace) -> list[dict[str, object]]:
  percent = clamp_percent(args.percent)
  restore_percent = clamp_percent(args.restore_percent)
  device = select_device(args.hidraw)
  hidraw = str(device["hidraw"])
  results: list[dict[str, object]] = []
  selected = set(args.candidate or [])

  for name, payload in candidate_payloads(percent, include_persistent=args.include_persistent):
    if selected and name not in selected:
      continue
    if args.reset_soft_before:
      reset_soft_brightness()
      time.sleep(0.1)
    before = helper_json([args.helper, "status"]) if args.helper else None
    read_before = read_nonblocking(hidraw, args.read_seconds)
    written = write_output_report(hidraw, payload, report_id_prefix=args.report_id_prefix)
    time.sleep(args.settle_seconds)
    read_after = read_nonblocking(hidraw, args.read_seconds)
    after = helper_json([args.helper, "status"]) if args.helper else None
    restore_result = None
    if args.restore:
      restore_result = run_restore(args.helper, restore_percent)
      time.sleep(0.2)
    record = {
      "candidate": name,
      "hidraw": hidraw,
      "percent": percent,
      "writtenBytes": written,
      "reportIdPrefix": args.report_id_prefix,
      "payloadPrefixHex": payload[:32].hex(),
      "readBefore": read_before,
      "readAfter": read_after,
      "helperBefore": before,
      "helperAfter": after,
      "restore": restore_result,
      "serviceActive": service_active(args.service),
      "updatedAt": utc_timestamp()
    }
    append_log(Path(args.log), record)
    results.append(record)
  return results


def service_active(service: str) -> bool | None:
  if not service:
    return None
  proc = subprocess.run(["systemctl", "is-active", "--quiet", service])
  return proc.returncode == 0


def clamp_percent(value: int | str) -> int:
  try:
    parsed = int(value)
  except (TypeError, ValueError):
    raise ProbeError("brightness must be an integer") from None
  return max(1, min(100, parsed))


def parse_hex_payload(raw: str) -> bytes:
  compact = re.sub(r"[^0-9a-fA-F]", "", raw)
  if len(compact) % 2:
    raise ProbeError("hex payload has an odd number of digits")
  try:
    return binascii.unhexlify(compact)
  except binascii.Error as exc:
    raise ProbeError(str(exc)) from exc


def main() -> int:
  parser = argparse.ArgumentParser(description="Probe TURZX vendor HID reports")
  parser.add_argument("--hidraw", help="explicit hidraw path; safety checks still apply")
  parser.add_argument("--helper", default=DEFAULT_HELPER, help="brightness helper used for status/restore")
  parser.add_argument("--log", default=str(DEFAULT_LOG_PATH), help="JSONL log path")
  parser.add_argument("--service", default="display_turzx.service", help="service checked after probe writes")

  subparsers = parser.add_subparsers(dest="command")
  subparsers.add_parser("describe", help="read-only device descriptor and helper status")

  read_parser = subparsers.add_parser("read", help="read vendor HID input reports without writing")
  read_parser.add_argument("--seconds", type=float, default=2.0)

  write_parser = subparsers.add_parser("write-output", help="write one explicit 512-byte output payload")
  write_parser.add_argument("--hex", required=True, help="512-byte output payload as hex")
  write_parser.add_argument("--read-seconds", type=float, default=0.5)
  write_parser.add_argument("--no-report-id-prefix", dest="report_id_prefix", action="store_false",
                            help="write exactly 512 bytes for descriptors with no Report ID")
  write_parser.set_defaults(report_id_prefix=True)

  try_parser = subparsers.add_parser("try-brightness", help="try bounded brightness candidates")
  try_parser.add_argument("percent", type=int)
  try_parser.add_argument("--candidate", action="append", help="limit to one or more candidate names")
  try_parser.add_argument("--include-persistent", action="store_true", help="also try candidates that may persist device settings")
  try_parser.add_argument("--restore-percent", type=int, default=45)
  try_parser.add_argument("--no-restore", dest="restore", action="store_false")
  try_parser.add_argument("--settle-seconds", type=float, default=0.8)
  try_parser.add_argument("--read-seconds", type=float, default=0.4)
  try_parser.add_argument("--keep-soft-before", dest="reset_soft_before", action="store_false")
  try_parser.add_argument("--no-report-id-prefix", dest="report_id_prefix", action="store_false",
                          help="write exactly 512 bytes for descriptors with no Report ID")
  try_parser.set_defaults(restore=True)
  try_parser.set_defaults(reset_soft_before=True)
  try_parser.set_defaults(report_id_prefix=True)

  restore_parser = subparsers.add_parser("restore", help="restore Tikpal brightness helper and RandR brightness")
  restore_parser.add_argument("--percent", type=int, default=45)
  restore_parser.add_argument("--reset-soft", action="store_true", help="also reset RandR brightness to 1")

  args = parser.parse_args()
  command = args.command or "describe"

  try:
    if command == "describe":
      print(json.dumps(describe(args.helper), ensure_ascii=False, indent=2, sort_keys=True))
      return 0
    if command == "read":
      device = select_device(args.hidraw)
      chunks = read_nonblocking(str(device["hidraw"]), args.seconds)
      print(json.dumps({"hidraw": device["hidraw"], "chunks": chunks, "updatedAt": utc_timestamp()}, indent=2))
      return 0
    if command == "write-output":
      device = select_device(args.hidraw)
      payload = parse_hex_payload(args.hex)
      written = write_output_report(str(device["hidraw"]), payload, report_id_prefix=args.report_id_prefix)
      read_after = read_nonblocking(str(device["hidraw"]), args.read_seconds)
      print(json.dumps({
        "hidraw": device["hidraw"],
        "writtenBytes": written,
        "reportIdPrefix": args.report_id_prefix,
        "readAfter": read_after,
      }, indent=2))
      return 0
    if command == "try-brightness":
      print(json.dumps(try_brightness(args), ensure_ascii=False, indent=2, sort_keys=True))
      return 0
    if command == "restore":
      result = run_restore(args.helper, clamp_percent(args.percent))
      if args.reset_soft:
        reset_soft_brightness()
      print(json.dumps({"restore": result, "updatedAt": utc_timestamp()}, ensure_ascii=False, indent=2))
      return 0
  except ProbeError as exc:
    print(f"ERROR: {exc}", file=sys.stderr)
    return 2
  except KeyboardInterrupt:
    print("interrupted", file=sys.stderr)
    return 130

  parser.print_help()
  return 2


if __name__ == "__main__":
  raise SystemExit(main())
