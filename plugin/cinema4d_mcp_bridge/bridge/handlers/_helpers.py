"""Shared lookup / introspection / mutation helpers for the handler modules.

Private (``_xxx``) names are also exposed to user code inside ``exec_python``
via the namespace built in ``handlers.script``.
"""

from __future__ import annotations

import contextlib
import os
from typing import Any

import c4d
from c4d import documents

# ---------------------------------------------------------------------------
# Path validation
# ---------------------------------------------------------------------------


def _require_abs_path(path: Any, *, must_exist: bool = False) -> str:
    """Validate that ``path`` is a non-empty absolute filesystem path.

    Kept strict on purpose: relative paths resolve against the C4D working
    directory (which varies by launch) and that's a surprising footgun for
    LLM-driven callers. ``must_exist`` is for read-side paths — write-side
    handlers only check the parent directory.
    """
    if not isinstance(path, str) or not path:
        raise ValueError("path required (string)")
    if not os.path.isabs(path):
        raise ValueError(f"path must be absolute, got {path!r}")
    if must_exist and not os.path.exists(path):
        raise ValueError(f"file not found: {path}")
    return path


def _require_writable_path(path: Any) -> str:
    """Absolute path whose parent directory already exists (for writes)."""
    resolved = _require_abs_path(path)
    parent = os.path.dirname(resolved)
    if parent and not os.path.isdir(parent):
        raise ValueError(f"parent directory does not exist: {parent}")
    return resolved


# ---------------------------------------------------------------------------
# Python-bearing entity gate
# ---------------------------------------------------------------------------
#
# A handful of Cinema 4D plugin types store user-supplied Python in their
# container and execute it on scene evaluation: Python tag, Python generator,
# Python (MoGraph) effector, and the Xpresso Python operator. From a security
# standpoint creating or editing one of these is equivalent to ``exec_python``
# — a misbehaving (e.g. prompt-injected) caller can drop a payload into the
# code parameter and get arbitrary code execution on the next scene eval,
# fully bypassing the ``C4D_MCP_ENABLE_EXEC_PYTHON`` opt-in.
#
# We therefore gate creation and mutation of these types behind a separate
# opt-in env var. Kept independent of ``C4D_MCP_ENABLE_EXEC_PYTHON`` so users
# who don't want an interactive Python REPL but DO author scenes with Python
# tags can opt into just the latter.

_PYTHON_OPS_ENV = "C4D_MCP_ENABLE_PYTHON_OPS"

# Plugin (BaseList2D) type ids that carry user Python source. Resolved by
# c4d.* name with a numeric fallback so older / variant builds that don't
# expose every constant still get the deny.
_PYTHON_BEARING_TYPE_IDS: frozenset[int] = frozenset(
    int(tid)
    for tid in (
        getattr(c4d, "Tpython", 1022749),  # Python tag
        getattr(c4d, "Opython", 1023866),  # Python generator (object)
        getattr(c4d, "Omgpython", 1025800),  # MoGraph Python effector (object)
        getattr(c4d, "Fpython", 440000277),  # Python field (object plugin namespace)
    )
    if isinstance(tid, int)
)

# Xpresso operator ids — different namespace from BaseList2D type ids
# (GvNode.GetOperatorID(), not GetType()).
_PYTHON_OPERATOR_IDS: frozenset[int] = frozenset(
    int(oid)
    for oid in (
        getattr(c4d, "ID_OPERATOR_PYTHON", 1022471),  # Xpresso Python operator
        1026947,  # "Python Thread Node" — second Python-bearing GvNode shipped by corelibs
    )
    if isinstance(oid, int)
)


def _python_ops_enabled() -> bool:
    """Return True when the operator has opted IN to Python-bearing edits."""
    flag = os.environ.get(_PYTHON_OPS_ENV, "")
    return flag.strip().lower() in ("1", "true", "yes", "on")


def _python_ops_error(detail: str) -> RuntimeError:
    return RuntimeError(
        f"{detail}: requires {_PYTHON_OPS_ENV}=1 (defaults off — these types "
        "execute caller-supplied Python on scene evaluation, equivalent to "
        "exec_python). Set the env var in the Cinema 4D launch environment "
        "and restart to enable."
    )


