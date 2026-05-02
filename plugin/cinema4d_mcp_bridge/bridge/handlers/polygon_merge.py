"""High-level polygon-preserving merge for PolygonObject groups.

Built because ``c4d.utils.SendModelingCommand(MCOMMAND_JOIN)`` silently
drops polygons on PolygonObject inputs in C4D 2026 — it returns one
input as the "merged" output and discards the rest, with no error.

``handle_connect_polygon_objects`` aggregates the point and polygon
arrays manually in Python: strictly safer because it does not rely on
SendModelingCommand at all, and asserts polygon-count parity. Drops
vertex attribute tags (UVW / Phong / Selection / Vertex Color /
Vertex Normal); callers reapply textures via ``assign_material``
afterwards. When tag preservation matters, run the GUI 'Connect
Objects + Delete' command via ``call_command`` after looking up its
id with ``list_plugins(plugin_type="command", ...)``.
"""

from __future__ import annotations

from typing import Any

import c4d
from c4d import documents

from ._helpers import (
    _object_path,
    _resolve_handle,
    _summary,
)


def _resolve_polygon_targets(handles: list[Any]) -> list[c4d.PolygonObject]:
    """Resolve handles to PolygonObjects; raise with a CSO hint on type mismatch."""
    if not isinstance(handles, list) or len(handles) < 2:
        raise ValueError("objects must be a list of >= 2 PolygonObject handles")
    targets: list[c4d.PolygonObject] = []
    for h in handles:
        obj = _resolve_handle(h)
        if obj is None:
            raise ValueError(f"object handle not resolved: {h}")
        if not isinstance(obj, c4d.PolygonObject):
            raise ValueError(
                f"only PolygonObject handles are accepted; {h!r} is "
                f"{type(obj).__name__}. Run modeling_command "
                f"(command='current_state_to_object') to convert first."
            )
        targets.append(obj)
    return targets


def _resolve_target_parent(
    target_parent_h: Any, fallback_under: c4d.BaseObject
) -> c4d.BaseObject | None:
    """Resolve the parent under which the merged result should be inserted.

    Returns None when neither an explicit handle nor a fallback parent
    yields one — caller then inserts at root.
    """
    if target_parent_h is None:
        return fallback_under.GetUp()
    parent = _resolve_handle(target_parent_h)
    if parent is None:
        raise ValueError(f"target_parent not resolved: {target_parent_h}")
    if not isinstance(parent, c4d.BaseObject):
        raise ValueError("target_parent must resolve to a BaseObject")
    return parent


def _aggregate_geometry(
    targets: list[c4d.PolygonObject], dest_parent: c4d.BaseObject | None, preserve_world: bool
) -> tuple[list[c4d.Vector], list[c4d.CPolygon]]:
    """Concatenate points + polygon-index quads, rebasing per-source indices.

    When ``preserve_world`` is set, points are transformed into the target
    parent's local space so the merged mesh stays at the same world
    position (cancelling the source's Mg with the destination's inverse Mg).
    """
    if preserve_world:
        parent_mg = dest_parent.GetMg() if dest_parent is not None else c4d.Matrix()
        inv_parent_mg: c4d.Matrix | None = ~parent_mg
    else:
        inv_parent_mg = None

    points: list[c4d.Vector] = []
    polys: list[c4d.CPolygon] = []
    offset = 0
    for src in targets:
        src_pts = src.GetAllPoints()
        if inv_parent_mg is not None:
            mat = inv_parent_mg * src.GetMg()
            points.extend(mat * p for p in src_pts)
        else:
            points.extend(src_pts)
        polys.extend(
            c4d.CPolygon(p.a + offset, p.b + offset, p.c + offset, p.d + offset)
            for p in src.GetAllPolygons()
        )
        offset += len(src_pts)
    return points, polys


def handle_connect_polygon_objects(params: dict[str, Any]) -> dict[str, Any]:
    """Aggregate multiple PolygonObjects into one, asserting polygon-count parity.

    See module docstring for context. The asserted invariant is:
    ``sum(t.GetPolygonCount() for t in targets) == merged.GetPolygonCount()``.
    """
    targets = _resolve_polygon_targets(params.get("objects"))
    polys_in = sum(t.GetPolygonCount() for t in targets)
    points_in = sum(t.GetPointCount() for t in targets)
    if polys_in == 0:
        raise ValueError("input PolygonObjects have zero polygons; nothing to merge")

    doc = documents.GetActiveDocument()
    if doc is None:
        raise RuntimeError("no active document")

    delete_originals = bool(params.get("delete_originals", True))
    preserve_world = bool(params.get("preserve_world_position", True))
    target_parent = _resolve_target_parent(params.get("target_parent"), targets[0])
    target_name = params.get("target_name") or f"{targets[0].GetName() or 'Merged'}_merged"

    points, polys = _aggregate_geometry(targets, target_parent, preserve_world)
    # Defensive: GetAllPoints / GetAllPolygons should match GetPointCount /
    # GetPolygonCount, but a buggy plugin (or weird mesh state) could
    # produce a mismatch — fail loud rather than silently truncating.
    if len(points) != points_in or len(polys) != polys_in:
        raise RuntimeError(
            f"aggregation mismatch — points {len(points)}/{points_in}, "
            f"polys {len(polys)}/{polys_in}"
        )

    merged = c4d.PolygonObject(len(points), len(polys))
    if merged is None:
        raise RuntimeError("PolygonObject allocation failed")
    merged.SetName(str(target_name))
    merged.SetAllPoints(points)
    for i, poly in enumerate(polys):
        merged.SetPolygon(i, poly)
    merged.Message(c4d.MSG_UPDATE)

    doc.StartUndo()
    try:
        if target_parent is not None:
            merged.InsertUnder(target_parent)
        else:
            doc.InsertObject(merged)
        doc.AddUndo(c4d.UNDOTYPE_NEW, merged)
        if delete_originals:
            for src in targets:
                if src.GetDocument() is None:
                    continue
                doc.AddUndo(c4d.UNDOTYPE_DELETE, src)
                src.Remove()
    finally:
        doc.EndUndo()
    c4d.EventAdd()

    summary = _summary(merged)
    summary["handle"] = {"kind": "object", "path": _object_path(merged), "name": merged.GetName()}
    summary["polygon_count"] = merged.GetPolygonCount()
    summary["point_count"] = merged.GetPointCount()
    return {
        "ok": True,
        "merged": summary,
        "polys_in": polys_in,
        "polys_out": merged.GetPolygonCount(),
        "points_in": points_in,
        "points_out": merged.GetPointCount(),
        "originals_deleted": delete_originals,
        "merged_count": len(targets),
    }
