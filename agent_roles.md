# Orchestrator エージェントの役割整理

このドキュメントは、`opencode-orchestrator` パイプラインに登場する各エージェント／コマンドの役割と、
それぞれが主に「どのファイルを読むか / 書くか / どんな出力を返すか」を、実際のプロンプトとコード
（`agents/*.md`, `commands/*.md`, `src/orchestrator-*.ts` など）に基づいてまとめたものです。

## 1. 共通コンポーネント

- `agents/*.md`
  - 各エージェントのシステムプロンプト（役割・制約・入出力契約）を英語で定義。
  - 各エージェントの出力言語ポリシーや、どのパスに対して読み書き可能かを明示。
- `commands/orch-*.md`
  - Orchestrator 関連 CLI コマンドの「ユーザープロンプト」部分を定義。
  - `opencode run --command orch-...` 実行時に `$ARGUMENTS` が差し込まれる。
- `src/orchestrator-agents.ts`
  - `orchestratorAgents` テーブルで、各エージェントの使用可能ツールと permission を定義。
- `src/orchestrator-commands.ts`
  - `orchestratorCommands` テーブルで、`orch-todo-write` などのコマンド名 → 紐づくエージェント名
    （`agent` フィールド）を定義。
- `src/orchestrator-loop.ts`
  - 実際の Orchestrator ループ本体。`orch-todo-write`/`orch-exec`/`orch-audit` を組み合わせて
    セッションを進行し、`state/` 配下の各種ファイルを読み書きする。
- Orchestrator 共通状態ディレクトリ
  - ベースパス: `$XDG_STATE_HOME/opencode/orchestrator/<task-name>/state/`
  - 主なファイル:
    - `acceptance-index.json` … 要件一覧（Refiner オーナー）
    - `spec.md` … ストーリ仕様（Refiner オーナー／日本語）
    - `todo.json` … Todo-Writer が生成する canonical todo 一覧
    - `command-policy.json` … Planner が合成するコマンドポリシー
    - `status.json` … `orchestrator-loop` が更新するループ状態

以下、エージェント／コマンドごとに、(A) 役割, (B) 主な入力ファイル, (C) 主な出力ファイル,
(D) プロンプト上の出力仕様 を整理します。

## 2. orch-planner

- 実体
  - エージェント: `orch-planner` (`agents/orch-planner.md`)
  - CLI コマンド: なし
  - 計画全体を `orch-planner` が `task=orch-refiner` / `task=orch-spec-checker` を使って主導する
    （エージェント設定は `src/orchestrator-agents.ts` 参照）。

- (A) 役割
  - 高レベルのゴールから、Executor ループ実行前に必要な「オーケストレータ状態」を整備する
    プランニングコーディネータ。
  - `orch-refiner` / `orch-spec-checker` / `orch-preflight-runner` を呼び分けて、
    `acceptance-index.json`, `spec.md`, `command-policy.json`, spec-check レポート、preflight 結果
    などを揃える。
  - `command-policy.json` の `summary.loop_status` と `commands[]` を最終的に更新する唯一の
    エージェント（コマンド定義自体は Refiner の責務）。

- (B) 主な入力（読むファイル）
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/acceptance-index.json`
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/spec.md`
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/command-policy.json`
  - リポジトリ内コード／ドキュメント（必要に応じて `read`/`glob`/`grep`）

- (C) 主な出力（書くファイル）
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/command-policy.json`
    - `summary.loop_status`
    - `commands[]`（Refiner 定義のコマンドに preflight 結果を付与）

- (D) 出力内容（プロンプト上の仕様）
  - 人間向けには、次のようなサマリを短いセクションで返す（`agents/orch-planner.md` 末尾参照）：
    - `Execution readiness`（executor ループを開始して良いか）
    - `command-policy status`（`loop_status` とコマンド可用性の要約）
    - `Required changes`（必要な追加作業）
    - `Next actions`（次に行うべきステップ）
  - 付随する spec-check / preflight 結果は JSON だが、Planner 自身の最終応答は
    上記の箇条書きテキスト。

## 3. orch-refiner / orch-refine

- 実体
  - エージェント: `orch-refiner` (`agents/orch-refiner.md`)
  - CLI コマンド: `orch-refine` (`commands/orch-refine.md`)

