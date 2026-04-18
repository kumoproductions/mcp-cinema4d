"""Node-material handlers: list / apply-description / set-port / remove.

Works on ``c4d.NodeMaterial`` instances — modern Standard / Redshift node
materials exposed via the Maxon nodes framework. We lean on
``maxon.GraphDescription`` for mutations (declarative, stable API) and a
``GetRoot`` / ``GetChildren`` traversal for read-side listing.

A best-effort ``node_space`` alias resolver accepts "standard" and
"redshift" (with a raw fully-qualified maxon.Id passthrough for anything
else). Materials that don't expose a nodes graph return ``supported: False``
instead of raising, so callers can gracefully degrade.
"""

from __future__ import annotations

import contextlib
from typing import Any

import c4d

try:
    import maxon

    _MAXON_AVAILABLE = True
except ImportError:
    maxon = None  # type: ignore[assignment]
    _MAXON_AVAILABLE = False

from c4d import documents

from ._helpers import _resolve_handle


def _resolve_graph_element(params: dict[str, Any]) -> Any:
    """Return the maxon GraphDescription element for the requested target.

    Accepts either ``handle`` (material) or ``scope:"document"`` for the
    scene-nodes graph. ``scope`` takes precedence when both are provided,
    mirroring how the maxon API dispatches on element type.
    """
    scope = params.get("scope")
    if scope is not None:
        if scope != "document":
            raise ValueError(f"scope must be 'document' or omitted, got {scope!r}")
        doc = documents.GetActiveDocument()
        if doc is None:
            raise RuntimeError("no active document")
        return doc

    h = params.get("handle")
    if not h:
        raise ValueError("handle required (or scope:'document' for scene nodes)")
    obj = _resolve_handle(h)
    if obj is None:
        raise ValueError(f"handle did not resolve: {h}")
    if not isinstance(obj, c4d.BaseMaterial):
        raise ValueError(f"handle did not resolve to a BaseMaterial: {h}")
    return obj


_NODE_SPACE_ALIASES: dict[str, str] = {
    "standard": "net.maxon.nodespace.standard",
    "redshift": "com.redshift3d.redshift4c4d.class.nodespace",
    "scenenodes": "net.maxon.neutron.nodespace",
    "neutron": "net.maxon.neutron.nodespace",
}


def _resolve_node_space(alias: str | None, default: str | None = None) -> str:
    """Return the fully-qualified node space id for a friendly alias.

    Falls back to ``default`` when ``alias`` is None. Passes through any
    string that already looks fully-qualified (contains a dot) so callers
    can target spaces the bridge doesn't know about.
    """
    if not alias:
        if default:
            return default
        return _NODE_SPACE_ALIASES["standard"]
    key = alias.strip()
    if "." in key:
        return key
    lower = key.lower()
    if lower in _NODE_SPACE_ALIASES:
        return _NODE_SPACE_ALIASES[lower]
    raise ValueError(
        f"unknown node_space {alias!r}; accepted aliases: {sorted(_NODE_SPACE_ALIASES)} "
        "(or pass a fully-qualified maxon.Id such as 'net.maxon.nodespace.standard')"
    )


def _require_maxon() -> None:
    if not _MAXON_AVAILABLE:
        raise RuntimeError(
            "maxon module not available — this C4D build lacks node-material support"
        )


def _get_graph(element, space_id: str):
    """Fetch the nodes graph for an element (material or document)."""
    try:
        return maxon.GraphDescription.GetGraph(element, nodeSpaceId=space_id, createEmpty=False)
    except Exception:
        # GraphDescription raises when the element has no graph in that
        # space. Callers treat None as "not supported here".
        return None


