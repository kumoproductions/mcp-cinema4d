"""Xpresso (classic GvNodeMaster) graph handlers.

Separate from ``node_materials`` because Xpresso predates the Maxon nodes
framework: it uses ``c4d.modules.graphview.GvNodeMaster`` / ``GvNode`` /
``GvPort`` — the classic C API — rather than ``maxon.GraphDescription``.

The declarative builder mirrors ``apply_graph_description`` in spirit
(create nodes by caller-chosen id, then wire connections in a second pass)
but uses Xpresso-native primitives underneath. Nodes are addressed after
creation via a stable path id like ``"0.2"`` (= root's first child, its
third child) returned by ``list_xpresso_nodes``.
"""

from __future__ import annotations

import contextlib
from typing import Any

import c4d
from c4d import documents
from c4d.modules import graphview

from ._helpers import (
    _ensure_python_operator_id_allowed,
    _find_object,
    _find_object_by_path,
    _find_tag,
    _json_safe,
    _resolve_handle,
)

# ---------------------------------------------------------------------------
# Operator id aliases
# ---------------------------------------------------------------------------

# Short-name aliases for the most common GvNode operator ids. Resolved through
# getattr so older C4D builds that don't expose every ID_OPERATOR_* constant
# fail with a readable error at the call site rather than at import time.
_OPERATOR_ALIASES: dict[str, str] = {
    "object": "ID_OPERATOR_OBJECT",
    "const": "ID_OPERATOR_CONST",
    "result": "ID_OPERATOR_RESULT",
    "math": "ID_OPERATOR_MATH",
    "range_mapper": "ID_OPERATOR_RANGEMAPPER",
    "rangemapper": "ID_OPERATOR_RANGEMAPPER",
    "condition": "ID_OPERATOR_CONDITION",
    "compare": "ID_OPERATOR_COMPARE",
    "memory": "ID_OPERATOR_MEMORY",
    "iterate": "ID_OPERATOR_ITERATE",
    "bool": "ID_OPERATOR_BOOL",
    "freeze": "ID_OPERATOR_FREEZE",
    "formula": "ID_OPERATOR_FORMULA",
    "vector": "ID_OPERATOR_REALTOVECT",
    "realtovect": "ID_OPERATOR_REALTOVECT",
    "vecttoreal": "ID_OPERATOR_VECTTOREAL",
    "matrix": "ID_OPERATOR_MATRIX2VECT",
    "matrix2vect": "ID_OPERATOR_MATRIX2VECT",
    "vect2matrix": "ID_OPERATOR_VECT2MATRIX",
    "link": "ID_OPERATOR_LINK",
    "spy": "ID_OPERATOR_SPY",
    "python": "ID_OPERATOR_PYTHON",
}


def _resolve_operator_id(spec: Any) -> int:
    """Return an integer GvNode operator id from int or alias string."""
    if isinstance(spec, bool) or not isinstance(spec, (int, str)):
        raise ValueError(f"operator_id must be int or alias string, got {type(spec).__name__}")
    if isinstance(spec, int):
        return int(spec)
    key = spec.strip().lower()
    const_name = _OPERATOR_ALIASES.get(key)
    if const_name is None:
        # Allow a raw-number-as-string passthrough for discoverability.
        if key.isdigit():
            return int(key)
        raise ValueError(
            f"unknown operator alias {spec!r}; accepted: {sorted(_OPERATOR_ALIASES)} "
            "(or pass a numeric ID_OPERATOR_* int)"
        )
    value = getattr(c4d, const_name, None)
    if value is None:
        raise RuntimeError(
            f"C4D build does not expose c4d.{const_name}; pass a numeric operator_id instead"
        )
    return int(value)


# ---------------------------------------------------------------------------
# Tag / node resolution
# ---------------------------------------------------------------------------


