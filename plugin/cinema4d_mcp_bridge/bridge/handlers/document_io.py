"""Document I/O and document-level settings handlers.

Save / open / new wrap ``c4d.documents.SaveDocument`` / ``LoadDocument`` /
``BaseDocument`` + ``InsertBaseDocument`` that normalise format aliases and
keep the active-document swap explicit. Paths must be absolute — the bridge
refuses relative paths so tests don't accidentally touch the C4D working
directory.

``import_scene`` merges an external scene file into the active document.
``set_document`` updates document-level settings (fps, frame range, current
frame, active camera/take).
"""

from __future__ import annotations

import os
from typing import Any

import c4d
from c4d import documents

from ._helpers import (
    _find_object,
    _find_take,
    _require_abs_path,
    _require_writable_path,
    _resolve_format,
    _resolve_handle,
)


def handle_save_document(params: dict[str, Any]) -> dict[str, Any]:
    """Save the active document to disk.

    params:
      path:   absolute output path
      format: "c4d" (default) | "abc" | "fbx" | "obj" | "stl" | "ply" | "usd" | "gltf"
      copy:   bool (default False) — when True, the document's internal name/
              path is **not** updated after saving (mirrors Save-As-Copy).
    """
    # SaveDocument silently fails on a missing folder — validate up front so
    # callers get a useful error instead of a generic False return.
    path = _require_writable_path(params.get("path"))
    fmt_alias = str(params.get("format", "c4d"))
    fmt = _resolve_format(fmt_alias)
    save_copy = bool(params.get("copy", False))

    doc = documents.GetActiveDocument()
    if doc is None:
        raise RuntimeError("no active document")

    # SAVEDOCUMENTFLAGS_SAVEAS triggers the Save-As dialog in C4D 2026 (seen
    # empirically when the MCP handler previously set it for copy=True).
    # "Save As Copy" semantics are simply: save to `path` and DON'T mutate the
    # doc's internal path/name afterward — no exporter flag is required.
    flags = c4d.SAVEDOCUMENTFLAGS_DONTADDTORECENTLIST

    ok = documents.SaveDocument(doc, path, flags, fmt)
    if not ok:
        raise RuntimeError(f"SaveDocument failed for {path!r} (format={fmt_alias})")

    if not save_copy:
        # SaveDocument mutates the doc's internal path/name; reflect that back
        # to the caller so subsequent saves hit the same file.
        doc.SetDocumentPath(os.path.dirname(path))
        doc.SetDocumentName(os.path.basename(path))

    c4d.EventAdd()
    return {"path": path, "format": fmt_alias, "format_id": fmt, "copy": save_copy}


def handle_open_document(params: dict[str, Any]) -> dict[str, Any]:
    """Load a scene file and optionally make it the active document.

    params:
      path:        absolute path to a loadable C4D scene file
      make_active: bool (default True)
    """
    path = _require_abs_path(params.get("path"), must_exist=True)
    make_active = bool(params.get("make_active", True))

    new_doc = documents.LoadDocument(path, c4d.SCENEFILTER_OBJECTS | c4d.SCENEFILTER_MATERIALS)
    if new_doc is None:
        raise RuntimeError(f"LoadDocument returned None for {path!r}")

    documents.InsertBaseDocument(new_doc)
    if make_active:
        documents.SetActiveDocument(new_doc)
    c4d.EventAdd()

    return {
        "path": path,
        "loaded": True,
        "active_document": documents.GetActiveDocument().GetDocumentName() or "",
    }


def handle_new_document(params: dict[str, Any]) -> dict[str, Any]:
    """Insert a fresh empty BaseDocument and optionally make it active.

    params:
      name:        optional document display name
      make_active: bool (default True)
    """
    make_active = bool(params.get("make_active", True))
    name = params.get("name")

    new_doc = c4d.documents.BaseDocument()
    if isinstance(name, str) and name:
        new_doc.SetDocumentName(name)
    documents.InsertBaseDocument(new_doc)
    if make_active:
        documents.SetActiveDocument(new_doc)
    c4d.EventAdd()

    active = documents.GetActiveDocument()
    return {
        "switched": make_active,
        "active_document": active.GetDocumentName() if active else "",
    }


