"""Mesh read/write handlers: get_mesh, set_mesh.

Works on ``c4d.PointObject`` and its subclasses (``PolygonObject``,
``SplineObject``). Primitives (Cube, Sphere, …) aren't editable — callers
need to run ``modeling_command make_editable`` first and the handler raises
with that hint so LLMs can self-correct.

Point counts are capped at ``_MAX_POINTS`` by default to prevent unbounded
JSON payloads from high-poly assets; callers can raise the cap per-call.
"""

from __future__ import annotations

import contextlib
from typing import Any

import c4d
from c4d import documents

from ._helpers import _object_path, _resolve_handle

_MAX_POINTS = 50_000
_MAX_POLYGONS = 50_000


def _require_editable(obj: Any) -> c4d.PointObject:
    if not isinstance(obj, c4d.PointObject):
        raise ValueError(
            f"handle did not resolve to an editable PointObject "
            f"(got {type(obj).__name__}). Run modeling_command "
            f"make_editable / current_state_to_object first."
        )
    return obj


def handle_get_mesh(params: dict[str, Any]) -> dict[str, Any]:
    """Read points and polygons (or spline segments) from an editable object.

    params:
      handle:      target
      max_points:  optional int cap (default 50_000)
      max_polys:   optional int cap (default 50_000)
      include:     optional list — subset of
                   ["normals", "selections"]; points+polygons/segments are
                   always returned. "selections" adds ``point_selection``,
                   ``poly_selection``, ``edge_selection`` as sorted index
                   lists drawn from the BaseSelect components of the mesh.
    """
    h = params.get("handle")
    if not h:
        raise ValueError("handle required")
    obj = _resolve_handle(h)
    if obj is None:
        raise ValueError(f"handle not resolved: {h}")
    point_obj = _require_editable(obj)

    max_points = int(params.get("max_points") or _MAX_POINTS)
    max_polys = int(params.get("max_polys") or _MAX_POLYGONS)
    include = {str(x).lower() for x in (params.get("include") or [])}

    point_count = point_obj.GetPointCount()
    if point_count > max_points:
        raise ValueError(
            f"mesh has {point_count} points (> max_points={max_points}). "
            "Raise max_points or select a smaller region."
        )
    points_raw = point_obj.GetAllPoints() or []
    points = [[p.x, p.y, p.z] for p in points_raw]

    out: dict[str, Any] = {
        "handle": {"kind": "object", "path": _object_path(point_obj), "name": point_obj.GetName()},
        "point_count": point_count,
        "points": points,
    }

    if isinstance(point_obj, c4d.PolygonObject):
        poly_count = point_obj.GetPolygonCount()
        if poly_count > max_polys:
            raise ValueError(
                f"mesh has {poly_count} polygons (> max_polys={max_polys}). "
                "Raise max_polys or select a smaller region."
            )
        polys_raw = point_obj.GetAllPolygons() or []
        # Compact triangles as [a,b,c]; keep quads as [a,b,c,d]. C4D stores
        # triangles as quads with c == d.
        polys: list[list[int]] = []
        for p in polys_raw:
            if p.c == p.d:
                polys.append([p.a, p.b, p.c])
            else:
                polys.append([p.a, p.b, p.c, p.d])
        out["type"] = "polygon"
        out["polygon_count"] = poly_count
        out["polygons"] = polys

        if "normals" in include:
            try:
                normals = point_obj.CreatePhongNormals()
                if normals is not None:
                    out["normals"] = [[n.x, n.y, n.z] for n in normals]
            except Exception as exc:
                out["normals_error"] = f"{type(exc).__name__}: {exc}"

    elif isinstance(point_obj, c4d.SplineObject):
        seg_count = point_obj.GetSegmentCount()
        # Older builds return {'cnt': N, 'closed': bool} from GetSegment; newer
        # expose it as an attribute. Normalize both shapes.
        segments: list[dict[str, Any]] = []
        for i in range(seg_count):
            seg = point_obj.GetSegment(i)
            if isinstance(seg, dict):
                cnt = int(seg.get("cnt", 0))
                closed = bool(seg.get("closed"))
            else:
                cnt = int(getattr(seg, "cnt", 0))
                closed = bool(getattr(seg, "closed", False))
            segments.append({"count": cnt, "closed": closed})
        out["type"] = "spline"
        out["segment_count"] = seg_count
        out["segments"] = segments

    else:
        out["type"] = "point"

    if "selections" in include:
        out.update(_collect_selections(point_obj))

    return out


def _baseselect_to_list(sel: c4d.BaseSelect | None, element_count: int) -> list[int]:
    """Materialise a BaseSelect into a list of selected indices.

    ``element_count`` is the number of addressable primitives on the mesh
    (points / polygons / edges). ``BaseSelect.GetCount()`` returns storage
    size, not element count, so we iterate against the mesh-side count and
    probe each index with ``IsSelected``.
    """
    if sel is None or element_count <= 0:
        return []
    indices: list[int] = []
    try:
        for i in range(element_count):
            if sel.IsSelected(i):
                indices.append(i)
    except Exception:
        return []
    return indices


def _collect_selections(point_obj: c4d.PointObject) -> dict[str, Any]:
    out: dict[str, Any] = {}
    pt_count = point_obj.GetPointCount()
    with contextlib.suppress(Exception):
        out["point_selection"] = _baseselect_to_list(point_obj.GetPointS(), pt_count)
    if isinstance(point_obj, c4d.PolygonObject):
        poly_count = point_obj.GetPolygonCount()
        # Edges are 4 per polygon (C4D stores each quad as having 4 edges;
        # triangles still use the 4-slot CPolygon).
        edge_count = poly_count * 4
        with contextlib.suppress(Exception):
            out["poly_selection"] = _baseselect_to_list(point_obj.GetPolygonS(), poly_count)
        with contextlib.suppress(Exception):
            out["edge_selection"] = _baseselect_to_list(point_obj.GetEdgeS(), edge_count)
    return out