def _resolve_xpresso_tag(h: dict[str, Any], *, create_if_missing: bool = False):
    """Resolve or create an Xpresso tag from a handle.

    Accepts a ``tag`` handle (Texpresso) or an ``object`` handle (then
    picks the first Texpresso tag, or creates one when ``create_if_missing``
    is true). Returns the c4d.BaseTag.
    """
    if not isinstance(h, dict):
        raise ValueError("handle must be a dict")
    kind = h.get("kind")
    if kind == "tag":
        tag = _resolve_handle(h)
        if tag is None:
            raise ValueError(f"tag handle did not resolve: {h}")
        if tag.GetType() != c4d.Texpresso:
            raise ValueError(
                f"tag handle resolved to type {tag.GetType()}, expected Texpresso ({c4d.Texpresso})"
            )
        return tag
    if kind == "object":
        obj = _resolve_handle(h)
        if obj is None:
            raise ValueError(f"object handle did not resolve: {h}")
        existing = _find_tag(obj, type_id=c4d.Texpresso)
        if existing is not None:
            return existing
        if not create_if_missing:
            raise ValueError(
                f"object {obj.GetName()!r} has no Xpresso tag "
                "(pass create_tag_if_missing:true to create one)"
            )
        doc = documents.GetActiveDocument()
        if doc is not None:
            doc.AddUndo(c4d.UNDOTYPE_CHANGE, obj)
        tag = obj.MakeTag(c4d.Texpresso)
        if tag is None:
            raise RuntimeError(f"MakeTag(Texpresso) failed on {obj.GetName()!r}")
        return tag
    raise ValueError(f"expected tag or object handle for Xpresso target, got kind={kind!r}")


def _iter_top_children(parent) -> list:
    """Return the immediate child GvNodes under ``parent`` in order."""
    out = []
    child = parent.GetDown() if parent is not None else None
    while child is not None:
        out.append(child)
        child = child.GetNext()
    return out


def _node_by_path(root, path: str):
    """Walk ``root`` by dotted-index path (``"0.2.1"``) and return the node.

    Empty string / ``"root"`` returns ``root`` itself. Invalid segments or
    out-of-range indices return ``None``.
    """
    if root is None:
        return None
    if not path or path in ("root", "/"):
        return root
    node = root
    for seg in path.split("."):
        if not seg:
            return None
        try:
            idx = int(seg)
        except ValueError:
            return None
        if idx < 0:
            return None
        children = _iter_top_children(node)
        if idx >= len(children):
            return None
        node = children[idx]
    return node


def _find_node_by_name(root, name: str):
    """First-match DFS by GetName() under ``root``."""
    for child in _iter_top_children(root):
        if child.GetName() == name:
            return child
        hit = _find_node_by_name(child, name)
        if hit is not None:
            return hit
    return None


def _resolve_gv_node(tag, id_: str | None, name: str | None):
    """Locate a GvNode inside ``tag`` by path id or by name."""
    master = tag.GetNodeMaster()
    if master is None:
        raise RuntimeError("Xpresso tag has no NodeMaster")
    root = master.GetRoot()
    if root is None:
        raise RuntimeError("Xpresso tag NodeMaster has no root")
    if id_ is not None:
        node = _node_by_path(root, id_)
        if node is None:
            raise ValueError(f"no GvNode at path {id_!r} in Xpresso tag {tag.GetName()!r}")
        return node
    if name:
        node = _find_node_by_name(root, name)
        if node is None:
            raise ValueError(f"no GvNode named {name!r} in Xpresso tag {tag.GetName()!r}")
        return node
    raise ValueError("gv_node handle requires 'id' or 'name'")


# ---------------------------------------------------------------------------
# Port helpers
# ---------------------------------------------------------------------------


def _port_summary(port, node) -> dict[str, Any]:
    """JSON-safe summary of a single GvPort."""
    try:
        main_id = int(port.GetMainID())
    except Exception:
        main_id = None
    try:
        sub_id = int(port.GetSubID())
    except Exception:
        sub_id = None
    try:
        name = str(port.GetName(node) if node is not None else port.GetName())
    except Exception:
        try:
            name = str(port.GetName())
        except Exception:
            name = ""
    connected = False
    try:
        connected = bool(port.IsIncomingConnected()) or bool(port.GetDestination())
    except Exception:
        connected = False
    return {"main_id": main_id, "sub_id": sub_id, "name": name, "connected": connected}


def _in_ports(node) -> list:
    try:
        return list(node.GetInPorts() or [])
    except Exception:
        return []


def _out_ports(node) -> list:
    try:
        return list(node.GetOutPorts() or [])
    except Exception:
        return []


