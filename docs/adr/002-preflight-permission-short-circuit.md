# ADR-002: preflight の権限短絡評価を一次判定の本流にする

- **日付**: 2026-03-24
- **ステータス**: Accepted
- **関連ファイル**: `src/preflight-cli.ts`, `src/index.ts`, `src/preflight-permission-store.ts`

## 文脈（Context）

`preflight-cli` は当初、各コマンド候補に対して `opencode run --command orch-preflight` を起動し、実行可能性を確認する設計だった。

しかし実運用では、複数コマンドを一度に評価する際に以下の問題が顕在化した。

- 権限由来の `ask` / `reject` が発生した時点で、レスポンスが途中で止まりやすい
- 単純な可否確認に対して `opencode run` の起動コストが大きい
- 失敗時の挙動がモデル出力とセッション制御に依存し、安定しない

このため、preflight の主目的（「実行前に危険/不可コマンドを弾く」）を達成するには、LLM 呼び出し前に CLI 側で確定判定できるものを短絡する方針が必要になった。

## 決定事項（Decision）

`preflight-cli` は、`config` フックで得た実効設定に基づき、`permission.bash` をローカル評価して可否を確定する。

- `src/index.ts` で `global.permission.bash` と `agent["orch-preflight-runner"].permission.bash` を取得し保存する
- `src/preflight-cli.ts` で `global + agent` の順でルールを合成し、最終判定する
- 判定結果が確定したコマンドは `opencode run` を呼ばずに結果を返す

評価ルールの要点:

- ワイルドカードは `*` / `?` を使用
- `last-match-wins`（後勝ち）
- 両レイヤ未設定時のみ `allow` をデフォルトとする
- レイヤが存在するのに未一致の場合は `ask` とみなす

## 根拠（Rationale）

- 実行可否の確認に LLM セッション起動を毎回使うのは高コスト
- `ask` を含む非対話実行は不安定で、途中停止の再現があった
- `permission.bash` ベースの判定は入力が明確で再現性が高い
- preflight で必要な情報は「実行可否」であり、自然言語推論は必須ではない

## 影響（Consequences）

### ポジティブ

- preflight の遅延が大幅に減る
- 権限由来の途中停止を回避しやすい
- 判定根拠（どのパターンに一致したか）を `stderr_excerpt` で明示できる

### ネガティブ / リスク

- OpenCode 本体の将来仕様変更に追従が必要
- `permission.bash` 以外の実行環境要因（バイナリ存在など）は、短絡時には検査しない

## 実装上の注記（Implementation Note）

現行実装では、`evaluateEffectiveBashPermission()` が常に確定判定を返すため、`src/preflight-cli.ts` 内の `opencode run --command orch-preflight` 実行分岐は**実質到達しない**。

この分岐は後方互換とロールバック容易性のために残置しているが、運用上はほぼデッドコードとして扱う。

将来的に次のいずれかを実施する。

- 1. 分岐を削除し、完全に権限短絡専用へ移行する
- 2. 明示フラグでのみ `opencode run` 経路を有効化する

## 参考（References）

### OpenCode 公開ドキュメント

- **Permissions**: [https://opencode.ai/docs/permissions/](https://opencode.ai/docs/permissions/)
  - ワイルドカード、`ask/allow/deny`、デフォルト挙動の説明
- **Config**: [https://opencode.ai/docs/config/](https://opencode.ai/docs/config/)
  - 設定のマージ・優先順位（global / project / env）に関する説明

### OpenCode 実装参照（anomalyco/opencode）

- **権限評価本体**: `packages/opencode/src/permission/evaluate.ts`
  - [raw](https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/opencode/src/permission/evaluate.ts)
- **permission 変換/merge/ask**: `packages/opencode/src/permission/index.ts`
  - [raw](https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/opencode/src/permission/index.ts)
- **agent 既定権限の注入**: `packages/opencode/src/agent/agent.ts`
  - [raw](https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/opencode/src/agent/agent.ts)
- **session 実行時の ruleset 合成**: `packages/opencode/src/session/prompt.ts`
  - [raw](https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/opencode/src/session/prompt.ts)
- **bash tool の permission 判定入力**: `packages/opencode/src/tool/bash.ts`
  - [raw](https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/opencode/src/tool/bash.ts)
- **`opencode run` の permission.asked 自動 reject**: `packages/opencode/src/cli/cmd/run.ts`
  - [raw](https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/opencode/src/cli/cmd/run.ts)

### 本リポジトリ内の変更箇所

- `src/preflight-cli.ts`
- `src/index.ts`
- `src/preflight-permission-store.ts`
- `tests/preflight-permission-shortcircuit.test.ts`