def handle_set_mesh_selection(params: dict[str, Any]) -> dict[str, Any]:
    """Overwrite point / polygon / edge selection on an editable mesh.

    params:
      handle:    target (PointObject / PolygonObject)
      kind:      "point" | "polygon" | "edge"
      indices:   list[int] to select. Existing selection is fully replaced.
    """
    h = params.get("handle")
    kind = str(params.get("kind", "")).lower()
    indices = params.get("indices")
    if not h:
        raise ValueError("handle required")
    if kind not in ("point", "polygon", "edge"):
        raise ValueError("kind must be 'point' | 'polygon' | 'edge'")
    if not isinstance(indices, list):
        raise ValueError("indices must be a list of int")

    obj = _resolve_handle(h)
    if obj is None:
        raise ValueError(f"handle not resolved: {h}")
    point_obj = _require_editable(obj)

    doc = documents.GetActiveDocument()
    if doc is None:
        raise RuntimeError("no active document")

    doc.StartUndo()
    try:
        doc.AddUndo(c4d.UNDOTYPE_CHANGE_SELECTION, point_obj)
        if kind == "point":
            sel = point_obj.GetPointS()
        elif kind == "polygon":
            if not isinstance(point_obj, c4d.PolygonObject):
                raise ValueError("polygon selection requires a PolygonObject")
            sel = point_obj.GetPolygonS()
        else:
            if not isinstance(point_obj, c4d.PolygonObject):
                raise ValueError("edge selection requires a PolygonObject")
            sel = point_obj.GetEdgeS()

        sel.DeselectAll()
        for i in indices:
            sel.Select(int(i))
        point_obj.Message(c4d.MSG_UPDATE)
    finally:
        doc.EndUndo()
    c4d.EventAdd()

    return {
        "handle": {"kind": "object", "path": _object_path(point_obj), "name": point_obj.GetName()},
        "kind": kind,
        "count": len(indices),
    }


def handle_set_mesh(params: dict[str, Any]) -> dict[str, Any]:
    """Overwrite the points (and optionally polygons) of an editable object.

    params:
      handle:   target PointObject / PolygonObject
      points:   list of [x,y,z]
      polygons: list of [a,b,c,d] or [a,b,c] (triangles are expanded to quads)

    If ``polygons`` is omitted, only points are rewritten (count must match).
    """
    h = params.get("handle")
    if not h:
        raise ValueError("handle required")
    points = params.get("points")
    if not isinstance(points, list):
        raise ValueError("points must be a list of [x,y,z]")
    polygons = params.get("polygons")
    if polygons is not None and not isinstance(polygons, list):
        raise ValueError("polygons must be a list of [a,b,c,d] (or [a,b,c])")

    obj = _resolve_handle(h)
    if obj is None:
        raise ValueError(f"handle not resolved: {h}")
    point_obj = _require_editable(obj)

    doc = documents.GetActiveDocument()
    if doc is None:
        raise RuntimeError("no active document")

    doc.StartUndo()
    try:
        doc.AddUndo(c4d.UNDOTYPE_CHANGE, point_obj)

        new_points = len(points)
        if polygons is not None and isinstance(point_obj, c4d.PolygonObject):
            # Resize both channels atomically. ResizeObject keeps existing
            # data where it can, but we overwrite everything below anyway.
            if not point_obj.ResizeObject(new_points, len(polygons)):
                raise RuntimeError("ResizeObject failed")
            for i, p in enumerate(points):
                point_obj.SetPoint(i, c4d.Vector(float(p[0]), float(p[1]), float(p[2])))
            for i, poly in enumerate(polygons):
                if len(poly) == 3:
                    a, b, c_ = int(poly[0]), int(poly[1]), int(poly[2])
                    point_obj.SetPolygon(i, c4d.CPolygon(a, b, c_, c_))
                elif len(poly) == 4:
                    point_obj.SetPolygon(
                        i,
                        c4d.CPolygon(int(poly[0]), int(poly[1]), int(poly[2]), int(poly[3])),
                    )
                else:
                    raise ValueError(f"polygon[{i}] must have 3 or 4 indices, got {len(poly)}")
        else:
            # Point-only resize (spline or PolygonObject with preserved topology).
            if new_points != point_obj.GetPointCount():
                if isinstance(point_obj, c4d.PolygonObject):
                    if not point_obj.ResizeObject(new_points, point_obj.GetPolygonCount()):
                        raise RuntimeError("ResizeObject failed")
                else:
                    # SplineObject uses a (points, segments) signature too.
                    seg_count = (
                        point_obj.GetSegmentCount() if hasattr(point_obj, "GetSegmentCount") else 0
                    )
                    if not point_obj.ResizeObject(new_points, seg_count):
                        raise RuntimeError("ResizeObject failed")
            for i, p in enumerate(points):
                point_obj.SetPoint(i, c4d.Vector(float(p[0]), float(p[1]), float(p[2])))

        point_obj.Message(c4d.MSG_UPDATE)
    finally:
        doc.EndUndo()
    c4d.EventAdd()

    return {
        "handle": {"kind": "object", "path": _object_path(point_obj), "name": point_obj.GetName()},
        "point_count": point_obj.GetPointCount(),
        "polygon_count": (
            point_obj.GetPolygonCount() if isinstance(point_obj, c4d.PolygonObject) else 0
        ),
    }
