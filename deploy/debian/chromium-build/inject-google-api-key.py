#!/usr/bin/env python3
"""Append a private Google API key to a GN args file without logging it."""
import os
from pathlib import Path
import re
import stat
import sys


required_key = "GOOGLE_API_KEY"


def read_key(path: Path) -> str:
    mode = stat.S_IMODE(path.stat().st_mode)
    if mode & 0o077:
        raise SystemExit("Google API key file must not be group- or world-readable")
    values: dict[str, str] = {}
    for number, line in enumerate(path.read_text().splitlines(), start=1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        name, separator, value = line.partition("=")
        if not separator or name != required_key or not value:
            raise SystemExit(f"Invalid Google API key file line {number}")
        if name in values:
            raise SystemExit("Google API key file defines GOOGLE_API_KEY more than once")
        values[name] = value
    key = values.get(required_key)
    if not key:
        raise SystemExit("Google API key file does not define GOOGLE_API_KEY")
    return key


def main() -> None:
    args_file = Path(sys.argv[1]).resolve()
    key_file = Path(os.environ["TIKPAL_GOOGLE_API_KEYS_FILE"]).resolve()
    key = read_key(key_file)
    source = args_file.read_text()
    if re.search(r"^\s*google_api_key\s*=", source, flags=re.MULTILINE):
        raise SystemExit("args.gn already defines google_api_key")
    args_file.write_text(source.rstrip() + f'\ngoogle_api_key = "{key}"\n')


if __name__ == "__main__":
    main()
