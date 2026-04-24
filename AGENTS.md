# OpenCode Orchestrator Plugin エージェント向けルール

この文書は、このリポジトリで作業するエージェント向けの **repo-specific working agreement** です。
一般的なコーディング常識ではなく、この repo 固有の制約、所有境界、安全ルール、更新時の注意点をまとめます。

日常的な作業では、まず **「まず守ること」** と **「日常開発の流れ」** を読んでください。
プロンプトや command template を編集する場合だけ、後半の **「プロンプト設計ルール」** まで読めば十分です。

## この文書の役割

- 対象:
  - この repo のコード、ドキュメント、プロンプト、コマンドテンプレートを編集するエージェント
  - この repo の構造や ownership を短時間で確認したい開発者
- 主な役割:
  - 日常開発で守るべきルールをまとめる
  - 所有境界を崩しやすい箇所を明示する
  - prompt / command template を編集するときの落とし穴を防ぐ
- この文書が **直接は担わない** もの:
  - 実行時の system prompt の正本
  - デプロイ先エージェントがそのまま読める runtime contract

## まず守ること

以下は、この repo で作業するときの非交渉ルールです。

1. **勝手にコミットしない**
   - コミットは、ユーザーが明示的に依頼したときだけ許可されます。
   - `autocommit` ツールも opt-in 制です。`loop --commit` のような明示フラグ、または会話中の明示的なコミット依頼がある場合に限って使ってください。
2. **ビルド前に整形する**
   - `npm run format` を先に実行し、その後に `npm run build` を実行します。
3. **ユーザー向けログ文言は i18n 経由にする**
   - CLI / Orchestrator のログメッセージは、`src/i18n/messages.{ja,en}.ts` のメッセージ ID を `t("...")` 経由で出力してください。
   - `console.error("...日本語...")` のような生文言の直書きは避けてください。
4. **system prompt と custom command 本文は英語で書く**
   - 日本語の自然文を prompt 本文に直接書かないでください。
5. **prompt / command template に解決不能なローカルパスを書かない**
   - 特に `resources/helper-commands.json` のような、この npm パッケージ内部のパスを本文に埋め込まないでください。
   - 必要な情報は、TypeScript 側で JSON オブジェクトとして埋め込んで渡します。
6. **役割境界を崩さない**
   - Orchestrator / Refiner / Spec-Checker / Preflight / Todo-Writer / Executor / Auditor の責務をまたぐ変更は、意図を明確にして最小限に行ってください。

## 日常開発の流れ

### ビルド / テスト

- 依存関係のインストール: `npm install`
- 整形: `npm run format`
- TypeScript ビルド: `npm run build`
- テスト実行: `npm test`

ビルド成果物:

- `dist/cli.js` - CLI
- `dist/index.js` - プラグイン

### `.opencode` 配下の扱い

- `.opencode` はプロジェクトごとの OpenCode 設定ディレクトリとして扱います。
- `.opencode/tools/*.ts` は OpenCode 側が bun / ts-node 相当で解釈する前提です。
  個別に `tsc` する必要はありません。

### ローカル開発用 CI ラッパ

- `.opencode/tools/test-harness.ts` は、別リポジトリの CI スクリプトを叩くラッパです。
- Linux では `scripts/linux_ci.sh`、Windows では `scripts/windows_ci.ps1` を呼ぶ想定です。
- これらの本体はこの repo にはありません。

### 推奨ループ起動コマンド

- `npx opencode-orchestrator loop --task <task-key> "...大きな目標..."`

### カスタムコマンド

- `orch-todo-write`, `orch-exec`, `orch-audit`, `orch-refine`, `orch-spec-check`, `orch-preflight` などは `commands/*.md` に定義され、プラグインから自動登録されます。
- CLI からは `opencode run --command orch-todo-write ...` のように呼び出します。

## サーフェス別の編集ルール

### TypeScript (`src/**/*.ts`)

