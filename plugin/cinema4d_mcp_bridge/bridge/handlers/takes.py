"""Takes handlers: ``create_take``, ``take_override``.

Wraps Cinema 4D's TakeData API. ``create_take`` adds (or updates) a Take
under a parent and optionally links a camera + RenderData. ``take_override``
records per-Take parameter overrides on a target node — the Take system's
"this parameter differs in this Take vs. its parent" mechanism.
"""

from __future__ import annotations

from typing import Any

import c4d
from c4d import documents

from ._helpers import (
    _ensure_entity_writable,
    _find_object,
    _find_render_data,
    _find_take,
    _param_dtype,
    _path_to_desc_id,
    _resolve_handle,
)


def handle_create_take(params: dict[str, Any]) -> dict[str, Any]:
    """Create or update a Take, optionally linking camera and render data.

    params:
      name:             string (required)
      parent:           string — parent take name (default: main take)
      camera:           string — object name for the take's camera override
      render_data:      string — render data name to link
      checked:          bool (default true on create)
      make_active:      bool
      update_if_exists: bool
      clear_camera:     bool — explicitly unset the camera override
      clear_render_data: bool — explicitly unset the render data override
    """
    name = params.get("name")
    if not name or not isinstance(name, str):
        raise ValueError("name required")

    doc = documents.GetActiveDocument()
    if doc is None:
        raise RuntimeError("no active document")
    td = doc.GetTakeData()
    if td is None:
        raise RuntimeError("take data unavailable")

    parent_name = params.get("parent")
    if parent_name:
        parent_take = _find_take(str(parent_name))
        if parent_take is None:
            raise ValueError(f"parent take not found: {parent_name}")
    else:
        parent_take = td.GetMainTake()

    update_if_exists = bool(params.get("update_if_exists", False))
    existing = _find_take(name) if update_if_exists else None
    created = existing is None

    doc.StartUndo()
    try:
        take = existing if existing is not None else td.AddTake(name, parent_take, None)
        if take is None:
            raise RuntimeError(f"AddTake failed for {name!r}")

        if "camera" in params:
            cam_name = params.get("camera")
            if cam_name:
                cam = _find_object(str(cam_name))
                if cam is None:
                    raise ValueError(f"camera not found: {cam_name}")
                take.SetCamera(td, cam)
            elif params.get("clear_camera"):
                take.SetCamera(td, None)
        if "render_data" in params:
            rd_name = params.get("render_data")
            if rd_name:
                rd = _find_render_data(str(rd_name))
                if rd is None:
                    raise ValueError(f"render_data not found: {rd_name}")
                take.SetRenderData(td, rd)
            elif params.get("clear_render_data"):
                take.SetRenderData(td, None)
        if "checked" in params and params["checked"] is not None:
            take.SetChecked(bool(params["checked"]))
        elif created:
            # Default to checked on create so the take actually participates
            # in batch renders (matches the docstring).
            take.SetChecked(True)

        if bool(params.get("make_active", False)):
            td.SetCurrentTake(take)

        if created:
            doc.AddUndo(c4d.UNDOTYPE_NEW, take)
        else:
            doc.AddUndo(c4d.UNDOTYPE_CHANGE, take)
    finally:
        doc.EndUndo()
    c4d.EventAdd()

    linked_cam = take.GetCamera(td)
    linked_rd = take.GetRenderData(td)
    return {
        "handle": {"kind": "take", "name": take.GetName()},
        "created": created,
        "camera": linked_cam.GetName() if linked_cam else None,
        "render_data": linked_rd.GetName() if linked_rd else None,
        "checked": bool(take.IsChecked()),
    }