def _ensure_python_type_id_allowed(type_id: int, *, kind: str) -> None:
    """Raise unless the operator opted IN, when ``type_id`` carries Python source."""
    if int(type_id) in _PYTHON_BEARING_TYPE_IDS and not _python_ops_enabled():
        raise _python_ops_error(f"{kind} type_id={type_id} is a Python-bearing plugin")


def _ensure_python_operator_id_allowed(operator_id: int) -> None:
    """Raise unless the operator opted IN, when the Xpresso operator is Python."""
    if int(operator_id) in _PYTHON_OPERATOR_IDS and not _python_ops_enabled():
        raise _python_ops_error(f"Xpresso operator_id={operator_id} is the Python operator")


def _ensure_entity_writable(entity: Any) -> None:
    """Raise on writes to a Python-bearing entity unless opted IN.

    Covers both BaseList2D-derived entities (matched by GetType()) and
    GvNode-derived entities inside an Xpresso tag (matched by GetOperatorID()).
    """
    if entity is None or _python_ops_enabled():
        return
    # GvNode lives in c4d.modules.graphview; import lazily to avoid pulling
    # graphview at module load on builds where it is not registered.
    try:
        from c4d.modules import graphview
    except Exception:  # pragma: no cover — graphview should always be available
        graphview = None  # type: ignore[assignment]
    if graphview is not None and isinstance(entity, graphview.GvNode):
        try:
            op_id = int(entity.GetOperatorID())
        except Exception:
            return
        if op_id in _PYTHON_OPERATOR_IDS:
            raise _python_ops_error(f"writing to Xpresso Python operator (operator_id={op_id})")
        return
    try:
        type_id = int(entity.GetType())
    except Exception:
        return
    if type_id in _PYTHON_BEARING_TYPE_IDS:
        raise _python_ops_error(f"writing to Python-bearing entity (type_id={type_id})")


# ---------------------------------------------------------------------------
# Entity lookup
# ---------------------------------------------------------------------------


def _walk_all_objects(root: c4d.BaseObject | None) -> list[c4d.BaseObject]:
    """Pre-order walk of every object reachable from ``root``'s sibling chain."""
    out: list[c4d.BaseObject] = []

    def walk(o: c4d.BaseObject | None) -> None:
        while o is not None:
            out.append(o)
            d = o.GetDown()
            if d is not None:
                walk(d)
            o = o.GetNext()

    walk(root)
    return out


def _object_path(obj: c4d.BaseObject) -> str:
    """Return a slash-joined path from the document root to ``obj``."""
    parts: list[str] = []
    node: c4d.BaseObject | None = obj
    while node is not None:
        parts.append(node.GetName())
        node = node.GetUp()
    parts.reverse()
    return "/" + "/".join(parts)


def _find_object_by_path(path: str) -> c4d.BaseObject | None:
    """Resolve an object by `/A/B/C` path. Siblings at each level are scanned by name."""
    doc = documents.GetActiveDocument()
    if doc is None:
        return None
    segments = [s for s in path.split("/") if s]
    if not segments:
        return None
    # Walk top-level siblings
    o: c4d.BaseObject | None = doc.GetFirstObject()
    current: c4d.BaseObject | None = None
    for i, name in enumerate(segments):
        current = None
        sib = o
        while sib is not None:
            if sib.GetName() == name:
                current = sib
                break
            sib = sib.GetNext()
        if current is None:
            return None
        if i == len(segments) - 1:
            return current
        o = current.GetDown()
    return current


def _find_objects_by_name(name: str) -> list[c4d.BaseObject]:
    doc = documents.GetActiveDocument()
    if doc is None:
        return []
    return [o for o in _walk_all_objects(doc.GetFirstObject()) if o.GetName() == name]


def _find_object(name: str) -> c4d.BaseObject | None:
    """Locate an object by unique name. Raises on ambiguity."""
    matches = _find_objects_by_name(name)
    if not matches:
        return None
    if len(matches) > 1:
        paths = [_object_path(o) for o in matches[:5]]
        raise ValueError(
            f"object name {name!r} is ambiguous ({len(matches)} matches). "
            f"Use a path-based handle instead — examples: {paths}"
        )
    return matches[0]


def _resolve_object_handle(h: dict[str, Any]) -> c4d.BaseObject | None:
    """Resolve an object handle. Accepts either ``path`` or ``name``."""
    path = h.get("path")
    if path:
        return _find_object_by_path(str(path))
    name = h.get("name")
    if not name:
        raise ValueError("object handle requires 'name' or 'path'")
    return _find_object(str(name))