- ルートの CLI / プラグインは NodeNext (ESM) を使います。
  - `import fs from "node:fs"` のように `node:` プレフィックスを使います。
  - 内部モジュールの import では `./autocommit.js` のように `.js` 拡張子まで書きます。
- OpenCode ツールでは `import { tool } from "@opencode-ai/plugin/tool";` のようなトップレベル import を使います。
- `tsconfig.json` は `strict: true` です。
  - 暗黙の `any` を避け、公開インターフェースには明示的な型を付けてください。
- エラーハンドリング
  - ツールは失敗時に `{ ok: false, error, details }` を返す方針です。
  - CLI は致命的なエラー時に非 0 exit code を返し、`stderr` に人間向けメッセージを出します。
- 文字列 / ログ
  - 変数展開が必要なログはテンプレートリテラルを使います。
  - UTF-8 前提です。日本語ログと英語ログの混在は許容します。
- フォーマット
  - インデントは 2 スペース、セミコロンあり。
  - クォートは既存コードのスタイルに合わせます。この repo ではダブルクォートが多めです。

### Shell / PowerShell

- Bash
  - 定数は `UPPER_SNAKE_CASE`
  - 関数名は `lower_snake_case`
- PowerShell
  - 変数名は `PascalCase`
  - 文字コード指定が必要な書き込みでは必ず `-Encoding UTF8` を付けてください。
- Windows / PowerShell をまたぐ処理では、WSL パスと Windows パスの違いに注意してください。

### Prompt / command template

- 本文は英語で書きます。
- 実行時に見えない前提を持ち込まないでください。
- ローカルの内部パスを本文へ直書きしないでください。
- 存在しない schema、過去専用の概念、未導入機能を先回りして書かないでください。

詳しいルールは後半の「プロンプト設計ルール」を参照してください。

## 命名とコミット

### 命名規則

- ファイル名
  - ツール: `my-custom-tool.ts` のような `kebab-case`
  - エージェント: `orch-refiner.md`, `orch-executor.md` などの小文字名
  - シェル / PowerShell: 用途が分かる名前にする
- 変数名 / 関数名
  - TypeScript: `camelCase`
  - クラス / インターフェース: `PascalCase`
  - Bash: 定数は `UPPER_SNAKE_CASE`、関数は `lower_snake_case`
  - PowerShell: `PascalCase`

### コミット規則

- 勝手にコミットしないでください。
- conventional commits を使います。
  - 例: `fix:`, `refactor:`
- 本文は英語、詳細コメントは日本語にします。

## 運用と安全ルール

### ループと state の原則

- 旧シェル版 `orchestrator-loop.sh` は、Orchestrator / Auditor のハングや安全装置トリップを watchdog + timeout で保護します。
- 新 CLI 版 `opencode-orchestrator loop` でも、`MAX_LOOP` / `MAX_RESTARTS` 相当の制御を行います。
  - デフォルト値を変える場合は README とコメントも更新してください。
- planning gate のソース・オブ・トゥルースは `command-policy.json.summary` です。
- `status.json` は Executor / Auditor の進捗スナップショットであり、計画 readiness の最終判定を保持する場所ではありません。
  - Planner が `status.json` を触る場合も、proposal 解消や failure-budget cleanup に結びつく保守的な更新に限ります。

### Executor / Auditor プロトコル

- `status.json` には `failure_budget` も保存されます。
- `consecutive_verification_gaps` は、`STEP_AUDIT: ready` に `STEP_VERIFY: ready` が伴わないケースだけを連続カウントします。
  - 通常の非監査ステップではリセットされます。
- Executor プロトコルでは、各 step で `STEP_INTENT:` と `STEP_VERIFY:` を必ず出力する前提です。
- ID 列はカンマ区切りで、`R1,R2` と `R1, R2` の両方を許容します。

### skip-command-policy 系モード

`--bwrap-skip-command-policy` / `--dangerously-skip-command-policy` では、**execution-phase に `command-policy` という概念自体を露出してはいけません**。

- 対象:
  - `orch-todo-writer`
  - `orch-executor`
  - `orch-exec` command template
  - それらに添付する state ファイルや per-step prompt