def _iter_open_documents() -> list[Any]:
    """Return every open document in C4D's document list, in list order.

    The order matches the document tabs and is stable within a session, so the
    index is a usable handle for ``set_active_document``.
    """
    docs = []
    d = documents.GetFirstDocument()
    while d is not None:
        docs.append(d)
        d = d.GetNext()
    return docs


def _resolve_open_document(docs: list[Any], idx: Any, name: Any) -> Any:
    """Pick one open document by list ``index`` or unique ``name``.

    Exactly one of ``idx`` / ``name`` must be given. Shared by
    ``set_active_document`` and ``close_document`` so both identify a target
    the same way: ``name`` errors on zero or several matches and points the
    caller to ``index`` to disambiguate (e.g. several unsaved "Untitled" docs).
    """
    if (idx is None) == (name is None):
        raise ValueError("pass exactly one of 'index' or 'name'")
    if idx is not None:
        idx = int(idx)
        if not 0 <= idx < len(docs):
            raise ValueError(f"index {idx} out of range (0..{len(docs) - 1})")
        return docs[idx]
    matches = [d for d in docs if (d.GetDocumentName() or "") == str(name)]
    if not matches:
        raise ValueError(f"no open document named {name!r}")
    if len(matches) > 1:
        raise ValueError(f"{len(matches)} open documents named {name!r}; use 'index' instead")
    return matches[0]


def handle_list_documents(_params: dict[str, Any]) -> dict[str, Any]:
    """Enumerate the open documents so a caller can pick one to switch to.

    Returns one entry per open document with its list ``index`` (the handle
    accepted by ``set_active_document``), name, path and whether it is active.
    ``get_document_state`` only reports the active document; this fills the gap.
    """
    active = documents.GetActiveDocument()
    out = []
    for index, d in enumerate(_iter_open_documents()):
        out.append(
            {
                "index": index,
                "name": d.GetDocumentName() or "",
                "path": d.GetDocumentPath() or "",
                "active": d == active,
            }
        )
    return {"documents": out, "count": len(out)}


def handle_set_active_document(params: dict[str, Any]) -> dict[str, Any]:
    """Switch focus to an already-open document, identified by index or name.

    params:
      index: 0-based position in the document list (see ``list_documents``)
      name:  document name; errors if it matches zero or several documents

    Exactly one of ``index`` / ``name`` must be given. Loading a file from disk
    is ``open_document``; this only switches between documents already open.
    """
    docs = _iter_open_documents()
    if not docs:
        raise RuntimeError("no open documents")

    target = _resolve_open_document(docs, params.get("index"), params.get("name"))

    documents.SetActiveDocument(target)
    c4d.EventAdd()
    active = documents.GetActiveDocument()
    return {
        "active_document": active.GetDocumentName() if active else "",
        "active_path": (active.GetDocumentPath() or "") if active else "",
    }


def handle_close_document(params: dict[str, Any]) -> dict[str, Any]:
    """Close an open document, identified by index or name.

    params:
      index: 0-based position in the document list (see ``list_documents``)
      name:  document name; errors if it matches zero or several documents
      force: bool (default False) — required to close a document with unsaved
             changes, since ``KillDocument`` discards them without a prompt

    Exactly one of ``index`` / ``name`` must be given. C4D always keeps at least
    one document, so closing the last one leaves a fresh empty document active.
    """
    docs = _iter_open_documents()
    if not docs:
        raise RuntimeError("no open documents")

    target = _resolve_open_document(docs, params.get("index"), params.get("name"))
    force = bool(params.get("force", False))

    # KillDocument has no dirty-check / save prompt (unlike the GUI close), so
    # guard unsaved work behind an explicit force flag.
    if target.GetChanged() and not force:
        raise RuntimeError(
            f"document {target.GetDocumentName()!r} has unsaved changes; "
            "save it first or pass force=true to discard them"
        )

    closed_name = target.GetDocumentName() or ""
    closed_path = target.GetDocumentPath() or ""
    documents.KillDocument(target)
    c4d.EventAdd()

    active = documents.GetActiveDocument()
    return {
        "closed_document": closed_name,
        "closed_path": closed_path,
        "active_document": active.GetDocumentName() if active else "",
    }