- (A) 役割
  - 要件の精査エージェント。高レベルゴールを「受け入れ条件付きの要求一覧」に落とし込む。
  - `acceptance-index.json` と `spec.md` を **唯一** 書き換える権限を持つエージェント。
  - 追加で `command-policy.json` 初期版を担当し、
    コマンド ID やテンプレートの単一のソース・オブ・トゥルースになる。
  - `command-policy.json` の `commands[]` に含まれるコマンド定義は Refiner が唯一のオーナーであり、
    Planner や Spec-Checker はこれを読み取り専用で扱う。

- (B) 主な入力
  - 高レベルゴール（CLI 引数 / 添付ファイルで渡される）
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/acceptance-index.json`（既存があれば）
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/spec.md`（既存があれば）
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/command-policy.json`（既存があれば）
  - リポジトリのコード／ドキュメント（`read`/`glob`/`grep`）

- (C) 主な出力
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/acceptance-index.json`
    - `version`, `requirements[]` などの構造化された受け入れ条件（説明文は日本語）。
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/spec.md`
    - タスクのゴール、非ゴール、制約、期待成果物、Done 条件など（日本語）。
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/command-policy.json`
    - 初期の `commands[]` リストを定義。

- (D) 出力内容
  - エージェントの通常応答としては、
    - 受け入れ条件の箇条書き概要
    - 主要な requirement ID と内容
    - 必要コマンド候補（ID, command, role, usage, parameters など）
      を短く説明するテキスト。
  - ファイル内容そのものは JSON / Markdown として state ディレクトリに書き出される。

## 4. orch-spec-checker / orch-spec-check

- 実体
  - エージェント: `orch-spec-checker` (`agents/orch-spec-checker.md`)
  - CLI コマンド: `orch-spec-check` (`commands/orch-spec-check.md`)

- (A) 役割
  - 受け入れ仕様と command-policy の構造検査を行う読み取り専用エージェント。
  - acceptance-index / spec / command-policy.json の構造問題・抜け・矛盾を検査し、
    JSON レポートの `issues[]` にコマンド候補の不足・過剰・安全性・テンプレート化の
    観点を含めて返す。

- (B) 主な入力
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/acceptance-index.json`
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/spec.md`
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/command-policy.json`
  - 必要に応じてリポジトリ内ファイル（`read`/`glob`/`grep`）

- (C) 主な出力
  - 1 行の JSON オブジェクトのみを標準出力に返す契約。
  - 構造例（実際の仕様より抜粋）:
    - `status`: `"ok"` / `"needs_revision"`
    - `feasible_for_loop`: orchestrator ループに載せられるかのブール値
    - `issues[]`: acceptance-index / spec / command-policy に関する問題一覧（`summary`/`suggested_action` は日本語）

## 5. orch-preflight-runner / orch-preflight

- 実体
  - エージェント: `orch-preflight-runner` (`agents/orch-preflight-runner.md`)
  - CLI コマンド: `orch-preflight` (`commands/orch-preflight.md`)
  - Planner からは `preflight-cli` ツール経由で呼び出される。

- (A) 役割
  - Spec-checker などが定義した「候補コマンド」が現在の環境で実行可能か、
    破壊的でない範囲で実際に `bash` 経由で試す。

- (B) 主な入力
  - プロンプト中に JSON として埋め込まれたコマンド一覧:
    - `[ { "id": "cmd-dotnet-test", "command": "dotnet test", "role": "test", "usage": "must_exec" }, ... ]`
  - 各 `command` はテンプレート展開済みの「最終的な 1 行コマンド」。

- (C) 主な出力（ファイル）
  - 自身はファイルを書かない。
  - 出力 JSON は Planner 等が読み取り、必要であれば state ディレクトリに保存。

- (D) 出力内容
  - 1 行の JSON オブジェクトのみ（`agents/orch-preflight-runner.md` 参照）。
  - 構造:
    - `status`: `"ok"` / `"failed"`
    - `results[]`: 各コマンドごとの
      - `id`, `command`, `role`, `usage`
      - `available`（boolean）
      - `exit_code`
      - `stderr_excerpt`（日本語で短い説明）

## 6. orch-todo-writer / orch-todo-write

- 実体
  - エージェント: `orch-todo-writer` (`agents/orch-todo-writer.md`)
  - CLI コマンド: `orch-todo-write` (`commands/orch-todo-write.md`)
  - 初回セッション作成やループ内の「プラン更新ステップ」として呼び出される（`src/orchestrator-loop.ts`）。

- (A) 役割
  - Refiner が作成した受け入れ要件から「Executor が実行する Todo」を構造化して作る。
  - Todo は `id` / `summary` / `status` / `related_requirement_ids[]` を持ち、
    acceptance-index 内の要件とのトレーサビリティを確保する。

- (B) 主な入力
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/acceptance-index.json`
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/spec.md`
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/status.json`
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/todo.json`
  - `orch_todo_read` ツールからの既存 canonical todo 群

- (C) 主な出力
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/todo.json`
    - `orch_todo_write` ツール (`mode=planner_replace_canonical`) を通じて上書きされる
      canonical todo 一覧。型定義は `src/orchestrator-todo.ts` の `CanonicalTodo`。
  - OpenCode セッション Todo（`todowrite` 経由）
    - UI 表示用に、フィルタ済みの一部 Todo をセッション Todo としてミラーする。