- `command-policy.json` を添付しないだけでは不十分です。
  - `status.json`, `todo.json`, `spec.md`, `acceptance-index.json`, 追加 `--file` 入力, proposal summary, failure summary などを経由した語句・フィールド・要約のリークも防いでください。
- 次の語を execution-phase 側へそのまま渡さないでください。
  - `command-policy`
  - `command-policy.json`
  - `command_ids`
  - `command_id`
  - policy 由来の stale summary
- 必要なら、次のような中立表現へ書き換えます。
  - `explicit command metadata`
  - `available commands`
  - `host-permitted commands`
- 現行実装では `src/orchestrator-session.ts` 側でも skip-safe な一時添付ファイルを生成し、JSON から `command_id(s)` を落としつつ文字列中の `command-policy` を `command metadata` に書き換えています。
  - prompt だけ直して添付物を放置しないでください。
- 完了条件は「policy を無視する」ことではなく、**その概念を見せないこと**です。

### 長期 state の扱い

- ローカルの `$XDG_STATE_HOME/opencode/orchestrator/<task-name>/logs` / `$XDG_STATE_HOME/opencode/orchestrator/<task-name>/state` は長期状態です。
- 手動編集や削除は慎重に行ってください。
  - 特に `acceptance-index.json` は他エージェントの前提になります。

## Ownership クイックリファレンス

### 主要 owner

- Planner
  - 主に `discovery-packet.md` と `command-policy.json.summary` を扱う
  - strict readiness を最終化する
- Refiner
  - `acceptance-index.json`, `spec.md`, `command-policy.json.commands[]` の唯一のオーナー
- Spec-Checker
  - `acceptance-index.json` / `spec.md` / `command-policy.json` を read-only で監査する
  - routed failure を Planner または Refiner に返す
- Todo-Writer
  - `todo.json` の canonical structure を作る
- Executor
  - コード / テスト / ドキュメントを変更し、todo の status を更新する
- Auditor
  - ファイルは変更せず、監査結果だけを返す
- preflight-cli
  - permission.bash をローカル評価し、`commands[].availability` と `summary.available_helper_commands` を更新する

### やってはいけないことの要約

- Planner
  - `acceptance-index.json` / `spec.md` / `command-policy.json.commands[]` を直接編集させない
  - Executor 用の具体的実装手順を列挙させない
- Refiner
  - コードやテストを編集させない
  - 他エージェントのプロトコルを上書きさせない
- Spec-Checker
  - コードや state ファイルを変更させない
  - severity を machine gate として扱わせない
- Todo-Writer
  - `acceptance-index.json` / `spec.md` / `command-policy.json` を変更させない
  - コード編集や `bash` 実行をさせない
  - 人間に質問させない
- Executor
  - `acceptance-index.json` / `spec.md` / `command-policy.json` や canonical todo 構造を変更させない
  - 人間へ質問させない
  - 許可されていない危険な `bash` / `git commit` を実行させない
- Auditor
  - コードや state ファイルを変更させない
  - 他エージェントへの依頼をさせない

## プロンプト設計ルール

ここから先は、`agents/*.md` や `commands/*.md` を編集する場合に必要なルールです。
日常的なコード編集だけなら、ここより下は必要な箇所だけ参照してください。

### 実行時に見えているものだけを前提にする

どの orchestrator エージェントも、実行時に見えている情報は概ね次の 4 つに限られます。

- 自分の system prompt 本文
- TypeScript 側から埋め込まれた JSON schema / 設定ブロック
- ホストが渡す system / developer / user メッセージ
- ツール一覧と、そのツール経由で読めるファイル・コマンド結果

したがって、prompt に書いてよい「事実」は **この視野で観測可能なものだけ** です。

- 良い例
  - `acceptance-index.json` のパスを、実際にそのエージェントが read できる前提として書く
  - 利用可能なツールを明示する
  - prompt 末尾に貼った schema を根拠に出力フォーマットを指定する
