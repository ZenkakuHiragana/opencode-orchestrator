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
  `orch-executor`, `orch-todo-writer` の system prompt から
  `<command_policy>` ブロックを削除する。
  - これにより、Executor, Todo-Writer のプロンプトから
    「command-policy にあるコマンド以外は実行禁止」という記述を消す。
  - Auditor など他のエージェントには影響を与えない。

### 2. permission.bash と Executor プロセス

- 危険モードでも OpenCode 標準の permission.bash の評価は維持する。
- Executor 用の `opencode run --command orch-exec ...` プロセスの内部で
  OpenCode 本体が提供する標準の bash ツールに処理を任せる。

### 3. Bubblewrap サンドボックス

- `--bwrap-skip-command-policy` のときのみ、Executor 用 `opencode` プロセスを
  丸ごと Bubblewrap でラップする。
- ラップの方法は次の形に固定する:

  ```bash
  bwrap <args...> -- opencode run --command orch-exec ...
  ```

  - こうすることで Executor プロセス内で動く bash/read/glob などの標準ツール
    がすべて同じサンドボックス環境と FS ビューを共有する。

- bwrap 引数は CLI 起動時 (`runLoop`) にのみ決定・検証する:
  - `bwrap --version` で存在確認。
  - `bwrap <args> -- true` で初期化テストを行い、失敗した場合はその場で
    Error を投げて loop 起動を中止する。
  - 検証済みの引数のみを `opts.bwrapArgs` に保存し、Executor ステップでは
    その値だけを `runOpencodeBwrap` に渡す。

## Alternatives considered

### A. Bash pre-hook での permission.bash 再実装 + per-command bwrap

かつては次のような構成も検討・実装されていた:

- Executor 用 `opencode run --command orch-exec ...` プロセスの内部で、
  `tool.execute.before` フックを使って OpenCode 標準の `bash` ツール呼び出しを
  フックする。
- 各 `bash` 呼び出しについて:
  - `evaluateEffectiveBashPermission` を呼び出し、`decision: allow | ask | deny` を
    判定する。
  - `decision === "allow"` のときのみ、`OPENCODE_ORCH_EXEC_BWRAP_ARGS` という env
    に格納した JSON から引数列を取り出し、
    `bwrap <args...> -- bash -lc '<元のコマンド列>'` という 1 行のシェルコマンドに
    書き換える。
  - `decision === "ask"` および `decision === "deny"` の場合は、Executor
    サンドボックスモードではすべて拒否する。
- これにより、危険モード時は「allow 判定された `bash` コマンドだけが bwrap 内
  で実行される」ことを狙っていた。

この案は最終的に採用しなかった。主な理由:

- OpenCode 本体がすでに permission.bash を解釈しているにもかかわらず、この
  リポジトリ側でも同じロジックを再実装する形になり、将来の仕様変更時に乖離
  するリスクが高い。
- `bash` ツールだけを bwrap でラップし、`read` / `glob` / `apply_patch` など他
  のツールはホスト FS を見る構成になっていたため、`/tmp` を含むファイルシステ
  ムの見え方が Executor 内でねじれる（bash が `/tmp` に書いたファイルを
  `read` から見えない、など）。
- `OPENCODE_ORCH_EXEC_BWRAP_ARGS` を JSON で受け取り、行単位のシェル文字列に再
  エンコードする処理は実装負荷の割に安全性が限定的であり、プロセスレベルでの
  サンドボックスに比べてメリットが薄い。

代わりに、現在の設計では Executor 用 `opencode` プロセス全体を Bubblewrap で
ラップし、permission.bash の判定は OpenCode 本体に任せる方式を採用している。

## Rationale

- orchestrator 独自の command-policy をバイパスする以上、OpenCode 標準の
  permission.bash を完全に無視するとセキュリティと予測可能性が極端に落ちるた
  め、Executor プロセス内では必ず標準の bash ツール（permission.bash ベース）
  を使う。
- permission.bash の挙動をこのリポジトリ側で再実装するのではなく、「どのプロ
  セスの中で実行されるか」を制御することで安全性を高める方が、長期的な保守性
  が高いと判断した。
- Bubblewrap を Executor 用 `opencode` プロセスに対して丸ごとかけることで、
  bash / read / glob / apply_patch などが同じファイルシステムビューを共有し、
  `/tmp` を含むファイルシステムのねじれを避けられる。

## Consequences

- Pros
  - 危険モードでも permission.bash のパターン評価をそのまま再利用するため、
    権限設定の単一のソース・オブ・トゥルースを OpenCode 本体側に保てる。
  - Executor サンドボックスモードでは、Bubblewrap によりホスト FS やネット
    ワークへの影響を一定範囲に閉じ込められる。
  - Executor 内の bash / read / glob が同じサンドボックス内の `/tmp` 等を共有
    するため、「bash で書いて read で読む」といったパターンが素直に動く。

- Cons
  - Bubblewrap のデフォルト引数設計（どこまで FS を見せるか）は環境ごとのバ
    ランスが難しく、今後の運用を見ながらチューニングが必要になる。
  - 危険モードはいずれも orchestrator 独自の command-policy.json をバイパスす
    るため、「どのコマンドをいつ実行してよいか」の制約は開発者側の運用ルール
    に依存する。
