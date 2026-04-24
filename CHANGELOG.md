# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `plugin_options` handle kind — resolves a scene-saver / scene-loader /
  bitmap-saver / etc. plugin's private settings `BaseList2D` (the object
  the Attribute Manager export dialog writes into, e.g. Alembic's
  `ABCEXPORT_FRAME_START`). Accepts either a format alias
  (`"abc"`/`"fbx"`/`"obj"`/`"usd"`/`"gltf"`/…) or a raw plugin id, with
  `plugin_type` defaulting to `"scene_saver"`. Plugs straight into the
  existing `describe` / `get_params` / `set_params` flow, so configuring
  exporter options before `save_document` no longer needs `exec_python`
  and direct `MSG_RETRIEVEPRIVATEDATA` calls.

### Fixed

- `save_document` with `copy:true` no longer flips
  `SAVEDOCUMENTFLAGS_SAVEAS`, which had the side effect of popping the
  modal Save-As dialog in C4D 2026 and freezing the bridge until the
  user dismissed it. "Save as copy" is implemented purely by not mutating
  the doc's internal path/name after the write.
- `set_params` on a `plugin_options` handle no longer wraps the BaseList2D
  write in `doc.StartUndo` / `AddUndo` / `EndUndo`. Plugin-private
  settings live outside any document and calling AddUndo on them was
  observed to destabilise C4D 2026.

## [0.1.0] - 2026-04-19

First public release. 55 tools across 16 groups — see
[docs/TOOLS.md](./docs/TOOLS.md) for the full reference.

### What's in the box

**Generic CRUD & introspection** — `list_entities`, `describe` (with
`dtype` / `group_id` / `unit` / `min` / `max` / `step` / `default` / `cycle`
per parameter), `get_params` / `set_params` (int ids or DescID paths like
`[903, "y"]`), `get_container`, `dump_shader`, `create_entity`,
`remove_entity`, `set_keyframe`.

**Selection** — `get_selection` / `set_selection` (active object stack, tag,
material; `mode:"replace"|"add"`, `clear:true`).

**Hierarchy** — `move_entity` (reparent / reorder via `parent` / `before` /
`after` / `to_root:true`), `clone_entity` (`GetClone` across object / tag /
material / shader).

**Transforms** — `set_transform` — unified pos / rot / scale / matrix setter
in local or global space.

**Modeling** — `modeling_command` wraps `c4d.utils.SendModelingCommand`
(CSO / Make Editable / Connect / Subdivide / Triangulate / …) with command +
mode alias resolution; inserts newly-produced objects into the document.

**Mesh** — `get_mesh` / `set_mesh` / `set_mesh_selection` (read / write
`PointObject` / `PolygonObject`; triangles compacted to `[a,b,c]`, quads
preserved; point / polygon / edge `BaseSelect` round-trip via
`include:["selections"]`).

**Document I/O** — `save_document` (c4d / abc / alembic / fbx / obj / stl /
ply / usd / usda / gltf), `open_document`, `new_document`, `import_scene`
(merge), `reset_scene` (prefix-scoped bulk clear + `FlushUndoBuffer`, or
full BaseDocument swap).

**Node materials (maxon.GraphDescription)** — `list_graph_nodes`,
`list_graph_node_assets`, `get_graph_info`, `apply_graph_description`,
`set_graph_port`, `remove_graph_node`. All accept `scope:"document"` to
target the active doc's scene-nodes (neutron) graph instead of a material.

**Tag helpers** — `assign_material` creates or (with
`update_if_exists:true`) updates a Texture tag with projection / UV offset /
UV tiles / selection restriction.

**Animation** — `list_tracks`, `get_keyframes`, `delete_keyframe` (single
frame or range), `delete_track`. Vector sub-components addressable via
`"x" / "y" / "z"`.

**Layers** — `list_layers`, `create_layer` (idempotent via
`update_if_exists:true`), `assign_to_layer` (`layer:null` to clear),
`get_object_layer`, `set_layer_flags` (solo / view / render / manager /
locked / generators / deformers / expressions / animation / xref).

**User data** — `add_user_data` / `list_user_data` / `remove_user_data` —
works on any `BaseList2D`; DescIDs returned from `list_user_data` pipe
straight into `get_params` / `set_params`.

**MoGraph** — `list_mograph_clones` reads per-clone matrices from
`GeGetMoData` (forces an `ExecutePasses` so the array is populated).

**Shot / scene setup** — `get_document_state`, `set_document`,
`create_render_data`, `create_take`, `sample_transform`.

**Script-style escape hatches** — `exec_python` (opt-in, off by default),
`call_command`, `list_plugins` (with `plugin_type` aliases), `batch`
(single undo group), `undo`, `render`, `ping`.

### Handles

Typed `kind` discriminator: `object` (`name` or `path`), `render_data`,
`take`, `material`, `tag` (`type_id` + `tag_name`), `video_post`, `shader`
(`owner` + `name` fallback → `index`). Ambiguous `name` lookups raise with
candidate paths suggested; `create_entity` returns handles with both
`name` and `path`.

### Security posture

- `exec_python` is opt-in via `C4D_MCP_ENABLE_EXEC_PYTHON` on both sides
  (safe-by-default). Hidden from MCP clients and rejected by the bridge
  when off.
- `C4D_MCP_TOKEN` shared-secret authentication on the Node ↔ C4D socket
  (constant-time compare via `hmac.compare_digest`).
- `C4D_MCP_ALLOW_REMOTE` safety gate — the bridge refuses to bind to a
  non-loopback host unless explicitly set.
- Bridge never logs raw request bytes — only the parsed command name, so
  `C4D_MCP_TOKEN` cannot leak into the temp log.

### Distribution

- npm package `@kumoproductions/mcp-cinema4d` (CLI entry: `cinema4d-mcp`).
- Bridge plugin shipped as a versioned zip attached to each GitHub Release;
  end users extract it into their Cinema 4D plugins folder.
- Maxon-registered plugin id `1068169`.

### Quality

- Full E2E suite (Vitest) against a live Cinema 4D — 88 passing tests
  across 17 files, green in ~60s.
- GitHub Actions CI: typecheck / lint / format / build / CRLF guard.
- Toolchain: oxlint, oxfmt, ruff (via `uvx`), lefthook pre-commit hooks,
  LF enforcement.