def _resolve_port(node, ref: dict[str, Any]):
    """Locate a GvPort on ``node`` given a selector dict.

    Selector priority: index > main_id > name. Returns the GvPort or
    raises a ValueError with a helpful summary.
    """
    if not isinstance(ref, dict):
        raise ValueError(f"port selector must be a dict, got {type(ref).__name__}")
    direction = ref.get("dir")
    if direction not in ("in", "out"):
        raise ValueError(f"port selector requires dir='in'|'out', got {direction!r}")
    ports = _in_ports(node) if direction == "in" else _out_ports(node)
    if "index" in ref and ref["index"] is not None:
        idx = int(ref["index"])
        if idx < 0 or idx >= len(ports):
            raise ValueError(
                f"port index {idx} out of range ({len(ports)} {direction} ports on node)"
            )
        return ports[idx]
    if "main_id" in ref and ref["main_id"] is not None:
        mid = int(ref["main_id"])
        matches = [p for p in ports if _safe_main_id(p) == mid]
        if not matches:
            raise ValueError(
                f"no {direction} port with main_id={mid} on node (available: "
                f"{[_safe_main_id(p) for p in ports]})"
            )
        sub = ref.get("sub_id")
        if sub is not None:
            sub = int(sub)
            matches = [p for p in matches if _safe_sub_id(p) == sub]
            if not matches:
                raise ValueError(f"no {direction} port with main_id={mid}, sub_id={sub}")
        return matches[0]
    if ref.get("name"):
        target = str(ref["name"])
        for p in ports:
            try:
                pname = str(p.GetName(node))
            except Exception:
                try:
                    pname = str(p.GetName())
                except Exception:
                    pname = ""
            if pname == target:
                return p
        raise ValueError(f"no {direction} port named {target!r} on node")
    raise ValueError("port selector requires one of: index, main_id, name")


def _safe_main_id(port) -> int | None:
    try:
        return int(port.GetMainID())
    except Exception:
        return None


def _safe_sub_id(port) -> int | None:
    try:
        return int(port.GetSubID())
    except Exception:
        return None


def _add_port(node, io: str, port_id: int, *, message: bool = True):
    """Thin wrapper around GvNode.AddPort with a common flag preset."""
    if io not in ("in", "out"):
        raise ValueError(f"io must be 'in' or 'out', got {io!r}")
    flag = getattr(c4d, "GV_PORT_FLAG_IS_VISIBLE", 0)
    direction = c4d.GV_PORT_INPUT if io == "in" else c4d.GV_PORT_OUTPUT
    port = node.AddPort(direction, int(port_id), flag, message)
    if port is None:
        raise RuntimeError(
            f"AddPort({io!r}, id={port_id}) returned None — id may not be valid for this operator"
        )
    return port


# ---------------------------------------------------------------------------
# Traversal
# ---------------------------------------------------------------------------


def _collect_gv_nodes(root) -> list[dict[str, Any]]:
    """Flat list of every GvNode under ``root`` with path ids."""
    out: list[dict[str, Any]] = []

    def walk(parent, parent_path: str) -> None:
        for idx, child in enumerate(_iter_top_children(parent)):
            path = f"{parent_path}.{idx}" if parent_path else str(idx)
            try:
                op_id = int(child.GetOperatorID())
            except Exception:
                op_id = None
            op_name = ""
            try:
                op_name = str(child.GetTypeName())
            except Exception:
                op_name = ""
            entry: dict[str, Any] = {
                "id": path,
                "parent_id": parent_path if parent_path else None,
                "name": child.GetName(),
                "operator_id": op_id,
                "operator_name": op_name,
                "is_group": bool(child.IsGroupNode()),
                "in_ports": [_port_summary(p, child) for p in _in_ports(child)],
                "out_ports": [_port_summary(p, child) for p in _out_ports(child)],
            }
            out.append(entry)
            if child.IsGroupNode():
                walk(child, path)

    walk(root, "")
    return out


# ---------------------------------------------------------------------------
# Public handlers
# ---------------------------------------------------------------------------


