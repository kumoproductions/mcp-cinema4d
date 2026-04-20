"""Generic introspection / mutation handlers working with handle dicts.

Handles are JSON dicts such as ``{"kind": "render_data", "name": "..."}`` or
``{"kind": "video_post", "render_data": "...", "type_id": 1029525}``; see
``_helpers._resolve_handle`` for the full list.
"""

from __future__ import annotations

import contextlib
from typing import Any

import c4d
from c4d import documents

from ._helpers import (
    _apply_name_pattern,
    _apply_params,
    _describe_params,
    _dump_container,
    _find_object,
    _find_object_by_path,
    _find_render_data,
    _json_safe,
    _object_path,
    _param_dtype,
    _path_to_desc_id,
    _resolve_handle,
    _summary,
    resolve_type_id,
)


def handle_list_entities(params: dict[str, Any]) -> dict[str, Any]:
    kind = params.get("kind")
    if not isinstance(kind, str) or not kind:
        raise ValueError("parameter 'kind' is required")
    pattern = params.get("name_pattern")
    doc = documents.GetActiveDocument()
    if doc is None:
        raise RuntimeError("no active document")

    if kind == "object":
        # Optional filters / per-match enrichments — object-only, silently
        # ignored for other kinds so the API stays flat.
        type_ids = params.get("type_ids")
        tag_types = params.get("tag_types")
        max_depth = params.get("max_depth")
        include_tags = bool(params.get("include_tags", False))
        include_params = params.get("include_params") or []

        type_set = {int(x) for x in type_ids} if type_ids else None
        tag_set = {int(x) for x in tag_types} if tag_types else None

        out: list[dict[str, Any]] = []

        def walk(o, depth=0):
            while o is not None:
                if max_depth is None or depth <= int(max_depth):
                    match = True
                    if type_set is not None and o.GetType() not in type_set:
                        match = False
                    if match and tag_set is not None:
                        has = False
                        tt = o.GetFirstTag()
                        while tt is not None:
                            if tt.GetType() in tag_set:
                                has = True
                                break
                            tt = tt.GetNext()
                        if not has:
                            match = False
                    if match:
                        tag_count = 0
                        t = o.GetFirstTag()
                        while t is not None:
                            tag_count += 1
                            t = t.GetNext()
                        entry = _summary(o)
                        entry["depth"] = depth
                        entry["tag_count"] = tag_count
                        if include_tags:
                            tags: list[dict[str, Any]] = []
                            t = o.GetFirstTag()
                            while t is not None:
                                tags.append(
                                    {
                                        "type_id": t.GetType(),
                                        "type_name": t.GetTypeName(),
                                        "name": t.GetName(),
                                    }
                                )
                                t = t.GetNext()
                            entry["tags"] = tags
                        if include_params:
                            pvals: dict[str, Any] = {}
                            for pid in include_params:
                                try:
                                    pvals[str(int(pid))] = _json_safe(o[int(pid)])
                                except Exception as exc:
                                    pvals[str(pid)] = {"__error__": f"{type(exc).__name__}: {exc}"}
                            entry["params"] = pvals
                        out.append(entry)
                d = o.GetDown()
                if d is not None:
                    walk(d, depth + 1)
                o = o.GetNext()

        walk(doc.GetFirstObject())
        return {"entities": _apply_name_pattern(out, pattern)}

    if kind == "render_data":
        out = []
        active = doc.GetActiveRenderData()
        r = doc.GetFirstRenderData()
        while r is not None:
            out.append({"name": r.GetName(), "is_active": r == active})
            r = r.GetNext()
        return {"entities": _apply_name_pattern(out, pattern)}

    if kind == "take":
        td = doc.GetTakeData()
        out = []
        current_take = td.GetCurrentTake() if td is not None else None

        def walk_take(t, depth=0):
            rd = t.GetRenderData(td)
            cam = t.GetCamera(td)
            out.append(
                {
                    "name": t.GetName(),
                    "is_main": t.IsMain(),
                    "is_active": t == current_take,
                    "depth": depth,
                    "render_data": rd.GetName() if rd else None,
                    "camera": cam.GetName() if cam else None,
                }
            )
            c = t.GetDown()
            while c is not None:
                walk_take(c, depth + 1)
                c = c.GetNext()

        walk_take(td.GetMainTake())
        return {"entities": _apply_name_pattern(out, pattern)}

    if kind == "material":
        out = []
        active_mat = doc.GetActiveMaterial()
        m = doc.GetFirstMaterial()
        while m is not None:
            entry = _summary(m)
            entry["is_active"] = m == active_mat
            out.append(entry)
            m = m.GetNext()
        return {"entities": _apply_name_pattern(out, pattern)}

    if kind == "tag":
        object_name = params.get("object")
        object_path = params.get("object_path")
        out = []

        def collect(owner):
            t = owner.GetFirstTag()
            while t is not None:
                e = _summary(t)
                e["object"] = owner.GetName()
                e["object_path"] = _object_path(owner)
                out.append(e)
                t = t.GetNext()

        if object_path:
            owner = _find_object_by_path(str(object_path))
            if owner is None:
                raise ValueError(f"object not found at path: {object_path}")
            collect(owner)
        elif object_name:
            owner = _find_object(str(object_name))
            if owner is None:
                raise ValueError(f"object not found: {object_name}")
            collect(owner)
        else:

            def walk(o):
                while o is not None:
                    collect(o)
                    d = o.GetDown()
                    if d is not None:
                        walk(d)
                    o = o.GetNext()

            walk(doc.GetFirstObject())
        return {"entities": _apply_name_pattern(out, pattern)}

    if kind == "video_post":
        rd_name = params.get("render_data")
        if not rd_name:
            raise ValueError("parameter 'render_data' is required for kind=video_post")
        rd = _find_render_data(rd_name)
        if rd is None:
            raise ValueError(f"render_data not found: {rd_name}")
        out = []
        vp = rd.GetFirstVideoPost()
        while vp is not None:
            out.append(_summary(vp))
            vp = vp.GetNext()
        return {"entities": _apply_name_pattern(out, pattern)}

    if kind == "shader":
        owner_h = params.get("owner")
        if not owner_h:
            raise ValueError("parameter 'owner' (handle) is required for kind=shader")
        owner = _resolve_handle(owner_h)
        if owner is None:
            raise ValueError(f"owner not resolved: {owner_h}")
        out = []
        s = owner.GetFirstShader() if hasattr(owner, "GetFirstShader") else None
        idx = 0
        while s is not None:
            e = _summary(s)
            e["index"] = idx
            out.append(e)
            s = s.GetNext()
            idx += 1
        return {"entities": _apply_name_pattern(out, pattern)}

    raise ValueError(f"unknown kind: {kind!r}")


