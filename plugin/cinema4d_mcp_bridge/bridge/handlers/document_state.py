"""Document state reader: ``get_document_state``.

Aggregates the fields an LLM typically asks for when orienting itself
(fps / frame range / current frame / active camera / active take / active
render data / document name & path). The companion mutator is
``set_document`` (in document_io.py) which writes a subset of these fields.
"""

from __future__ import annotations

from typing import Any

from c4d import documents

from ._helpers import _object_path


def _active_camera_handle(doc) -> dict[str, Any] | None:
    bd = doc.GetRenderBaseDraw()
    if bd is None:
        return None
    cam = bd.GetSceneCamera(doc)
    if cam is None:
        return None
    return {
        "kind": "object",
        "path": _object_path(cam),
        "name": cam.GetName(),
    }


def _active_take(doc) -> dict[str, Any] | None:
    td = doc.GetTakeData()
    if td is None:
        return None
    take = td.GetCurrentTake()
    if take is None:
        return None
    return {"kind": "take", "name": take.GetName(), "is_main": bool(take.IsMain())}


def _active_render_data(doc) -> dict[str, Any] | None:
    rd = doc.GetActiveRenderData()
    if rd is None:
        return None
    return {"kind": "render_data", "name": rd.GetName()}


def handle_get_document_state(_params: dict[str, Any]) -> dict[str, Any]:
    doc = documents.GetActiveDocument()
    if doc is None:
        return {"document": None}

    fps = int(doc.GetFps())
    frame_start = int(doc.GetMinTime().GetFrame(fps))
    frame_end = int(doc.GetMaxTime().GetFrame(fps))
    loop_start = int(doc.GetLoopMinTime().GetFrame(fps))
    loop_end = int(doc.GetLoopMaxTime().GetFrame(fps))
    current_frame = int(doc.GetTime().GetFrame(fps))

    return {
        "document_name": doc.GetDocumentName() or "",
        "document_path": doc.GetDocumentPath() or "",
        "fps": fps,
        "frame_start": frame_start,
        "frame_end": frame_end,
        "loop_start": loop_start,
        "loop_end": loop_end,
        "current_frame": current_frame,
        "active_camera": _active_camera_handle(doc),
        "active_take": _active_take(doc),
        "active_render_data": _active_render_data(doc),
    }
