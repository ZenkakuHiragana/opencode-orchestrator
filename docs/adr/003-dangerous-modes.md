# ADR-001: 2種類の危険モードの導入

## Status

Accepted

## Context

本リポジトリの orchestrator は、**orchestrator 専用の設定ファイルである**
`command-policy.json` に基づいて各フェーズで許可されたコマンドのみ実行す
る設計になっている。Planner/Preflight フェーズで生成された command-policy
は、Executor が利用できる helper コマンドやカスタムコマンドの上限を定め
ることで、安全性と再現性を担保する。

しかし、あるタスク群では数百個規模の API や機能群など、大量の要素に対す
る機械的な列挙・比較が必要となる。現行の command-policy では、こうした広
範な解析処理を記述するためのコマンドが十分に用意されておらず、Executor は
`env_blocked` を返し続けてループが進まない、という問題が観測された。

この問題に対して、開発者が「実験的に command-policy の制約を外したい」「
任意のシェルコマンドを試したい」というニーズがある一方で、完全に安全装置
を外すのは危険である。そこで、本リポジトリに 2 種類の危険モードを導入し、
開発者が意図的に使用した場合にのみ command-policy をバイパスできるように
することにした。

## Decision

CLI に次の 2 つのフラグを追加する:

- `--dangerously-skip-command-policy`
  - Planner/Preflight フェーズで生成された orchestrator 専用の
    `command-policy.json` のゲートをスキップする。
  - 計画フェーズで定義された「許可コマンド一覧」を無視し、Executor が
    **OpenCode 標準の権限システムである permission.bash の設定**のみを前
    提として自由にコマンドを構成できるようにする。
  - サンドボックスは行わない (素のシェル環境)。

- `--bwrap-skip-command-policy`
  - orchestrator 専用の `command-policy.json` のゲートをスキップする点は
    上記と同じだが、Executor ステップのみ Bubblewrap サンドボックス内で実
    行する。
  - Linux 環境でのみ有効とし、Windows では警告を出したうえで通常の
    command-policy 準拠モードにフォールバックする。
  - サンドボックス用の bwrap 引数は CLI 起動時に決定・検証し、引数が不正
    であればループを開始せずにエラーで終了する。Executor 実行中にサンド
    ボックスなしに戻ることはない。

追加仕様:

- `--dangerously-skip-command-policy` と `--bwrap-skip-command-policy` は相
  互排他とし、同時指定はエラーとする。
- 両フラグとも、Executor 用の `opencode run --command orch-exec` 子プロセスに
  `OPENCODE_ORCH_EXEC_SKIP_COMMAND_POLICY=1` を渡す。このフラグにより、
  Executor エージェントの system prompt から `<command_policy>` ブロックを
  削除し、**orchestrator 独自の** command-policy の制約をプロンプトレベル
  でも無効化する。
  - Executor 以外のエージェント (`orch-todo-write` や `orch-auditor` など)
    にはこの env を渡さない。

## Rationale

- 危険モードを 1 種類にまとめてしまうと、
  - 「サンドボックスなしで完全に自由な実行を許す」ケースと、
  - 「外部サンドボックスを併用しつつ freedom を増やす」ケース
    が混在し、安全性や意図が分かりにくくなる。
- `--dangerously-skip-command-policy` は、既存の permission.bash 設定だけを
  盾に「本当に何でもできる」モードであり、ローカルでの実験用途に限定して
  使うべきオプションであることを名前とヘルプで明示する。
- `--bwrap-skip-command-policy` は、同じく command-policy を外すが、
  Bubblewrap による FS/ネットワークの分離をかけることで、少なくとも
  ホスト環境全体への影響を抑える設計である。
- 両者を明確に分けることで、「どこまで守られていて、どこから先は自己責任
  なのか」を開発者が把握しやすくなる。

## Consequences

- Pros
  - 特定のタスクで command-policy の制約が強すぎる場合に、開発者が自己責
    任で制約を外す手段を得られる。
  - bwrap モードでは、Executor が任意コマンドを組み立てても、FS/ネット
    ワークの境界である程度の安全性を確保できる。
  - flags が明示的であるため、CI や本番で不用意に有効化されている場合に
    すぐ検知できる。

- Cons
  - `--dangerously-skip-command-policy` は name どおり非常に危険なモードで
    あり、誤用するとホスト環境を破壊する可能性がある。
  - `--bwrap-skip-command-policy` でも、サンドボックスのルートとして bind
    されたディレクトリ内の破壊は防げない (例: ワークツリーを `git reset
--hard` で巻き戻すなど)。これについては permission.bash の評価および
    今後の AST ベース解析で段階的に防御を強化する前提とする。
  - コードパスが増えるため、通常モードと危険モードで挙動が乖離しないよう
    テストと ADR による記録が必須になる。
