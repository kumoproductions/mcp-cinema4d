"""Animation read handlers: list_tracks, get_keyframes.

Provides inspection-side coverage to complement ``set_keyframe``. Decodes
CTrack DescIDs into the same ``param_id`` / ``component`` shape the setter
accepts, so callers can round-trip (list → read → write) without juggling
raw DescLevel objects.
"""

from __future__ import annotations

import contextlib
from typing import Any

import c4d
from c4d import documents

from ._helpers import _resolve_handle

_DTYPE_NAMES: dict[int, str] = {
    c4d.DTYPE_REAL: "real",
    c4d.DTYPE_LONG: "long",
    c4d.DTYPE_BOOL: "bool",
    c4d.DTYPE_VECTOR: "vector",
}

_INTERP_NAMES: dict[int, str] = {
    c4d.CINTERPOLATION_LINEAR: "linear",
    c4d.CINTERPOLATION_SPLINE: "spline",
    c4d.CINTERPOLATION_STEP: "step",
}

_COMPONENT_FROM_VECTOR_ID = {
    c4d.VECTOR_X: "x",
    c4d.VECTOR_Y: "y",
    c4d.VECTOR_Z: "z",
}


def _describe_track(track: c4d.CTrack) -> dict[str, Any]:
    did = track.GetDescriptionID()
    top = did[0]
    entry: dict[str, Any] = {
        "name": track.GetName(),
        "param_id": int(top.id),
        "dtype": _DTYPE_NAMES.get(int(top.dtype), str(int(top.dtype))),
        "component": None,
    }
    # Depth > 1 = vector component track. The inner DescLevel's id maps to
    # the VECTOR_X/Y/Z enum. Anything else we surface as a raw sub-id so
    # callers can still distinguish it.
    try:
        depth = did.GetDepth()
    except Exception:
        depth = 1
    if depth > 1:
        try:
            sub_id = int(did[1].id)
        except Exception:
            sub_id = None
        if sub_id is not None:
            entry["component"] = _COMPONENT_FROM_VECTOR_ID.get(sub_id, str(sub_id))

    curve = track.GetCurve()
    entry["key_count"] = curve.GetKeyCount() if curve is not None else 0
    return entry


def handle_list_tracks(params: dict[str, Any]) -> dict[str, Any]:
    """Enumerate CTracks on the resolved entity.

    params:
      handle: target (BaseList2D that supports GetCTracks)
    """
    h = params.get("handle")
    if not h:
        raise ValueError("handle required")
    obj = _resolve_handle(h)
    if obj is None:
        raise ValueError(f"handle not resolved: {h}")
    if not hasattr(obj, "GetCTracks"):
        raise ValueError(f"handle {h!r} has no animation tracks (GetCTracks unavailable)")

    tracks = obj.GetCTracks() or []
    out = [_describe_track(t) for t in tracks]
    return {"tracks": out, "count": len(out)}


def _find_track(obj: c4d.BaseList2D, param_id: int, component: str | None) -> c4d.CTrack | None:
    """Locate the CTrack for (param_id, component) on an animated object."""
    tracks = obj.GetCTracks() or []
    vec_id = None
    if component is not None:
        vec_map = {"x": c4d.VECTOR_X, "y": c4d.VECTOR_Y, "z": c4d.VECTOR_Z}
        if component not in vec_map:
            raise ValueError(f"component must be x/y/z or null, got {component!r}")
        vec_id = vec_map[component]
    for t in tracks:
        did = t.GetDescriptionID()
        top = did[0]
        if int(top.id) != int(param_id):
            continue
        try:
            depth = did.GetDepth()
        except Exception:
            depth = 1
        if vec_id is None:
            if depth == 1:
                return t
        else:
            if depth > 1:
                with contextlib.suppress(Exception):
                    if int(did[1].id) == int(vec_id):
                        return t
    return None


