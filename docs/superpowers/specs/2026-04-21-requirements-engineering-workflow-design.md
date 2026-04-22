# 要求工学ベースの Planner → Refiner → Spec-Checker 再設計

## 目的

OpenCode Orchestrator の計画フェーズを、要求工学の知見を使って再設計する。

狙いは次の 4 点である。

- ユーザー要求の曖昧さと解釈ブレを減らす
- 非機能要件、境界条件、禁止事項の抜け漏れを減らす
- 実行フェーズで詰む仕様を計画段階で落とす
- エージェントがユーザー承認なしにスコープ縮小や先送りをしないようにする

## 背景

現行設計では Refiner が質問と要件化の両方を多く担っている。
この構造は柔軟だが、次のリスクがある。

- 対話で確定すべき事項と、要求文に正規化すべき事項が混ざる
- Refiner が会話全体を再解釈し、ユーザー意図からずれる
- Spec-Checker が問題を見つけても、Planner と Refiner のどちらに戻すべきかが曖昧になる
- 未決事項や先送りが曖昧なまま残りやすい

このため、計画フェーズを次の 3 段階に明確分離する。

1. Planner: discovery 専任
2. Refiner: requirements engineering 専任
3. Spec-Checker: quality gate 専任

## 参考にした枠組み

この再設計では、次の公開情報を役割ごとに使い分ける。

- ISO/IEC/IEEE 29148
  - 要求工学プロセス、要求情報項目、内容と形式の基準
- NASA Systems Engineering Handbook
  - stakeholder expectations、technical requirements、verification と validation の分離、traceability
- SEBoK / INCOSE 系の要求工学整理
  - stakeholder needs、system requirements、requirements management
- EARS
  - 条件つき要求を崩れにくく書くための軽量構文
- Volere
  - 仕様テンプレート、fit criterion、traceability
- SEI QAW / quality attribute scenario
  - 非機能要件を刺激、環境、応答、応答尺度で具体化する方法
- ATDD / BDD / Specification by Example / Example Mapping
  - 対話、例、未解決質問、受け入れ条件を分離する方法

これらは LLM エージェントを直接対象にしたものではないが、対話、要求定義、監査の責務分離には有効である。

## 全体ワークフロー

### フェーズ 1: Planner

Planner は requirements writer ではなく、discovery coordinator とする。

責務:

- ユーザーと対話して要求、制約、優先順位、境界条件を確定する
- 代表例、境界例、失敗例、禁止例を引き出す
- 非機能要件が必要な場合は quality attribute scenario として具体化する
- 情報を次の 4 区分で整理する
  - user-stated requirement
  - repo-derived constraint
  - public best-practice candidate
  - resolved decision
- Refiner に渡す Discovery Packet を完成させる

Planner は canonical state の owner ではない。
Planner 自身は `acceptance-index.json`、`spec.md`、`command-policy.json.commands[]` の owner ではなく、これらを正本として編集しない。
ただし、`command-policy.json.summary` 配下の Planner-owned fields は strict readiness gate のために最終化できる。

### フェーズ 2: Refiner

Refiner は Planner の Discovery Packet を受けて、共有契約として必須な 3 項目を核にしつつ、要求工学の基準で canonical state に落とす。

責務:

- Discovery Packet を契約入力として扱う。ただし shared cross-agent contract として必須なのは `Resolved decisions`、`Explicit non-goals`、`Validation view` の 3 項目である
- 要求を atomic、testable、traceable に正規化する
- 必要に応じて EARS 風の構文、Volere の fit criterion、NASA / ISO の verification 観点で要求を書く
- `acceptance-index.json`、`spec.md`、`command-policy.json` を更新する
- verification path と validation view を明示する

Refiner は原則として新しい product decision を自分で足さない。
重要な意思決定が足りない場合は、推測せず Planner に戻す。

### フェーズ 3: Spec-Checker

Spec-Checker は存在確認ではなく、quality gate とする。

責務:

- requirements quality failure を検出する
- coverage failure を検出する
- feasibility failure を検出する
- unauthorized scope reduction を検出する
- failure の返し先を Planner か Refiner に分類する
- requirement と evidence、command、artifact の traceability を検査する
- verification と validation の両方が十分かを見る

