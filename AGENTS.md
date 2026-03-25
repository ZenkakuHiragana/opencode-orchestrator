# OpenCode Orchestrator Plugin エージェント向けルール

このファイルは、OpenCode / 他のエージェント実行系がこのリポジトリで作業するときの共通ルールです。
実際のアプリケーションロジックは別リポジトリ側にあり、このリポジトリは「オーケストレータ制御用スクリプトとツール」のみを持ちます。

## ビルド / Lint / テスト

- ビルド
  - `package.json` / `tsconfig.json` はリポジトリルートにあります。
  - CLI とプラグインは `src/**/*.ts` からビルドされます。
  - 依存関係のインストール: `npm install`
  - TypeScript ビルド: `npm run build`
  - ビルド成果物は `dist/cli.js`（CLI）と `dist/index.js`（プラグイン）です。

- `.opencode` 配下
  - `.opencode` はプロジェクトごとの OpenCode 設定ディレクトリとして扱います。
  - `.opencode/tools/*.ts` は OpenCode 側が bun/ts-node 相当で解釈する前提で、個別に `tsc` する必要はありません。

- ローカル開発用 CI ラッパ (`test-harness` ツール)
  - `.opencode/tools/test-harness.ts` は、別リポジトリの CI スクリプトを叩くためのラッパツールです。
  - Linux 側では `scripts/linux_ci.sh`、Windows 側では `scripts/windows_ci.ps1` を呼び出す想定です（本体はこのリポジトリにはありません）。

- 推奨 Orchestrator ループ起動コマンド
  - `npx opencode-orchestrator loop --task <task-key> "...大きな目標..."`

- コード整形: `npm run format` ... **ビルド前に整形をお願いします。**
- 単一テストの実行: `npm test`

- カスタムコマンド
  - `orch-todo-write`, `orch-exec`, `orch-audit`, `orch-refine`, `orch-spec-check`, `orch-preflight` などが `commands/*.md` に定義されており、プラグインから自動登録されます。
  - CLI からは `opencode run --command orch-todo-write ...` のように呼び出します。

## コードスタイル / 設計ガイドライン

このリポジトリの TypeScript / シェル / PowerShell コードは、OpenCode プラグインおよびオーケストレータ用ユーティリティとして書かれています。以下の指針に従ってください。

- 一般方針
  - 変更は「最小限で意味のある差分」を心がけ、1 ステップで関連する処理をまとめて編集します。
  - Orchestrator / Refiner / Spec-Checker / Preflight-Runner / Todo-Writer / Executor / Auditor の責務分担は崩さず、役割をまたぐ機能追加は慎重に行います。
  - ログ/エラーメッセージは日本語メイン・英語補助の現在のスタイルを踏襲してください。
  - システムプロンプトとカスタムコマンドに記載するプロンプトは英語で書いてください。
  - システムプロンプトやカスタムコマンド本文には、デプロイ先エージェントから見て解決不能なローカルファイルパスを直接書かないでください。特に `resources/helper-commands.json` のようなパスは記載禁止です。helper command の内容が必要な場合は、TypeScript 側で JSON オブジェクトをプロンプトへ埋め込んで渡してください。

- TypeScript（`src/**/*.ts`)
  - モジュール構造
    - ルートの CLI/プラグインは NodeNext (ESM) を利用しています。`import fs from "node:fs"` のように `node:` プレフィックスを使用します。
    - OpenCode ツールは `import { tool } from "@opencode-ai/plugin/tool";` のようなトップレベル import を使います。
    - 内部モジュールを import するときは、`./autocommit.js` のように `.js` 拡張子まで書きます（NodeNext の制約）。
  - 型
    - `tsconfig.json` は `strict: true` です。暗黙の `any` を避け、パブリックな戻り値や外部とのインターフェースには明示的な型を付けます。
  - エラーハンドリング
    - ツールは失敗時に `{ ok: false, error, details }` を返す方針で、呼び出し側が判定しやすい形にします。
    - CLI は致命的なエラー時に非 0 の exit code を返すようにし、`stderr` に人間向けメッセージを出します。
  - 文字列 / ログ
    - 変数展開が必要なログはテンプレートリテラル（バッククォート）を使用します。
    - UTF-8 前提で、日本語ログと英語ログの混在を許容します。
  - フォーマット
    - インデントは 2 スペース、セミコロンあり。
    - シングル/ダブルクォートは既存コードのスタイルに合わせます（このリポジトリではダブルクォート多め）。

## 5. 命名規則

- ファイル名
  - ツール: `my-custom-tool.ts` のように `kebab-case`。
  - エージェント: `orch-refiner.md`, `orch-executor.md` など単純な小文字名。`orch-` で始める。
  - シェル / PowerShell: `orchestrator-loop.sh`, `Start-Orchestrator.ps1` のように用途を明確にします。

