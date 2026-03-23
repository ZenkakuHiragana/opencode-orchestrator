# ADR-001: Executor でのシェルスクリプト組み立て許可

- **日付**: 2026-03-23
- **ステータス**: Accepted
- **関連ファイル**: `agents/orch-executor.md`

## 文脈（Context）

オーケストレーターの Executor エージェントは、command-policy.json にホワイトリストされたコマンドを実行して調査・検証を行う。従来の設計では、テンプレート化されたコマンド（例: `rg {{pattern}} {{subdir}} -n`）のプレースホルダー値を Executor が選択して実行することは許可されていたが、**パイプやサブシェルなどのシェル演算子を使って複数コマンドを合成することは明示的に禁止**されていた。

> do not introduce additional shell operators (pipes, `&&`, redirections, etc.) or change the base CLI.
> — `agents/orch-executor.md` 旧 L534

この制約により、Executor は以下のような典型的な調査パターンを実行できなかった：

- API 列挙: `rg "export" src/ | grep "function" | sort | uniq`
- 差分比較: `cat index.md | grep "^## " | sed 's/^## //' > /tmp/needed.txt` + `ls docs/ | sed 's/\.md$//' > /tmp/have.txt` + `comm -23 /tmp/needed.txt /tmp/have.txt`
- 複数ファイル横断の集計: `for f in src/*.ts; do rg "export" "$f" -c; done | sort -t: -k2 -n`

その結果、ドキュメント作成系の todo で「まず API を調べてから書く」という作業が、確認ループ（read → 確認 → read → 確認）に陥り、Executor が `need_replan` を発行する問題が発生していた。

## 決定事項（Decision）

**Executor は command-policy.json のホワイトリストに載っているコマンドだけでシェルスクリプトを組み立ててよい。**

具体的には以下のシェル構文を許可する：

- パイプ: `|`
- コマンド接続: `&&`, `||`
- サブシェル: `$(...)`, `` ` ``
- 変数代入: `VAR=$(cmd)`, `export VAR=value`
- 制御構文: `for`, `while`, `if ... fi`, `case ... esac`
- グループ化: `{ ... }`, `( ... )`

以下は引き続き禁止する：

- `bash`, `sh`, `python`, `pwsh` など汎用インタプリタによる迂回
- command-policy.json にリストされていないコマンドの使用

## 根拠（Rationale）

### OpenCode の権限システムは AST ベースで個別検証する

OpenCode の bash ツールは **tree-sitter-bash**（WebAssembly ビルド）でコマンド文字列をパースし、AST 内の全 `command` ノードを再帰的に列挙して個別に権限チェックする。

```
"grep foo bar | sort | uniq -c"
  → tree-sitter AST
    ├─ command: "grep foo bar"      → "grep *" ルールと照合
    ├─ command: "sort"              → "sort *" ルールと照合
    └─ command: "uniq -c"           → "uniq *" ルールと照合
```

この仕組みにより：

1. **パイプライン内の全コマンドが個別検証される** — `grep | sort | uniq` でも各コマンドがホワイトリスト照合される
2. **サブシェル内のコマンドも検証される** — `result=$(cat file | grep x)` の `cat` と `grep` も個別チェック
3. **制御構文内のコマンドも検証される** — `for f in *.txt; do cat "$f"; done` の `cat` もチェック
4. **合成スクリプトを事前登録する必要がない** — tree-sitter が構文を分解するので、Executor が実行時に組み立てたスクリプトでもそのまま検証できる

したがって「パイプやサブシェルを禁止する」は過剰な制約であり、禁止する理由がなかった。

### command-policy.json のホワイトリストによるガード

OpenCode の bash ツールの権限設定は、OpenCode 自身の権限コンフィグレーション（`permission.bash`）で制御する。デフォルトは `"*": "allow"` であり、明示的に `"*": "ask"` 等を設定しない限りすべてのコマンドが許可される。これは command-policy.json とは独立した OpenCode 側の設定である。

したがって、シェルスクリプト組み立ての安全性は **command-policy.json のホワイトリスト** に依存する。Executor が組み立てられるコマンドは command-policy.json に列挙されたものに限られ、ホワイトリスト外のコマンドは Executor のエージェントプロンプトで使用を禁止している。OpenCode の権限設定で `ask` や `deny` を設定している環境では、さらにホワイトリスト外のコマンドがブロックされるが、この ADR の決定はデフォルトの `allow` を前提としている。

### 代替案の検討

| 代替案                           | 問題点                                                           |
| -------------------------------- | ---------------------------------------------------------------- |
| 現状維持（シェルスクリプト禁止） | Executor が調査をループする。Todo の分割が必要になる             |
| ヘルパーコマンドを事前定義       | 必要な操作を列挙し切れず、Executor の自発性が損なわれる          |
| investigate todo で分割          | フェーズ数が増える。実装フェーズでもコマンド組み立てが必要になる |

## 影響（Consequences）

### ポジティブ

- Executor が実行時に必要な調査を自発的に組み立てられる
- 「列挙 → 作成」系の todo が `intent: implement` のまま完遂できる（investigate フェーズの分離が不要になるケースがある）
- Refiner / Spec-Checker の計画立案がコマンド合成の可能性を加味できる

### ネガティブ / リスク

- **OpenCode のデフォルト権限が `allow`** — 明示的に `permission.bash."*": ask` 等を設定しない限り、command-policy.json のホワイトリスト外のコマンドも実行可能になる。シェルスクリプト組み立ての安全性は Executor のエージェントプロンプトでの禁止ルールに依存するため、プロンプト・インジェクション等で Executor の判断が狂った場合に任意コマンド実行のリスクがある。必要に応じて OpenCode 側の権限設定で `ask` や `deny` を設定することを推奨する。
- **既知バグ: インライン環境変数バイパス** — `CI=true grep pattern file` は `"grep *"` ルールにマッチしない（Issue #16075）。Executor に環境変数プレフィックスを使わせない運用で対応。
- **heredoc 内のコマンドは検出されない** — `bash <<SCRIPT ... SCRIPT` の中身はチェックされないが、`bash` が Executor プロンプトで禁止されているため実害なし。
- **Executor の判断力への依存** — 有用なスクリプトを組み立てられるかは Executor の能力に依存。スクリプト組み立てが不適切な場合は `need_replan` で検出される。

## 参考リンク（References）

- **tree-sitter-bash によるコマンドパース**: `packages/opencode/src/tool/bash.ts` — [anomalyco/opencode (dev branch)](https://github.com/anomalyco/opencode)
- **権限評価ロジック**: `packages/opencode/src/permission/evaluate.ts`
- **ワイルドカード照合**: `packages/opencode/src/util/wildcard.ts` — `*` が0文字以上の任意の文字にマッチ、末尾 ` .*` はオプショナル
- **リダイレクト対応 PR**: [#6737](https://github.com/anomalyco/opencode/pull/6737)（2026-01-30 マージ）— `redirected_statement` のフルテキストを照合に使用
- **既知バグ（インライン環境変数バイパス）**: [#16075](https://github.com/anomalyco/opencode/issues/16075) — `CI=true git commit` が `"git *"` にマッチしない
- **コマンドアリティ**: `packages/opencode/src/permission/arity.ts` — `BashArity.prefix()` が「人間に理解しやすいコマンドプレフィックス」を抽出
- **Executor エージェント定義**: `agents/orch-executor.md`（本リポジトリ）
- **command-policy スキーマ**: `schema/command-policy.json`（本リポジトリ）