def _find_render_data(name: str):
    doc = documents.GetActiveDocument()
    if doc is None:
        return None
    r = doc.GetFirstRenderData()
    while r is not None:
        if r.GetName() == name:
            return r
        r = r.GetNext()
    return None


def _find_take(name: str):
    doc = documents.GetActiveDocument()
    if doc is None:
        return None
    td = doc.GetTakeData()
    if td is None:
        return None

    def walk(t):
        if t.GetName() == name:
            return t
        c = t.GetDown()
        while c is not None:
            hit = walk(c)
            if hit is not None:
                return hit
            c = c.GetNext()
        return None

    return walk(td.GetMainTake())


def _find_material(name: str):
    doc = documents.GetActiveDocument()
    if doc is None:
        return None
    m = doc.GetFirstMaterial()
    while m is not None:
        if m.GetName() == name:
            return m
        m = m.GetNext()
    return None


def _find_tag(obj: c4d.BaseObject, type_id: int | None = None, name: str | None = None):
    t = obj.GetFirstTag()
    while t is not None:
        if (type_id is None or t.GetType() == type_id) and (name is None or t.GetName() == name):
            return t
        t = t.GetNext()
    return None


def _find_videopost(rd, type_id: int):
    vp = rd.GetFirstVideoPost()
    while vp is not None:
        if vp.GetType() == type_id:
            return vp
        vp = vp.GetNext()
    return None


def _shader_at(owner, index: int):
    s = owner.GetFirstShader() if hasattr(owner, "GetFirstShader") else None
    i = 0
    while s is not None:
        if i == index:
            return s
        i += 1
        s = s.GetNext()
    return None


def _shader_by_name(owner, name: str):
    """Locate the first shader under ``owner`` with the given name."""
    s = owner.GetFirstShader() if hasattr(owner, "GetFirstShader") else None
    while s is not None:
        if s.GetName() == name:
            return s
        s = s.GetNext()
    return None


# Format alias → c4d.FORMAT_* constant name. Values are the plugin IDs
# that SaveDocument / the scene-saver plugins are registered with, so the
# same map doubles as a "which plugin provides {abc,fbx,obj,…} export" lookup
# for the plugin_options handle. Resolved via getattr so a C4D build missing
# a format (e.g. GLTF not installed) produces a readable error at use time.
_FORMAT_ALIASES: dict[str, str] = {
    "c4d": "FORMAT_C4DEXPORT",
    "abc": "FORMAT_ABCEXPORT",
    "alembic": "FORMAT_ABCEXPORT",
    "fbx": "FORMAT_FBX_EXPORT",
    "obj": "FORMAT_OBJ2EXPORT",
    "stl": "FORMAT_STLEXPORT",
    "ply": "FORMAT_PLYEXPORT",
    "usda": "FORMAT_USDEXPORT",
    "usd": "FORMAT_USDEXPORT",
    "gltf": "FORMAT_GLTFEXPORT",
}


def _resolve_format(alias: str) -> int:
    """Translate a format alias (``"abc"``, ``"fbx"``, …) into a C4D FORMAT_* int."""
    key = alias.strip().lower()
    const_name = _FORMAT_ALIASES.get(key)
    if const_name is None:
        raise ValueError(f"unknown format {alias!r}; accepted: {sorted(_FORMAT_ALIASES)}")
    value = getattr(c4d, const_name, None)
    if value is None:
        raise RuntimeError(f"C4D build does not expose c4d.{const_name} — cannot export {alias!r}")
    return int(value)


# Plugin type alias → c4d.PLUGINTYPE_* constant name. Shared by list_plugins
# (for filtering) and by _resolve_plugin_options (for narrowing FindPlugin).
_PLUGIN_TYPE_ALIASES: dict[str, str] = {
    "command": "PLUGINTYPE_COMMAND",
    "object": "PLUGINTYPE_OBJECT",
    "tag": "PLUGINTYPE_TAG",
    "material": "PLUGINTYPE_MATERIAL",
    "shader": "PLUGINTYPE_SHADER",
    "video_post": "PLUGINTYPE_VIDEOPOST",
    "scene_loader": "PLUGINTYPE_SCENELOADER",
    "scene_saver": "PLUGINTYPE_SCENESAVER",
    "bitmap_loader": "PLUGINTYPE_BITMAPLOADER",
    "bitmap_saver": "PLUGINTYPE_BITMAPSAVER",
    "tool": "PLUGINTYPE_TOOL",
    "preference": "PLUGINTYPE_PREFS",
    "node": "PLUGINTYPE_NODE",
    "sculpt_brush": "PLUGINTYPE_SCULPT",
}


