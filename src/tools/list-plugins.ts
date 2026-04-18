import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";

/**
 * Aliases accepted by the ``plugin_type`` argument. These map to
 * ``c4d.PLUGINTYPE_*`` constants in the bridge. Integer ids are also accepted
 * for constants that aren't mirrored here.
 */
const PLUGIN_TYPES = [
  "command",
  "object",
  "tag",
  "material",
  "shader",
  "video_post",
  "scene_loader",
  "scene_saver",
  "bitmap_loader",
  "bitmap_saver",
  "tool",
  "preference",
  "node",
  "sculpt_brush",
] as const;

export const listPluginsTool = defineTool({
  name: "list_plugins",
  group: "script",
  title: "List C4D Plugins (Any Type)",
  description:
    'Generalized plugin enumerator. Pass plugin_type (e.g. "material", "shader", "video_post", "command") or a raw int to FilterPluginList. Each entry includes "plugin" (parent folder of the binary, e.g. "OctaneRender 1.7.1") and "plugin_file" (binary basename) for host-plugin attribution. Filter results by name_pattern and/or plugin_pattern regex.',
  inputShape: {
    plugin_type: z
      .union([z.enum(PLUGIN_TYPES), z.number().int()])
      .default("command")
      .describe(
        "Plugin category: string alias or raw c4d.PLUGINTYPE_* integer. Defaults to 'command'.",
      ),
    name_pattern: z
      .string()
      .optional()
      .describe('Optional regex applied to plugin display name (e.g. "octane|convert").'),
    plugin_pattern: z
      .string()
      .optional()
      .describe(
        'Optional regex matched against the host plugin folder or binary filename (e.g. "octane" → "OctaneRender 1.7.1"). Useful for commands whose display name does not include the plugin brand.',
      ),
  },
  async handler(args, client) {
    const payload: Record<string, unknown> = { plugin_type: args.plugin_type };
    if (args.name_pattern !== undefined) payload.name_pattern = args.name_pattern;
    if (args.plugin_pattern !== undefined) payload.plugin_pattern = args.plugin_pattern;
    return textResult(await client.request("list_plugins", payload, 15_000));
  },
});
