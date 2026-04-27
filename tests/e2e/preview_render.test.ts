import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { cleanupByPrefix, MCPTestClient, probeBridge, resetScene, testName } from "./harness.js";

const probe = await probeBridge("preview_render");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

describe.skipIf(!ready)("preview_render", () => {
  const c = client!;

  afterAll(async () => {
    await cleanupByPrefix(c);
    await c.close();
  });

  beforeEach(async () => {
    const reset = await resetScene(c);
    if (!reset) await cleanupByPrefix(c);
  });

  test("preview_render returns inline base64 PNG with current view metadata", async () => {
    await c.call("create_entity", {
      kind: "object",
      type_id: "cube",
      name: testName("preview_cube"),
    });
    const res = await c.callRaw("preview_render", { width: 64, height: 64 }, { timeoutMs: 60_000 });
    const imagePart = res.content.find((p) => p.type === "image") as
      | { type: "image"; data: string; mimeType: string }
      | undefined;
    expect(imagePart).toBeDefined();
    expect(typeof imagePart!.data).toBe("string");
    // Base64 of a 64x64 PNG is plenty more than 100 chars; the threshold
    // just guards against an empty / truncated payload.
    expect(imagePart!.data.length).toBeGreaterThan(100);
    expect(imagePart!.mimeType).toBe("image/png");

    const textPart = res.content.find((p) => p.type === "text") as
      | { type: "text"; text: string }
      | undefined;
    expect(textPart).toBeDefined();
    const meta = JSON.parse(textPart!.text) as {
      view: string;
      camera: string | null;
      width: number;
      height: number;
      saved_path?: string;
    };
    expect(meta.view).toBe("current");
    expect(meta.camera).toBeNull();
    expect(meta.width).toBe(64);
    expect(meta.height).toBe(64);
    expect(meta.saved_path).toBeUndefined();
  });

  test.each(["top", "bottom", "left", "right", "front", "back"] as const)(
    "preview_render preset view %s renders without error",
    async (view) => {
      await c.call("create_entity", {
        kind: "object",
        type_id: "cube",
        name: testName(`preview_${view}`),
      });
      const res = await c.callRaw(
        "preview_render",
        { width: 64, height: 64, view },
        { timeoutMs: 60_000 },
      );
      const imagePart = res.content.find((p) => p.type === "image") as
        | { type: "image"; data: string }
        | undefined;
      expect(imagePart, `view=${view} should produce an image`).toBeDefined();
      expect(imagePart!.data.length).toBeGreaterThan(100);

      const textPart = res.content.find((p) => p.type === "text") as
        | { type: "text"; text: string }
        | undefined;
      expect(textPart, `view=${view} should produce text metadata`).toBeDefined();
      const meta = JSON.parse(textPart!.text) as { view: string; camera: string | null };
      expect(meta.view).toBe(view);
      // Preset views label the temp camera by the view name itself.
      expect(meta.camera).toBe(view);
    },
  );

  test("preview_render save_path writes the PNG to disk and surfaces the path in meta", async () => {
    await c.call("create_entity", {
      kind: "object",
      type_id: "cube",
      name: testName("preview_save_target"),
    });
    const { mkdtempSync, existsSync, statSync, rmSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const dir = mkdtempSync(path.join(tmpdir(), "c4d-mcp-preview-"));
    const out = path.join(dir, "preview.png");
    try {
      const res = await c.callRaw(
        "preview_render",
        { width: 64, height: 64, save_path: out },
        { timeoutMs: 60_000 },
      );
      expect(existsSync(out)).toBe(true);
      const size = statSync(out).size;
      expect(size).toBeGreaterThan(0);
      // PNG magic number sanity-check so we know we got an actual PNG, not
      // a stray byte stream.
      const head = readFileSync(out).subarray(0, 8);
      expect(Array.from(head)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      const textPart = res.content.find((p) => p.type === "text") as
        | { type: "text"; text: string }
        | undefined;
      expect(textPart, "save_path response should include text metadata").toBeDefined();
      const meta = JSON.parse(textPart!.text) as { saved_path?: string };
      expect(meta.saved_path).toBe(out);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("preview_render rejects relative save_path", async () => {
    const err = await c.callExpectError("preview_render", {
      width: 64,
      height: 64,
      save_path: "preview.png",
    });
    expect(err.toLowerCase()).toContain("absolute");
  });
});