## Discovery Packet

Planner から Refiner への中間成果物として `discovery-packet.md` を導入する。

この文書は人間との対話に使う自然言語と同じ言語で書く Markdown 文書とする。

### 共有契約としての必須項目

Planner が Discovery Packet を作るときに、Goal / North star candidate / In scope / Out of scope /
Constraints / Examples などの richer な材料を使うこと自体はよい。
ただし、Planner・Refiner・Spec-Checker 間で **共有契約として必ず一致していなければならない必須項目** は次の 3 つに絞る。

1. Resolved decisions
2. Explicit non-goals
3. Validation view

この 3 項目を cross-agent contract とし、それ以外の見出しや補助情報は Planner の discovery を助ける補助構造として扱う。

### Planner が埋めることを推奨する補助項目

1. Goal
2. North star candidate
3. In scope
4. Out of scope
5. Constraints
   - user-stated
   - repo-derived
   - environment-derived
6. Quality attribute scenarios
7. Examples
   - representative
   - boundary
   - failure or forbidden
8. Candidate splits proposed but not adopted
9. Trace seeds

### 質問ルール

Planner の質問は Discovery Packet の空欄を埋めるためだけに行う。

- 何となく要望を深掘りするための質問をしない
- current task に効く意思決定が閉じるまで終了しない
- 現在タスクに属する未解決事項を残したまま Refiner に渡してはならない

### Open decisions の扱い

未決のまま保持する open decision は作らない。

- current task に影響する決定は `must-resolve-now` とみなし、Planner フェーズで必ず閉じる
- 今回やらないと決めたものは open decision ではなく、明示的な out-of-scope として扱う
- 先送りは「未決事項」ではなく「別タスク候補」または「今回の non-goal」として構造化する

## スコープ縮小と先送りに関する禁止ルール

スコープ縮小はエージェントの裁量ではなく、ユーザー承認付きの要求変更である。

Planner、Refiner、Spec-Checker は次を守る。

- ユーザー未承認の scope reduction をしてはならない
- ユーザー未承認の non-goal 化をしてはならない
- ユーザー未承認の future task candidate 化をしてはならない
- ユーザー未承認の先送りをしてはならない

何かを current task から外す提案をする場合は、次を明示する。

1. 元要求
2. 現タスクに載せると不安定になる理由
3. 分割案または後続タスク案
4. ユーザーの明示承認

承認前の内容は `Resolved decisions` や `Explicit non-goals` に入れてはならない。

## フェーズごとの完了条件

### Planner 完了条件

- Goal と north star candidate がある
- In scope と out of scope が明示されている
- 制約が分類済みである
- 必要な quality attribute scenario がある
- representative、boundary、failure or forbidden example がある
- current task に効く意思決定がすべて解決済みである
- 未承認のスコープ縮小や先送りがない

### Refiner 完了条件

- `acceptance-index.json` に stable requirement ID がある
- requirement が atomic である
- 曖昧語が抑制されている
- verification path が requirement ごとに明示されている
- major requirement が goal、examples、constraints にトレースできる
- `spec.md` に次が含まれる
  - goal
  - confirmed facts
  - constraints
  - resolved decisions
  - explicit non-goals
  - verification strategy
  - validation view
  - traceability notes
- `command-policy.json` が requirement の verification と feasibility を支えている

### Spec-Checker 完了条件

Spec-Checker は、少なくとも次の失敗類型を判定する。

- `requirements_quality`
- `coverage`
- `feasibility`
- `unauthorized_scope_reduction`

また、各 issue について少なくとも次を返す。

- `failure_type`
- `return_to`
- `missing_trace`
- `validation_gap`

`severity` は人間向けの説明優先度には使ってよいが、機械的な loop readiness gate の正本にはしない。

## Spec-Checker の failure routing

Spec-Checker は issue を見つけたとき、差し戻し先を分類する。

