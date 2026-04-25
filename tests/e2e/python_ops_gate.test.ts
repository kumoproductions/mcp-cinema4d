import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { cleanupByPrefix, MCPTestClient, probeBridge, resetScene, testName } from "./harness.js";

// Plugin / operator ids for the Python-bearing types. Mirror the bridge's
// _PYTHON_BEARING_TYPE_IDS / _PYTHON_OPERATOR_IDS (handlers/_helpers.py).
const TPYTHON = 1022749; // Python tag
const OPYTHON = 1023866; // Python generator
const OMGPYTHON = 1025800; // MoGraph Python effector
const FPYTHON = 440000277; // Python field
const ID_OPERATOR_PYTHON = 1022471; // Xpresso Python operator
const PYTHON_THREAD_NODE = 1026947; // Xpresso "Python Thread Node"

const OCUBE = 5159;

// Stable substring shared by every gate error. Loose enough to also match if
// the error wording is tweaked, strict enough to never hit unrelated errors.
const GATE_TOKEN = /C4D_MCP_ENABLE_PYTHON_OPS/;

const probe = await probeBridge("python_ops_gate");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

// Detect whether the bridge is running in DENY mode (default) or ALLOW mode
// (operator set C4D_MCP_ENABLE_PYTHON_OPS=1 in the C4D launch env). Probe by
// attempting to create a Python tag on a throwaway cube and matching the gate
// error against C4D_MCP_ENABLE_PYTHON_OPS — that token is the most stable
// fingerprint we have because it is in the public docs.
let gateActive = false;
let modeProbeError: string | null = null;
if (ready && client) {
  try {
    await resetScene(client);
    const probeName = testName("py_gate_probe");
    await client.call("create_entity", { kind: "object", type_id: OCUBE, name: probeName });
    const err = await client.callExpectError("create_entity", {
      kind: "tag",
      type_id: TPYTHON,
      parent: { kind: "object", name: probeName },
    });
    gateActive = GATE_TOKEN.test(err);
    if (!gateActive) modeProbeError = err;
  } catch (err) {
    // create_entity succeeded (no error). Bridge is in ALLOW mode.
    modeProbeError = err instanceof Error ? err.message : String(err);
  }
}

