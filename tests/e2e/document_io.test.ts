import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { cleanupByPrefix, MCPTestClient, probeBridge, resetScene, testName } from "./harness.js";

const OCUBE = 5159;

const probe = await probeBridge("document_io");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

const workDir = ready ? mkdtempSync(path.join(tmpdir(), "c4d_mcp_docio_")) : "";

describe.skipIf(!ready)("document I/O (save/open/new)", () => {
  const c = client!;

  afterAll(async () => {
    await cleanupByPrefix(c);
    await c.close();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    const reset = await resetScene(c);
    if (!reset) await cleanupByPrefix(c);
  });

  test("save_document writes a .c4d file to the requested path", async () => {
    const outPath = path.join(workDir, `${testName("saved")}.c4d`);
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name: testName("save_cube") });

    const r = await c.call<{ path: string; format: string }>("save_document", {
      path: outPath,
      format: "c4d",
    });
    expect(r.path).toBe(outPath);
    expect(r.format).toBe("c4d");
    expect(existsSync(outPath)).toBe(true);
  });

  test("save_document rejects unknown format aliases", async () => {
    // The TS tool's zod enum rejects unknown aliases client-side before the
    // call hits the bridge. Accept either error source — both communicate
    // the same thing to the LLM.
    const err = await c.callExpectError("save_document", {
      path: path.join(workDir, "nope.xyz"),
      format: "xyz_not_a_format",
    });
    expect(err).toMatch(/unknown format|invalid option|xyz_not_a_format/i);
  });

  test("new_document creates a fresh active document with no objects", async () => {
    // Seed the current doc so we can tell new_document actually switched.
    await c.call("create_entity", {
      kind: "object",
      type_id: OCUBE,
      name: testName("before_new"),
    });

    const r = await c.call<{ active_document: string; switched: boolean }>("new_document", {
      name: testName("freshdoc"),
      make_active: true,
    });
    expect(r.switched).toBe(true);

    const scene = await c.call<{ entities: unknown[] }>("list_entities", { kind: "object" });
    expect(scene.entities.length).toBe(0);
  });

  test("open_document round-trips a saved file back into the app", async () => {
    const savePath = path.join(workDir, `${testName("roundtrip")}.c4d`);
    const tagName = testName("rt_cube");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name: tagName });
    await c.call("save_document", { path: savePath, format: "c4d" });

    // Swap to an empty doc, then reload the file.
    await c.call("new_document", { make_active: true });
    const r = await c.call<{ path: string; active_document: string; loaded: boolean }>(
      "open_document",
      { path: savePath, make_active: true },
    );
    expect(r.loaded).toBe(true);
    expect(r.path).toBe(savePath);

    const scene = await c.call<{ entities: Array<{ name: string }> }>("list_entities", {
      kind: "object",
    });
    expect(scene.entities.map((o) => o.name)).toContain(tagName);
  });

  test("import_scene merges objects from a saved c4d file into the active doc", async () => {
    // Save a scene with a cube, switch to a new empty doc, import_scene.
    const savePath = path.join(workDir, `${testName("import_src")}.c4d`);
    const srcName = testName("import_cube");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name: srcName });
    await c.call("save_document", { path: savePath, format: "c4d" });

    await c.call("new_document", { make_active: true });
    const scene0 = await c.call<{ entities: Array<unknown> }>("list_entities", {
      kind: "object",
      name_pattern: `^${srcName}$`,
    });
    expect(scene0.entities.length).toBe(0);

    const r = await c.call<{ count: number; imported: Array<{ name: string }> }>("import_scene", {
      path: savePath,
    });
    expect(r.count).toBeGreaterThan(0);
    expect(r.imported.some((o) => o.name === srcName)).toBe(true);

    const scene1 = await c.call<{ entities: Array<{ name: string }> }>("list_entities", {
      kind: "object",
      name_pattern: `^${srcName}$`,
    });
    expect(scene1.entities.map((o) => o.name)).toContain(srcName);
  });
});