- requirements quality failure → Refiner
- coverage failure のうち意思決定不足 → Planner
- coverage failure のうち文書化不足 → Refiner
- feasibility failure → 原則 Refiner
- feasibility failure のうち要求変更が必要なもの → Planner
- unauthorized scope reduction → Planner を第一返し先とし、必要に応じて Refiner も指摘する

## readiness gate の正本

Planner の readiness 判定は、単なる human-facing summary ではなく、
`orch-refiner → preflight-cli → orch-spec-checker` の呼び出しループを終えてよいかどうかを決める終了判定でもある。
したがって、この判定を prompt 上の説明だけに置かず、機械可読な state に正本として保存する必要がある。

この正本は `status.json` ではなく `command-policy.json.summary` に置く。

理由:

- `status.json` は executor / auditor の進捗や failure budget を保存する実行系スナップショットであり、planning gate の正本ではない
- loop 起動時の既存 gate も `command-policy.json` を読む構造であり、責務境界を保ちやすい
- planning 完了後に executor loop が参照すべき「この story は起動可能か」の single source of truth は command policy に置く方が自然である

## loop_status の意味の再定義

`command-policy.json.summary.loop_status` は、今後は単なる mechanical preflight result ではなく、
Planner が最終的に確定する **strict readiness gate** とする。

意味は次のとおり。

- `ready_for_loop`
  - current story state について、Planner が必要な Refiner / Preflight / Spec-Checker のループを完了済みであり、loop 開始の blocking 条件が残っていない
- `needs_refinement`
  - 仕様、受け入れ条件、traceability、validation、command-policy、または proposals に関して、まだ planning 側で解決すべき blocking 要素がある
- `blocked_by_environment`
  - current story を現環境で実行するための non-negotiable な must_exec command または同等の環境前提が満たせない

## readiness gate の機械判定

Planner は loop_status を決める際、少なくとも次の structured inputs を使う。

1. Spec-Checker の top-level 判定
   - `status`
   - `feasible_for_loop`
2. Spec-Checker の routed issue
   - `failure_type`
   - `return_to`
3. Preflight の mechanical result
   - `commands[].availability`
   - `available_helper_commands`
4. Planner が保持する unresolved proposal / blocking decision の有無

このとき `severity` は gate 条件に使わない。

### blocking の原則

- `status !== ok` は blocking
- `feasible_for_loop !== true` は blocking
- routed issue の `failure_type` が scope integrity / traceability / validation / command coverage の未解決問題を示している場合は blocking
- unresolved な gating proposal が残っている場合は blocking

Planner はこれらを統合して loop_status を決める。

## Preflight の責務

Preflight は引き続き command-policy の mechanical refresh を担当するが、
それ単独では `ready_for_loop` を確定しない。

Preflight が責務として持つのは次である。

- command availability の更新
- helper availability の更新
- mechanical な environment failure の検出

Preflight の結果だけで分かる範囲では `needs_refinement` または `blocked_by_environment` への downgrade はできるが、
Spec-Checker と proposal 状態を見ていない段階で `ready_for_loop` に上げてはならない。

## Planner が保存する summary 情報

loop 起動側が `command-policy.json` だけ読めばよいように、Planner は final gate を確定したとき、
`command-policy.json.summary` に spec-check の要約も保存する。

最低限、次の情報を持たせる。

- last spec-check の `status`
- last spec-check の `feasible_for_loop`
- blocking とみなした `failure_type` の一覧
- blocking issue id の一覧

これにより、runtime gate は `loop_status` を見るだけでよく、必要なら同じファイル内の summary から理由を追える。

## severity の位置づけ

Spec-Checker の `severity` は残してよいが、その役割は人間向け説明に限定する。

- Planner が人間へ説明するときの並び順
- summary でどの issue を先に説明するか
- UI 上の注意喚起の強さ

には使ってよい。

しかし、次には使わない。

- loop readiness の機械判定
- Planner ループ終了条件の正本
- runtime 側の start/stop gate

この設計により、「warning だが実は blocking」「error だが実害は軽い」といった LLM 由来のブレを gate から切り離せる。

## 文書と言語の方針

