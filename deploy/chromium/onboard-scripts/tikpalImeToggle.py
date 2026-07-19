#!/usr/bin/env python3
"""Toggle Tikpal kiosk input method from an Onboard script key."""

from __future__ import annotations

import os
import subprocess


def _env() -> dict[str, str]:
    env = os.environ.copy()
    env.setdefault("DISPLAY", ":0")
    env.setdefault("DBUS_SESSION_BUS_ADDRESS", f"unix:path=/run/user/{os.getuid()}/bus")
    return env


def _remote(*args: str) -> str:
    try:
        result = subprocess.run(
            ["fcitx5-remote", *args],
            check=False,
            env=_env(),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=1.5,
        )
    except Exception:
        return ""
    return result.stdout.strip()


def run() -> None:
    current = _remote("-n")
    active = _remote()
    if current == "pinyin" and active == "2":
        _remote("-s", "keyboard-us")
        _remote("-c")
        return
    _remote("-s", "pinyin")
    _remote("-o")
