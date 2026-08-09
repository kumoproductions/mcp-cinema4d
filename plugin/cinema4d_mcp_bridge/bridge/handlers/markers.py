"""Timeline marker handlers: ``create_marker``, ``list_markers``,
``set_marker``, ``remove_marker``.

Wraps Cinema 4D's document-level timeline markers (TLMarker). Markers live on
the document — not in the object tree — so they are reached through
``c4d.documents.AddMarker`` / ``GetFirstMarker`` rather than the generic
handle system. Each marker is a ``BaseList2D`` chained by ``GetNext()`` whose
position / length / colour live in its container (``TLMARKER_TIME`` /
``TLMARKER_LENGTH`` / ``TLMARKER_COLOR``) and whose label is its node name.

These tools replace the previous workaround of repeatedly seeking the
playhead and firing the "Create Marker at Current Frame" command, which could
only drop unnamed markers and gave no way to read or edit them back.
"""

from __future__ import annotations

from typing import Any

import c4d
from c4d import documents

# Resolved once via getattr so a build that renames/drops a constant fails with
# a readable error at use time instead of an import error for the whole module.
_TLMARKER_TIME = getattr(c4d, "TLMARKER_TIME", None)
_TLMARKER_LENGTH = getattr(c4d, "TLMARKER_LENGTH", None)
_TLMARKER_COLOR = getattr(c4d, "TLMARKER_COLOR", None)


def _iter_markers(doc) -> list[Any]:
    """Return every timeline marker in document chain order."""
    out: list[Any] = []
    m = documents.GetFirstMarker(doc)
    while m is not None:
        out.append(m)
        m = m.GetNext()
    return out


def _marker_time(marker) -> c4d.BaseTime | None:
    """Read a marker's position as a BaseTime, or None if unavailable."""
    if _TLMARKER_TIME is None:
        return None
    try:
        t = marker[_TLMARKER_TIME]
    except Exception:
        return None
    return t if isinstance(t, c4d.BaseTime) else None


def _marker_info(marker, fps: int, index: int) -> dict[str, Any]:
    """Serialize a marker into a JSON-friendly dict.

    ``index`` is the marker's position in the document chain — the stable-ish
    handle accepted by ``set_marker`` / ``remove_marker`` (markers may share a
    name, so the name alone is not a reliable identifier).
    """
    info: dict[str, Any] = {"index": index, "name": marker.GetName() or ""}

    t = _marker_time(marker)
    if t is not None:
        info["frame"] = int(t.GetFrame(fps))
        info["time_seconds"] = float(t.Get())

    if _TLMARKER_LENGTH is not None:
        try:
            length = marker[_TLMARKER_LENGTH]
        except Exception:
            length = None
        if isinstance(length, c4d.BaseTime):
            info["length_frames"] = int(length.GetFrame(fps))

    if _TLMARKER_COLOR is not None:
        try:
            col = marker[_TLMARKER_COLOR]
        except Exception:
            col = None
        if isinstance(col, c4d.Vector):
            info["color"] = [col.x, col.y, col.z]

    return info


def _coerce_time(params: dict[str, Any], fps: int) -> c4d.BaseTime:
    """Build a BaseTime from ``frame`` (int) or ``time_seconds`` (float).

    The two are mutually exclusive — passing both is a contradiction rather
    than a silent precedence, so it errors.
    """
    has_frame = params.get("frame") is not None
    has_seconds = params.get("time_seconds") is not None
    if has_frame and has_seconds:
        raise ValueError("provide only one of 'frame' or 'time_seconds', not both")
    if has_frame:
        return c4d.BaseTime(int(params["frame"]), fps)
    if has_seconds:
        return c4d.BaseTime(float(params["time_seconds"]))
    raise ValueError("provide 'frame' (int) or 'time_seconds' (float)")


def _coerce_color(value: Any) -> c4d.Vector:
    """Coerce an [r, g, b] list (0..1 floats) into a c4d.Vector."""
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise ValueError("color must be an [r, g, b] list of three numbers (0..1)")
    return c4d.Vector(float(value[0]), float(value[1]), float(value[2]))


def _marker_index(markers: list[Any], marker) -> int:
    """Position of ``marker`` in the chain. Raises if it isn't there.

    The index is the handle ``set_marker`` / ``remove_marker`` accept, so
    returning a sentinel here would hand the caller something that only fails
    on the *next* call — fail loudly instead.
    """
    for i, m in enumerate(markers):
        if m == marker:
            return i
    raise RuntimeError("marker not found in the document chain after the edit")