`discovery-packet.md` と `spec.md` は、人間との対話に使う自然言語と同じ言語で書く Markdown 文書とする。

ただし、次は ASCII / 英語固定とする。

- requirement IDs
- command IDs
- JSON field names
- file paths
- CLI commands
- schema keys

`acceptance-index.json` や `command-policy.json` の構造は機械可読性を優先するが、自然言語の説明欄は対話言語でよい。

## リポジトリへの反映対象

### `agents/orch-planner.md`

- Planner を discovery coordinator として再定義する
- Discovery Packet を完成させる責務を明記する
- current-task relevant decisions must all be resolved を完了条件に入れる
- unauthorized scope reduction と unapproved deferral を禁止事項に入れる
- readiness を high-severity issue の有無ではなく、`status` / `feasible_for_loop` / routed `failure_type` / unresolved proposal に基づいて判定するよう更新する
- `command-policy.json.summary.loop_status` を Planner が確定する strict gate として説明する

### `agents/orch-refiner.md`

- Planner Discovery Packet を契約入力として扱う
- 質問の主役ではなく、requirements engineering の主役として定義する
- atomicity、fit criterion、traceability、validation view を強化する
- `spec.md` に resolved decisions、explicit non-goals、validation view を必須化する

### `agents/orch-spec-checker.md`

- unauthorized scope reduction を failure type に追加する
- missing validation と missing trace from discovery inputs を見る
- `failure_type`、`return_to`、`missing_trace`、`validation_gap` を JSON 出力に追加する
- `severity` は explanatory only であり、mechanical gate の正本ではないことを明記する

### `agent-roles.md`

- Planner 主導 discovery
- Refiner の contract-normalization role
- Spec-Checker の routed failure model
- strict readiness gate は `command-policy.json.summary` に保存し、`status.json` へは逃がさない
  を反映する

### `README.md`

- 計画フェーズを Planner → Refiner → Spec-Checker の順で説明し直す
- Planner が discovery を主導することを利用者向けに明示する
- `command-policy.json.summary.loop_status` が strict readiness gate であり、Preflight 単独では `ready_for_loop` を確定しないことを明記する

## 変更しない前提

- canonical state の owner は引き続き Refiner とする
- Planner は gate coordinator の役割を失わないが、質問責務は強く持つ
- Spec-Checker は read-only を維持する
- 実行フェーズの Todo-Writer / Executor / Auditor の責務分離は基本維持する

## 想定される効果

- Planner で意思決定を閉じてから Refiner に渡すため、意図の再解釈が減る
- Discovery Packet により、会話ログ依存が減る
- EARS、Volere、NASA / ISO の観点により、要求の曖昧さと検証不能性が減る
- Spec-Checker が差し戻し先を明示するため、修正ループが短くなる
- unauthorized scope reduction を違反として扱うことで、勝手な先送りを防げる

## 実施順序

1. `agents/orch-planner.md` を更新する
2. `agents/orch-refiner.md` を更新する
3. `agents/orch-spec-checker.md` を更新する
4. `agent-roles.md` を更新する
5. `README.md` を更新する
6. Discovery Packet をどの state path に置くかを確定し、必要なら関連コードや説明を更新する
7. strict readiness gate の保存先と更新責務を `command-policy.json.summary` に統一する

## 未決ではなく、実装時に確定すべき細部

本設計で合意済みだが、実装時に具体文字列を決める必要がある事項は次の通り。

- `discovery-packet.md` の canonical path
- Planner から Refiner へ Discovery Packet をどのように参照させるか
- Spec-Checker の JSON schema に追加する field の厳密形
- `acceptance-index.json` の description 文言を多言語許容に変えるかどうか

今回さらに具体化した事項:

- strict readiness gate の正本は `status.json` ではなく `command-policy.json.summary` に置く
- `severity` は explanatory only とし、機械 gate は `status` / `feasible_for_loop` / routed `failure_type` に寄せる
- Preflight は mechanical refresh を担当するが、単独では `ready_for_loop` を確定しない

これらは設計方針を変える open decision ではなく、合意済み方針を実装へ落とす際の具体化項目である。
