"""User data handlers: add / list / remove UD slots on any BaseList2D.

Rigging and per-asset control exposure typically goes through User Data (the
Attributes Manager's Basic / User Data tab). The SDK flow is:

  bc = c4d.GetCustomDataTypeDefault(DTYPE_*)
  bc[c4d.DESC_NAME] = "..."
  descid = obj.AddUserData(bc)
  obj[descid] = value

This module exposes those three steps as one ``add_user_data`` call plus
inspection / removal companions. DescIDs are surfaced as JSON-friendly lists
like ``[[700, 23, 0], [5, 0, 0]]`` that can be piped back into
``get_params`` / ``set_params`` via the Phase-B1 DescID-path API.
"""

from __future__ import annotations

import contextlib
from typing import Any

import c4d

from ._helpers import _json_safe, _resolve_handle

_DTYPE_ALIASES: dict[str, int] = {
    "real": c4d.DTYPE_REAL,
    "long": c4d.DTYPE_LONG,
    "bool": c4d.DTYPE_BOOL,
    "vector": c4d.DTYPE_VECTOR,
    "string": c4d.DTYPE_STRING,
    "color": c4d.DTYPE_COLOR,
    "filename": c4d.DTYPE_FILENAME,
    "time": c4d.DTYPE_TIME,
    "link": c4d.DTYPE_BASELISTLINK,
}

_DTYPE_NAMES: dict[int, str] = {v: k for k, v in _DTYPE_ALIASES.items()}


def _resolve_dtype(alias: str) -> int:
    key = alias.strip().lower()
    if key not in _DTYPE_ALIASES:
        raise ValueError(f"unknown dtype {alias!r}; accepted: {sorted(_DTYPE_ALIASES)}")
    return _DTYPE_ALIASES[key]


def _descid_to_list(did: c4d.DescID) -> list[list[int]]:
    """Serialize a DescID as [[id, dtype, creator], ...]."""
    out: list[list[int]] = []
    try:
        depth = did.GetDepth()
    except Exception:
        depth = 1
    for i in range(depth):
        lvl = did[i]
        out.append([int(lvl.id), int(lvl.dtype), int(lvl.creator)])
    return out


def _list_to_descid(path: Any) -> c4d.DescID:
    """Rebuild a DescID from the [[id, dtype, creator], ...] shape above."""
    if not isinstance(path, (list, tuple)) or not path:
        raise ValueError(f"desc_id must be a non-empty list, got {path!r}")
    levels: list[c4d.DescLevel] = []
    for seg in path:
        if not isinstance(seg, (list, tuple)) or len(seg) < 2:
            raise ValueError(f"desc_id level must be [id, dtype, creator?], got {seg!r}")
        sid = int(seg[0])
        dtype = int(seg[1])
        creator = int(seg[2]) if len(seg) >= 3 else 0
        levels.append(c4d.DescLevel(sid, dtype, creator))
    if len(levels) == 1:
        return c4d.DescID(levels[0])
    return c4d.DescID(*levels)


