# OpenCode Orchestrator Plugin

> [!NOTE]
> ものすごく AI 臭い README だけど、それもそのはず 99% AI 製。
> あんまり真面目に開発する気がないので許してほしい。

このリポジトリは、OpenCode 用のマルチエージェント・オーケストレータを
npm プラグインおよび CLI アプリケーションとして提供するためのコードと
エージェント定義をまとめたものです。

「1 つの大きな開発ストーリー」を、Refiner/Todo-Writer/Executor/Auditor などの
エージェントに分担させて自動で前進させるための、制御ロジックと状態管理を担当します。

## 背景

OpenCode + GPT 系モデルで長期の計画を要するタスクをさせると、
必ずその途中で終わらせて「次は～」と言ってくる現象があります。

予め要件を決めておけば特に方針変更することもないのでひたすら「続けて」というのですが、
だんだん嫌になってきたので自動的にひたすら「続けて」を連打するスクリプトを作ったのがこのプラグインの始まりでした。

## 全体像

このマルチエージェント・オーケストレーターは計画と実行の2段階に分けて使います。

1. 計画フェーズでは OpenCode TUI で対話しながら要件を確定し、必要なコマンドを見積もります。
   - 提示されるコマンドは自動的に実装を進めるのに必要なものとなるので、 `opencode.json` の実行権限設定を編集して自動的に実行できるように整備する必要があります。
1. 実行フェーズでは計画通りにタスクを選定し、すべての受け入れ条件が達成されるまでエージェントを稼働させます。
   - 計画フェーズで実行可能と判定されるとタスク名が割り振られるはずなので、それを使って Bash や PowerShell などで以下のようにして実装ループを開始します。詳細は CLI についての説明を参照してください。
   - `npx opencode-orchestrator loop --task task-name`

---

```mermaid
flowchart LR
  subgraph Planning["計画フェーズ"]
    direction TB
    Dev{{"開発者"}} --"大きな目標<br/>やりたいこと"-->
    Planner[("Orch-Planner<br/>(OpenCode TUI)")]
    Planner --"要件の明確化を指示"-->
    Refiner["Refiner (Subagent)<br/>厳密な要件の作成<br/>受け入れ条件一覧の作成"]
    Planner --"要件について<br/>質疑応答"---> Dev
    Refiner --"要件に矛盾・不明瞭な点が<br/>ないか確認"-->
    Spec-Checker["Spec-Checker (Subagent)"]
    Spec-Checker --"差し戻し"--> Planner
    Spec-Checker --"コマンド実行権限確認"-->
    Preflight-Runner["Preflight Runner (Subagent)"]
    Preflight-Runner --"実行可否の通知"--> Planner
  end

  subgraph Execution["実行フェーズ"]
    direction TB
     Dev2{{"開発者"}} --"シェルスクリプト実行:<br/>npx opencode-orchestrator loop --task task-name"-->
    TodoWriter["Todo-Writer<br/>(Subagent)"]
    --"ToDo リスト"-->
    Executor["Executor<br/>(Subagent)"]
    --"成果物の生成"-->
    Auditor{{"Auditor (Subagent)<br/>受け入れ条件の確認"}}
    --"未達なら、<br/>未達の項目一覧"--> TodoWriter
    Auditor --"すべて達成"--> End(["終了"])
  end

  Planning ~~~ Execution
```

---

- 受け入れ条件やコマンドポリシーは、`$XDG_STATE_HOME/opencode/orchestrator/<task>/state` 配下に保存されます。
  - デフォルトでは、`~/.local/state/opencode/orchestrator/<task>/state` です。
- CLI `opencode-orchestrator loop` は、これらの状態ファイルを前提に
  - Todo-Writer / Executor / Auditor を順番に呼び出し
  - ストーリーが完了 (`done: true`) するまで実行を続けます。

## この OpenCode プラグインの使い方

1. opencode.json のプラグインフィールドに登録します。
   ```json
   {
     "plugins": ["@zenorg/opencode-orchestrator"]
   }
   ```
2. CLIをインストールします。
   ```sh
   npm install -g @zenorg/opencode-orchestrator
   ```

OpenCode からこのリポジトリをプラグインとして読み込むと、

- Orch-Planner ... 計画フェーズで対話するエージェント
- `@orch-local-investigator` ... コードベース探索サブエージェント
- `@orch-public-researcher` ... Web 検索サブエージェント
- Orchestrator 用のコマンド各種（`/orch-todo-write`, `/orch-exec`など。非公開にはできない仕様らしいです。)
- 各種カスタムツール (`autocommit`, `preflight-cli`)

