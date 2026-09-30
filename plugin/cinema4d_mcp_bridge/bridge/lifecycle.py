"""Process lifecycle for multi-instance mode: the ``quit`` command.

``quit`` exists so the MCP server's ``stop_instance`` can shut down a Cinema 4D
process it launched without resorting to killing it. It is gated on
``C4D_MCP_ENABLE_MULTIINSTANCE`` in *this* process's environment: an instance
started by ``launch_instance`` inherits the flag from the server, while the
operator's own Cinema 4D does not have it unless they set it deliberately —
so a bridge can never be told to quit the artist's session by accident.
"""

from __future__ import annotations

import os
import threading
from typing import Any

import c4d
from c4d import documents

from .log import log

_TRUTHY = frozenset({"1", "true", "yes", "on"})

# Cinema 4D's own File > Quit command. With no modified document open it
# exits without prompting.
_QUIT_COMMAND_ID = 12104
# Give the response time to leave the TCP thread before the main thread
# tears the process down; SpecialEventAdd is thread-safe, so a Timer can
# schedule the CoreMessage that performs the quit.
_QUIT_DELAY_SECONDS = 0.5
# If Quit is intercepted (a modal dialog, a plugin refusing shutdown) the
# process would linger with a bridge that already promised to exit. Exit
# hard after this grace period instead. A normal shutdown with render
# plugins loaded takes well over 5 s, and cutting it short with os._exit
# registers as a crash (bug report + crash prompt on the next start), so
# the grace has to be generous.
_HARD_EXIT_SECONDS = 45.0

_plugin_id: int | None = None
_quit_pending = False
_lock = threading.Lock()


def configure(plugin_id: int) -> None:
    """Record the message id used to wake the main thread (called from the .pyp)."""
    global _plugin_id
    _plugin_id = plugin_id


def multi_instance_enabled() -> bool:
    flag = os.environ.get("C4D_MCP_ENABLE_MULTIINSTANCE", "")
    return flag.strip().lower() in _TRUTHY


def handle_quit(_params: dict[str, Any]) -> dict[str, Any]:
    """Schedule a quit of this Cinema 4D process after the reply is sent."""
    if not multi_instance_enabled():
        raise RuntimeError(
            "quit is disabled on this C4D instance (C4D_MCP_ENABLE_MULTIINSTANCE is not set "
            "in its launch environment). Only instances started with the flag — e.g. via "
            "launch_instance — accept it."
        )
    global _quit_pending
    with _lock:
        _quit_pending = True
    if _plugin_id is not None:
        _daemon_timer(_QUIT_DELAY_SECONDS, c4d.SpecialEventAdd, _plugin_id).start()
    log("quit requested; exiting after this reply is sent")
    return {"quitting": True, "pid": os.getpid()}


def perform_pending_quit() -> None:
    """Main thread only (CoreMessage): run the quit scheduled by ``handle_quit``."""
    global _quit_pending
    with _lock:
        if not _quit_pending:
            return
        _quit_pending = False
    log("quit: discarding open documents and exiting Cinema 4D")
    # Quit prompts to save every modified document, and a prompt would hang a
    # headless-driven instance forever. Park a fresh, untouched document as
    # the active one and drop the rest, so there is nothing left to ask about.
    fresh = documents.BaseDocument()
    documents.InsertBaseDocument(fresh)
    documents.SetActiveDocument(fresh)
    doc = documents.GetFirstDocument()
    while doc is not None:
        nxt = doc.GetNext()
        if doc != fresh:
            documents.KillDocument(doc)
        doc = nxt
    _daemon_timer(_HARD_EXIT_SECONDS, _hard_exit).start()
    c4d.CallCommand(_QUIT_COMMAND_ID)


def _daemon_timer(seconds: float, fn, *args) -> threading.Timer:
    """A Timer that interpreter shutdown does not wait for.

    Quit ends with Cinema 4D finalizing its embedded Python, and finalization
    joins every non-daemon thread. A plain Timer therefore stalls the shutdown
    until it fires, and the os._exit it then runs lands in the middle of
    teardown, which Cinema 4D records as a crash.
    """
    timer = threading.Timer(seconds, fn, args=args)
    timer.daemon = True
    return timer


def _hard_exit() -> None:
    log(f"quit: still alive {_HARD_EXIT_SECONDS}s after Quit; exiting the process")
    os._exit(0)
