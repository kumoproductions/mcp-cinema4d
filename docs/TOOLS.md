# Tool reference

Generated from `src/tools/**` via `npm run docs:tools` — do not edit by hand. For a grouped summary and example prompts, see the main [README](../README.md).

Every CRUD tool identifies entities by a typed `handle` object — see [Entity handles](../README.md#entity-handles).

56 tools across 16 groups.

## Basics

Connectivity + top-level document actions.

| Tool          | Description                                                                        |
| ------------- | ---------------------------------------------------------------------------------- |
| `ping`        | Check connectivity to the Cinema 4D bridge plugin.                                 |
| `render`      | Render the active Cinema 4D document at its currently-active render data settings. |
| `reset_scene` | Clear scene state in one RPC.                                                      |

## Script-style

Escape hatches when a typed tool doesn't fit, plus undo-grouped multi-op.

| Tool           | Description                                                                    |
| -------------- | ------------------------------------------------------------------------------ |
| `exec_python`  | Run arbitrary Python code on Cinema 4D's main thread.                          |
| `call_command` | Invoke a Cinema 4D command by plugin id via c4d.CallCommand().                 |
| `list_plugins` | Generalized plugin enumerator.                                                 |
| `undo`         | Pop up to `steps` entries off the active document's undo stack via doc.DoUndo. |
| `batch`        | Run many generic ops in one RPC.                                               |

## Generic CRUD

Typed create / read / update / delete across every C4D entity kind.

| Tool            | Description                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| `list_entities` | Enumerate scene entities of a given kind.                                                                 |
| `describe`      | Dump all description parameters (id, name, cycle enum, current value) of a C4D entity resolved by handle. |
| `get_params`    | Read parameter values on a C4D entity by id or DescID path.                                               |
| `set_params`    | Atomically write parameter values (wrapped in one undo).                                                  |
| `get_container` | Dump the raw BaseContainer of a C4D entity (including hidden keys that don't show up in `describe`, e.g.  |
| `dump_shader`   | Recursively dump a shader (resolved from a handle) into JSON.                                             |
| `create_entity` | Unified constructor for object / tag / material / shader / video_post.                                    |
| `remove_entity` | Delete the resolved entity (wrapped in an undo step).                                                     |
| `set_keyframe`  | Create or update a single keyframe on a resolved entity's parameter.                                      |

## Shot setup

Document state, frame range / fps / camera, RenderData + Take creation, scene merge.

| Tool                 | Description                                                                                                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `set_document`       | Update document-level settings: fps, frame range, current frame, active camera.                                                                                                               |
| `import_scene`       | Merge an external file (abc/fbx/obj/c4d/etc.) into the active document via MergeDocument.                                                                                                     |
| `create_render_data` | Create (or update-if-exists) a RenderData with resolution / renderer / fps / frame range in one call.                                                                                         |
| `create_take`        | Create or update a Take (AddTake + SetCamera + SetRenderData + SetChecked) in one call.                                                                                                       |
| `take_override`      | Write per-Take parameter overrides onto a target node (object / tag / material / render_data / video_post / shader).                                                                          |
| `sample_transform`   | Evaluate the scene at each requested frame and return the object's transform.                                                                                                                 |
| `get_document_state` | One-shot reader for the active document's key fields: fps, min/max and loop frame range, current frame, document name/path, and canonical handles for the active camera / take / render data. |

## Selection

Active selection read / write.

| Tool            | Description                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `get_selection` | Read the active document's current selection: the active object (primary), all selected objects, and the active tag / material. |
| `set_selection` | Replace or extend the active document's selection.                                                                              |

## Hierarchy

Reparent, reorder, clone.

| Tool           | Description                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| `move_entity`  | Reparent an object under a new parent, promote it to the document root, or reorder it relative to a sibling. |
| `clone_entity` | Duplicate an entity.                                                                                         |

## Modeling

Cinema 4D modeling commands (CSO / Make Editable / Connect / Subdivide / ...).

| Tool               | Description                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| `modeling_command` | Run a Cinema 4D modeling operation via c4d.utils.SendModelingCommand on one or more target objects. |

## Mesh

Read and overwrite points, polygons, and selections.

| Tool                 | Description                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| `get_mesh`           | Read points and polygons (or spline segments) from an editable PointObject / PolygonObject / SplineObject. |
| `set_mesh`           | Overwrite the points (and optionally polygons) of an editable object.                                      |
| `set_mesh_selection` | Replace the point / polygon / edge BaseSelect on an editable mesh.                                         |

## Document I/O

Save / open / create documents.

| Tool            | Description                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `save_document` | Save the active document to disk.                                                               |
| `open_document` | Load a Cinema 4D scene file as a new document.                                                  |
| `new_document`  | Insert a fresh empty BaseDocument into C4D's document list and (by default) switch focus to it. |

## Node materials

Walk and edit node-material graphs (Standard / Redshift / ...).

| Tool                      | Description                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `list_graph_nodes`        | Walk a node graph and return a flat list of nodes.                                                                                 |
| `list_graph_node_assets`  | Enumerate registered node-template assets for a node space.                                                                        |
| `get_graph_info`          | Report which node spaces a material exposes a graph in, which one is currently active, and the alias table the bridge understands. |
| `apply_graph_description` | Build or mutate a node material graph using maxon.GraphDescription's declarative dict syntax.                                      |
| `set_graph_port`          | Update a single port on a node addressable by its stable $id within a node material graph.                                         |
| `remove_graph_node`       | Delete a node by id from a node-material graph.                                                                                    |

## Tag helpers

High-level tag wiring.

| Tool              | Description                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| `assign_material` | Link a material to an object by creating a Texture tag (or updating an existing one when `update_if_exists:true`). |

## Transforms

World / local transform writes.

| Tool            | Description                                           |
| --------------- | ----------------------------------------------------- |
| `set_transform` | Write an object's transform in local or global space. |

## User data

Manage User Data on any entity.

| Tool               | Description                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `add_user_data`    | Add a new User Data slot to any BaseList2D (common rigging / control-exposure pattern).          |
| `list_user_data`   | Enumerate the User Data slots on a target.                                                       |
| `remove_user_data` | Delete a User Data slot by its DescID path (as returned by `list_user_data` or `add_user_data`). |

## MoGraph

Read derived MoGraph state.

| Tool                  | Description                                                                            |
| --------------------- | -------------------------------------------------------------------------------------- |
| `list_mograph_clones` | Read the per-clone transforms from a MoGraph generator (Cloner / Matrix / Tracer / …). |

## Animation

Enumerate CTracks and edit keyframes.

| Tool              | Description                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `list_tracks`     | Enumerate CTracks on the resolved entity.                                                  |
| `get_keyframes`   | Read the keys on a specific animation track.                                               |
| `delete_keyframe` | Remove keys from a CTrack.                                                                 |
| `delete_track`    | Remove an entire CTrack (identified by `param_id` + optional `component`) from the target. |

## Layers

LayerObject CRUD and per-layer flag toggles.

| Tool               | Description                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| `list_layers`      | Enumerate every LayerObject in the active document.                                                      |
| `create_layer`     | Create a LayerObject at the document's layer root.                                                       |
| `assign_to_layer`  | Place a target (object / tag / material) on a named layer.                                               |
| `get_object_layer` | Return the layer currently assigned to a target entity (object / tag / material), or null if unassigned. |
| `set_layer_flags`  | Toggle a layer's visibility / render / lock flags in one call.                                           |