def handle_list_xpresso_nodes(params: dict[str, Any]) -> dict[str, Any]:
    """Walk an Xpresso tag's GvNodeMaster and return a flat node list.

    params:
      handle: tag handle (Texpresso) or object handle (uses the object's
              first Texpresso tag; errors if none exists).
    """
    h = params.get("handle")
    if not h:
        raise ValueError("handle required")
    tag = _resolve_xpresso_tag(h, create_if_missing=False)
    master = tag.GetNodeMaster()
    if master is None:
        raise RuntimeError("Xpresso tag has no NodeMaster")
    root = master.GetRoot()
    if root is None:
        return {
            "tag": {"kind": "tag", "object": tag.GetObject().GetName(), "type_id": c4d.Texpresso},
            "nodes": [],
        }
    owner = tag.GetObject()
    return {
        "tag": {
            "kind": "tag",
            "object": owner.GetName() if owner is not None else None,
            "type_id": c4d.Texpresso,
            "tag_name": tag.GetName() or None,
        },
        "nodes": _collect_gv_nodes(root),
    }


def _apply_operator_references(node, refs: dict[str, Any]) -> list[dict[str, Any]]:
    """Resolve each {param_id: object_spec} entry into a BaseLink on the node.

    Object specs accept either a string (object name or ``/A/B`` path) or a
    full object handle dict. Useful for XPresso Object nodes
    (GV_OBJECT_OBJECT_ID = 1001) and Link nodes that need BaseLink params —
    regular ``params`` doesn't cover BaseLink because MCP only carries
    JSON-safe values.
    """
    errors: list[dict[str, Any]] = []
    for raw_key, spec in refs.items():
        try:
            key = int(raw_key)
        except (TypeError, ValueError):
            errors.append({"key": raw_key, "error": "references key must be an int-like param id"})
            continue
        if isinstance(spec, str) and spec:
            ref_obj = _find_object_by_path(spec) if spec.startswith("/") else _find_object(spec)
        elif isinstance(spec, dict):
            try:
                ref_obj = _resolve_handle(spec)
            except Exception as exc:
                errors.append({"key": raw_key, "error": f"{type(exc).__name__}: {exc}"})
                continue
        else:
            errors.append(
                {"key": raw_key, "error": "references value must be a name string or handle dict"}
            )
            continue
        if ref_obj is None:
            errors.append({"key": raw_key, "error": f"reference {spec!r} not found"})
            continue
        try:
            node[key] = ref_obj
        except Exception as exc:
            errors.append({"key": raw_key, "error": f"{type(exc).__name__}: {exc}"})
    return errors


def _apply_operator_params(node, params_dict: dict[str, Any]) -> list[dict[str, Any]]:
    """Write entries from ``params_dict`` into a GvNode's operator container."""
    errors: list[dict[str, Any]] = []
    for raw_key, value in params_dict.items():
        try:
            key = int(raw_key) if not isinstance(raw_key, int) else raw_key
        except (TypeError, ValueError):
            errors.append({"key": raw_key, "error": "key must be an int-like value"})
            continue
        try:
            if (
                isinstance(value, (list, tuple))
                and len(value) == 3
                and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in value)
            ):
                coerced = c4d.Vector(float(value[0]), float(value[1]), float(value[2]))
            else:
                coerced = value
            node[key] = coerced
        except Exception as exc:
            errors.append({"key": raw_key, "error": f"{type(exc).__name__}: {exc}"})
    return errors


