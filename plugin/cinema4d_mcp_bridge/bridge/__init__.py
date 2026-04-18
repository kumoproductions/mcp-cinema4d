"""Cinema 4D MCP bridge package.

Runs a TCP server inside Cinema 4D that accepts JSON-Lines commands from an
external MCP server process, dispatches them onto the main thread via
``c4d.SpecialEventAdd``, and returns results back to the client.
"""

from .dispatcher import Dispatcher
from .server import BridgeServer

__all__ = ["BridgeServer", "Dispatcher"]
