import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { cleanupByPrefix, MCPTestClient, probeBridge, resetScene, testName } from "./harness.js";

const probe = await probeBridge("basics");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

describe.skipIf(!ready)("basics", () => {
  const c = client!;

  afterAll(async () => {
    await cleanupByPrefix(c);
    await c.close();
  });

  beforeEach(async () => {
    const reset = await resetScene(c);
    if (!reset) await cleanupByPrefix(c);
  });

  test("ping returns pong + c4d version", async () => {
    const r = await c.call<{ pong: boolean; c4d_version: number }>("ping");
    expect(r.pong).toBe(true);
    expect(typeof r.c4d_version).toBe("number");
    expect(r.c4d_version).toBeGreaterThan(0);
  });

  test("list_entities kind=object returns no e2e_ objects after cleanup", async () => {
    // We can't assume a fully empty doc — the user may be running tests
    // alongside their own scene. Scope the assertion to our own prefix so
    // this test is stable regardless of surrounding content.
    const r = await c.call<{ entities: Array<{ name: string }> }>("list_entities", {
      kind: "object",
      name_pattern: "^e2e_",
    });
    expect(Array.isArray(r.entities)).toBe(true);
    expect(r.entities.length).toBe(0);
  });

  test("create_entity with string alias places a cube findable via list_entities", async () => {
    const name = testName("cube");
    const created = await c.call<{
      handle: { kind: string; name: string; path: string };
      summary: { path: string };
    }>("create_entity", { kind: "object", type_id: "cube", name, position: [10, 20, 30] });
    expect(created.handle.name).toBe(name);
    expect(created.handle.path).toBe(`/${name}`);

    const listed = await c.call<{ entities: Array<{ name: string }> }>("list_entities", {
      kind: "object",
      name_pattern: `^${name}$`,
    });
    expect(listed.entities.map((o) => o.name)).toContain(name);
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

  test("render produces a file at the returned path", async () => {
    // Shrink the active render data so the smoke-test render is cheap.
    // RDATA_XRES=1000, RDATA_YRES=1001.
    const listed = await c.call<{ entities: Array<{ name: string; is_active: boolean }> }>(
      "list_entities",
      { kind: "render_data" },
    );
    const active = listed.entities.find((e) => e.is_active);
    if (active) {
      await c.call("set_params", {
        handle: { kind: "render_data", name: active.name },
        values: [
          { path: 1000, value: 64 },
          { path: 1001, value: 64 },
        ],
      });
    }
    await c.call("create_entity", {
      kind: "object",
      type_id: "cube",
      name: testName("render_target"),
    });
    const r = await c.call<{ path: string; width: number; height: number }>(
      "render",
      {},
      { timeoutMs: 120_000 },
    );
    expect(typeof r.path).toBe("string");
    const { existsSync, statSync } = await import("node:fs");
    expect(existsSync(r.path)).toBe(true);
    expect(statSync(r.path).size).toBeGreaterThan(0);
  });
});
