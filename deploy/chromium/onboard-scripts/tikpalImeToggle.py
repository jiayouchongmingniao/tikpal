#!/usr/bin/env python3
"""Cycle Tikpal kiosk input methods from an Onboard script key."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys


ONBOARD_DATA_DIR = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")) / "onboard"
LAYOUT_DIR = ONBOARD_DATA_DIR / "layouts"
COLOR_SCHEME = ONBOARD_DATA_DIR / "themes" / "Tikpal-Classic.colors"
MODES = [
    {"id": "keyboard-us", "layout": LAYOUT_DIR / "Tikpal-Compact-EN.onboard", "active": False},
    {"id": "pinyin", "layout": LAYOUT_DIR / "Tikpal-Compact-Pinyin.onboard", "active": True},
    {"id": "anthy", "layout": LAYOUT_DIR / "Tikpal-Compact-Japanese.onboard", "active": True},
    {"id": "keyboard-es", "layout": LAYOUT_DIR / "Tikpal-Compact-Spanish.onboard", "active": True},
]
MODE_BY_ID = {mode["id"]: mode for mode in MODES}
LEGACY_LAYOUTS = {
    LAYOUT_DIR / "Tikpal-Compact.onboard": MODES[0],
}


def _env() -> dict[str, str]:
    env = os.environ.copy()
    env.setdefault("DISPLAY", ":0")
    env.setdefault("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
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


def _onboard_layout() -> Path:
    layout = _read_command("gsettings", "get", "org.onboard", "layout").strip("'")
    return Path(layout)


def _mode_from_onboard_visual() -> dict[str, object]:
    layout = _onboard_layout()
    for mode in MODES:
        if layout == mode["layout"]:
            return mode
    return LEGACY_LAYOUTS.get(layout, MODES[0])


def _current_mode() -> dict[str, object]:
    current = _remote("-n")
    if current in MODE_BY_ID:
        return MODE_BY_ID[current]
    return _mode_from_onboard_visual()


def _set_onboard_visual(mode: dict[str, object]) -> None:
    layout = mode["layout"]
    if COLOR_SCHEME.exists():
        _run_command("gsettings", "set", "org.onboard.theme-settings", "color-scheme", str(COLOR_SCHEME))
    if isinstance(layout, Path) and layout.exists():
        _run_command("gsettings", "set", "org.onboard", "layout", str(layout))


def sync() -> None:
    _set_onboard_visual(_current_mode())


def run() -> None:
    current = _current_mode()
    index = MODES.index(current) if current in MODES else 0
    next_mode = MODES[(index + 1) % len(MODES)]
    if next_mode["active"]:
        _remote("-o")
    _remote("-s", str(next_mode["id"]))
    _remote("-o" if next_mode["active"] else "-c")
    _set_onboard_visual(next_mode)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--sync":
        sync()
    else:
        run()
