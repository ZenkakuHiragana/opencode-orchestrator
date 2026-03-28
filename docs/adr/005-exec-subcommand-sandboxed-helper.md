# ADR-005: `exec` サブコマンドによる制限付き helper 実行経路

- **日付**: 2026-03-29
- **ステータス**: Accepted
- **関連ファイル**: `src/cli.ts`, `src/cli-args.ts`, `src/exec-runner.ts`, `src/exec-ast-check.ts`

## 文脈（Context）

現行の Executor は、command-policy.json のホワイトリストと OpenCode 標準の
permission.bash に基づいてコマンド安全性を担保している（ADR-001）。また、
強い隔離が必要な場合は Bubblewrap によるプロセスレベルのサンドボックスを
利用できる（ADR-003, ADR-004）。

しかし次の問題が観測されている:

- 全件列挙、欠落検出、件数照合などの機械的処理において、Executor が
  read→確認→read のループに陥り、todo 単位の進行が遅くなる
- command-policy の helper コマンドだけで表現できる処理には限界があり、
  「大量反復」のtodo が `need_replan` を誘発する
- Executor の安全性が「LLM がプロンプト上の禁止ルールに従うこと」に
  依存しており、システムレベルの制限がない

これに対して、Executor が安全にスクリプトを実行できる経路を追加したい。
ただし任意の Node スクリプトを実行できるようにするのは危険であり、
厳格に制限された環境のみを提供する必要がある。

なお Node.js の permission model は補助的な制限としては有用だが、Node 自身が
「malicious code に対する security guarantee ではない」と明記している。
また `node:vm` も安全境界ではなく、policy manifest は deprecated 扱いである。
したがって安全性は Node の単一機能に依存せず、複数レイヤの組み合わせで担保する。

## 決定事項（Decision）

### 1. CLI に `exec` サブコマンドを追加する

```
npx opencode-orchestrator exec \
  --allow-fs-read "<abs-globs>" \
  --allow-fs-write "<abs-globs>" \
  --timeout <ms> \
  --max-output <bytes> \
  --file <helper.mjs>
```

OpenCode の permission.bash で許可するコマンドは、
`npx opencode-orchestrator exec --allow-fs-read ... --allow-fs-write ...`
を含む前方一致パターンとする。これにより `exec` の呼び出し自体だけでなく、
許可するファイルシステム範囲も permission.bash で制御できる。
Executor はこのコマンド経由でのみ helper を実行できる。

### 2. 実行方式は 3 レイヤ構成

1. **AST 前検査**: helper コードを acorn でパースし、禁止パターンを検出した
   時点で実行を拒否する。フェイルファストと実行前の明示的拒否が目的。
2. **Node permission model**: Node 24 以降では `--permission`、
   Node 20 系では `--experimental-permission` を自動選択する。
   `--allow-fs-read` / `--allow-fs-write` のみを指定し、
   `--allow-child-process` / `--allow-worker` / `--allow-addons` /
   `--allow-net` は付与しない。
3. **固定 SDK（スクリプト結合方式）**: runner が SDK 定義と helper コードを
   結合した一時スクリプトを生成し、`node --permission ...` で実行する。
   helper には SDK 経由でのみ API が見える。

### 3. SDK の内容

helper が利用できる API は次のみ:

- `node:fs/promises`（非同期 fs のみ。同期版は提供しない）
- `node:path`
- `argv`: `Object.freeze()` された引数配列（`process.argv` の代用）
- `readText(path)`, `writeText(path, content)`: 高レベル fs wrapper
- `readJson(path)`, `writeJson(path, data)`: JSON シリアライズ wrapper
- `stdinText()`: stdin 全読み込み
- `stdout`: `process.stdout` への参照
- `stderr`: `process.stderr` への参照
- `console`, `JSON`, `Buffer`, `TextEncoder`, `TextDecoder`

これらは結合スクリプトの先頭で定義・freeze され、helper コードは
末尾に展開される。

### 4. 禁止パターン（AST 検査）

AST 検査で次を検出した場合、実行を拒否する:

- `eval()`, `new Function()`, `Function()`: 動的コード生成
- `require()`, `import`（許可モジュール以外）: 任意モジュール読み込み
- `process`（SDK 経由の `argv` を除く）: プロセス制御・環境変数アクセス
- `globalThis`, `global`: グローバルアクセス
- `Reflect`, `Proxy`: サンドボックス回避の可能性
- `__proto__`, `constructor.constructor`: プロトタイプ汚染
- `child_process`, `worker_threads`, `net`, `http`, `https`, `vm`: 危険モジュール

