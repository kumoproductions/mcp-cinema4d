"""Command handlers for the Cinema 4D MCP bridge.

All handlers run on Cinema 4D's main thread via the Dispatcher. They may
freely call ``c4d`` APIs. Return values must be JSON-serializable.

Submodules:
  _helpers     — shared lookup / resolve / describe / apply_params helpers
  basics       — ping, undo, render
  entities     — generic handle-based CRUD + shader dump
                 (list/describe/get/set/create/remove/set_keyframe/get_container/
                 dump_shader)
  shot_setup   — import_scene, create_render_data, create_take,
                 sample_transform, set_document
  script       — exec_python, call_command, list_plugins, batch
  selection    — get_selection, set_selection
  hierarchy    — move_entity, clone_entity
  modeling     — modeling_command
  mesh         — get_mesh, set_mesh
  document_io  — save_document, open_document, new_document
  node_materials — list_graph_nodes, apply_graph_description,
                   set_graph_port, remove_graph_node
  tags         — assign_material
  animation    — list_tracks, get_keyframes
  layers       — list_layers, create_layer, assign_to_layer,
                 get_object_layer, set_layer_flags
  document_state — get_document_state
"""

from __future__ import annotations

from .animation import (
    handle_delete_keyframe,
    handle_delete_track,
    handle_get_keyframes,
    handle_list_tracks,
)
from .basics import (
    handle_ping,
    handle_render,
    handle_reset_scene,
    handle_undo,
)
from .document_io import (
    handle_new_document,
    handle_open_document,
    handle_save_document,
)
from .document_state import handle_get_document_state
from .entities import (
    handle_create_entity,
    handle_describe,
    handle_dump_shader,
    handle_get_container,
    handle_get_params,
    handle_list_entities,
    handle_remove_entity,
    handle_set_keyframe,
    handle_set_params,
)
from .hierarchy import (
    handle_clone_entity,
    handle_move_entity,
)
from .layers import (
    handle_assign_to_layer,
    handle_create_layer,
    handle_get_object_layer,
    handle_list_layers,
    handle_set_layer_flags,
)
from .mesh import (
    handle_get_mesh,
    handle_set_mesh,
    handle_set_mesh_selection,
)
from .modeling import handle_modeling_command
from .mograph import handle_list_mograph_clones
from .node_materials import (
    handle_apply_graph_description,
    handle_get_graph_info,
    handle_list_graph_node_assets,
    handle_list_graph_nodes,
    handle_remove_graph_node,
    handle_set_graph_port,
)
from .script import (
    handle_batch,
    handle_call_command,
    handle_exec_python,
    handle_list_plugins,
)
from .selection import (
    handle_get_selection,
    handle_set_selection,
)
from .shot_setup import (
    handle_create_render_data,
    handle_create_take,
    handle_import_scene,
    handle_sample_transform,
    handle_set_document,
)
from .tags import handle_assign_material
from .transform import handle_set_transform
from .user_data import (
    handle_add_user_data,
    handle_list_user_data,
    handle_remove_user_data,
)

HANDLERS = {
    "ping": handle_ping,
    "undo": handle_undo,
    "render": handle_render,
    "reset_scene": handle_reset_scene,
    # exec_python is intentionally kept in the table so the handler can raise a
    # descriptive error when opted out. The opt-in check happens inside the
    # handler itself (see script._exec_python_enabled).
    "exec_python": handle_exec_python,
    "list_entities": handle_list_entities,
    "describe": handle_describe,
    "get_params": handle_get_params,
    "set_params": handle_set_params,
    "get_container": handle_get_container,
    "dump_shader": handle_dump_shader,
    "create_entity": handle_create_entity,
    "set_keyframe": handle_set_keyframe,
    "remove_entity": handle_remove_entity,
    "set_document": handle_set_document,
    "batch": handle_batch,
    "call_command": handle_call_command,
    "list_plugins": handle_list_plugins,
    "import_scene": handle_import_scene,
    "create_render_data": handle_create_render_data,
    "create_take": handle_create_take,
    "sample_transform": handle_sample_transform,
    "get_selection": handle_get_selection,
    "set_selection": handle_set_selection,
    "move_entity": handle_move_entity,
    "clone_entity": handle_clone_entity,
    "modeling_command": handle_modeling_command,
    "get_mesh": handle_get_mesh,
    "set_mesh": handle_set_mesh,
    "set_mesh_selection": handle_set_mesh_selection,
    "save_document": handle_save_document,
    "open_document": handle_open_document,
    "new_document": handle_new_document,
    "list_graph_nodes": handle_list_graph_nodes,
    "list_graph_node_assets": handle_list_graph_node_assets,
    "get_graph_info": handle_get_graph_info,
    "apply_graph_description": handle_apply_graph_description,
    "set_graph_port": handle_set_graph_port,
    "remove_graph_node": handle_remove_graph_node,
    "assign_material": handle_assign_material,
    "set_transform": handle_set_transform,
    "add_user_data": handle_add_user_data,
    "list_user_data": handle_list_user_data,
    "remove_user_data": handle_remove_user_data,
    "list_mograph_clones": handle_list_mograph_clones,
    "list_tracks": handle_list_tracks,
    "get_keyframes": handle_get_keyframes,
    "delete_keyframe": handle_delete_keyframe,
    "delete_track": handle_delete_track,
    "list_layers": handle_list_layers,
    "create_layer": handle_create_layer,
    "assign_to_layer": handle_assign_to_layer,
    "get_object_layer": handle_get_object_layer,
    "set_layer_flags": handle_set_layer_flags,
    "get_document_state": handle_get_document_state,
}

__all__ = ["HANDLERS"]