def handle_get_keyframes(params: dict[str, Any]) -> dict[str, Any]:
    """Read keys from a specific CTrack.

    params:
      handle:       target
      param_id:     top-level description id
      component:    "x"/"y"/"z"/null
      start_frame:  inclusive lower bound (optional)
      end_frame:    inclusive upper bound (optional)
      fps:          override for BaseTime conversion (default: doc fps)
    """
    h = params.get("handle")
    pid = params.get("param_id")
    if not h:
        raise ValueError("handle required")
    if pid is None:
        raise ValueError("param_id required")
    obj = _resolve_handle(h)
    if obj is None:
        raise ValueError(f"handle not resolved: {h}")
    if not hasattr(obj, "GetCTracks"):
        raise ValueError(f"handle {h!r} has no animation tracks")

    component = params.get("component")
    track = _find_track(obj, int(pid), component)
    if track is None:
        return {"keys": [], "track": None, "count": 0}

    curve = track.GetCurve()
    if curve is None:
        return {"keys": [], "track": _describe_track(track), "count": 0}

    doc = documents.GetActiveDocument()
    fps = int(params.get("fps") or (doc.GetFps() if doc else 30))
    start_frame = params.get("start_frame")
    end_frame = params.get("end_frame")

    keys: list[dict[str, Any]] = []
    for i in range(curve.GetKeyCount()):
        k = curve.GetKey(i)
        frame = int(k.GetTime().GetFrame(fps))
        if start_frame is not None and frame < int(start_frame):
            continue
        if end_frame is not None and frame > int(end_frame):
            continue
        # Track.GetInterpolation takes the key; fall back on the value's own
        # accessor for builds where the signature varies.
        interp_id = None
        with contextlib.suppress(Exception):
            interp_id = int(k.GetInterpolation())
        keys.append(
            {
                "frame": frame,
                "value": float(k.GetValue()),
                "interp": _INTERP_NAMES.get(interp_id or -1, str(interp_id)),
            }
        )

    return {
        "track": _describe_track(track),
        "keys": keys,
        "count": len(keys),
    }


def handle_delete_keyframe(params: dict[str, Any]) -> dict[str, Any]:
    """Delete keys on a CTrack.

    params:
      handle:       target
      param_id:     top-level id
      component:    "x"/"y"/"z"/null
      frame:        single frame to delete (exclusive with start/end)
      start_frame, end_frame: inclusive range to delete
      fps:          override for BaseTime → frame conversion
    """
    h = params.get("handle")
    pid = params.get("param_id")
    if not h:
        raise ValueError("handle required")
    if pid is None:
        raise ValueError("param_id required")
    obj = _resolve_handle(h)
    if obj is None:
        raise ValueError(f"handle not resolved: {h}")
    if not hasattr(obj, "GetCTracks"):
        raise ValueError(f"handle {h!r} has no animation tracks")

    component = params.get("component")
    track = _find_track(obj, int(pid), component)
    if track is None:
        return {"removed": 0, "track": None}
    curve = track.GetCurve()
    if curve is None:
        return {"removed": 0, "track": _describe_track(track)}

    frame = params.get("frame")
    start_frame = params.get("start_frame")
    end_frame = params.get("end_frame")
    if frame is not None and (start_frame is not None or end_frame is not None):
        raise ValueError("frame is exclusive with start_frame / end_frame")

    doc = documents.GetActiveDocument()
    fps = int(params.get("fps") or (doc.GetFps() if doc else 30))

    if doc is not None:
        doc.StartUndo()
        with contextlib.suppress(Exception):
            doc.AddUndo(c4d.UNDOTYPE_CHANGE, track)

    removed = 0
    try:
        # Walk keys in reverse so index-based DelKey stays valid mid-iteration.
        for i in range(curve.GetKeyCount() - 1, -1, -1):
            k = curve.GetKey(i)
            f = int(k.GetTime().GetFrame(fps))
            if frame is not None:
                if f != int(frame):
                    continue
            else:
                if start_frame is not None and f < int(start_frame):
                    continue
                if end_frame is not None and f > int(end_frame):
                    continue
            curve.DelKey(i)
            removed += 1
    finally:
        if doc is not None:
            doc.EndUndo()
    c4d.EventAdd()

    return {
        "removed": removed,
        "track": _describe_track(track),
    }


def handle_delete_track(params: dict[str, Any]) -> dict[str, Any]:
    """Remove an entire CTrack from a target.

    params:
      handle:    target
      param_id:  top-level id
      component: "x"/"y"/"z"/null
    """
    h = params.get("handle")
    pid = params.get("param_id")
    if not h:
        raise ValueError("handle required")
    if pid is None:
        raise ValueError("param_id required")
    obj = _resolve_handle(h)
    if obj is None:
        raise ValueError(f"handle not resolved: {h}")
    if not hasattr(obj, "GetCTracks"):
        raise ValueError(f"handle {h!r} has no animation tracks")

    track = _find_track(obj, int(pid), params.get("component"))
    if track is None:
        return {"removed": False}

    doc = documents.GetActiveDocument()
    if doc is not None:
        doc.StartUndo()
        with contextlib.suppress(Exception):
            doc.AddUndo(c4d.UNDOTYPE_DELETE, track)
    try:
        track.Remove()
    finally:
        if doc is not None:
            doc.EndUndo()
    c4d.EventAdd()
    return {"removed": True}