def handle_describe(params: dict[str, Any]) -> dict[str, Any]:
    h = params.get("handle")
    if not h:
        raise ValueError("parameter 'handle' is required")
    obj = _resolve_handle(h)
    if obj is None:
        raise ValueError(f"handle not resolved: {h}")
    return {
        "summary": _summary(obj),
        "params": _describe_params(obj),
    }


def _coerce_vector(value: Any) -> Any:
    if (
        isinstance(value, (list, tuple))
        and len(value) == 3
        and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in value)
    ):
        return c4d.Vector(float(value[0]), float(value[1]), float(value[2]))
    return value


def handle_get_params(params: dict[str, Any]) -> dict[str, Any]:
    """Read parameters by id or DescID path.

    params:
      handle: target
      ids:    list of path entries. Each entry is one of:
                - int                 (top-level id)
                - [int, int, ...]     (chained DescID; dtypes inferred)
                - ["x"|"y"|"z", ...]  (vector sub-component string)
                - [[id, "dtype"], …]  (explicit dtype overrides: real/long/bool/vector)

    Returns ``{values: [{path, value}, ...]}`` in the same order as ``ids``.
    """
    h = params.get("handle")
    ids = params.get("ids") or []
    if not h:
        raise ValueError("parameter 'handle' is required")
    obj = _resolve_handle(h)
    if obj is None:
        raise ValueError(f"handle not resolved: {h}")

    out: list[dict[str, Any]] = []
    for raw in ids:
        try:
            did, normalized = _path_to_desc_id(obj, raw)
        except Exception as exc:
            out.append({"path": raw, "error": f"{type(exc).__name__}: {exc}"})
            continue
        # Fast path for simple ints — obj[pid] triggers C4D's own DescID fill.
        try:
            value = obj[did] if len(normalized) > 1 else obj[int(normalized[0])]
            out.append({"path": normalized, "value": _json_safe(value)})
        except Exception as exc:
            out.append({"path": normalized, "error": f"{type(exc).__name__}: {exc}"})
    return {"values": out}


