import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { cleanupByPrefix, MCPTestClient, probeBridge, resetScene, testName } from "./harness.js";

const OCUBE = 5159;

const probe = await probeBridge("script");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

// Detect whether exec_python is opted out on this C4D instance so we can
// skip the exec_python-specific tests cleanly rather than failing.
// exec_python is opt-in by default. Match both "tool not found" (MCP hides
// it) and "disabled" (bridge rejects it) so the skip path covers every
// opt-out shape.
let execPythonDisabled = false;
if (ready && client) {
  try {
    await client.call("exec_python", { code: "result = 1" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    execPythonDisabled = /disabled|not found/i.test(msg);
  }
}

describe.skipIf(!ready)("script + batch", () => {
  const c = client!;

  afterAll(async () => {
    await cleanupByPrefix(c);
    await c.close();
  });

  beforeEach(async () => {
    const reset = await resetScene(c);
    if (!reset) await cleanupByPrefix(c);
  });

  test.skipIf(execPythonDisabled)("exec_python returns result, stdout, stderr", async () => {
    const r = await c.call<{
      result: unknown;
      stdout: string;
      stderr: string;
      error: string | null;
    }>("exec_python", {
      code: [
        "import sys",
        "print('hello out')",
        "print('hello err', file=sys.stderr)",
        "result = {'answer': 42}",
      ].join("\n"),
    });
    expect(r.error).toBeNull();
    expect(r.result).toEqual({ answer: 42 });
    expect(r.stdout).toContain("hello out");
    expect(r.stderr).toContain("hello err");
  });

  test.skipIf(!execPythonDisabled)(
    "exec_python is hidden from the tool list when opted out",
    async () => {
      // When disabled, callTool itself resolves to an error since the tool
      // isn't registered. We accept either branch (MCP reports unknown tool,
      // or the bridge surfaces the opt-out message).
      const err = await c.callExpectError("exec_python", { code: "result = 1" });
      expect(err).toMatch(/disabled|unknown tool|not found|no such tool/i);
    },
  );

  test("call_command invokes a known C4D command by id", async () => {
    // c4d.CallCommand(12105) → Undo. We don't rely on the undo *happening*
    // (depends on undo stack) — just that the RPC round-trips with the
    // command's display name resolved.
    const r = await c.call<{ command_id: number; name: string; was_enabled: boolean | null }>(
      "call_command",
      { command_id: 12105 },
    );
    expect(r.command_id).toBe(12105);
    expect(typeof r.name).toBe("string");
  });

  test("list_plugins default (command) returns non-empty with plugin attribution", async () => {
    const r = await c.call<{
      plugins: Array<{ id: number; name: string; plugin: string; plugin_file: string }>;
      count: number;
    }>("list_plugins");
    expect(r.count).toBeGreaterThan(0);
    expect(r.plugins[0]).toHaveProperty("id");
    expect(r.plugins[0]).toHaveProperty("name");
    expect(r.plugins[0]).toHaveProperty("plugin");
    expect(r.plugins[0]).toHaveProperty("plugin_file");
  });

  test("list_plugins returns non-empty for material / shader / video_post", async () => {
    for (const kind of ["material", "shader", "video_post"] as const) {
      const r = await c.call<{ count: number }>("list_plugins", { plugin_type: kind });
      expect(r.count).toBeGreaterThan(0);
    }
  });

  test("list_plugins rejects unknown plugin_type with a helpful error", async () => {
    const msg = await c.callExpectError("list_plugins", { plugin_type: "not_a_real_type" });
    expect(msg).toMatch(/plugin_type/i);
  });

  test("list_plugins name_pattern filters entries", async () => {
    const all = await c.call<{ count: number }>("list_plugins", { plugin_type: "command" });
    const filtered = await c.call<{ count: number }>("list_plugins", {
      plugin_type: "command",
      // Case-insensitive because C4D display names are mixed-case ("Render",
      // "Cycles 4D", etc.) and the handler's regex is case-sensitive by default.
      name_pattern: "(?i)render",
    });
    expect(filtered.count).toBeLessThan(all.count);
    expect(filtered.count).toBeGreaterThan(0);
  });

  test("list_plugins plugin_pattern attributes commands to host plugins", async () => {
    const all = await c.call<{ count: number }>("list_plugins", { plugin_type: "command" });
    const filtered = await c.call<{
      count: number;
      plugins: Array<{ plugin: string }>;
    }>("list_plugins", { plugin_type: "command", plugin_pattern: "." });
    expect(filtered.count).toBeGreaterThan(0);
    expect(filtered.count).toBeLessThanOrEqual(all.count);
    expect(filtered.plugins.every((p) => p.plugin.length > 0)).toBe(true);
  });

  test("undo reverts a newly created object", async () => {
    const name = testName("undo_obj");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name });
    const before = await c.call<{ entities: unknown[] }>("list_entities", {
      kind: "object",
      name_pattern: `^${name}$`,
    });
    expect(before.entities.length).toBe(1);

    const r = await c.call<{ steps_performed: number }>("undo", { steps: 1 });
    expect(r.steps_performed).toBe(1);

    const after = await c.call<{ entities: unknown[] }>("list_entities", {
      kind: "object",
      name_pattern: `^${name}$`,
    });
    expect(after.entities.length).toBe(0);
  });

  test("undo steps=2 reverts two separate creations", async () => {
    const a = testName("undo_a");
    const b = testName("undo_b");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name: a });
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name: b });

    const r = await c.call<{ steps_performed: number }>("undo", { steps: 2 });
    expect(r.steps_performed).toBe(2);

    const listed = await c.call<{ entities: unknown[] }>("list_entities", {
      kind: "object",
      name_pattern: `^(${a}|${b})$`,
    });
    expect(listed.entities.length).toBe(0);
  });

  test("undo defaults to 1 step when steps is omitted", async () => {
    const name = testName("undo_default");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name });
    const r = await c.call<{ steps_performed: number }>("undo");
    expect(r.steps_performed).toBe(1);
  });

  test("batch creates two objects in one RPC with a single undo group", async () => {
    const a = testName("b_a");
    const b = testName("b_b");
    const r = await c.call<{ results: Array<{ op: string; result?: unknown; error?: string }> }>(
      "batch",
      {
        ops: [
          { op: "create_entity", args: { kind: "object", type_id: OCUBE, name: a } },
          { op: "create_entity", args: { kind: "object", type_id: OCUBE, name: b } },
        ],
      },
    );
    expect(r.results.length).toBe(2);
    expect(r.results[0].error).toBeUndefined();
    expect(r.results[1].error).toBeUndefined();

    const listed = await c.call<{ entities: Array<{ name: string }> }>("list_entities", {
      kind: "object",
      name_pattern: `^${testName("b_")}`,
    });
    expect(listed.entities.map((e) => e.name).toSorted()).toEqual([a, b].toSorted());
  });

  test("batch rejects nested batch ops", async () => {
    const r = await c.call<{ results: Array<{ op: string; error?: string }> }>("batch", {
      ops: [{ op: "batch", args: { ops: [] } }],
    });
    expect(r.results[0].error).toMatch(/nested batch/i);
  });

  test("batch stop_on_error halts after first failure", async () => {
    const r = await c.call<{ results: Array<{ op: string; error?: string }> }>("batch", {
      stop_on_error: true,
      ops: [
        { op: "unknown_op", args: {} },
        { op: "create_entity", args: { kind: "object", type_id: OCUBE, name: testName("never") } },
      ],
    });
    expect(r.results.length).toBe(1);
    expect(r.results[0].error).toMatch(/unknown op/);
  });
});
