"""Cinema 4D MCP Bridge plugin.

Starts a TCP server on plugin load (default 127.0.0.1:18710) that accepts
JSON-Lines commands from an external MCP server and dispatches them to C4D's
main thread via ``c4d.SpecialEventAdd`` + ``CoreMessage``.
"""

import os
import sys
import traceback

import c4d
from c4d import plugins

print("[cinema4d_mcp_bridge] module loading...")

_PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
if _PLUGIN_DIR not in sys.path:
    sys.path.insert(0, _PLUGIN_DIR)

try:
    from bridge.dispatcher import Dispatcher
    from bridge.handlers import HANDLERS
    from bridge.server import BridgeServer
except Exception:
    print("[cinema4d_mcp_bridge] failed to import bridge package:")
    traceback.print_exc()
    raise


PLUGIN_ID = 1068169  # Maxon-registered id for cinema4d-mcp (plugincafe.maxon.net)
PLUGIN_NAME = "MCP Bridge"
DEFAULT_PORT = 18710


class MCPBridgePlugin(plugins.MessageData):
    def __init__(self):
        self._dispatcher = Dispatcher(PLUGIN_ID, HANDLERS)
        # Prefer unified C4D_MCP_* envvars so one setting covers both sides.
        # Legacy C4D_MCP_BRIDGE_* names are accepted as fallbacks.
        port = int(
            os.environ.get("C4D_MCP_PORT") or os.environ.get("C4D_MCP_BRIDGE_PORT") or DEFAULT_PORT
        )
        host = (
            os.environ.get("C4D_MCP_HOST") or os.environ.get("C4D_MCP_BRIDGE_HOST") or "127.0.0.1"
        )
        token = (os.environ.get("C4D_MCP_TOKEN") or "").strip() or None
        self._server = BridgeServer(self._dispatcher, host=host, port=port, token=token)

    def CoreMessage(self, msg_id, bc):
        if msg_id == PLUGIN_ID:
            from bridge.log import log as _log

            _log(f"CoreMessage fired with PLUGIN_ID={msg_id}")
            self._dispatcher.drain()
        return True


_plugin_instance = None


def _register():
    global _plugin_instance
    try:
        _plugin_instance = MCPBridgePlugin()
        ok = plugins.RegisterMessagePlugin(
            id=PLUGIN_ID,
            str=PLUGIN_NAME,
            info=0,
            dat=_plugin_instance,
        )
        if not ok:
            print("[cinema4d_mcp_bridge] RegisterMessagePlugin failed")
            return
        _plugin_instance._server.start()
        print("[cinema4d_mcp_bridge] Loaded")
    except Exception:
        print("[cinema4d_mcp_bridge] failed to register plugin:")
        traceback.print_exc()


def PluginMessage(msg_id, data):
    if msg_id == c4d.C4DPL_ENDPROGRAM:
        if _plugin_instance is not None:
            _plugin_instance._server.stop()
        return True
    return False


if __name__ == "__main__":
    _register()