def _plugin_type_alias(name: str) -> int:
    """Map a short alias to a ``c4d.PLUGINTYPE_*`` constant.

    Unknown aliases raise ``ValueError`` with the full list of accepted names
    (only those that exist in the running C4D version are reported).
    """
    resolved = {k: getattr(c4d, v) for k, v in _PLUGIN_TYPE_ALIASES.items() if hasattr(c4d, v)}
    if name not in resolved:
        raise ValueError(f"unknown plugin_type {name!r}; accepted: {sorted(resolved)}")
    return resolved[name]


def _resolve_plugin_options(h: dict[str, Any]):
    """Resolve a ``{kind:"plugin_options", plugin_id, plugin_type?}`` handle.

    Returns the plugin's private settings ``BaseList2D`` (the one UIs write
    into — e.g. Alembic's ``ABCEXPORT_*`` options) obtained via
    ``MSG_RETRIEVEPRIVATEDATA`` on the found plugin. Returns ``None`` when
    the plugin isn't registered or refuses to expose its data.

    Accepts:
      plugin_id:   int (raw plugin id) or str (format alias — "abc", "fbx",
                   "obj", "usd", "gltf", "stl", "ply"). String aliases are
                   resolved through FORMAT_*EXPORT constants and therefore
                   only make sense when ``plugin_type`` is ``"scene_saver"``
                   (the default). For importers / other plugin kinds, pass
                   the numeric id.
      plugin_type: alias string, defaults to ``"scene_saver"``. See
                   ``_PLUGIN_TYPE_ALIASES`` for the accepted keys.
    """
    pid_raw = h.get("plugin_id")
    if pid_raw is None:
        raise ValueError("plugin_options handle requires 'plugin_id'")
    if isinstance(pid_raw, bool) or not isinstance(pid_raw, (int, str)):
        raise ValueError(f"plugin_id must be int or alias string, got {type(pid_raw).__name__}")
    pid = _resolve_format(pid_raw) if isinstance(pid_raw, str) else int(pid_raw)

    ptype_name = h.get("plugin_type", "scene_saver")
    if not isinstance(ptype_name, str):
        raise ValueError(f"plugin_type must be a string alias, got {type(ptype_name).__name__}")
    ptype = _plugin_type_alias(ptype_name)

    plug = c4d.plugins.FindPlugin(pid, ptype)
    if plug is None:
        return None
    op: dict[str, Any] = {}
    try:
        if not plug.Message(c4d.MSG_RETRIEVEPRIVATEDATA, op):
            return None
    except Exception:
        return None
    # The plugin fills "imexporter" with a BaseList2D it owns; the caller
    # writes to it via BaseList2D.__setitem__, and changes persist across
    # future FindPlugin lookups (the plugin is a singleton).
    return op.get("imexporter")


def _resolve_handle(h) -> Any:
    """Resolve a handle dict to a C4D entity. Returns None if not found.

    Supported kinds:
      {kind:"object", name}            — unique name lookup (raises on ambiguity)
      {kind:"object", path}            — "/A/B/C" hierarchy path (unambiguous)
      {kind:"render_data", name}
      {kind:"take", name}
      {kind:"material", name}
      {kind:"tag", object, type_id?, tag_name?}
      {kind:"video_post", render_data, type_id}
      {kind:"shader", owner:<handle>, index}
      {kind:"plugin_options", plugin_id, plugin_type?}
      {kind:"gv_node", tag:<tag handle>, id? | name?}  — Xpresso GvNode
    """
    if h is None:
        return None
    if not isinstance(h, dict):
        raise ValueError(f"handle must be a dict, got {type(h).__name__}")
    kind = h.get("kind")
    if kind == "object":
        return _resolve_object_handle(h)
    if kind == "render_data":
        return _find_render_data(h["name"])
    if kind == "take":
        return _find_take(h["name"])
    if kind == "material":
        return _find_material(h["name"])
    if kind == "tag":
        owner_name = h.get("object")
        owner_path = h.get("object_path")
        if owner_path:
            obj = _find_object_by_path(str(owner_path))
        elif owner_name:
            obj = _find_object(str(owner_name))
        else:
            raise ValueError("tag handle requires 'object' or 'object_path'")
        if obj is None:
            return None
        return _find_tag(obj, type_id=h.get("type_id"), name=h.get("tag_name"))
    if kind == "video_post":
        rd = _find_render_data(h["render_data"])
        if rd is None:
            return None
        return _find_videopost(rd, int(h["type_id"]))
    if kind == "shader":
        owner = _resolve_handle(h["owner"])
        if owner is None:
            return None
        # Prefer name when provided — survives shader-chain reordering, which
        # is common when materials get edited. Fall back to positional index.
        name = h.get("name")
        if isinstance(name, str) and name:
            hit = _shader_by_name(owner, name)
            if hit is not None:
                return hit
        if "index" in h:
            return _shader_at(owner, int(h.get("index", 0)))
        if isinstance(name, str) and name:
            return None  # explicit name given but not found; don't silently pick first
        return _shader_at(owner, 0)
    if kind == "plugin_options":
        return _resolve_plugin_options(h)
    if kind == "gv_node":
        return _resolve_gv_node_handle(h)
    raise ValueError(f"unknown handle kind: {kind!r}")


