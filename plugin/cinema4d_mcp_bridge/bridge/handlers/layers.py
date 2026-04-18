"""Layer handlers: list, create, assign-to-layer, set-flags, get-object-layer.

LayerObjects live under the document's layer root (``doc.GetLayerObjectRoot``)
and carry both metadata (name, color) and a flag dict controlling solo /
view / render / manager / locked / animation / generators / deformers /
expressions visibility. Flags are exposed here as named booleans — the
bridge translates to / from the ``LayerData`` dict C4D expects.
"""

from __future__ import annotations

from typing import Any

import c4d
from c4d import documents

from ._helpers import _resolve_handle

# Names map directly to LayerData dict keys so callers don't juggle
# LAYERFLAGS_* constants. Every flag defaults to whatever the layer currently
# holds; we only touch the ones in params.
_FLAG_KEYS = (
    "solo",
    "view",
    "render",
    "manager",
    "locked",
    "generators",
    "deformers",
    "expressions",
    "animation",
    "xref",
)


def _walk_layers(doc: c4d.documents.BaseDocument) -> list[c4d.documents.LayerObject]:
    """Collect every LayerObject in document order."""
    out: list[c4d.documents.LayerObject] = []
    root = doc.GetLayerObjectRoot()
    if root is None:
        return out

    def walk(n):
        while n is not None:
            if isinstance(n, c4d.documents.LayerObject):
                out.append(n)
            d = n.GetDown()
            if d is not None:
                walk(d)
            n = n.GetNext()

    walk(root.GetDown())
    return out


def _find_layer(doc: c4d.documents.BaseDocument, name: str) -> c4d.documents.LayerObject | None:
    for layer in _walk_layers(doc):
        if layer.GetName() == name:
            return layer
    return None


def _layer_summary(layer: c4d.documents.LayerObject, doc) -> dict[str, Any]:
    data = layer.GetLayerData(doc) or {}
    color = data.get("color")
    summary: dict[str, Any] = {
        "name": layer.GetName(),
        "flags": {k: bool(data.get(k, False)) for k in _FLAG_KEYS},
    }
    if isinstance(color, c4d.Vector):
        summary["color"] = [color.x, color.y, color.z]
    return summary


def handle_list_layers(_params: dict[str, Any]) -> dict[str, Any]:
    doc = documents.GetActiveDocument()
    if doc is None:
        return {"layers": []}
    layers = [_layer_summary(layer, doc) for layer in _walk_layers(doc)]
    return {"layers": layers, "count": len(layers)}


def handle_create_layer(params: dict[str, Any]) -> dict[str, Any]:
    """Create (or update-if-exists) a LayerObject.

    params:
      name:           string (required)
      color:          [r,g,b] in 0..1 range
      flags:          optional {solo?, view?, render?, manager?, locked?, ...}
      update_if_exists: bool
    """
    name = params.get("name")
    if not isinstance(name, str) or not name:
        raise ValueError("name required")

    doc = documents.GetActiveDocument()
    if doc is None:
        raise RuntimeError("no active document")

    update_if_exists = bool(params.get("update_if_exists", False))
    existing = _find_layer(doc, name) if update_if_exists else None
    created = existing is None

    doc.StartUndo()
    try:
        if existing is None:
            layer = c4d.documents.LayerObject()
            if layer is None:
                raise RuntimeError("LayerObject() returned None")
            layer.SetName(name)
            root = doc.GetLayerObjectRoot()
            layer.InsertUnder(root)
            doc.AddUndo(c4d.UNDOTYPE_NEW, layer)
        else:
            layer = existing
            doc.AddUndo(c4d.UNDOTYPE_CHANGE, layer)

        data = layer.GetLayerData(doc) or {}
        color = params.get("color")
        if isinstance(color, (list, tuple)) and len(color) == 3:
            data["color"] = c4d.Vector(float(color[0]), float(color[1]), float(color[2]))
        flags = params.get("flags") or {}
        for k in _FLAG_KEYS:
            if k in flags:
                data[k] = bool(flags[k])
        layer.SetLayerData(doc, data)
    finally:
        doc.EndUndo()
    c4d.EventAdd()

    return {
        "handle": {"kind": "layer", "name": layer.GetName()},
        "created": created,
        "summary": _layer_summary(layer, doc),
    }


def handle_assign_to_layer(params: dict[str, Any]) -> dict[str, Any]:
    """Assign an object (or tag/material) to a layer, or clear when layer=null.

    params:
      target: handle of object / tag / material
      layer:  layer name, or null to clear
    """
    target_h = params.get("target")
    if not target_h:
        raise ValueError("target handle required")
    obj = _resolve_handle(target_h)
    if obj is None:
        raise ValueError(f"target not resolved: {target_h}")
    if not hasattr(obj, "SetLayerObject"):
        raise ValueError(f"target {target_h!r} does not support layer assignment")

    layer_name = params.get("layer")
    doc = documents.GetActiveDocument()
    if doc is None:
        raise RuntimeError("no active document")

    if layer_name is None:
        obj.SetLayerObject(None)
        c4d.EventAdd()
        return {"assigned": None}

    if not isinstance(layer_name, str):
        raise ValueError("layer must be a string or null")
    layer = _find_layer(doc, layer_name)
    if layer is None:
        raise ValueError(f"layer not found: {layer_name}")
    obj.SetLayerObject(layer)
    c4d.EventAdd()
    return {"assigned": {"name": layer.GetName()}}


def handle_get_object_layer(params: dict[str, Any]) -> dict[str, Any]:
    """Return the layer currently assigned to the target, or null."""
    target_h = params.get("target")
    if not target_h:
        raise ValueError("target handle required")
    obj = _resolve_handle(target_h)
    if obj is None:
        raise ValueError(f"target not resolved: {target_h}")
    if not hasattr(obj, "GetLayerObject"):
        return {"layer": None}
    doc = documents.GetActiveDocument()
    layer = obj.GetLayerObject(doc) if doc is not None else None
    if layer is None:
        return {"layer": None}
    return {"layer": _layer_summary(layer, doc)}


def handle_set_layer_flags(params: dict[str, Any]) -> dict[str, Any]:
    """Toggle visibility / render / lock flags on a layer.

    params:
      layer:   layer name (required)
      <flag>:  bool for any of solo/view/render/manager/locked/generators/
               deformers/expressions/animation/xref
      color:   optional [r,g,b] update
    """
    name = params.get("layer")
    if not isinstance(name, str) or not name:
        raise ValueError("layer (name) required")
    doc = documents.GetActiveDocument()
    if doc is None:
        raise RuntimeError("no active document")
    layer = _find_layer(doc, name)
    if layer is None:
        raise ValueError(f"layer not found: {name}")

    doc.StartUndo()
    try:
        doc.AddUndo(c4d.UNDOTYPE_CHANGE, layer)
        data = layer.GetLayerData(doc) or {}
        for k in _FLAG_KEYS:
            if k in params and params[k] is not None:
                data[k] = bool(params[k])
        color = params.get("color")
        if isinstance(color, (list, tuple)) and len(color) == 3:
            data["color"] = c4d.Vector(float(color[0]), float(color[1]), float(color[2]))
        layer.SetLayerData(doc, data)
    finally:
        doc.EndUndo()
    c4d.EventAdd()
    return _layer_summary(layer, doc)