が自動登録されます。

## 設定

### `orchestrator.expose`

`Build` などの組み込みエージェントが「積極的に使ってよいサブエージェント」として認識するサブエージェントの設定です。
デフォルトでは、orchestrator エージェントの `description` はクリアされ、`build` などの組み込み
エージェントから「積極的に使ってよいサブエージェント」として認識されにくくなっています。

個別にエージェントごとの可視状態を制御するには、`expose` にエージェント名と真偽値のマップを指定します。

```json
{
  "orchestrator": {
    "expose": {
      "orch-local-investigator": true,
      "orch-public-researcher": false
    }
  }
}
```

| エージェント名キーの有無 / 値  | 挙動                                                                        |
| ------------------------------ | --------------------------------------------------------------------------- |
| キーが存在しない（デフォルト） | `description` がクリアされる → 「明示的に呼べ」という説明に置き換わる       |
| `true`                         | `description` が維持される → `build` なども有用なサブエージェントとして認識 |
| `false`                        | 明示的に非公開 → `description` がクリアされる                               |

> [!NOTE]
> `expose` で `false`（またはキー省略）にしていても、orchestrator の `orch-executor` は
> 自前のシステムプロンプトでこれらのエージェントを直接指定して委譲するため、
> orchestrator の動作には影響しません。

## CLI: `opencode-orchestrator`

現在の CLI には次のサブコマンドがあります。

- `list`: 利用可能なタスク一覧を表示
- `loop`: 指定したタスクの実行ループを開始

### `list`: タスク一覧の表示

Refiner フェーズで作成された orchestrator state から、利用可能なタスクを一覧表示します。

```sh
npx opencode-orchestrator list
```

典型的な出力例 (テキストモード):

```text
my-task         loop_status=ready_for_loop    title=API エンドポイント追加
large-refactor  loop_status=needs_refinement  title=大規模リファクタリング
```

主なオプション:

- `--json`: タスク一覧を JSON 配列で出力

JSON 出力例:

```json
[
  {
    "task": "my-task",
    "rootDir": "~/.local/state/opencode/orchestrator/my-task",
    "stateDir": "~/.local/state/opencode/orchestrator/my-task/state",
    "loop_status": "ready_for_loop",
    "title": "API エンドポイント追加"
  }
]
```

`loop_status` は `command-policy.json` の `summary.loop_status` から取得されます。

### `loop`: 実行ループの開始

長いストーリーを自動で回すエントリポイントが `loop` サブコマンドです。

```sh
npx opencode-orchestrator loop --task my-task-key \
  "このタスクの高レベルなゴール (省略時は spec.md などから自動補完されます)"
```

主なオプション:

- `--task <name>` (必須): ストーリーを識別するタスクキー
- `--continue`: `last_session_id` を使って直近のセッションを継続
- `--session <ses_...>`: 既存セッション ID を明示してループを開始
- `--max-loop N`: 最大ステップ数 (デフォルト 100)
- `--max-restarts M`: 安全装置誤爆時の再起動上限 (デフォルト 20)
- `--commit`: ループ完了時に自動的にコミットをする
- `--file/-f <path>`: 各ステップの `opencode run` に添付する追加ファイル

ループの中では、次の順でコマンドが呼び出されます。

1. (必要に応じて) Todo-Writer ステップ: `opencode run --command orch-todo-write ...`
2. Executor ステップ: `opencode run --command orch-exec ...`
3. Auditor ステップ: `opencode run --command orch-audit --format json ...`
   - Auditor が `done: true` を返した時点でループ終了
   - `--commit` 指定時は、完了後に追加の executor ステップを使って `autocommit` ツール経由のコミットを依頼

各コマンドがどのエージェントを起動し、どのツールを内部的に使うかの詳細は
[`agent-roles.md`](./agent-roles.md) を参照してください。コマンド名 → エージェント名の対応は
`src/orchestrator-commands.ts` に定義されています。

## ディレクトリ構成

- `src/`
  - TypeScript 実装本体
- `agents/*.md`
  - 各 orchestrator エージェントのプロンプト本文 (frontmatter なし)
- `commands/*.md`
  - `orch-todo-write` / `orch-exec` / `orch-audit` などのコマンドテンプレート本文
- `.opencode/tools/*.ts`
  - OpenCode から直接呼び出すカスタムツール
  - このリポジトリにはサンプルとして `test-harness.ts` が含まれます
- `AGENTS.md`
  - このリポジトリで作業する AI エージェント向けの詳細ルール

## 依存関係とビルド

- Node.js 18+ / npm
- OpenCode CLI (`opencode` コマンド)

