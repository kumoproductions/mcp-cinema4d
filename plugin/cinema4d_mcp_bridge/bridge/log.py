"""Thread-safe logger for the bridge plugin.

Writes to both stdout and a file in the OS temp dir so that background-thread
messages are visible even if the C4D Script Console swallows them.
"""

from __future__ import annotations

import os
import sys
import tempfile
import threading
import time

_LOG_PATH = os.path.join(tempfile.gettempdir(), "cinema4d_mcp_bridge.log")
_LOCK = threading.Lock()


def log_path() -> str:
    return _LOG_PATH


def log(msg: str) -> None:
    ts = time.strftime("%H:%M:%S")
    line = f"[{ts}] [cinema4d_mcp_bridge] {msg}"
    with _LOCK:
        try:
            sys.stdout.write(line + "\n")
            sys.stdout.flush()
        except Exception:
            pass
        try:
            with open(_LOG_PATH, "a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        except Exception:
            pass
