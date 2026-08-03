#!/usr/bin/env python3
"""Cycle Tikpal kiosk input methods from an Onboard script key."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
from datetime import datetime, timezone


ONBOARD_DATA_DIR = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")) / "onboard"
LAYOUT_DIR = ONBOARD_DATA_DIR / "layouts"
COLOR_SCHEME = ONBOARD_DATA_DIR / "themes" / "Tikpal-Classic.colors"
FCITX_CLASSIC_UI_CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "fcitx5/conf/classicui.conf"
FCITX_PROFILE_CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "fcitx5/profile"
IME_STATE_FALLBACK_PATH = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "tikpal/onboard-ime-state.json"
DEFAULT_MODE_ID = "keyboard-us"
MODES = [
    {"id": "keyboard-us", "layout": LAYOUT_DIR / "Tikpal-Compact-EN.onboard", "active": False},
    {"id": "pinyin", "layout": LAYOUT_DIR / "Tikpal-Compact-Pinyin.onboard", "active": True},
    {"id": "keyboard-de", "layout": LAYOUT_DIR / "Tikpal-Compact-German.onboard", "active": True},
    {"id": "keyboard-it", "layout": LAYOUT_DIR / "Tikpal-Compact-Italian.onboard", "active": True},
    {"id": "hangul", "layout": LAYOUT_DIR / "Tikpal-Compact-Korean.onboard", "active": True},
    {"id": "anthy", "layout": LAYOUT_DIR / "Tikpal-Compact-Japanese.onboard", "active": True},
    {"id": "keyboard-es", "layout": LAYOUT_DIR / "Tikpal-Compact-Spanish.onboard", "active": True},
]
MODE_BY_ID = {mode["id"]: mode for mode in MODES}
LOCALE_TO_MODE_ID = {
    "en": "keyboard-us",
    "zh-cn": "pinyin",
    "zh-CN": "pinyin",
    "de": "keyboard-de",
    "it": "keyboard-it",
    "ko": "hangul",
    "ja": "anthy",
    "es": "keyboard-es",
}
LEGACY_LAYOUTS = {
    LAYOUT_DIR / "Tikpal-Compact.onboard": MODES[0],
}
CANDIDATE_FONT_BY_MODE = {
    "pinyin": "Noto Sans CJK SC",
    "anthy": "Noto Sans CJK JP",
    "hangul": "Noto Sans CJK KR",
}
FONT_THEME_FAMILIES = {
    "system": ["Inter", "Noto Sans CJK SC", "Source Han Sans CN", "WenQuanYi Zen Hei"],
    "hardware": ["Noto Sans CJK SC", "Source Han Sans CN", "WenQuanYi Zen Hei", "Inter"],
    "precision": ["Source Han Sans CN", "Noto Sans CJK SC", "WenQuanYi Zen Hei", "Inter"],
    "sans": ["Inter", "Roboto", "Fira Sans", "Noto Sans CJK SC", "Source Han Sans CN"],
    "serif": ["Noto Serif CJK SC", "Noto Serif CJK JP", "Noto Serif CJK KR", "Georgia"],
    "mono": ["Noto Sans Mono CJK SC", "Noto Sans Mono CJK JP", "Noto Sans Mono CJK KR", "Source Han Mono SC"],
}
FONT_THEME_SIZES = {
    "mono": 11,
}


def _env() -> dict[str, str]:
    env = os.environ.copy()
    env.setdefault("DISPLAY", ":0")
    env.setdefault("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
    env.setdefault("DBUS_SESSION_BUS_ADDRESS", f"unix:path=/run/user/{os.getuid()}/bus")
    return env


def _refuse_root_session() -> None:
    if os.geteuid() == 0 and os.environ.get("TIKPAL_ALLOW_ROOT_IME_SYNC") != "1":
        raise SystemExit("Refusing to sync kiosk input as root; run as the kiosk user.")


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


def _preference_paths() -> list[Path]:
    paths: list[Path] = []
    explicit = os.environ.get("TIKPAL_UI_PREFERENCES_STATE_PATH")
    if explicit:
        paths.append(Path(explicit).expanduser())
    app_dir = os.environ.get("TIKPAL_APP_DIR")
    if app_dir:
        paths.append(Path(app_dir).expanduser() / ".tikpal" / "ui-preferences.json")
    paths.extend([
        Path.cwd() / ".tikpal" / "ui-preferences.json",
        Path.home() / "code" / "tikpal" / ".tikpal" / "ui-preferences.json",
    ])
    unique: list[Path] = []
    for path in paths:
        if path not in unique:
            unique.append(path)
    return unique


def _read_font_theme() -> str:
    explicit = os.environ.get("TIKPAL_FONT_THEME")
    if explicit in FONT_THEME_FAMILIES:
        return str(explicit)
    for path in _preference_paths():
        try:
            value = json.loads(path.read_text(encoding="utf-8")).get("fontTheme")
        except Exception:
            continue
        if value in FONT_THEME_FAMILIES:
            return str(value)
    return "system"


def _state_paths() -> list[Path]:
    paths: list[Path] = []
    explicit = os.environ.get("TIKPAL_ONBOARD_IME_STATE_PATH")
    if explicit:
        paths.append(Path(explicit).expanduser())
    app_dir = os.environ.get("TIKPAL_APP_DIR")
    if app_dir:
        paths.append(Path(app_dir).expanduser() / ".tikpal" / "onboard-ime-state.json")
    for preferences_path in _preference_paths():
        paths.append(preferences_path.with_name("onboard-ime-state.json"))
    paths.append(IME_STATE_FALLBACK_PATH)
    unique: list[Path] = []
    for path in paths:
        if path not in unique:
            unique.append(path)
    return unique


def _read_state_payload() -> dict[str, object]:
    for path in _state_paths():
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if isinstance(value, dict):
            return value
    return {}


def _preferred_locale_mode_id() -> str:
    for path in _preference_paths():
        try:
            locale = json.loads(path.read_text(encoding="utf-8")).get("locale")
        except Exception:
            continue
        if not isinstance(locale, str):
            continue
        mode_id = LOCALE_TO_MODE_ID.get(locale) or LOCALE_TO_MODE_ID.get(locale.lower())
        if mode_id in MODE_BY_ID:
            return str(mode_id)
    return DEFAULT_MODE_ID


def _read_cycle_mode_id() -> str:
    value = _read_state_payload().get("modeId")
    if value in MODE_BY_ID:
        return str(value)
    return str(_current_mode()["id"])


def _read_target_mode_id() -> str:
    payload = _read_state_payload()
    value = payload.get("targetModeId")
    if value in MODE_BY_ID:
        return str(value)
    return _preferred_locale_mode_id()


def _write_cycle_mode_id(mode_id: str, target_mode_id: str | None = None) -> None:
    target = target_mode_id if target_mode_id in MODE_BY_ID else _read_target_mode_id()
    payload = {
        "modeId": mode_id,
        "targetModeId": target,
        "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    for path in _state_paths():
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        except Exception:
            continue


def _font_available(family: str, marker: str) -> bool:
    output = _read_command("fc-match", family)
    return marker.lower() in output.lower()


def _font_family_available(family: str) -> bool:
    output = _read_command("fc-match", "-f", "%{family}\n", family)
    return family.lower() in output.lower()


def _candidate_font(mode_id: str) -> str:
    preferred_family = CANDIDATE_FONT_BY_MODE.get(mode_id, "Noto Sans CJK SC")
    if _font_available(preferred_family, "Noto Sans CJK"):
        return f"{preferred_family} 16"
    if _font_available("Source Han Sans CN", "Source Han"):
        return "Source Han Sans CN 16"
    return "WenQuanYi Zen Hei 16"


def _onboard_key_label_font() -> str:
    theme = _read_font_theme()
    for family in FONT_THEME_FAMILIES.get(theme, FONT_THEME_FAMILIES["system"]):
        if _font_family_available(family):
            return f"{family} {FONT_THEME_SIZES.get(theme, 12)}"
    return "Noto Sans CJK SC 12"


def _set_onboard_key_label_font() -> None:
    _run_command("gsettings", "set", "org.onboard.theme-settings", "key-label-font", _onboard_key_label_font())


def _show_onboard() -> None:
    _run_command(
        "gdbus",
        "call",
        "--session",
        "--dest",
        "org.onboard.Onboard",
        "--object-path",
        "/org/onboard/Onboard/Keyboard",
        "--method",
        "org.onboard.Onboard.Keyboard.Show",
    )


def _set_candidate_font(mode: dict[str, object]) -> None:
    font = _candidate_font(str(mode["id"]))
    try:
        FCITX_CLASSIC_UI_CONFIG.parent.mkdir(parents=True, exist_ok=True)
        FCITX_CLASSIC_UI_CONFIG.write_text(
            "\n".join([
                "Vertical Candidate List=False",
                f'Font="{font}"',
                f'MenuFont="{font}"',
                f'TrayFont="{font}"',
                ""
            ]),
            encoding="utf-8"
        )
    except Exception:
        pass


def _sync_fcitx_default_im(mode: dict[str, object]) -> None:
    mode_id = str(mode["id"])
    try:
        FCITX_PROFILE_CONFIG.parent.mkdir(parents=True, exist_ok=True)
        current = FCITX_PROFILE_CONFIG.read_text(encoding="utf-8") if FCITX_PROFILE_CONFIG.exists() else ""
        if current:
            lines = current.splitlines()
            replaced = False
            for index, line in enumerate(lines):
                if line.startswith("DefaultIM="):
                    lines[index] = f"DefaultIM={mode_id}"
                    replaced = True
                    break
            if replaced:
                FCITX_PROFILE_CONFIG.write_text("\n".join(lines) + "\n", encoding="utf-8")
                return
        FCITX_PROFILE_CONFIG.write_text(
            "\n".join([
                "[Groups/0]",
                "Name=Default",
                "Default Layout=us",
                f"DefaultIM={mode_id}",
                "",
                "[Groups/0/Items/0]",
                "Name=keyboard-us",
                "Layout=",
                "",
                "[Groups/0/Items/1]",
                "Name=pinyin",
                "Layout=",
                "",
                "[Groups/0/Items/2]",
                "Name=keyboard-de",
                "Layout=",
                "",
                "[Groups/0/Items/3]",
                "Name=keyboard-it",
                "Layout=",
                "",
                "[Groups/0/Items/4]",
                "Name=hangul",
                "Layout=",
                "",
                "[Groups/0/Items/5]",
                "Name=anthy",
                "Layout=",
                "",
                "[Groups/0/Items/6]",
                "Name=keyboard-es",
                "Layout=",
                "",
                "[GroupOrder]",
                "0=Default",
                ""
            ]),
            encoding="utf-8"
        )
    except Exception:
        pass


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
    _set_onboard_key_label_font()
    if isinstance(layout, Path) and layout.exists():
        _run_command("gsettings", "set", "org.onboard", "layout", str(layout))


def sync() -> None:
    mode = _current_mode()
    _write_cycle_mode_id(str(mode["id"]))
    _set_candidate_font(mode)
    _set_onboard_visual(mode)


def _set_mode(mode: dict[str, object], *, keep_visible: bool = False, target_mode_id: str | None = None) -> None:
    _sync_fcitx_default_im(mode)
    _remote("-s", str(mode["id"]))
    _remote("-o" if mode["active"] else "-c")
    _set_candidate_font(mode)
    _set_onboard_visual(mode)
    _write_cycle_mode_id(str(mode["id"]), target_mode_id)
    if keep_visible:
        _show_onboard()


def run() -> None:
    current_id = str(_current_mode()["id"])
    target_mode_id = _read_target_mode_id()
    next_mode_id = target_mode_id if current_id == DEFAULT_MODE_ID and target_mode_id != DEFAULT_MODE_ID else DEFAULT_MODE_ID
    _set_mode(MODE_BY_ID[next_mode_id], keep_visible=True, target_mode_id=target_mode_id)


def set_mode(mode_id: str) -> None:
    mode = MODE_BY_ID.get(mode_id)
    if mode is None:
        raise SystemExit(f"Unsupported input mode: {mode_id}")
    target_mode_id = mode_id if mode_id != DEFAULT_MODE_ID else _read_target_mode_id()
    _set_mode(mode, target_mode_id=target_mode_id)


def set_locale(locale: str) -> None:
    mode_id = LOCALE_TO_MODE_ID.get(locale) or LOCALE_TO_MODE_ID.get(locale.lower())
    if not mode_id:
        raise SystemExit(f"Unsupported locale: {locale}")
    _set_mode(MODE_BY_ID[DEFAULT_MODE_ID], target_mode_id=mode_id)


if __name__ == "__main__":
    _refuse_root_session()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sync", action="store_true", help="Sync the Onboard layout to the current Fcitx input method.")
    parser.add_argument("--set-mode", choices=sorted(MODE_BY_ID), help="Switch to a specific Fcitx input method and matching Onboard layout.")
    parser.add_argument("--set-locale", help="Switch to the input method mapped from a Tikpal UI locale.")
    args = parser.parse_args()

    if args.sync:
        sync()
    elif args.set_mode:
        set_mode(args.set_mode)
    elif args.set_locale:
        set_locale(args.set_locale)
    else:
        run()
