# mcp-cinema4d

[English](README.md)

让 LLM 驱动 Cinema 4D。**mcp-cinema4d** 将兼容 MCP 的客户端（Claude Desktop、Claude Code 或其他支持 stdio 的 MCP 客户端）连接到正在运行的 Cinema 4D 2026 会话。模型可通过有类型、支持撤销的工具层检查场景层级、创建镜头、构建节点材质和绑定动画，而不是把任意 Python 粘贴到 Script Manager。

**适合：**场景审计、镜头设置、Redshift 节点材质、程序化批量编辑和 Xpresso 绑定。

> [!CAUTION]
> **请在理解其作用后再继续。**连接中的 LLM 可读取和修改场景，并且在你明确开启后，能在电脑上执行任意代码。
>
> 1. **场景数据会离开电脑。**对象名称、层级路径、材质与参数、导入文件路径等，通过 `list_entities`、`describe`、`get_container`、`dump_shader` 或 `get_mesh` 被读取的数据，会发往你选择的 LLM 服务商，并可能被 MCP 客户端记录。涉及保密协议或未发布项目时，请先确认工作室、法务与服务商的政策。
> 2. **LLM 有写入权限。**它可创建、修改和删除对象、标签、材质、Take、渲染数据和图层，也可导入、合并、打开、保存文件和渲染。大多数编辑可用 Ctrl/Cmd-Z 撤销，但 `save_document`、`open_document`、`render` 与部分 `call_command` 不能保证如此。
> 3. **任意 Python 默认关闭。**`exec_python` 具备 Cinema 4D 进程的完整权限。只有 MCP server 与 C4D 两端都设置 `C4D_MCP_ENABLE_EXEC_PYTHON=1` 才会启用；不需要时应立即关闭。Python tag、Python generator、MoGraph Python effector、Python field 与 Xpresso Python operator 也需要单独设置 `C4D_MCP_ENABLE_PYTHON_OPS=1`。
>
> 初次使用前，请备份或提交场景、在临时项目中测试，并保留 MCP 客户端的逐次授权提示。

## 架构

```
MCP client
   ↓ stdio
MCP server（本仓库，Node.js）
   ↓ TCP，JSON Lines（默认 127.0.0.1:18710）
cinema4d_mcp_bridge（C4D 内的 Python plugin）
   ↓ Cinema 4D
```

需要安装两部分：**MCP server**（本 npm 包，以 MCP stdio 进程运行）和 **bridge plugin**（位于 Cinema 4D 内的 Python 插件）。C4D 必须正在运行，bridge 才会响应。

## 快速开始

前提：Cinema 4D 2026.0.0+ 与 Node.js 24+。

