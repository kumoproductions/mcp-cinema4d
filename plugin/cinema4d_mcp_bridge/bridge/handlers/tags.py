"""Tag helpers. Right now: ``assign_material``.

Common tag workflows can be built with create_entity + set_params, but linking
a material to an object is the single most-frequent case — collapsing it into
one call spares the LLM from juggling Texture tag param ids (TEXTURETAG_*).
"""

from __future__ import annotations

import contextlib
from typing import Any

import c4d
from c4d import documents

from ._helpers import _find_tag, _object_path, _resolve_handle

# Alias → TEXTURETAG_PROJECTION_* constant. Resolved via getattr so the bridge
# stays portable across C4D versions that add or drop projections.
_PROJECTION_ALIASES: dict[str, str] = {
    "spherical": "TEXTURETAG_PROJECTION_SPHERICAL",
    "cylindrical": "TEXTURETAG_PROJECTION_CYLINDRICAL",
    "flat": "TEXTURETAG_PROJECTION_FLAT",
    "cubic": "TEXTURETAG_PROJECTION_CUBIC",
    "frontal": "TEXTURETAG_PROJECTION_FRONTAL",
    "spatial": "TEXTURETAG_PROJECTION_SPATIAL",
    "uvw": "TEXTURETAG_PROJECTION_UVW",
    "shrinkwrap": "TEXTURETAG_PROJECTION_SHRINKWRAP",
    "camera": "TEXTURETAG_PROJECTION_CAMERAMAP",
}


def _resolve_projection(alias: str) -> tuple[str, int]:
    key = alias.strip().lower()
    const_name = _PROJECTION_ALIASES.get(key)
    if const_name is None:
        raise ValueError(f"unknown projection {alias!r}; accepted: {sorted(_PROJECTION_ALIASES)}")
    value = getattr(c4d, const_name, None)
    if value is None:
        raise RuntimeError(
            f"C4D build does not expose c4d.{const_name} — projection {alias!r} unsupported"
        )
    return key, int(value)


def handle_assign_material(params: dict[str, Any]) -> dict[str, Any]:
    """Link a material to an object by creating (or updating) a Texture tag.

    params:
      object:     object handle (required)
      material:   material handle (required)
      projection: alias (see _PROJECTION_ALIASES) — default preserves existing
      uv_offset:  [u,v] — sets TEXTURETAG_OFFSETX/Y when provided
      uv_tiles:   [u,v] — sets TEXTURETAG_TILESX/Y when provided
      restrict_to_selection: string — polygon selection tag name this texture tag applies to
      update_if_exists: bool (default False). When True and a Texture tag
                  already exists, its material link is updated in place
                  instead of appending a second tag.
      name:       optional display name for the created/updated tag
    """
    obj_h = params.get("object")
    mat_h = params.get("material")
    if not obj_h:
        raise ValueError("object handle required")
    if not mat_h:
        raise ValueError("material handle required")

    obj = _resolve_handle(obj_h)
    if obj is None or not isinstance(obj, c4d.BaseObject):
        raise ValueError(f"object handle did not resolve: {obj_h}")
    mat = _resolve_handle(mat_h)
    if mat is None or not isinstance(mat, c4d.BaseMaterial):
        raise ValueError(f"material handle did not resolve: {mat_h}")

    update_if_exists = bool(params.get("update_if_exists", False))
    existing_tag = _find_tag(obj, type_id=c4d.Ttexture) if update_if_exists else None

    doc = documents.GetActiveDocument()
    if doc is None:
        raise RuntimeError("no active document")

    doc.StartUndo()
    created = False
    try:
        if existing_tag is not None:
            tag = existing_tag
            doc.AddUndo(c4d.UNDOTYPE_CHANGE, tag)
        else:
            tag = c4d.BaseTag(c4d.Ttexture)
            if tag is None:
                raise RuntimeError("BaseTag(Ttexture) returned None")
            obj.InsertTag(tag)
            doc.AddUndo(c4d.UNDOTYPE_NEW, tag)
            created = True

        name = params.get("name")
        if isinstance(name, str) and name:
            tag.SetName(name)

        tag[c4d.TEXTURETAG_MATERIAL] = mat

        projection_out: dict[str, Any] | None = None
        if "projection" in params and params["projection"] is not None:
            alias, value = _resolve_projection(str(params["projection"]))
            tag[c4d.TEXTURETAG_PROJECTION] = value
            projection_out = {"alias": alias, "value": value}

        uv_offset = params.get("uv_offset")
        if isinstance(uv_offset, (list, tuple)) and len(uv_offset) == 2:
            tag[c4d.TEXTURETAG_OFFSETX] = float(uv_offset[0])
            tag[c4d.TEXTURETAG_OFFSETY] = float(uv_offset[1])

        uv_tiles = params.get("uv_tiles")
        if isinstance(uv_tiles, (list, tuple)) and len(uv_tiles) == 2:
            tag[c4d.TEXTURETAG_TILESX] = float(uv_tiles[0])
            tag[c4d.TEXTURETAG_TILESY] = float(uv_tiles[1])

        restrict = params.get("restrict_to_selection")
        if isinstance(restrict, str) and restrict:
            # TEXTURETAG_RESTRICTION stores the *name* of a polygon selection tag.
            with contextlib.suppress(Exception):
                tag[c4d.TEXTURETAG_RESTRICTION] = restrict
    finally:
        doc.EndUndo()
    c4d.EventAdd()

    return {
        "tag": {
            "kind": "tag",
            "object_path": _object_path(obj),
            "object": obj.GetName(),
            "type_id": tag.GetType(),
            "tag_name": tag.GetName(),
        },
        "material": mat.GetName(),
        "projection": projection_out,
        "created": created,
    }
