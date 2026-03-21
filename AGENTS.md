# OpenCode Orchestrator Plugin エージェント向けルール

このファイルは、OpenCode / 他のエージェント実行系がこのリポジトリで作業するときの共通ルールです。
実際のアプリケーションロジックは別リポジトリ側にあり、このリポジトリは「オーケストレータ制御用スクリプトとツール」のみを持ちます。

## ビルド / Lint / テスト

- ルートの TypeScript ビルド
  - `package.json` / `tsconfig.json` はリポジトリルートにあります。
  - CLI とプラグインは `src/**/*.ts` からビルドされます。
  - ビルド手順:
    - 依存インストール: `npm install`
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

- Bash（`orchestrator-loop.sh` / その他スクリプト）
  - 冒頭で `set -euo pipefail` を使い、エラーを早期検出します。
  - 関数は `snake_case` で命名し、ローカル変数には `local` を付けます。
  - 引数パースには手書きの `case` 文を使い、`getopt` など外部依存は避けます。

- PowerShell（`Start-Orchestrator.ps1`）
  - `Set-StrictMode -Version Latest` と `$ErrorActionPreference = 'Stop'` を使い、エラーを例外に統一します。
  - パラメータには `[string]`, `[switch]` などの型を付け、`.SYNOPSIS`, `.PARAMETER` などのコメントベースヘルプを維持します。
  - 文字列はダブルクォート + 補間、複数行文字列は here-string (`@"` `"@`) を使います。

## 5. 命名規則

- ファイル名
  - ツール: `my-custom-tool.ts` のように `kebab-case`。
  - エージェント: `orch-refiner.md`, `orch-executor.md` など単純な小文字名。`orch-` で始める。
  - シェル / PowerShell: `orchestrator-loop.sh`, `Start-Orchestrator.ps1` のように用途を明確にします。

- 変数名 / 関数名
  - TypeScript: `camelCase`（例: `buildAuthFromEnv`, `extractImageLinks`）。クラス/インターフェースは `PascalCase`。
  - Bash: `UPPER_SNAKE_CASE` で定数、`lower_snake_case` で関数名。一時変数は短い `i`, `tmp` などで構いませんが、ログに現れるものはわかりやすい名前にします。
  - PowerShell: `PascalCase`（例: `$RUN_ID`, `$SessionTitle`）。

## 6. エラー処理とフェイルセーフ / Git 操作

- Orchestrator ループ
  - 旧シェル版 `orchestrator-loop.sh` は Orchestrator / Auditor のハングや安全装置トリップを検出し、ウォッチドッグ + timeout で保護します。
  - 新 CLI 版 `opencode-orchestrator loop` でも同様に `MAX_LOOP` / `MAX_RESTARTS` 相当の制御を行います。デフォルト値を変える場合は README とコメントを更新してください。

## 7. エディタ / 補完ツールルール

- AI コーディングエージェントへの追加指示
  - Windows / PowerShell にまたがる処理では、文字コードとパス（WSL パス vs Windows パス）に注意し、PowerShell スクリプトには必ず `-Encoding UTF8` を指定します。
  - ローカルの `$XDG_STATE_HOME/opencode/orchestrator/<task-name>/logs` / `$XDG_STATE_HOME/opencode/orchestrator/<task-name>/state` は長期的な状態を持つため、手動編集や削除は慎重に行ってください（特に `acceptance-index.json` は他エージェントの前提になります）。
