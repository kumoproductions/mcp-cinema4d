"""Lightweight handlers: ping, undo, reset_scene, render, preview_render."""

from __future__ import annotations

import base64
import contextlib
import math
import os
import tempfile
from typing import Any

import c4d
from c4d import documents

from ._helpers import (
    _find_object,
    _find_take,
    _require_writable_path,
    _walk_all_objects,
)


def handle_ping(_params: dict[str, Any]) -> dict[str, Any]:
    return {"pong": True, "c4d_version": c4d.GetC4DVersion()}


def handle_undo(params: dict[str, Any]) -> dict[str, Any]:
    """Pop up to ``steps`` entries off the active document's undo stack.

    Stops early if the undo stack is exhausted. Returns the number of steps
    actually performed so callers can detect the stack-empty case.
    """
    steps = int(params.get("steps", 1))
    if steps < 1:
        raise ValueError("steps must be >= 1")
    doc = documents.GetActiveDocument()
    if doc is None:
        raise RuntimeError("no active document")
    done = 0
    for _ in range(steps):
        if not doc.DoUndo(True):
            break
        done += 1
    c4d.EventAdd()
    return {"steps_performed": done, "requested": steps}


def handle_reset_scene(params: dict[str, Any]) -> dict[str, Any]:
    """Swap in a fresh empty document, dropping the previous doc entirely.

    Cheap way for test suites and agent workflows to get a clean slate
    without routing through ``exec_python`` (opt-in) or dozens of
    ``remove_entity`` RPCs. Optionally prefix-filtered: when ``prefix`` is
    supplied, we only clear objects / materials / render data whose name
    starts with that prefix and leave the rest of the scene alone.

    params:
      prefix:        optional name prefix. When set, only matching top-level
                     objects / materials / non-active render data are
                     removed. When omitted, the current document is replaced
                     with a brand-new empty BaseDocument.
      keep_active_rd: bool (default True). Only honoured in prefix mode —
                     protects the currently-active render data from deletion
                     regardless of its name.
    """
    doc = documents.GetActiveDocument()
    if doc is None:
        return {"reset": False, "reason": "no active document"}

    prefix = params.get("prefix")
    keep_active_rd = bool(params.get("keep_active_rd", True))

    if isinstance(prefix, str) and prefix:
        removed = {"objects": 0, "materials": 0, "render_data": 0, "takes": 0}

        # Objects — walk top-level siblings and drop any matching the prefix.
        obj = doc.GetFirstObject()
        while obj is not None:
            nxt = obj.GetNext()
            if obj.GetName().startswith(prefix):
                obj.Remove()
                removed["objects"] += 1
            obj = nxt

        # Materials.
        mat = doc.GetFirstMaterial()
        while mat is not None:
            nxt = mat.GetNext()
            if mat.GetName().startswith(prefix):
                mat.Remove()
                removed["materials"] += 1
            mat = nxt

        # Render data — skip the active one even if it matches.
        active_rd = doc.GetActiveRenderData() if keep_active_rd else None
        rd = doc.GetFirstRenderData()
        while rd is not None:
            nxt = rd.GetNext()
            if rd is not active_rd and rd.GetName().startswith(prefix):
                rd.Remove()
                removed["render_data"] += 1
            rd = nxt

        # Non-main takes.
        td = doc.GetTakeData()
        if td is not None:

            def drop_matching(parent):
                c = parent.GetDown()
                while c is not None:
                    nxt = c.GetNext()
                    drop_matching(c)
                    if not c.IsMain() and c.GetName().startswith(prefix):
                        td.DeleteTake(c)
                        removed["takes"] += 1
                    c = nxt

            drop_matching(td.GetMainTake())
            td.SetCurrentTake(td.GetMainTake())

        # Flush the undo stack so subsequent tests don't pay the cost of
        # replaying a long history of animated-object removals.
        with contextlib.suppress(Exception):
            doc.FlushUndoBuffer()

        c4d.EventAdd()
        return {"reset": True, "prefix": prefix, "removed": removed}

    # No prefix → replace the whole document.
    new_doc = c4d.documents.BaseDocument()
    documents.InsertBaseDocument(new_doc)
    documents.SetActiveDocument(new_doc)
    with contextlib.suppress(Exception):
        documents.KillDocument(doc)
    c4d.EventAdd()
    return {"reset": True, "replaced_document": True}


