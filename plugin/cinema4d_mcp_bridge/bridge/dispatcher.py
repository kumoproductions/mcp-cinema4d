"""Main-thread dispatcher for bridge commands.

The TCP server runs on background threads and cannot touch ``c4d`` APIs
directly. Each incoming request is wrapped in a ``PendingCommand`` and queued;
``CoreMessage`` pops commands on the main thread, runs the handler, and sets
the result on the caller's Event so the TCP thread can resume and reply.
"""

from __future__ import annotations

import queue
import threading
import traceback
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import c4d

from .log import log

HandlerFn = Callable[[dict[str, Any]], Any]


@dataclass
class PendingCommand:
    command: str
    params: dict[str, Any]
    event: threading.Event = field(default_factory=threading.Event)
    result: Any = None
    error: str | None = None
    cancelled: bool = False


class Dispatcher:
    """Thread-safe queue of commands to be executed on C4D's main thread."""

    def __init__(self, plugin_id: int, handlers: dict[str, HandlerFn]):
        self._plugin_id = plugin_id
        self._handlers = handlers
        self._queue: queue.Queue[PendingCommand] = queue.Queue()

    def submit(self, command: str, params: dict[str, Any], timeout: float = 60.0) -> PendingCommand:
        """Called from TCP threads. Blocks until the main thread processes it.

        On timeout the pending entry is marked ``cancelled`` so the main thread
        skips it if it has not started yet. **Handlers already running cannot
        be aborted** — their side effects on the active document persist even
        after the caller has received a timeout error.
        """
        pending = PendingCommand(command=command, params=params)
        self._queue.put(pending)
        log(f"queued command={command}; firing SpecialEventAdd({self._plugin_id})")
        c4d.SpecialEventAdd(self._plugin_id)
        finished = pending.event.wait(timeout=timeout)
        if not finished:
            # Mark cancelled so the main thread skips the handler if it hasn't
            # started yet. If it already started, the result is discarded when
            # the TCP side has already returned an error to the caller.
            pending.cancelled = True
            pending.error = f"command '{command}' timed out after {timeout}s on C4D main thread"
            log(f"TIMEOUT waiting for main thread to process {command}")
        return pending

    def drain(self) -> None:
        """Called from CoreMessage on the main thread. Runs queued handlers."""
        count = 0
        while True:
            try:
                pending = self._queue.get_nowait()
            except queue.Empty:
                if count:
                    log(f"drained {count} command(s)")
                return
            count += 1
            if pending.cancelled:
                log(f"skipping cancelled command: {pending.command}")
                pending.event.set()
                continue
            self._run_one(pending)

    def _run_one(self, pending: PendingCommand) -> None:
        handler = self._handlers.get(pending.command)
        if handler is None:
            pending.error = f"unknown command: {pending.command}"
            pending.event.set()
            return
        try:
            pending.result = handler(pending.params or {})
        except Exception as exc:
            # Return only the short form to the client — tracebacks include
            # absolute filesystem paths, user names, and scene paths that the
            # MCP client then forwards to the upstream LLM provider. The full
            # traceback stays in the local bridge log for debugging.
            pending.error = f"{type(exc).__name__}: {exc}"
            log(f"handler {pending.command!r} raised:\n{traceback.format_exc()}")
        finally:
            pending.event.set()
