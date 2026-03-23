# トラブルシューティング（構想）

このドキュメントは、`opencode-orchestrator loop` 実行時のトラブルシューティングドキュメントを将来追加するための「目的・想定内容・追加タイミング」を整理した構想メモです。

## 目的

- 実行時に起きがちな失敗を、ユーザーが自力で切り分けできるようにする
- エラーの再現条件・確認ポイント・解決手順を短く提示する

## 想定内容（例）

- `opencode-orchestrator: command not found`
  - 対処: `npx opencode-orchestrator ...` を使う / npm の bin が PATH に入っているか確認

- 状態ディレクトリを作れない（権限/パス問題）
  - 対処: `$XDG_STATE_HOME` の場所と権限を確認、必要に応じて手動作成

- ループが開始できない（`command-policy.json` がない / gate で拒否される）
  - 対処: Planner/Refiner/Preflight の計画フェーズを先に実行し、`command-policy.json.summary.loop_status` を確認

- `max-loop` 到達で終了する
  - 対処: Auditor の未達要件を見てタスクを分割/要件を明確化、必要なら `--max-loop` を増やす

- `--continue` で継続できない（セッション ID / status.json の整合）
  - 対処: `status.json.last_session_id` の確認、`--session <id>` の明示指定

## 追加タイミング（結論）

**今回は追加しない（実践知が溜まった段階で追加する）。**

根拠:

- 現時点では pre-release であり、実運用での「よくある失敗」の蓄積が少ない
- 先に実装・運用を回し、実例ベースで内容を固めたほうが価値が高い

推奨タイミング:

- 1.0 到達後、または一定期間の運用で recurring issue が見えた時点
- CI/環境差分（Windows/Linux）に起因する問題が複数回出た時点