def handle_set_params(params: dict[str, Any]) -> dict[str, Any]:
    """Write parameters by id or DescID path, wrapped in a single undo group.

    params:
      handle: target
      values: list of ``{path, value}`` entries — ``path`` accepts the same
              forms as ``get_params.ids``. Lists of 3 numbers auto-coerce
              into ``c4d.Vector`` for vector-typed destinations.

    Returns ``{applied: [{path, value}], errors: [{path, error}]}``.
    """
    h = params.get("handle")
    raw_values = params.get("values")
    if not h:
        raise ValueError("parameter 'handle' is required")
    if not isinstance(raw_values, list):
        raise ValueError("parameter 'values' must be a list of {path, value} entries")
    obj = _resolve_handle(h)
    if obj is None:
        raise ValueError(f"handle not resolved: {h}")

    doc = documents.GetActiveDocument()
    if doc is None:
        raise RuntimeError("no active document")

    applied: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    doc.StartUndo()
    try:
        with contextlib.suppress(Exception):
            doc.AddUndo(c4d.UNDOTYPE_CHANGE, obj)
        for entry in raw_values:
            if not isinstance(entry, dict) or "path" not in entry or "value" not in entry:
                errors.append({"entry": entry, "error": "must be {path, value}"})
                continue
            path = entry["path"]
            value = entry["value"]
            try:
                did, normalized = _path_to_desc_id(obj, path)
            except Exception as exc:
                errors.append({"path": path, "error": f"{type(exc).__name__}: {exc}"})
                continue
            key = did if len(normalized) > 1 else int(normalized[0])
            try:
                obj[key] = value
            except Exception as exc_initial:
                # Same list→Vector coercion as _apply_params.
                coerced = _coerce_vector(value)
                if coerced is not value:
                    try:
                        obj[key] = coerced
                    except Exception as exc_retry:
                        msg = f"{type(exc_retry).__name__}: {exc_retry}"
                        errors.append({"path": normalized, "error": msg})
                        continue
                else:
                    msg = f"{type(exc_initial).__name__}: {exc_initial}"
                    errors.append({"path": normalized, "error": msg})
                    continue
            applied.append({"path": normalized, "value": _json_safe(obj[key])})
    finally:
        doc.EndUndo()
    c4d.EventAdd()
    return {"applied": applied, "errors": errors}


def handle_get_container(params: dict[str, Any]) -> dict[str, Any]:
    h = params.get("handle")
    if not h:
        raise ValueError("parameter 'handle' is required")
    obj = _resolve_handle(h)
    if obj is None:
        raise ValueError(f"handle not resolved: {h}")
    id_from = params.get("id_from")
    id_to = params.get("id_to")
    return {"container": _dump_container(obj, id_from, id_to)}


# Image file extensions used to surface path-like strings hiding inside shader
# BaseContainers. Redshift / Fusion / Colorizer etc. stash texture paths there
# rather than exposing a c4d.Xbitmap child node.
_SHADER_IMG_EXTS = (
    ".jpg",
    ".jpeg",
    ".png",
    ".exr",
    ".tif",
    ".tiff",
    ".hdr",
    ".tga",
    ".bmp",
    ".psd",
    ".dpx",
    ".iff",
)


