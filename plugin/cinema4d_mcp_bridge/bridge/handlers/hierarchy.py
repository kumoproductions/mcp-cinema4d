"""Hierarchy handlers: move_entity (reparent/reorder), clone_entity (duplicate).

``move_entity`` handles the common operations a user expresses as "put X under
Y" / "drop this at the root" / "reorder siblings". It accepts a handful of
mutually-exclusive target modes (``parent``, ``before``, ``after``,
``to_root``) and collapses them onto the right Insert* call.

``clone_entity`` wraps ``GetClone`` for objects, tags, materials and shaders,
inserting the copy next to (or under) the requested parent.
"""

from __future__ import annotations

from typing import Any

import c4d
from c4d import documents

from ._helpers import (
    _find_render_data,
    _find_take,
    _object_path,
    _resolve_handle,
    _summary,
)


def _resolve_object_or_raise(h: Any, what: str) -> c4d.BaseObject:
    obj = _resolve_handle(h)
    if obj is None:
        raise ValueError(f"{what} not resolved: {h}")
    if not isinstance(obj, c4d.BaseObject):
        raise ValueError(f"{what} did not resolve to a BaseObject: {h}")
    return obj


def handle_move_entity(params: dict[str, Any]) -> dict[str, Any]:
    """Reparent or reorder an object in the scene hierarchy.

    Exactly one destination field must be provided:
      parent:  handle — insert as the last child of this object
      before:  handle — place immediately before this sibling
      after:   handle — place immediately after this sibling
      to_root: bool   — promote to the document root

    params:
      handle:  target object
    """
    h = params.get("handle")
    if not h:
        raise ValueError("handle required")
    obj = _resolve_object_or_raise(h, "handle")

    parent_h = params.get("parent")
    before_h = params.get("before")
    after_h = params.get("after")
    to_root = bool(params.get("to_root", False))

    # Require exactly one destination so ambiguous combinations don't silently
    # pick one. Undetected conflicts here are surprising for callers.
    chosen = [x for x in (parent_h, before_h, after_h, to_root) if x]
    if len(chosen) != 1:
        raise ValueError("exactly one of parent / before / after / to_root must be provided")

    doc = documents.GetActiveDocument()
    if doc is None:
        raise RuntimeError("no active document")

    doc.StartUndo()
    try:
        doc.AddUndo(c4d.UNDOTYPE_HIERARCHY_PSR, obj)
        if to_root:
            obj.Remove()
            doc.InsertObject(obj)
        elif parent_h is not None:
            parent = _resolve_object_or_raise(parent_h, "parent")
            if parent is obj:
                raise ValueError("cannot reparent an object under itself")
            obj.Remove()
            obj.InsertUnder(parent)
        elif before_h is not None:
            sib = _resolve_object_or_raise(before_h, "before")
            if sib is obj:
                raise ValueError("'before' sibling must differ from the moved object")
            obj.Remove()
            obj.InsertBefore(sib)
        else:
            sib = _resolve_object_or_raise(after_h, "after")
            if sib is obj:
                raise ValueError("'after' sibling must differ from the moved object")
            obj.Remove()
            obj.InsertAfter(sib)
    finally:
        doc.EndUndo()
    c4d.EventAdd()

    return {
        "handle": {"kind": "object", "path": _object_path(obj), "name": obj.GetName()},
        "summary": _summary(obj),
    }