def handle_apply_xpresso_graph(params: dict[str, Any]) -> dict[str, Any]:
    """Declarative builder for an Xpresso graph.

    params:
      handle:                 tag or object handle for the Xpresso host
      create_tag_if_missing:  bool, default True. When ``handle`` is an
                              object handle and it has no Texpresso tag,
                              create one.
      nodes:   dict[str, {operator_id, name?, parent?, position?, params?,
                          in_ports?, out_ports?}]  — caller-chosen ids
      connect: list[{from: PortRef, to: PortRef}] — PortRefs reference
               caller ids (``{node, dir, index? main_id? name?}``) OR an
               existing node via its path id prefixed with ``"path:"``.
    """
    h = params.get("handle")
    if not h:
        raise ValueError("handle required")

    nodes_spec = params.get("nodes") or {}
    if not isinstance(nodes_spec, dict):
        raise ValueError("nodes must be a dict keyed by caller-chosen id")
    connect_spec = params.get("connect") or []
    if not isinstance(connect_spec, list):
        raise ValueError("connect must be a list of {from, to} entries")

    create_tag = bool(params.get("create_tag_if_missing", True))
    tag = _resolve_xpresso_tag(h, create_if_missing=create_tag)
    master = tag.GetNodeMaster()
    if master is None:
        raise RuntimeError("Xpresso tag has no NodeMaster")
    root = master.GetRoot()
    if root is None:
        raise RuntimeError("Xpresso tag NodeMaster has no root")

    doc = documents.GetActiveDocument()
    if doc is not None:
        doc.StartUndo()
        doc.AddUndo(c4d.UNDOTYPE_CHANGE, tag)

    created: dict[str, Any] = {}  # caller_id -> {node, path, parent_path, operator_id}
    per_node_errors: dict[str, list[dict[str, Any]]] = {}

    try:
        # --- Pass 1: create nodes --------------------------------------
        for caller_id, spec in nodes_spec.items():
            if not isinstance(spec, dict):
                raise ValueError(f"nodes[{caller_id!r}] must be an object spec")
            op_id = _resolve_operator_id(spec.get("operator_id"))
            # Gate the Python operator behind C4D_MCP_ENABLE_PYTHON_OPS — its
            # source-code parameter is RCE-equivalent to exec_python.
            _ensure_python_operator_id_allowed(op_id)
            # Resolve parent. "root" / None -> master root. Otherwise either
            # another caller id created earlier in this call, or a path id
            # to an existing group node.
            parent_ref = spec.get("parent")
            if parent_ref in (None, "", "root"):
                parent_node = root
                parent_path = ""
            elif parent_ref in created:
                parent_node = created[parent_ref]["node"]
                parent_path = created[parent_ref]["path"]
            else:
                parent_path = str(parent_ref)
                parent_node = _node_by_path(root, parent_path)
                if parent_node is None:
                    raise ValueError(
                        f"nodes[{caller_id!r}].parent {parent_ref!r} not found "
                        "(must be a sibling caller id or an existing path id)"
                    )
            pos = spec.get("position") or [-1, -1]
            if not (isinstance(pos, (list, tuple)) and len(pos) == 2):
                raise ValueError(f"nodes[{caller_id!r}].position must be [x, y]")
            # CreateNode appends the new child at the end of the parent's
            # child list; record that index up front. GvNode wrappers don't
            # compare by identity, so we can't re-derive the path by walking
            # back through GetUp() after the fact.
            child_index = len(_iter_top_children(parent_node))
            node = master.CreateNode(parent_node, op_id, x=int(pos[0]), y=int(pos[1]))
            if node is None:
                raise RuntimeError(
                    f"CreateNode failed for caller id {caller_id!r} "
                    f"(operator_id={op_id}). Check the id is valid."
                )
            path = str(child_index) if not parent_path else f"{parent_path}.{child_index}"
            name = spec.get("name")
            if isinstance(name, str) and name:
                node.SetName(name)

            # Add explicit extra ports if requested.
            for ip in spec.get("in_ports") or []:
                pid = int(ip["id"])
                port = _add_port(node, "in", pid)
                pname = ip.get("name")
                if isinstance(pname, str) and pname:
                    with contextlib.suppress(Exception):
                        port.SetName(pname)
            for op_port in spec.get("out_ports") or []:
                pid = int(op_port["id"])
                port = _add_port(node, "out", pid)
                pname = op_port.get("name")
                if isinstance(pname, str) and pname:
                    with contextlib.suppress(Exception):
                        port.SetName(pname)

            errors = _apply_operator_params(node, spec.get("params") or {})
            ref_errors = _apply_operator_references(node, spec.get("references") or {})
            if ref_errors:
                errors = (errors or []) + ref_errors
            if errors:
                per_node_errors[caller_id] = errors

            created[caller_id] = {
                "node": node,
                "path": path,
                "parent_path": parent_path,
                "operator_id": op_id,
            }

        # --- Pass 2: connect --------------------------------------------
        connections: list[dict[str, Any]] = []
        for entry in connect_spec:
            if not isinstance(entry, dict) or "from" not in entry or "to" not in entry:
                connections.append({"error": "entry must be {from, to}", "entry": entry})
                continue
            try:
                out_port = _resolve_endpoint(entry["from"], created, root, default_dir="out")
                in_port = _resolve_endpoint(entry["to"], created, root, default_dir="in")
            except Exception as exc:
                connections.append(
                    {
                        "error": f"{type(exc).__name__}: {exc}",
                        "from": entry.get("from"),
                        "to": entry.get("to"),
                    }
                )
                continue
            try:
                ok = bool(out_port.Connect(in_port))
            except Exception as exc:
                connections.append(
                    {
                        "error": f"{type(exc).__name__}: {exc}",
                        "from": entry.get("from"),
                        "to": entry.get("to"),
                    }
                )
                continue
            connections.append(
                {
                    "from": entry.get("from"),
                    "to": entry.get("to"),
                    "ok": ok,
                }
            )

        if doc is not None:
            with contextlib.suppress(Exception):
                master.AddUndo()
    finally:
        if doc is not None:
            doc.EndUndo()

    c4d.EventAdd()

    # Emit the path recorded at creation time. GvNode wrappers don't compare
    # by identity, so we can't re-derive paths by walking GetUp() — but
    # CreateNode appends to the end, so tracking the child index up front
    # is stable as long as nothing else mutates the graph during this call.
    result_nodes: dict[str, Any] = {}
    for caller_id, info in created.items():
        node = info["node"]
        entry: dict[str, Any] = {
            "id": info["path"],
            "operator_id": info["operator_id"],
        }
        try:
            entry["operator_name"] = str(node.GetTypeName())
        except Exception:
            entry["operator_name"] = ""
        if caller_id in per_node_errors:
            entry["param_errors"] = per_node_errors[caller_id]
        result_nodes[caller_id] = entry

    owner = tag.GetObject()
    return {
        "applied": True,
        "tag": {
            "kind": "tag",
            "object": owner.GetName() if owner is not None else None,
            "type_id": c4d.Texpresso,
            "tag_name": tag.GetName() or None,
        },
        "nodes": result_nodes,
        "connections": connections,
    }


