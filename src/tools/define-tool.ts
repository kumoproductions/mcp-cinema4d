import type { z } from "zod";
import type { C4DClient } from "../c4d-client.js";
import type { ToolResult } from "./types.js";

export type ToolGroup =
  | "basics"
  | "script"
  | "crud"
  | "shot"
  | "selection"
  | "hierarchy"
  | "modeling"
  | "mesh"
  | "document-io"
  | "node-materials"
  | "tags"
  | "transforms"
  | "user-data"
  | "mograph"
  | "animation"
  | "layers";

export type ToolSpec<S extends z.ZodRawShape> = {
  name: string;
  title: string;
  description: string;
  group: ToolGroup;
  inputShape: S;
  handler: (args: { [K in keyof S]: z.infer<S[K]> }, client: C4DClient) => Promise<ToolResult>;
};

/**
 * Typed tool factory. Infers the handler's argument type from `inputShape`
 * so every tool definition stays short and consistent.
 */
export function defineTool<S extends z.ZodRawShape>(spec: ToolSpec<S>): ToolSpec<S> {
  return spec;
}

/** Wraps a C4D bridge response into a standard MCP text-content ToolResult. */
export function textResult(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
