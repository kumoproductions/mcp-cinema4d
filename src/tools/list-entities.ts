import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const listEntitiesTool = defineTool({
  name: "list_entities",
  group: "crud",
  title: "List C4D Entities",
  description:
    "Enumerate scene entities of a given kind. Returns compact summaries (name, type_id, type_name, plus kind-specific fields — `is_active` for take / material / render_data). For kind=object also supports type_ids / tag_types / max_depth filters and include_tags / include_params to read data inline — so you can find 'all cubes with a Ttexture tag and their position in one call' without falling back to exec_python. Use this first to find what exists before `describe`/`set_params`. **Note:** kind=shader walks classical shader chains; for node-material graphs use `list_graph_nodes`. " +
    "**Scaling:** large scenes can blow past tool-result limits — use `offset` / `limit` to paginate, `summary_only` to get only counts (`total` + `by_type` + `by_depth`), and (kind=object) `object_path` to limit listing to a subtree.",
  inputShape: {
    kind: z
      .enum(["object", "render_data", "take", "material", "tag", "video_post", "shader"])
      .describe("Entity kind to list."),
    object: z
      .string()
      .optional()
      .describe(
        "Filter tags to this object name (only for kind=tag). Omit to list tags on all objects.",
      ),
    object_path: z
      .string()
      .optional()
      .describe(
        "(kind=tag) Filter tags to this object's path. (kind=object) Limit listing to this object's subtree (root inclusive). Use when names are not unique.",
      ),
    render_data: z.string().optional().describe("Render data name (required for kind=video_post)."),
    owner: handleSchema.optional().describe("Owner handle (required for kind=shader)."),
    name_pattern: z
      .string()
      .optional()
      .describe('Optional regex to filter results by name (e.g. "^VFX_Shot00[2-9]$").'),
    // kind=object extras
    type_ids: z
      .array(z.number().int())
      .optional()
      .describe(
        "(kind=object) Keep only objects whose GetType() is in this set (e.g. [5159] for cubes).",
      ),
    tag_types: z
      .array(z.number().int())
      .optional()
      .describe(
        "(kind=object) Keep only objects carrying a tag whose type id is in this set (e.g. [5616] for Ttexture).",
      ),
    max_depth: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("(kind=object) Skip objects deeper than this (root=0). Default: unlimited."),
    include_tags: z
      .boolean()
      .optional()
      .describe("(kind=object) Attach `tags: [{type_id, type_name, name}, ...]` to each match."),
    include_params: z
      .array(z.number().int())
      .optional()
      .describe(
        "(kind=object) Parameter ids to read per match. Returned under `params: {param_id: value}`.",
      ),
    // Pagination / summarisation
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Skip this many entries from the start of the (post-filter) result. Default 0."),
    limit: z
      .number()
      .int()
      .positive()
      .max(10000)
      .optional()
      .describe(
        "Maximum number of entries to return after offset. Default unlimited. Pair with `total` (always included) to drive paged callers.",
      ),
    summary_only: z
      .boolean()
      .optional()
      .describe(
        "If true, omit per-entity entries and return `{total, by_type, by_depth?}` only. Use to scan large scenes without paging the entries themselves.",
      ),
  },
  async handler(args, client) {
    const params: Record<string, unknown> = { kind: args.kind };
    if (args.object !== undefined) params.object = args.object;
    if (args.object_path !== undefined) params.object_path = args.object_path;
    if (args.render_data !== undefined) params.render_data = args.render_data;
    if (args.owner !== undefined) params.owner = args.owner;
    if (args.name_pattern !== undefined) params.name_pattern = args.name_pattern;
    if (args.type_ids !== undefined) params.type_ids = args.type_ids;
    if (args.tag_types !== undefined) params.tag_types = args.tag_types;
    if (args.max_depth !== undefined) params.max_depth = args.max_depth;
    if (args.include_tags !== undefined) params.include_tags = args.include_tags;
    if (args.include_params !== undefined) params.include_params = args.include_params;
    if (args.offset !== undefined) params.offset = args.offset;
    if (args.limit !== undefined) params.limit = args.limit;
    if (args.summary_only !== undefined) params.summary_only = args.summary_only;
    return textResult(await client.request("list_entities", params, 10_000));
  },
});
