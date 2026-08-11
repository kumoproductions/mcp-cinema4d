![MCP for Cinema 4D](https://raw.githubusercontent.com/kumoproductions/mcp-cinema4d/main/assets/ogp.png)

# mcp-cinema4d

[![CI](https://github.com/kumoproductions/mcp-cinema4d/actions/workflows/ci.yml/badge.svg)](https://github.com/kumoproductions/mcp-cinema4d/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D24-informational)](package.json)
[![Cinema 4D](https://img.shields.io/badge/Cinema%204D-%3E%3D2026.0.0-informational)](https://www.maxon.net/en/cinema-4d)

LLM に Cinema 4D を操作させる。**mcp-cinema4d** は、MCP 対応クライアント（Claude Desktop、Claude Code、その他 stdio 対応の MCP クライアント）を、起動中の Cinema 4D 2026 セッションへ接続します。モデルはシーン階層の調査、ショットの構築、ノードマテリアルの作成、アニメーションのリグを、型付きで undo 安全なツール層を通じて行います（Script Manager に任意の Python を貼り付ける方式ではありません）。

> [English](README.md)

**得意なこと:**

- **シーン監査**（「`hero` レイヤー上の全オブジェクトを列挙し、非一様スケールや Texture タグの欠落があれば指摘して」）
- **ショット構築**（「1920×1080 の RenderData、(0, 150, -400) のカメラ、両方を使う Take を作成して」）
- **マテリアル作業**（「ノイズテクスチャが roughness をゲイン 0.4 で駆動する Redshift ノードマテリアルを構築して」）
- **プロシージャルな一括編集**（「シーン内のすべての Subdivision Surface で、エディタ/レンダーの分割レベルを 1 下げて」）
- **Xpresso リグ**（「マスターギアのピッチ半径が、他のギアのサイズと逆回転を Xpresso グラフ経由で動的に駆動する、3 枚ギアの噛み合いリグを構築して」）

> [!CAUTION]
> **何が起きるかを理解してから先へ進んでください。** Cinema 4D にライブ接続した LLM は、シーンを読み取り、書き換え、（オプトインした場合）マシン上で任意コードを実行できます。具体的には次のとおりです。
>
> 1. **シーンデータはマシンの外に出ます。** オブジェクト名、階層パス、マテリアルやパラメータの値、読み込んだファイルパスなど、LLM が `list_entities` / `describe` / `get_container` / `dump_shader` / `get_mesh` で読んだものはすべて、選択した LLM プロバイダへ送られ、MCP クライアント側でログに残る場合もあります。**NDA 下の案件や未発表 IP を扱うときは、プロバイダの保持ポリシーとクライアントのログが許容できるか、先にスタジオや法務へ確認してください。**
> 2. **LLM は書き込み権限を持ちます。** オブジェクト、タグ、マテリアル、Take、レンダーデータ、レイヤーの作成、変更、削除に加え、ファイルの読み込み、マージ、オープン、保存、そしてレンダリングまで実行できます。ほとんどの編集は Ctrl/Cmd-Z で戻せますが、`save_document`、`open_document`、`render`、一部の `call_command` は戻せません。
> 3. **任意の Python はデフォルトで無効です。** `exec_python` は Cinema 4D プロセスの全権限（ファイル I/O、サブプロセス、ネットワーク）で無制限のコードを実行します。有効になるのは `C4D_MCP_ENABLE_EXEC_PYTHON=1` を**両側**に設定したときだけです。不要になったら無効へ戻してください。コンテナに Python ソースを保持するプラグイン型（Python タグ、Python ジェネレータ、MoGraph Python エフェクタ、Python フィールド、Xpresso Python オペレータ）も同様で、これらの作成と編集は別のオプトイン `C4D_MCP_ENABLE_PYTHON_OPS=1` で保護されています。そのコードパラメータは `exec_python` と同等の RCE になるためです。
>
> 初回利用の前に、シーンをバックアップ（またはコミット）し、使い捨てプロジェクトで試し、MCP クライアントの呼び出しごとの承認プロンプトを有効なままにしてください。ループバックの外へブリッジを公開する前に[セキュリティ](#セキュリティ)を読んでください。

---

## アーキテクチャ

```
MCP client
   ↓ stdio
MCP server  (このリポジトリ、Node.js)
   ↓ TCP, JSON Lines (デフォルト 127.0.0.1:18710)
cinema4d_mcp_bridge  (C4D 内の Python プラグイン)
   ↓
Cinema 4D
```

インストールするのは 2 つです。**MCP server**（この npm パッケージ。MCP stdio プロセスとして動く）と **bridge プラグイン**（Cinema 4D 内で動く Python プラグイン）。bridge が応答するには C4D が起動している必要があります。

## クイックスタート

Cinema 4D 2026.0.0+ と Node.js 24+ がある前提です。

1. **bridge プラグインを Cinema 4D にインストールします（初回のみ）。** [Releases ページ](https://github.com/kumoproductions/mcp-cinema4d/releases/latest)から最新の `cinema4d_mcp_bridge-<version>.zip` をダウンロードし、中の `cinema4d_mcp_bridge/` フォルダを Cinema 4D の plugins ディレクトリへ展開します（OS ごとのパスは[bridge プラグインのインストール](#bridge-プラグインのインストール)を参照）。
2. **Cinema 4D を起動（または再起動）します。** C4D コンソールに `[cinema4d_mcp_bridge] listening on 127.0.0.1:18710` と表示されます。
3. **CLI から MCP server をスモークテストします:**

   ```bash
   echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ping","arguments":{}}}' \
     | npx -y @kumoproductions/mcp-cinema4d
   #   → {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\"pong\": true, ...}"}]}}
   ```

つぎに MCP クライアントへ登録し（[クライアント設定](#クライアント設定)を参照）、こう試してみてください。

> 「シーン内の全オブジェクトを列挙して、原点の 200 ユニット上に `hero` という名前の立方体を追加して。」

LLM は `list_entities` → `create_entity` の順に呼び出し、ビューポートに新しい立方体が現れます。

ローカルのチェックアウトから動かしたい場合は [CONTRIBUTING.md](./CONTRIBUTING.md) のソースインストール手順を参照してください。

## クライアント設定

ランダムなトークンを生成し、**MCP server プロセス**（クライアントの `env` マップ経由。下記）と **Cinema 4D の起動環境**の両方に設定します。bridge はトークンが一致しないリクエストを拒否します（定数時間比較）。Node クライアントは値を自動で転送します。共有ワークステーションでは localhost は信頼境界にならないため、設定を強く推奨します。

```bash
openssl rand -hex 16
```

クライアントに MCP server を登録し、`env` マップにトークンを入れます:

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

| クライアント                 | 設定ファイル                                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Claude Desktop / Claude Code | Windows: `%APPDATA%\Claude\claude_desktop_config.json` / macOS: `~/Library/Application Support/Claude/claude_desktop_config.json` |
| その他の MCP クライアント    | stdio server の登録方法は各クライアントのドキュメントを参照                                                                       |

**同じ `C4D_MCP_*` 変数は Cinema 4D の起動環境にも設定する必要があります。** bridge プラグインは C4D の起動時にこれらを読み込むためです。macOS では `open -a "Cinema 4D" --env C4D_MCP_TOKEN=...`（または起動前にシェルプロファイルで export）。Windows ではユーザー環境変数として設定し、C4D を再起動します。

bridge のソケットを変えるには、同じ `env` マップと C4D 起動環境の両方で、`C4D_MCP_TOKEN` と並べて `C4D_MCP_PORT`（必要なら `C4D_MCP_HOST` も。[セキュリティ](#セキュリティ)を参照）を設定します。

## ツール

全 68 ツール、16 グループ。ツールはプロンプトに応じて LLM 自身が選ぶため、直接呼び出す場面はほとんどありません。ツールごとの説明つきの一覧は [docs/TOOLS.md](./docs/TOOLS.md) を参照してください。

| グループ                         | 数  | 内容                                                                                                                                                                                                                                 |
| -------------------------------- | :-: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Basics                           |  4  | `ping`、`render`、`preview_render`（Viewport renderer + Constant Lines。インライン PNG を返す）、`reset_scene`。                                                                                                                     |
| Script-style                     |  5  | `exec_python`（オプトイン）、`call_command`、`list_plugins`、`undo`、`batch`。エスケープハッチと undo グループ化された複数操作。                                                                                                     |
| Generic CRUD                     |  9  | `list_entities`、`describe`、`get_params`/`set_params`、`get_container`、`dump_shader`、`create_entity`、`remove_entity`、`set_keyframe`。                                                                                           |
| Shot setup                       | 11  | ドキュメント状態、fps / フレーム範囲 / カメラ、`import_scene`（マージ）、RenderData + Take、`take_override`、タイムラインマーカー（`create_marker` / `list_markers` / `set_marker` / `remove_marker`）、`sample_transform`。         |
| Selection / Hierarchy            |  4  | アクティブ選択の読み書き。リペアレント、並べ替え、複製。                                                                                                                                                                             |
| Modeling / Mesh                  |  4  | `modeling_command`（CSO / Make Editable / Connect / Subdivide ほか）、`get_mesh`、`set_mesh`、`set_mesh_selection`。                                                                                                                 |
| Document I/O                     |  6  | `save_document`、`open_document`、`new_document`、`list_documents`、`set_active_document`（開いているドキュメント間の切り替え）、`close_document`（未保存の変更には force ゲートあり）。                                             |
| Node graphs                      | 10  | ノードマテリアルのグラフ（走査 / アセット列挙 / `apply_graph_description` / ポート単位の編集 / 削除）と Xpresso（GvNodeMaster）グラフ（`list_xpresso_nodes` / `apply_xpresso_graph` / `set_xpresso_port` / `remove_xpresso_node`）。 |
| Tag helpers / Animation          |  5  | `assign_material`。`list_tracks`、`get_keyframes`、`delete_keyframe`、`delete_track`。                                                                                                                                               |
| Transforms / User data / MoGraph |  5  | `set_transform`。`add_user_data` / `list_user_data` / `remove_user_data`。`list_mograph_clones`。                                                                                                                                    |
| Layers                           |  5  | 列挙、作成、割り当て、照会、フラグ切り替え（solo / view / render / locked ほか）。                                                                                                                                                   |

## エンティティハンドル

すべての CRUD ツールは、型付きの `handle` オブジェクトでエンティティを特定します。名前が曖昧な場合、リゾルバはエラーを返します。シーンに同名のオブジェクトがあるときは `path` を使ってください。

| 種類             | 形                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `object`         | `{kind:"object", name:"Cube"}` または `{kind:"object", path:"/Root/Character/Hip"}`                                             |
| `render_data`    | `{kind:"render_data", name:"VFX_Shot002"}`                                                                                      |
| `take`           | `{kind:"take", name:"VFX_Shot002"}`                                                                                             |
| `material`       | `{kind:"material", name:"Concrete"}`                                                                                            |
| `tag`            | `{kind:"tag", object:"Cube", type_id:1029524, tag_name?:"..."}`（`object` の代わりに `object_path` も可）                       |
| `video_post`     | `{kind:"video_post", render_data:"VFX_Shot002", type_id:1029525}`                                                               |
| `shader`         | `{kind:"shader", owner:<handle>, name?:"Layer 0"}` または `{..., index:0}`                                                      |
| `plugin_options` | `{kind:"plugin_options", plugin_id:"abc"\|1028082, plugin_type?:"scene_saver"}`。エクスポータ / インポータのプライベート設定 BC |

`name` での検索は厳格です。同名のエンティティが複数あると、bridge は最大 5 件の候補パスを列挙したエラーを返すので、パスベースのハンドルに切り替えられます。`create_entity` は解決済みのハンドルを常に返す（オブジェクトは `path` を含み、シェーダは `name` と `index` の両方を含む）ため、連続した編集が安定します。

## bridge プラグインのインストール

[Releases](https://github.com/kumoproductions/mcp-cinema4d/releases/latest) から最新の `cinema4d_mcp_bridge-<version>.zip` を取得し、中の `cinema4d_mcp_bridge/` フォルダを Cinema 4D の plugins ディレクトリへ展開します:

| OS      | 標準的な plugins ディレクトリ                                    |
| ------- | ---------------------------------------------------------------- |
| Windows | `%APPDATA%\Maxon\Maxon Cinema 4D <VERSION>\plugins\`             |
| macOS   | `~/Library/Preferences/Maxon/Maxon Cinema 4D <VERSION>/plugins/` |

Cinema 4D の `Preferences → Plugins → Add` でカスタム検索パスを登録し、そこへ展開しても構いません。

展開後に Cinema 4D を起動（または再起動）します。**プラグインは C4D の再起動時にのみ再読み込みされます。**

プラグインのバージョンは、実行する npm パッケージのバージョンに揃えてください。バージョン不一致は bridge ログに `unknown command: <tool>` として現れます。開発チェックアウトを動かす場合は [CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください。

> [!NOTE]
> **公式リリースの提供元は 2 か所だけです。** npm パッケージ [`@kumoproductions/mcp-cinema4d`](https://www.npmjs.com/package/@kumoproductions/mcp-cinema4d) と、[kumoproductions/mcp-cinema4d](https://github.com/kumoproductions/mcp-cinema4d/releases) の GitHub Releases ページ。それ以外の場所で入手した、このプラグインを名乗る zip や scoped npm パッケージは、信頼できないものとして扱ってください。

## 設定

| 変数                         | 側             | デフォルト  | 説明                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | -------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `C4D_MCP_HOST`               | 両側           | `127.0.0.1` | TCP bridge のホスト。旧エイリアス: `C4D_BRIDGE_HOST`（Node）、`C4D_MCP_BRIDGE_HOST`（プラグイン）。                                                                                                                                                                                                           |
| `C4D_MCP_PORT`               | 両側           | `18710`     | TCP bridge のポート。旧エイリアス: `C4D_BRIDGE_PORT`、`C4D_MCP_BRIDGE_PORT`。                                                                                                                                                                                                                                 |
| `C4D_MCP_ENABLE_EXEC_PYTHON` | 両側           | 未設定      | **オプトイン。** 両側で `1`（または `true`/`yes`/`on`）に設定すると `exec_python` ツールが公開されます。[セキュリティ](#セキュリティ)を参照。                                                                                                                                                                 |
| `C4D_MCP_ENABLE_PYTHON_OPS`  | C4D プラグイン | 未設定      | **オプトイン。** `1` に設定すると、Python を内包するプラグイン型（Python タグ、Python ジェネレータ、MoGraph Python エフェクタ、Python フィールド（Fpython、440000277）、Xpresso Python オペレータ）の作成と編集を許可します。デフォルトは無効。コードパラメータが `exec_python` と同等の RCE になるためです。 |
| `C4D_MCP_TOKEN`              | 両側           | 未設定      | 共有シークレット。C4D 側に設定した場合、Node クライアントは同じ値を送る必要があります。強く推奨。                                                                                                                                                                                                             |
| `C4D_MCP_ALLOW_REMOTE`       | C4D プラグイン | 未設定      | `C4D_MCP_HOST` を非ループバックのインターフェースへバインドするために必要。未設定の場合、bridge は起動を拒否します。                                                                                                                                                                                          |

## セキュリティ

`exec_python` なしでも、多くのツールが状態を変更します: `call_command`、`set_params`、`import_scene`、`render`、`remove_entity`、`save_document`、`open_document`、`new_document`。bridge はサンドボックスではなく、ローカルシェルと同じものとして扱ってください。

- **`exec_python` はオプトインです。** Cinema 4D のメインスレッド上で無制限の Python（ファイル I/O、サブプロセス、ネットワーク）を実行します。`C4D_MCP_ENABLE_EXEC_PYTHON=1` を MCP server プロセスと Cinema 4D プロセスの**両方**に設定しない限り、非公開かつ bridge 側で拒否されます。不要になったら無効へ戻してください。設定したまま忘れるのが事故のもとです。
- **Python を内包するプラグイン型もオプトインです。** Python タグ（`Tpython`）、Python ジェネレータ（`Opython`）、MoGraph Python エフェクタ、Python フィールド（`Fpython`）、Xpresso Python オペレータは、呼び出し側が与えたソースコードをコンテナに保持し、シーン評価時に実行します。つまり `exec_python` と同等の RCE です。C4D 側に `C4D_MCP_ENABLE_PYTHON_OPS=1` を設定しない限り、bridge はこれらの型を対象とする `create_entity`、`set_params`、`apply_xpresso_graph`、`take_override` の操作を拒否します。既存インスタンスの列挙、読み取り、削除には影響しません。
- **共有シークレットのトークン（`C4D_MCP_TOKEN`）を設定してください。** localhost は信頼境界ではありません。同じユーザーで動く他のローカルプロセスも接続できてしまいます。JSON スニペットは[クライアント設定](#クライアント設定)を参照。
- **デフォルトはループバック、リモートはオプトイン。** bridge はデフォルトで `127.0.0.1` にバインドします。`C4D_MCP_HOST` を非ループバックのインターフェースへ向けると、`C4D_MCP_ALLOW_REMOTE=1` も設定しない限り**起動を拒否**します。1 文字の打ち間違い（`0.0.0.0`）で C4D を LAN に公開する事故を防ぐためです。
- **信頼できる MCP クライアントだけを接続してください。** 変更系のツール（オプトインした場合は特に `exec_python`）が自動承認されないよう、ツール使用の権限設定を確認してください。
- **シーン内容経由の間接プロンプトインジェクション。** シーンデータ（オブジェクト名、パラメータ文字列、読み込んだファイルパス）は `list_entities` / `describe` / `get_container` / `dump_shader` / `get_mesh` を通じて LLM へ戻ります。`exec_python` が有効なとき、シーン内の悪意ある文字列がモデルを誘導して任意の Python を実行させる可能性があります。`exec_python` が有効な間は、信頼できない `.c4d` / `.fbx` / `.abc` ファイルに対して `import_scene` を実行しないでください。また `exec_python` / `call_command` / `save_document` / `import_scene` は一括承認せず、MCP クライアントの呼び出しごとの承認に頼ってください。
- **監査ログ。** すべての `exec_python` 呼び出しは、事後レビューのためコード本文をローカルの bridge ログ（Windows は `%TEMP%/cinema4d_mcp_bridge.log`、macOS は `$TMPDIR/cinema4d_mcp_bridge.log`）に記録します。ログは追記のみでローテーションされないため、肥大化したら手動で削除してください。

```bash
export C4D_MCP_TOKEN="$(openssl rand -hex 16)"   # C4D の起動環境にも設定する
npx -y @kumoproductions/mcp-cinema4d
```

## トラブルシューティング

| 症状                                                                           | 考えられる原因と対処                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cannot connect to Cinema 4D bridge at 127.0.0.1:18710`                        | C4D が起動していない、プラグインが読み込まれていない、またはファイアウォールが localhost を遮断している。C4D コンソールの `listening on …` 行を確認し、`%TEMP%/cinema4d_mcp_bridge.log`（Windows）/ `$TMPDIR/cinema4d_mcp_bridge.log`（macOS）を見る。                |
| プラグインは読み込まれるが `listening` 行が出ない                              | 多くは `cinema4d_mcp_bridge.pyp` の Python インポートエラー。C4D コンソールを確認。旧インストールの残骸ファイルが典型的な原因なので、展開先フォルダを削除して最新リリースの zip を展開し直し、C4D を再起動する。                                                      |
| `listening on 127.0.0.1:18710` が `OSError: address already in use` で失敗する | 別のプロセスがそのポートを使用中。そのプロセスを終了するか、`C4D_MCP_PORT`（C4D 側）**と** MCP server の起動コマンドの両方に同じ値を設定する。                                                                                                                        |
| `unknown command: <tool>`                                                      | bridge プラグインが npm パッケージより古い。対応するリリースの zip をダウンロードし、plugins フォルダへ展開し直して C4D を再起動する。                                                                                                                                |
| `object name '…' is ambiguous`                                                 | 同名のシーンオブジェクトが複数ある。パスベースのハンドル `{kind:"object", path:"/A/B/C"}` を使う。候補パスはエラーに含まれる。                                                                                                                                        |
| `exec_python is disabled on this C4D instance`                                 | `exec_python` はデフォルトで無効。Cinema 4D の起動環境**と** MCP server の `env` マップの**両方**に `C4D_MCP_ENABLE_EXEC_PYTHON=1` を設定し、C4D を再起動する。[セキュリティ](#セキュリティ)を参照。                                                                  |
| `requires C4D_MCP_ENABLE_PYTHON_OPS=1 …`                                       | Python を内包するエンティティ（Python タグ、Python ジェネレータ、MoGraph Python エフェクタ、Python フィールド、Xpresso Python オペレータ）を作成または編集しようとした。デフォルトで無効。Cinema 4D の起動環境に `C4D_MCP_ENABLE_PYTHON_OPS=1` を設定して再起動する。 |

それでも解決しない場合は、bridge ログ、OS、Cinema 4D のバージョン、失敗したツール呼び出しを添えて [issue](https://github.com/kumoproductions/mcp-cinema4d/issues/new/choose) を作成してください。

## 既知の制限

- **`modeling_command make_editable` は Cinema 4D 2026 で不安定です。** SDK の `SendModelingCommand` による `MCOMMAND_MAKEEDITABLE` の扱いはビルドごとに変わります。新しいポリゴンオブジェクトを返すこともあれば、置き換えを挿入せずにソースを削除してしまうこともあります。確実なポリゴンコピーが必要なときは **`current_state_to_object` を使ってください**（bridge が結果を挿入し、そのハンドルを返します）。
- **`list_graph_node_assets` が空のリストを返すことがあります。** Maxon のアセットリポジトリが通常のクエリパスでノードテンプレートアセットを公開しないビルドで起きます。ツール自体は `supported: true` と形の正しい出力を返すので、空の `assets` 配列は「この C4D ビルドでは探索が使えない」と解釈し、既知の `$type` アセット id（既存マテリアルへの `list_graph_nodes` の結果など）を渡してください。
- **ノードマテリアルのフレンドリー名はビルドごとに変わります。** `apply_graph_description` は Maxon がドキュメント化している宣言的な `$type` 文字列（例: `"Standard Material"`）を受け付けますが、リゾルバは 2024 / 2025 / 2026 のビルド間で挙動が変わります。迷ったら `list_graph_node_assets` / `list_graph_nodes` が返す完全修飾のアセット id を渡してください。
- **クラシックシェーダのフィクスチャを用意する手段は `exec_python` だけです。** 一部の E2E テスト（`dump_shader` 用）はアサーションの前にシェーダツリーを構築する必要があり、`C4D_MCP_ENABLE_EXEC_PYTHON` が両側に設定されていないときは静かにスキップされます。ツール自体は `exec_python` を必要としません。
- **旧バージョンの Cinema 4D はテストしていません。** CI と E2E スイートは C4D 2026 を対象にしています。bridge はオプションの SDK 定数を `getattr` フォールバックで保護しているため、多くのツールは 2024 / 2025 でも動く可能性がありますが、検証はしておらず、2026 で再現しないバグ報告は受け付けません。

## コントリビュート

セットアップ、開発ループ、新しいツールの追加方法、コーディングスタイル、PR の流れは [CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください。

## ライセンス

[MIT](./LICENSE) © 2026 kumo.productions, Inc.

## 商標

Cinema 4D® と Maxon® は Maxon Computer GmbH の商標です。本プロジェクトは独立した非公式ツールであり、**Maxon の関連会社ではなく、Maxon の承認も受けていません**。
