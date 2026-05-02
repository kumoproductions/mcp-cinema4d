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


def _collect_polygon_selection_indices(obj: c4d.PolygonObject, selection_name: str) -> set[int]:
    """Return the polygon-index set held by the named SelectionTag on ``obj``.

    Returns an empty set when no matching selection tag is found.

    Uses ``BaseSelect.GetAll(maxElements)`` which returns a flat list of
    1/0 ints in one C call — much faster than ``IsSelected`` per index for
    50k+ poly meshes. The 2026 SDK removed ``GetSegment`` so the previous
    segment-based fast path is unavailable.
    """
    target_id = getattr(c4d, "Tpolygonselection", 5673)
    t = obj.GetFirstTag()
    while t is not None:
        if t.GetType() == target_id and t.GetName() == selection_name:
            sel = t.GetBaseSelect()
            poly_count = obj.GetPolygonCount()
            if poly_count == 0:
                return set()
            flags = sel.GetAll(poly_count)
            return {i for i, on in enumerate(flags) if on}
        t = t.GetNext()
    return set()


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


def _iter_object_tags(obj: c4d.BaseObject):
    t = obj.GetFirstTag()
    while t is not None:
        yield t
        t = t.GetNext()


def _iter_ancestors(obj: c4d.BaseObject):
    """Yield ``obj`` then each ancestor up to the document root."""
    cur: c4d.BaseObject | None = obj
    while cur is not None:
        yield cur
        cur = cur.GetUp()


def _resolve_texture_tag(tag: c4d.BaseTag) -> tuple[str | None, set[int] | None]:
    """Return ``(material_name, restriction_set)`` for a Texture tag.

    ``material_name`` is None when no material is linked.
    ``restriction_set`` is None for unrestricted tags, an empty set when
    the named selection cannot be resolved, otherwise the polygon-index
    set the restriction allows. Restriction lookups always run against
    the tag's owning object — matching C4D's render-time behaviour.
    """
    try:
        mat = tag[c4d.TEXTURETAG_MATERIAL]
    except Exception:
        mat = None
    mat_name = mat.GetName() if isinstance(mat, c4d.BaseMaterial) else None

    try:
        restriction = tag[c4d.TEXTURETAG_RESTRICTION]
    except Exception:
        restriction = None
    if not (isinstance(restriction, str) and restriction):
        return mat_name, None

    owner = tag.GetObject()
    if not isinstance(owner, c4d.PolygonObject):
        return mat_name, set()
    return mat_name, _collect_polygon_selection_indices(owner, restriction)


def compute_effective_materials_per_polygon(obj: c4d.PolygonObject) -> dict[str, Any]:
    """Resolve, per polygon, which material C4D will shade with.

    Walks the object's Texture tag chain plus its ancestors, honoring
    ``TEXTURETAG_RESTRICTION`` (the polygon-selection-tag name a texture
    tag is restricted to). Returns
    ``{per_polygon, by_material, no_material_count, tags_considered}``.

    Resolution order matches C4D's documented behaviour:

    - The object's own Texture tags win over parent Texture tags.
    - Within one object's tag list, the LAST applicable Texture tag wins
      (top-to-bottom: later tags override earlier ones).
    - "Applicable" means either the tag has no restriction, OR the
      polygon's index is in the named polygon-selection tag's BaseSelect.

    Implementation: build a priority-ordered chain by reversing each
    ancestor's tag list (so "last in list" → first in chain) and
    concatenating, then for each polygon take the first applicable entry.
    Exposed via ``get_mesh(include=["effective_materials"])``.
    """
    poly_count = obj.GetPolygonCount()

    # Priority-ordered chain: closest object first, and within one object
    # later tags before earlier ones (since later overrides earlier).
    # Skip tags with no linked material so an empty texture slot doesn't
    # shadow a populated tag further down the chain.
    chain: list[tuple[str, set[int] | None]] = []
    for ancestor in _iter_ancestors(obj):
        level = [t for t in _iter_object_tags(ancestor) if t.GetType() == c4d.Ttexture]
        for tag in reversed(level):
            mat_name, restriction = _resolve_texture_tag(tag)
            if mat_name is not None:
                chain.append((mat_name, restriction))

    per_polygon: list[str | None] = [None] * poly_count
    counts: dict[str, int] = {}
    none_count = 0
    for i in range(poly_count):
        for mat_name, restriction in chain:
            if restriction is None or i in restriction:
                per_polygon[i] = mat_name
                counts[mat_name] = counts.get(mat_name, 0) + 1
                break
        else:
            none_count += 1

    return {
        "per_polygon": per_polygon,
        "by_material": counts,
        "no_material_count": none_count,
        "tags_considered": len(chain),
    }