def _resolve_marker(params: dict[str, Any], markers: list[Any], fps: int) -> Any:
    """Pick one marker by ``index``, ``frame`` or ``name``.

    Exactly one selector must be given. ``frame`` / ``name`` error on ambiguity
    (several markers at the same frame / sharing a name) and point the caller to
    ``index`` — which is always unambiguous.
    """
    selectors = [k for k in ("index", "frame", "name") if params.get(k) is not None]
    if len(selectors) != 1:
        raise ValueError("pass exactly one of 'index', 'frame' or 'name'")
    key = selectors[0]

    if key == "index":
        idx = int(params["index"])
        if not markers:
            raise ValueError("no markers in the document")
        if not 0 <= idx < len(markers):
            raise ValueError(f"index {idx} out of range (0..{len(markers) - 1})")
        return markers[idx]

    if key == "frame":
        frame = int(params["frame"])
        matches = []
        for m in markers:
            t = _marker_time(m)
            if t is not None and t.GetFrame(fps) == frame:
                matches.append(m)
        if not matches:
            raise ValueError(f"no marker at frame {frame}")
        if len(matches) > 1:
            raise ValueError(f"{len(matches)} markers at frame {frame}; use 'index' instead")
        return matches[0]

    name = str(params["name"])
    matches = [m for m in markers if (m.GetName() or "") == name]
    if not matches:
        raise ValueError(f"no marker named {name!r}")
    if len(matches) > 1:
        raise ValueError(f"{len(matches)} markers named {name!r}; use 'index' instead")
    return matches[0]


def handle_create_marker(params: dict[str, Any]) -> dict[str, Any]:
    """Create a timeline marker at a given frame/time with name, colour, length.

    params:
      frame:         int — frame position (mutually exclusive with time_seconds)
      time_seconds:  float — position in seconds (alternative to frame)
      name:          string — marker label (default "")
      color:         [r, g, b] floats 0..1 (optional)
      length_frames: int — marker length in frames (optional, default 0)

    Returns the created marker's info (see ``list_markers``).
    """
    doc = documents.GetActiveDocument()
    if doc is None:
        raise RuntimeError("no active document")

    fps = int(doc.GetFps())
    time = _coerce_time(params, fps)
    name = str(params.get("name") or "")

    # Validate the optional fields up front. AddMarker cannot be un-done from
    # inside a raising ``try`` (the marker is already in the chain by then), so
    # a bad ``color`` / ``length_frames`` must fail before the marker exists —
    # otherwise a retry would pile up duplicates.
    color_vec = None
    if params.get("color") is not None:
        if _TLMARKER_COLOR is None:
            raise RuntimeError("this C4D build does not expose TLMARKER_COLOR")
        color_vec = _coerce_color(params["color"])
    length_time = None
    if params.get("length_frames") is not None:
        if _TLMARKER_LENGTH is None:
            raise RuntimeError("this C4D build does not expose TLMARKER_LENGTH")
        length_time = c4d.BaseTime(int(params["length_frames"]), fps)

    doc.StartUndo()
    try:
        marker = documents.AddMarker(doc, None, time, name)
        if marker is None:
            raise RuntimeError("AddMarker failed (returned None)")
        doc.AddUndo(c4d.UNDOTYPE_NEW, marker)
        if color_vec is not None:
            marker[_TLMARKER_COLOR] = color_vec
        if length_time is not None:
            marker[_TLMARKER_LENGTH] = length_time
    finally:
        doc.EndUndo()
    c4d.EventAdd()

    # Locate the marker in the (post-insert) chain — AddMarker inserts sorted by
    # time, so it is not necessarily last.
    index = _marker_index(_iter_markers(doc), marker)
    return _marker_info(marker, fps, index)


def handle_list_markers(_params: dict[str, Any]) -> dict[str, Any]:
    """Enumerate every timeline marker with its frame, name, colour and length.

    Returns ``{markers: [...], count: N}``. Each entry carries the ``index``
    handle used by ``set_marker`` / ``remove_marker``.
    """
    doc = documents.GetActiveDocument()
    if doc is None:
        return {"markers": [], "count": 0}
    fps = int(doc.GetFps())
    markers = [_marker_info(m, fps, i) for i, m in enumerate(_iter_markers(doc))]
    return {"markers": markers, "count": len(markers)}