def handle_import_scene(params: dict[str, Any]) -> dict[str, Any]:
    """Merge an external scene file (abc/fbx/obj/c4d/...) into the active document.

    params:
      path:    absolute file path
      filter:  "objects" | "materials" | "all" (default "all")
      parent:  optional parent handle — newly-imported top-level objects are
               moved under this object after import
      rename:  optional new name for the first imported top-level object

    Returns:
      {"imported": [{name, type_id, type_name}, ...], "count": N}
    """
    path = _require_abs_path(params.get("path"), must_exist=True)

    filt = str(params.get("filter", "all")).lower()
    flags = 0
    if filt in ("objects", "all"):
        flags |= c4d.SCENEFILTER_OBJECTS
    if filt in ("materials", "all"):
        flags |= c4d.SCENEFILTER_MATERIALS
    if flags == 0:
        flags = c4d.SCENEFILTER_OBJECTS | c4d.SCENEFILTER_MATERIALS

    doc = documents.GetActiveDocument()
    if doc is None:
        raise RuntimeError("no active document")

    before = set()
    o = doc.GetFirstObject()
    while o is not None:
        before.add(id(o))
        o = o.GetNext()

    ok = documents.MergeDocument(doc, path, flags)
    if not ok:
        raise RuntimeError(f"MergeDocument failed for {path}")

    new_objs: list[c4d.BaseObject] = []
    o = doc.GetFirstObject()
    while o is not None:
        if id(o) not in before:
            new_objs.append(o)
        o = o.GetNext()

    rename = params.get("rename")
    if rename and new_objs:
        new_objs[0].SetName(str(rename))

    parent_h = params.get("parent")
    if parent_h:
        parent = _resolve_handle(parent_h)
        if parent is None:
            raise ValueError(f"parent not resolved: {parent_h}")
        for obj in new_objs:
            obj.Remove()
            obj.InsertUnder(parent)

    imported = [
        {"name": obj.GetName(), "type_id": obj.GetType(), "type_name": obj.GetTypeName()}
        for obj in new_objs
    ]
    c4d.EventAdd()
    return {"imported": imported, "count": len(imported)}


def handle_set_document(params: dict[str, Any]) -> dict[str, Any]:
    """Update document-level settings.

    Supported keys: fps, frame_start, frame_end, current_frame, active_camera (name).
    Also mirrors fps + frame range to the active render data.
    """
    doc = documents.GetActiveDocument()
    if doc is None:
        raise RuntimeError("no active document")
    updated: dict[str, Any] = {}
    if "fps" in params:
        doc.SetFps(int(params["fps"]))
        updated["fps"] = doc.GetFps()
    fps = doc.GetFps()
    if "frame_start" in params:
        doc.SetMinTime(c4d.BaseTime(int(params["frame_start"]), fps))
        doc.SetLoopMinTime(c4d.BaseTime(int(params["frame_start"]), fps))
        updated["frame_start"] = int(params["frame_start"])
    if "frame_end" in params:
        doc.SetMaxTime(c4d.BaseTime(int(params["frame_end"]), fps))
        doc.SetLoopMaxTime(c4d.BaseTime(int(params["frame_end"]), fps))
        updated["frame_end"] = int(params["frame_end"])
    if "current_frame" in params:
        doc.SetTime(c4d.BaseTime(int(params["current_frame"]), fps))
        updated["current_frame"] = int(params["current_frame"])
    if any(k in params for k in ("fps", "frame_start", "frame_end")):
        rd = doc.GetActiveRenderData()
        if rd is not None:
            if "frame_start" in params:
                rd[c4d.RDATA_FRAMEFROM] = c4d.BaseTime(int(params["frame_start"]), fps)
            if "frame_end" in params:
                rd[c4d.RDATA_FRAMETO] = c4d.BaseTime(int(params["frame_end"]), fps)
            rd[c4d.RDATA_FRAMERATE] = float(fps)
    if "active_camera" in params:
        cam_name = params["active_camera"]
        if cam_name:
            cam = _find_object(cam_name)
            if cam is None:
                raise ValueError(f"camera not found: {cam_name}")
            bd = doc.GetRenderBaseDraw()
            if bd:
                bd.SetSceneCamera(cam)
                updated["active_camera"] = cam.GetName()
    if "active_take" in params:
        take_name = params["active_take"]
        if take_name:
            td = doc.GetTakeData()
            if td is None:
                raise RuntimeError("take data unavailable")
            take = _find_take(str(take_name))
            if take is None:
                raise ValueError(f"take not found: {take_name}")
            td.SetCurrentTake(take)
            updated["active_take"] = take.GetName()
    c4d.EventAdd()
    return {"updated": updated}