def handle_take_override(params: dict[str, Any]) -> dict[str, Any]:
    """Write per-Take parameter overrides onto a target node.

    A Take override records that a specific parameter on a specific node
    differs in this take vs. its parent. The C4D flow is:
      override = take.FindOverride(td, node) or take.OverrideNode(td, node)
      override.UpdateSceneNode(td, descid)    # register this param
      override[descid] = value                # write the override value

    params:
      take:    take name (required)
      target:  handle of the node to override (object / tag / material /
               render_data / video_post / shader). Required.
      values:  list of {path, value} — same path syntax as set_params.
               (paths go through _path_to_desc_id, so int / [int,...] /
               vector sub-keys 'x'/'y'/'z' all work.)
      clear:   list of paths to drop from the override (optional)
      remove_all: bool — drop the entire override for this node
      params:  shorthand {pid: value} for flat writes (applied after `values`)

    Returns:
      {applied:[{path,value}], errors:[{path,error}],
       cleared:[path,...], removed_all:bool, take, target}
    """
    take_name = params.get("take")
    if not take_name or not isinstance(take_name, str):
        raise ValueError("'take' required")
    target_h = params.get("target")
    if not target_h:
        raise ValueError("'target' handle required")

    values = params.get("values") or []
    clear_paths = params.get("clear") or []
    remove_all = bool(params.get("remove_all", False))
    extra = params.get("params") or {}

    if not values and not clear_paths and not remove_all and not extra:
        raise ValueError("nothing to do: provide values / clear / remove_all / params")

    doc = documents.GetActiveDocument()
    if doc is None:
        raise RuntimeError("no active document")
    td = doc.GetTakeData()
    if td is None:
        raise RuntimeError("take data unavailable")

    take = _find_take(take_name)
    if take is None:
        raise ValueError(f"take not found: {take_name}")
    if take.IsMain():
        # Main take cannot hold overrides — guide the caller to set_params.
        raise ValueError("cannot override on the Main take; use set_params instead")

    target = _resolve_handle(target_h)
    if target is None:
        raise ValueError(f"target not resolved: {target_h}")

    # Refuse take overrides on a Python-bearing entity unless opted IN —
    # overriding the code parameter is the same RCE as set_params.
    _ensure_entity_writable(target)

    applied: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    cleared: list[Any] = []
    removed_all = False

    doc.StartUndo()
    try:
        doc.AddUndo(c4d.UNDOTYPE_CHANGE, take)

        if remove_all:
            # Removing the entire override node is SDK-version dependent. Try
            # the known APIs in order; fall back to a no-op if neither exists.
            if hasattr(take, "RemoveOverride"):
                take.RemoveOverride(td, target)
                removed_all = True
            elif hasattr(take, "KillOverrides"):
                # KillOverrides drops ALL overrides on this take, not just for
                # this target. We only call it when the caller passes no target
                # to protect sibling overrides — the API simply can't do a
                # per-target kill on this C4D build.
                errors.append(
                    {
                        "path": None,
                        "error": "SDK exposes only KillOverrides (kills all); refusing "
                        "to cascade. Use 'clear' on specific paths instead.",
                    }
                )
            else:
                errors.append(
                    {
                        "path": None,
                        "error": "this C4D build has no RemoveOverride API",
                    }
                )
        else:
            override = take.FindOverride(td, target)
            if override is None:
                # OverrideNode(takeData, node, deleteAnim) — the third arg is
                # required on C4D 2026+. False keeps the scene-side animation
                # intact (we're only adding an override on top).
                override = take.OverrideNode(td, target, False)
            if override is None:
                raise RuntimeError("OverrideNode returned None")

            # Apply value overrides.
            all_values = list(values)
            for pid, val in extra.items():
                all_values.append({"path": int(pid), "value": val})

            for entry in all_values:
                if not isinstance(entry, dict) or "path" not in entry or "value" not in entry:
                    errors.append({"path": entry, "error": "each entry needs {path, value}"})
                    continue
                try:
                    descid, norm = _path_to_desc_id(target, entry["path"])
                    override.UpdateSceneNode(td, descid)
                    value = entry["value"]
                    # Coerce 3-float lists into c4d.Vector for vector-typed params.
                    if (
                        isinstance(value, (list, tuple))
                        and len(value) == 3
                        and all(
                            isinstance(v, (int, float)) and not isinstance(v, bool) for v in value
                        )
                    ):
                        dtype = _param_dtype(target, descid[0].id)
                        if dtype == c4d.DTYPE_VECTOR:
                            value = c4d.Vector(float(value[0]), float(value[1]), float(value[2]))
                    override[descid] = value
                    applied.append({"path": norm, "value": entry["value"]})
                except Exception as exc:
                    errors.append(
                        {"path": entry.get("path"), "error": f"{type(exc).__name__}: {exc}"}
                    )

            # Clear requested paths (mark unoverridden). C4D 2026's
            # DeleteOverride drops the internal override marker but leaves the
            # scene node's cached value stuck on the old override value, so we
            # first copy the Main-take value into the override and call
            # UpdateSceneNode to force a resync — then remove the override
            # marker via DeleteOverride(td, node, descID). Active take is
            # swapped momentarily to read Main values and restored afterward.
            if clear_paths:
                main_take = td.GetMainTake()
                cur_take = td.GetCurrentTake()
                resolved: list[tuple[Any, c4d.DescID, Any]] = []  # (path, descid, norm)
                for p in clear_paths:
                    try:
                        descid, norm = _path_to_desc_id(target, p)
                        resolved.append((p, descid, norm))
                    except Exception as exc:
                        errors.append({"path": p, "error": f"{type(exc).__name__}: {exc}"})

                if resolved:
                    td.SetCurrentTake(main_take)
                    c4d.EventAdd()
                    main_values: dict[int, Any] = {}
                    for idx, (p, descid, _norm) in enumerate(resolved):
                        try:
                            main_values[idx] = target[descid]
                        except Exception as exc:
                            errors.append(
                                {"path": p, "error": f"read main: {type(exc).__name__}: {exc}"}
                            )
                    td.SetCurrentTake(take)
                    c4d.EventAdd()
                    for idx, (p, descid, norm) in enumerate(resolved):
                        if idx not in main_values:
                            continue
                        try:
                            cur_ov = take.FindOverride(td, target)
                            if cur_ov is not None:
                                cur_ov[descid] = main_values[idx]
                                cur_ov.UpdateSceneNode(td, descid)
                            take.DeleteOverride(td, target, descid)
                            cleared.append(norm)
                        except Exception as exc:
                            errors.append({"path": p, "error": f"{type(exc).__name__}: {exc}"})
                    if cur_take is not None and cur_take is not take:
                        td.SetCurrentTake(cur_take)
                        c4d.EventAdd()
    finally:
        doc.EndUndo()
    c4d.EventAdd()

    return {
        "take": take.GetName(),
        "target": target_h,
        "applied": applied,
        "errors": errors,
        "cleared": cleared,
        "removed_all": removed_all,
    }