def _dump_shader_tree(s, depth: int, max_depth: int) -> dict[str, Any] | None:
    if s is None:
        return None
    info: dict[str, Any] = {
        "type_id": s.GetType(),
        "type_name": s.GetTypeName(),
        "name": s.GetName(),
    }
    if s.GetType() == c4d.Xbitmap:
        with contextlib.suppress(Exception):
            info["file"] = s[c4d.BITMAPSHADER_FILENAME]

    try:
        bc = s.GetDataInstance()
    except Exception:
        bc = None
    if bc is not None:
        file_candidates: list[dict[str, Any]] = []
        linked_shaders: list[dict[str, Any]] = []
        for k, v in bc:
            if isinstance(v, str) and v:
                low = v.lower()
                if any(ext in low for ext in _SHADER_IMG_EXTS):
                    file_candidates.append({"pid": k, "path": v})
            elif isinstance(v, c4d.BaseShader) and depth < max_depth:
                linked_shaders.append(
                    {"pid": k, "shader": _dump_shader_tree(v, depth + 1, max_depth)}
                )
        if file_candidates:
            info["file_candidates"] = file_candidates
        if linked_shaders:
            info["linked_shaders"] = linked_shaders

    if depth < max_depth:
        kids: list[dict[str, Any]] = []
        ch = s.GetDown()
        while ch is not None:
            dumped = _dump_shader_tree(ch, depth + 1, max_depth)
            if dumped is not None:
                kids.append(dumped)
            ch = ch.GetNext()
        if kids:
            info["children"] = kids
    return info


def handle_dump_shader(params: dict[str, Any]) -> dict[str, Any]:
    """Recursively dump a shader tree into JSON.

    Captures ``type_id`` / ``type_name`` / ``name`` per node; promotes
    ``c4d.Xbitmap`` paths to a ``file`` field; heuristically surfaces
    image-like strings stored in other shader BaseContainers as
    ``file_candidates``; and expands shader links stored inside the container
    as ``linked_shaders`` — the shape used by Redshift / Fusion / Colorizer
    whose internals don't appear via ``GetDown``.
    """
    h = params.get("handle")
    if not h:
        raise ValueError("parameter 'handle' is required")
    s = _resolve_handle(h)
    if s is None:
        raise ValueError(f"handle not resolved: {h}")
    max_depth = int(params.get("max_depth", 5))
    if max_depth < 0:
        raise ValueError("max_depth must be >= 0")
    return {"shader": _dump_shader_tree(s, 0, max_depth)}


