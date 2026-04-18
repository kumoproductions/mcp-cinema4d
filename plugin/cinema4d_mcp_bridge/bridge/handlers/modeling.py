"""Modeling command handler — wraps ``c4d.utils.SendModelingCommand``.

Exposes the common topology / normalization ops that an LLM wants to invoke
without knowing C4D's MCOMMAND_* constants. Handlers return either ``True``
(for in-place ops like Make Editable) or a list of newly-produced objects
(Current State to Object, Connect/Join) which are inserted into the active
document so the caller can reference them via handles afterwards.
"""

from __future__ import annotations

from typing import Any

import c4d
from c4d import documents
from c4d import utils as c4d_utils

from ._helpers import (
    _apply_params,
    _find_objects_by_name,
    _object_path,
    _resolve_handle,
    _summary,
)

# Alias → MCOMMAND_* lookup. We resolve via getattr because not every
# constant is guaranteed to exist in every C4D version, and missing ones
# should yield a clear error rather than an AttributeError at import time.
_COMMAND_ALIASES: dict[str, str] = {
    "current_state_to_object": "MCOMMAND_CURRENTSTATETOOBJECT",
    "cso": "MCOMMAND_CURRENTSTATETOOBJECT",
    "make_editable": "MCOMMAND_MAKEEDITABLE",
    "connect": "MCOMMAND_JOIN",
    "join": "MCOMMAND_JOIN",
    "connect_delete": "MCOMMAND_CONNECTDELETE",
    "subdivide": "MCOMMAND_SUBDIVIDE",
    "triangulate": "MCOMMAND_TRIANGULATE",
    "untriangulate": "MCOMMAND_UNTRIANGULATE",
    "reverse_normals": "MCOMMAND_REVERSENORMALS",
    "align_normals": "MCOMMAND_ALIGNNORMALS",
    "optimize": "MCOMMAND_OPTIMIZE",
    "center_axis": "MCOMMAND_AXIS_CENTERPARENT",
    "split": "MCOMMAND_SPLIT",
    "explode_segments": "MCOMMAND_EXPLODESEGMENTS",
    "melt": "MCOMMAND_MELT",
    "collapse": "MCOMMAND_COLLAPSE",
    "dissolve": "MCOMMAND_DISSOLVE",
}

_MODE_ALIASES: dict[str, str] = {
    "all": "MODELINGCOMMANDMODE_ALL",
    "edge": "MODELINGCOMMANDMODE_EDGESELECTION",
    "point": "MODELINGCOMMANDMODE_POINTSELECTION",
    "poly": "MODELINGCOMMANDMODE_POLYGONSELECTION",
    "polygon": "MODELINGCOMMANDMODE_POLYGONSELECTION",
}


def _resolve_command(name: str | int) -> int:
    if isinstance(name, int):
        return name
    if not isinstance(name, str):
        raise ValueError(f"command must be a string alias or int, got {type(name).__name__}")
    key = name.strip().lower()
    const_name = _COMMAND_ALIASES.get(key)
    if const_name is None:
        raise ValueError(
            f"unknown modeling command {name!r}; accepted aliases: {sorted(_COMMAND_ALIASES)}"
        )
    value = getattr(c4d, const_name, None)
    if value is None:
        raise RuntimeError(
            f"C4D build does not expose c4d.{const_name} — cannot run {name!r} on this version"
        )
    return int(value)


def _resolve_mode(name: str | int | None) -> int:
    if name is None:
        return c4d.MODELINGCOMMANDMODE_ALL
    if isinstance(name, int):
        return name
    if not isinstance(name, str):
        raise ValueError(f"mode must be a string alias, int or null, got {type(name).__name__}")
    key = name.strip().lower()
    const_name = _MODE_ALIASES.get(key)
    if const_name is None:
        raise ValueError(f"unknown mode {name!r}; accepted: {sorted(_MODE_ALIASES)}")
    return int(getattr(c4d, const_name))


def _is_producing_command(cmd: int) -> bool:
    """Commands that return *new* objects instead of mutating the source list.

    Only these need post-call ``InsertObject`` since SendModelingCommand
    leaves them dangling outside the document. Per the 2026 SDK,
    MAKEEDITABLE is in this category too — the original primitive is
    removed and a new polygon object is returned for the caller to insert.
    """
    producing = {
        getattr(c4d, "MCOMMAND_CURRENTSTATETOOBJECT", -1),
        getattr(c4d, "MCOMMAND_JOIN", -2),
        getattr(c4d, "MCOMMAND_SPLIT", -3),
        getattr(c4d, "MCOMMAND_EXPLODESEGMENTS", -4),
        getattr(c4d, "MCOMMAND_MAKEEDITABLE", -5),
    }
    return cmd in producing