- 悪い例
  - 「AGENTS.md に書いてあるので従え」とだけ書く
  - 社内ポリシーのような runtime で見えない抽象ルールを持ち込む

### この repo の事情と、配布先での視野を混同しない

- AGENTS.md や README は、この repo の開発者には見えますが、配布先で動くエージェントには見えていません。
- 必要なルールは、system prompt 本文か埋め込み JSON として実際に渡してください。

### 言語ルール

- **system prompt 本文は英語のみ** で書いてください。
- 日本語で出力させたい場合も、英語で指示してください。
  - 例: `Write a short Japanese summary ...`
- prompt 本文に日本語の自然文や日本語例文を直接書かないでください。
- この repo の「日本語メイン」は開発者向けルールであり、配布先のホストに日本語 UI を強制するものではありません。

### 見えない前提を持ち込まない

- 次のような情報を暗黙の前提にしないでください。
  - この repo の内部ドキュメントにだけ書かれている方針
  - 会社ポリシーなど、エージェントから参照できないルール
  - 過去バージョンだけに存在した schema フィールド
- 必要なら、prompt 本文や埋め込み JSON に実際に書き下ろしてください。

### 存在しない機能や過去専用概念を書かない

- 今の schema / ツール定義に存在しない概念は prompt に出しません。
- 「以前はこうだった」「将来戻すかもしれない」は開発者向け文書にだけ残してください。
- 未導入機能を `If you see X ...` のような条件文で先回りして書かないでください。

### 条件付きルールは、現在見えているものにだけ使う

`If you see X ...` のような条件付きルールを使ってよいのは、次の両方を満たす場合だけです。

1. X が **現在の resources / schema / ツール定義のどこかに存在する**
2. X の有無がホストやタスクごとに変わり得る

これに当てはまらない架空の X は、条件付きでも prompt に書かないでください。

### パスや内部実装を露出しない

- デプロイ先エージェントから解決不能なローカルパスを system prompt や command template に書かないでください。
- 特に `resources/helper-commands.json` のようなパッケージ内部パスは記載禁止です。

### バージョンごとの一貫性

- system prompt は、その時点の schema / ツール / プロトコル仕様を正確に反映したスナップショットとして扱います。
- 仕様が変わったら、古い説明に引きずられずに更新してください。

## 条件分岐レビューのチェックリスト

条件分岐を書くときは、次を確認してください。

1. この条件に必要な入力は、その分岐点で本当に見えているか
2. 別スキルや別エージェントの役割を前借りしていないか
3. 判定不能時の安全側デフォルトがあるか
4. 誤判定しても安全側に倒れるか
5. 曖昧語や価値判断語を、観測可能な条件に分解できているか

避けるべき条件の例:

- 別スキルの診断結果を前提にした分岐
- 他エージェントが所有する state の解釈結果を前提にした分岐
- task identity のような continuation 判定を、ファイルの存在だけで決める分岐
- `helps quality`, `clear enough`, `needs research`, `ready for implementation` のような曖昧語そのままの分岐

安全側デフォルトの例:

- 既定経路に留まる
- 1 問だけ確認する
- 先に診断スキルへ送る

## 補足: Preflight と skip-mode で特に崩してはいけないこと

### preflight-cli

- Planner 専用ツールです。
- Refiner が定義した command descriptors と helper commands について、plugin config hook で取り込んだ **実効 `permission.bash`** をローカル評価します。
  - global 設定 + executor agent 設定を含みます。
- permission が未定義なら OpenCode の permissive default に合わせて `allow` 扱いになります。
- strict readiness の最終判定は Planner が `command-policy.json.summary` に書きます。
  - `status.json` は planning gate のソース・オブ・トゥルースではありません。

### skip-mode の prompt 編集

- execution-phase 側では `command-policy` 概念を見せないことが要件です。
- prompt、command template、添付ファイル、state 要約のすべてを対象にリークを確認してください。
- block を削るだけでなく、block 外の語句や stale summary も確認してください。