def _resolve_gv_node_handle(h: dict[str, Any]):
    """Resolve ``{kind:"gv_node", tag, id?|name?}`` to a GvNode.

    Imports xpresso helpers lazily to avoid a circular import at module
    load time (xpresso.py imports from this module).
    """
    tag_h = h.get("tag")
    if not tag_h:
        raise ValueError("gv_node handle requires 'tag'")
    tag = _resolve_handle(tag_h)
    if tag is None:
        return None
    if tag.GetType() != c4d.Texpresso:
        raise ValueError(
            f"gv_node.tag did not resolve to a Texpresso tag (got type {tag.GetType()})"
        )
    # Local import — avoids circular dependency with xpresso handlers.
    from .xpresso import _resolve_gv_node

    return _resolve_gv_node(tag, h.get("id"), h.get("name"))


# ---------------------------------------------------------------------------
# Introspection / serialization
# ---------------------------------------------------------------------------


def _json_safe(value: Any, _depth: int = 0) -> Any:
    """Best-effort conversion of arbitrary Python values into JSON-friendly form."""
    if _depth > 6:
        return repr(value)
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(v, _depth + 1) for v in value]
    if isinstance(value, dict):
        return {str(k): _json_safe(v, _depth + 1) for k, v in value.items()}
    if isinstance(value, c4d.Vector):
        return [value.x, value.y, value.z]
    if isinstance(value, c4d.BaseObject):
        return {"__c4d__": "BaseObject", "name": value.GetName(), "type": value.GetTypeName()}
    return repr(value)


_DTYPE_NAMES: dict[int, str] = {
    c4d.DTYPE_REAL: "real",
    c4d.DTYPE_LONG: "long",
    c4d.DTYPE_BOOL: "bool",
    c4d.DTYPE_VECTOR: "vector",
    c4d.DTYPE_STRING: "string",
    c4d.DTYPE_COLOR: "color",
    c4d.DTYPE_FILENAME: "filename",
    c4d.DTYPE_MATRIX: "matrix",
    c4d.DTYPE_TIME: "time",
    c4d.DTYPE_BUTTON: "button",
    c4d.DTYPE_GROUP: "group",
    c4d.DTYPE_BASELISTLINK: "link",
}


# Description-container keys queried by _describe_params. Resolved via
# getattr so a missing constant on a given C4D build is silently skipped
# instead of crashing the whole describe pass (2026 dropped DESC_HELP, for
# example).
_DESC_KEY_HELP: int | None = getattr(c4d, "DESC_HELP", None)
_DESC_KEY_UNIT: int | None = getattr(c4d, "DESC_UNIT", None)
_DESC_KEY_MIN: int | None = getattr(c4d, "DESC_MIN", None)
_DESC_KEY_MAX: int | None = getattr(c4d, "DESC_MAX", None)
_DESC_KEY_STEP: int | None = getattr(c4d, "DESC_STEP", None)
_DESC_KEY_DEFAULT: int | None = getattr(c4d, "DESC_DEFAULT", None)


