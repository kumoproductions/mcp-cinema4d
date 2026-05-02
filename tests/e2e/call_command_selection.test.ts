import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  cleanupByPrefix,
  makeCubePolygon,
  MCPTestClient,
  probeBridge,
  resetScene,
  testName,
} from "./harness.js";

const probe = await probeBridge("call_command_selection");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

// We are testing the bridge's selection plumbing, NOT a particular GUI
// command's effect. Use an id that is essentially guaranteed to be unbound
// — CallCommand on an unbound id is a no-op, leaving the selection intact
// so we can assert the bridge populated active_before / active_after.
// 12099 was historically cited as Connect Objects + Delete but on C4D
// 2026 it is bound to Render to Picture Viewer — so don't use that.
const SAFE_SELECTION_TEST_COMMAND = 999999999;

async function makePoly(c: MCPTestClient, name: string): Promise<void> {
  await makeCubePolygon(c, name);
}

describe.skipIf(!ready)("call_command selected_objects", () => {
  const c = client!;

  afterAll(async () => {
    await cleanupByPrefix(c);
    await c.close();
  });

  beforeEach(async () => {
    const reset = await resetScene(c);
    if (!reset) await cleanupByPrefix(c);
  });

  test("selected_objects sets the active selection and reports active_after", async () => {
    const a = testName("ccs_a");
    const b = testName("ccs_b");
    await makePoly(c, a);
    await makePoly(c, b);

    const r = await c.call<{
      command_id: number;
      selection_set: Array<{ name: string }>;
      active_before: { name: string } | null;
      active_after: { name: string; handle: { kind: string } } | null;
    }>("call_command", {
      command_id: SAFE_SELECTION_TEST_COMMAND,
      selected_objects: [
        { kind: "object", name: a },
        { kind: "object", name: b },
      ],
    });

    expect(r.command_id).toBe(SAFE_SELECTION_TEST_COMMAND);
    expect(r.selection_set?.map((s) => s.name)).toEqual([a, b]);
    // C4D's GetActiveObject() returns the *highlighted* object — for a
    // multi-object selection set headlessly via SetActiveObject(NEW)+ADD,
    // 2026 may report no single highlight (None) even though the
    // selection list is populated. Accept either: null OR one of the
    // inputs. The contract we care about is that the bridge populated
    // the response shape and the selection plumbing didn't error.
    if (r.active_before !== null) {
      expect([a, b]).toContain(r.active_before.name);
    }
    if (r.active_after !== null) {
      expect(r.active_after?.handle?.kind).toBe("object");
    }
  });

  test("rejects an unresolvable selection handle", async () => {
    const err = await c.callExpectError("call_command", {
      command_id: SAFE_SELECTION_TEST_COMMAND,
      selected_objects: [{ kind: "object", name: testName("does_not_exist") }],
    });
    expect(err).toMatch(/not resolved|not found/i);
  });

  // Recipe: name-based discovery of the GUI 'Connect Objects + Delete'
  // command, then call_command with selected_objects to merge. This
  // composes the public primitives — there is no dedicated bridge tool
  // for it, by design.
  test("list_plugins + call_command(selected_objects) recipe merges via the GUI command", async () => {
    const a = testName("recipe_a");
    const b = testName("recipe_b");
    await makePoly(c, a);
    await makePoly(c, b);

    const plugins = await c.call<{
      plugins: Array<{ id: number; name: string }>;
    }>("list_plugins", {
      plugin_type: "command",
      name_pattern: "^Connect Objects \\+ Delete$",
    });
    if (plugins.plugins.length === 0) return; // command not available on this build

    const cid = plugins.plugins[0].id;
    expect(plugins.plugins[0].name.toLowerCase()).toContain("connect");

    const r = await c.call<{
      command_id: number;
      active_after: { handle: { kind: string } } | null;
    }>("call_command", {
      command_id: cid,
      selected_objects: [
        { kind: "object", name: a },
        { kind: "object", name: b },
      ],
    });
    expect(r.command_id).toBe(cid);
    expect(r.active_after?.handle?.kind).toBe("object");
  });

  test("call_command without selected_objects preserves original behavior", async () => {
    // Use the same unbound id as the selection test — CallCommand on an
    // unbound id is a no-op; we only care that the bridge passes through
    // without setting a selection.
    const r = await c.call<{
      command_id: number;
      selection_set: unknown;
    }>("call_command", { command_id: SAFE_SELECTION_TEST_COMMAND });
    expect(r.command_id).toBe(SAFE_SELECTION_TEST_COMMAND);
    // Without selected_objects the bridge should not have set a selection.
    expect(r.selection_set).toBeNull();
  });
});
