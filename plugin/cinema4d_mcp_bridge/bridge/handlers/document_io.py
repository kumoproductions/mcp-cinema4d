"""Document I/O handlers: save_document, open_document, new_document.

Thin wrappers over ``c4d.documents.SaveDocument`` / ``LoadDocument`` /
``BaseDocument`` + ``InsertBaseDocument`` that normalise format aliases and
keep the active-document swap explicit. Paths must be absolute — the bridge
refuses relative paths so tests don't accidentally touch the C4D working
directory.
"""

from __future__ import annotations

import os
from typing import Any

import c4d
from c4d import documents

from ._helpers import _require_abs_path, _require_writable_path

# Alias → c4d.FORMAT_* constant name. Resolved lazily via getattr so a C4D
# build missing an export format produces a readable error instead of failing
# at import time.
_FORMAT_ALIASES: dict[str, str] = {
    "c4d": "FORMAT_C4DEXPORT",
    "abc": "FORMAT_ABCEXPORT",
    "alembic": "FORMAT_ABCEXPORT",
    "fbx": "FORMAT_FBX_EXPORT",
    "obj": "FORMAT_OBJ2EXPORT",
    "stl": "FORMAT_STLEXPORT",
    "ply": "FORMAT_PLYEXPORT",
    "usda": "FORMAT_USDEXPORT",
    "usd": "FORMAT_USDEXPORT",
    "gltf": "FORMAT_GLTFEXPORT",
}


def _resolve_format(alias: str) -> int:
    key = alias.strip().lower()
    const_name = _FORMAT_ALIASES.get(key)
    if const_name is None:
        raise ValueError(f"unknown format {alias!r}; accepted: {sorted(_FORMAT_ALIASES)}")
    value = getattr(c4d, const_name, None)
    if value is None:
        raise RuntimeError(f"C4D build does not expose c4d.{const_name} — cannot export {alias!r}")
    return int(value)


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

    flags = c4d.SAVEDOCUMENTFLAGS_DONTADDTORECENTLIST
    if save_copy:
        flags |= c4d.SAVEDOCUMENTFLAGS_SAVEAS

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