- 変数名 / 関数名
  - TypeScript: `camelCase`（例: `buildAuthFromEnv`, `extractImageLinks`）。クラス/インターフェースは `PascalCase`。
  - Bash: `UPPER_SNAKE_CASE` で定数、`lower_snake_case` で関数名。一時変数は短い `i`, `tmp` などで構いませんが、ログに現れるものはわかりやすい名前にします。
  - PowerShell: `PascalCase`（例: `$RUN_ID`, `$SessionTitle`）。

- コミットガイドライン
  - 勝手にコミットはしないでください。指示があったときのみ許可されます。
  - コミットメッセージは `fix:`, `refactor:` などで始まる conventional commit style で、本文は英語、詳細コメントは日本語とします。

## 6. エラー処理とフェイルセーフ / Git 操作

- Orchestrator ループ
  - 旧シェル版 `orchestrator-loop.sh` は Orchestrator / Auditor のハングや安全装置トリップを検出し、ウォッチドッグ + timeout で保護します。
  - 新 CLI 版 `opencode-orchestrator loop` でも同様に `MAX_LOOP` / `MAX_RESTARTS` 相当の制御を行います。デフォルト値を変える場合は README とコメントを更新してください。
  - `status.json` には `replan_request` に加えて `failure_budget` も保存されます。`consecutive_verification_gaps` は `STEP_AUDIT: ready` に `STEP_VERIFY: ready` が伴わないケースのみ連続カウントし、通常の非監査ステップではリセットされます。
  - Executor プロトコルでは各 step で `STEP_INTENT:` と `STEP_VERIFY:` を必ず出力する前提です。ID 列はカンマ区切りで、`R1,R2` / `R1, R2` の両方を許容します。

## 7. エディタ / 補完ツールルール

- AI コーディングエージェントへの追加指示
  - Windows / PowerShell にまたがる処理では、文字コードとパス（WSL パス vs Windows パス）に注意し、PowerShell スクリプトには必ず `-Encoding UTF8` を指定します。
  - ローカルの `$XDG_STATE_HOME/opencode/orchestrator/<task-name>/logs` / `$XDG_STATE_HOME/opencode/orchestrator/<task-name>/state` は長期的な状態を持つため、手動編集や削除は慎重に行ってください（特に `acceptance-index.json` は他エージェントの前提になります）。

## 8. エージェントごとの「見えているもの」とプロンプト設計ガイド

プロンプトを編集するときは、「各エージェントから実際に見えている情報」と「見えていない情報」を明確に区別してください。
ここに書いていない前提を system prompt に書くと、将来の仕様変更や別リポジトリで破綻しやすくなります。

### 8.1 共通の前提

どの orchestrator エージェントも、実行時に見えている情報は概ね次の 4 つに限られます。

- 自分の system prompt 本文（`agents/<name>.md`）
- TypeScript 側から埋め込まれた JSON schema / 設定ブロック
- ホストが渡す system / developer / user メッセージ（タスク説明や高レベルゴール）
- ツール一覧と、そのツール経由で読めるファイル・コマンド結果

したがって、system prompt に書いてよい「事実」は、**この視野で観測可能なものだけ**です。

- OK 例
  - 「acceptance-index.json は `$XDG_STATE_HOME/opencode/orchestrator/<task-name>/state/acceptance-index.json` にある」
  - 「このエージェントは `read` / `glob` / `grep` を使ってリポジトリを読む」
  - 「この prompt の末尾に貼られた JSON schema に従って acceptance-index.json を書く」
- NG 例
  - 「AGENTS.md に書いてある〜」とだけ書いて、その内容を prompt 内に反映しない
  - 「社内ポリシーでは〜」のように、エージェントから参照できない前提を暗黙に使う

### 8.2 エージェントごとの視野と禁止事項（プロンプトを書くときのチェックリスト）

以下は、主要 orchestrator エージェントごとに「知っているもの / 読めるもの / 書けるもの」の実装事実を簡単にまとめたものです。
system prompt を編集する際は、ここから外れる権限を勝手に与えないようにしてください。

#### orch-planner（Planner）

- 主な読み取り対象
  - `$XDG_STATE_HOME/opencode/orchestrator/<task-name>/state/acceptance-index.json`
  - 同 `spec.md` / `command-policy.json` / `status.json`
  - リポジトリ内のコード／ドキュメント（`read` / `glob` / `grep`）
  - Spec-Checker / Preflight の結果 JSON（`task` ツール / `preflight-cli` 経由）
- 主な書き込み対象
  - 原則 **書かない**。唯一の例外として、`status.json.proposals` を空配列にするなど「proposal の整理」だけが許可されている（`src/orchestrator-agents.ts` の permission を参照）。