### 5. スクリプト結合の具体的な手順

```
exec-runner.ts
  1. CLI 引数をパース
  2. --file で指定された helper を読み込み
  3. AST 検査を実行（禁止パターンの検出）
  4. 結合スクリプトを生成:
     // -- 前置: SDK 定義 --
     import { readFile, writeFile, readdir, stat, ... } from "node:fs/promises";
     import { join, resolve, relative, basename, dirname, extname } from "node:path";
     const argv = Object.freeze([...parsedArgv]);
     const __cwd = "...";
     const __artifactsDir = "...";
     async function readText(p) { ... }
     async function writeText(p, c) { ... }
     async function readJson(p) { ... }
     async function writeJson(p, d) { ... }
     async function stdinText() { ... }
     // -- 本体: helper コード --
     <helper の内容>
     // -- 後置: 結果の stdout 出力 --
  5. 一時ファイルに書き出し（権限許可範囲内のディレクトリ）
  6. node --permission --allow-fs-read=... --allow-fs-write=... combined.mjs
     を child_process.spawn で実行
  7. stdout / stderr / exit code を収集して返す
```

### 6. パス指定の原則

- `--allow-fs-read` / `--allow-fs-write` は **作業ディレクトリ基準の相対パス** に寄せる
- glob の使用は抑制し、必要な場合のみ限定されたパターンを使う
- symlink をなるべく避ける
- 成果物は専用の work dir / artifacts dir に集約する

Node permission model の wildcard や symlink 周りでは
2024 年から 2026 年にかけて問題修正が続いており、
広い wildcard や symlink を含むパス指定は回避する。

### 7. 使用しないもの

- **`node:vm`**: Node 公式が security mechanism ではないと明言している。
  初期実装では採用しない。AST 検査と permission model で十分とする。
- **policy manifest (`--experimental-policy`)**: deprecated 扱い。
  設計の中核に置くべきではない。
- **`process` の選択的許可**: Node 標準では `process` の一部だけを
  許可することはできないため、SDK 経由で `argv` 相当のみを提供し、
  `process` そのものへのアクセスを AST 検査で遮断する。

### 8. Bubblewrap との関係

`exec` は **通常経路** として位置づける。

現在 Bubblewrap は `<command_policy>` ブロックの削除によって実装されており、
Executor 自身は現在のモードが Bubblewrap 有効経路にあるかを知らない。
したがって Executor のプロンプトには実行経路の種類や Bubblewrap の存在を
一切示唆しない。経路の使い分けは Refiner と Spec-Checker が判断し、
CLI 側で透過的に処理する。

### 9. プロンプトの調整方針

#### Refiner

機械化の必要性だけでなく、どの実行経路を使うかを決める。

追加する判断軸:

- built-in helper/既存 command で足りるかを先に判断する
- `exec` が必要なら、`command-policy.json.commands[]` に明示的な
  `npx opencode-orchestrator exec ...` コマンド定義として書く
- `--allow-fs-read` / `--allow-fs-write` / timeout / helper purpose は
  その command 定義と `usage_notes` に寄せる
- path は workspace-relative を基本とし、`..` による上位ディレクトリ参照や
  repo 外への到達を禁止する
- task-wide な `helper_mode` / `helper_exec` のような別メタデータは持たず、
  command-policy を唯一の認可面にする

#### Spec-Checker

次を検査する:

- 全件網羅や監査が必要なのに、built-in/helper でも explicit な `exec`
  command でも到達経路がない
- `exec` command の read/write scope が広すぎる
- `exec` command が `..` や repo 外へ出る path を含んでいる
- built-in helper で足りるのに不要な `exec` command を定義している
- `exec` command の役割や成果物が acceptance/evidence に結び付いていない

#### Todo-Writer

- per-item の細粒度 ToDo を作らず、inventory / scaffold / enrichment / audit
  のバッチ ToDo にする
- `exec` を使う ToDo では `execution_contract.command_ids` で該当 command を参照し、
  completion boundary と artifact だけを ToDo 側に書く
- read/write scope や timeout を `execution_contract` に複写しない

#### Executor

実行経路の選択規則:

