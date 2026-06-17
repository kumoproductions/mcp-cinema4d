# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **`apply_graph_description` now builds Scene Nodes graphs.** With
  `scope:"document"` it creates nodes, connections, and port values on the
  scene-nodes (neutron) graph, which previously rejected every `$type`. Use a
  `$type` from `list_graph_node_assets` (e.g. `net.maxon.node.invert`), not the
  `net.maxon.corenode:*` ids shown by `list_graph_nodes`.
- **`list_graph_node_assets` returns the right node types per space.** It now
  lists the templates you can actually add in `scenenodes`, `standard`, or
  `redshift`, instead of an empty or mixed list.

## [0.3.0] - 2026-06-02

### Changed

- **Breaking — CLI bin renamed `cinema4d-mcp` → `mcp-cinema4d`** to match the
  npm package name. If your client config invokes the bin directly
  (`command: "cinema4d-mcp"`), switch to `mcp-cinema4d`. Configs using
  `npx -y @kumoproductions/mcp-cinema4d` keep working as-is.

## [0.2.7] - 2026-05-27

### Added

- Multi-document management — three tools that fill the gap left by
  `get_document_state` (which only reports the active document):
  `list_documents` enumerates the open documents with a stable list
  `index`, name, path and active flag; `set_active_document` switches
  focus by `index` or unique `name` (name errors on zero/several matches,
  pointing the caller to `index`); `close_document` closes one the same
  way, refusing a document with unsaved changes unless `force:true` (its
  `KillDocument` discards them without a prompt). Loading a file from disk
  stays `open_document`; these only act on docs already open.

## [0.2.6] - 2026-04-29

### Added

- `move_entity` extended beyond objects to the take and render-data
  hierarchies. It now reparents / reorders takes (build nested child
  takes; the Main take cannot be moved) and nests render data, rejecting
  cross-kind moves (you can't drop a take under a render_data).
- `create_render_data` gains a `parent` parameter so render presets can be
  nested under another render data to build render-preset trees.

## [0.2.5] - 2026-04-25

### Added

- `preview_render` — an agent-friendly verification render. Uses the
  viewport renderer with a Constant + Lines sketch style and returns an
  inline PNG, with several preset camera angles and an optional PNG export
  (default resolution 1024px).

## [0.2.4] - 2026-04-25

_CI / release tooling only — no functional changes._

- Bump `checkout` / `setup-node` to v6 (native Node 24).
- Make the MCP Registry publish step idempotent so a re-tag or retry
  recovers without manual surgery.

## [0.2.3] - 2026-04-25

_CI / release tooling only — no functional changes._

- Mirror the npm package to GitHub Packages so it surfaces in the repo's
  Packages sidebar.

## [0.2.2] - 2026-04-25

_CI / release tooling only — no functional changes._

- Auto-sync `server.json` version on `npm version` so it never drifts from
  `package.json`.
- Fix the `mcp-publisher` release-asset name pattern and make the
  plugin-zip / npm-publish jobs idempotent on retry.
- Shorten the `server.json` description to fit the MCP Registry's
  100-character cap.

## [0.2.1] - 2026-04-25

### Added

- Distribution: register on the MCP Registry and publish via GitHub OIDC
  on `v*` tags. Adds `server.json`
  (`io.github.kumoproductions/mcp-cinema4d`) and `mcpName` in
  `package.json` for npm-side ownership verification, with tag/version
  consistency checks and an npm-propagation wait before the registry push.

## [0.2.0] - 2026-04-25

### Security

- Python-ops opt-in gate (`C4D_MCP_ENABLE_PYTHON_OPS`, on both sides).
  Creating or editing plugin types that store executable Python — Python
  tag, Python generator, MoGraph Python effector, Python field, and the
  Xpresso Python operator — is now gated behind its own flag, separate
  from `exec_python`, since their code parameter is RCE-equivalent.

## [0.1.4] - 2026-04-24

### Added

- Xpresso (classic GvNodeMaster) graph authoring — four new tools that
  mirror the node-material flow but target Xpresso tags:
  `list_xpresso_nodes` (flat walk with stable dotted-index path ids and
  per-port summaries), `apply_xpresso_graph` (declarative node + connect
  builder, including `references` for Object/Link node BaseLink slots),
  `set_xpresso_port` (low-level add / remove / connect / disconnect /
  `set_value` escape hatch), and `remove_xpresso_node`. Operator ids accept
  short aliases (`object` / `const` / `math` / `formula` / `python` / …)
  or raw `c4d.ID_OPERATOR_*` ints. Lets the LLM build a working
  gear-meshing rig end-to-end without dropping into `exec_python`.
- `plugin_options` handle kind — resolves a scene-saver / scene-loader /
  bitmap-saver / etc. plugin's private settings `BaseList2D` (the object
  the Attribute Manager export dialog writes into, e.g. Alembic's
  `ABCEXPORT_FRAME_START`). Accepts either a format alias
  (`"abc"` / `"fbx"` / `"obj"` / `"usd"` / `"gltf"` / …) or a raw plugin id,
  with `plugin_type` defaulting to `"scene_saver"`. Plugs straight into the
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

## [0.1.3] - 2026-04-21

_Internal — no functional changes._

- Enrich the E2E suite.
- Auto-regenerate `docs/TOOLS.md` via a lefthook pre-commit hook so CI's
  drift guard never trips on a contributor who forgot to rebuild.

## [0.1.2] - 2026-04-20

### Added

- `take_override` tool — author per-take parameter overrides.
- `clone_entity` / `create_entity` extended to cover `video_post` entities
  and takes.

## [0.1.1] - 2026-04-19

_Internal — no functional changes._

- Regenerate `package-lock.json`.

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

- npm package `@kumoproductions/mcp-cinema4d` (CLI entry: `mcp-cinema4d`).
- Bridge plugin shipped as a versioned zip attached to each GitHub Release;
  end users extract it into their Cinema 4D plugins folder.
- Maxon-registered plugin id `1068169`.

### Quality

- Full E2E suite (Vitest) against a live Cinema 4D — 88 passing tests
  across 17 files, green in ~60s.
- GitHub Actions CI: typecheck / lint / format / build / CRLF guard.
- Toolchain: oxlint, oxfmt, ruff (via `uvx`), lefthook pre-commit hooks,
  LF enforcement.