- (D) 出力内容
  - エージェント応答としては、どの要件に対してどのような Todo を追加／更新したかの
    簡潔な説明テキスト。
  - 具体的な Todo 構造は `todo.json` の JSON として保存される。

## 7. orch-executor / orch-exec

- 実体
  - エージェント: `orch-executor` (`agents/orch-executor.md`)
  - CLI コマンド: `orch-exec` (`commands/orch-exec.md`)
  - Orchestrator ループ本体から各ステップ毎に呼び出される（`src/orchestrator-loop.ts`）。

- (A) 役割
  - 実装＋検証担当エージェント。コード／テスト／ドキュメントへの具体的な変更と、
    ローカルのビルドやテスト実行を担う。
  - Todo 構造そのものは変更せず、`status` 更新のみを行う。

- (B) 主な入力
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/acceptance-index.json`
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/spec.md`
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/todo.json`
    - `orch_todo_read` で読み取る canonical todos。
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/command-policy.json`
    - 実行可能とされているコマンドのみ `bash` で実行する。（テンプレート付きコマンドの
      具体値選択もここで行う。）
  - リポジトリ内のコード／テスト／ドキュメント（`glob`/`grep`/`read`/`edit` など）。

- (C) 主な出力（ファイル）
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/todo.json`
    - `orch_todo_write(mode=executor_update_statuses)` により Todo の `status` を更新。
  - リポジトリ内のソースコード・テストコード・ドキュメント
    - `edit`/`patch`/`write` ツールで直接更新。
  - OpenCode セッション Todo（`todowrite`）
    - 現在の作業セットを UI にミラー。

- (D) 出力内容（プロトコル）
  - 各ステップの最終応答は、`agents/orch-executor.md` に定義された行指向プロトコルに従う:
    - `STEP_TODO:` 行（0個以上）
    - `STEP_DIFF:` 行（0個以上）
    - `STEP_CMD:` 行（0個以上）
    - `STEP_BLOCKER:` 行（0個以上）
    - `STEP_AUDIT:` 行（ちょうど 1 個）
  - これらは `src/orchestrator-loop.ts` の `parseExecutorStepSnapshot` などでパースされ、
    `status.json` の `last_executor_step` / `proposals` などに反映される。

## 8. orch-auditor / orch-audit

- 実体
  - エージェント: `orch-auditor` (`agents/orch-auditor.md`)
  - CLI コマンド: `orch-audit` (`commands/orch-audit.md`)
  - Orchestrator ループから、Executor が `STEP_AUDIT: ready ...` を返したステップでのみ
    呼び出される（`src/orchestrator-loop.ts`）。

- (A) 役割
  - 開発ストーリーが受け入れ条件とプロジェクトゲート（テスト／ビルド／Lint／Docs）を
    全て満たしているかを、外部監査の立場から判定する。
  - 自身はコードやファイルを編集せず、Git やログの読み取りだけを行う。

- (B) 主な入力
  - 高レベルゴール（オリジナルのプロンプト）
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/spec.md`
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/acceptance-index.json`
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/status.json`
    - `last_executor_step` や TODO 状況、`proposals` など。参考情報であり、
      それ自体を証拠とは見なさない。
  - Git 差分・ログ・テストログなど（添付ファイルや `bash` 読み取り系コマンド経由）。

- (C) 主な出力（ファイル）
  - ファイルには書き込まない（`orchestrator-agents.ts` の permission で `write` は ask &
    acceptance-index への書き込みは deny）。
  - Orchestrator ループ側が `parseAuditResult`（`src/orchestrator-audit.ts`）で
    応答をパースし、`status.json` の `last_auditor_report` を更新する。