def handle_set_marker(params: dict[str, Any]) -> dict[str, Any]:
    """Edit an existing marker: rename, recolour, move, or resize it.

    Target (exactly one):
      index: int — position in the marker chain (see ``list_markers``)
      frame: int — match the marker at this frame (errors on ambiguity)
      name:  str — match by name (errors on ambiguity)

    Updates (any subset; at least one required):
      new_name:         string
      color:            [r, g, b] floats 0..1
      new_frame:        int — move to this frame
      new_time_seconds: float — move to this time in seconds (mutually
                        exclusive with new_frame)
      length_frames:    int — marker length in frames

    Returns the updated marker's info.
    """
    doc = documents.GetActiveDocument()
    if doc is None:
        raise RuntimeError("no active document")
    fps = int(doc.GetFps())

    update_keys = ("new_name", "color", "new_frame", "new_time_seconds", "length_frames")
    if not any(params.get(k) is not None for k in update_keys):
        raise ValueError(
            "nothing to do: provide new_name / color / new_frame / new_time_seconds / length_frames"
        )

    # Pre-compute and validate every mutation before opening the undo bracket so
    # a bad value cannot leave the marker half-edited (or open an empty step).
    new_name = str(params["new_name"]) if params.get("new_name") is not None else None
    color_vec = None
    if params.get("color") is not None:
        if _TLMARKER_COLOR is None:
            raise RuntimeError("this C4D build does not expose TLMARKER_COLOR")
        color_vec = _coerce_color(params["color"])
    time_val = None
    if params.get("new_frame") is not None or params.get("new_time_seconds") is not None:
        if params.get("new_frame") is not None and params.get("new_time_seconds") is not None:
            raise ValueError("provide only one of 'new_frame' or 'new_time_seconds', not both")
        if _TLMARKER_TIME is None:
            raise RuntimeError("this C4D build does not expose TLMARKER_TIME")
        if params.get("new_frame") is not None:
            time_val = c4d.BaseTime(int(params["new_frame"]), fps)
        else:
            time_val = c4d.BaseTime(float(params["new_time_seconds"]))
    length_val = None
    if params.get("length_frames") is not None:
        if _TLMARKER_LENGTH is None:
            raise RuntimeError("this C4D build does not expose TLMARKER_LENGTH")
        length_val = c4d.BaseTime(int(params["length_frames"]), fps)

    marker = _resolve_marker(params, _iter_markers(doc), fps)

    doc.StartUndo()
    try:
        doc.AddUndo(c4d.UNDOTYPE_CHANGE, marker)
        if new_name is not None:
            marker.SetName(new_name)
        if color_vec is not None:
            marker[_TLMARKER_COLOR] = color_vec
        if time_val is not None:
            marker[_TLMARKER_TIME] = time_val
        if length_val is not None:
            marker[_TLMARKER_LENGTH] = length_val
    finally:
        doc.EndUndo()
    c4d.EventAdd()

    index = _marker_index(_iter_markers(doc), marker)
    return _marker_info(marker, fps, index)


def handle_remove_marker(params: dict[str, Any]) -> dict[str, Any]:
    """Delete one timeline marker, or all of them.

    params:
      all:   bool — remove every marker (ignores the selectors below)
      index: int — position in the marker chain (see ``list_markers``)
      frame: int — match the marker at this frame (errors on ambiguity)
      name:  str — match by name (errors on ambiguity)

    Pass ``all:true`` or exactly one of index / frame / name.
    Returns ``{removed: N}``.
    """
    doc = documents.GetActiveDocument()
    if doc is None:
        raise RuntimeError("no active document")
    fps = int(doc.GetFps())
    markers = _iter_markers(doc)

    if bool(params.get("all", False)):
        targets = list(markers)
    else:
        targets = [_resolve_marker(params, markers, fps)]

    if not targets:  # all:true on a marker-free document — nothing to undo.
        return {"removed": 0}

    doc.StartUndo()
    try:
        for marker in targets:
            doc.AddUndo(c4d.UNDOTYPE_DELETE, marker)
            marker.Remove()
    finally:
        doc.EndUndo()
    c4d.EventAdd()

    return {"removed": len(targets)}