def _describe_params(obj) -> list[dict[str, Any]]:
    """Dump the entity's description as a flat list enriched with metadata.

    Beyond the basic {id, name, value}, each entry also carries:
      - dtype / dtype_name  — lets callers pre-validate set_params writes
      - group_id            — parent group (so the UI can be reconstructed)
      - short_name          — compact label when the full DESC_NAME is verbose
      - help                — DESC_HELP tooltip text when present
      - unit                — DESC_UNIT (phys / degree / percent / meter / …)
      - min / max / step    — numeric ranges when the description sets them
      - default             — DESC_DEFAULT when present
      - cycle               — enum choices [{id, label}] for LONG+cycle params
    """
    if not hasattr(obj, "GetDescription"):
        return []
    desc = obj.GetDescription(c4d.DESCFLAGS_DESC_NONE)
    out: list[dict[str, Any]] = []
    for bc, paramid, groupid in desc:
        try:
            level = paramid[0]
            pid = level.id
            dtype = int(level.dtype)
        except Exception:
            continue
        name = bc.GetString(c4d.DESC_NAME) or bc.GetString(c4d.DESC_SHORT_NAME) or ""
        entry: dict[str, Any] = {
            "id": pid,
            "name": name,
            "dtype": dtype,
            "dtype_name": _DTYPE_NAMES.get(dtype, str(dtype)),
        }

        short = bc.GetString(c4d.DESC_SHORT_NAME)
        if short and short != name:
            entry["short_name"] = short
        if _DESC_KEY_HELP is not None:
            with contextlib.suppress(Exception):
                help_text = bc.GetString(_DESC_KEY_HELP)
                if help_text:
                    entry["help"] = help_text

        # Parent group — useful for reconstructing the Attribute Manager view.
        try:
            if groupid is not None and groupid.GetDepth() > 0:
                entry["group_id"] = int(groupid[0].id)
        except Exception:
            pass

        # Numeric metadata. GetData on DESC_MIN/MAX/etc. returns None when not
        # set, so we wrap each access defensively.
        for key, desc_const in (
            ("min", _DESC_KEY_MIN),
            ("max", _DESC_KEY_MAX),
            ("step", _DESC_KEY_STEP),
            ("default", _DESC_KEY_DEFAULT),
        ):
            if desc_const is None:
                continue
            try:
                val = bc.GetData(desc_const)
            except Exception:
                val = None
            if val is not None:
                safe = _json_safe(val)
                # BaseContainer returns complex defaults (e.g. vectors) that
                # round-trip through _json_safe fine. Skip None / empty dicts.
                if safe not in (None, {}):
                    entry[key] = safe

        try:
            unit = bc.GetInt32(_DESC_KEY_UNIT) if _DESC_KEY_UNIT is not None else None
        except Exception:
            unit = None
        if unit is not None and unit != 0:
            entry["unit"] = int(unit)

        cycle = bc.GetContainerInstance(c4d.DESC_CYCLE)
        if cycle is not None:
            entry["cycle"] = [{"id": k, "label": v} for k, v in cycle]

        try:
            val = obj[paramid]
            entry["value"] = _json_safe(val)
        except Exception:
            pass
        out.append(entry)
    return out


def _param_dtype(obj, pid: int) -> int | None:
    """Return the DTYPE of ``pid`` on ``obj`` by consulting GetDescription."""
    if not hasattr(obj, "GetDescription"):
        return None
    try:
        desc = obj.GetDescription(c4d.DESCFLAGS_DESC_NONE)
    except Exception:
        return None
    for _bc, paramid, _groupid in desc:
        try:
            level = paramid[0]
            if level.id == pid:
                return level.dtype
        except Exception:
            continue
    return None


_VECTOR_SUBIDS = {
    "x": c4d.VECTOR_X,
    "y": c4d.VECTOR_Y,
    "z": c4d.VECTOR_Z,
}