def _resolve_endpoint(
    ref: Any,
    created: dict[str, Any],
    root,
    *,
    default_dir: str,
):
    """Turn an endpoint spec into a GvPort.

    Accepts either:
      - ``{node: caller_id|"path:0.1", dir: "in"|"out", index|main_id|name}``
      - shorthand ``{node: ..., index: N}`` — dir falls back to ``default_dir``
    """
    if not isinstance(ref, dict):
        raise ValueError(f"endpoint must be a dict, got {type(ref).__name__}")
    node_key = ref.get("node")
    if not node_key:
        raise ValueError("endpoint requires 'node'")
    if isinstance(node_key, str) and node_key.startswith("path:"):
        gv = _node_by_path(root, node_key[5:])
        if gv is None:
            raise ValueError(f"endpoint node path {node_key!r} not found")
    elif node_key in created:
        gv = created[node_key]["node"]
    else:
        # Try as a path directly.
        gv = _node_by_path(root, str(node_key))
        if gv is None:
            raise ValueError(
                f"endpoint node {node_key!r} is neither a caller id in this call "
                "nor a resolvable path (prefix with 'path:' to force path lookup)"
            )
    selector = dict(ref)
    selector.pop("node", None)
    if "dir" not in selector:
        selector["dir"] = default_dir
    return _resolve_port(gv, selector)


