"""Toggle AVA Core/Desk from the laptop Copilot/launch key."""
from __future__ import annotations

import ctypes
import json
import os
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PYTHONW = ROOT / ".venv" / "Scripts" / "pythonw.exe"
START_DESK = ROOT / "windows" / "start_desk.py"
PURGE = Path.home() / "RootRecord Core Ops" / "WatchDog" / "operator_purge.py"
DESK_STATE = ROOT / "data" / "state" / "desk-ui.json"
TRACE = ROOT / "data" / "logs" / "ava-copilot-key.log"
CREATE_NO_WINDOW = 0x08000000
MOD_NOREPEAT = 0x4000
WM_HOTKEY = 0x0312
WM_QUIT = 0x0012
ERROR_ALREADY_EXISTS = 183
WH_KEYBOARD_LL = 13
WM_KEYDOWN = 0x0100
WM_SYSKEYDOWN = 0x0104
WM_KEYUP = 0x0101
WM_SYSKEYUP = 0x0105
VK_LWIN = 0x5B
VK_RWIN = 0x5C
VK_LAUNCH_APP1 = 0xB6
VK_LAUNCH_APP2 = 0xB7


class MSG(ctypes.Structure):
    _fields_ = [
        ("hwnd", ctypes.c_void_p),
        ("message", ctypes.c_uint),
        ("wParam", ctypes.c_size_t),
        ("lParam", ctypes.c_ssize_t),
        ("time", ctypes.c_uint),
        ("pt_x", ctypes.c_long),
        ("pt_y", ctypes.c_long),
    ]


class KEYBOARD_INPUT(ctypes.Structure):
    _fields_ = [
        ("vk_code", ctypes.c_uint32),
        ("scan_code", ctypes.c_uint32),
        ("flags", ctypes.c_uint32),
        ("time", ctypes.c_uint32),
        ("extra_info", ctypes.c_void_p),
    ]


def hidden_startup() -> subprocess.STARTUPINFO:
    info = subprocess.STARTUPINFO()
    info.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    info.wShowWindow = 0
    return info


def ava_is_up() -> bool:
    try:
        import urllib.request

        with urllib.request.urlopen("http://127.0.0.1:8787/health", timeout=1) as response:
            return response.status == 200
    except Exception:
        return False


def set_start_on_launch(enabled: bool) -> None:
    try:
        state = json.loads(DESK_STATE.read_text(encoding="utf-8")) if DESK_STATE.is_file() else {}
        state["startAvaOnLaunch"] = enabled
        DESK_STATE.parent.mkdir(parents=True, exist_ok=True)
        DESK_STATE.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    except (OSError, ValueError):
        pass


def toggle() -> None:
    pythonw = str(PYTHONW if PYTHONW.is_file() else "pythonw")
    if ava_is_up():
        subprocess.Popen(
            [pythonw, str(PURGE), "--json"],
            cwd=str(ROOT),
            creationflags=CREATE_NO_WINDOW,
            startupinfo=hidden_startup(),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return
    set_start_on_launch(True)
    subprocess.Popen(
        [pythonw, str(START_DESK)],
        cwd=str(ROOT),
        creationflags=CREATE_NO_WINDOW,
        startupinfo=hidden_startup(),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def trace(text: str) -> None:
    try:
        TRACE.parent.mkdir(parents=True, exist_ok=True)
        with TRACE.open("a", encoding="utf-8") as handle:
            handle.write(f"{time.time():.3f} {text}\n")
    except OSError:
        pass


def main() -> int:
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    user32.SetWindowsHookExW.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint32]
    user32.SetWindowsHookExW.restype = ctypes.c_void_p
    user32.CallNextHookEx.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_size_t, ctypes.c_void_p]
    user32.CallNextHookEx.restype = ctypes.c_long
    user32.UnhookWindowsHookEx.argtypes = [ctypes.c_void_p]
    kernel32.GetModuleHandleW.argtypes = [ctypes.c_wchar_p]
    kernel32.GetModuleHandleW.restype = ctypes.c_void_p
    mutex = kernel32.CreateMutexW(None, False, "Global\\AvaCopilotToggleListener")
    if not mutex or kernel32.GetLastError() == ERROR_ALREADY_EXISTS:
        return 0

    hook_proc_type = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_int, ctypes.c_size_t, ctypes.c_void_p)
    hook_handle = None
    last_toggle = 0.0
    win_down = set()
    copilot_key = (VK_LWIN, VK_LWIN, 1)

    @hook_proc_type
    def keyboard_hook(code, message, data):
        nonlocal last_toggle
        if code >= 0 and message in (WM_KEYDOWN, WM_SYSKEYDOWN, WM_KEYUP, WM_SYSKEYUP):
            event = ctypes.cast(data, ctypes.POINTER(KEYBOARD_INPUT)).contents
            key = event.vk_code
            is_copilot_key = (key, event.scan_code, event.flags) == copilot_key
            if is_copilot_key:
                if message in (WM_KEYDOWN, WM_SYSKEYDOWN):
                    now = time.monotonic()
                    if now - last_toggle > 0.5:
                        last_toggle = now
                        trace("copilot hardware key")
                        toggle()
                return 1
            if message in (WM_KEYUP, WM_SYSKEYUP):
                win_down.discard(key)
                return user32.CallNextHookEx(hook_handle, code, message, data)
            if key in (VK_LWIN, VK_RWIN):
                win_down.add(key)
            if key in (VK_LWIN, VK_RWIN, VK_LAUNCH_APP1, VK_LAUNCH_APP2, 0x43):
                trace(f"key={key} scan={event.scan_code} flags={event.flags} win_down={sorted(win_down)}")
            if key in (VK_LAUNCH_APP1, VK_LAUNCH_APP2) or (key == 0x43 and win_down):
                now = time.monotonic()
                if now - last_toggle > 0.5:
                    last_toggle = now
                    toggle()
                return 1
        return user32.CallNextHookEx(hook_handle, code, message, data)

    hook_handle = user32.SetWindowsHookExW(WH_KEYBOARD_LL, keyboard_hook, kernel32.GetModuleHandleW(None), 0)
    if not hook_handle:
        kernel32.CloseHandle(mutex)
        return 2
    message = MSG()
    try:
        while user32.GetMessageW(ctypes.byref(message), None, 0, 0) > 0:
            user32.TranslateMessage(ctypes.byref(message))
            user32.DispatchMessageW(ctypes.byref(message))
    finally:
        user32.UnhookWindowsHookEx(hook_handle)
        kernel32.CloseHandle(mutex)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
