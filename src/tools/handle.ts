import { z } from "zod";

/**
 * Handle describing a C4D entity. Exact shape depends on `kind`.
 *
 * Object handles accept either `name` (must be unique in scene) or `path`
 * (slash-joined hierarchy, e.g. `/Root/Character/Hip`). Prefer `path` when
 * several objects share a name — `name` lookups raise when ambiguous.
 *
 * Kinds:
 *   - `{kind: "object", name: "Cube"}` or `{kind: "object", path: "/A/B"}`
 *   - `{kind: "render_data", name: "VFX_Shot002"}`
 *   - `{kind: "take", name: "VFX_Shot002"}`
 *   - `{kind: "material", name: "Concrete"}`
 *   - `{kind: "tag", object: "Cube", type_id: 1029524, tag_name?: "..."}`
 *       (or `object_path` instead of `object` to disambiguate)
 *   - `{kind: "video_post", render_data: "VFX_Shot002", type_id: 1029525}`
 *   - `{kind: "shader", owner: <handle>, index: 0}`
 *   - `{kind: "plugin_options", plugin_id: "abc"|1028082, plugin_type?: "scene_saver"}`
 *       Resolves to the plugin's private settings BaseList2D (the one the
 *       Attribute Manager dialog writes into — e.g. Alembic's
 *       `ABCEXPORT_FRAME_START`). Use with `describe` to list available
 *       options, then `set_params` to write them before `save_document`.
 *   - `{kind: "gv_node", tag: <tag handle>, id?: "0.2" | name?: "..."}`
 *       An Xpresso GvNode inside a Texpresso tag. `id` is the stable
 *       dotted-index path returned by `list_xpresso_nodes`; `name`
 *       falls back when id is not known. GvNode inherits from BaseList2D,
 *       so `set_params` / `describe` / `get_params` work on it directly.
 */
export const handleSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([
    z
      .object({
        kind: z.literal("object"),
        name: z.string().optional(),
        path: z.string().optional(),
      })
      .refine((v) => Boolean(v.name) || Boolean(v.path), {
        message: "object handle requires `name` or `path`",
      }),
    z.object({ kind: z.literal("render_data"), name: z.string() }),
    z.object({ kind: z.literal("take"), name: z.string() }),
    z.object({ kind: z.literal("material"), name: z.string() }),
    z
      .object({
        kind: z.literal("tag"),
        object: z.string().optional(),
        object_path: z.string().optional(),
        type_id: z.number().int().optional(),
        tag_name: z.string().optional(),
      })
      .refine((v) => Boolean(v.object) || Boolean(v.object_path), {
        message: "tag handle requires `object` or `object_path`",
      }),
    z.object({
      kind: z.literal("video_post"),
      render_data: z.string(),
      type_id: z.number().int(),
    }),
    z
      .object({
        kind: z.literal("shader"),
        owner: handleSchema,
        index: z.number().int().nonnegative().optional(),
        name: z.string().optional(),
      })
      .refine((v) => v.index !== undefined || Boolean(v.name), {
        message: "shader handle requires `name` or `index`",
      }),
    z
      .object({
        kind: z.literal("gv_node"),
        tag: handleSchema,
        id: z.string().optional(),
        name: z.string().optional(),
      })
      .refine((v) => Boolean(v.id) || Boolean(v.name), {
        message: "gv_node handle requires `id` or `name`",
      }),
    z.object({
      kind: z.literal("plugin_options"),
      plugin_id: z.union([z.number().int(), z.string()]),
      plugin_type: z
        .enum([
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
        ])
        .optional(),
    }),
  ]),
);

export const handleDescription =
  'C4D entity handle. Shapes: {kind:"object",name?|path?}, {kind:"render_data",name}, {kind:"take",name}, {kind:"material",name}, {kind:"tag",object?|object_path?,type_id?,tag_name?}, {kind:"video_post",render_data,type_id}, {kind:"shader",owner:<handle>,index}, {kind:"gv_node",tag:<tag handle>,id?|name?} (Xpresso GvNode; use list_xpresso_nodes to discover stable path ids — GvNode inherits BaseList2D so set_params/get_params/describe work on it), {kind:"plugin_options",plugin_id,plugin_type?} (plugin_id accepts an int or a format alias like "abc"/"fbx"/"obj"/"usd"/"gltf"; plugin_type defaults to "scene_saver"; resolves to the plugin\'s settings BaseList2D — describe+set_params it to configure exporter options before save_document). Prefer `path` over `name` when names are not unique.';
