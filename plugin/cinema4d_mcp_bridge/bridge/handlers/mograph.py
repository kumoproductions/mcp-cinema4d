"""MoGraph reader: ``list_mograph_clones``.

Reads per-clone transforms from a Cloner (or any MoGraph generator that
fills a MoData array) after forcing an ExecutePasses so the MoData is
populated. Returns offset vectors + full matrices so callers can sample
the iterated geometry without converting the cloner to polygons.

Write-side MoData mutation is intentionally out of scope — the shape and
required flags vary heavily by effector stack, so we leave authoring to
exec_python + c4d.modules.mograph.
"""

from __future__ import annotations

import contextlib
from typing import Any

import c4d
from c4d import documents

try:
    from c4d.modules import mograph as _mograph

    _MOGRAPH_AVAILABLE = True
except ImportError:
    _mograph = None  # type: ignore[assignment]
    _MOGRAPH_AVAILABLE = False

from ._helpers import _object_path, _resolve_handle


def _matrix_rows(m: c4d.Matrix) -> list[list[float]]:
    return [
        [m.off.x, m.off.y, m.off.z],
        [m.v1.x, m.v1.y, m.v1.z],
        [m.v2.x, m.v2.y, m.v2.z],
        [m.v3.x, m.v3.y, m.v3.z],
    ]


def handle_list_mograph_clones(params: dict[str, Any]) -> dict[str, Any]:
    """Return per-clone transforms from a MoGraph generator.

    params:
      handle:    cloner / matrix / whatever feeds GeGetMoData
      max_count: cap on the number of clones returned (default 2048)
      include_matrix: when True (default), include the full 4x3 matrix per clone
    """
    h = params.get("handle")
    if not h:
        raise ValueError("handle required")
    if not _MOGRAPH_AVAILABLE:
        return {"supported": False, "reason": "c4d.modules.mograph unavailable", "clones": []}

    obj = _resolve_handle(h)
    if obj is None or not isinstance(obj, c4d.BaseObject):
        raise ValueError(f"handle did not resolve to a BaseObject: {h}")

    doc = documents.GetActiveDocument()
    if doc is None:
        raise RuntimeError("no active document")

    # MoData is only populated after the scene evaluates the generator. Force
    # a pass so we don't return a stale / empty array.
    with contextlib.suppress(Exception):
        doc.ExecutePasses(None, True, True, True, c4d.BUILDFLAGS_NONE)

    md = _mograph.GeGetMoData(obj)
    if md is None:
        return {
            "supported": False,
            "reason": f"{obj.GetTypeName()} exposes no MoData",
            "handle": {"kind": "object", "path": _object_path(obj), "name": obj.GetName()},
            "clones": [],
        }

    max_count = int(params.get("max_count") or 2048)
    include_matrix = bool(params.get("include_matrix", True))

    count = md.GetCount()
    capped = min(count, max_count)

    matrices = md.GetArray(c4d.MODATA_MATRIX) or []
    clones: list[dict[str, Any]] = []
    for i in range(capped):
        m = matrices[i] if i < len(matrices) else None
        if m is None:
            continue
        entry: dict[str, Any] = {"index": i, "pos": [m.off.x, m.off.y, m.off.z]}
        if include_matrix:
            entry["matrix"] = _matrix_rows(m)
        clones.append(entry)

    return {
        "supported": True,
        "handle": {"kind": "object", "path": _object_path(obj), "name": obj.GetName()},
        "count": count,
        "returned": len(clones),
        "clones": clones,
    }