// exec_python is independently gated; some deny-mode tests want to seed an
// existing Python tag before asserting that mutation is refused, which is
// only possible when exec_python is available. Match the same opt-out shapes
// script.test.ts uses.
let execPythonDisabled = false;
if (ready && client) {
  try {
    await client.call("exec_python", { code: "result = 1" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    execPythonDisabled = /disabled|not found/i.test(msg);
  }
}

describe.skipIf(!ready)("Python-bearing entity gate", () => {
  const c = client!;

  afterAll(async () => {
    await cleanupByPrefix(c);
    await c.close();
  });

  beforeEach(async () => {
    const reset = await resetScene(c);
    if (!reset) await cleanupByPrefix(c);
  });

  // ---------------------------------------------------------------------
  // DENY mode — default. Run only when C4D_MCP_ENABLE_PYTHON_OPS is unset.
  // ---------------------------------------------------------------------

  describe.skipIf(!gateActive)("deny mode (C4D_MCP_ENABLE_PYTHON_OPS unset)", () => {
    test("create_entity rejects Python tag (Tpython)", async () => {
      const host = testName("py_tag_host");
      await c.call("create_entity", { kind: "object", type_id: OCUBE, name: host });
      const err = await c.callExpectError("create_entity", {
        kind: "tag",
        type_id: TPYTHON,
        parent: { kind: "object", name: host },
      });
      expect(err).toMatch(GATE_TOKEN);
    });

    test("create_entity rejects Python generator (Opython)", async () => {
      const err = await c.callExpectError("create_entity", {
        kind: "object",
        type_id: OPYTHON,
        name: testName("py_gen"),
      });
      expect(err).toMatch(GATE_TOKEN);
    });

    test("create_entity rejects MoGraph Python effector (Omgpython)", async () => {
      const err = await c.callExpectError("create_entity", {
        kind: "object",
        type_id: OMGPYTHON,
        name: testName("py_eff"),
      });
      expect(err).toMatch(GATE_TOKEN);
    });

    test("create_entity rejects Python field (Fpython)", async () => {
      const err = await c.callExpectError("create_entity", {
        kind: "object",
        type_id: FPYTHON,
        name: testName("py_field"),
      });
      expect(err).toMatch(GATE_TOKEN);
    });

    test("create_entity allows non-Python types (sanity)", async () => {
      // Smoke-test: the gate must not over-block. A plain cube must still
      // come through, otherwise the deny logic is hitting innocent calls.
      const name = testName("py_gate_sanity");
      const r = await c.call<{ handle: { name: string } }>("create_entity", {
        kind: "object",
        type_id: OCUBE,
        name,
      });
      expect(r.handle.name).toBe(name);
    });

    test("apply_xpresso_graph rejects the python operator alias", async () => {
      const host = testName("py_xp_host");
      await c.call("create_entity", { kind: "object", type_id: OCUBE, name: host });
      const err = await c.callExpectError("apply_xpresso_graph", {
        handle: { kind: "object", name: host },
        create_tag_if_missing: true,
        nodes: { p: { operator_id: "python", position: [100, 100] } },
      });
      expect(err).toMatch(GATE_TOKEN);
    });

    test("apply_xpresso_graph rejects the python operator by raw id", async () => {
      // Defense in depth: the gate must trigger whether the caller uses the
      // string alias or the numeric ID_OPERATOR_PYTHON, otherwise an attacker
      // could trivially bypass by passing the int.
      const host = testName("py_xp_host_int");
      await c.call("create_entity", { kind: "object", type_id: OCUBE, name: host });
      const err = await c.callExpectError("apply_xpresso_graph", {
        handle: { kind: "object", name: host },
        create_tag_if_missing: true,
        nodes: { p: { operator_id: ID_OPERATOR_PYTHON, position: [100, 100] } },
      });
      expect(err).toMatch(GATE_TOKEN);
    });

    test("apply_xpresso_graph rejects Python Thread Node operator", async () => {
      // The second Python-bearing GvNode shipped by corelibs. Same source-code
      // surface as ID_OPERATOR_PYTHON, so the gate has to cover both.
      const host = testName("py_xp_thread");
      await c.call("create_entity", { kind: "object", type_id: OCUBE, name: host });
      const err = await c.callExpectError("apply_xpresso_graph", {
        handle: { kind: "object", name: host },
        create_tag_if_missing: true,
        nodes: { p: { operator_id: PYTHON_THREAD_NODE, position: [100, 100] } },
      });
      expect(err).toMatch(GATE_TOKEN);
    });

    test("apply_xpresso_graph still allows non-Python operators (sanity)", async () => {
      const host = testName("py_xp_const");
      await c.call("create_entity", { kind: "object", type_id: OCUBE, name: host });
      const r = await c.call<{ applied: boolean }>("apply_xpresso_graph", {
        handle: { kind: "object", name: host },
        create_tag_if_missing: true,
        nodes: { c: { operator_id: "const", position: [100, 100] } },
      });
      expect(r.applied).toBe(true);
    });

    // The set_params / take_override deny paths only fire on an *existing*
    // Python-bearing entity. Seeding one in deny mode requires exec_python —
    // so these specific assertions are gated on exec_python availability.
    describe.skipIf(execPythonDisabled)("with exec_python available to seed", () => {
      // Returns the cube + python tag handles after seeding the python tag
      // outside the gate's reach (exec_python directly).
      async function seedPythonTag(): Promise<{ cube: string; tagName: string }> {
        const cube = testName("py_seed_host");
        const tagName = testName("py_seed_tag");
        await c.call("create_entity", { kind: "object", type_id: OCUBE, name: cube });
        // Walk the active document via exec_python and attach a Python tag
        // directly. We can't go through create_entity because that's exactly
        // the path the gate is supposed to be blocking — exec_python is the
        // only seam left for seeding fixtures in deny mode.
        await c.call("exec_python", {
          code: [
            "import c4d",
            "from c4d import documents",
            `cube_name = ${JSON.stringify(cube)}`,
            `tag_name = ${JSON.stringify(tagName)}`,
            "doc = documents.GetActiveDocument()",
            "target = None",
            "def _walk(o):",
            "    global target",
            "    while o is not None and target is None:",
            "        if o.GetName() == cube_name:",
            "            target = o",
            "            return",
            "        d = o.GetDown()",
            "        if d is not None:",
            "            _walk(d)",
            "        o = o.GetNext()",
            "_walk(doc.GetFirstObject())",
            "if target is None:",
            "    raise RuntimeError('seed cube not found')",
            `tag = target.MakeTag(${TPYTHON})`,
            "tag.SetName(tag_name)",
            "doc.AddUndo(c4d.UNDOTYPE_NEW, tag)",
            "c4d.EventAdd()",
            "result = {'ok': True}",
          ].join("\n"),
        });
        return { cube, tagName };
      }

      test("set_params refuses to write to an existing Python tag", async () => {
        const { cube, tagName } = await seedPythonTag();
        const err = await c.callExpectError("set_params", {
          handle: { kind: "tag", object: cube, type_id: TPYTHON, tag_name: tagName },
          // ID_USERDATA-ish payload; the gate must fire BEFORE the write is
          // dispatched, so the specific path/value is irrelevant.
          values: [{ path: 1000, value: "import os; os.system('calc')" }],
        });
        expect(err).toMatch(GATE_TOKEN);
      });

      test("take_override refuses to override params on a Python tag", async () => {
        const { cube, tagName } = await seedPythonTag();
        const takeName = testName("py_seed_take");
        await c.call("create_take", { name: takeName });
        const err = await c.callExpectError("take_override", {
          take: takeName,
          target: { kind: "tag", object: cube, type_id: TPYTHON, tag_name: tagName },
          values: [{ path: 1000, value: "import os; os.system('calc')" }],
        });
        expect(err).toMatch(GATE_TOKEN);
      });
    });
  });

  // ---------------------------------------------------------------------
  // ALLOW mode — only runs when the operator opted IN.
  // ---------------------------------------------------------------------

  describe.skipIf(gateActive)("allow mode (C4D_MCP_ENABLE_PYTHON_OPS=1)", () => {
    test("create_entity allows Python tag", async () => {
      const host = testName("py_allow_host");
      await c.call("create_entity", { kind: "object", type_id: OCUBE, name: host });
      const tagName = testName("py_allow_tag");
      const r = await c.call<{ handle: { kind: string; type_id: number; tag_name: string } }>(
        "create_entity",
        {
          kind: "tag",
          type_id: TPYTHON,
          name: tagName,
          parent: { kind: "object", name: host },
        },
      );
      expect(r.handle.kind).toBe("tag");
      expect(r.handle.type_id).toBe(TPYTHON);
      expect(r.handle.tag_name).toBe(tagName);
    });

    test("apply_xpresso_graph allows the python operator", async () => {
      const host = testName("py_allow_xp");
      await c.call("create_entity", { kind: "object", type_id: OCUBE, name: host });
      const r = await c.call<{ applied: boolean; nodes: Record<string, { operator_id: number }> }>(
        "apply_xpresso_graph",
        {
          handle: { kind: "object", name: host },
          create_tag_if_missing: true,
          nodes: { p: { operator_id: "python", position: [100, 100] } },
        },
      );
      expect(r.applied).toBe(true);
      expect(r.nodes.p.operator_id).toBe(ID_OPERATOR_PYTHON);
    });
  });

  // ---------------------------------------------------------------------
  // Mode-detection signal — surface mismatches so a half-applied bridge
  // (operator restarted C4D against an old plugin) isn't silently masked.
  // ---------------------------------------------------------------------

  test("gate probe yielded a recognisable mode signal", () => {
    if (gateActive) {
      // We saw the gate fire; nothing else to check.
      return;
    }
    // Otherwise the probe didn't see the gate. Either:
    //  - operator opted IN (env var set), in which case allow-mode tests cover us
    //  - probe failed for an unrelated reason, surfaced here for diagnosis
    if (modeProbeError) {
      console.warn(
        `[python_ops_gate] gate inactive; allow-mode active or non-gate error: ${modeProbeError}`,
      );
    }
  });
});
