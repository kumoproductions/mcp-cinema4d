# Contributing to cinema4d-mcp

Thanks for your interest. This project connects Cinema 4D to MCP clients (Claude Desktop / Claude Code and any other stdio-capable MCP client) through a TypeScript server and a Python bridge plugin. Most contributions will touch either the TS tool definitions, the Python handlers that run inside C4D, or both.

## Prerequisites

- **Node.js** >= 24
- **Cinema 4D** >= 2026.0.0 — required only when running E2E tests
- **[uv](https://docs.astral.sh/uv/)** on PATH — provides `uvx` for ruff
- **Git** with `core.autocrlf` unset or set to `input` (repo enforces LF via `.gitattributes`)

```bash
git clone https://github.com/kumoproductions/mcp-cinema4d.git
cd cinema4d-mcp
npm install        # also runs `lefthook install`
npm run build
```

### Linking the bridge plugin for development

For local iteration, symlink `plugin/cinema4d_mcp_bridge/` into your Cinema 4D
plugins folder so Python edits propagate without manual copying. The plugin
still only reloads when Cinema 4D restarts.

```bash
# macOS / Linux
ln -s "$(pwd)/plugin/cinema4d_mcp_bridge" \
  "$HOME/Library/Preferences/Maxon/Maxon Cinema 4D <VERSION>/plugins/cinema4d_mcp_bridge"
```

```cmd
:: Windows (cmd, admin not required for directory junctions)
mklink /J "%APPDATA%\Maxon\Maxon Cinema 4D <VERSION>\plugins\cinema4d_mcp_bridge" ^
  "%CD%\plugin\cinema4d_mcp_bridge"
```

Alternatively, register the repo's `plugin/` folder via Cinema 4D's
`Preferences → Plugins → Add` and skip the symlink.

### Pointing a local MCP client at your checkout

While iterating, point your MCP client at the freshly-built `dist/index.js`
instead of the published npm package:

```json
{
  "mcpServers": {
    "cinema4d": {
      "command": "node",
      "args": ["/absolute/path/to/cinema4d-mcp/dist/index.js"]
    }
  }
}
```

## Development loop

| Task                        | Command              |
| --------------------------- | -------------------- |
| Build the TS server         | `npm run build`      |
| Type-check without emitting | `npm run typecheck`  |
| Lint TS/JS                  | `npm run lint`       |
| Auto-fix TS/JS lint         | `npm run lint:fix`   |
| Format TS/JS/JSON/MD/YAML   | `npm run format`     |
| Lint Python                 | `npm run lint:py`    |
| Format Python               | `npm run format:py`  |
| **Run every static check**  | `npm run check`      |
| E2E against live C4D        | `npm test`           |
| E2E in watch mode           | `npm run test:watch` |

`npm run check` is what CI runs on every PR. Run it locally before pushing.

Pre-commit hooks (via [lefthook](https://lefthook.dev/)) automatically run `oxlint`, `oxfmt --check`, `ruff check`, `ruff format --check`, and a CRLF guard on staged files. They install themselves during `npm install`.

### Running E2E tests

End-to-end tests in `tests/e2e/` exercise the full stack: Vitest spawns the compiled MCP server, the server talks to a **real** Cinema 4D instance through the bridge plugin, and each tool's behaviour is asserted against the scene.

1. Cinema 4D is running with the `cinema4d_mcp_bridge` plugin loaded.
2. An empty document is open.
3. The MCP server is built (`npm run build`).

```bash
npm test            # one-shot
npm run test:watch  # iterate while C4D stays open
```

If the bridge is unreachable the suite prints a visible skip banner and exits cleanly — CI without C4D treats it as a no-op.

## Main-thread constraint

Cinema 4D's scene API is main-thread-only. The Python bridge accepts socket requests on a listener thread, queues them, and drains the queue from a `CoreMessage` handler (kicked by `c4d.SpecialEventAdd`) that runs on C4D's main thread. Any handler you write can call `c4d.*` freely — you are already on the main thread by the time the dispatcher invokes it.

## Wire protocol (Node ↔ Python)

Newline-delimited JSON on the TCP socket. One request or response per line.

```jsonl
// request
{"id": "uuid", "command": "list_entities", "params": {"kind": "object"}}

// response
{"id": "uuid", "status": "ok", "result": { ... }}
{"id": "uuid", "status": "error", "error": "..."}
```

When `C4D_MCP_TOKEN` is set, the Node client adds `"token": "<value>"` to every request and the bridge rejects mismatches via `hmac.compare_digest`.

## How the code fits together

```
src/                         TypeScript MCP server
├── index.ts                 Stdio entry, tool registration, env wiring
├── c4d-client.ts            TCP client — framed JSON-lines to the bridge
└── tools/
    ├── define-tool.ts       defineTool() + textResult() helpers
    ├── handle.ts            handleSchema (object / tag / shader / …)
    └── *.ts                 one file per MCP tool

plugin/cinema4d_mcp_bridge/  Python plugin that runs inside C4D
├── cinema4d_mcp_bridge.pyp  Entry point — registers MessageData, starts TCP
└── bridge/
    ├── server.py            TCP accept/read/write threads
    ├── dispatcher.py        Main-thread queue; cancellation + timeout
    ├── log.py               Thread-safe log to stdout + temp file
    └── handlers/            Command handlers (each MCP tool = 1 handler)

tests/e2e/                   Vitest suites against a live C4D
├── harness.ts               MCP stdio client + scene reset helpers
└── *.test.ts                grouped by theme
```

## Adding a new MCP tool

The most common contribution. Four files, no framework gymnastics.

1. **Python handler** in `plugin/cinema4d_mcp_bridge/bridge/handlers/<area>.py`:
   ```python
   def handle_my_tool(params: dict[str, Any]) -> dict[str, Any]:
       # Runs on C4D's main thread — call any c4d API freely.
       ...
       return {"result": ...}  # must be JSON-serializable
   ```
2. **Register** the handler in `plugin/cinema4d_mcp_bridge/bridge/handlers/__init__.py` under the `HANDLERS` dict.
3. **TypeScript tool** in `src/tools/my-tool.ts`:
   ```ts
   export const myTool = defineTool({
     name: "my_tool",
     title: "My Tool",
     description: "What it does, plus examples that help an LLM pick it.",
     inputShape: {
       /* zod schema */
     },
     async handler(args, client) {
       return textResult(await client.request("my_tool", args, 15_000));
     },
   });
   ```
4. **List** it in `src/tools/index.ts`'s `ALL_TOOLS`.

Then:

- `npm run build` — verifies types.
- **Restart** Cinema 4D to reload the plugin. If you symlinked `plugin/cinema4d_mcp_bridge/` into the plugins folder (see [Linking the bridge plugin for development](#linking-the-bridge-plugin-for-development)) edits propagate automatically; otherwise re-copy the folder first.
- Add an E2E test in `tests/e2e/` that exercises the round-trip.

### Handle conventions

Entities are identified by typed `handle` objects (`{ kind: "object", name | path }`, etc.). Resolution raises on ambiguous names — always include `path` in returned handles when you create something. See `plugin/cinema4d_mcp_bridge/bridge/handlers/_helpers.py::_resolve_handle` for the canonical list.

### Undo groups

Mutating handlers must wrap themselves in `doc.StartUndo() / doc.EndUndo()` and call `doc.AddUndo(c4d.UNDOTYPE_*, obj)` so Cmd/Ctrl-Z works for the user. `batch` wraps everything it invokes in one outer undo group.

### Parameter application

Use the shared `_apply_params(obj, values)` helper — it already handles `list[3] → c4d.Vector` coercion.

## Writing tests

- Tests target a **real running Cinema 4D**. The probe checks connectivity; if C4D is down the whole suite skips with a clear banner (no false failures).
- Use the `e2e_` prefix (via `testName()`) for everything you create so `cleanupByPrefix` can remove stragglers.
- `resetScene()` clears objects, materials, non-active render data, and non-main takes via `exec_python`. If your test needs something specific untouched, clean up in `afterEach` yourself.
- Keep assertions focused on tool-observable behavior rather than C4D internal state.

## Coding style

- **TypeScript**: oxlint (correctness=error, suspicious/perf=warn) + oxfmt. Prefer `async`/`await` over callbacks. Narrow types where practical; `any` is allowed but flagged-for-review.
- **Python**: ruff with `E/F/W/I/B/UP/C4/SIM/RUF`. Target `py311` (C4D's bundled interpreter). Use `from __future__ import annotations`, PEP 604 unions (`X | None`), `contextlib.suppress` over bare `except: pass`.
- **Line endings**: LF. `.gitattributes` enforces, lefthook double-checks. If a commit is blocked by `CRLF detected`, run `git add --renormalize .` or configure `git config --global core.autocrlf input`.
- **Comments**: Describe _why_, not _what_. Don't narrate obvious code.

## Commit / PR flow

- Branch from `main`. One focused change per PR.
- Commit messages: imperative mood, present tense ("Add shader slot handler" not "Added …"). First line ≤ 72 chars. Body optional.
- Keep the PR description tight: what changed, why, how it was tested.
- CI must be green before review. If you can't run E2E locally (no C4D), say so in the PR — reviewers will help verify on a real instance.

## Plugin ID

`PLUGIN_ID = 1068169` in `cinema4d_mcp_bridge.pyp` is the Maxon-registered id for this project (issued via [plugincafe.maxon.net](https://plugincafe.maxon.net/)). If you fork this repo and plan to redistribute builds under your own name, request your own id rather than reusing this one.

## Reporting issues / feature requests

Use the GitHub issue templates. Please include:

- Cinema 4D version (menu → Help → About)
- OS and Node.js version
- MCP client (Claude Desktop / Claude Code / other) and its version
- The exact tool call that failed, and the bridge log
  (`%TEMP%/cinema4d_mcp_bridge.log` on Windows, `$TMPDIR/cinema4d_mcp_bridge.log` on macOS)

## License

By contributing you agree that your contributions are licensed under the MIT license of this project.