- (D) 出力内容
  - 1 行の JSON オブジェクトのみ（`agents/orch-auditor.md`）。
  - フィールド:
    - `done`: ストーリー全体が完了しているか（ブール）
    - `requirements[]`: `{ id, passed, reason? }` の配列
      - `reason` は日本語テキスト。

## 9. orch-preflight-runner 以外の補助エージェント

### 9.1 orch-todo-writer / orch-executor 用ツール (`src/orchestrator-todo.ts`)

- `orch_todo_read` ツール
  - 目的: 指定タスクの canonical todo 一覧を JSON で取得する。
  - 読み取り対象ファイル: `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/todo.json`
  - 呼び出し可能エージェント: `orch-todo-writer`, `orch-executor` のみ（それ以外は SPEC_ERROR）。
  - 出力: `{ todos: CanonicalTodo[] }` を JSON 文字列で返す。

- `orch_todo_write` ツール
  - 目的: canonical todo の書き換えまたは `status` 更新。
  - 書き込み対象ファイル: 上記と同じ `todo.json`。
  - `mode=planner_replace_canonical`（Todo-Writer 専用）
    - `canonicalTodos` 全体を受け取り、`todo.json` を丸ごと再生成する。
  - `mode=executor_update_statuses`（Executor 専用）
    - 既存 todo の `status` だけを更新。未知の `id` を指定した場合は SPEC_ERROR。

### 9.2 orchestrator-loop 自身 (`src/orchestrator-loop.ts`)

- (A) 役割
  - 1 タスク（`--task <task>`）について、以下を制御する:
    - 初回 `orch-todo-write` 呼び出しとセッション作成（`createInitialSession`）
    - 各ステップの Executor 実行 (`orch-exec`)
    - 必要に応じた Todo-Writer 実行 (`orch-todo-write` 再実行)
    - Auditor 実行 (`orch-audit`)
    - 安全装置（SAFETY トリガでのセッション再起動、`command-policy.json` ゲートなど）
  - ループ状態は `status.json` に保存し、UI や他エージェントが参照できるようにする。

- (B) 主な入力ファイル
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/command-policy.json`
    - `enforceCommandPolicyGate` による起動前チェック。
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/acceptance-index.json`
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/spec.md`
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/todo.json`
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/status.json`（既存があれば）

- (C) 主な出力ファイル
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/status.json`
    - `last_session_id`, `current_cycle`, `last_executor_step`, `last_auditor_report`,
      `replan_required`, `proposals` などを更新。
  - `$XDG_STATE_HOME/opencode/orchestrator/<task>/logs/` 配下
    - `orch_step_XXX.txt` / `audit_step_XXX.jsonl` / `todowriter_step_XXX.txt` などのログ。
  - `orchestrator_session_*.json`
    - セッションエクスポート JSON（`opencode export` の結果をファイル化）。

- (D) 出力内容
  - CLI 標準出力としては主にログメッセージ（日本語中心 + 英語補助）。
  - 成否としては `runLoop()` の戻り値（boolean）を CLI 層が exit code などに反映。

## 10. まとめ

- Refiner / Spec-Checker / Preflight-Runner / Planner が「仕様とコマンドポリシー」を整備し、
  Todo-Writer が「実行可能な Todo 構造」を生成し、Executor が「実装と検証」を行い、
  Auditor が「最終完了判定」を行う、という明確な責務分担になっている。
- Orchestrator ループ (`orchestrator-loop.ts`) はこれらのエージェントとコマンドを束ね、
  各ステップで state ディレクトリ配下のファイルを読み書きしながらストーリーを前に進める。
- `agent_roles.md` は、その全体像を俯瞰するためのリファレンスとして利用できる。

## 11. 主要 JSON ファイルのスキーマ

ここでは、実際の TypeScript 型定義やエージェント仕様に基づき、Orchestrator 周辺で生成・更新される
主な JSON ファイルのスキーマを要約する。

### 11.1 acceptance-index.json（概要）

- パス: `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/acceptance-index.json`
- オーナー: `orch-refiner`
- 正確なスキーマは refiner 側で進化するが、少なくとも以下のような構造を前提としている
  （`agents/orch-refiner.md`, `agents/orch-spec-checker.md` より）:

```jsonc
{
  "version": 1,
  "requirements": [
    {
      "id": "R1-some-requirement", // 安定 ID（文字列）
      "title": "...", // 短い名前（任意）
      "description": "...", // 日本語の受け入れ条件説明
      "acceptance": {
        // 受け入れ判定に関する追加情報（任意）
        "files": ["src/..."],
        "notes": "...",
      },
      "tags": ["..."], // 任意
      "commands": [
        // 必要コマンドへのリンク（任意）
        "cmd-npm-test",
      ],
    },
  ],
}
```

- 注意: `requirements[]` の各要素には少なくとも `id` と自然言語説明 (`description` 等) が存在し、
  ID はタスク内で安定して再利用されることが前提。

### 11.2 command-policy.json

- パス: `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/command-policy.json`
- オーナー: 初期定義は `orch-refiner`、集約と `availability` 付与は `orch-planner`。
- `enforceCommandPolicyGate`（`src/orchestrator-loop.ts`）で期待される最小スキーマ:

```jsonc
{
  "summary": {
    "loop_status": "ready_for_loop" | "needs_refinement" | "blocked_by_environment" | string
  },
  "commands": [
    {
      "id": "cmd-npm-test",                     // 安定 ID（kebab-case）
      "command": "npm test",                    // コマンド文字列またはテンプレート
      "role": "test" | "build" | "lint" | "doc" | "run" | "explore" | string,
      "usage": "must_exec" | "may_exec" | "doc_only", // クリティカル度
      "probe_command": "npm test -- --list",    // 任意・preflight 用の軽量コマンド
      "parameters": {                            // テンプレート使用時のパラメータ定義（任意）
        "pattern": { "description": "..." },
        "subdir": { "description": "..." }
      },
      "related_requirements": ["R1", "R2-ui"], // 任意・どの要件と結びつくか
      "usage_notes": "...",                    // 任意・日本語メモ
      "availability": "available" | "unavailable" // Planner/preflight が付与
    }
  ]
}
```

- `enforceCommandPolicyGate` は特に `commands[].usage` と `commands[].availability` を見て、
  `usage == "must_exec"` かつ `availability != "available"` のコマンドが 1 つでもある場合は
  ループ開始をブロックする。

### 11.3 todo.json（Canonical Todo）

- パス: `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/todo.json`
- オーナー:
  - 構造生成・置換: `orch-todo-writer`（`mode=planner_replace_canonical`）
  - `status` 更新のみ: `orch-executor`（`mode=executor_update_statuses`）
- 型定義: `src/orchestrator-todo.ts` の `CanonicalTodo` / `CanonicalTodoFile`。
- 実際に書き出される形（`saveCanonicalTodos`）:

```jsonc
{
  "todos": [
    {
      "id": "T1-r1-setup-api",                  // 安定 Todo ID
      "summary": "R1 用の API エンドポイントを作成する", // 自然言語説明（日本語）
      "status": "pending" | "in_progress" | "completed" | "cancelled",
      "related_requirement_ids": ["R1", "R2-ui"]
    }
  ]
}
```

- 互換性のため、Reader 側は `CanonicalTodo[]` だけがトップにある配列形式も許容しているが、
  Orchestrator が自前で書き出す場合は上記オブジェクト形式が使われる。

### 11.4 status.json（orchestrator-loop 状態）

- パス: `$XDG_STATE_HOME/opencode/orchestrator/<task>/state/status.json`
- オーナー: `orchestrator-loop.ts`（`runLoop()` 内からのみ更新）
- 型定義: `src/orchestrator-loop.ts` の `OrchestratorStatus`。

`status.json` は、CLI（orchestrator-loop）が機械的に書き込むスナップショットのみを持つ、比較的
小さな JSON です。現時点で CLI が書き込んでいるフィールドは、次の通りです。