def _path_to_desc_id(obj, path: Any) -> tuple[c4d.DescID, list[Any]]:
    """Convert a JSON-friendly param path into a ``c4d.DescID``.

    Accepted shapes:
      - int                — single-level access: obj[pid]
      - [int, int, ...]    — chained DescID; each segment's dtype is inferred
                             from GetDescription (falls back to DTYPE_GROUP)
      - ["x"|"y"|"z"]      — string at an inner level resolves to VECTOR_X/Y/Z
                             and implies a DTYPE_REAL sub-level under a
                             DTYPE_VECTOR parent
      - Mixed list with dtype overrides: [[pid, "real"], [sub, "long"]]

    Returns ``(DescID, normalized_path_list)`` where the normalized path is
    the integer/string sequence after resolution — handy for echoing back to
    the caller.
    """
    if isinstance(path, bool):
        raise ValueError(f"path must be int or list, got bool {path!r}")
    if isinstance(path, int):
        dtype = _param_dtype(obj, int(path)) or c4d.DTYPE_GROUP
        return c4d.DescID(c4d.DescLevel(int(path), dtype, 0)), [int(path)]
    if not isinstance(path, (list, tuple)) or not path:
        raise ValueError(f"path must be a non-empty int or list, got {path!r}")

    dtype_aliases = {
        "real": c4d.DTYPE_REAL,
        "long": c4d.DTYPE_LONG,
        "bool": c4d.DTYPE_BOOL,
        "vector": c4d.DTYPE_VECTOR,
    }

    levels: list[c4d.DescLevel] = []
    normalized: list[Any] = []
    for idx, seg in enumerate(path):
        # Segment may itself be [id, "dtype"] for explicit overrides, or
        # [id, dtype_int, creator_int] when the path came from
        # _descid_to_list (user_data round-trip).
        creator_hint: int | None = None
        if isinstance(seg, (list, tuple)) and len(seg) == 2 and isinstance(seg[1], str):
            seg_id = seg[0]
            dtype_alias = seg[1].strip().lower()
            if dtype_alias not in dtype_aliases:
                raise ValueError(
                    f"unknown dtype alias {seg[1]!r}; accepted: {sorted(dtype_aliases)}"
                )
            dtype_hint: int | None = dtype_aliases[dtype_alias]
        elif (
            isinstance(seg, (list, tuple))
            and len(seg) in (2, 3)
            and all(isinstance(x, int) and not isinstance(x, bool) for x in seg)
        ):
            # Raw [id, dtype] or [id, dtype, creator] from the bridge echo.
            seg_id = seg[0]
            dtype_hint = int(seg[1])
            if len(seg) == 3:
                creator_hint = int(seg[2])
        else:
            seg_id = seg
            dtype_hint = None

        if isinstance(seg_id, str):
            key = seg_id.strip().lower()
            if key not in _VECTOR_SUBIDS:
                raise ValueError(
                    f"string segment must be 'x'|'y'|'z' for vector components, got {seg_id!r}"
                )
            sid = int(_VECTOR_SUBIDS[key])
            if dtype_hint is None:
                dtype_hint = c4d.DTYPE_REAL
            # A vector sub-component implies a vector parent — fix up the
            # previous level's dtype if GetDescription gave us something vague.
            if levels and int(levels[-1].dtype) in (c4d.DTYPE_GROUP, 0):
                levels[-1] = c4d.DescLevel(int(levels[-1].id), c4d.DTYPE_VECTOR, 0)
            normalized.append(seg_id)
        else:
            if isinstance(seg_id, bool) or not isinstance(seg_id, int):
                raise ValueError(f"path segment must be int or 'x/y/z', got {seg_id!r}")
            sid = int(seg_id)
            if dtype_hint is None and idx == 0:
                dtype_hint = _param_dtype(obj, sid) or c4d.DTYPE_GROUP
            normalized.append(sid)
        levels.append(
            c4d.DescLevel(sid, int(dtype_hint or c4d.DTYPE_GROUP), int(creator_hint or 0))
        )

    if len(levels) == 1:
        return c4d.DescID(levels[0]), normalized
    return c4d.DescID(*levels), normalized


def _dump_container(
    obj, id_from: int | None = None, id_to: int | None = None
) -> dict[str, Any] | None:
    if not hasattr(obj, "GetDataInstance"):
        return None
    bc = obj.GetDataInstance()
    if bc is None:
        return None
    out: dict[str, Any] = {}
    for k, v in bc:
        if id_from is not None and k < id_from:
            continue
        if id_to is not None and k > id_to:
            continue
        out[str(k)] = _json_safe(v)
    return out


def _summary(obj) -> dict[str, Any]:
    info: dict[str, Any] = {
        "name": obj.GetName() if hasattr(obj, "GetName") else None,
        "type_id": obj.GetType() if hasattr(obj, "GetType") else None,
        "type_name": obj.GetTypeName() if hasattr(obj, "GetTypeName") else None,
    }
    if isinstance(obj, c4d.BaseObject):
        info["path"] = _object_path(obj)
    return info


