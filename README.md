# cinema4d-mcp

[![CI](https://github.com/kumoproductions/mcp-cinema4d/actions/workflows/ci.yml/badge.svg)](https://github.com/kumoproductions/mcp-cinema4d/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D24-informational)](package.json)
[![Cinema 4D](https://img.shields.io/badge/Cinema%204D-%3E%3D2026.0.0-informational)](https://www.maxon.net/en/cinema-4d)

Let an LLM drive Cinema 4D. **cinema4d-mcp** bridges MCP-compatible clients (Claude Desktop, Claude Code, or any other stdio-capable MCP client) to a running Cinema 4D 2026 session so the model can inspect scene hierarchy, author shots, build node materials, and rig animation through a typed, undo-safe tool layer — not arbitrary Python pasted into a Script Manager.

**Good for:**

- **Scene audits** — "List every object on the `hero` layer; flag any with non-uniform scale or missing Texture tags."
- **Shot setup** — "Create a 1920×1080 RenderData, a camera at (0, 150, -400), and a Take that uses both."
- **Material work** — "Build a Redshift node material with a noise texture driving roughness at 0.4 gain."
- **Procedural edits** — "On every Subdivision Surface in the scene, reduce editor/render levels by 1."
- **Xpresso rigs** — "Build a 3-gear meshing rig where the master gear's pitch radius dynamically drives the others' size and counter-rotation via an Xpresso graph."

> [!CAUTION]
> **Do not proceed unless you understand what this does.** An LLM with a live connection to Cinema 4D can read your scene, write to it, and (if you opt in) execute arbitrary code on your machine. In concrete terms:
>
> 1. **Your scene data leaves your machine.** Object names, hierarchy paths, material/parameter values, imported file paths — whatever the LLM reads via `list_entities` / `describe` / `get_container` / `dump_shader` / `get_mesh` — is forwarded to your chosen LLM provider and may be logged by your MCP client. **Under NDA or on unreleased IP? Confirm with your studio/legal team first** that the provider's retention policy and your client's logs are acceptable.
> 2. **The LLM gets write access.** It can create, mutate, and delete objects, tags, materials, takes, render data, and layers; import / merge / open / save files; and render. Ctrl/Cmd-Z covers most edits — `save_document`, `open_document`, `render`, and some `call_command` invocations do not.
> 3. **Arbitrary Python is off by default.** `exec_python` runs unrestricted code with the full authority of the Cinema 4D process (file I/O, subprocess, network). Enabled only when `C4D_MCP_ENABLE_EXEC_PYTHON=1` is set on **both** sides; turn it back off when you no longer need it. The same applies to plugin types that store Python source in their container — Python tag, Python generator, MoGraph Python effector, Python field, and the Xpresso Python operator. Creating or editing them is gated behind a separate `C4D_MCP_ENABLE_PYTHON_OPS=1` opt-in, since their code parameter is RCE-equivalent to `exec_python`.
>
> Before first use: back up (or commit) your scene, start on a throwaway project, and leave your MCP client's per-call approval prompts enabled. See [Security](#security) before exposing the bridge beyond loopback.

---

## Architecture

```
MCP client
   ↓ stdio
MCP server  (this repo, Node.js)
   ↓ TCP, JSON Lines (default 127.0.0.1:18710)
cinema4d_mcp_bridge  (Python plugin inside C4D)
   ↓
Cinema 4D
```

Two pieces to install: the **MCP server** (this npm package, runs as an MCP stdio process) and the **bridge plugin** (Python, lives inside Cinema 4D). C4D must be running for the bridge to respond.

## Quickstart

Assuming you already have Cinema 4D 2026.0.0+ and Node.js 24+.

1. **Install the bridge plugin into Cinema 4D (one-off).** Download the latest
   `cinema4d_mcp_bridge-<version>.zip` from the
   [Releases page](https://github.com/kumoproductions/mcp-cinema4d/releases/latest)
   and extract the `cinema4d_mcp_bridge/` folder into your Cinema 4D plugins
   directory (see [Installing the bridge plugin](#installing-the-bridge-plugin)
   for platform-specific paths).
2. **Launch (or restart) Cinema 4D.** The C4D console should print
   `[cinema4d_mcp_bridge] listening on 127.0.0.1:18710`.
3. **Smoke-test the MCP server from the CLI:**

   ```bash
   echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ping","arguments":{}}}' \
     | npx -y @kumoproductions/mcp-cinema4d
   #   → {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\"pong\": true, ...}"}]}}
   ```

Then wire it into your MCP client (see [Client configuration](#client-configuration)) and try:

> _"List every object in the scene, then add a cube named `hero` 200 units above the origin."_

The LLM will call `list_entities` → `create_entity` in sequence; you should see a new cube appear in the viewport.

Prefer running from a local checkout? See [CONTRIBUTING.md](./CONTRIBUTING.md) for the source-install flow.

## Client configuration

Generate a random token and set it on **both** the MCP server process (via the client's `env` map, below) and the Cinema 4D launch environment. The bridge rejects mismatched requests (constant-time compare); the Node client forwards the value automatically. Strongly recommended — localhost is not a trust boundary on a shared workstation.

```bash
openssl rand -hex 16
```

Register the MCP server in your client with the token in the `env` map:

```json
{
  "mcpServers": {
    "cinema4d": {
      "command": "npx",
      "args": ["-y", "@kumoproductions/mcp-cinema4d"],
      "env": {
        "C4D_MCP_TOKEN": "paste-your-random-hex-here"
      }
    }
  }
}
```

| Client                       | Config file                                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Claude Desktop / Claude Code | `%APPDATA%\Claude\claude_desktop_config.json` (Windows) · `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) |
| Other MCP clients            | see the client's docs for registering a stdio server                                                                                |

**The same `C4D_MCP_*` variables must also be set in the Cinema 4D launch environment** — the bridge plugin reads them at C4D startup. macOS: `open -a "Cinema 4D" --env C4D_MCP_TOKEN=...` (or export in your shell profile before launch). Windows: set as User environment variables and restart C4D.

To change the bridge socket, set `C4D_MCP_PORT` (and optionally `C4D_MCP_HOST` — see [Security](#security)) alongside `C4D_MCP_TOKEN` in the same `env` map, plus the C4D launch env.

## Tools

61 tools across 16 groups. The LLM picks tools itself based on the prompt — you rarely invoke them directly. See [docs/TOOLS.md](./docs/TOOLS.md) for the full table with per-tool descriptions.

| Group                            | Count | What's in it                                                                                                                                                                                                                       |
| -------------------------------- | :---: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Basics                           |   4   | `ping`, `render`, `preview_render` (Viewport renderer + Constant Lines, returns inline PNG), `reset_scene`.                                                                                                                        |
| Script-style                     |   5   | `exec_python` (opt-in), `call_command`, `list_plugins`, `undo`, `batch` — escape hatches + undo-grouped multi-op.                                                                                                                  |
| Generic CRUD                     |   9   | `list_entities`, `describe`, `get_params`/`set_params`, `get_container`, `dump_shader`, `create_entity`, `remove_entity`, `set_keyframe`.                                                                                          |
| Shot setup                       |   7   | Document state, fps / frame range / camera, `import_scene` (merge), RenderData + Take, `take_override`, `sample_transform`.                                                                                                        |
| Selection · Hierarchy            |   4   | Active selection read / write; reparent, reorder, clone.                                                                                                                                                                           |
| Modeling · Mesh                  |   4   | `modeling_command` (CSO / Make Editable / Connect / Subdivide / …), `get_mesh`, `set_mesh`, `set_mesh_selection`.                                                                                                                  |
| Document I/O                     |   3   | `save_document`, `open_document`, `new_document`.                                                                                                                                                                                  |
| Node graphs                      |  10   | Node-material graphs (walk / asset enum / `apply_graph_description` / per-port edits / removal) **and** Xpresso (GvNodeMaster) graphs (`list_xpresso_nodes` / `apply_xpresso_graph` / `set_xpresso_port` / `remove_xpresso_node`). |
| Tag helpers · Animation          |   5   | `assign_material`; `list_tracks`, `get_keyframes`, `delete_keyframe`, `delete_track`.                                                                                                                                              |
| Transforms · User data · MoGraph |   5   | `set_transform`; `add_user_data` / `list_user_data` / `remove_user_data`; `list_mograph_clones`.                                                                                                                                   |
| Layers                           |   5   | Enumerate, create, assign, query, flag toggles (solo / view / render / locked / …).                                                                                                                                                |

## Entity handles

Every CRUD tool identifies entities by a typed `handle` object. The resolver raises on ambiguous names — prefer `path` when a scene contains duplicates.

| Kind             | Shape                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `object`         | `{kind:"object", name:"Cube"}` **or** `{kind:"object", path:"/Root/Character/Hip"}`                                       |
| `render_data`    | `{kind:"render_data", name:"VFX_Shot002"}`                                                                                |
| `take`           | `{kind:"take", name:"VFX_Shot002"}`                                                                                       |
| `material`       | `{kind:"material", name:"Concrete"}`                                                                                      |
| `tag`            | `{kind:"tag", object:"Cube", type_id:1029524, tag_name?:"..."}` (or `object_path` instead of `object`)                    |
| `video_post`     | `{kind:"video_post", render_data:"VFX_Shot002", type_id:1029525}`                                                         |
| `shader`         | `{kind:"shader", owner:<handle>, name?:"Layer 0"}` **or** `{..., index:0}`                                                |
| `plugin_options` | `{kind:"plugin_options", plugin_id:"abc"\|1028082, plugin_type?:"scene_saver"}` — exporter / importer private settings BC |

`name` lookups are strict: if several entities share the name, the bridge returns an error listing up to five candidate paths so you can switch to a path-based handle. `create_entity` always returns the freshly-resolved handle (objects include `path`; shaders include both `name` and `index`) so chained edits stay stable.

## Installing the bridge plugin

Grab the latest `cinema4d_mcp_bridge-<version>.zip` from
[Releases](https://github.com/kumoproductions/mcp-cinema4d/releases/latest)
and extract the inner `cinema4d_mcp_bridge/` folder into your Cinema 4D plugins
directory:

| OS      | Typical plugins directory                                        |
| ------- | ---------------------------------------------------------------- |
| Windows | `%APPDATA%\Maxon\Maxon Cinema 4D <VERSION>\plugins\`             |
| macOS   | `~/Library/Preferences/Maxon/Maxon Cinema 4D <VERSION>/plugins/` |

You can also register a custom search path via Cinema 4D's `Preferences → Plugins → Add` and extract the zip there instead.

Launch (or restart) Cinema 4D after extracting. **The plugin only reloads when C4D restarts.**

Keep the plugin version pinned to the npm package version you run — a version mismatch surfaces as `unknown command: <tool>` in the bridge log. See [CONTRIBUTING.md](./CONTRIBUTING.md) if you want to run a development checkout instead.

> [!NOTE]
> **Official releases only come from two places:** the npm package [`@kumoproductions/mcp-cinema4d`](https://www.npmjs.com/package/@kumoproductions/mcp-cinema4d) and the GitHub Releases page under [kumoproductions/mcp-cinema4d](https://github.com/kumoproductions/mcp-cinema4d/releases). If you obtained a zip or a scoped npm package from anywhere else claiming to be this plugin, treat it as untrusted.

## Configuration

| Var                          | Side       | Default     | Notes                                                                                                                                                                                                                                                                         |
| ---------------------------- | ---------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `C4D_MCP_HOST`               | both       | `127.0.0.1` | Host for the TCP bridge. Legacy aliases: `C4D_BRIDGE_HOST` (Node), `C4D_MCP_BRIDGE_HOST` (plugin).                                                                                                                                                                            |
| `C4D_MCP_PORT`               | both       | `18710`     | Port for the TCP bridge. Legacy aliases: `C4D_BRIDGE_PORT`, `C4D_MCP_BRIDGE_PORT`.                                                                                                                                                                                            |
| `C4D_MCP_ENABLE_EXEC_PYTHON` | both       | unset       | **Opt-in.** Set to `1` (or `true`/`yes`/`on`) on both sides to expose the `exec_python` tool. See [Security](#security).                                                                                                                                                      |
| `C4D_MCP_ENABLE_PYTHON_OPS`  | C4D plugin | unset       | **Opt-in.** Set to `1` to allow creating / editing Python-bearing plugin types (Python tag, Python generator, MoGraph Python effector, Python field (Fpython, 440000277), Xpresso Python operator). Off by default — their code parameter is RCE-equivalent to `exec_python`. |
| `C4D_MCP_TOKEN`              | both       | unset       | Shared secret. When set on the C4D side, the Node client must send the same value. Strongly recommended.                                                                                                                                                                      |
| `C4D_MCP_ALLOW_REMOTE`       | C4D plugin | unset       | Required to bind `C4D_MCP_HOST` to a non-loopback interface. The bridge refuses to start otherwise.                                                                                                                                                                           |

## Security

Even without `exec_python`, many tools mutate state: `call_command`, `set_params`, `import_scene`, `render`, `remove_entity`, `save_document`, `open_document`, `new_document`. Treat the bridge like a local shell, not a sandbox.

- **`exec_python` is opt-in.** It runs unrestricted Python on Cinema 4D's main thread (file I/O, subprocess, network). Hidden and rejected by the bridge unless `C4D_MCP_ENABLE_EXEC_PYTHON=1` is set on **both** the MCP server process and the Cinema 4D process. Turn it back off when you no longer need it — set-and-forget is how accidents happen.
- **Python-bearing plugin types are opt-in too.** Python tag (`Tpython`), Python generator (`Opython`), MoGraph Python effector, Python field (`Fpython`), and the Xpresso Python operator all store caller-supplied source code in their container and run it on scene evaluation — i.e. they are RCE-equivalent to `exec_python`. The bridge refuses `create_entity`, `set_params`, `apply_xpresso_graph`, and `take_override` operations targeting these types unless `C4D_MCP_ENABLE_PYTHON_OPS=1` is set on the Cinema 4D side. Listing / reading / removing existing instances is unaffected.
- **Set a shared-secret token (`C4D_MCP_TOKEN`).** Localhost is not a trust boundary — any local process running as your user can otherwise connect. See [Client configuration](#client-configuration) for the JSON snippet.
- **Loopback default + remote opt-in.** The bridge binds to `127.0.0.1` by default. Binding `C4D_MCP_HOST` to a non-loopback interface **refuses to start** unless `C4D_MCP_ALLOW_REMOTE=1` is also set — guarding against a one-character typo (`0.0.0.0`) exposing C4D to the LAN.
- **Only connect MCP clients you trust.** Review their tool-use permissions so mutating tools (especially `exec_python` if opted in) are not auto-approved.
- **Indirect prompt injection via scene content.** Scene data (object names, parameter strings, imported file paths) flows back to the LLM through `list_entities` / `describe` / `get_container` / `dump_shader` / `get_mesh`. When `exec_python` is enabled, a malicious string in a scene can steer the model into running arbitrary Python. Don't run `import_scene` against untrusted `.c4d` / `.fbx` / `.abc` files while `exec_python` is on, and rely on your MCP client's per-call approval for `exec_python` / `call_command` / `save_document` / `import_scene` rather than blanket-approving them.
- **Audit log.** Every `exec_python` call records the code body to the local bridge log (`%TEMP%/cinema4d_mcp_bridge.log` on Windows, `$TMPDIR/cinema4d_mcp_bridge.log` on macOS) for after-the-fact review. The log is append-only with no rotation — prune it manually if it grows.

```bash
export C4D_MCP_TOKEN="$(openssl rand -hex 16)"   # set in C4D launch env too
npx -y @kumoproductions/mcp-cinema4d
```

## Troubleshooting

| Symptom                                                                     | Likely cause / fix                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Cannot connect to Cinema 4D bridge at 127.0.0.1:18710`                     | C4D isn't running, plugin didn't load, or a firewall is blocking localhost. Check the C4D console for the `listening on …` line and look at `%TEMP%/cinema4d_mcp_bridge.log` (Windows) / `$TMPDIR/cinema4d_mcp_bridge.log` (macOS).                    |
| Plugin loads but the `listening` line never prints                          | Usually a Python import error in `cinema4d_mcp_bridge.pyp`. Inspect the C4D console; common cause is leftover stale files from an older install — delete the destination folder and re-extract the latest release zip, then restart C4D.               |
| `listening on 127.0.0.1:18710` fails with `OSError: address already in use` | Another process already owns that port. Either quit it, or set both `C4D_MCP_PORT` (C4D side) **and** the same value on the MCP server launch command.                                                                                                 |
| `unknown command: <tool>`                                                   | Bridge plugin is older than the npm package. Download the matching release zip, re-extract it into your plugins folder, and restart C4D.                                                                                                               |
| `object name '…' is ambiguous`                                              | Two or more scene objects share the name. Use a path-based handle: `{kind:"object", path:"/A/B/C"}`. Candidate paths are included in the error.                                                                                                        |
| `exec_python is disabled on this C4D instance`                              | `exec_python` is off by default. Set `C4D_MCP_ENABLE_EXEC_PYTHON=1` in **both** the Cinema 4D launch environment **and** the MCP server `env` map, then restart C4D. See [Security](#security).                                                        |
| `requires C4D_MCP_ENABLE_PYTHON_OPS=1 …`                                    | You tried to create or edit a Python-bearing entity (Python tag, Python generator, MoGraph Python effector, Python field, Xpresso Python operator). Off by default. Set `C4D_MCP_ENABLE_PYTHON_OPS=1` in the Cinema 4D launch environment and restart. |

Still stuck? Open an [issue](https://github.com/kumoproductions/mcp-cinema4d/issues/new/choose) with the bridge log, your OS, Cinema 4D version, and the tool call that failed.

## Known limitations

- **`modeling_command make_editable` is unreliable on Cinema 4D 2026.** The SDK's `SendModelingCommand` handling of `MCOMMAND_MAKEEDITABLE` shifts across builds — sometimes it returns the new polygon object, sometimes it removes the source without inserting a replacement. **Use `current_state_to_object` instead** when you need a guaranteed polygon copy (the bridge inserts the result for you and returns its handle).
- **`list_graph_node_assets` can return an empty list** on builds where the Maxon asset repository doesn't expose node-template assets through the usual query path. The tool still returns `supported: true` with shape-correct output; treat an empty `assets` array as "discovery unavailable on this C4D build" and pass `$type` asset ids you already know (e.g. from `list_graph_nodes` on an existing material).
- **Node material friendly names vary.** `apply_graph_description` accepts the declarative `$type` strings documented by Maxon (e.g. `"Standard Material"`), but the resolver varies between 2024 / 2025 / 2026 builds — when in doubt, pass the fully-qualified asset id returned by `list_graph_node_assets` / `list_graph_nodes` instead.
- **`exec_python` is the only way to seed classical-shader fixtures.** A handful of E2E tests (for `dump_shader`) need to build a shader tree before asserting on it, so they skip cleanly when `C4D_MCP_ENABLE_EXEC_PYTHON` isn't set on both sides. The tools themselves don't require `exec_python`.
- **Older Cinema 4D versions are not tested.** The CI + E2E suite targets C4D 2026. The bridge guards optional SDK constants with `getattr` fallbacks, so most tools likely work on 2024 / 2025 as well — but we don't verify that and won't accept bug reports that don't reproduce on 2026.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, the development loop, how to add a new tool, coding style, and the PR flow.

## License

[MIT](./LICENSE) © 2026 kumo.productions, Inc.

## Trademarks

Cinema 4D® and Maxon® are trademarks of Maxon Computer GmbH. This project is an independent, unofficial tool, **not affiliated with or endorsed by Maxon**.