```jsonc
{
  "version": 1,
  "last_session_id": "sess-...", // 直近の opencode セッション ID
  "current_cycle": 3, // 現在のループステップ番号
  "last_executor_step": {
    "step": 3,
    "session_id": "sess-...",
    "step_todo": [
      {
        "id": "T1-r1-setup-api",
        "requirements": ["R1"],
        "description": "...", // `STEP_TODO` から抽出
        "from": "pending", // 旧ステータス（任意）
        "to": "completed", // 新ステータス（任意）
      },
    ],
    "step_diff": [{ "path": "src/api.ts", "summary": "add endpoint" }],
    "step_cmd": [
      {
        "command": "npm test",
        "command_id": "cmd-npm-test", // `STEP_CMD` の括弧内 / または null
        "status": "success", // 実際の文字列値（例）
        "outcome": "テスト成功", // 日本語サマリ
      },
    ],
    "step_blocker": [
      { "scope": "general", "tag": "need_replan", "reason": "..." },
    ],
    "step_audit": {
      "status": "ready",
      "requirement_ids": ["R1", "R2"],
    },
    "raw_stdout": "...", // Executor の生出力（全文）
  },
  "last_auditor_report": {
    "cycle": 3,
    "done": false,
    "requirements": [{ "id": "R1", "passed": false, "reason": "..." }],
  },
  "replan_required": false,
  "replan_reason": "...",
  "consecutive_env_blocked": 0,
  "proposals": [
    {
      "id": "p-...",
      "source": "executor", // または "auditor"
      "cycle": 3,
      "kind": "env_blocked", // 例: env_blocked / need_replan など
      "summary": "...", // 英文 or 日本語短文
      "details": "...", // 任意
    },
  ],
}
```

- 上記以外のフィールドは現時点では CLI からは書き込まれていません。スキーマ (`schema/status.json`) も
  この構造に合わせており、今後フィールドを追加する場合はまず CLI 実装側を更新してからスキーマを
  拡張する想定です。

### 11.5 spec-checker 結果 JSON（orch-spec-check 出力）

- `orch-spec-check` コマンドの標準出力として 1 行 JSON を返す。
- スキーマ: `agents/orch-spec-checker.md` に準拠。

```jsonc
{
  "status": "ok" | "needs_revision",
  "feasible_for_loop": true,
  "issues": [
    {
      "id": "I1-missing-requirements",
      "severity": "info" | "warning" | "error",
      "target": "acceptance-index" | "commands" | "command-policy" | "structure" | string,
      "summary": "...",           // 日本語の短い説明
      "suggested_action": "..."   // 日本語の改善提案
    }
  ]
}
```

### 11.6 preflight 結果 JSON（orch-preflight-runner 出力）

- `orch-preflight` コマンドの標準出力として 1 行 JSON を返す。
- スキーマ: `agents/orch-preflight-runner.md` に準拠。

```jsonc
{
  "status": "ok" | "failed",
  "results": [
    {
      "id": "cmd-npm-test",
      "command": "npm test",
      "role": "test",
      "usage": "must_exec",
      "available": true,
      "exit_code": 0,
      "stderr_excerpt": ""  // 失敗時は日本語で短く説明
    }
  ]
}
```

### 11.7 auditor 結果 JSON（orch-audit 出力）

- `orch-audit` コマンドの標準出力として 1 行 JSON を返す。
- スキーマ: `agents/orch-auditor.md` および `src/orchestrator-audit.ts` の `AuditSummary`。

```jsonc
{
  "done": true | false,
  "requirements": [
    {
      "id": "R1-some-requirement",
      "passed": true | false,
      "reason": "..."   // 任意・日本語説明
    }
  ]
}
```

- `orchestrator-loop` 側ではこの JSON そのものではなく、OpenCode のストリーミング JSON
  から抽出した `part.text` をさらに `JSON.parse` して上記オブジェクトを得ている。

### 11.8 orch_todo_read / orch_todo_write の戻り値 JSON

- 実装: `src/orchestrator-todo.ts`

```jsonc
// orch_todo_read の戻り値
{
  "todos": [
    {
      "id": "T1-...",
      "summary": "...",
      "status": "pending" | "in_progress" | "completed" | "cancelled",
      "related_requirement_ids": ["R1", "R2-ui"]
    }
  ]
}

// orch_todo_write の戻り値（成功時）
{ "ok": true }

// orch_todo_write / orch_todo_read のエラー時
{
  "ok": false,
  "error": "SPEC_ERROR: ..."
}
```

### 11.9 orchestrator セッションエクスポート JSON

- パス: `$XDG_STATE_HOME/opencode/orchestrator/<task>/logs/orchestrator_session_*.json`
  （`runLoop()` 終了時に `opencode export` の stdout をそのまま保存）。
- スキーマ: OpenCode セッションの内部表現であり、このリポジトリ側では詳細を前提にしていない。
  - そのため、ここでは「opaque（不透明）」な JSON として扱う。
  - 利用は主にデバッグ／トラブルシュート用途。