def handle_modeling_command(params: dict[str, Any]) -> dict[str, Any]:
    """Run ``c4d.utils.SendModelingCommand`` on the resolved targets.

    params:
      command: alias (see _COMMAND_ALIASES) or raw MCOMMAND_* int
      targets: list of object handles
      mode:    "all" (default) | "edge" | "point" | "poly"
      params:  optional {param_id: value} BaseContainer passed as ``bc``
    """
    command_arg = params.get("command")
    if command_arg is None:
        raise ValueError("command required")
    targets = params.get("targets")
    if not isinstance(targets, list) or not targets:
        raise ValueError("targets must be a non-empty list of handles")

    cmd = _resolve_command(command_arg)
    mode = _resolve_mode(params.get("mode"))

    doc = documents.GetActiveDocument()
    if doc is None:
        raise RuntimeError("no active document")

    resolved: list[c4d.BaseObject] = []
    for h in targets:
        obj = _resolve_handle(h)
        if obj is None:
            raise ValueError(f"target handle not resolved: {h}")
        if not isinstance(obj, c4d.BaseObject):
            raise ValueError(f"target handle did not resolve to BaseObject: {h}")
        resolved.append(obj)

    # SendModelingCommand in 2026 rejects ``bc=None`` — the binding wants
    # an actual BaseContainer even when no sub-params are needed. Always
    # hand over a (possibly empty) container.
    bc = c4d.BaseContainer()
    raw_params = params.get("params") or {}
    if raw_params:
        # _apply_params only works on things indexable by int; BaseContainer is.
        _apply_params(bc, raw_params)

    # Remember the source names so MAKEEDITABLE-style commands — which can
    # either replace the source (returning new objects) or mutate in place
    # depending on the C4D build — can be re-resolved by name afterwards.
    source_names = [obj.GetName() for obj in resolved]

    doc.StartUndo()
    try:
        result = c4d_utils.SendModelingCommand(
            command=cmd,
            list=resolved,
            mode=mode,
            bc=bc,
            doc=doc,
        )
        if result is False:
            raise RuntimeError("SendModelingCommand returned False")

        produced: list[c4d.BaseObject] = []
        make_editable_id = getattr(c4d, "MCOMMAND_MAKEEDITABLE", -5)

        if _is_producing_command(cmd) and isinstance(result, list):
            new_objs = [n for n in result if isinstance(n, c4d.BaseObject)]
            # Only insert the new objects that aren't already in the doc.
            # Across C4D builds, some producing commands (MAKEEDITABLE in
            # 2026 in particular) return objects already attached to the
            # scene — re-inserting them raises or corrupts state.
            anchor = resolved[0] if resolved else None
            replace_sources = cmd == make_editable_id

            for new_obj in new_objs:
                if new_obj.GetDocument() is not None:
                    continue  # C4D already placed it
                if replace_sources:
                    # Pair with source by order so the new polygon takes
                    # the primitive's hierarchy slot.
                    idx = new_objs.index(new_obj)
                    src = resolved[idx] if idx < len(resolved) else None
                    parent = src.GetUp() if src else None
                    pred = src.GetPred() if src else None
                    if parent is not None:
                        new_obj.InsertUnder(parent)
                    elif pred is not None:
                        doc.InsertObject(new_obj, pred=pred)
                    else:
                        doc.InsertObject(new_obj)
                else:
                    if anchor is not None:
                        doc.InsertObject(new_obj, pred=anchor)
                    else:
                        doc.InsertObject(new_obj)
                doc.AddUndo(c4d.UNDOTYPE_NEW, new_obj)

            # For MAKEEDITABLE: remove the leftover primitives if they're
            # still attached to the doc (i.e. C4D didn't already swap them).
            if replace_sources:
                for src in resolved:
                    if src.GetDocument() is not None:
                        doc.AddUndo(c4d.UNDOTYPE_DELETE, src)
                        src.Remove()

            produced = new_objs
        else:
            # Pure in-place commands (subdivide, triangulate, …). Sources
            # are mutated, not replaced.
            produced = resolved

        # Fallback: if `produced` is empty or points at now-detached refs,
        # look up by the source names again. Handles MAKEEDITABLE cases
        # where C4D swapped the object and SendModelingCommand returned
        # True/None instead of a list.
        if not produced or any(p.GetDocument() is None for p in produced):
            recovered: list[c4d.BaseObject] = []
            for name in source_names:
                matches = _find_objects_by_name(name)
                if matches:
                    recovered.extend(matches)
            if recovered:
                produced = recovered
    finally:
        doc.EndUndo()
    c4d.EventAdd()

    def _handle_for(obj: c4d.BaseObject) -> dict[str, Any]:
        entry = _summary(obj)
        entry["path"] = _object_path(obj)
        entry["handle"] = {"kind": "object", "path": entry["path"], "name": obj.GetName()}
        return entry

    return {
        "ok": True,
        "command_id": cmd,
        "results": [_handle_for(o) for o in produced],
    }