1. 既存コマンドで足りるならそれを使う
2. built-in helper で足りるならそれを使う
3. `command-policy.json.commands[]` に explicit な `exec` command があり、必要ならそれを使う
4. それでも足りない場合は blocker ではなく再計画要求

制約:

- 大量反復は停止理由ではなく機械化の合図
- `exec` の権限範囲を自分で広げてはならない
- approved な read/write root の中だけで helper を使う
- helper は成果物生成・列挙・集計・監査に限る
- repo 本体の大規模変更に helper を使わない

## 根拠（Rationale）

### Node permission model を主たる安全境界としつつ補完する

Node permission model は `--allow-child-process` 等のフラグ付与が
なければ危険 API を実行時にブロックする。これが主たるランタイム制約である。
ただし Node 公式は「malicious code に対する security guarantee ではない」と
明記しているため、AST 前検査でフェイルファストを、固定 SDK で
API サーフェスを制限することで多層防御とする。

### `process` を直接触らせない

`process` はグローバルであり、Node permission model だけでは
`process.argv` だけを許可して `process.env` や `process.exit()` を
遮断することはできない。したがって SDK 経由で `argv` 相当のみを提供し、
`process` 自体へのアクセスは AST 検査で禁止する。

### スクリプト結合方式（方式 A）の選択

SDK を helper に提供する方式として 3 つを検討した:

| 方式           | 概要                                            | 判断                                |
| -------------- | ----------------------------------------------- | ----------------------------------- |
| スクリプト結合 | runner が SDK 定義 + helper を結合して実行      | **採用**: 最もシンプル              |
| 動的 import    | helper を `.mjs` 配置し `await import()` で実行 | 不採用: モジュール解決が複雑        |
| グローバル注入 | `globalThis` に SDK を生やしてから実行          | 不採用: `globalThis` 禁止方針と矛盾 |

スクリプト結合はカスタム loader や module resolution の複雑さを
避けつつ、SDK 関数を helper のスコープに直接提供できる。

### DSL ではなく JS を許可する

宣言型 DSL は後回しとする。理由:

- Executor が必要とする処理（列挙、抽出、件数照合、欠落検出、雛形生成）は
  `fs/promises` と `path` と標準言語機能で賄える
- 専用処理（ffmpeg 等）は既存コマンドを Refiner が command-policy に載せる
- DSL を設計するコストに見合う利便性が Phase 1 では見込めない

## 影響（Consequences）

### ポジティブ

- Executor が大量反復を機械的に処理でき、todo の進行速度が向上する
- command-policy を壊さずに、LLM の従順性だけに依存しない実行経路を追加できる
- AST 検査 + permission model の 2 層で、プロンプトインジェクションによる
  任意コマンド実行リスクを大幅に緩和できる
- Bubblewrap は例外経路に固定できるため、Windows 環境でも
  制限付き helper の利用が可能になる

### ネガティブ / リスク

- AST 検査の誤検知（正当な helper を拒否する）と偽陰性（禁止パターンを
  見逃す）のバランスを運用で調整する必要がある
- Node permission model 自体の bypass 修正が継続しているため、
  Node バージョンの更新に追従する必要がある
- helper のデバッグが「通常の Node スクリプト」より難しくなる
  （利用可能 API が限定されているため）
- スクリプト結合方式では結合後のコードから `process` が
  名前空間上は見える。AST 検査と permission model の二重ガードで
  担保するが、理想的ではない

## 段階的導入

- **Phase 1**: AST 前検査 + Node permission model + 固定 SDK + スクリプト結合
- **Phase 2**: AST チェックの強化、SDK の拡充、運用観察に基づく調整
- **Phase 3 (optional)**: 宣言型 DSL サポート
  （JSON で操作列を定義する方式の検討）

## 参考（References）

### Node.js 公式ドキュメント

- **Permissions**: https://nodejs.org/api/permissions.html
- **Node.js 24.0.0 Release** (`--permission` への改名): https://nodejs.org/en/blog/release/v24.0.0
- **VM (executing JavaScript)**: https://nodejs.org/api/vm.html
- **Process**: https://nodejs.org/api/process.html
- **February 2024 Security Releases** (wildcard/symlink 問題): https://nodejs.org/en/blog/vulnerability/february-2024-security-releases

### 本リポジトリ内の関連 ADR

- ADR-001: Executor でのシェルスクリプト組み立て許可
- ADR-003: 2 種類の危険モードの導入
- ADR-004: 危険モードにおける既存権限システムとサンドボックス機構の関連
