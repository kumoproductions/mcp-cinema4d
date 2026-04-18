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
  ]),
);

export const handleDescription =
  'C4D entity handle. Shapes: {kind:"object",name?|path?}, {kind:"render_data",name}, {kind:"take",name}, {kind:"material",name}, {kind:"tag",object?|object_path?,type_id?,tag_name?}, {kind:"video_post",render_data,type_id}, {kind:"shader",owner:<handle>,index}. Prefer `path` over `name` when names are not unique.';
