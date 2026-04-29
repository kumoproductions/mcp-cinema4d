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


def _resolve_movable_or_raise(h: Any, what: str, expected_type: type) -> Any:
    """Resolve a handle and assert its concrete type for hierarchy moves.

    Used by ``move_entity`` to keep takes and render_data moves homogeneous —
    you can't drop a take under a render_data, etc.
    """
    node = _resolve_handle(h)
    if node is None:
        raise ValueError(f"{what} not resolved: {h}")
    if not isinstance(node, expected_type):
        raise ValueError(f"{what} did not resolve to a {expected_type.__name__}: {h}")
    return node


def handle_move_entity(params: dict[str, Any]) -> dict[str, Any]:
    """Reparent or reorder a node in the scene, take, or render_data hierarchy.

    Exactly one destination field must be provided:
      parent:  handle — insert as the last child of this node
      before:  handle — place immediately before this sibling
      after:   handle — place immediately after this sibling
      to_root: bool   — promote to the top of the hierarchy
                        (objects: doc root; takes: under Main; render_data: top level)

    The handle's kind decides the hierarchy:
      object       — c4d.BaseObject parent/sibling required
      take         — c4d.BaseTake parent/sibling required; Main cannot be moved
      render_data  — c4d.documents.RenderData parent/sibling required

    params:
      handle:  target node
    """
    h = params.get("handle")
    if not h:
        raise ValueError("handle required")
    node = _resolve_handle(h)
    if node is None:
        raise ValueError(f"handle not resolved: {h}")

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

    if isinstance(node, c4d.BaseObject):
        return _move_object(doc, node, parent_h, before_h, after_h, to_root)
    if isinstance(node, c4d.modules.takesystem.BaseTake):
        return _move_take(doc, node, parent_h, before_h, after_h, to_root)
    if isinstance(node, c4d.documents.RenderData):
        return _move_render_data(doc, node, parent_h, before_h, after_h, to_root)
    raise ValueError(f"move_entity does not support {type(node).__name__}")


def _move_object(doc, obj, parent_h, before_h, after_h, to_root) -> dict[str, Any]:
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


def _move_take(doc, take, parent_h, before_h, after_h, to_root) -> dict[str, Any]:
    if take.IsMain():
        raise ValueError("cannot move the Main take")
    td = doc.GetTakeData()
    if td is None:
        raise RuntimeError("take data unavailable")
    BaseTake = c4d.modules.takesystem.BaseTake

    doc.StartUndo()
    try:
        doc.AddUndo(c4d.UNDOTYPE_HIERARCHY_PSR, take)
        if to_root:
            # "Root" of the take hierarchy is the Main take.
            take.Remove()
            take.InsertUnder(td.GetMainTake())
        elif parent_h is not None:
            parent = _resolve_movable_or_raise(parent_h, "parent", BaseTake)
            if parent is take:
                raise ValueError("cannot reparent a take under itself")
            take.Remove()
            take.InsertUnder(parent)
        elif before_h is not None:
            sib = _resolve_movable_or_raise(before_h, "before", BaseTake)
            if sib is take:
                raise ValueError("'before' sibling must differ from the moved take")
            if sib.IsMain():
                raise ValueError("cannot place a take before Main")
            take.Remove()
            take.InsertBefore(sib)
        else:
            sib = _resolve_movable_or_raise(after_h, "after", BaseTake)
            if sib is take:
                raise ValueError("'after' sibling must differ from the moved take")
            take.Remove()
            take.InsertAfter(sib)
    finally:
        doc.EndUndo()
    c4d.EventAdd()
    return {
        "handle": {"kind": "take", "name": take.GetName()},
        "summary": _summary(take),
    }


def _move_render_data(doc, rd, parent_h, before_h, after_h, to_root) -> dict[str, Any]:
    RenderData = c4d.documents.RenderData

    doc.StartUndo()
    try:
        doc.AddUndo(c4d.UNDOTYPE_HIERARCHY_PSR, rd)
        if to_root:
            # Top level for render_data: Remove from current position, then
            # InsertRenderData re-registers it as a top-level sibling.
            rd.Remove()
            doc.InsertRenderData(rd)
        elif parent_h is not None:
            parent = _resolve_movable_or_raise(parent_h, "parent", RenderData)
            if parent is rd:
                raise ValueError("cannot reparent a render_data under itself")
            rd.Remove()
            rd.InsertUnder(parent)
        elif before_h is not None:
            sib = _resolve_movable_or_raise(before_h, "before", RenderData)
            if sib is rd:
                raise ValueError("'before' sibling must differ from the moved render_data")
            rd.Remove()
            rd.InsertBefore(sib)
        else:
            sib = _resolve_movable_or_raise(after_h, "after", RenderData)
            if sib is rd:
                raise ValueError("'after' sibling must differ from the moved render_data")
            rd.Remove()
            rd.InsertAfter(sib)
    finally:
        doc.EndUndo()
    c4d.EventAdd()
    return {
        "handle": {"kind": "render_data", "name": rd.GetName()},
        "summary": _summary(rd),
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
               render_data clone: optional parent render_data (defaults to top level)
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
            # AddTake(cloneFrom=...) tends to ignore the `name` argument and
            # assign "<src>.1"-style disambiguators instead, so force the
            # caller-provided name afterwards.
            if new_take.GetName() != clone_name:
                new_take.SetName(clone_name)
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
            if parent_h:
                if isinstance(parent_h, dict) and parent_h.get("kind") == "render_data":
                    parent_rd = _find_render_data(parent_h["name"])
                elif isinstance(parent_h, str):
                    parent_rd = _find_render_data(parent_h)
                else:
                    raise ValueError("render_data parent must be render_data handle or name")
                if parent_rd is None:
                    raise ValueError(f"parent render_data not found: {parent_h}")
                clone.InsertUnder(parent_rd)
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