```sh
npm install
npm run build   # dist/cli.js, dist/index.js を生成
```

`package.json` で `bin` として `opencode-orchestrator` が公開されます。

### command-policy ゲート

実行開始前に、CLI は必ず次のファイルをチェックします。

- `getOrchestratorStateDir(<task>)/command-policy.json`

このファイルは、Refiner が用意した受け入れ条件とコマンド候補に対して
Spec-Checker / Preflight-Runner が出した結果を、Planner が集約して作る
「どのコマンドを使ってよいか」のポリシーです。主なルール:

- ファイルが存在しない場合は **エラーで即終了**
- `commands[].usage === "must_exec"` なのに `availability !== "available"` なコマンドが 1 つでもある場合、ループ開始を拒否
- `summary.loop_status` が
  - `needs_refinement` : 受け入れ条件やコマンドがまだ曖昧
  - `blocked_by_environment` : 必須コマンドが環境に存在しない
    などの場合もループ開始を拒否

これにより、Executor が「存在しないテストコマンド」や
「使ってはいけないビルドコマンド」を勝手に叩かないようにガードしています。

### セッションとログ

タスクキー `my-task` の場合、状態とログは次に保存されます。

- 状態: `$(getOrchestratorBaseDir)/my-task/state`
  - `acceptance-index.json` : Refiner が管理する受け入れ条件一覧
  - `spec.md` : 高レベルなゴール / 制約 / 終了条件 / 受け入れ条件の解釈指針
  - `status.json` : Executor / Auditor の進捗スナップショット、Todo-Writer 向けの正規化された再計画要求 (`replan_request`)、および protocol/failsafe 用の `failure_budget`
  - `todo.json` : Todo-Writer エージェントによるタスクリスト
  - `command-policy.json` : spec-check + preflight によるコマンド可否
- ログ: `$(getOrchestratorBaseDir)/my-task/logs`
  - `orch_step_000.txt` : 初回 `orch-todo-write` 出力
  - `orch_step_XXX.txt` : 各ステップ executor の出力
  - `audit_step_XXX.jsonl` : auditor の JSON ストリーム
  - `audit_step_XXX.json` : auditor の最終 JSON (必要に応じて別処理で生成)
  - `orchestrator_session_*.json` : `opencode export` で保存したセッション全体
  - `session_*.id` / `last_session_id` : セッション ID

これらのログから、あとから `opencode tui --session <id>` でセッションにアタッチしたり、
`jq` で auditor の結果を集計したりできます。

## エージェント構成

詳細な実装は `agent-roles.md` に詳細がありますが、概要だけまとめます。

- Planner (`orch-planner`)
  - モード: `primary`
  - 役割: Refiner / Spec-Checker / Preflight-Runner をまとめて呼び出す計画フェーズ担当 (TUI からの窓口)。
  - `npx opencode-orchestrator loop` 実行前に、手動でこのフェーズを流す想定です。
  - acceptance-index と spec.md の作成・更新は Refiner に委譲し、
    自身は主に Spec-Checker / Preflight-Runner / preflight-cli の結果をまとめて `command-policy.json` を更新します。
  - コマンド定義に変更があった時は Preflight 実行前に `question` ツールで具体的なコマンド一覧を提示して確認を取ります。
  - 必要に応じて `npx opencode-orchestrator loop ...` で実行ループを開始できます。
- Refiner (`orch-refiner`)
  - 高レベルなゴールをテスト可能な受け入れ条件に分解する Requirements Refiner です。
  - `acceptance-index.json`, `spec.md`, `command-policy.json` を管理し、コマンド定義も含めたメタデータを提案します。
  - `spec.md` に、タスクのゴール / non-goals / 制約 / 成果物 / 終了条件 / 受け入れ条件の解釈方針などを日本語でまとめた仕様を書き出します。
- Todo-Writer (`orch-todo-writer`)
  - Refiner が作った acceptance-index と spec.md を読み、Executor が実行しやすい todo リストに分解する計画専任エージェントです。
  - `$XDG_STATE_HOME/opencode/orchestrator/<task-name>/state/todo.json` に「derived planning cache」として todo 構造を書き出します。
  - 各 todo を 15-30 分程度の bounded unit に保ち、大きすぎる場合は垂直スライスで分割します。
    主作業面・橋渡し作業・期待証拠・完了境界を decision-complete な形で明示し、`execution_contract` メタデータで Auditor 向けの証拠境界を状態から追跡可能にします。
  - `orch_todo_read` / `orch_todo_write` ツールを使ってタスクリストを管理します。