def handle_create_entity(params: dict[str, Any]) -> dict[str, Any]:
    """Create an object / tag / material / shader and link it to its parent.

    params:
      kind:     "object" | "tag" | "material" | "shader"
      type_id:  plugin id of the thing to create — int, alias ("cube"/"null"/…
                for objects) or numeric string
      name:     optional
      parent:   handle of parent (required for tag/shader; optional for object)
      params:   {param_id: value} to set after allocation
      position: [x, y, z] for objects (relative to parent)
      slots:    list of container slot IDs to assign the created shader to
                (e.g. [3740, 3741] for Octane AOV dual-slot)
    """
    kind = params.get("kind")
    type_raw = params.get("type_id")
    name = params.get("name")
    parent_h = params.get("parent")
    values = params.get("params") or {}
    position = params.get("position")
    slots = params.get("slots") or []

    if kind not in ("object", "tag", "material", "shader", "video_post"):
        raise ValueError(f"kind must be object/tag/material/shader/video_post, got {kind!r}")
    if type_raw is None:
        raise ValueError("type_id required")
    type_id = resolve_type_id(type_raw)

    doc = documents.GetActiveDocument()
    if doc is None:
        raise RuntimeError("no active document")

    doc.StartUndo()
    try:
        if kind == "object":
            o = c4d.BaseObject(type_id)
            if o is None:
                raise RuntimeError(f"BaseObject({type_id}) returned None")
            if name:
                o.SetName(name)
            if position and len(position) == 3:
                o.SetRelPos(c4d.Vector(float(position[0]), float(position[1]), float(position[2])))
            _apply_params(o, values)
            if parent_h:
                p = _resolve_handle(parent_h)
                if p is None:
                    raise ValueError(f"parent not resolved: {parent_h}")
                o.InsertUnder(p)
            else:
                doc.InsertObject(o)
            doc.AddUndo(c4d.UNDOTYPE_NEW, o)
            # Prefer a path-based handle for created objects — it survives name
            # collisions that can appear later when the scene grows.
            handle = {"kind": "object", "path": _object_path(o), "name": o.GetName()}

        elif kind == "tag":
            if not parent_h:
                raise ValueError("parent handle (owner object) required for tag")
            owner = _resolve_handle(parent_h)
            if owner is None:
                raise ValueError(f"owner not resolved: {parent_h}")
            tag = c4d.BaseTag(type_id)
            if tag is None:
                raise RuntimeError(f"BaseTag({type_id}) returned None")
            if name:
                tag.SetName(name)
            _apply_params(tag, values)
            owner.InsertTag(tag)
            doc.AddUndo(c4d.UNDOTYPE_NEW, tag)
            # Include tag_name so duplicate type_ids on the same object remain addressable.
            handle = {
                "kind": "tag",
                "object_path": _object_path(owner),
                "object": owner.GetName(),
                "type_id": tag.GetType(),
                "tag_name": tag.GetName(),
            }

        elif kind == "material":
            mat = c4d.BaseMaterial(type_id)
            if mat is None:
                raise RuntimeError(f"BaseMaterial({type_id}) returned None")
            if name:
                mat.SetName(name)
            _apply_params(mat, values)
            doc.InsertMaterial(mat)
            doc.AddUndo(c4d.UNDOTYPE_NEW, mat)
            handle = {"kind": "material", "name": mat.GetName()}

        elif kind == "video_post":
            if not parent_h:
                raise ValueError("parent handle (render_data) required for video_post")
            if not isinstance(parent_h, dict) or parent_h.get("kind") != "render_data":
                raise ValueError("video_post parent must be a render_data handle")
            rd = _resolve_handle(parent_h)
            if rd is None:
                raise ValueError(f"render_data not resolved: {parent_h}")
            vp = documents.BaseVideoPost(type_id)
            if vp is None:
                raise RuntimeError(f"BaseVideoPost({type_id}) returned None")
            if name:
                vp.SetName(name)
            _apply_params(vp, values)
            rd.InsertVideoPost(vp)
            doc.AddUndo(c4d.UNDOTYPE_NEW, vp)
            handle = {
                "kind": "video_post",
                "render_data": rd.GetName(),
                "type_id": vp.GetType(),
            }

        else:  # shader
            if not parent_h:
                raise ValueError("parent handle required for shader")
            owner = _resolve_handle(parent_h)
            if owner is None:
                raise ValueError(f"owner not resolved: {parent_h}")
            sh = c4d.BaseShader(type_id)
            if sh is None:
                raise RuntimeError(f"BaseShader({type_id}) returned None")
            if name:
                sh.SetName(name)
            _apply_params(sh, values)
            owner.InsertShader(sh)
            if slots:
                bc = owner.GetDataInstance()
                for slot in slots:
                    bc[int(slot)] = sh
            # compute index in shader chain
            idx = 0
            s = owner.GetFirstShader()
            while s is not None:
                if s == sh:
                    break
                idx += 1
                s = s.GetNext()
            handle = {"kind": "shader", "owner": parent_h, "index": idx, "name": sh.GetName()}

    finally:
        doc.EndUndo()
    c4d.EventAdd()

    resolved = _resolve_handle(handle)
    return {"handle": handle, "summary": _summary(resolved) if resolved else None}


# Keyframe type map: DTYPE -> CTrack component / coercion
_KEYFRAME_VECTOR_COMPONENTS = {"x": 0, "y": 1, "z": 2}


def _pick_keyframe_dtype(declared: int | None, component: str | None) -> int:
    """Pick the DescID dtype for a keyframe based on description and component."""
    if component is not None:
        return c4d.DTYPE_VECTOR
    if declared is None:
        return c4d.DTYPE_REAL
    if declared in (c4d.DTYPE_LONG, c4d.DTYPE_BOOL, c4d.DTYPE_REAL, c4d.DTYPE_VECTOR):
        return declared
    return c4d.DTYPE_REAL