1. 从 [Releases](https://github.com/kumoproductions/mcp-cinema4d/releases/latest) 下载最新的 `cinema4d_mcp_bridge-<version>.zip`，把其中的 `cinema4d_mcp_bridge/` 文件夹解压到 Cinema 4D plugins 目录。
2. 启动或重启 Cinema 4D；控制台应显示 `[cinema4d_mcp_bridge] listening on 127.0.0.1:18710`。
3. 从 CLI 冒烟测试 MCP server：

   ```bash
   echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ping","arguments":{}}}' \
     | npx -y @kumoproductions/mcp-cinema4d
   ```

然后在 MCP 客户端中注册它，并尝试：

> “列出场景中的每个对象，再在原点上方 200 个单位创建一个名为 `hero` 的立方体。”

LLM 会依次调用 `list_entities` 和 `create_entity`，视图中将出现新的立方体。希望从本地源码运行，请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 客户端配置

生成随机 token，并同时在 MCP server 进程（客户端的 `env`）和 Cinema 4D 启动环境中设置它。bridge 会拒绝 token 不匹配的请求；即使仅使用 localhost，在共享工作站上也强烈建议这样做。

```bash
openssl rand -hex 16
```

在客户端注册 MCP server：

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

| 客户端                       | 配置文件                                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Claude Desktop / Claude Code | Windows：`%APPDATA%\Claude\claude_desktop_config.json`；macOS：`~/Library/Application Support/Claude/claude_desktop_config.json` |
| 其他 MCP 客户端              | 请查看该客户端如何注册 stdio server 的文档                                                                                       |

相同的 `C4D_MCP_*` 变量也必须在 Cinema 4D 启动环境中设置，因为 bridge 在 C4D 启动时读取它们。Windows 可将其设为用户环境变量后重启 C4D；macOS 可在启动前导出变量。需要更换 socket 时，同时设置 `C4D_MCP_PORT`，也可设置 `C4D_MCP_HOST`。

## 工具

共有 64 个工具，分为 16 组。LLM 会按提示自行选择，通常无需手动调用。完整逐项说明见 [docs/TOOLS.md](./docs/TOOLS.md)。

| 分组                             | 数量 | 内容                                                                     |
| -------------------------------- | :--: | ------------------------------------------------------------------------ |
| Basics                           |  4   | `ping`、`render`、`preview_render`、`reset_scene`                        |
| Script-style                     |  5   | `exec_python`（需开启）、`call_command`、`list_plugins`、`undo`、`batch` |
| Generic CRUD                     |  9   | `list_entities`、`describe`、参数与容器读取/设置、创建/移除实体、关键帧  |
| Shot setup                       |  7   | 文档状态、fps、帧范围、相机、导入、RenderData、Take                      |
| Selection / Hierarchy            |  4   | 选择、重新设父级、排序、克隆                                             |
| Modeling / Mesh                  |  4   | 建模命令、网格读写、网格选择                                             |
| Document I/O                     |  6   | 保存、打开、新建、列出、切换与关闭文档                                   |
| Node graphs                      |  10  | 节点材质与 Xpresso 图                                                    |
| Tags / Animation                 |  5   | 材质指定、轨道与关键帧                                                   |
| Transforms / User data / MoGraph |  5   | 变换、用户数据、MoGraph clones                                           |
| Layers                           |  5   | 图层枚举、创建、指定、查询与开关                                         |

## Entity handles

CRUD 工具使用有类型的 `handle` 对象识别实体。场景中若有同名对象，建议优先使用 `path`；解析器会对歧义名称报错。

| 类型          | 示例                                                                            |
| ------------- | ------------------------------------------------------------------------------- |
| `object`      | `{kind:"object", name:"Cube"}` 或 `{kind:"object", path:"/Root/Character/Hip"}` |
| `render_data` | `{kind:"render_data", name:"VFX_Shot002"}`                                      |
| `take`        | `{kind:"take", name:"VFX_Shot002"}`                                             |
| `material`    | `{kind:"material", name:"Concrete"}`                                            |
| `tag`         | `{kind:"tag", object:"Cube", type_id:1029524, tag_name?:"..."}`                 |
| `video_post`  | `{kind:"video_post", render_data:"VFX_Shot002", type_id:1029525}`               |
| `shader`      | `{kind:"shader", owner:<handle>, name?:"Layer 0"}` 或 `{..., index:0}`          |

`name` 查找很严格：若多个实体同名，bridge 会返回最多五个候选路径；此时请改用路径 handle。`create_entity` 会返回刚解析出的 handle，让连续编辑更稳定。

## 安装 bridge plugin

从 [Releases](https://github.com/kumoproductions/mcp-cinema4d/releases/latest) 获取最新 `cinema4d_mcp_bridge-<version>.zip`，把内部 `cinema4d_mcp_bridge/` 解压到 plugins 目录：

| 系统    | 常见 plugins 目录                                                |
| ------- | ---------------------------------------------------------------- |
| Windows | `%APPDATA%\Maxon\Maxon Cinema 4D <VERSION>\plugins\`             |
| macOS   | `~/Library/Preferences/Maxon/Maxon Cinema 4D <VERSION>/plugins/` |

也可通过 `Preferences > Plugins > Add` 注册自定义搜索路径。解压后必须重启 C4D，插件只会在重启时重新加载。插件版本应与 npm 包版本保持一致；版本不一致会在 bridge 日志中出现 `unknown command: <tool>`。

> [!NOTE]
> 官方发布仅来自 npm 包 `@kumoproductions/mcp-cinema4d` 与 [kumoproductions/mcp-cinema4d](https://github.com/kumoproductions/mcp-cinema4d/releases) 的 GitHub Releases。从其他来源获得的 zip 或 scoped npm package 均应视为不可信。

## 配置

| 变量                         | 位置       | 默认值      | 说明                                               |
| ---------------------------- | ---------- | ----------- | -------------------------------------------------- |
| `C4D_MCP_HOST`               | 两端       | `127.0.0.1` | TCP bridge 的主机。                                |
| `C4D_MCP_PORT`               | 两端       | `18710`     | TCP bridge 端口。                                  |
| `C4D_MCP_ENABLE_EXEC_PYTHON` | 两端       | 未设置      | 选择启用；两端均设为 `1` 才暴露 `exec_python`。    |
| `C4D_MCP_ENABLE_PYTHON_OPS`  | C4D plugin | 未设置      | 选择启用；允许创建或编辑含 Python 源码的插件类型。 |
| `C4D_MCP_TOKEN`              | 两端       | 未设置      | 共享密钥，强烈建议设置。                           |
| `C4D_MCP_ALLOW_REMOTE`       | C4D plugin | 未设置      | 非 loopback 地址绑定必须设为 `1`。                 |

## 安全

即便不开启 `exec_python`，许多工具仍会修改状态：`call_command`、`set_params`、`import_scene`、`render`、`remove_entity`、`save_document`、`open_document`、`new_document`。请将 bridge 视为本地 shell，而非沙箱。

- `exec_python` 仅在两端启用 `C4D_MCP_ENABLE_EXEC_PYTHON=1` 后开放，且拥有文件、子进程和网络权限。用完请关闭。
- 含 Python 的插件类型也必须通过 `C4D_MCP_ENABLE_PYTHON_OPS=1` 开启；读取或删除已存在实例不受影响。
- 设置共享 token：localhost 不是信任边界，其他以同一用户运行的本机进程也可能连接。
- 默认仅绑定 `127.0.0.1`。非 loopback 地址还需 `C4D_MCP_ALLOW_REMOTE=1`，以防将 C4D 意外暴露到局域网。
- 只连接可信的 MCP 客户端；不要自动允许危险的写入工具。
- 场景内容可能造成间接提示注入。开启 `exec_python` 时，不要对不可信 `.c4d`、`.fbx`、`.abc` 文件使用 `import_scene`；对于 `exec_python`、`call_command`、`save_document`、`import_scene` 保留逐次授权。
- 每次 `exec_python` 调用都会将代码写入本地 bridge log：Windows 为 `%TEMP%/cinema4d_mcp_bridge.log`，macOS 为 `$TMPDIR/cinema4d_mcp_bridge.log`。日志只追加、不自动轮转，需要时请手动清理。

## 排错

| 现象                       | 可能原因与处理                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------- |
| 无法连接 `127.0.0.1:18710` | C4D 未运行、插件未加载或防火墙阻断 localhost。查看 C4D 控制台与 bridge log。        |
| 插件加载但没有 `listening` | 通常是 `cinema4d_mcp_bridge.pyp` 导入错误。删除旧安装文件夹，重新解压最新版并重启。 |
| `address already in use`   | 端口被占用。关闭占用程序，或在 C4D 与 MCP server 两端使用相同的 `C4D_MCP_PORT`。    |
| `unknown command: <tool>`  | bridge plugin 比 npm 包旧。下载匹配版本，重新解压并重启 C4D。                       |
| 对象名称歧义               | 使用路径 handle，例如 `{kind:"object", path:"/A/B/C"}`。                            |
| `exec_python is disabled`  | 两端均设置 `C4D_MCP_ENABLE_EXEC_PYTHON=1`，然后重启 C4D。                           |

## 已知限制

- Cinema 4D 2026 中，`modeling_command make_editable` 不可靠；需要确定的多边形副本时请用 `current_state_to_object`。
- 某些版本的 `list_graph_node_assets` 可能返回空数组；可使用已知 `$type` asset id。
- 节点材质的友好名称会随 2024、2025、2026 版本变化；不确定时传入 `list_graph_node_assets` 或 `list_graph_nodes` 返回的完整 asset id。
- 旧版 Cinema 4D 未测试。CI 与 E2E 面向 C4D 2026；大部分工具可能也可用于 2024/2025，但项目不保证或受理无法在 2026 复现的问题。

## 参与贡献

开发环境、添加工具、代码风格和 PR 流程见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 许可证

[MIT](./LICENSE)，版权所有 2026 kumo.productions, Inc.

## 商标

Cinema 4D 与 Maxon 是 Maxon Computer GmbH 的商标。本项目是独立的非官方工具，**不隶属于也未获 Maxon 背书**。

---

中文文档贡献：[@truman-t3](https://github.com/truman-t3)