- Executor (`orch-executor`)
  - 実装とローカル検証専任エージェントです。Todo-Writer/Refiner が用意した acceptance-index や todo を読み取り、コード・テスト・ドキュメント変更とローカル検証を担当します。
  - `bash` / `glob` / `grep` / `read` / `apply_patch` などを利用
  - 各 step の最終出力では `STEP_INTENT` / `STEP_VERIFY` / `STEP_AUDIT` を必須で返し、`STEP_INTENT` / `STEP_VERIFY` の ID はカンマ区切り (`R1,R2` または `R1, R2`) で出力します。
  - `STEP_VERIFY: ready` は command IDs・明示的に再確認した diffs・no-command 理由のうち少なくとも 1 つの根拠を要求します。根拠なしで `STEP_AUDIT: ready` をemit しても Auditor は起動されません。
  - 主要 requirement の作業では requirement-to-diff トレーサビリティ（`requirement_traceability`）を残します。
  - ルーティングは軽量・逐次的です。委譲は広範な read-only 探索に限定し、並列 executor 分岐や外部キューは前提としません。
- Auditor (`orch-auditor`)
  - 完了判定専用の外部監査役
  - Git の読み取り系コマンドとログのみを参照し、1 行 JSON (`{ done, requirements[] }`) を返す
  - ループ側では `STEP_AUDIT: ready` に加えて `STEP_VERIFY: ready` が揃った step でのみ起動されます。
  - ファイルを変更せず、`git status` / `git diff` / ログファイルなどを参照して `done` と `requirements[{id, passed, reason}]` を返します。
- Spec-Checker (`orch-spec-checker`)
  - acceptance-index と spec.md、および command-policy.json を解析し、仕様やコマンド定義の抜け・構造的問題・受け入れ条件との対応関係の不整合を指摘する解析専用サブエージェントです。
  - `issues[]` に acceptance-index / spec / command-policy それぞれに対する指摘を JSON として出力しますが、ファイルの編集・更新は行いません (完全 read-only)。
- Preflight-Runner (`orch-preflight-runner`)
  - `command-policy.json.commands[]` に定義されたコマンドに対して非対話モードで実行し、実行権限の確認をする

## ツール / コマンド

### `autocommit` ツール

ファイル: `src/autocommit.ts`

- 目的: OpenCode から安全に Git コミットを作るためのラッパ
- 特徴:
  - conventional commits (`type: message`) 形式でコミットメッセージを組み立て
  - 引数 `files[]` に指定されたパスのみをコミット対象にする
  - `.env`, `node_modules/`, `dist/`, `*.log` など典型的な秘匿情報・ビルド成果物はブラックリストで自動除外
  - すでに index にステージされているファイルが `files[]` に含まれていない場合はエラー
  - 任意引数 `details` を指定すると、subject 行とは別にコミットボディを追加の `-m` として渡し、
    conventional commits の subject + body 形式でより詳細な説明を付与できる

Executor からは「どのファイルをどの type でコミットするか」を明示的に決めさせる設計になっています。

### `preflight-cli` ツール

ファイル: `src/preflight-cli.ts`

- 目的: Refiner が提案したコマンド群を、CLI 側から安全に試す

### `test-harness` ツール (サンプル)

ファイル: `.opencode/tools/test-harness.ts`

- 引数:
  - `platform`: `"auto" | "linux" | "windows"` (デフォルト `auto`)
  - `windowsPwsh`: Windows 側の `pwsh.exe` パス (WSL から叩く場合など)
  - `windowsWorkdir`: Windows 側の作業ディレクトリ
- 挙動:
  - Linux の場合: `bash scripts/linux_ci.sh` を実行
  - Windows の場合: PowerShell で `scripts/windows_ci.ps1` を実行
  - 終了コードと stdout/stderr をまとめた文字列を返す

このツールは、実際のアプリケーションリポジトリ側に `scripts/linux_ci.sh` / `scripts/windows_ci.ps1` を用意しておく前提です。

## 典型的な運用フロー

1. 対象アプリケーションリポジトリに、このプラグインを導入
2. `XDG_STATE_HOME` (なければ `~/.local/state`) 配下に orchestrator state が作られる前提で、Refiner/Planner フェーズを実行
   - ここで `acceptance-index.json` / `spec.md` / `command-policy.json` を整備
3. `command-policy.json` が `ready_for_loop` かつ必須コマンドが `available` になっていることを確認
4. Executor ループを開始
   - `npx opencode-orchestrator loop --task my-task "この大きなタスクをやりたい"`
5. ループ完了後、必要に応じて `opencode tui --session <id>` でセッションを振り返り、
   PR 作成や手動レビューに進む