def handle_set_keyframe(params: dict[str, Any]) -> dict[str, Any]:
    """Add or update a keyframe on the resolved entity's parameter.

    Supports scalar (REAL/LONG/BOOL) and vector (x/y/z) parameters. The dtype
    is inferred from the object's description; pass ``dtype`` explicitly to
    override (e.g. ``"long"`` for enum-backed params).

    params:
      handle:    target
      param_id:  top-level description id (int)
      component: "x" | "y" | "z" | null   (sub-component for vector params)
      frame:     frame number (int)
      value:     new value (number or bool)
      fps:       optional override for time base (default: doc fps)
      interp:    "linear" | "spline" | "step"  (default "spline")
      dtype:     optional override: "real" | "long" | "bool" | "vector"
    """
    h = params.get("handle")
    pid = params.get("param_id")
    comp = params.get("component")
    frame = params.get("frame")
    value = params.get("value")
    fps = params.get("fps")
    interp_name = params.get("interp", "spline")
    dtype_name = params.get("dtype")

    if not h:
        raise ValueError("handle required")
    if pid is None:
        raise ValueError("param_id required")
    if frame is None:
        raise ValueError("frame required")
    if value is None:
        raise ValueError("value required")

    obj = _resolve_handle(h)
    if obj is None:
        raise ValueError(f"handle not resolved: {h}")

    doc = documents.GetActiveDocument()
    if fps is None:
        fps = doc.GetFps()

    # Resolve the parameter dtype from description unless overridden.
    dtype_overrides = {
        "real": c4d.DTYPE_REAL,
        "long": c4d.DTYPE_LONG,
        "bool": c4d.DTYPE_BOOL,
        "vector": c4d.DTYPE_VECTOR,
    }
    if dtype_name is not None:
        if dtype_name not in dtype_overrides:
            raise ValueError(f"dtype must be one of {sorted(dtype_overrides)}, got {dtype_name!r}")
        declared = dtype_overrides[dtype_name]
    else:
        declared = _param_dtype(obj, int(pid))

    effective_dtype = _pick_keyframe_dtype(declared, comp)

    if comp is None:
        did = c4d.DescID(c4d.DescLevel(int(pid), effective_dtype, 0))
    else:
        if comp not in _KEYFRAME_VECTOR_COMPONENTS:
            raise ValueError(f"component must be x/y/z or null, got {comp!r}")
        cm = {"x": c4d.VECTOR_X, "y": c4d.VECTOR_Y, "z": c4d.VECTOR_Z}
        did = c4d.DescID(
            c4d.DescLevel(int(pid), c4d.DTYPE_VECTOR, 0),
            c4d.DescLevel(cm[comp], c4d.DTYPE_REAL, 0),
        )

    im = {
        "linear": c4d.CINTERPOLATION_LINEAR,
        "spline": c4d.CINTERPOLATION_SPLINE,
        "step": c4d.CINTERPOLATION_STEP,
    }
    if interp_name not in im:
        raise ValueError(f"interp must be linear/spline/step, got {interp_name!r}")

    # Coerce the value to the underlying curve's expected scalar type.
    if effective_dtype == c4d.DTYPE_BOOL:
        coerced_value = 1.0 if bool(value) else 0.0
    elif effective_dtype == c4d.DTYPE_LONG:
        coerced_value = float(int(value))
    else:
        coerced_value = float(value)

    doc.StartUndo()
    try:
        track = obj.FindCTrack(did)
        if track is None:
            track = c4d.CTrack(obj, did)
            obj.InsertTrackSorted(track)
        curve = track.GetCurve()
        kd = curve.AddKey(c4d.BaseTime(int(frame), int(fps)))
        key = kd["key"] if isinstance(kd, dict) else kd
        key.SetValue(curve, coerced_value)
        key.SetInterpolation(curve, im[interp_name])
    finally:
        doc.EndUndo()
    c4d.EventAdd()
    return {
        "handle": h,
        "frame": int(frame),
        "value": coerced_value,
        "interp": interp_name,
        "dtype": {
            c4d.DTYPE_REAL: "real",
            c4d.DTYPE_LONG: "long",
            c4d.DTYPE_BOOL: "bool",
            c4d.DTYPE_VECTOR: "vector",
        }.get(effective_dtype, str(effective_dtype)),
    }


def handle_remove_entity(params: dict[str, Any]) -> dict[str, Any]:
    h = params.get("handle")
    if not h:
        raise ValueError("handle required")
    obj = _resolve_handle(h)
    if obj is None:
        return {"removed": False, "reason": "not found"}
    doc = documents.GetActiveDocument()
    doc.StartUndo()
    try:
        doc.AddUndo(c4d.UNDOTYPE_DELETE, obj)
        obj.Remove()
    finally:
        doc.EndUndo()
    c4d.EventAdd()
    return {"removed": True}