def handle_add_user_data(params: dict[str, Any]) -> dict[str, Any]:
    """Add a User Data slot to the target.

    params:
      handle:  target (any BaseList2D that supports AddUserData)
      name:    display name (required)
      dtype:   'real' | 'long' | 'bool' | 'vector' | 'string' | 'color' |
               'filename' | 'time' | 'link'
      value:   optional initial value (auto-coerced for vectors)
      default: optional default (stored on the UD descriptor)
      min, max, step: numeric bounds (optional, real/long only)
    """
    h = params.get("handle")
    name = params.get("name")
    dtype_alias = params.get("dtype")
    if not h:
        raise ValueError("handle required")
    if not isinstance(name, str) or not name:
        raise ValueError("name required (string)")
    if not isinstance(dtype_alias, str):
        raise ValueError("dtype required (string alias)")

    obj = _resolve_handle(h)
    if obj is None:
        raise ValueError(f"handle not resolved: {h}")
    if not hasattr(obj, "AddUserData"):
        raise ValueError(f"target does not support AddUserData: {type(obj).__name__}")

    dtype = _resolve_dtype(dtype_alias)

    bc = c4d.GetCustomDataTypeDefault(dtype)
    if bc is None:
        raise RuntimeError(
            f"GetCustomDataTypeDefault({dtype}) returned None — "
            f"dtype {dtype_alias!r} unsupported on this build"
        )
    bc[c4d.DESC_NAME] = name
    # DESC_SHORTNAME / DESC_ANIMATE aren't guaranteed across versions (2026
    # dropped DESC_SHORTNAME). Probe via getattr so a missing constant
    # doesn't fail the entire call — the slot still works without the
    # short-name / animate-flag hints.
    short_key = getattr(c4d, "DESC_SHORTNAME", None) or getattr(c4d, "DESC_SHORT_NAME", None)
    if short_key is not None:
        with contextlib.suppress(Exception):
            bc[short_key] = name
    animate_key = getattr(c4d, "DESC_ANIMATE", None)
    animate_val = getattr(c4d, "DESC_ANIMATE_ON", None)
    if animate_key is not None and animate_val is not None:
        with contextlib.suppress(Exception):
            bc[animate_key] = animate_val

    for key, desc_const in (
        ("min", c4d.DESC_MIN),
        ("max", c4d.DESC_MAX),
        ("step", c4d.DESC_STEP),
        ("default", c4d.DESC_DEFAULT),
    ):
        if key in params and params[key] is not None:
            with contextlib.suppress(Exception):
                bc[desc_const] = params[key]

    did = obj.AddUserData(bc)
    if did is None:
        raise RuntimeError("AddUserData returned None")

    value = params.get("value")
    if value is not None:
        coerced = value
        if (
            dtype in (c4d.DTYPE_VECTOR, c4d.DTYPE_COLOR)
            and isinstance(value, (list, tuple))
            and len(value) == 3
        ):
            coerced = c4d.Vector(float(value[0]), float(value[1]), float(value[2]))
        obj[did] = coerced

    c4d.EventAdd()

    return {
        "desc_id": _descid_to_list(did),
        "name": name,
        "dtype": _DTYPE_NAMES.get(dtype, str(dtype)),
        "value": _json_safe(obj[did]) if value is not None else None,
    }


def handle_list_user_data(params: dict[str, Any]) -> dict[str, Any]:
    """Enumerate user-data slots on the target."""
    h = params.get("handle")
    if not h:
        raise ValueError("handle required")
    obj = _resolve_handle(h)
    if obj is None:
        raise ValueError(f"handle not resolved: {h}")
    if not hasattr(obj, "GetUserDataContainer"):
        return {"entries": [], "count": 0}

    out: list[dict[str, Any]] = []
    for did, bc in obj.GetUserDataContainer() or []:
        try:
            name = bc.GetString(c4d.DESC_NAME) or ""
        except Exception:
            name = ""
        dtype = None
        with contextlib.suppress(Exception):
            dtype = int(did[0].dtype)
        entry: dict[str, Any] = {
            "desc_id": _descid_to_list(did),
            "name": name,
            "dtype": _DTYPE_NAMES.get(dtype or -1, str(dtype)),
        }
        with contextlib.suppress(Exception):
            entry["value"] = _json_safe(obj[did])
        out.append(entry)
    return {"entries": out, "count": len(out)}


def handle_remove_user_data(params: dict[str, Any]) -> dict[str, Any]:
    """Delete a user-data slot by its DescID path (as returned by list_user_data)."""
    h = params.get("handle")
    desc_id = params.get("desc_id")
    if not h:
        raise ValueError("handle required")
    if desc_id is None:
        raise ValueError("desc_id required")
    obj = _resolve_handle(h)
    if obj is None:
        raise ValueError(f"handle not resolved: {h}")
    if not hasattr(obj, "RemoveUserData"):
        raise ValueError(f"target does not support RemoveUserData: {type(obj).__name__}")

    did = _list_to_descid(desc_id)
    ok = obj.RemoveUserData(did)
    c4d.EventAdd()
    return {"removed": bool(ok), "desc_id": desc_id}