def handle_render(params: dict[str, Any]) -> dict[str, Any]:
    """Render the active document using its currently-active render data.

    Width / height / renderer etc. come from the active RenderData — adjust
    it via ``create_render_data`` + ``set_params`` beforehand if needed.
    """
    doc = documents.GetActiveDocument()
    if doc is None:
        raise RuntimeError("no active document")

    rd = doc.GetActiveRenderData().GetClone()
    if rd is None:
        raise RuntimeError("failed to clone active render data")

    xres = int(rd[c4d.RDATA_XRES])
    yres = int(rd[c4d.RDATA_YRES])

    bitmap = c4d.bitmaps.MultipassBitmap(xres, yres, c4d.COLORMODE_RGB)
    if bitmap is None:
        raise RuntimeError("failed to allocate render bitmap")
    # Add an internal alpha+straight-alpha channel. Required for many renderers
    # (physical/redshift/octane) even though COLORMODE_RGB itself has no alpha.
    bitmap.AddChannel(True, True)

    result = documents.RenderDocument(
        doc,
        rd.GetDataInstance(),
        bitmap,
        c4d.RENDERFLAGS_EXTERNAL,
    )
    if result != c4d.RENDERRESULT_OK:
        raise RuntimeError(f"render failed with code {result}")

    raw_output = params.get("output_path")
    if isinstance(raw_output, str) and raw_output:
        # Same abs-path + parent-dir rules as save_document: keep path handling
        # uniform so LLM-driven relative paths can't land in the C4D cwd.
        output_path: str = _require_writable_path(raw_output)
    else:
        fd, output_path = tempfile.mkstemp(prefix="c4d_mcp_render_", suffix=".png")
        os.close(fd)

    save_result = bitmap.Save(output_path, c4d.FILTER_PNG)
    if save_result != c4d.IMAGERESULT_OK:
        raise RuntimeError(f"failed to save image to {output_path} (code {save_result})")

    return {
        "path": output_path,
        "width": xres,
        "height": yres,
    }


# ---------------------------------------------------------------------------
# preview_render
# ---------------------------------------------------------------------------
#
# Independent agent-friendly verification render. Unlike ``render`` (which uses
# the active RenderData and dumps a file path), this:
#
#   * Builds a freestanding RenderData (Viewport renderer) — never inserted
#     into the document, never touches the active RD.
#   * Switches the active BaseDraw to Constant Shading (Lines) so the
#     Viewport renderer produces a fast, sketch-style image suited to "look
#     and verify" iteration loops.
#   * Optionally uses a preset orthographic-ish view (top/bottom/left/right/
#     front/back) by parking a temp camera framed against the scene bounds.
#   * Returns the PNG inline (base64). The TS layer wraps that into MCP
#     ``image`` content so the agent can directly see the result.
#   * Restores BaseDraw / camera / time / take in finally.
#
# Camera preset distance is `bbox_radius * 4` along the chosen axis with
# `MatrixLookAt` orientation; falls back to a small distance when the scene
# is empty. Perspective is used (not pure ortho) — pure ortho zoom-fitting
# is fragile across renderers, perspective at distance gives a reliable
# "look from this side" view that's good enough for layout verification.

_PRESET_VIEWS = ("current", "top", "bottom", "left", "right", "front", "back")

# Per-preset camera setup: (offset direction from scene center to eye, world-up
# reference for orienting the camera roll).
#
# C4D coord system: +Y up, -Z is "front" of an object (camera default looks
# toward +Z), so the conventional editor "Front" view places the camera at -Z.
# For top/bottom the forward axis is parallel to world +Y, so we pick a
# Z-axis world-up reference instead to avoid a degenerate cross product.
_PRESET_VIEW_BASIS: dict[str, tuple[c4d.Vector, c4d.Vector]] = {
    "top": (c4d.Vector(0, 1, 0), c4d.Vector(0, 0, -1)),
    "bottom": (c4d.Vector(0, -1, 0), c4d.Vector(0, 0, 1)),
    "right": (c4d.Vector(1, 0, 0), c4d.Vector(0, 1, 0)),
    "left": (c4d.Vector(-1, 0, 0), c4d.Vector(0, 1, 0)),
    "front": (c4d.Vector(0, 0, -1), c4d.Vector(0, 1, 0)),
    "back": (c4d.Vector(0, 0, 1), c4d.Vector(0, 1, 0)),
}


