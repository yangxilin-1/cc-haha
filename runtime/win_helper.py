#!/usr/bin/env python3
"""Windows Computer Use helper — same JSON protocol as mac_helper.py.

Uses win32gui / win32api / win32process / psutil / pyperclip / screeninfo
to replicate macOS-specific Quartz/AppKit functionality on Windows.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import time
from io import BytesIO
from pathlib import Path
from typing import Any

import mss
from PIL import Image

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")
os.environ.setdefault("PYAUTOGUI_HIDE_SUPPORT_PROMPT", "1")

import pyautogui  # noqa: E402

# The desktop app decodes helper stdout as UTF-8. On Windows, redirected Python
# stdout defaults to the active ANSI code page (for example GBK), which mangles
# localized app names from the registry. Force UTF-8 at process start so JSON
# responses stay stable regardless of the user's system locale.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="strict")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0

# ---------------------------------------------------------------------------
# Key mapping — Windows uses 'win' instead of 'command'
# ---------------------------------------------------------------------------
KEY_MAP = {
    "a": "a", "b": "b", "c": "c", "d": "d", "e": "e",
    "f": "f", "g": "g", "h": "h", "i": "i", "j": "j",
    "k": "k", "l": "l", "m": "m", "n": "n", "o": "o",
    "p": "p", "q": "q", "r": "r", "s": "s", "t": "t",
    "u": "u", "v": "v", "w": "w", "x": "x", "y": "y",
    "z": "z",
    "0": "0", "1": "1", "2": "2", "3": "3", "4": "4",
    "5": "5", "6": "6", "7": "7", "8": "8", "9": "9",
    # Modifier keys — map macOS names to Windows equivalents
    "cmd": "win",
    "command": "win",
    "meta": "win",
    "super": "win",
    "ctrl": "ctrl",
    "control": "ctrl",
    "shift": "shift",
    "alt": "alt",
    "option": "alt",
    "opt": "alt",
    "fn": "fn",
    # Navigation / editing
    "escape": "esc",
    "esc": "esc",
    "enter": "enter",
    "return": "enter",
    "tab": "tab",
    "space": "space",
    "backspace": "backspace",
    "delete": "delete",
    "forwarddelete": "delete",
    "up": "up",
    "down": "down",
    "left": "left",
    "right": "right",
    "home": "home",
    "end": "end",
    "pageup": "pageup",
    "pagedown": "pagedown",
    "capslock": "capslock",
    # Function keys
    "f1": "f1", "f2": "f2", "f3": "f3", "f4": "f4",
    "f5": "f5", "f6": "f6", "f7": "f7", "f8": "f8",
    "f9": "f9", "f10": "f10", "f11": "f11", "f12": "f12",
    # Symbols
    "-": "-", "=": "=", "[": "[", "]": "]", "\\": "\\",
    ";": ";", "'": "'", ",": ",", ".": ".", "/": "/", "`": "`",
}


def normalize_key(name: str) -> str:
    key = name.strip().lower()
    if key not in KEY_MAP:
        raise ValueError(f"Unsupported key: {name}")
    return KEY_MAP[key]


# ---------------------------------------------------------------------------
# JSON output helpers
# ---------------------------------------------------------------------------

def json_output(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def error_output(message: str, code: str = "runtime_error") -> None:
    json_output({"ok": False, "error": {"code": code, "message": message}})


def bool_env(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value not in {"0", "false", "False", ""}


# ---------------------------------------------------------------------------
# Display / Monitor helpers (via screeninfo + ctypes)
# ---------------------------------------------------------------------------

def get_displays() -> list[dict[str, Any]]:
    """Enumerate monitors via screeninfo, with DPI scale from ctypes."""
    from screeninfo import get_monitors

    displays: list[dict[str, Any]] = []
    for idx, m in enumerate(get_monitors()):
        scale_factor = _get_monitor_scale(m)
        name = m.name or f"Display {idx + 1}"
        displays.append({
            "id": idx,
            "displayId": idx,
            "width": m.width,
            "height": m.height,
            "scaleFactor": scale_factor,
            "originX": m.x,
            "originY": m.y,
            "isPrimary": m.is_primary if hasattr(m, "is_primary") else (idx == 0),
            "name": name,
            "label": name,
        })
    return displays


def _get_monitor_scale(monitor: Any) -> float:
    """Get the DPI scale factor for a monitor. Returns 1.0 on failure."""
    try:
        import ctypes
        # SetProcessDPIAware so we get real pixel values
        ctypes.windll.user32.SetProcessDPIAware()
        # Get DPI for the primary — simplified; per-monitor DPI is complex
        hdc = ctypes.windll.user32.GetDC(0)
        dpi = ctypes.windll.gdi32.GetDeviceCaps(hdc, 88)  # LOGPIXELSX
        ctypes.windll.user32.ReleaseDC(0, hdc)
        return dpi / 96.0
    except Exception:
        return 1.0


def choose_display(display_id: int | None) -> dict[str, Any]:
    displays = get_displays()
    if not displays:
        raise RuntimeError("No active displays found")
    if display_id is None:
        for display in displays:
            if display["isPrimary"]:
                return display
        return displays[0]
    for display in displays:
        if display["displayId"] == display_id or display["id"] == display_id:
            return display
    raise RuntimeError(f"Unknown display: {display_id}")


# ---------------------------------------------------------------------------
# Screen capture (mss — cross-platform, identical to mac_helper)
# ---------------------------------------------------------------------------

def capture_display(display_id: int | None, resize: tuple[int, int] | None = None) -> dict[str, Any]:
    display = choose_display(display_id)
    monitor = {
        "left": display["originX"],
        "top": display["originY"],
        "width": display["width"],
        "height": display["height"],
    }
    with mss.mss() as sct:
        raw = sct.grab(monitor)
        image = Image.frombytes("RGB", raw.size, raw.rgb)
    if resize:
        image = image.resize(resize, Image.Resampling.LANCZOS)
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=75, optimize=True)
    base64_data = base64.b64encode(buffer.getvalue()).decode("ascii")
    return {
        "base64": base64_data,
        "width": image.width,
        "height": image.height,
        "displayWidth": display["width"],
        "displayHeight": display["height"],
        "displayId": display["displayId"],
        "originX": display["originX"],
        "originY": display["originY"],
        "display": display,
    }


def capture_region(region: dict[str, int], resize: tuple[int, int] | None = None) -> dict[str, Any]:
    with mss.mss() as sct:
        raw = sct.grab(region)
        image = Image.frombytes("RGB", raw.size, raw.rgb)
    if resize:
        image = image.resize(resize, Image.Resampling.LANCZOS)
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=75, optimize=True)
    base64_data = base64.b64encode(buffer.getvalue()).decode("ascii")
    return {"base64": base64_data, "width": image.width, "height": image.height}


# ---------------------------------------------------------------------------
# Window management (win32gui)
# ---------------------------------------------------------------------------

def list_windows() -> list[dict[str, Any]]:
    """List visible on-screen windows with their bounds."""
    import win32gui

    results: list[dict[str, Any]] = []

    def _enum_cb(hwnd: int, _: Any) -> None:
        if not win32gui.IsWindowVisible(hwnd):
            return
        title = win32gui.GetWindowText(hwnd)
        try:
            left, top, right, bottom = win32gui.GetWindowRect(hwnd)
        except Exception:
            return
        width = right - left
        height = bottom - top
        if width <= 1 or height <= 1:
            return
        # Get the process name as owner
        owner = _get_window_process_name(hwnd)
        bundle_id = _get_window_process_stem(hwnd)
        results.append({
            "id": str(hwnd),
            "hwnd": hwnd,
            "bundleId": bundle_id,
            "displayName": owner,
            "ownerName": owner,
            "title": title,
            "bounds": {"x": left, "y": top, "width": width, "height": height},
            "isFrontmost": hwnd == (_window_handle_for_frontmost() or 0),
        })

    win32gui.EnumWindows(_enum_cb, None)
    return results


def _get_window_process_name(hwnd: int) -> str:
    """Get the exe name of the process owning a window handle."""
    try:
        import win32process
        import psutil
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        proc = psutil.Process(pid)
        return proc.name()
    except Exception:
        return ""


def _get_window_process_stem(hwnd: int) -> str:
    name = _get_window_process_name(hwnd)
    return Path(name).stem if name else ""


def _window_matches_bundle_id(hwnd: int, bundle_ids: list[str]) -> bool:
    if not bundle_ids:
        return False
    if "*" in {str(bundle_id).strip() for bundle_id in bundle_ids if bundle_id}:
        return not _window_is_host_app(hwnd)
    owner_stem = _normalize_app_lookup(_get_window_process_stem(hwnd))
    owner_name = _normalize_app_lookup(_get_window_process_name(hwnd))
    if not owner_stem and not owner_name:
        return False
    allowed = {_normalize_app_lookup(bundle_id) for bundle_id in bundle_ids if bundle_id}
    allowed = {item for item in allowed if item}
    return owner_stem in allowed or owner_name in allowed


WINDOWS_HOST_APP_KEYS = {"ycode", "ycodedesktop", "claudecodedesktop"}


def _window_is_host_app(hwnd: int) -> bool:
    owner_stem = _normalize_app_lookup(_get_window_process_stem(hwnd))
    owner_name = _normalize_app_lookup(_get_window_process_name(hwnd))
    return owner_stem in WINDOWS_HOST_APP_KEYS or owner_name in WINDOWS_HOST_APP_KEYS


def _matching_app_windows(bundle_ids: list[str]) -> list[int]:
    import win32gui

    matches: list[int] = []

    def _enum_cb(hwnd: int, _: Any) -> None:
        if not win32gui.IsWindowVisible(hwnd):
            return
        try:
            left, top, right, bottom = win32gui.GetWindowRect(hwnd)
        except Exception:
            return
        if right - left <= 1 or bottom - top <= 1:
            return
        if _window_matches_bundle_id(hwnd, bundle_ids):
            matches.append(hwnd)

    win32gui.EnumWindows(_enum_cb, None)
    return matches


def _activate_window(hwnd: int) -> bool:
    try:
        import win32api
        import win32con
        import win32gui
        import win32process

        if win32gui.IsIconic(hwnd):
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        else:
            win32gui.ShowWindow(hwnd, win32con.SW_SHOW)

        foreground = win32gui.GetForegroundWindow()
        current_thread = win32api.GetCurrentThreadId()
        target_thread, _ = win32process.GetWindowThreadProcessId(hwnd)
        foreground_thread = 0
        if foreground:
            foreground_thread, _ = win32process.GetWindowThreadProcessId(foreground)

        attached: list[int] = []
        for thread_id in {target_thread, foreground_thread}:
            if thread_id and thread_id != current_thread:
                try:
                    win32process.AttachThreadInput(current_thread, thread_id, True)
                    attached.append(thread_id)
                except Exception:
                    pass
        try:
            win32gui.BringWindowToTop(hwnd)
            try:
                win32gui.SetActiveWindow(hwnd)
            except Exception:
                pass
            try:
                # Windows can reject SetForegroundWindow unless the caller has
                # recent input. Tapping Alt is the standard benign workaround.
                win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
                win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
            except Exception:
                pass
            win32gui.SetForegroundWindow(hwnd)
        finally:
            for thread_id in attached:
                try:
                    win32process.AttachThreadInput(current_thread, thread_id, False)
                except Exception:
                    pass

        time.sleep(0.12)
        active = win32gui.GetForegroundWindow()
        if active == hwnd:
            return True
        return _normalize_app_lookup(_get_window_process_stem(active)) == _normalize_app_lookup(_get_window_process_stem(hwnd))
    except Exception:
        return False


def _activate_app(bundle_id: str, timeout_s: float = 0.0) -> bool:
    deadline = time.time() + max(timeout_s, 0.0)
    bundle_ids = _app_bundle_aliases(bundle_id)
    while True:
        for hwnd in _matching_app_windows(bundle_ids):
            if _activate_window(hwnd):
                return True
        if time.time() >= deadline:
            return False
        time.sleep(0.15)


def _app_bundle_aliases(app_bundle_id: str) -> list[str]:
    aliases = [str(app_bundle_id or "").strip()]
    app_key = _normalize_app_lookup(app_bundle_id)
    if app_key in {"qqmusic", "qq音乐"}:
        aliases.extend(["QQMusic", "QQMusic.exe", "QQ音乐"])
    if app_key in {"cloudmusic", "neteasemusic", "网易云音乐"}:
        aliases.extend(["cloudmusic", "cloudmusic.exe", "网易云音乐"])

    seen: set[str] = set()
    out: list[str] = []
    for alias in aliases:
        key = _normalize_app_lookup(alias)
        if not alias or key in seen:
            continue
        seen.add(key)
        out.append(alias)
    return out


def _primary_window_for_app(app_bundle_id: str) -> int | None:
    matches = _matching_app_windows(_app_bundle_aliases(app_bundle_id))
    if not matches:
        return None

    frontmost = _window_handle_for_frontmost() or 0
    if frontmost in matches:
        return frontmost

    def _area(hwnd: int) -> int:
        rect = _window_rect(hwnd)
        return int(rect.get("width", 0)) * int(rect.get("height", 0)) if rect else 0

    matches.sort(key=_area, reverse=True)
    return matches[0]


def _window_rect(hwnd: int) -> dict[str, int]:
    try:
        import win32gui
        left, top, right, bottom = win32gui.GetWindowRect(hwnd)
        width = max(0, right - left)
        height = max(0, bottom - top)
        if width <= 1 or height <= 1:
            return {}
        return {"x": int(left), "y": int(top), "width": int(width), "height": int(height)}
    except Exception:
        return {}


def _window_ratio_point(hwnd: int, rx: float, ry: float) -> tuple[int, int] | None:
    rect = _window_rect(hwnd)
    if not rect:
        return None
    width = int(rect["width"])
    height = int(rect["height"])
    margin_x = min(12, max(0, width // 8))
    margin_y = min(12, max(0, height // 8))
    x = int(rect["x"] + width * rx)
    y = int(rect["y"] + height * ry)
    x = max(int(rect["x"]) + margin_x, min(int(rect["x"]) + width - margin_x, x))
    y = max(int(rect["y"]) + margin_y, min(int(rect["y"]) + height - margin_y, y))
    return x, y


def _click_window_ratio(hwnd: int, rx: float, ry: float, clicks: int = 1) -> bool:
    point = _window_ratio_point(hwnd, rx, ry)
    if point is None:
        return False
    try:
        _activate_window(hwnd)
    except Exception:
        pass
    pyautogui.click(
        x=point[0],
        y=point[1],
        button="left",
        clicks=max(1, clicks),
        interval=0.08,
    )
    return True


def _activate_first_non_host_window(timeout_s: float = 0.2) -> bool:
    try:
        import win32gui
    except Exception:
        return False

    matches: list[int] = []

    def _enum_cb(hwnd: int, _extra: Any) -> None:
        if not win32gui.IsWindowVisible(hwnd):
            return
        if _window_is_host_app(hwnd):
            return
        try:
            left, top, right, bottom = win32gui.GetWindowRect(hwnd)
        except Exception:
            return
        if right - left <= 1 or bottom - top <= 1:
            return
        try:
            title = str(win32gui.GetWindowText(hwnd) or "").strip()
        except Exception:
            title = ""
        if not title:
            return
        matches.append(hwnd)

    try:
        win32gui.EnumWindows(_enum_cb, None)
    except Exception:
        return False

    for hwnd in matches:
        if _activate_window(hwnd):
            time.sleep(min(timeout_s, 0.2))
            return True
    return False


def prepare_for_action(allowlist_bundle_ids: list[str]) -> list[str]:
    """Best-effort focus transfer before keyboard/mouse actions on Windows.

    macOS can hide/defocus the host app at the compositor level. On Windows we
    instead bring an already-authorized target app to the foreground. This keeps
    key/type actions from landing in Ycode's own chat input after a tool call.
    """
    frontmost = frontmost_app()
    frontmost_hwnd = _window_handle_for_frontmost() or 0
    if frontmost and _window_matches_bundle_id(
        frontmost_hwnd,
        allowlist_bundle_ids,
    ):
        return []

    if "*" in {str(bundle_id).strip() for bundle_id in allowlist_bundle_ids if bundle_id}:
        _activate_first_non_host_window(timeout_s=0.2)
        return []

    for bundle_id in allowlist_bundle_ids:
        if _activate_app(str(bundle_id), timeout_s=0.2):
            break
    return []


def _window_handle_for_frontmost() -> int | None:
    try:
        import win32gui
        hwnd = win32gui.GetForegroundWindow()
        return hwnd or None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Application management
# ---------------------------------------------------------------------------

def _get_exe_path_for_pid(pid: int) -> str | None:
    try:
        import psutil
        return psutil.Process(pid).exe()
    except Exception:
        return None


def _normalize_app_lookup(value: str) -> str:
    return "".join(ch.lower() for ch in str(value or "") if ch.isalnum())


def _looks_localized(value: str) -> bool:
    return any(ord(ch) > 127 for ch in value)


def _extract_launch_path(value: Any) -> str:
    """Extract a usable path from registry values such as '"C:\\App\\a.exe",0'."""
    text = os.path.expandvars(str(value or "").strip().strip("\x00"))
    if not text:
        return ""
    if text.startswith('"'):
        end = text.find('"', 1)
        if end > 1:
            return text[1:end].strip()
    lower = text.lower()
    exe_index = lower.find(".exe")
    if exe_index >= 0:
        return text[: exe_index + 4].strip().strip('"')
    return text.split(",", 1)[0].strip().strip('"')


def _start_menu_dirs() -> list[Path]:
    roots: list[Path] = []
    for env_name in ("PROGRAMDATA", "APPDATA"):
        base = os.environ.get(env_name)
        if not base:
            continue
        roots.append(Path(base) / "Microsoft" / "Windows" / "Start Menu" / "Programs")
    return roots


def _expand_shell_path(value: Any) -> Path | None:
    text = os.path.expandvars(str(value or "").strip().strip("\x00"))
    if not text:
        return None
    try:
        return Path(text)
    except Exception:
        return None


def _registry_shell_folder(root: Any, subkey: str, value_name: str) -> Path | None:
    try:
        import winreg
        with winreg.OpenKey(root, subkey) as key:
            value, _value_type = winreg.QueryValueEx(key, value_name)
        return _expand_shell_path(value)
    except Exception:
        return None


def _desktop_dirs() -> list[Path]:
    roots: list[Path] = []

    user_profile = os.environ.get("USERPROFILE")
    if user_profile:
        roots.extend([
            Path(user_profile) / "Desktop",
            Path(user_profile) / "桌面",
        ])
    public_profile = os.environ.get("PUBLIC")
    if public_profile:
        roots.extend([
            Path(public_profile) / "Desktop",
            Path(public_profile) / "桌面",
        ])
    for env_name in ("OneDrive", "OneDriveConsumer", "OneDriveCommercial"):
        base = os.environ.get(env_name)
        if base:
            roots.extend([
                Path(base) / "Desktop",
                Path(base) / "桌面",
            ])

    try:
        import winreg
        registry_locations = [
            (
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders",
                "Desktop",
            ),
            (
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders",
                "Desktop",
            ),
            (
                winreg.HKEY_LOCAL_MACHINE,
                r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders",
                "Common Desktop",
            ),
            (
                winreg.HKEY_LOCAL_MACHINE,
                r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders",
                "Common Desktop",
            ),
        ]
        for root, subkey, value_name in registry_locations:
            path = _registry_shell_folder(root, subkey, value_name)
            if path:
                roots.append(path)
    except Exception:
        pass

    seen: set[str] = set()
    out: list[Path] = []
    for root in roots:
        try:
            key = str(root.resolve()).lower()
        except Exception:
            key = str(root).lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(root)
    return out


def _shortcut_dirs() -> list[Path]:
    return [*_start_menu_dirs(), *_desktop_dirs()]


def _resolve_lnk(shortcut_path: Path) -> tuple[str, str]:
    try:
        import win32com.client
        shell = win32com.client.Dispatch("WScript.Shell")
        shortcut = shell.CreateShortcut(str(shortcut_path))
        return _extract_launch_path(shortcut.TargetPath), str(shortcut.Arguments or "")
    except Exception:
        return "", ""


def _extract_exe_from_shortcut_args(args: str) -> str:
    for token in str(args or "").replace('"', " ").split():
        clean = token.strip()
        if clean.lower().endswith(".exe"):
            return clean
    return ""


def _path_is_launchable(path: str) -> bool:
    if not path:
        return False
    try:
        candidate = Path(path)
        return candidate.exists() and candidate.is_file()
    except Exception:
        return False


def _find_exe_in_directory(directory: str, hints: list[str]) -> str:
    if not directory:
        return ""
    root = Path(directory)
    if not root.exists() or not root.is_dir():
        return ""

    ignored = {
        "uninstall", "unins", "setup", "install", "update", "updater",
        "crash", "helper", "service",
    }
    normalized_hints = {_normalize_app_lookup(h) for h in hints if h}
    normalized_hints = {h for h in normalized_hints if h}

    for hint in hints:
        if not hint:
            continue
        direct = root / f"{hint}.exe"
        if direct.exists():
            return str(direct)

    best: str = ""
    scanned = 0
    try:
        for exe in root.rglob("*.exe"):
            scanned += 1
            if scanned > 500:
                break
            stem_key = _normalize_app_lookup(exe.stem)
            if any(token in stem_key for token in ignored):
                continue
            if stem_key in normalized_hints:
                return str(exe)
            if not best:
                best = str(exe)
    except Exception:
        return ""

    return best


def _display_score(display_name: str, path: str) -> int:
    name = str(display_name or "")
    score = 0
    if name and not name.lower().endswith(".exe"):
        score += 2
    if _looks_localized(name):
        score += 4
    suffix = Path(path).suffix.lower() if path else ""
    if suffix == ".exe":
        score += 3
    if suffix in {".lnk", ".appref-ms"}:
        score += 1
    if any(token in name.lower() for token in ("uninstall", "setup", "updater")):
        score -= 5
    return score


def _upsert_app(
    results: dict[str, dict[str, Any]],
    display_name: str,
    path: str,
    bundle_id: str | None = None,
) -> None:
    clean_name = str(display_name or "").strip()
    clean_path = _extract_launch_path(path)
    if not clean_name and not clean_path:
        return

    launch_path = clean_path
    path_obj = Path(clean_path) if clean_path else None
    if path_obj and path_obj.exists() and path_obj.is_dir():
        launch_path = _find_exe_in_directory(
            str(path_obj),
            [bundle_id or "", clean_name, path_obj.name],
        ) or str(path_obj)

    derived_bundle_id = str(bundle_id or "").strip()
    if not derived_bundle_id and launch_path:
        launch_obj = Path(launch_path)
        if launch_obj.suffix.lower() == ".exe":
            derived_bundle_id = launch_obj.stem
    if not derived_bundle_id:
        derived_bundle_id = clean_name or Path(launch_path).stem
    if not clean_name:
        clean_name = derived_bundle_id

    key = _normalize_app_lookup(derived_bundle_id) or derived_bundle_id.lower()
    existing = results.get(key)
    entry = {
        "bundleId": derived_bundle_id,
        "displayName": clean_name,
        "path": launch_path,
    }
    if not existing:
        results[key] = entry
        return

    if _display_score(clean_name, launch_path) > _display_score(existing["displayName"], existing.get("path", "")):
        existing["displayName"] = clean_name
    if _path_is_launchable(launch_path) and not _path_is_launchable(existing.get("path", "")):
        existing["path"] = launch_path
    elif Path(launch_path).suffix.lower() == ".exe" and Path(existing.get("path", "")).suffix.lower() != ".exe":
        existing["path"] = launch_path


def _add_registry_apps(results: dict[str, dict[str, Any]]) -> None:
    import winreg

    reg_paths = [
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
    ]

    for hive, sub_key in reg_paths:
        try:
            key = winreg.OpenKey(hive, sub_key)
        except OSError:
            continue
        try:
            i = 0
            while True:
                try:
                    name = winreg.EnumKey(key, i)
                    i += 1
                except OSError:
                    break
                try:
                    app_key = winreg.OpenKey(key, name)
                except OSError:
                    continue
                try:
                    display_name = winreg.QueryValueEx(app_key, "DisplayName")[0]
                except OSError:
                    winreg.CloseKey(app_key)
                    continue
                try:
                    install_location = winreg.QueryValueEx(app_key, "InstallLocation")[0]
                except OSError:
                    install_location = ""
                try:
                    display_icon = winreg.QueryValueEx(app_key, "DisplayIcon")[0]
                except OSError:
                    display_icon = ""

                normalized_icon = _extract_launch_path(display_icon)
                normalized_install_location = _extract_launch_path(install_location)
                path = normalized_icon or normalized_install_location
                bundle_id = name
                for candidate in (normalized_icon, normalized_install_location):
                    if not candidate:
                        continue
                    candidate_path = Path(candidate)
                    if candidate_path.suffix.lower() == ".exe":
                        bundle_id = candidate_path.stem
                        break
                _upsert_app(results, str(display_name), path, bundle_id)
                winreg.CloseKey(app_key)
        finally:
            winreg.CloseKey(key)


def _add_shortcut_apps(results: dict[str, dict[str, Any]]) -> None:
    for root in _shortcut_dirs():
        if not root.exists():
            continue
        for suffix in ("*.lnk", "*.appref-ms"):
            try:
                shortcuts = root.rglob(suffix)
                for shortcut in shortcuts:
                    display_name = shortcut.stem
                    launch_path = str(shortcut)
                    bundle_id = shortcut.stem
                    if shortcut.suffix.lower() == ".lnk":
                        target, arguments = _resolve_lnk(shortcut)
                        target_path = Path(target) if target else None
                        arg_exe = _extract_exe_from_shortcut_args(arguments)
                        if arg_exe:
                            bundle_id = Path(arg_exe).stem
                        elif target_path and target_path.exists():
                            bundle_id = target_path.stem
                        if target_path and target_path.exists() and target_path.stem.lower() != "update":
                            launch_path = target
                    else:
                        bundle_id = Path(launch_path).stem if launch_path else shortcut.stem
                    _upsert_app(results, display_name, launch_path, bundle_id)
            except Exception:
                continue


def _add_running_apps(results: dict[str, dict[str, Any]]) -> None:
    try:
        import psutil
    except Exception:
        return

    for proc in psutil.process_iter(["name", "exe"]):
        try:
            exe_path = proc.info["exe"] or ""
            name = proc.info["name"] or Path(exe_path).stem
            if not exe_path:
                continue
            _upsert_app(results, Path(exe_path).stem or name, exe_path, Path(exe_path).stem)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue


def _add_common_app_candidates(results: dict[str, dict[str, Any]]) -> None:
    """Catch popular apps whose installers skip the usual uninstall registry path."""
    known_apps = [
        ("Qoder", "Qoder", "Qoder.exe"),
        ("QQ音乐", "QQMusic", "QQMusic.exe"),
        ("微信", "WeChat", "WeChat.exe"),
        ("企业微信", "WXWork", "WXWork.exe"),
        ("钉钉", "DingTalk", "DingTalk.exe"),
        ("网易云音乐", "cloudmusic", "cloudmusic.exe"),
    ]
    roots: list[Path] = []
    for env_name in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA", "APPDATA"):
        value = os.environ.get(env_name)
        if value:
            roots.append(Path(value))

    for display_name, bundle_id, exe_name in known_apps:
        for root in roots:
            candidate_paths = [
                root / bundle_id / exe_name,
                root / "Tencent" / bundle_id / exe_name,
                root / "Programs" / bundle_id / exe_name,
            ]
            for candidate in candidate_paths:
                if candidate.exists():
                    _upsert_app(results, display_name, str(candidate), bundle_id)
            tencent_root = root / "Tencent"
            if tencent_root.exists():
                try:
                    for match in tencent_root.rglob(exe_name):
                        _upsert_app(results, display_name, str(match), bundle_id)
                        break
                except Exception:
                    pass


def installed_apps() -> list[dict[str, Any]]:
    """List installed programs from registry, Start Menu, desktop shortcuts, and running apps."""
    results: dict[str, dict[str, Any]] = {}
    _add_registry_apps(results)
    _add_shortcut_apps(results)
    _add_running_apps(results)
    _add_common_app_candidates(results)

    return sorted(results.values(), key=lambda item: item["displayName"].lower())


def _icon_source_path(path: str) -> str:
    source = _extract_launch_path(path)
    if not source:
        return ""
    try:
        source_path = Path(source)
        if source_path.suffix.lower() == ".lnk":
            target, _arguments = _resolve_lnk(source_path)
            if target:
                return target
        if source_path.exists() and source_path.is_dir():
            found = _find_exe_in_directory(str(source_path), [source_path.name])
            return found or source
    except Exception:
        return source
    return source


def app_icon_data_url(path: str) -> str:
    source = _icon_source_path(path)
    if not source:
        return ""

    large_icons: list[Any] = []
    small_icons: list[Any] = []
    hicon: Any = None
    hdc_screen: Any = None
    dc: Any = None
    mem_dc: Any = None
    bitmap: Any = None
    old_bitmap: Any = None
    try:
        import win32con
        import win32gui
        import win32ui

        large_icons, small_icons = win32gui.ExtractIconEx(source, 0)
        hicon = (large_icons or small_icons or [None])[0]
        if not hicon:
            return ""

        size = 48
        hdc_screen = win32gui.GetDC(0)
        dc = win32ui.CreateDCFromHandle(hdc_screen)
        mem_dc = dc.CreateCompatibleDC()
        bitmap = win32ui.CreateBitmap()
        bitmap.CreateCompatibleBitmap(dc, size, size)
        old_bitmap = mem_dc.SelectObject(bitmap)
        win32gui.DrawIconEx(
            mem_dc.GetSafeHdc(),
            0,
            0,
            hicon,
            size,
            size,
            0,
            0,
            win32con.DI_NORMAL,
        )

        info = bitmap.GetInfo()
        raw = bitmap.GetBitmapBits(True)
        image = Image.frombuffer(
            "RGBA",
            (info["bmWidth"], info["bmHeight"]),
            raw,
            "raw",
            "BGRA",
            0,
            1,
        )
        alpha = image.getchannel("A").getextrema()
        if alpha == (0, 0):
            image.putalpha(255)
        output = BytesIO()
        image.save(output, format="PNG")
        return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode("ascii")
    except Exception:
        return ""
    finally:
        try:
            if old_bitmap is not None and mem_dc is not None:
                mem_dc.SelectObject(old_bitmap)
        except Exception:
            pass
        try:
            if bitmap is not None:
                import win32gui
                win32gui.DeleteObject(bitmap.GetHandle())
        except Exception:
            pass
        try:
            if mem_dc is not None:
                mem_dc.DeleteDC()
        except Exception:
            pass
        try:
            if dc is not None:
                dc.DeleteDC()
        except Exception:
            pass
        try:
            if hdc_screen is not None:
                import win32gui
                win32gui.ReleaseDC(0, hdc_screen)
        except Exception:
            pass
        try:
            import win32gui
            for icon in [*large_icons, *small_icons]:
                if icon:
                    win32gui.DestroyIcon(icon)
        except Exception:
            pass


def app_icons(apps: list[dict[str, Any]]) -> dict[str, str]:
    icons: dict[str, str] = {}
    for item in apps[:80]:
        bundle_id = str(item.get("bundleId") or "").strip()
        path = str(item.get("path") or "").strip()
        if not bundle_id or not path:
            continue
        icon = app_icon_data_url(path)
        if icon:
            icons[bundle_id] = icon
    return icons


def running_apps() -> list[dict[str, Any]]:
    """List running GUI applications."""
    import psutil

    apps: list[dict[str, Any]] = []
    seen: set[str] = set()

    for proc in psutil.process_iter(["pid", "name", "exe"]):
        try:
            name = proc.info["name"] or ""
            exe_path = proc.info["exe"] or ""
            name_key = _normalize_app_lookup(name)
            if not name or not name_key or name_key in seen:
                continue
            # Skip system/background processes (no window)
            if not exe_path:
                continue
            seen.add(name_key)
            # Use exe name (without .exe) as bundleId
            bundle_id = Path(exe_path).stem if exe_path else name
            apps.append({"bundleId": bundle_id, "displayName": name})
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    return sorted(apps, key=lambda item: item["displayName"].lower())


def app_display_name(bundle_id: str) -> str | None:
    """Find display name for a given bundleId (exe stem or registry key)."""
    import psutil
    requested_key = _normalize_app_lookup(bundle_id)
    for proc in psutil.process_iter(["name", "exe"]):
        try:
            exe = proc.info["exe"] or ""
            proc_name = str(proc.info["name"] or "")
            if (
                (exe and _normalize_app_lookup(Path(exe).stem) == requested_key)
                or _normalize_app_lookup(proc_name) == requested_key
            ):
                return proc.info["name"]
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    for app in installed_apps():
        app_keys = {
            _normalize_app_lookup(str(app.get("bundleId") or "")),
            _normalize_app_lookup(str(app.get("displayName") or "")),
            _normalize_app_lookup(Path(str(app.get("path") or "")).stem),
        }
        if requested_key and requested_key in app_keys:
            return str(app["displayName"])
    return None


def frontmost_app() -> dict[str, str] | None:
    """Get the currently focused (foreground) application."""
    import win32gui
    import win32process
    import psutil

    hwnd = win32gui.GetForegroundWindow()
    if not hwnd:
        return None
    try:
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        proc = psutil.Process(pid)
        exe_path = proc.exe()
        return {
            "bundleId": Path(exe_path).stem,
            "displayName": proc.name(),
        }
    except Exception:
        return None


def app_under_point(x: int, y: int) -> dict[str, str] | None:
    """Find the app whose window is under the given screen coordinate."""
    import win32gui
    import win32process
    import psutil

    hwnd = win32gui.WindowFromPoint((x, y))
    if not hwnd:
        return frontmost_app()
    # Walk up to the top-level owner
    root = win32gui.GetAncestor(hwnd, 3)  # GA_ROOTOWNER = 3
    if root:
        hwnd = root
    try:
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        proc = psutil.Process(pid)
        exe_path = proc.exe()
        return {
            "bundleId": Path(exe_path).stem,
            "displayName": proc.name(),
        }
    except Exception:
        return frontmost_app()


# ---------------------------------------------------------------------------
# Semantic UI Automation (Windows UIA)
# ---------------------------------------------------------------------------

UIA_CONTROL_TYPE_PROPERTY_ID = 30003
UIA_NAME_PROPERTY_ID = 30005
UIA_AUTOMATION_ID_PROPERTY_ID = 30011
UIA_CLASS_NAME_PROPERTY_ID = 30012
UIA_IS_ENABLED_PROPERTY_ID = 30010
UIA_HAS_KEYBOARD_FOCUS_PROPERTY_ID = 30008
UIA_VALUE_VALUE_PROPERTY_ID = 30045
UIA_INVOKE_PATTERN_ID = 10000
UIA_VALUE_PATTERN_ID = 10002
TREE_SCOPE_CHILDREN = 2

UIA_ROLE_NAMES = {
    50000: "button",
    50001: "calendar",
    50002: "checkbox",
    50003: "combobox",
    50004: "edit",
    50005: "hyperlink",
    50006: "image",
    50007: "listitem",
    50008: "list",
    50009: "menu",
    50010: "menubar",
    50011: "menuitem",
    50012: "progressbar",
    50013: "radiobutton",
    50014: "scrollbar",
    50015: "slider",
    50016: "spinner",
    50017: "statusbar",
    50018: "tab",
    50019: "tabitem",
    50020: "text",
    50021: "toolbar",
    50022: "tooltip",
    50023: "tree",
    50024: "treeitem",
    50025: "custom",
    50026: "group",
    50030: "document",
    50031: "splitbutton",
    50032: "window",
    50033: "pane",
    50034: "header",
    50035: "headeritem",
    50036: "table",
}

ACTIONABLE_UIA_ROLES = {
    "button",
    "checkbox",
    "combobox",
    "edit",
    "hyperlink",
    "listitem",
    "menuitem",
    "radiobutton",
    "slider",
    "spinner",
    "tabitem",
    "treeitem",
}


def _uia_client() -> Any:
    import comtypes.client
    return comtypes.client.CreateObject("UIAutomationClient.CUIAutomation")


def _uia_property(element: Any, prop_id: int, default: Any = "") -> Any:
    try:
        value = element.GetCurrentPropertyValue(prop_id)
        return default if value is None else value
    except Exception:
        return default


def _uia_rect(element: Any) -> dict[str, int] | None:
    try:
        rect = element.CurrentBoundingRectangle
        left = int(getattr(rect, "left", rect[0]))
        top = int(getattr(rect, "top", rect[1]))
        right = int(getattr(rect, "right", rect[2]))
        bottom = int(getattr(rect, "bottom", rect[3]))
        width = right - left
        height = bottom - top
        if width <= 1 or height <= 1:
            return None
        return {"x": left, "y": top, "width": width, "height": height}
    except Exception:
        return None


def _uia_runtime_id(element: Any) -> list[int]:
    try:
        return [int(part) for part in list(element.GetRuntimeId())]
    except Exception:
        return []


def _uia_role(element: Any) -> tuple[str, int]:
    control_type = int(_uia_property(element, UIA_CONTROL_TYPE_PROPERTY_ID, 0) or 0)
    return UIA_ROLE_NAMES.get(control_type, f"control_{control_type}"), control_type


def _encode_ui_element_id(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    token = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
    return f"uia:{token}"


def _decode_ui_element_id(element_id: str) -> dict[str, Any]:
    if not element_id.startswith("uia:"):
        raise ValueError("element_id is not a Windows UIA element id")
    token = element_id.split(":", 1)[1]
    token += "=" * ((4 - len(token) % 4) % 4)
    return json.loads(base64.urlsafe_b64decode(token.encode("ascii")).decode("utf-8"))


def _rects_close(a: dict[str, Any], b: dict[str, Any], tolerance: int = 12) -> bool:
    return (
        abs(int(a.get("x", 0)) - int(b.get("x", 0))) <= tolerance
        and abs(int(a.get("y", 0)) - int(b.get("y", 0))) <= tolerance
        and abs(int(a.get("width", 0)) - int(b.get("width", 0))) <= tolerance
        and abs(int(a.get("height", 0)) - int(b.get("height", 0))) <= tolerance
    )


def _window_overlaps_display(window: dict[str, Any], display_id: int | None) -> bool:
    if display_id is None:
        return True
    try:
        display = choose_display(display_id)
    except Exception:
        return True
    wb = window["bounds"]
    return (
        wb["x"] < display["originX"] + display["width"]
        and wb["x"] + wb["width"] > display["originX"]
        and wb["y"] < display["originY"] + display["height"]
        and wb["y"] + wb["height"] > display["originY"]
    )


def _bundle_is_allowed(bundle_id: str, display_name: str, allowed_bundle_ids: list[str]) -> bool:
    keys = {_normalize_app_lookup(bundle_id), _normalize_app_lookup(display_name)}
    allowed = {_normalize_app_lookup(item) for item in allowed_bundle_ids if item}
    if "*" in {str(item).strip() for item in allowed_bundle_ids if item}:
        return True
    return any(key and key in allowed for key in keys)


def _element_payload(element: Any, hwnd: int, app: dict[str, str]) -> dict[str, Any] | None:
    bounds = _uia_rect(element)
    if not bounds:
        return None
    role, control_type = _uia_role(element)
    name = str(_uia_property(element, UIA_NAME_PROPERTY_ID, "") or "")
    automation_id = str(_uia_property(element, UIA_AUTOMATION_ID_PROPERTY_ID, "") or "")
    class_name = str(_uia_property(element, UIA_CLASS_NAME_PROPERTY_ID, "") or "")
    value = str(_uia_property(element, UIA_VALUE_VALUE_PROPERTY_ID, "") or "")
    if not name and not automation_id and not value and role not in ACTIONABLE_UIA_ROLES:
        return None

    payload = {
        "kind": "uia",
        "hwnd": hwnd,
        "runtimeId": _uia_runtime_id(element),
        "bundleId": app["bundleId"],
        "displayName": app["displayName"],
        "role": role,
        "controlType": control_type,
        "name": name,
        "value": value,
        "automationId": automation_id,
        "className": class_name,
        "bounds": bounds,
    }
    element_id = _encode_ui_element_id(payload)
    return {
        "id": element_id,
        "elementId": element_id,
        "element_id": element_id,
        "bundleId": app["bundleId"],
        "displayName": app["displayName"],
        "role": role,
        "name": name,
        **({"value": value} if value else {}),
        **({"automationId": automation_id} if automation_id else {}),
        **({"className": class_name} if class_name else {}),
        "bounds": bounds,
        "enabled": bool(_uia_property(element, UIA_IS_ENABLED_PROPERTY_ID, True)),
        "focused": bool(_uia_property(element, UIA_HAS_KEYBOARD_FOCUS_PROPERTY_ID, False)),
    }


def _walk_uia_elements(root: Any, hwnd: int, app: dict[str, str], max_elements: int) -> tuple[list[dict[str, Any]], bool]:
    client = _uia_client()
    condition = client.CreateTrueCondition()
    out: list[dict[str, Any]] = []
    queue: list[tuple[Any, int]] = [(root, 0)]
    visited = 0
    truncated = False

    while queue:
        element, depth = queue.pop(0)
        visited += 1
        if visited > 1200:
            truncated = True
            break
        item = _element_payload(element, hwnd, app)
        if item:
            out.append(item)
            if len(out) >= max_elements:
                truncated = True
                break
        if depth >= 8:
            continue
        try:
            children = element.FindAll(TREE_SCOPE_CHILDREN, condition)
            for idx in range(children.Length):
                queue.append((children.GetElement(idx), depth + 1))
        except Exception:
            continue

    return out, truncated


def observe_desktop(
    allowed_bundle_ids: list[str],
    display_id: int | None = None,
    max_elements: int = 120,
) -> dict[str, Any]:
    windows = [w for w in list_windows() if _window_overlaps_display(w, display_id)]
    frontmost = frontmost_app()
    semantic_ui = "uia"
    elements: list[dict[str, Any]] = []
    truncated = False

    try:
        client = _uia_client()
    except Exception:
        client = None
        semantic_ui = "none"

    for window in windows:
        allowed = _bundle_is_allowed(window["bundleId"], window["displayName"], allowed_bundle_ids)
        host = _window_is_host_app(int(window.get("hwnd") or 0))
        window["isAllowed"] = bool(allowed or host)
        if not client or not (allowed or host):
            continue
        if len(elements) >= max_elements:
            truncated = True
            break
        try:
            root = client.ElementFromHandle(int(window["hwnd"]))
            app = {
                "bundleId": str(window["bundleId"]),
                "displayName": str(window["displayName"]),
            }
            found, was_truncated = _walk_uia_elements(root, int(window["hwnd"]), app, max_elements - len(elements))
            for item in found:
                item["isAllowed"] = bool(allowed)
            elements.extend(found)
            truncated = truncated or was_truncated
        except Exception:
            continue

    return {
        "frontmostApp": frontmost,
        "windows": [
            {
                "id": str(w.get("id") or w.get("hwnd") or ""),
                "bundleId": str(w.get("bundleId") or ""),
                "displayName": str(w.get("displayName") or ""),
                "title": str(w.get("title") or ""),
                "bounds": w["bounds"],
                "isFrontmost": bool(w.get("isFrontmost")),
                "isAllowed": bool(w.get("isAllowed")),
            }
            for w in windows
        ],
        "uiElements": elements[:max_elements],
        "semanticUi": semantic_ui,
        "elementCount": len(elements),
        "truncated": bool(truncated or len(elements) > max_elements),
    }


def _find_ui_element(element_id: str) -> tuple[Any | None, dict[str, Any]]:
    desc = _decode_ui_element_id(element_id)
    hwnd = int(desc.get("hwnd") or 0)
    if not hwnd:
        raise ValueError("UI element id is missing a window handle")
    actual_keys = {
        _normalize_app_lookup(_get_window_process_stem(hwnd)),
        _normalize_app_lookup(_get_window_process_name(hwnd)),
    }
    expected_keys = {
        _normalize_app_lookup(str(desc.get("bundleId") or "")),
        _normalize_app_lookup(str(desc.get("displayName") or "")),
    }
    if not any(key and key in expected_keys for key in actual_keys):
        raise ValueError("UI element target window no longer matches the observed app")
    runtime_id = [int(part) for part in desc.get("runtimeId") or []]
    client = _uia_client()
    root = client.ElementFromHandle(hwnd)
    condition = client.CreateTrueCondition()
    queue: list[tuple[Any, int]] = [(root, 0)]
    visited = 0

    while queue:
        element, depth = queue.pop(0)
        visited += 1
        if visited > 1500:
            break
        current_runtime = _uia_runtime_id(element)
        if runtime_id and current_runtime == runtime_id:
            return element, desc

        role, control_type = _uia_role(element)
        bounds = _uia_rect(element)
        name = str(_uia_property(element, UIA_NAME_PROPERTY_ID, "") or "")
        automation_id = str(_uia_property(element, UIA_AUTOMATION_ID_PROPERTY_ID, "") or "")
        if (
            bounds
            and control_type == int(desc.get("controlType") or 0)
            and name == str(desc.get("name") or "")
            and automation_id == str(desc.get("automationId") or "")
            and _rects_close(bounds, desc.get("bounds") or {})
        ):
            return element, desc

        if depth >= 8:
            continue
        try:
            children = element.FindAll(TREE_SCOPE_CHILDREN, condition)
            for idx in range(children.Length):
                queue.append((children.GetElement(idx), depth + 1))
        except Exception:
            continue

    return None, desc


def _click_element_center(desc: dict[str, Any], element: Any | None = None) -> None:
    bounds = _uia_rect(element) if element is not None else None
    if not bounds:
        bounds = desc.get("bounds") or {}
    x, y = _bounds_center(bounds)
    if desc.get("hwnd"):
        try:
            _activate_window(int(desc["hwnd"]))
        except Exception:
            pass
    pyautogui.click(x=x, y=y, button="left", clicks=1, interval=0.05)


def _bounds_center(bounds: dict[str, Any]) -> tuple[int, int]:
    return (
        int(bounds.get("x", 0) + bounds.get("width", 0) / 2),
        int(bounds.get("y", 0) + bounds.get("height", 0) / 2),
    )


def _click_observed_element_center(element_info: dict[str, Any], clicks: int = 1) -> None:
    element_id = str(
        element_info.get("elementId")
        or element_info.get("element_id")
        or element_info.get("id")
        or ""
    )
    element: Any | None = None
    desc: dict[str, Any] = element_info
    if element_id:
        try:
            element, desc = _find_ui_element(element_id)
        except Exception:
            element = None
            desc = element_info

    bounds = _uia_rect(element) if element is not None else None
    if not bounds:
        bounds = desc.get("bounds") or element_info.get("bounds") or {}
    x, y = _bounds_center(bounds)
    if desc.get("hwnd"):
        try:
            _activate_window(int(desc["hwnd"]))
        except Exception:
            pass
    pyautogui.click(x=x, y=y, button="left", clicks=max(1, clicks), interval=0.08)


def click_ui_element(element_id: str) -> None:
    element, desc = _find_ui_element(element_id)
    if element is not None:
        try:
            pattern = element.GetCurrentPattern(UIA_INVOKE_PATTERN_ID)
            pattern.Invoke()
            return
        except Exception:
            pass
    _click_element_center(desc, element)


def focus_ui_element(element_id: str) -> None:
    element, desc = _find_ui_element(element_id)
    if element is not None:
        try:
            element.SetFocus()
            time.sleep(0.05)
            return
        except Exception:
            pass
    _click_element_center(desc, element)
    time.sleep(0.05)


def set_ui_element_value(element_id: str, text: str) -> dict[str, bool]:
    element, desc = _find_ui_element(element_id)
    if element is not None:
        try:
            element.SetFocus()
        except Exception:
            pass
        try:
            pattern = element.GetCurrentPattern(UIA_VALUE_PATTERN_ID)
            pattern.SetValue(text)
            return {"usedValuePattern": True}
        except Exception:
            return {"usedValuePattern": False}
    _click_element_center(desc, None)
    return {"usedValuePattern": False}


def _text_key(value: Any) -> str:
    return _normalize_app_lookup(str(value or ""))


def _element_text_blob(element: dict[str, Any]) -> str:
    return _text_key(
        " ".join(
            str(element.get(key) or "")
            for key in ("name", "value", "automationId", "className", "role")
        )
    )


MUSIC_APP_ACTION_RECIPES: dict[str, dict[str, Any]] = {
    # QQ Music's Windows client is commonly Chromium/self-drawn, so UIA often
    # exposes no useful search/result elements. These points are window-relative
    # fallbacks for the normal desktop layout: top search box, then first song.
    "qqmusic": {
        "aliases": {"qqmusic", "qq音乐"},
        "search_points": [
            (0.30, 0.055),
            (0.36, 0.055),
            (0.24, 0.055),
            (0.44, 0.055),
        ],
        "pre_play_points": [
            # Search can land on lyrics/singer/album tabs. Switch to songs.
            (0.225, 0.268, 1),
        ],
        "result_points": [
            # Prefer the first row's song text/row area for audio playback.
            (0.268, 0.458, 2),
            (0.225, 0.458, 2),
            # Some layouts expose only an inline play/MV control here.
            (0.344, 0.458, 1),
            (0.344, 0.532, 1),
        ],
        "search_wait_s": 1.4,
        "tab_wait_s": 0.8,
        "play_wait_s": 1.1,
    },
}


def _music_app_recipe_key(app_bundle_id: str) -> str | None:
    app_key = _normalize_app_lookup(app_bundle_id)
    for recipe_key, recipe in MUSIC_APP_ACTION_RECIPES.items():
        aliases = {_normalize_app_lookup(alias) for alias in recipe.get("aliases", set())}
        aliases.add(_normalize_app_lookup(recipe_key))
        if app_key in aliases:
            return recipe_key
    return None


def _search_music_with_visual_recipe(app_bundle_id: str, query: str, notes: list[str]) -> str | None:
    recipe_key = _music_app_recipe_key(app_bundle_id)
    if not recipe_key:
        return None
    hwnd = _primary_window_for_app(app_bundle_id)
    if not hwnd:
        notes.append(f"visual_recipe_search_unavailable:{recipe_key}:window_not_found")
        return None
    if not _activate_window(hwnd):
        notes.append(f"visual_recipe_search_unavailable:{recipe_key}:activation_failed")
        return None

    recipe = MUSIC_APP_ACTION_RECIPES[recipe_key]
    points = list(recipe.get("search_points") or [])
    if not points:
        return None

    notes.append(f"visual_recipe_search:{recipe_key}:candidate_points={len(points)}")
    for index, (rx, ry) in enumerate(points):
        if not _click_window_ratio(hwnd, float(rx), float(ry), clicks=1):
            continue
        time.sleep(0.08)
        key_action("ctrl+a")
        _paste_text_fast(query)
        key_action("enter")
        time.sleep(0.2 if index < len(points) - 1 else float(recipe.get("search_wait_s", 1.2)))
    return f"visual_recipe_search:{recipe_key}"


def _attempt_music_play_with_visual_recipe(
    app_bundle_id: str,
    query: str,
    notes: list[str],
) -> tuple[bool, str] | None:
    recipe_key = _music_app_recipe_key(app_bundle_id)
    if not recipe_key:
        return None
    hwnd = _primary_window_for_app(app_bundle_id)
    if not hwnd:
        notes.append(f"visual_recipe_play_unavailable:{recipe_key}:window_not_found")
        return None
    if not _activate_window(hwnd):
        notes.append(f"visual_recipe_play_unavailable:{recipe_key}:activation_failed")
        return None

    recipe = MUSIC_APP_ACTION_RECIPES[recipe_key]
    for point in list(recipe.get("pre_play_points") or []):
        if len(point) < 2:
            continue
        clicks = int(point[2]) if len(point) >= 3 else 1
        _click_window_ratio(hwnd, float(point[0]), float(point[1]), clicks=max(1, clicks))
        time.sleep(float(recipe.get("tab_wait_s", 0.6)))

    points = list(recipe.get("result_points") or [])
    if not points:
        return None

    notes.append(f"visual_recipe_play:{recipe_key}:candidate_points={len(points)}")
    attempted = False
    for point in points:
        if len(point) < 2:
            continue
        clicks = int(point[2]) if len(point) >= 3 else 2
        if not _click_window_ratio(hwnd, float(point[0]), float(point[1]), clicks=max(1, clicks)):
            continue
        attempted = True
        time.sleep(float(recipe.get("play_wait_s", 1.0)))
        verification = _verify_music_playback(app_bundle_id, query)
        if verification.get("verified"):
            notes.append(f"visual_recipe_play_verified:{recipe_key}")
            return True, f"visual_recipe_play:{recipe_key}"

    if attempted:
        return True, f"visual_recipe_play_unverified:{recipe_key}"
    return None


def _find_search_element(app_bundle_id: str) -> dict[str, Any] | None:
    try:
        observation = observe_desktop([app_bundle_id], max_elements=220)
    except Exception:
        return None
    candidates = [
        element
        for element in observation.get("uiElements", [])
        if element.get("role") in {"edit", "combobox"}
    ]
    if not candidates:
        return None

    search_tokens = ("搜索", "search", "find", "输入", "搜")
    scored: list[tuple[int, dict[str, Any]]] = []
    for element in candidates:
        blob = _element_text_blob(element)
        bounds = element.get("bounds") or {}
        score = 0
        if any(_text_key(token) in blob for token in search_tokens):
            score += 100
        # Search boxes usually live near the top and are reasonably wide.
        if int(bounds.get("y", 10_000)) < 240:
            score += 20
        if int(bounds.get("width", 0)) >= 120:
            score += 10
        scored.append((score, element))
    scored.sort(key=lambda item: item[0], reverse=True)
    return scored[0][1] if scored and scored[0][0] > 0 else candidates[0]


def _find_playable_result(app_bundle_id: str, query: str) -> dict[str, Any] | None:
    try:
        observation = observe_desktop([app_bundle_id], max_elements=260)
    except Exception:
        return None
    query_key = _text_key(query)
    if not query_key:
        return None
    preferred_roles = {"listitem", "button", "hyperlink", "text", "custom"}
    matches: list[tuple[int, dict[str, Any]]] = []
    for element in observation.get("uiElements", []):
        if element.get("role") not in preferred_roles:
            continue
        blob = _element_text_blob(element)
        if query_key not in blob:
            continue
        bounds = element.get("bounds") or {}
        score = 100
        if element.get("role") == "listitem":
            score += 40
        if int(bounds.get("y", 0)) > 120:
            score += 10
        matches.append((score, element))
    matches.sort(key=lambda item: item[0], reverse=True)
    return matches[0][1] if matches else None


def _find_play_button_near_result(app_bundle_id: str, result_element: dict[str, Any]) -> dict[str, Any] | None:
    result_bounds = result_element.get("bounds") or {}
    result_y = int(result_bounds.get("y", 0) + result_bounds.get("height", 0) / 2)
    try:
        observation = observe_desktop([app_bundle_id], max_elements=320)
    except Exception:
        return None
    play_tokens = ("播放", "play")
    skip_tokens = ("播放全部", "全部播放", "mv")
    candidates: list[tuple[int, dict[str, Any]]] = []

    for element in observation.get("uiElements", []):
        if element.get("role") not in {"button", "hyperlink", "custom"}:
            continue
        blob = _element_text_blob(element)
        if not any(_text_key(token) in blob for token in play_tokens):
            continue
        if any(_text_key(token) in blob for token in skip_tokens):
            continue
        bounds = element.get("bounds") or {}
        y = int(bounds.get("y", 0) + bounds.get("height", 0) / 2)
        y_delta = abs(y - result_y)
        if y_delta > 44:
            continue
        score = 100 - y_delta
        if int(bounds.get("x", 0)) < int(result_bounds.get("x", 0)):
            score += 15
        candidates.append((score, element))

    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1] if candidates else None


def _qq_music_search_track(query: str, notes: list[str]) -> dict[str, Any] | None:
    """Search QQ Music for a playable track. Network failures fall back to UI."""
    try:
        import urllib.parse
        import urllib.request

        data = {
            "search": {
                "method": "DoSearchForQQMusicDesktop",
                "module": "music.search.SearchCgiService",
                "param": {
                    "num_per_page": 5,
                    "page_num": 1,
                    "query": query,
                    "search_type": 0,
                },
            },
        }
        encoded = urllib.parse.quote(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
        url = f"https://u.y.qq.com/cgi-bin/musicu.fcg?data={encoded}"
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0",
                "Referer": "https://y.qq.com/",
            },
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            payload = json.loads(response.read().decode("utf-8", "replace"))
        songs = (
            payload.get("search", {})
            .get("data", {})
            .get("body", {})
            .get("song", {})
            .get("list", [])
        )
    except Exception as exc:
        notes.append(f"qq_music_search_failed: {exc}")
        return None

    if not isinstance(songs, list) or not songs:
        notes.append("qq_music_search_empty")
        return None

    query_key = _text_key(query)

    def score_song(song: dict[str, Any]) -> int:
        name = str(song.get("name") or song.get("title") or "")
        singers = " ".join(
            str(singer.get("name") or singer.get("title") or "")
            for singer in song.get("singer", [])
            if isinstance(singer, dict)
        )
        blob = _text_key(f"{name} {singers}")
        score = 0
        if query_key and _text_key(name) == query_key:
            score += 100
        elif query_key and query_key in blob:
            score += 60
        if song.get("mid"):
            score += 10
        return score

    typed_songs = [song for song in songs if isinstance(song, dict)]
    typed_songs.sort(key=score_song, reverse=True)
    best = typed_songs[0] if typed_songs else None
    if not best:
        return None

    song_mid = str(best.get("mid") or best.get("songmid") or "").strip()
    if not song_mid:
        notes.append("qq_music_search_missing_songmid")
        return None

    return {
        "songmid": song_mid,
        "songid": best.get("id"),
        "name": str(best.get("name") or best.get("title") or ""),
        "singers": [
            str(singer.get("name") or singer.get("title") or "")
            for singer in best.get("singer", [])
            if isinstance(singer, dict)
        ],
    }


def _resolve_launch_path_for_app(app_bundle_id: str) -> str:
    requested_key = _normalize_app_lookup(app_bundle_id)
    for app in installed_apps():
        candidates = [
            str(app.get("bundleId") or ""),
            str(app.get("displayName") or ""),
            Path(str(app.get("path") or "")).stem,
        ]
        if requested_key in {_normalize_app_lookup(candidate) for candidate in candidates if candidate}:
            path = _extract_launch_path(app.get("path") or "")
            if path and Path(path).exists():
                return path
    return ""


def _registered_url_protocol(scheme: str) -> bool:
    if os.name != "nt":
        return False
    try:
        import winreg
    except Exception:
        return False

    normalized = str(scheme or "").strip()
    if not normalized:
        return False

    locations = [
        (winreg.HKEY_CLASSES_ROOT, normalized),
        (winreg.HKEY_CURRENT_USER, fr"Software\Classes\{normalized}"),
        (winreg.HKEY_LOCAL_MACHINE, fr"SOFTWARE\Classes\{normalized}"),
    ]
    for root, subkey in locations:
        try:
            with winreg.OpenKey(root, subkey) as key:
                try:
                    winreg.QueryValueEx(key, "URL Protocol")
                    return True
                except OSError:
                    pass
                try:
                    with winreg.OpenKey(key, r"shell\open\command"):
                        return True
                except OSError:
                    pass
        except OSError:
            continue
    return False


def _qq_music_direct_play(app_bundle_id: str, query: str, notes: list[str]) -> tuple[bool, str, dict[str, Any] | None]:
    app_key = _normalize_app_lookup(app_bundle_id)
    if app_key not in {"qqmusic", "qq音乐"}:
        return False, "direct_unsupported_app", None

    track = _qq_music_search_track(query, notes)
    if not track:
        return False, "direct_search_failed", None

    import urllib.parse

    payload = {
        "song": [{"type": "0", "songmid": track["songmid"]}],
        "action": "play",
    }
    direct_url = "qqmusic://qq.com/media/playSonglist?p=" + urllib.parse.quote(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        safe="",
    )
    notes.append(
        "qq_music_direct_candidate: "
        + json.dumps(
            {
                "songmid": track.get("songmid"),
                "name": track.get("name"),
                "singers": track.get("singers"),
            },
            ensure_ascii=False,
        )
    )

    launch_path = _resolve_launch_path_for_app(app_bundle_id)
    protocol_registered = _registered_url_protocol("qqmusic")
    attempts: list[tuple[str, Any]] = []
    if protocol_registered:
        attempts.append(("shell_deeplink", lambda: os.startfile(direct_url)))
        if launch_path:
            attempts.append(
                (
                    "exe_deeplink_arg",
                    lambda: subprocess.Popen([launch_path, direct_url], shell=False),
                )
            )
    else:
        notes.append("qq_music_protocol_not_registered; skipped_deeplink")

    for method, launcher in attempts:
        try:
            launcher()
            time.sleep(2.0)
            verification = _verify_music_playback(app_bundle_id, query)
            if verification.get("verified"):
                notes.append(f"qq_music_direct_verified:{method}")
                return True, method, track
            notes.append(f"qq_music_direct_unverified:{method}")
        except Exception as exc:
            notes.append(f"qq_music_direct_failed:{method}:{exc}")

    if not attempts:
        return False, "direct_protocol_unavailable", track

    return False, "direct_unverified", track


def _paste_text_fast(text: str) -> None:
    write_clipboard(text)
    time.sleep(0.05)
    paste_clipboard()
    time.sleep(0.08)


def _search_music(app_bundle_id: str, query: str, notes: list[str]) -> str:
    search_element = _find_search_element(app_bundle_id)
    if search_element:
        element_id = str(search_element.get("elementId") or search_element.get("id"))
        try:
            focus_ui_element(element_id)
            value_result = set_ui_element_value(element_id, query)
            key_action("ctrl+a")
            _paste_text_fast(query)
            if value_result.get("usedValuePattern"):
                notes.append("search_box_value_pattern_available; paste_used_to_fire_app_events")
            key_action("enter")
            return "uia_search"
        except Exception as exc:
            notes.append(f"uia_search_failed: {exc}")

    visual_method = _search_music_with_visual_recipe(app_bundle_id, query, notes)
    if visual_method:
        return visual_method

    notes.append("search_box_not_found; used Ctrl+F fallback")
    key_action("ctrl+f")
    time.sleep(0.15)
    _paste_text_fast(query)
    key_action("enter")
    return "keyboard_search"


def _attempt_music_play(app_bundle_id: str, query: str, notes: list[str]) -> tuple[bool, str]:
    time.sleep(1.4)
    result_element = _find_playable_result(app_bundle_id, query)
    if result_element:
        play_button = _find_play_button_near_result(app_bundle_id, result_element)
        if play_button:
            _click_observed_element_center(play_button, clicks=1)
            time.sleep(0.7)
            return True, "uia_row_play_button"
        _click_observed_element_center(result_element, clicks=2)
        time.sleep(0.7)
        return True, "uia_result_double_click"

    visual_attempt = _attempt_music_play_with_visual_recipe(app_bundle_id, query, notes)
    if visual_attempt:
        return visual_attempt

    notes.append("matching_result_not_found; used Enter fallback")
    key_action("enter")
    time.sleep(0.7)
    return True, "keyboard_enter"


def _detect_music_playback_ui(app_bundle_id: str, query: str) -> dict[str, Any]:
    try:
        observation = observe_desktop([app_bundle_id], max_elements=360)
    except Exception as exc:
        return {"supported": False, "verified": False, "error": str(exc)}

    query_key = _text_key(query)
    pause_tokens = ("暂停", "pause")
    playing_tokens = ("正在播放", "nowplaying", "currentplaying", "playing")
    play_tokens = ("播放", "play")
    pause_controls: list[dict[str, Any]] = []
    play_controls: list[dict[str, Any]] = []
    query_visible = False
    playing_text_visible = False

    for element in observation.get("uiElements", []):
        blob = _element_text_blob(element)
        if query_key and query_key in blob:
            query_visible = True
        if any(_text_key(token) in blob for token in playing_tokens):
            playing_text_visible = True
        if element.get("role") in {"button", "custom", "hyperlink"}:
            if any(_text_key(token) in blob for token in pause_tokens):
                pause_controls.append(element)
            elif any(_text_key(token) in blob for token in play_tokens):
                play_controls.append(element)

    # A visible Pause control is the most reliable UIA signal that the player is
    # currently playing: the button action is "pause" only while audio is active.
    verified = bool(pause_controls)
    return {
        "supported": True,
        "verified": verified,
        "queryVisible": query_visible,
        "playingTextVisible": playing_text_visible,
        "pauseControlCount": len(pause_controls),
        "playControlCount": len(play_controls),
    }


def _target_process_ids(app_bundle_id: str) -> tuple[set[int], set[str]]:
    import psutil

    target_keys = {
        _normalize_app_lookup(app_bundle_id),
        _normalize_app_lookup(Path(app_bundle_id).stem),
    }
    if _normalize_app_lookup(app_bundle_id) in {"qqmusic", "qq音乐"}:
        target_keys.update({"qqmusic", "qqmusicexternal", "qqmusicsvr"})

    pids: set[int] = set()
    names: set[str] = set()
    for proc in psutil.process_iter(["pid", "name", "exe"]):
        try:
            name = str(proc.info.get("name") or "")
            exe = str(proc.info.get("exe") or "")
            keys = {
                _normalize_app_lookup(name),
                _normalize_app_lookup(Path(name).stem),
                _normalize_app_lookup(Path(exe).stem),
            }
            if any(key and key in target_keys for key in keys):
                pids.add(int(proc.info["pid"]))
                names.add(name)
        except Exception:
            continue
    return pids, names


def _detect_music_audio_session(app_bundle_id: str) -> dict[str, Any]:
    """Best-effort audio verification. UI verification remains the main path."""
    try:
        from pycaw.pycaw import AudioUtilities, IAudioMeterInformation  # type: ignore
    except Exception as exc:
        return {"supported": False, "verified": False, "error": f"pycaw_unavailable: {exc}"}

    pids, names = _target_process_ids(app_bundle_id)
    if not pids:
        return {"supported": True, "verified": False, "reason": "target_process_not_found"}

    sessions: list[dict[str, Any]] = []
    verified = False
    try:
        for session in AudioUtilities.GetAllSessions():
            process = getattr(session, "Process", None)
            if process is None or int(getattr(process, "pid", -1)) not in pids:
                continue
            state = getattr(session, "State", None)
            try:
                state_value = int(state)
            except Exception:
                state_value = -1
            is_active = state_value == 1
            peak = 0.0
            try:
                meter = session._ctl.QueryInterface(IAudioMeterInformation)  # noqa: SLF001
                peak = float(meter.GetPeakValue())
            except Exception:
                pass
            verified = verified or is_active or peak > 0.001
            sessions.append({
                "pid": int(getattr(process, "pid", -1)),
                "name": getattr(process, "name", lambda: "")(),
                "active": bool(is_active),
                "peak": peak,
            })
    except Exception as exc:
        return {"supported": False, "verified": False, "error": str(exc)}

    return {
        "supported": True,
        "verified": verified,
        "sessions": sessions,
        "processNames": sorted(names),
    }


def _detect_music_window_title(app_bundle_id: str, query: str) -> dict[str, Any]:
    query_key = _text_key(query)
    if not query_key:
        return {"supported": True, "verified": False, "titles": []}

    titles: list[str] = []
    verified = False
    for window in list_windows():
        try:
            hwnd = int(window.get("hwnd") or window.get("id") or 0)
        except Exception:
            hwnd = 0
        if hwnd and not _window_matches_bundle_id(hwnd, _app_bundle_aliases(app_bundle_id)):
            continue
        title = str(window.get("title") or "").strip()
        if not title:
            continue
        titles.append(title)
        title_key = _text_key(title)
        if query_key in title_key:
            verified = True

    return {
        "supported": True,
        "verified": verified,
        "titles": titles[:8],
    }


def _verify_music_playback(app_bundle_id: str, query: str) -> dict[str, Any]:
    ui = _detect_music_playback_ui(app_bundle_id, query)
    audio = _detect_music_audio_session(app_bundle_id)
    title = _detect_music_window_title(app_bundle_id, query)
    return {
        "verified": bool(ui.get("verified") or audio.get("verified") or title.get("verified")),
        "ui": ui,
        "audio": audio,
        "title": title,
    }


def play_music_intent(app_bundle_id: str, query: str, instruction: str) -> dict[str, Any]:
    notes: list[str] = []
    direct_completed, direct_method, direct_track = _qq_music_direct_play(app_bundle_id, query, notes)
    if direct_completed:
        verification = _verify_music_playback(app_bundle_id, query)
        return {
            "intent": "play_music",
            "handled": True,
            "appBundleId": app_bundle_id,
            "query": query,
            "opened": True,
            "activated": True,
            "attempted": True,
            "completed": True,
            "method": f"qq_music_direct+{direct_method}",
            "frontmostApp": frontmost_app(),
            "verification": verification,
            "track": direct_track,
            "notes": notes,
            "guidance": "Playback was verified through the direct QQ Music path.",
        }

    opened = open_app(app_bundle_id)
    time.sleep(0.8)
    target_bundle_id = str(opened.get("targetBundleId") or app_bundle_id)

    if not opened.get("activated"):
        notes.append("app_opened_but_not_frontmost")
        if _activate_app(target_bundle_id, timeout_s=1.0):
            notes.append("activation_recovered_before_search")
            opened["activated"] = True
        else:
            return {
                "intent": "play_music",
                "handled": True,
                "appBundleId": app_bundle_id,
                "query": query,
                "opened": bool(opened.get("opened")),
                "activated": False,
                "attempted": False,
                "completed": False,
                "method": "open_app",
                "frontmostApp": frontmost_app(),
                "verification": {"verified": False},
                "notes": notes,
                "guidance": (
                    "The music app could not be made frontmost, so no keyboard "
                    "input was sent. Use observe_desktop or screenshot to inspect "
                    "and dismiss any blocking host/dialog window, then retry."
                ),
            }

    search_method = _search_music(target_bundle_id, query, notes)
    play_attempted, play_method = _attempt_music_play(target_bundle_id, query, notes)
    verification = _verify_music_playback(target_bundle_id, query)
    if play_attempted and not verification.get("verified"):
        notes.append("playback_not_verified_after_fast_path")

    return {
        "intent": "play_music",
        "handled": True,
        "appBundleId": app_bundle_id,
        "query": query,
        "opened": bool(opened.get("opened")),
        "activated": bool(opened.get("activated")),
        "attempted": bool(play_attempted),
        "completed": bool(play_attempted and verification.get("verified")),
        "method": f"{search_method}+{play_method}",
        "frontmostApp": frontmost_app(),
        "verification": verification,
        **({"track": direct_track} if direct_track else {}),
        "notes": notes,
        "guidance": (
            "Playback is only considered successful when completed is true. If "
            "completed is false, continue with observe_desktop/screenshot and "
            "low-level controls; do not report success yet."
        ),
    }


def run_desktop_intent(payload: dict[str, Any]) -> dict[str, Any]:
    intent = _text_key(payload.get("intent") or "")
    instruction = str(payload.get("instruction") or "")
    if intent in {"playmusic", "music"}:
        app_bundle_id = str(payload.get("appBundleId") or "").strip()
        query = str(payload.get("query") or "").strip()
        if not app_bundle_id or not query:
            raise ValueError("play_music requires appBundleId and query")
        return play_music_intent(app_bundle_id, query, instruction)

    return {
        "intent": str(payload.get("intent") or "unknown"),
        "handled": False,
        "guidance": "No direct Windows fast path exists for this intent yet. Use observe_desktop/screenshot and regular Computer Use tools as fallback.",
    }


def find_window_displays(bundle_ids: list[str]) -> list[dict[str, Any]]:
    """For each bundleId, find which display(s) its windows are on."""
    if not bundle_ids:
        return []

    displays = get_displays()
    windows = list_windows()

    # Build exe-stem -> ownerName mapping
    names_by_bundle: dict[str, str | None] = {}
    for bid in bundle_ids:
        names_by_bundle[bid] = app_display_name(bid)

    result = []
    for bundle_id in bundle_ids:
        target_name = names_by_bundle.get(bundle_id)
        target_keys = {
            _normalize_app_lookup(bundle_id),
            _normalize_app_lookup(target_name or ""),
            _normalize_app_lookup(Path(target_name or "").stem),
        }
        target_keys = {key for key in target_keys if key}
        display_ids: set[int] = set()
        for window in windows:
            owner = window["ownerName"]
            if not owner:
                continue
            # Match by exe name
            owner_stem = Path(owner).stem if owner.endswith(".exe") else owner
            owner_keys = {
                _normalize_app_lookup(owner),
                _normalize_app_lookup(owner_stem),
                _normalize_app_lookup(str(window.get("bundleId") or "")),
                _normalize_app_lookup(str(window.get("displayName") or "")),
            }
            owner_keys = {key for key in owner_keys if key}
            if target_keys and target_keys.isdisjoint(owner_keys):
                continue
            # Check which displays this window overlaps
            wx = window["bounds"]["x"]
            wy = window["bounds"]["y"]
            ww = window["bounds"]["width"]
            wh = window["bounds"]["height"]
            for display in displays:
                dx = display["originX"]
                dy = display["originY"]
                dw = display["width"]
                dh = display["height"]
                # Check rectangle intersection
                if wx < dx + dw and wx + ww > dx and wy < dy + dh and wy + wh > dy:
                    display_ids.add(int(display["displayId"]))
        result.append({"bundleId": bundle_id, "displayIds": sorted(display_ids)})
    return result


def _open_app_result(
    target_bundle_id: str,
    opened: bool,
    activated: bool,
    target_display_name: str | None = None,
) -> dict[str, Any]:
    frontmost = frontmost_app()
    frontmost_hwnd = _window_handle_for_frontmost() or 0
    target_keys = {
        _normalize_app_lookup(target_bundle_id),
        _normalize_app_lookup(Path(target_bundle_id).stem),
        _normalize_app_lookup(target_display_name or ""),
        _normalize_app_lookup(app_display_name(target_bundle_id) or ""),
    }
    frontmost_keys = {
        _normalize_app_lookup((frontmost or {}).get("bundleId", "")),
        _normalize_app_lookup((frontmost or {}).get("displayName", "")),
        _normalize_app_lookup(Path((frontmost or {}).get("displayName", "")).stem),
    }
    actually_activated = bool(
        activated
        and any(key and key in target_keys for key in frontmost_keys)
    )
    return {
        "opened": bool(opened),
        "activated": actually_activated,
        "targetBundleId": target_bundle_id,
        "targetDisplayName": target_display_name or app_display_name(target_bundle_id),
        "frontmostApp": frontmost,
        "blockedByHost": bool(frontmost_hwnd and _window_is_host_app(frontmost_hwnd)),
    }


def open_app(bundle_id: str) -> dict[str, Any]:
    """Open an application by its bundleId (exe path or program name)."""
    requested = str(bundle_id or "").strip()
    if _activate_app(requested, timeout_s=0.2):
        return _open_app_result(requested, opened=False, activated=True)

    requested_path = _extract_launch_path(requested)
    if requested_path and Path(requested_path).exists():
        os.startfile(requested_path)
        target_bundle_id = Path(requested_path).stem
        activated = _activate_app(target_bundle_id, timeout_s=4.0)
        return _open_app_result(target_bundle_id, opened=True, activated=activated)

    requested_key = _normalize_app_lookup(requested)
    launch_path = ""
    resolved_bundle_id = requested
    target_display_name = ""
    for app in installed_apps():
        candidates = [
            app.get("bundleId", ""),
            app.get("displayName", ""),
            Path(app.get("path", "")).stem if app.get("path") else "",
        ]
        candidate_keys = {_normalize_app_lookup(candidate) for candidate in candidates if candidate}
        if requested_key and requested_key in candidate_keys:
            launch_path = str(app.get("path") or "")
            resolved_bundle_id = str(app.get("bundleId") or requested)
            target_display_name = str(app.get("displayName") or "")
            break

    if launch_path:
        launch_path = _extract_launch_path(launch_path)
        path_obj = Path(launch_path)
        if path_obj.exists() and path_obj.is_dir():
            launch_path = _find_exe_in_directory(
                str(path_obj),
                [requested, path_obj.name],
            )
        if launch_path and Path(launch_path).exists():
            os.startfile(launch_path)
            activated = _activate_app(resolved_bundle_id, timeout_s=4.0)
            return _open_app_result(
                resolved_bundle_id,
                opened=True,
                activated=activated,
                target_display_name=target_display_name,
            )

    try:
        subprocess.Popen([requested], shell=True)
        activated = _activate_app(requested, timeout_s=4.0)
        return _open_app_result(requested, opened=True, activated=activated)
    except Exception as exc:
        raise RuntimeError(f"App not found for identifier: {bundle_id}") from exc


# ---------------------------------------------------------------------------
# Clipboard (pyperclip — cross-platform)
# ---------------------------------------------------------------------------

def read_clipboard() -> str:
    import pyperclip
    try:
        return pyperclip.paste() or ""
    except Exception:
        return ""


def write_clipboard(text: str) -> None:
    import pyperclip
    pyperclip.copy(text)


def paste_clipboard() -> None:
    pyautogui.hotkey("ctrl", "v", interval=0.02)


# ---------------------------------------------------------------------------
# Permissions — Windows doesn't have macOS-style TCC
# ---------------------------------------------------------------------------

def check_permissions() -> dict[str, bool | None]:
    """Windows does not require explicit accessibility/screen-recording
    permissions like macOS TCC. Always report as granted."""
    return {
        "accessibility": True,
        "screenRecording": True,
    }


# ---------------------------------------------------------------------------
# Input actions (pyautogui — identical to mac_helper)
# ---------------------------------------------------------------------------

def click(x: int, y: int, button: str, count: int, modifiers: list[str] | None) -> None:
    pyautogui.moveTo(x, y)
    if modifiers:
        normalized = [normalize_key(m) for m in modifiers]
        for key in normalized:
            pyautogui.keyDown(key)
        try:
            pyautogui.click(x=x, y=y, button=button, clicks=count, interval=0.08)
        finally:
            for key in reversed(normalized):
                pyautogui.keyUp(key)
    else:
        pyautogui.click(x=x, y=y, button=button, clicks=count, interval=0.08)


def scroll(x: int, y: int, delta_x: int, delta_y: int) -> None:
    pyautogui.moveTo(x, y)
    if delta_y:
        pyautogui.scroll(int(delta_y), x=x, y=y)
    if delta_x:
        pyautogui.hscroll(int(delta_x), x=x, y=y)


def key_action(sequence: str, repeat: int = 1) -> None:
    parts = [normalize_key(part) for part in sequence.split("+") if part.strip()]
    for _ in range(max(1, repeat)):
        if len(parts) == 1:
            pyautogui.press(parts[0])
        else:
            pyautogui.hotkey(*parts, interval=0.02)
        time.sleep(0.01)


def hold_keys(keys: list[str], duration_ms: int) -> None:
    normalized = [normalize_key(k) for k in keys]
    for key in normalized:
        pyautogui.keyDown(key)
    try:
        time.sleep(max(duration_ms, 0) / 1000)
    finally:
        for key in reversed(normalized):
            pyautogui.keyUp(key)


def type_text(text: str) -> None:
    pyautogui.write(text, interval=0.008)


# ---------------------------------------------------------------------------
# Main dispatcher — exact same command protocol as mac_helper.py
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command")
    parser.add_argument("--payload", default="{}")
    args = parser.parse_args()
    payload = json.loads(args.payload)

    try:
        command = args.command
        if command == "check_permissions":
            perms = check_permissions()
            json_output({"ok": True, "result": perms})
            return 0
        if command == "list_displays":
            json_output({"ok": True, "result": get_displays()})
            return 0
        if command == "get_display_size":
            json_output({"ok": True, "result": choose_display(payload.get("displayId"))})
            return 0
        if command == "screenshot":
            resize = None
            if payload.get("targetWidth") and payload.get("targetHeight"):
                resize = (int(payload["targetWidth"]), int(payload["targetHeight"]))
            result = capture_display(payload.get("displayId"), resize)
            json_output({"ok": True, "result": result})
            return 0
        if command == "resolve_prepare_capture":
            resize = None
            if payload.get("targetWidth") and payload.get("targetHeight"):
                resize = (int(payload["targetWidth"]), int(payload["targetHeight"]))
            result = capture_display(payload.get("preferredDisplayId"), resize)
            result["hidden"] = []
            result["resolvedDisplayId"] = result["displayId"]
            json_output({"ok": True, "result": result})
            return 0
        if command == "zoom":
            resize = None
            if payload.get("targetWidth") and payload.get("targetHeight"):
                resize = (int(payload["targetWidth"]), int(payload["targetHeight"]))
            region = {
                "left": int(payload["x"]),
                "top": int(payload["y"]),
                "width": int(payload["width"]),
                "height": int(payload["height"]),
            }
            json_output({"ok": True, "result": capture_region(region, resize)})
            return 0
        if command == "prepare_for_action":
            json_output({"ok": True, "result": prepare_for_action(list(payload.get("allowlistBundleIds") or []))})
            return 0
        if command == "preview_hide_set":
            json_output({"ok": True, "result": []})
            return 0
        if command == "find_window_displays":
            json_output({"ok": True, "result": find_window_displays(list(payload.get("bundleIds") or []))})
            return 0
        if command == "key":
            key_action(str(payload["keySequence"]), int(payload.get("repeat") or 1))
            json_output({"ok": True, "result": True})
            return 0
        if command == "hold_key":
            hold_keys(list(payload.get("keyNames") or []), int(payload.get("durationMs") or 0))
            json_output({"ok": True, "result": True})
            return 0
        if command == "type":
            type_text(str(payload.get("text") or ""))
            json_output({"ok": True, "result": True})
            return 0
        if command == "click":
            click(int(payload["x"]), int(payload["y"]), str(payload.get("button") or "left"), int(payload.get("count") or 1), payload.get("modifiers"))
            json_output({"ok": True, "result": True})
            return 0
        if command == "drag":
            from_point = payload.get("from")
            if from_point:
                pyautogui.moveTo(int(from_point["x"]), int(from_point["y"]))
            pyautogui.dragTo(int(payload["to"]["x"]), int(payload["to"]["y"]), duration=0.2, button="left")
            json_output({"ok": True, "result": True})
            return 0
        if command == "move_mouse":
            pyautogui.moveTo(int(payload["x"]), int(payload["y"]))
            json_output({"ok": True, "result": True})
            return 0
        if command == "scroll":
            scroll(int(payload["x"]), int(payload["y"]), int(payload.get("deltaX") or 0), int(payload.get("deltaY") or 0))
            json_output({"ok": True, "result": True})
            return 0
        if command == "mouse_down":
            pyautogui.mouseDown(button="left")
            json_output({"ok": True, "result": True})
            return 0
        if command == "mouse_up":
            pyautogui.mouseUp(button="left")
            json_output({"ok": True, "result": True})
            return 0
        if command == "cursor_position":
            x, y = pyautogui.position()
            json_output({"ok": True, "result": {"x": int(x), "y": int(y)}})
            return 0
        if command == "frontmost_app":
            json_output({"ok": True, "result": frontmost_app()})
            return 0
        if command == "app_under_point":
            json_output({"ok": True, "result": app_under_point(int(payload["x"]), int(payload["y"]))})
            return 0
        if command == "observe_desktop":
            json_output({"ok": True, "result": observe_desktop(
                list(payload.get("allowedBundleIds") or []),
                payload.get("displayId"),
                int(payload.get("maxElements") or 120),
            )})
            return 0
        if command == "click_ui_element":
            click_ui_element(str(payload["elementId"]))
            json_output({"ok": True, "result": True})
            return 0
        if command == "focus_ui_element":
            focus_ui_element(str(payload["elementId"]))
            json_output({"ok": True, "result": True})
            return 0
        if command == "set_ui_element_value":
            json_output({"ok": True, "result": set_ui_element_value(
                str(payload["elementId"]),
                str(payload.get("text") or ""),
            )})
            return 0
        if command == "list_installed_apps":
            json_output({"ok": True, "result": installed_apps()})
            return 0
        if command == "get_app_icons":
            json_output({"ok": True, "result": app_icons(list(payload.get("apps") or []))})
            return 0
        if command == "list_running_apps":
            json_output({"ok": True, "result": running_apps()})
            return 0
        if command == "open_app":
            json_output({"ok": True, "result": open_app(str(payload["bundleId"]))})
            return 0
        if command == "run_desktop_intent":
            json_output({"ok": True, "result": run_desktop_intent(payload)})
            return 0
        if command == "read_clipboard":
            json_output({"ok": True, "result": read_clipboard()})
            return 0
        if command == "write_clipboard":
            write_clipboard(str(payload.get("text") or ""))
            json_output({"ok": True, "result": True})
            return 0
        if command == "paste_clipboard":
            paste_clipboard()
            json_output({"ok": True, "result": True})
            return 0
        error_output(f"Unknown command: {command}", code="bad_command")
        return 2
    except Exception as exc:
        error_output(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
