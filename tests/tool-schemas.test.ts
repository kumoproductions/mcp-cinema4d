// MCP clients validate tool arguments against the JSON Schema the SDK emits
// for each tool's zod shape (draft-07). Two constructs in that output break
// real clients (issue #8):
//   - `$ref: "#/definitions/..."` from recursive (z.lazy) schemas — clients
//     that do not resolve it reject every value;
//   - `items: [...]` from z.tuple — draft-2020-12 validators reject the whole
//     schema ("items must be object,boolean"), dropping the tool.
// This walks the emitted schema of every tool and fails on either.

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { handleSchema, pathSchema } from "../src/tools/handle.js";
import { ALL_TOOLS } from "../src/tools/index.js";

function findProblems(node: unknown, at: string, out: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((child, i) => findProblems(child, `${at}/${i}`, out));
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  if ("$ref" in record) out.push(`${at}: $ref ${String(record.$ref)}`);
  if (Array.isArray(record.items)) out.push(`${at}: tuple-form items`);
  for (const [key, child] of Object.entries(record)) findProblems(child, `${at}/${key}`, out);
}

describe("tool input schemas", () => {
  for (const tool of ALL_TOOLS) {
    it(`${tool.name} emits a self-contained, tuple-free JSON Schema`, () => {
      const schema = z.toJSONSchema(z.object(tool.inputShape), { target: "draft-7" });
      const problems: string[] = [];
      findProblems(schema, "", problems);
      expect(problems).toEqual([]);
    });
  }
});

describe("handleSchema", () => {
  it.each([
    { kind: "object", path: "/Cube" },
    { kind: "object", name: "Cube" },
    { kind: "tag", object: "Cube", type_id: 5671 },
    { kind: "gv_node", tag: { kind: "tag", object_path: "/Null" }, id: "0.1" },
    { kind: "shader", owner: { kind: "material", name: "Mat" }, index: 0 },
    {
      kind: "shader",
      owner: { kind: "shader", owner: { kind: "material", name: "Mat" }, index: 0 },
      name: "Noise",
    },
    { kind: "plugin_options", plugin_id: "abc" },
  ])("accepts %j", (handle) => {
    expect(handleSchema.safeParse(handle).success).toBe(true);
  });

  it.each([
    { kind: "object" },
    { kind: "tag", type_id: 5671 },
    { kind: "gv_node", tag: { kind: "object", name: "Cube" }, id: "0" },
    { kind: "shader", owner: { kind: "material", name: "Mat" } },
    "/Cube",
  ])("rejects %j", (handle) => {
    expect(handleSchema.safeParse(handle).success).toBe(false);
  });
});

describe("pathSchema", () => {
  it.each([[5], [[5, 1000]], [[5, "x"]], [[[5, "real"]]], [[["x", "vector"]]], [[[700, 19, 0]]]])(
    "accepts %j",
    (path) => {
      expect(pathSchema.safeParse(path).success).toBe(true);
    },
  );

  it.each([[[]], [[[5.5, "real"]]], [[["w", "real"]]], [[[5, "real", "x"]]]])(
    "rejects %j",
    (path) => {
      expect(pathSchema.safeParse(path).success).toBe(false);
    },
  );
});