def _scene_bounds(doc: c4d.documents.BaseDocument) -> tuple[c4d.Vector, float]:
    """World-space AABB center + half-extent across all geometry-bearing objects.

    Returns ``(center, radius)`` where ``radius`` is the largest half-extent
    (max of x/y/z) so a sphere of that radius around ``center`` encloses the
    longest scene axis. Empty scenes fall back to ``(origin, 100)`` so the
    preview camera still has somewhere reasonable to sit.
    """
    objs = _walk_all_objects(doc.GetFirstObject())
    mn_x = mn_y = mn_z = math.inf
    mx_x = mx_y = mx_z = -math.inf
    found = False
    for o in objs:
        try:
            mp = o.GetMp()
            rad = o.GetRad()
            mg = o.GetMg()
        except Exception:
            continue
        if rad.x == 0 and rad.y == 0 and rad.z == 0:
            # Skip non-geometric objects (cameras, lights, nulls without bbox).
            continue
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    p_local = mp + c4d.Vector(rad.x * sx, rad.y * sy, rad.z * sz)
                    p_world = mg * p_local
                    if p_world.x < mn_x:
                        mn_x = p_world.x
                    if p_world.y < mn_y:
                        mn_y = p_world.y
                    if p_world.z < mn_z:
                        mn_z = p_world.z
                    if p_world.x > mx_x:
                        mx_x = p_world.x
                    if p_world.y > mx_y:
                        mx_y = p_world.y
                    if p_world.z > mx_z:
                        mx_z = p_world.z
                    found = True
    if not found:
        return c4d.Vector(0, 0, 0), 100.0
    center = c4d.Vector((mn_x + mx_x) * 0.5, (mn_y + mx_y) * 0.5, (mn_z + mx_z) * 0.5)
    radius = max(mx_x - mn_x, mx_y - mn_y, mx_z - mn_z) * 0.5
    return center, max(radius, 1.0)


def _make_preset_camera(doc: c4d.documents.BaseDocument, view: str) -> c4d.BaseObject:
    """Build a temp perspective camera looking at the scene from ``view``.

    Builds the world matrix directly from explicit basis vectors (forward,
    right, up) rather than going through ``VectorToHPB`` / ``HPBToMatrix``:
    HPB conversion is ambiguous for axis-aligned look directions (top /
    bottom hit pitch=±90° gimbal lock, back hits heading=180°), which can
    leak unintended bank/roll into the resulting camera. C4D cameras shoot
    along their local +Z axis, so we set v3 = forward = (center minus eye).
    """
    center, radius = _scene_bounds(doc)
    offset_dir, world_up = _PRESET_VIEW_BASIS[view]
    eye = center + offset_dir * (radius * 4.0)

    forward = center - eye
    if forward.GetLength() == 0:
        # Degenerate (eye == center, e.g. empty scene at origin) — point along +Z.
        forward = c4d.Vector(0, 0, 1)
    forward = forward.GetNormalized()

    right = world_up.Cross(forward)
    if right.GetLength() == 0:
        # Defensive: world_up parallel to forward (shouldn't happen with the
        # presets above, but stay correct if the table is ever edited).
        alt_up = c4d.Vector(1, 0, 0) if abs(forward.x) < 0.9 else c4d.Vector(0, 0, 1)
        right = alt_up.Cross(forward)
    right = right.GetNormalized()
    up = forward.Cross(right)

    mat = c4d.Matrix(eye, right, up, forward)

    cam = c4d.BaseObject(c4d.Ocamera)
    if cam is None:
        raise RuntimeError("failed to allocate preview camera")
    cam.SetName(f"__c4d_mcp_preview_{view}__")
    cam.SetMg(mat)
    doc.InsertObject(cam)
    return cam


