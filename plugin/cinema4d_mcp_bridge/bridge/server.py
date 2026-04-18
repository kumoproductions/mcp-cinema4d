"""TCP server thread for the Cinema 4D MCP bridge.

Listens on a TCP port, reads newline-delimited JSON requests from each client,
hands them to the :class:`Dispatcher` for main-thread execution, and writes
the JSON response back on the same connection.
"""

from __future__ import annotations

import contextlib
import hmac
import json
import os
import socket
import threading

from .dispatcher import Dispatcher
from .handlers._helpers import _json_safe
from .log import log

_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "::1", "localhost"})
_TRUTHY = frozenset({"1", "true", "yes", "on"})

# Hard cap on a single JSON-Lines request. The bridge is behind token auth
# and a loopback default, but an authenticated misbehaving client could still
# OOM the plugin by sending a never-terminated line. The cap is intentionally
# generous — real set_mesh payloads for multi-million-vertex meshes can run
# into the hundreds of megabytes once JSON-encoded, and we'd rather let those
# through than block legitimate VFX work. This is a safety net against stuck
# or runaway clients, not a throughput limit.
_MAX_LINE_BYTES = 256 * 1024 * 1024


class BridgeServer:
    def __init__(
        self,
        dispatcher: Dispatcher,
        host: str = "127.0.0.1",
        port: int = 18710,
        token: str | None = None,
    ):
        self._dispatcher = dispatcher
        self._host = host
        self._port = port
        self._token = token or None
        self._server_socket: socket.socket | None = None
        self._accept_thread: threading.Thread | None = None
        self._stop_event = threading.Event()

    def start(self) -> None:
        if self._accept_thread and self._accept_thread.is_alive():
            return
        # Refuse to expose the bridge on a non-loopback interface unless the
        # operator explicitly opted in. exec_python = arbitrary code execution,
        # so accidental 0.0.0.0 binds are catastrophic.
        if self._host not in _LOOPBACK_HOSTS:
            allow = os.environ.get("C4D_MCP_ALLOW_REMOTE", "").strip().lower() in _TRUTHY
            if not allow:
                log(
                    f"refusing to bind to non-loopback host {self._host!r} without "
                    f"C4D_MCP_ALLOW_REMOTE=1. The bridge will not start."
                )
                return
        self._stop_event.clear()
        self._server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._server_socket.bind((self._host, self._port))
        self._server_socket.listen(8)
        self._server_socket.settimeout(1.0)
        self._accept_thread = threading.Thread(
            target=self._accept_loop, name="c4d-mcp-bridge-accept", daemon=True
        )
        self._accept_thread.start()
        auth_note = " (token auth enabled)" if self._token else ""
        log(f"listening on {self._host}:{self._port}{auth_note}")

    def stop(self) -> None:
        self._stop_event.set()
        if self._server_socket is not None:
            with contextlib.suppress(OSError):
                self._server_socket.close()
            self._server_socket = None
        if self._accept_thread is not None:
            self._accept_thread.join(timeout=2.0)
            self._accept_thread = None

    def _accept_loop(self) -> None:
        server = self._server_socket
        assert server is not None
        while not self._stop_event.is_set():
            try:
                client_socket, addr = server.accept()
            except TimeoutError:
                continue
            except OSError:
                break
            log(f"accepted connection from {addr}")
            threading.Thread(
                target=self._client_loop,
                args=(client_socket, addr),
                name=f"c4d-mcp-bridge-client-{addr[1]}",
                daemon=True,
            ).start()

    def _client_loop(self, client_socket: socket.socket, addr) -> None:
        client_socket.settimeout(None)
        buffer = b""
        try:
            while not self._stop_event.is_set():
                chunk = client_socket.recv(4096)
                if not chunk:
                    log(f"client {addr} disconnected")
                    break
                log(f"recv {len(chunk)} bytes from {addr}")
                buffer += chunk
                # Guard against an authenticated caller that never sends a
                # newline: without this cap the buffer grows until the C4D
                # process runs out of memory.
                if len(buffer) > _MAX_LINE_BYTES and b"\n" not in buffer:
                    log(
                        f"client {addr} sent >{_MAX_LINE_BYTES} bytes without a "
                        f"newline; dropping connection"
                    )
                    return
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    line = line.strip()
                    if not line:
                        continue
                    if len(line) > _MAX_LINE_BYTES:
                        log(
                            f"client {addr} sent oversized line "
                            f"({len(line)} > {_MAX_LINE_BYTES}); rejecting"
                        )
                        response_bytes = self._encode(
                            {
                                "id": "",
                                "status": "error",
                                "error": f"request exceeds {_MAX_LINE_BYTES}-byte limit",
                            }
                        )
                    else:
                        # Don't log the raw line — it may contain C4D_MCP_TOKEN.
                        # The dispatcher logs the command name once parsed.
                        response_bytes = self._handle_line(line)
                    log(f"sending {len(response_bytes)} bytes back to {addr}")
                    try:
                        client_socket.sendall(response_bytes)
                    except OSError as exc:
                        log(f"sendall failed: {exc}")
                        return
        except OSError as exc:
            log(f"client loop OSError: {exc}")
        finally:
            with contextlib.suppress(OSError):
                client_socket.close()

    def _handle_line(self, line: bytes) -> bytes:
        try:
            msg = json.loads(line.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            return self._encode({"id": "", "status": "error", "error": f"malformed request: {exc}"})

        request_id = msg.get("id", "")

        # Auth gate runs before command dispatch so unauthenticated callers
        # can't probe which commands exist.
        if self._token:
            provided = msg.get("token", "")
            if not isinstance(provided, str) or not hmac.compare_digest(provided, self._token):
                return self._encode(
                    {
                        "id": request_id,
                        "status": "error",
                        "error": "authentication required: missing or invalid token",
                    }
                )

        command = msg.get("command", "")
        params = msg.get("params", {}) or {}

        if not isinstance(command, str) or not command:
            return self._encode(
                {"id": request_id, "status": "error", "error": "missing 'command' field"}
            )

        pending = self._dispatcher.submit(command, params)
        if pending.error:
            return self._encode({"id": request_id, "status": "error", "error": pending.error})
        return self._encode({"id": request_id, "status": "ok", "result": pending.result})

    @staticmethod
    def _encode(payload) -> bytes:
        # Sanitize via _json_safe so C4D objects don't leak through as repr().
        return (json.dumps(_json_safe(payload)) + "\n").encode("utf-8")
