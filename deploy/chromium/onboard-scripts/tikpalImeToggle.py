#!/usr/bin/env python3
"""Toggle Tikpal kiosk input method from an Onboard script key."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys


ONBOARD_DATA_DIR = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")) / "onboard"
INACTIVE_LAYOUT = ONBOARD_DATA_DIR / "layouts" / "Tikpal-Compact.onboard"
ACTIVE_LAYOUT = ONBOARD_DATA_DIR / "layouts" / "Tikpal-Compact-Pinyin.onboard"
COLOR_SCHEME = ONBOARD_DATA_DIR / "themes" / "Tikpal-Classic.colors"


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


def _run_command(*args: str) -> bool:
    try:
        return subprocess.run(
            list(args),
            check=False,
            env=_env(),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=1.5,
        ).returncode == 0
    except Exception:
        return False


def _read_command(*args: str) -> str:
    try:
        result = subprocess.run(
            list(args),
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


def _onboard_visual_active() -> bool:
    layout = _read_command("gsettings", "get", "org.onboard", "layout").strip("'")
    return layout == str(ACTIVE_LAYOUT)


def _pinyin_active() -> bool:
    current = _remote("-n")
    active = _remote()
    if current:
        return current == "pinyin" and active == "2"
    return _onboard_visual_active()


def _set_onboard_visual(active: bool) -> None:
    layout = ACTIVE_LAYOUT if active else INACTIVE_LAYOUT
    if COLOR_SCHEME.exists():
        _run_command("gsettings", "set", "org.onboard.theme-settings", "color-scheme", str(COLOR_SCHEME))
    if layout.exists():
        _run_command("gsettings", "set", "org.onboard", "layout", str(layout))


def sync() -> None:
    _set_onboard_visual(_pinyin_active())


def run() -> None:
    if _pinyin_active():
        _remote("-s", "keyboard-us")
        _remote("-c")
        _set_onboard_visual(False)
        return
    _remote("-s", "pinyin")
    _remote("-o")
    _set_onboard_visual(True)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--sync":
        sync()
    else:
        run()