- 呼べるもの
  - `task` → `orch-refiner`, `orch-spec-checker`
  - `preflight-cli` ツール → Refiner が定義した command descriptors と helper commands について、permission.bash ルールをローカル評価し、`command-policy.json` の `availability` と `available_helper_commands`、`loop_status` を更新する。
  - `bash` → `npx opencode-orchestrator loop ...` のような CLI の起動のみ
- プロンプトで **やってはいけない指示**
  - `acceptance-index.json` / `spec.md` / `command-policy.json.commands[]` の内容を直接編集させる
  - Executor 用の具体的な実装手順や todo を列挙させる

#### orch-refiner（Requirements Refiner）

- 主な読み取り対象
  - 高レベルゴール（user/developer メッセージ）
  - `acceptance-index.json` / `spec.md` / `command-policy.json` / `status.json`（既存があれば）
  - リポジトリ全体（`read` / `glob` / `grep`）
  - `orch-local-investigator` / `orch-public-researcher` からの調査結果（`task` ツール経由）
- 主な書き込み対象（**唯一のオーナー**）
  - `acceptance-index.json`
  - `spec.md`
  - `command-policy.json.commands[]`（コマンド定義そのもの）
- プロンプトで **してはいけない指示**
  - コードやテスト、設定ファイルの編集（Refiner に `edit` / `bash` 権限は無い）
  - 他エージェント（Planner / Executor / Todo-Writer）のプロトコルや出力フォーマットを上書きするような指示

#### orch-todo-writer（Todo-Writer）

- 主な読み取り対象
  - `acceptance-index.json` / `spec.md`
  - `todo.json`（既存 canonical todo）
  - `status.json`（特に `replan_request`）
- 主な書き込み対象
  - `todo.json`（`orch_todo_write` ツール経由）
    - `mode=planner_replace_canonical` / `planner_add_todos` / `planner_update_todos` のみ
  - セッション Todo（`todowrite`）… UI ミラー用
- プロンプトで **してはいけない指示**
  - `acceptance-index.json` / `spec.md` / `command-policy.json` を変更させる
  - コード／テスト／ドキュメントの編集や `bash` コマンドの実行
  - 人間に質問させる（非対話エージェント）

#### orch-executor（Executor）

- 主な読み取り対象
  - `acceptance-index.json` / `spec.md` / `command-policy.json` / `todo.json` / （必要に応じて）`status.json`
  - リポジトリ内のコード／テスト／ドキュメント
- 主な書き込み対象
  - リポジトリ内のコード／テスト／ドキュメント（`edit` / `patch` / `write`）
  - orchestrator `artifacts/*.json`（`investigation_v1` / `verification_v1` などの schema）
  - `todo.json` の `status` / `result_artifacts`（`orch_todo_write(mode=executor_update_statuses)`）
  - セッション Todo（`todowrite`）
- プロンプトで **してはいけない指示**
  - `acceptance-index.json` / `spec.md` / `command-policy.json` や canonical todo 構造の変更
  - 人間への質問（Executor には human in the loop は居ない）
  - `git commit` や危険な `bash` コマンドの実行（command-policy.json と permission.bash が許可していないもの）

#### orch-auditor（Auditor）

- 主な読み取り対象
  - `spec.md` / `acceptance-index.json` / `status.json`
  - orchestrator `artifacts/*`（Executor が生成した JSON）
  - Git 差分／ログ、テストログなど（`bash` の read-only コマンド群）
- 書き込み対象
  - ファイルへの書き込みは一切しない
- 出力
  - 1 行 JSON `{ done, requirements[] }` のみ
- プロンプトで **してはいけない指示**
  - コードや state ファイルを変更させる
  - 他エージェントに「〜してもらう」ような依頼をさせる

#### preflight-cli（Preflight）

- preflight-cli ツール（TypeScript 実装）
  - Planner 専用ツール。Refiner が定義した command descriptors と helper commands について、OpenCode 設定から得られる `permission.bash` の実効ルールをローカル評価し、その結果を `command-policy.json` の `availability` と `available_helper_commands`、`loop_status` に反映する。
  - system prompt には **preflight-cli 自身の実装詳細**（ログファイルのパスなど）を書かない。Planner から見えるのは「preflight-cli を呼ぶと per-command の availability が分かり、command-policy.json が更新される」というレベルまで。

### 8.3 「この repo の事情」と「配布先での視野」を混同しない

- AGENTS.md や README は、この npm パッケージの開発者向けには便利ですが、実際のエージェント実行時には **見えていません**。
- system prompt で「AGENTS.md によると〜」とだけ書いても、実行時には参照できず役に立ちません。
  - 必要なルールは、system prompt にそのまま英語で書き下ろし、もしくは JSON schema として埋め込んでください。

### 8.4 「見えていないもの」に関する注意・禁止事項の書き方

