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


_NEUTRON_SPACE_ID = "net.maxon.neutron.nodespace"


def _is_neutron_space(space_id: str) -> bool:
    return str(space_id) == _NEUTRON_SPACE_ID


def _require_maxon() -> None:
    if not _MAXON_AVAILABLE:
        raise RuntimeError(
            "maxon module not available — this C4D build lacks node-material support"
        )


# --- Low-level graph construction (AddChild) ---------------------------------
#
# maxon.GraphDescription.ApplyDescription resolves $type through a localized
# name→id table. For material spaces that table holds friendly labels
# ("BSDF", "Output", ...); for the neutron node space it is empty, so
# GraphDescription cannot create any node there ("node type reference ... is
# not associated with any IDs").
#
# graph.AddChild, by contrast, accepts *raw node-template asset ids* directly in
# every space (verified: a render node on a standard material, a corenode-backed
# net.maxon.node.* on neutron). The helpers below interpret the same declarative
# description dict the GraphDescription path accepts, but build the graph through
# AddChild / Connect / SetPortValue. They drive the neutron path unconditionally
# and serve as a fallback for material spaces when a raw asset id is passed as
# $type (e.g. an id straight from list_graph_node_assets).
#
# Note: the addable ids are node-template asset ids — NOT the net.maxon.corenode:*
# ids that list_graph_nodes reports for existing nodes (those are the lower-level
# compute nodes and are rejected by AddChild). Use list_graph_node_assets to
# discover valid ids for a space.

_DESC_RESERVED = {"$type", "$id"}

# Substring of the maxon error raised when GraphDescription can't resolve a
# $type label — our cue to retry creation through the low-level AddChild path.
_UNRESOLVED_TYPE_MARKER = "is not associated with any IDs"


def _is_unresolved_type_error(exc: Exception) -> bool:
    return _UNRESOLVED_TYPE_MARKER in str(exc)


def _coerce_port_value(value: Any) -> Any:
    """Coerce a JSON value into a maxon type for SetPortValue where helpful.

    Lists of 3/4 numbers become Vector/Vector4d (vector ports). Scalars and
    strings are passed through — GraphNode.SetPortValue converts them natively.
    """
    if isinstance(value, (list, tuple)):
        nums = [float(x) for x in value if isinstance(x, (int, float))]
        if len(value) == 3 and len(nums) == 3:
            return maxon.Vector(nums[0], nums[1], nums[2])
        if len(value) == 4 and len(nums) == 4:
            return maxon.Vector4d(nums[0], nums[1], nums[2], nums[3])
    return value


def _ll_port_valid(port: Any) -> bool:
    # FindChild returns a null GraphNode (not None) for a missing port, and
    # calling IsValid() on it raises rather than returning False.
    try:
        return port is not None and bool(port.IsValid())
    except Exception:
        return False


def _ll_find_port(node: Any, name: str) -> tuple[Any, str | None]:
    """Locate a port by name on a node, returning (port, 'in'|'out'|None)."""
    port = node.GetInputs().FindChild(name)
    if _ll_port_valid(port):
        return port, "in"
    port = node.GetOutputs().FindChild(name)
    if _ll_port_valid(port):
        return port, "out"
    return None, None


def _ll_connect(parent: Any, parent_port: str, child: Any, child_port: str) -> None:
    """Wire a connection between a parent node port and a child node port.

    Mirrors the GraphDescription convention where a "L -> R" key on a node maps
    L to a port on that node and R to a port on the nested (child) node. The
    actual wire is always drawn output→input regardless of which side is which.
    """
    pport, pdir = _ll_find_port(parent, parent_port)
    if pport is None:
        raise ValueError(f"connection port {parent_port!r} not found on parent node")
    cport, cdir = _ll_find_port(child, child_port)
    if cport is None:
        raise ValueError(f"connection port {child_port!r} not found on child node")
    if pdir == "out" and cdir == "in":
        pport.Connect(cport)
    elif pdir == "in" and cdir == "out":
        cport.Connect(pport)
    else:
        # Same-direction / ambiguous: best-effort, treat the parent side as source.
        pport.Connect(cport)


def _ll_build_node(
    graph: Any, spec: Any, space: str, idmap: dict[str, Any], touched: list[str]
) -> Any:
    """Recursively create a node (and its wired children) from a description dict."""
    if not isinstance(spec, dict):
        raise ValueError(f"node spec must be a dict, got {type(spec).__name__}")

    # A spec with only $id (no $type) references a previously-created node.
    if "$type" not in spec:
        ref = spec.get("$id")
        if ref is not None and str(ref) in idmap:
            return idmap[str(ref)]
        raise ValueError(f"node spec missing $type (and no known $id reference): {spec!r}")

    type_id = str(spec["$type"])
    sid = spec.get("$id")
    # Use $id as the child node id so callers get stable, addressable ids;
    # fall back to an auto-assigned UUID if it isn't a usable maxon.Id.
    child_id = maxon.Id()
    if sid is not None and str(sid):
        with contextlib.suppress(Exception):
            child_id = maxon.Id(str(sid))
    try:
        node = graph.AddChild(child_id, maxon.Id(type_id), maxon.DataDictionary())
    except Exception as exc:
        raise RuntimeError(
            f"failed to create node of type {type_id!r} in node_space {space!r}: {exc}. "
            "$type must be a node-template asset id valid for this space (e.g. "
            "'net.maxon.node.invert' for scene nodes); the net.maxon.corenode:* ids "
            "reported by list_graph_nodes are NOT addable. Call list_graph_node_assets "
            "to discover valid ids."
        ) from exc

    touched.append(str(node.GetId()))
    if sid is not None:
        idmap[str(sid)] = node

    for key, value in spec.items():
        if key in _DESC_RESERVED:
            continue
        if "->" in key:
            left, right = (part.strip() for part in key.split("->", 1))
            child = _ll_build_node(graph, value, space, idmap, touched)
            _ll_connect(node, left, child, right)
        else:
            port, _ = _ll_find_port(node, key)
            if port is None:
                raise ValueError(f"unknown port {key!r} on node $type {type_id!r}")
            port.SetPortValue(_coerce_port_value(value))
    return node


