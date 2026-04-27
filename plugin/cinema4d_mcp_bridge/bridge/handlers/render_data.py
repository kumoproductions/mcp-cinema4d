"""RenderData handler: ``create_render_data``.

Allocates (or updates) a ``c4d.documents.RenderData`` with the common knobs
agents reach for — resolution, renderer, fps, frame range — plus a generic
``params`` escape hatch for everything else. Pairs with ``handle_render``
(in ``basics.py``) which executes against the active RenderData.
"""

from __future__ import annotations

from typing import Any

import c4d
from c4d import documents

from ._helpers import (
    FRAME_SEQUENCE_ALIASES,
    _apply_params,
    _find_render_data,
    _summary,
    resolve_renderer,
)


def handle_create_render_data(params: dict[str, Any]) -> dict[str, Any]:
    """Create (or update-if-exists) a RenderData with common options.

    params:
      name:              string (required)
      width, height:     int (pixels)
      renderer:          int (plugin id) or alias:
                         "octane"/"standard"/"physical"/"redshift"/"cycles"/"viewport"
      fps:               int (also sets Use Project Frame Rate off)
      frame_start:       int
      frame_end:         int
      frame_sequence:    "manual"/"current"/"all"/"preview"/"custom"
                         (default "manual" when frame_start/end given)
      make_active:       bool
      update_if_exists:  bool
      params:            extra {param_id: value} to set after allocation
    """
    name = params.get("name")
    if not name or not isinstance(name, str):
        raise ValueError("name required")

    doc = documents.GetActiveDocument()
    if doc is None:
        raise RuntimeError("no active document")

    update_if_exists = bool(params.get("update_if_exists", False))
    rd = _find_render_data(name) if update_if_exists else None
    created = rd is None
    if rd is None:
        rd = c4d.documents.RenderData()
        rd.SetName(name)

    doc.StartUndo()
    try:
        fps = doc.GetFps()
        if "fps" in params and params["fps"] is not None:
            fps = int(params["fps"])
            rd[c4d.RDATA_FRAMERATE] = float(fps)
            rd[c4d.RDATA_LOCKRATIO] = False
            rd[5023] = False  # RDATA_USEPROJECTFRAMERATE

        if "width" in params and params["width"] is not None:
            rd[c4d.RDATA_XRES] = float(params["width"])
        if "height" in params and params["height"] is not None:
            rd[c4d.RDATA_YRES] = float(params["height"])

        if "renderer" in params and params["renderer"] is not None:
            rd[c4d.RDATA_RENDERENGINE] = resolve_renderer(params["renderer"])

        has_range = "frame_start" in params or "frame_end" in params
        seq_value = params.get("frame_sequence")
        if has_range and seq_value is None:
            seq_value = "manual"
        if seq_value is not None:
            if isinstance(seq_value, str):
                key = seq_value.strip().lower()
                if key not in FRAME_SEQUENCE_ALIASES:
                    raise ValueError(f"unknown frame_sequence: {seq_value!r}")
                rd[c4d.RDATA_FRAMESEQUENCE] = FRAME_SEQUENCE_ALIASES[key]
            else:
                rd[c4d.RDATA_FRAMESEQUENCE] = int(seq_value)

        if "frame_start" in params and params["frame_start"] is not None:
            rd[c4d.RDATA_FRAMEFROM] = c4d.BaseTime(int(params["frame_start"]), fps)
        if "frame_end" in params and params["frame_end"] is not None:
            rd[c4d.RDATA_FRAMETO] = c4d.BaseTime(int(params["frame_end"]), fps)

        extra = params.get("params") or {}
        if extra:
            _apply_params(rd, extra)

        if created:
            doc.InsertRenderData(rd)
            doc.AddUndo(c4d.UNDOTYPE_NEW, rd)
        else:
            doc.AddUndo(c4d.UNDOTYPE_CHANGE, rd)

        if bool(params.get("make_active", False)):
            doc.SetActiveRenderData(rd)
    finally:
        doc.EndUndo()
    c4d.EventAdd()

    return {
        "handle": {"kind": "render_data", "name": rd.GetName()},
        "created": created,
        "summary": _summary(rd),
    }