def handle_preview_render(params: dict[str, Any]) -> dict[str, Any]:
    """Independent verification render using the Viewport renderer.

    Designed for agent verification loops: fast, sketch-style, returns the
    PNG inline (base64) without touching the user's active RenderData.

    params:
      width, height:  output size in pixels (default 1024 x 1024, capped 4096).
      view:           "current" (default — uses active BaseDraw camera),
                      "top" | "bottom" | "left" | "right" | "front" | "back"
                      (creates a temp camera looking at the scene bounds).
      camera:         optional object name; overrides ``view`` and renders
                      from that scene camera. Mutually exclusive with a
                      non-"current" view.
      frame:          optional integer frame; defaults to current time.
      take:           optional take name; defaults to current take.
      save_path:      optional absolute PNG path. When set, the rendered
                      image is also written to disk (parent dir must exist)
                      in addition to being returned inline as base64.
    """
    doc = documents.GetActiveDocument()
    if doc is None:
        raise RuntimeError("no active document")

    width = int(params.get("width", 1024))
    height = int(params.get("height", 1024))
    if width <= 0 or height <= 0:
        raise ValueError(f"width/height must be positive, got {width}x{height}")
    if width > 4096 or height > 4096:
        raise ValueError(f"width/height capped at 4096, got {width}x{height}")

    view = str(params.get("view", "current")).strip().lower()
    if view not in _PRESET_VIEWS:
        raise ValueError(f"unknown view {view!r}; accepted: {list(_PRESET_VIEWS)}")

    raw_camera = params.get("camera")
    camera_name = raw_camera if isinstance(raw_camera, str) and raw_camera else None
    if camera_name is not None and view != "current":
        raise ValueError("`camera` and a non-'current' `view` are mutually exclusive")

    frame_param = params.get("frame")
    take_name = params.get("take")

    raw_save_path = params.get("save_path")
    save_path: str | None
    if isinstance(raw_save_path, str) and raw_save_path:
        save_path = _require_writable_path(raw_save_path)
    else:
        save_path = None

    bd = doc.GetActiveBaseDraw()
    if bd is None:
        raise RuntimeError("no active BaseDraw (editor view) — open an editor view first")

    # State to restore.
    orig_sd_active = bd[c4d.BASEDRAW_DATA_SDISPLAYACTIVE]
    orig_sd_inactive = bd[c4d.BASEDRAW_DATA_SDISPLAYINACTIVE]
    orig_scene_camera = bd.GetSceneCamera(doc)
    orig_time = doc.GetTime()
    take_data = doc.GetTakeData()
    orig_take = take_data.GetCurrentTake() if take_data is not None else None

    temp_camera: c4d.BaseObject | None = None
    target_camera: c4d.BaseObject | None = None
    target_camera_label: str | None = None

    # "Constant Shading (Lines)" = BASEDRAW_SDISPLAY_FLAT_WIRE. The leaf
    # name is FLAT_WIRE because internally Maxon names the constant-shaded
    # mode "FLAT" (single-sided lighting); _WIRE adds the wireframe overlay.
    constant_lines_mode = c4d.BASEDRAW_SDISPLAY_FLAT_WIRE

    try:
        # Switch take BEFORE evaluating frame so the take's overrides apply.
        if take_name:
            t = _find_take(str(take_name))
            if t is None:
                raise ValueError(f"take not found: {take_name!r}")
            if take_data is not None:
                take_data.SetCurrentTake(t)
                # SetCurrentTake alone doesn't propagate the take's parameter
                # overrides into the live scene — the next ExecutePasses does.
                # Without this, a take-only call (no frame) would render the
                # previous take's state.
                doc.ExecutePasses(None, True, True, True, c4d.BUILDFLAGS_NONE)

        # Frame jump (defaults to current).
        fps = doc.GetFps() or 30
        if frame_param is not None:
            doc.SetTime(c4d.BaseTime(int(frame_param), fps))
            doc.ExecutePasses(None, True, True, True, c4d.BUILDFLAGS_NONE)

        # Display mode: Constant Shading (Lines) — the Viewport renderer reads
        # from the active BaseDraw, so this is what produces the sketch look.
        bd[c4d.BASEDRAW_DATA_SDISPLAYACTIVE] = constant_lines_mode
        bd[c4d.BASEDRAW_DATA_SDISPLAYINACTIVE] = constant_lines_mode

        # Camera resolution.
        if camera_name:
            target_camera = _find_object(camera_name)
            if target_camera is None or target_camera.GetType() != c4d.Ocamera:
                raise ValueError(f"camera object not found or not a camera: {camera_name!r}")
            target_camera_label = target_camera.GetName()
        elif view != "current":
            target_camera = _make_preset_camera(doc, view)
            temp_camera = target_camera
            target_camera_label = view

        if target_camera is not None:
            bd.SetSceneCamera(target_camera)

        # Freestanding RenderData — built locally and passed to RenderDocument
        # without insertion into the document, so the user's RenderData list
        # is unaffected.
        rd = c4d.documents.RenderData()
        if rd is None:
            raise RuntimeError("failed to allocate RenderData")
        rd[c4d.RDATA_RENDERENGINE] = 300001061  # viewport renderer
        rd[c4d.RDATA_XRES] = float(width)
        rd[c4d.RDATA_YRES] = float(height)
        rd[c4d.RDATA_LOCKRATIO] = False
        rd[c4d.RDATA_FILMASPECT] = float(width) / float(height)
        rd[c4d.RDATA_PIXELASPECT] = 1.0
        rd[c4d.RDATA_FRAMESEQUENCE] = 1  # current frame
        rd[c4d.RDATA_FRAMEFROM] = doc.GetTime()
        rd[c4d.RDATA_FRAMETO] = doc.GetTime()
        rd[c4d.RDATA_SAVEIMAGE] = False

        bitmap = c4d.bitmaps.MultipassBitmap(width, height, c4d.COLORMODE_RGB)
        if bitmap is None:
            raise RuntimeError("failed to allocate preview bitmap")
        bitmap.AddChannel(True, True)

        result = documents.RenderDocument(
            doc,
            rd.GetDataInstance(),
            bitmap,
            c4d.RENDERFLAGS_EXTERNAL,
        )
        if result != c4d.RENDERRESULT_OK:
            raise RuntimeError(f"preview render failed with code {result}")

        # Save → read → base64. When the caller supplied ``save_path`` we
        # write directly there and keep the file; otherwise we use a temp
        # file and delete it after reading. Going via a file is simpler than
        # fishing raw pixels out of the MultipassBitmap (and matches what
        # handle_render does for the on-disk path case).
        if save_path is not None:
            png_path = save_path
            cleanup_png = False
        else:
            fd, png_path = tempfile.mkstemp(prefix="c4d_mcp_preview_", suffix=".png")
            os.close(fd)
            cleanup_png = True
        try:
            save_result = bitmap.Save(png_path, c4d.FILTER_PNG)
            if save_result != c4d.IMAGERESULT_OK:
                raise RuntimeError(f"failed to save preview PNG (code {save_result})")
            with open(png_path, "rb") as fh:
                png_bytes = fh.read()
        finally:
            if cleanup_png:
                with contextlib.suppress(Exception):
                    os.remove(png_path)

        result_payload: dict[str, Any] = {
            "image_base64": base64.b64encode(png_bytes).decode("ascii"),
            "mime_type": "image/png",
            "width": width,
            "height": height,
            "view": view,
            "camera": target_camera_label,
            "frame": doc.GetTime().GetFrame(fps),
        }
        if save_path is not None:
            result_payload["saved_path"] = save_path
        return result_payload
    finally:
        # Best-effort restore — never raise from finally.
        with contextlib.suppress(Exception):
            bd[c4d.BASEDRAW_DATA_SDISPLAYACTIVE] = orig_sd_active
        with contextlib.suppress(Exception):
            bd[c4d.BASEDRAW_DATA_SDISPLAYINACTIVE] = orig_sd_inactive
        with contextlib.suppress(Exception):
            bd.SetSceneCamera(orig_scene_camera)
        if temp_camera is not None:
            with contextlib.suppress(Exception):
                temp_camera.Remove()
        if take_data is not None and orig_take is not None:
            with contextlib.suppress(Exception):
                take_data.SetCurrentTake(orig_take)
        with contextlib.suppress(Exception):
            doc.SetTime(orig_time)
        with contextlib.suppress(Exception):
            doc.ExecutePasses(None, True, True, True, c4d.BUILDFLAGS_NONE)
        with contextlib.suppress(Exception):
            c4d.EventAdd()