def _collect_nodes(graph) -> list[dict[str, Any]]:
    """Walk a NodesGraphModelRef and return a flat list of node summaries."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()

    def node_entry(node, parent_id: str | None) -> None:
        try:
            nid = str(node.GetId())
        except Exception:
            return
        if nid in seen:
            return
        seen.add(nid)
        asset_id = None
        name = None
        with contextlib.suppress(Exception):
            asset_id = str(node.GetValue("net.maxon.node.attribute.assetid") or "") or None
        with contextlib.suppress(Exception):
            name = str(node.GetValue("net.maxon.node.attribute.name") or "") or None
        out.append({"id": nid, "parent_id": parent_id, "asset_id": asset_id, "name": name})
        # Children: try GetChildren() (iterator); fall back gracefully.
        with contextlib.suppress(Exception):
            for child in node.GetChildren():
                node_entry(child, nid)

    root = None
    with contextlib.suppress(Exception):
        root = graph.GetRoot()
    if root is None:
        return out
    node_entry(root, None)
    return out


def handle_list_graph_nodes(params: dict[str, Any]) -> dict[str, Any]:
    """Traverse a node graph (material or scene-nodes) and return nodes.

    params:
      handle:     material handle (required unless scope='document')
      scope:      'document' → target scene-nodes graph on the active doc
      node_space: alias ("standard"/"redshift"/"scenenodes") or maxon.Id.
                  Default "standard" for materials, "scenenodes" for docs.
    """
    if not _MAXON_AVAILABLE:
        return {"supported": False, "reason": "maxon module unavailable", "nodes": []}

    element = _resolve_graph_element(params)
    default_space_id = (
        _NODE_SPACE_ALIASES["scenenodes"] if params.get("scope") == "document" else None
    )
    space = _resolve_node_space(params.get("node_space"), default_space_id)
    graph = _get_graph(element, space)
    if graph is None:
        return {
            "supported": False,
            "reason": f"element has no graph in node_space {space!r}",
            "node_space": space,
            "nodes": [],
        }

    return {
        "supported": True,
        "node_space": space,
        "nodes": _collect_nodes(graph),
    }


def handle_apply_graph_description(params: dict[str, Any]) -> dict[str, Any]:
    """Apply a ``maxon.GraphDescription`` to a node material's graph.

    The ``description`` argument mirrors the declarative dict accepted by
    ``GraphDescription.ApplyDescription`` (see Maxon's docs for the $type /
    $id / '->' connection syntax).

    params:
      handle:      material handle
      description: nested dict (see maxon.GraphDescription)
      node_space:  alias or maxon.Id (default 'standard')
      create_graph: bool — when True, create the graph if missing (default True)
    """
    description = params.get("description")
    if not isinstance(description, dict):
        raise ValueError("description must be a dict")

    _require_maxon()
    element = _resolve_graph_element(params)

    default_space_id = (
        _NODE_SPACE_ALIASES["scenenodes"] if params.get("scope") == "document" else None
    )
    space = _resolve_node_space(params.get("node_space"), default_space_id)
    create = bool(params.get("create_graph", True))

    graph = _get_graph(element, space)
    if graph is None and create:
        graph = maxon.GraphDescription.GetGraph(element, nodeSpaceId=space, createEmpty=True)
    if graph is None:
        raise RuntimeError(
            f"no graph on material in node_space {space!r} (pass create_graph:true to create one)"
        )

    result = maxon.GraphDescription.ApplyDescription(graph, description, nodeSpace=space)

    # ApplyDescription returns a dict[id -> GraphNode]; surface just the ids.
    node_ids: list[str] = []
    if isinstance(result, dict):
        node_ids = [str(k) for k in result]

    c4d.EventAdd()
    return {
        "applied": True,
        "node_space": space,
        "touched_ids": node_ids,
    }


def handle_set_graph_port(params: dict[str, Any]) -> dict[str, Any]:
    """Set a single port's constant value on a node addressable by id.

    Wraps ``GraphDescription.ApplyDescription`` with a ``$query`` targeting
    the requested node id — keeps the surface simple for one-port edits.

    params:
      handle:     material handle
      node_space: alias / maxon.Id (default 'standard')
      node_id:    the $id of the node to mutate
      port:       port path (e.g. 'Base/Metalness')
      value:      new value (number / bool / string / [x,y,z] for vectors)
    """
    node_id = params.get("node_id")
    port = params.get("port")
    if not isinstance(node_id, str) or not node_id:
        raise ValueError("node_id (string) required")
    if not isinstance(port, str) or not port:
        raise ValueError("port (string) required")
    if "value" not in params:
        raise ValueError("value required")
    value = params["value"]

    _require_maxon()
    element = _resolve_graph_element(params)
    default_space_id = (
        _NODE_SPACE_ALIASES["scenenodes"] if params.get("scope") == "document" else None
    )
    space = _resolve_node_space(params.get("node_space"), default_space_id)
    graph = _get_graph(element, space)
    if graph is None:
        raise RuntimeError(f"no graph on material in node_space {space!r}")

    # Coerce list/tuple of 3 numbers into maxon.Vector so vector ports accept
    # the value cleanly (GraphDescription unwraps maxon types natively).
    if (
        isinstance(value, (list, tuple))
        and len(value) == 3
        and all(isinstance(v, (int, float)) for v in value)
    ):
        value = maxon.Vector(float(value[0]), float(value[1]), float(value[2]))

    description = {
        "$query": {"$id": node_id},
        port: value,
    }
    result = maxon.GraphDescription.ApplyDescription(graph, description, nodeSpace=space)
    touched = list(result.keys()) if isinstance(result, dict) else []

    c4d.EventAdd()
    return {
        "applied": True,
        "node_space": space,
        "node_id": node_id,
        "port": port,
        "touched_ids": [str(x) for x in touched],
    }


def handle_get_graph_info(params: dict[str, Any]) -> dict[str, Any]:
    """Inspect which node spaces a material exposes and which is active.

    params:
      handle: material handle
    """
    h = params.get("handle")
    if not h:
        raise ValueError("handle required")
    mat = _resolve_handle(h)
    if mat is None or not isinstance(mat, c4d.BaseMaterial):
        raise ValueError(f"handle did not resolve to a BaseMaterial: {h}")

    if not _MAXON_AVAILABLE:
        return {"supported": False, "reason": "maxon module unavailable"}

    # Known spaces — we probe each one; HasSpace / GetActiveNodeSpaceId vary
    # across builds so fall back to a graph-availability check.
    active: str | None = None
    with contextlib.suppress(Exception):
        ref = mat.GetNodeMaterialReference() if hasattr(mat, "GetNodeMaterialReference") else None
        if ref is not None:
            active = str(ref.GetActiveNodeSpaceId())
    if active is None and hasattr(mat, "GetActiveNodeSpaceId"):
        with contextlib.suppress(Exception):
            active = str(mat.GetActiveNodeSpaceId())

    available: list[str] = []
    for space in _NODE_SPACE_ALIASES.values():
        if _get_graph(mat, space) is not None:
            available.append(space)

    return {
        "supported": True,
        "active_space": active,
        "available_spaces": available,
        "aliases": dict(_NODE_SPACE_ALIASES),
    }


def handle_list_graph_node_assets(params: dict[str, Any]) -> dict[str, Any]:
    """Enumerate registered node assets for a node space.

    LLMs need these ids to know what ``$type`` values ``apply_graph_description``
    will accept. We query the Maxon asset repository for the ``NodeTemplate``
    category and filter by node-space compatibility where possible.

    params:
      node_space: alias or maxon.Id. Default 'standard'.
    """
    if not _MAXON_AVAILABLE:
        return {"supported": False, "reason": "maxon module unavailable", "assets": []}

    space = _resolve_node_space(params.get("node_space"))

    assets: list[dict[str, Any]] = []
    try:
        repo = maxon.AssetInterface.GetUserPrefsRepository()
        if repo is None:
            return {
                "supported": False,
                "reason": "no user prefs asset repository",
                "node_space": space,
                "assets": [],
            }
        # NodeTemplate assets carry NODESPACE metadata; most builds expose
        # maxon.AssetTypes.NodeTemplate() as the canonical type.
        template_type = None
        with contextlib.suppress(Exception):
            template_type = maxon.AssetTypes.NodeTemplate().GetId()
        if template_type is None:
            with contextlib.suppress(Exception):
                template_type = maxon.Id("net.maxon.asset.base.nodetemplate")
        if template_type is None:
            return {
                "supported": False,
                "reason": "NodeTemplate asset type not resolvable on this build",
                "node_space": space,
                "assets": [],
            }

        found = repo.FindAssets(
            template_type,
            maxon.Id(),
            maxon.Id(),
            maxon.ASSET_FIND_MODE.LATEST,
        )
        for asset in found or []:
            try:
                desc = asset.GetDescription()
                aid = str(asset.GetId())
            except Exception:
                continue
            entry: dict[str, Any] = {"id": aid}
            # Node-space filter: assets carry a NODESPACE id in their metadata.
            node_space_id = None
            with contextlib.suppress(Exception):
                meta = desc.GetMetaData()
                node_space_id = str(meta.Get(maxon.ASSETMETADATA.NodeSpaceId) or "") or None
            if node_space_id and node_space_id != space:
                continue
            with contextlib.suppress(Exception):
                entry["name"] = str(desc.GetMetaString(maxon.OBJECT.BASE.NAME) or "") or None
            with contextlib.suppress(Exception):
                category = desc.GetMetaString(maxon.ASSETMETADATA.Category) or ""
                entry["category"] = str(category) or None
            if node_space_id:
                entry["node_space"] = node_space_id
            assets.append(entry)
    except Exception as exc:
        return {
            "supported": False,
            "reason": f"{type(exc).__name__}: {exc}",
            "node_space": space,
            "assets": [],
        }

    # Deduplicate by id (asset repo often returns multiple versions).
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for entry in assets:
        if entry["id"] in seen:
            continue
        seen.add(entry["id"])
        unique.append(entry)
    unique.sort(key=lambda e: e["id"])

    return {
        "supported": True,
        "node_space": space,
        "assets": unique,
        "count": len(unique),
    }


def handle_remove_graph_node(params: dict[str, Any]) -> dict[str, Any]:
    """Remove a node by id from a material's graph.

    Uses the low-level ``graph.RemoveNode`` when available; otherwise falls
    back to ``GraphDescription`` with a delete directive.

    params:
      handle:     material handle
      node_space: alias or maxon.Id (default 'standard')
      node_id:    the id of the node to remove
    """
    node_id = params.get("node_id")
    if not isinstance(node_id, str) or not node_id:
        raise ValueError("node_id (string) required")

    _require_maxon()
    element = _resolve_graph_element(params)
    default_space_id = (
        _NODE_SPACE_ALIASES["scenenodes"] if params.get("scope") == "document" else None
    )
    space = _resolve_node_space(params.get("node_space"), default_space_id)
    graph = _get_graph(element, space)
    if graph is None:
        raise RuntimeError(f"no graph on material in node_space {space!r}")

    removed = False
    # Preferred path: locate the node and call RemoveNode in a transaction.
    try:
        with graph.BeginTransaction() as tx:
            target = None
            root = graph.GetRoot()

            def find(n):
                nonlocal target
                if target is not None:
                    return
                try:
                    if str(n.GetId()) == node_id:
                        target = n
                        return
                except Exception:
                    pass
                try:
                    for c in n.GetChildren():
                        find(c)
                except Exception:
                    pass

            find(root)
            if target is not None:
                target.Remove()
                removed = True
            tx.Commit()
    except Exception as exc:
        raise RuntimeError(f"RemoveNode transaction failed: {type(exc).__name__}: {exc}") from exc

    c4d.EventAdd()
    return {"removed": removed, "node_space": space, "node_id": node_id}
