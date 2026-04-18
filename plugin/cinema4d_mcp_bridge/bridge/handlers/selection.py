"""Selection handlers: get_selection, set_selection.

Mirrors Cinema 4D's document-level selection state (active object(s), active
tag, active material). LLMs use these to observe what the user is currently
working on and to steer follow-up edits without re-picking entities.
"""

from __future__ import annotations

from typing import Any

import c4d
from c4d import documents

from ._helpers import (
    _object_path,
    _resolve_handle,
)


def _object_handle(obj: c4d.BaseObject) -> dict[str, Any]:
    return {"kind": "object", "path": _object_path(obj), "name": obj.GetName()}


def _tag_handle(tag: c4d.BaseTag) -> dict[str, Any] | None:
    owner = tag.GetObject()
    if owner is None:
        return None
    return {
        "kind": "tag",
        "object_path": _object_path(owner),
        "object": owner.GetName(),
        "type_id": tag.GetType(),
        "tag_name": tag.GetName(),
    }


def _material_handle(mat: c4d.BaseMaterial) -> dict[str, Any]:
    return {"kind": "material", "name": mat.GetName()}


def handle_get_selection(_params: dict[str, Any]) -> dict[str, Any]:
    doc = documents.GetActiveDocument()
    if doc is None:
        return {
            "active_object": None,
            "selected_objects": [],
            "active_tag": None,
            "active_material": None,
        }

    active_obj = doc.GetActiveObject()
    try:
        selected = doc.GetActiveObjects(c4d.GETACTIVEOBJECTFLAGS_NONE) or []
    except Exception:
        selected = []

    active_tag = doc.GetActiveTag()
    active_mat = doc.GetActiveMaterial()

    return {
        "active_object": _object_handle(active_obj) if active_obj is not None else None,
        "selected_objects": [_object_handle(o) for o in selected],
        "active_tag": _tag_handle(active_tag) if active_tag is not None else None,
        "active_material": (_material_handle(active_mat) if active_mat is not None else None),
    }


def handle_set_selection(params: dict[str, Any]) -> dict[str, Any]:
    """Update the document's active selection.

    params:
      objects:  list of object handles (first = active, rest selected)
      tag:      tag handle for the active tag
      material: material handle for the active material
      mode:     "replace" (default) | "add" — applies to ``objects``
      clear:    bool — if True, deselect everything first (and skip other fields)
    """
    doc = documents.GetActiveDocument()
    if doc is None:
        raise RuntimeError("no active document")

    if params.get("clear"):
        # Deselect every object in the scene plus the active tag/material.
        def walk(o):
            while o is not None:
                o.DelBit(c4d.BIT_ACTIVE)
                d = o.GetDown()
                if d is not None:
                    walk(d)
                o = o.GetNext()

        walk(doc.GetFirstObject())
        doc.SetActiveTag(None)
        doc.SetActiveMaterial(None)
        c4d.EventAdd()
        return {"set": {"cleared": True}}

    out: dict[str, Any] = {}

    mode = str(params.get("mode", "replace")).lower()
    if mode not in ("replace", "add"):
        raise ValueError(f"mode must be 'replace' or 'add', got {mode!r}")

    objects = params.get("objects")
    if objects is not None:
        if not isinstance(objects, list):
            raise ValueError("objects must be a list of handles")
        resolved: list[c4d.BaseObject] = []
        for h in objects:
            obj = _resolve_handle(h)
            if obj is None:
                raise ValueError(f"object handle not resolved: {h}")
            if not isinstance(obj, c4d.BaseObject):
                raise ValueError(f"handle did not resolve to BaseObject: {h}")
            resolved.append(obj)

        if mode == "replace":
            # SELECTION_NEW only clears within the active stack; deselect
            # siblings manually so callers get a predictable "exactly these"
            # outcome.
            def walk(o):
                while o is not None:
                    o.DelBit(c4d.BIT_ACTIVE)
                    d = o.GetDown()
                    if d is not None:
                        walk(d)
                    o = o.GetNext()

            walk(doc.GetFirstObject())

        for i, obj in enumerate(resolved):
            sel_mode = c4d.SELECTION_ADD if (mode == "add" or i > 0) else c4d.SELECTION_NEW
            doc.SetActiveObject(obj, sel_mode)
        out["objects"] = [_object_handle(o) for o in resolved]

    tag_h = params.get("tag")
    if tag_h is not None:
        tag = _resolve_handle(tag_h)
        if tag is None or not isinstance(tag, c4d.BaseTag):
            raise ValueError(f"tag handle did not resolve to BaseTag: {tag_h}")
        doc.SetActiveTag(tag)
        th = _tag_handle(tag)
        if th is not None:
            out["tag"] = th

    mat_h = params.get("material")
    if mat_h is not None:
        mat = _resolve_handle(mat_h)
        if mat is None or not isinstance(mat, c4d.BaseMaterial):
            raise ValueError(f"material handle did not resolve to BaseMaterial: {mat_h}")
        doc.SetActiveMaterial(mat)
        out["material"] = _material_handle(mat)

    c4d.EventAdd()
    return {"set": out}


# Exported for reuse by other handlers that want to emit canonical handles.
__all__ = [
    "_material_handle",
    "_object_handle",
    "_tag_handle",
    "handle_get_selection",
    "handle_set_selection",
]