def _apply_graph_description_lowlevel(graph: Any, description: Any, space: str) -> list[str]:
    """Apply a creation description to any graph via the low-level AddChild API.

    Accepts a single node-spec dict or a list of them. Returns the ids of all
    nodes that were created.
    """
    specs = description if isinstance(description, list) else [description]
    idmap: dict[str, Any] = {}
    touched: list[str] = []
    with graph.BeginTransaction() as tx:
        for spec in specs:
            _ll_build_node(graph, spec, space, idmap, touched)
        tx.Commit()
    return touched


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
    if not isinstance(description, (dict, list)):
        raise ValueError("description must be a dict (or a list of dicts)")

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

    # The neutron (Scene Nodes) space cannot resolve $type through
    # GraphDescription at all, so creation goes through the low-level AddChild API.
    if _is_neutron_space(space):
        touched = _apply_graph_description_lowlevel(graph, description, space)
        c4d.EventAdd()
        return {"applied": True, "node_space": space, "touched_ids": touched}

    try:
        result = maxon.GraphDescription.ApplyDescription(graph, description, nodeSpace=space)
    except Exception as exc:
        # GraphDescription resolves $type via localized labels ("BSDF", "Output",
        # ...). A raw node-template asset id (e.g. straight from
        # list_graph_node_assets) isn't in that table, so retry through the
        # low-level builder, which accepts raw ids directly.
        if not _is_unresolved_type_error(exc):
            raise
        touched = _apply_graph_description_lowlevel(graph, description, space)
        c4d.EventAdd()
        return {"applied": True, "node_space": space, "touched_ids": touched}

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


# Node-template asset id families per node space. Verified empirically: AddChild
# accepts a space's own families and rejects others ("<id> doesn't support node
# system class <space>.nodesystemclass"). Node-space metadata on the assets is
# empty, so id prefix is the only reliable discriminator we can read cheaply.
_NEUTRON_TEMPLATE_PREFIXES = (
    "net.maxon.node.",
    "net.maxon.nodes.",
    "net.maxon.pattern.",
    "net.maxon.nbo.",
)
_STANDARD_TEMPLATE_PREFIXES = ("net.maxon.render.",)
_REDSHIFT_TEMPLATE_PREFIXES = ("com.redshift3d.",)

# Safety cap so a pathological asset DB can never produce an unbounded response
# (enumerating every node template and reading per-asset metadata has crashed
# C4D in the past — we now read ids only).
_LIST_ASSETS_MAX = 5000


def _template_matches_space(asset_id: str, space: str) -> bool:
    """Whether a node-template asset is addable in the given node space.

    Returns True (no filtering) for spaces we don't have a verified prefix set
    for, so third-party / unknown spaces still get a full catalogue.
    """
    if _is_neutron_space(space):
        return ".neutron." in asset_id or asset_id.startswith(_NEUTRON_TEMPLATE_PREFIXES)
    if space == _NODE_SPACE_ALIASES["standard"]:
        return asset_id.startswith(_STANDARD_TEMPLATE_PREFIXES)
    if space == _NODE_SPACE_ALIASES["redshift"]:
        return asset_id.startswith(_REDSHIFT_TEMPLATE_PREFIXES)
    return True


def _derive_template_category(asset_id: str) -> str | None:
    """Best-effort category derived from the asset id (no metadata read)."""
    head = asset_id.split(":")[0].split("@")[0]
    parts = head.split(".")
    return parts[-2] if len(parts) >= 2 else None


def handle_list_graph_node_assets(params: dict[str, Any]) -> dict[str, Any]:
    """Enumerate registered node-template assets for a node space.

    LLMs need these ids to know what ``$type`` values ``apply_graph_description``
    will accept. We enumerate the Maxon ``NodeTemplate`` assets (reading ids only,
    to stay cheap and crash-safe) and, for the neutron / Scene Nodes space, filter
    to the families that are actually addable there.

    params:
      node_space: alias ('standard'/'redshift'/'scenenodes') or maxon.Id.
                  Default 'standard'.
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
        seen: set[str] = set()
        for asset in found or []:
            try:
                aid = str(asset.GetId())
            except Exception:
                continue
            if not aid or aid in seen:
                continue
            # Each space only exposes its own node-template families; templates
            # from other spaces are rejected by AddChild / GraphDescription.
            if not _template_matches_space(aid, space):
                continue
            seen.add(aid)
            entry: dict[str, Any] = {"id": aid}
            category = _derive_template_category(aid)
            if category:
                entry["category"] = category
            assets.append(entry)
            if len(assets) >= _LIST_ASSETS_MAX:
                break
    except Exception as exc:
        return {
            "supported": False,
            "reason": f"{type(exc).__name__}: {exc}",
            "node_space": space,
            "assets": [],
        }

    assets.sort(key=lambda e: e["id"])

    return {
        "supported": True,
        "node_space": space,
        "assets": assets,
        "count": len(assets),
        "truncated": len(assets) >= _LIST_ASSETS_MAX,
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
