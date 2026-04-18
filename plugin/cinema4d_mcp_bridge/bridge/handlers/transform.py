"""Transform handler: ``set_transform``.

Unified setter for pos / rot / scale / matrix. Mirrors the SDK's
``obj.SetRelPos/Rot/Scale`` or ``obj.SetMl/SetMg`` — callers pick ``space``
("local" vs "global") and supply either decomposed parts or a full 4x3
matrix. Matrix + any of pos/rot/scale in the same call is rejected (they
would silently overwrite each other).
"""

from __future__ import annotations

from typing import Any

import c4d
from c4d import documents
from c4d import utils as c4d_utils

from ._helpers import _object_path, _resolve_handle


def _matrix_from_rows(rows: list[list[float]]) -> c4d.Matrix:
    if len(rows) != 4:
        raise ValueError(f"matrix must have 4 rows (off, v1, v2, v3), got {len(rows)}")
    for i, row in enumerate(rows):
        if len(row) != 3:
            raise ValueError(f"matrix row {i} must have 3 values, got {len(row)}")
    off = c4d.Vector(float(rows[0][0]), float(rows[0][1]), float(rows[0][2]))
    v1 = c4d.Vector(float(rows[1][0]), float(rows[1][1]), float(rows[1][2]))
    v2 = c4d.Vector(float(rows[2][0]), float(rows[2][1]), float(rows[2][2]))
    v3 = c4d.Vector(float(rows[3][0]), float(rows[3][1]), float(rows[3][2]))
    return c4d.Matrix(off, v1, v2, v3)


def _matrix_rows(m: c4d.Matrix) -> list[list[float]]:
    return [
        [m.off.x, m.off.y, m.off.z],
        [m.v1.x, m.v1.y, m.v1.z],
        [m.v2.x, m.v2.y, m.v2.z],
        [m.v3.x, m.v3.y, m.v3.z],
    ]


def handle_set_transform(params: dict[str, Any]) -> dict[str, Any]:
    """Set an object's transform.

    params:
      handle: object handle
      pos:    [x, y, z]                (optional)
      rot:    [h, p, b]  radians       (optional)
      scale:  [sx, sy, sz]             (optional)
      matrix: [[off], [v1], [v2], [v3]]  4x3 list (exclusive with pos/rot/scale)
      space:  "local" (default) | "global"
    """
    h = params.get("handle")
    if not h:
        raise ValueError("handle required")
    obj = _resolve_handle(h)
    if obj is None or not isinstance(obj, c4d.BaseObject):
        raise ValueError(f"handle did not resolve to a BaseObject: {h}")

    pos = params.get("pos")
    rot = params.get("rot")
    scale = params.get("scale")
    matrix = params.get("matrix")
    space = str(params.get("space", "local")).lower()
    if space not in ("local", "global"):
        raise ValueError("space must be 'local' or 'global'")

    if matrix is not None and any(x is not None for x in (pos, rot, scale)):
        raise ValueError("matrix is exclusive with pos / rot / scale in the same call")

    doc = documents.GetActiveDocument()
    if doc is None:
        raise RuntimeError("no active document")

    doc.StartUndo()
    try:
        doc.AddUndo(c4d.UNDOTYPE_HIERARCHY_PSR, obj)

        if matrix is not None:
            m = _matrix_from_rows(matrix)
            if space == "global":
                obj.SetMg(m)
            else:
                obj.SetMl(m)
        else:
            # For component writes we build a fresh matrix out of the requested
            # parts, using the current transform for any component not provided.
            current = obj.GetMg() if space == "global" else obj.GetMl()
            cur_pos = current.off
            cur_rot = c4d_utils.MatrixToHPB(current, c4d.ROTATIONORDER_HPB)
            # Derive scale magnitudes from basis-vector lengths — matches how
            # MatrixToHPB decomposes.
            cur_scale = c4d.Vector(
                current.v1.GetLength(),
                current.v2.GetLength(),
                current.v3.GetLength(),
            )

            new_pos = cur_pos
            if pos is not None:
                if not isinstance(pos, (list, tuple)) or len(pos) != 3:
                    raise ValueError("pos must be [x, y, z]")
                new_pos = c4d.Vector(float(pos[0]), float(pos[1]), float(pos[2]))

            new_rot = cur_rot
            if rot is not None:
                if not isinstance(rot, (list, tuple)) or len(rot) != 3:
                    raise ValueError("rot must be [h, p, b] radians")
                new_rot = c4d.Vector(float(rot[0]), float(rot[1]), float(rot[2]))

            new_scale = cur_scale
            if scale is not None:
                if not isinstance(scale, (list, tuple)) or len(scale) != 3:
                    raise ValueError("scale must be [sx, sy, sz]")
                new_scale = c4d.Vector(float(scale[0]), float(scale[1]), float(scale[2]))

            m = c4d_utils.HPBToMatrix(new_rot, c4d.ROTATIONORDER_HPB)
            m.off = new_pos
            m.v1 = m.v1 * new_scale.x
            m.v2 = m.v2 * new_scale.y
            m.v3 = m.v3 * new_scale.z
            if space == "global":
                obj.SetMg(m)
            else:
                obj.SetMl(m)
    finally:
        doc.EndUndo()
    c4d.EventAdd()

    # Echo back what ended up on the object so callers can verify.
    final = obj.GetMg() if space == "global" else obj.GetMl()
    final_rot = c4d_utils.MatrixToHPB(final, c4d.ROTATIONORDER_HPB)
    final_scale = c4d.Vector(final.v1.GetLength(), final.v2.GetLength(), final.v3.GetLength())
    return {
        "handle": {"kind": "object", "path": _object_path(obj), "name": obj.GetName()},
        "space": space,
        "applied": {
            "pos": [final.off.x, final.off.y, final.off.z],
            "rot": [final_rot.x, final_rot.y, final_rot.z],
            "scale": [final_scale.x, final_scale.y, final_scale.z],
            "matrix": _matrix_rows(final),
        },
    }