def _apply_name_pattern(
    entities: list[dict[str, Any]], pattern: str | None
) -> list[dict[str, Any]]:
    if not pattern:
        return entities
    import re

    try:
        rx = re.compile(pattern)
    except re.error as exc:
        raise ValueError(f"invalid name_pattern regex: {exc}") from exc
    return [e for e in entities if rx.search(str(e.get("name") or ""))]


# ---------------------------------------------------------------------------
# Mutation helpers
# ---------------------------------------------------------------------------


def _apply_params(obj, values: dict[str, Any]) -> None:
    for k, v in (values or {}).items():
        try:
            obj[int(k)] = v
        except Exception:
            if isinstance(v, (list, tuple)) and len(v) == 3:
                try:
                    obj[int(k)] = c4d.Vector(float(v[0]), float(v[1]), float(v[2]))
                    continue
                except Exception:
                    pass
            raise


# ---------------------------------------------------------------------------
# Aliases / constants shared by handlers
# ---------------------------------------------------------------------------


PRIMITIVE_TYPES: dict[str, int] = {
    "cube": c4d.Ocube,
    "sphere": c4d.Osphere,
    "cylinder": c4d.Ocylinder,
    "cone": c4d.Ocone,
    "torus": c4d.Otorus,
    "plane": c4d.Oplane,
    "disc": c4d.Odisc,
    "pyramid": c4d.Opyramid,
    "platonic": c4d.Oplatonic,
    "null": c4d.Onull,
}


def resolve_type_id(value) -> int:
    """Accept either a numeric type id or a PRIMITIVE_TYPES alias string.

    Keeps ``create_entity`` friendly to LLMs that think in English names
    ("cube") while still accepting the authoritative ``c4d.O*`` integers
    used by plugin authors.
    """
    if isinstance(value, bool):  # bool is a subclass of int — reject explicitly
        raise ValueError(f"type_id must be int or alias string, got bool {value!r}")
    if isinstance(value, int):
        return int(value)
    if isinstance(value, str):
        key = value.strip().lower()
        if key in PRIMITIVE_TYPES:
            return int(PRIMITIVE_TYPES[key])
        try:
            return int(value, 0)
        except ValueError as exc:
            raise ValueError(
                f"unknown type alias {value!r}; accepted: {sorted(PRIMITIVE_TYPES)} "
                "(or pass a numeric type id)"
            ) from exc
    raise ValueError(f"type_id must be int or alias string, got {type(value).__name__}")


RENDERER_ALIASES = {
    "standard": 0,
    "physical": 1023342,
    "redshift": 1036219,
    "octane": 1029525,
    "cycles": 1035287,
    "viewport": 300001061,
}

FRAME_SEQUENCE_ALIASES = {
    "manual": 0,
    "current": 1,
    "all": 2,
    "preview": 3,
    "custom": 4,
}


def _discover_renderer(name_lower: str) -> int | None:
    """Scan installed video-post plugins to find a renderer by name substring.

    Falls back here when RENDERER_ALIASES doesn't include the requested alias
    (e.g. Corona, Arnold, vendor renderers ship their own plugin). Name
    matching is a forgiving substring compare on the plugin display name.
    """
    try:
        import re

        rx = re.compile(re.escape(name_lower), re.IGNORECASE)
        for plugin in c4d.plugins.FilterPluginList(c4d.PLUGINTYPE_VIDEOPOST, True):
            try:
                nm = plugin.GetName() or ""
            except Exception:
                continue
            if rx.search(nm):
                return int(plugin.GetID())
    except Exception:
        return None
    return None


def resolve_renderer(value) -> int:
    if value is None:
        return 0
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return int(value)
    if isinstance(value, str):
        key = value.strip().lower()
        if key in RENDERER_ALIASES:
            return RENDERER_ALIASES[key]
        # Try parsing as a raw numeric id before falling back to plugin search
        # — LLMs sometimes paste the int as a string.
        with contextlib.suppress(ValueError):
            return int(key)
        discovered = _discover_renderer(key)
        if discovered is not None:
            return discovered
        raise ValueError(
            f"unknown renderer: {value!r} (known aliases: {sorted(RENDERER_ALIASES)}; "
            "also tried video_post plugin name search)"
        )
    raise ValueError(f"renderer must be int or string, got {type(value).__name__}")