def handle_clone_entity(params: dict[str, Any]) -> dict[str, Any]:
    """Duplicate an entity.

    Supported kinds:
      object / tag / material / shader — via GetClone + parent insert
      render_data                      — via GetClone + doc.InsertRenderData
      video_post                       — via GetClone + rd.InsertVideoPost
      take                             — via TakeData.AddTake(cloneFrom=src),
                                         which also copies existing overrides

    params:
      handle:  source entity
      name:    optional new name for the clone
      parent:  object clone: destination parent (defaults to source sibling)
               tag / shader clone: required owner
               video_post clone: optional target render_data (defaults to source's)
               take clone: optional parent take (defaults to source's parent)
    """
    h = params.get("handle")
    if not h:
        raise ValueError("handle required")
    src = _resolve_handle(h)
    if src is None:
        raise ValueError(f"source handle not resolved: {h}")

    doc = documents.GetActiveDocument()
    if doc is None:
        raise RuntimeError("no active document")

    new_name = params.get("name")
    parent_h = params.get("parent")

    src_kind = h.get("kind") if isinstance(h, dict) else None

    # Take cloning uses TakeData.AddTake(cloneFrom=...) — GetClone alone would
    # produce a detached BaseTake without override wiring.
    if src_kind == "take" or isinstance(src, c4d.modules.takesystem.BaseTake):
        td = doc.GetTakeData()
        if td is None:
            raise RuntimeError("take data unavailable")
        if parent_h:
            if isinstance(parent_h, dict) and parent_h.get("kind") == "take":
                parent_take = _find_take(parent_h["name"])
            elif isinstance(parent_h, str):
                parent_take = _find_take(parent_h)
            else:
                raise ValueError("take clone parent must be a take handle or name string")
            if parent_take is None:
                raise ValueError(f"parent take not found: {parent_h}")
        else:
            parent_take = src.GetUp() or td.GetMainTake()
        clone_name = new_name if isinstance(new_name, str) and new_name else f"{src.GetName()}_copy"
        doc.StartUndo()
        try:
            new_take = td.AddTake(clone_name, parent_take, src)
            if new_take is None:
                raise RuntimeError(f"AddTake failed for {clone_name!r}")
            doc.AddUndo(c4d.UNDOTYPE_NEW, new_take)
        finally:
            doc.EndUndo()
        c4d.EventAdd()
        return {
            "handle": {"kind": "take", "name": new_take.GetName()},
            "summary": _summary(new_take),
        }

    clone = src.GetClone()
    if clone is None:
        raise RuntimeError("GetClone returned None")
    if isinstance(new_name, str) and new_name:
        clone.SetName(new_name)

    doc.StartUndo()
    try:
        if src_kind == "render_data" or isinstance(clone, c4d.documents.RenderData):
            doc.InsertRenderData(clone)
            doc.AddUndo(c4d.UNDOTYPE_NEW, clone)
            handle = {"kind": "render_data", "name": clone.GetName()}
        elif src_kind == "video_post" or isinstance(clone, c4d.documents.BaseVideoPost):
            # video_post clone lands in the requested render_data, defaulting
            # to the source's host so "duplicate this effect" is one call.
            if parent_h:
                if isinstance(parent_h, dict) and parent_h.get("kind") == "render_data":
                    dst_rd = _find_render_data(parent_h["name"])
                elif isinstance(parent_h, str):
                    dst_rd = _find_render_data(parent_h)
                else:
                    raise ValueError("video_post parent must be render_data handle or name")
                if dst_rd is None:
                    raise ValueError(f"render_data not found: {parent_h}")
            else:
                # Default: same render_data as source. We recover it from h.
                dst_rd = None
                if isinstance(h, dict) and h.get("render_data"):
                    dst_rd = _find_render_data(h["render_data"])
                if dst_rd is None:
                    raise ValueError("could not infer destination render_data; provide 'parent'")
            dst_rd.InsertVideoPost(clone)
            doc.AddUndo(c4d.UNDOTYPE_NEW, clone)
            handle = {
                "kind": "video_post",
                "render_data": dst_rd.GetName(),
                "type_id": clone.GetType(),
            }
        elif isinstance(clone, c4d.BaseObject):
            if parent_h:
                parent = _resolve_object_or_raise(parent_h, "parent")
                clone.InsertUnder(parent)
            elif isinstance(src, c4d.BaseObject):
                # Default: drop next to the source so sibling ordering stays predictable.
                clone.InsertAfter(src)
            else:
                doc.InsertObject(clone)
            doc.AddUndo(c4d.UNDOTYPE_NEW, clone)
            handle = {
                "kind": "object",
                "path": _object_path(clone),
                "name": clone.GetName(),
            }
        elif isinstance(clone, c4d.BaseMaterial):
            doc.InsertMaterial(clone)
            doc.AddUndo(c4d.UNDOTYPE_NEW, clone)
            handle = {"kind": "material", "name": clone.GetName()}
        elif isinstance(clone, c4d.BaseTag):
            if not parent_h:
                raise ValueError("cloning a tag requires 'parent' (owner object handle)")
            owner = _resolve_object_or_raise(parent_h, "parent")
            owner.InsertTag(clone)
            doc.AddUndo(c4d.UNDOTYPE_NEW, clone)
            handle = {
                "kind": "tag",
                "object_path": _object_path(owner),
                "object": owner.GetName(),
                "type_id": clone.GetType(),
                "tag_name": clone.GetName(),
            }
        elif isinstance(clone, c4d.BaseShader):
            if not parent_h:
                raise ValueError("cloning a shader requires 'parent' (owner handle)")
            owner = _resolve_handle(parent_h)
            if owner is None:
                raise ValueError(f"parent not resolved: {parent_h}")
            owner.InsertShader(clone)
            doc.AddUndo(c4d.UNDOTYPE_NEW, clone)
            idx = 0
            s = owner.GetFirstShader()
            while s is not None:
                if s == clone:
                    break
                idx += 1
                s = s.GetNext()
            handle = {
                "kind": "shader",
                "owner": parent_h,
                "index": idx,
                "name": clone.GetName(),
            }
        else:
            raise ValueError(f"clone of unsupported type: {type(clone).__name__}")
    finally:
        doc.EndUndo()
    c4d.EventAdd()

    return {"handle": handle, "summary": _summary(clone)}