- 禁止事項を書くときは、「エージェントから直接測定できる事実」に紐づけてください。
  - 良い例: "You MUST NOT modify acceptance-index.json; it is owned by the Refiner agent and is only exposed read-only to you via the read tool."（実際に `edit` 権限が無い）
  - 良くない例: "Follow the company security policy" のように、実行時にエージェントから参照できない抽象ルールだけを示す。

この節の目標は、「将来プロンプトをいじるときに、**どこまで書いてよくて、どこから先は危ないか**」を一目で思い出せるリファレンスにすることです。未知の前提を持ち込みそうになったときは、一度ここに立ち返ってから system prompt を編集してください。

## 8. システムプロンプト / コマンドテンプレート執筆ガイドライン

Orchestrator 用のシステムプロンプト (`agents/*.md`) やカスタムコマンドテンプレート (`commands/*.md`) を編集する際は、次の方針に従ってください。

### 8.1 言語に関するルール

- **システムプロンプト本文は英語のみで書いてください。**
  - 日本語で書かれたテキストをエージェントに出力させたい場合も、
    - `Write a short Japanese summary ...` のように「日本語で書かせること」を英語で説明します。
  - システムプロンプト内に日本語の自然文や日本語の例文（日本語のコードポイントを含む文字列）を直接書かないでください。
- このリポジトリの「日本語メイン」の方針はあくまで **この repo の開発者向けルール** であり、
  - npm パッケージとして配布された先のホスト環境に対して「日本語 UI を強制する」ものではありません。
  - エージェントの出力言語は、ホスト側の system / developer / user メッセージで上書きされ得る「デフォルト」として記述してください。

### 8.2 エージェントから見えない前提を持ち込まない

Orchestrator エージェントは npm パッケージとして任意のユーザーリポジトリにインストールされ、実行時に見える情報はおおむね次のものに限られます。

- このシステムプロンプト本文（`agents/<name>.md`）
- TypeScript 側から埋め込まれた JSON schema / 設定ブロック
- ホストが渡すメッセージ（上位の system / developer / user プロンプト）
- ツール一覧と、ホストワークスペース上のファイル / コマンド結果

したがって、プロンプトに書いてよい前提は **この視野で観測可能なものだけ** です。

- 次のような「見えないもの」を暗黙の前提にしてはいけません。
  - このリポジトリの `AGENTS.md` や内部ドキュメントにだけ書かれているポリシー
  - 「このリポジトリの global language policy」「会社のポリシー」など、エージェントからは参照できないルール
  - 過去バージョンでのみ存在した schema フィールド
- どうしてもその情報が必要な場合は、**実際にプロンプト本文か埋め込み JSON として書き下ろす** こと。
  - それができないなら、そのルールは system プロンプトには書かないでください。

### 8.3 「存在しない機能」「過去バージョン」の扱い

- 「今の schema / ツール定義に存在しない概念」は system プロンプトに登場させません。
  - 「以前はこうだった」「将来戻すかもしれない」といった履歴や仮定は、AGENTS.md や設計ドキュメント側にのみ書きます。
- 「将来導入されるかもしれない」機能について、先回りして conditional な文言
  - 例: `If you see any tool name that starts with ...` など
    を **schema / resources にまだ存在しない段階で** プロンプトに埋め込むことは避けてください。
  - 機能を本当に導入するタイミングで、そのバージョンのプロンプトもまとめて設計し直します。

### 8.4 条件付きルールの使い方

`If you see X ...` のような条件付きルールを使ってよいのは、次の条件を両方満たす場合だけです。

1. X が **現在のバージョンの resources / schema / ツール定義のどこかに存在する** こと。
2. X の有無がホストやタスクごとに変化し得る（ある run では見えるが、別の run では見えない）こと。

これに該当しない「架空の X」（過去専用の概念や、まだ導入されていない案）は、条件付きであっても system プロンプトには書きません。

### 8.5 パスや内部実装の露出を避ける

- 既存ルールのとおり、システムプロンプトやコマンドテンプレート本文には、
  デプロイ先エージェントから見て解決不能なローカルファイルパスを直接書かないでください。
  - 特に `resources/helper-commands.json` など、**この npm パッケージの内部構造に依存したパス**は記載禁止です。
  - 必要であれば TypeScript から JSON オブジェクトとして埋め込むか、schema を末尾に貼り付けます。

### 8.6 バージョンごとの一貫性

- システムプロンプトは「その時点の schema / ツール / プロトコル仕様」を正確に反映したスナップショットとして扱います。
  - 仕様が変わったら、そのバージョン用のプロンプトを **過去の記述に引きずられずに** 更新してください。
  - マイグレーションノートや「以前はこうだった」という説明は、AGENTS.md や report.md など開発者向け文書にのみ残します。
