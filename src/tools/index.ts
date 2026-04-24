import type { z } from "zod";
import type { C4DClient } from "../c4d-client.js";
import type { ToolResult } from "./types.js";

import { addUserDataTool } from "./add-user-data.js";
import { applyGraphDescriptionTool } from "./apply-graph-description.js";
import { applyXpressoGraphTool } from "./apply-xpresso-graph.js";
import { assignMaterialTool } from "./assign-material.js";
import { assignToLayerTool } from "./assign-to-layer.js";
import { batchTool } from "./batch.js";
import { callCommandTool } from "./call-command.js";
import { cloneEntityTool } from "./clone-entity.js";
import { createEntityTool } from "./create-entity.js";
import { createLayerTool } from "./create-layer.js";
import { createRenderDataTool } from "./create-render-data.js";
import { createTakeTool } from "./create-take.js";
import { deleteKeyframeTool } from "./delete-keyframe.js";
import { deleteTrackTool } from "./delete-track.js";
import { describeTool } from "./describe.js";
import { dumpShaderTool } from "./dump-shader.js";
import { execPythonEnabled, execPythonTool } from "./exec-python.js";
import { getContainerTool } from "./get-container.js";
import { getDocumentStateTool } from "./get-document-state.js";
import { getGraphInfoTool } from "./get-graph-info.js";
import { getKeyframesTool } from "./get-keyframes.js";
import { getMeshTool } from "./get-mesh.js";
import { getObjectLayerTool } from "./get-object-layer.js";
import { getParamsTool } from "./get-params.js";
import { getSelectionTool } from "./get-selection.js";
import { importSceneTool } from "./import-scene.js";
import { listEntitiesTool } from "./list-entities.js";
import { listGraphNodeAssetsTool } from "./list-graph-node-assets.js";
import { listGraphNodesTool } from "./list-graph-nodes.js";
import { listXpressoNodesTool } from "./list-xpresso-nodes.js";
import { listMographClonesTool } from "./list-mograph-clones.js";
import { listLayersTool } from "./list-layers.js";
import { listPluginsTool } from "./list-plugins.js";
import { listTracksTool } from "./list-tracks.js";
import { listUserDataTool } from "./list-user-data.js";
import { modelingCommandTool } from "./modeling-command.js";
import { moveEntityTool } from "./move-entity.js";
import { newDocumentTool } from "./new-document.js";
import { openDocumentTool } from "./open-document.js";
import { pingTool } from "./ping.js";
import { removeEntityTool } from "./remove-entity.js";
import { removeGraphNodeTool } from "./remove-graph-node.js";
import { removeUserDataTool } from "./remove-user-data.js";
import { removeXpressoNodeTool } from "./remove-xpresso-node.js";
import { renderTool } from "./render.js";
import { resetSceneTool } from "./reset-scene.js";
import { sampleTransformTool } from "./sample-transform.js";
import { saveDocumentTool } from "./save-document.js";
import { setDocumentTool } from "./set-document.js";
import { setGraphPortTool } from "./set-graph-port.js";
import { setKeyframeTool } from "./set-keyframe.js";
import { setLayerFlagsTool } from "./set-layer-flags.js";
import { setMeshTool } from "./set-mesh.js";
import { setMeshSelectionTool } from "./set-mesh-selection.js";
import { setParamsTool } from "./set-params.js";
import { setSelectionTool } from "./set-selection.js";
import { setTransformTool } from "./set-transform.js";
import { setXpressoPortTool } from "./set-xpresso-port.js";
import { takeOverrideTool } from "./take-override.js";
import { undoTool } from "./undo.js";

import type { ToolGroup } from "./define-tool.js";

export type AnyTool = {
  name: string;
  title: string;
  description: string;
  group: ToolGroup;
  inputShape: z.ZodRawShape;
  handler: (args: any, client: C4DClient) => Promise<ToolResult>;
};

/** Every tool registered with the MCP server, grouped by theme. */
export const ALL_TOOLS: AnyTool[] = [
  // Basics
  pingTool,
  renderTool,
  resetSceneTool,
  // Script-style
  execPythonTool,
  callCommandTool,
  listPluginsTool,
  undoTool,
  batchTool,
  // Generic CRUD on handles
  listEntitiesTool,
  describeTool,
  getParamsTool,
  setParamsTool,
  getContainerTool,
  dumpShaderTool,
  createEntityTool,
  removeEntityTool,
  setKeyframeTool,
  // Shot / scene setup
  setDocumentTool,
  importSceneTool,
  createRenderDataTool,
  createTakeTool,
  takeOverrideTool,
  sampleTransformTool,
  // Selection
  getSelectionTool,
  setSelectionTool,
  // Hierarchy
  moveEntityTool,
  cloneEntityTool,
  // Modeling
  modelingCommandTool,
  // Mesh
  getMeshTool,
  setMeshTool,
  setMeshSelectionTool,
  // Document I/O
  saveDocumentTool,
  openDocumentTool,
  newDocumentTool,
  // Node materials
  listGraphNodesTool,
  listGraphNodeAssetsTool,
  getGraphInfoTool,
  applyGraphDescriptionTool,
  setGraphPortTool,
  removeGraphNodeTool,
  // Xpresso (classic GvNodeMaster)
  listXpressoNodesTool,
  applyXpressoGraphTool,
  setXpressoPortTool,
  removeXpressoNodeTool,
  // Tag helpers
  assignMaterialTool,
  // Transforms
  setTransformTool,
  // User data
  addUserDataTool,
  listUserDataTool,
  removeUserDataTool,
  // MoGraph
  listMographClonesTool,
  // Animation
  listTracksTool,
  getKeyframesTool,
  deleteKeyframeTool,
  deleteTrackTool,
  // Layers
  listLayersTool,
  createLayerTool,
  assignToLayerTool,
  getObjectLayerTool,
  setLayerFlagsTool,
  // Document state
  getDocumentStateTool,
];

/**
 * Tools exposed to the MCP client. exec_python is excluded unless
 * `C4D_MCP_ENABLE_EXEC_PYTHON` is set so LLMs don't even see it as an option
 * by default. The bridge plugin enforces the same opt-in server-side.
 */
export const TOOLS: AnyTool[] = ALL_TOOLS.filter(
  (t) => !(t.name === "exec_python" && !execPythonEnabled()),
);
