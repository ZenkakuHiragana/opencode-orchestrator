# ADR-002: 危険モードにおける既存権限システムとサンドボックス機構の関連

## Status

Accepted

## Context

orchestrator はもともと、次の 2 つの層でコマンドの安全性を担保している:

1. orchestrator 独自の command-policy.json
   - Planner/Preflight フェーズでこのリポジトリ固有の形式の
     `command-policy.json` が生成される。ここには「コマンド仕様と availability」
     が集約される。
   - ループ開始前に `enforceCommandPolicyGate` で検証し、must_exec コマンドが
     unavailable な場合などは loop を開始しない。これは orchestrator レベル
     のゲートであり、OpenCode 本体の権限システムとは別物である。

2. OpenCode 標準の permission.bash
   - OpenCode 本体が提供する標準の権限システム。`allow` / `ask` / `deny`
     をパターンマッチで決定する。
   - `preflight-cli` では `evaluateEffectiveBashPermission` によって command
     descriptor の安全性を評価し、short-circuit で probe を省略する設計に
     なっている。

`--dangerously-skip-command-policy` および `--bwrap-skip-command-policy` を導入
すると、1. の orchestrator 独自の layer を意図的にバイパスすることになる。
OpenCode 標準の permission.bash 自体は引き続き有効だが、bash ツールの挙動
や executor のプロンプトにどう反映させるかを慎重に設計する必要がある。

- orchestrator 独自の command-policy を外した状態で permission.bash を完全
  に無視すると、安全性と予測可能性が極端に低下する。
- 一方で、bash ツールの権限チェック (permission.bash に基づく挙動) をこの
  リポジトリ側で一から再実装するのも負債が大きい。

というトレードオフが生じる。

## Decision

危険モードにおける権限・サンドボックスの設計を、次のように整理する。

### 1. command-policy の扱い

- 両危険モード (`--dangerously-skip-command-policy` / `--bwrap-skip-command-policy`)
  では、CLI 側で `enforceCommandPolicyGate` をスキップする。
- さらに、Executor 用の `opencode run --command orch-exec` 子プロセスでのみ
  `OPENCODE_ORCH_EXEC_SKIP_COMMAND_POLICY=1` を env に設定し、プラグイン側で
  `orch-executor` エージェントの system prompt から `<command_policy>` ブロッ
  クを削除する。
  - これにより、Executor のプロンプトから「command-policy を唯一の真実と
    みなせ」という記述を消す。
  - Todo-Writer や Auditor など他のエージェントには影響を与えない。

### 2. permission.bash と bash pre-hook

- 危険モードでも OpenCode 標準の permission.bash の評価は維持する。具体的
  には:
  - Executor 用の opencode プロセス内で、`tool.execute.before` フックを用い
    て `bash` ツールの呼び出しをフックする。
  - preflight-cli でも利用している `evaluateEffectiveBashPermission` を呼び、
    `decision: allow|ask|deny` を判定する。
    -- その上で、危険モードでは次のように扱う:
  - `decision === "allow"` のコマンド: 実行許可 (後述の bwrap ラップ対象)。
  - `decision === "ask"` および `decision === "deny"` のコマンド:
    - Executor サンドボックスモードでは **すべて拒否** する。

### 3. Bubblewrap サンドボックス

- `--bwrap-skip-command-policy` のときのみ、Executor 用 `bash` の実行を
  Bubblewrap でラップする。
- ラップの方法は単純なプレフィックス付与ではなく、次の形に固定する:

  ```bash
  bwrap <args...> -- bash -lc '<元のコマンド列>'
  ```

  - こうすることで `ls | xargs rm` のようなパイプ付きコマンドでも、左辺と
    右辺の両方が bwrap 内の bash から起動される。
  - `bwrap ... ls | xargs rm` のようなプレフィックスだけでは右側の `xargs rm`
    がサンドボックス外で実行される可能性があるため、この形式を採用する。

- bwrap 引数は CLI 起動時 (`runLoop`) にのみ決定・検証する:
  - `bwrap --version` で存在確認。
  - `bwrap <args> -- true` で初期化テストを行い、失敗した場合はその場で
    Error を投げて loop 起動を中止する。
  - 検証済みの引数のみを `opts.bwrapArgs` に保存し、Executor ステップでは
    その値だけを env 経由で渡す。
  - 子プロセス側で `OPENCODE_ORCH_EXEC_BWRAP_ARGS` の JSON パースに失敗した
    場合も、サンドボックス無しには戻らず、ツール呼び出し自体をエラーとし
    て fail-fast する。

## Rationale

- orchestrator 独自の command-policy をバイパスする以上、OpenCode 標準の
  permission.bash を完全に無視するとセキュリティと予測可能性が極端に落ち
  る。少なくとも pattern ベースの allow/ask/deny 評価は継続して使うべきで
  ある。
- 一方で、Executor 用の危険モードでは human-in-the-loop の確認を挟む余地が
  なく、`ask` をそのまま実行すると「本来人間の確認が必要だったコマンド
  も黙って実行される」ことになる。OpenCode 本体の動作として、
  permission.bash が `ask` を返したコマンドを `opencode run` から非対話モー
  ドで実行しようとすると通常は内部で拒否相当になるが、この ADR では
  orchestrator 側でも明示的に `allow` 以外を拒否することで、危険モードに
  おける挙動をより分かりやすくしている。
- Bubblewrap は、permission.bash がカバーしきれない領域 (external_directory
  の不具合や path 解析の限界など) を補う「外側の安全装置」として機能す
  る。特に、`bwrap <args> -- bash -lc '<cmd>'` の形式を採用することで、パ
  イプや制御構文を含む複合コマンド全体をサンドボックスの内側に閉じ込め
  ることができる。

## Consequences

- Pros
  - 危険モードでも permission.bash のパターン評価を再利用するため、既存の
    権限設定との一貫性が保たれる。
  - Executor サンドボックスモードでは、`allow` 以外のコマンドをすべて拒否
    するため、許可範囲が明確かつ保守側が制御しやすい。
  - Bubblewrap により、ホスト FS やネットワークへの影響を一定範囲に閉じ込
    められる。

- Cons
  - permission.bash の AST ベース解析 (複合構文内でのコマンド抽出) を現時
    点では行っていないため、`evaluateEffectiveBashPermission` は 1 行全体に
    対してのみ適用されている。将来的に AST ベースの解析を導入して精度を
    上げる余地がある。
  - `ask` をすべて拒否する方針は元の bash ツールの挙動と異なるため、危険
    モードにおいてのみ仕様が変わる点に注意が必要である。
  - bwrap のデフォルト引数設計 (どこまで FS を見せるか) はバランスが難し
    く、今後の運用を見ながらチューニングが必要になる。