def handle_set_xpresso_port(params: dict[str, Any]) -> dict[str, Any]:
    """Low-level port edit: add / remove / connect / disconnect / set_value.

    params:
      node:     gv_node handle (or tag handle + id/name)
      action:   "add" | "remove" | "connect" | "disconnect" | "set_value"
      port:     PortRef for the acted-on port (required for remove, connect,
                disconnect, set_value)
      target:   PortRef on the peer node (required for connect)
      io:       "in" | "out" (required for add)
      port_id:  int (required for add — passed to GvNode.AddPort)
      value:    new default value for set_value
    """
    action = params.get("action")
    if action not in ("add", "remove", "connect", "disconnect", "set_value"):
        raise ValueError(f"unknown action {action!r}")
    node_handle = params.get("node")
    if not node_handle:
        raise ValueError("node handle required")
    node = _resolve_handle(node_handle)
    if node is None:
        raise ValueError(f"node handle did not resolve: {node_handle}")
    if not isinstance(node, graphview.GvNode):
        raise ValueError(f"node handle did not resolve to a GvNode (got {type(node).__name__})")

    doc = documents.GetActiveDocument()
    if doc is not None:
        doc.StartUndo()

    try:
        if action == "add":
            io = params.get("io")
            port_id = params.get("port_id")
            if io not in ("in", "out"):
                raise ValueError("add requires io='in'|'out'")
            if not isinstance(port_id, int):
                raise ValueError("add requires port_id (int)")
            port = _add_port(node, io, port_id)
            return {
                "action": "add",
                "port": _port_summary(port, node),
                "direction": io,
            }

        if action == "remove":
            port_ref = params.get("port")
            if not port_ref:
                raise ValueError("remove requires 'port' selector")
            port = _resolve_port(node, port_ref)
            ok = bool(node.RemovePort(port, message=True))
            return {"action": "remove", "removed": ok}

        if action == "connect":
            port_ref = params.get("port")
            target_ref = params.get("target")
            if not port_ref or not target_ref:
                raise ValueError("connect requires 'port' and 'target' selectors")
            port = _resolve_port(node, port_ref)
            # Target port lives on another node; the target selector must
            # include its own ``node`` handle.
            target_node_h = target_ref.get("node_handle")
            if not target_node_h:
                raise ValueError(
                    "connect.target requires 'node_handle' (gv_node handle) for the peer node"
                )
            target_node = _resolve_handle(target_node_h)
            if target_node is None or not isinstance(target_node, graphview.GvNode):
                raise ValueError("connect.target.node_handle did not resolve to a GvNode")
            target_selector = {k: v for k, v in target_ref.items() if k != "node_handle"}
            target_port = _resolve_port(target_node, target_selector)
            # Always Connect() from the output side to the input side. Flip
            # automatically based on the port's direction so callers can
            # specify the pair in either order.
            try:
                port_is_out = bool(port.GetIO() == c4d.GV_PORT_OUTPUT)
            except Exception:
                # Fall back to the selector's declared dir
                port_is_out = port_ref.get("dir") == "out"
            ok = bool(port.Connect(target_port)) if port_is_out else bool(target_port.Connect(port))
            return {"action": "connect", "connected": ok}

        if action == "disconnect":
            port_ref = params.get("port")
            if not port_ref:
                raise ValueError("disconnect requires 'port' selector")
            port = _resolve_port(node, port_ref)
            ok = bool(port.RemoveConnection())
            return {"action": "disconnect", "disconnected": ok}

        if action == "set_value":
            port_ref = params.get("port")
            if not port_ref:
                raise ValueError("set_value requires 'port' selector")
            if "value" not in params:
                raise ValueError("set_value requires 'value'")
            port = _resolve_port(node, port_ref)
            value = params["value"]
            if (
                isinstance(value, (list, tuple))
                and len(value) == 3
                and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in value)
            ):
                value = c4d.Vector(float(value[0]), float(value[1]), float(value[2]))
            ok = bool(port.SetValue(value))
            return {
                "action": "set_value",
                "applied": ok,
                "stored": _json_safe(port.GetValue()) if hasattr(port, "GetValue") else None,
            }

        raise AssertionError("unreachable")
    finally:
        if doc is not None:
            doc.EndUndo()
        c4d.EventAdd()


def handle_remove_xpresso_node(params: dict[str, Any]) -> dict[str, Any]:
    """Delete a GvNode by handle.

    params:
      handle: gv_node handle
    """
    h = params.get("handle")
    if not h:
        raise ValueError("handle required")
    node = _resolve_handle(h)
    if node is None:
        raise ValueError(f"handle did not resolve: {h}")
    if not isinstance(node, graphview.GvNode):
        raise ValueError(f"handle did not resolve to a GvNode (got {type(node).__name__})")

    master = node.GetNodeMaster()
    if master is None:
        raise RuntimeError("GvNode has no NodeMaster")

    doc = documents.GetActiveDocument()
    if doc is not None:
        doc.StartUndo()
    try:
        try:
            node.Remove()
            with contextlib.suppress(Exception):
                master.AddUndo()
            removed = True
        except Exception as exc:
            raise RuntimeError(f"{type(exc).__name__}: {exc}") from exc
    finally:
        if doc is not None:
            doc.EndUndo()
    c4d.EventAdd()
    return {"removed": removed}
