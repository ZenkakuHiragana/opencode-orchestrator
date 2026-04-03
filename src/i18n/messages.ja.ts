export const messagesJa = {
  "cli.root.usage":
    "使い方: opencode-orchestrator <subcommand> [options]\n" +
    "\n" +
    "よく使う高レベルサブコマンド:\n" +
    "  run        タスク用の orchestrator ループを開始 (短いエイリアス: ococ run)\n" +
    "  resume     最近のタスク/セッションを再開\n" +
    "  status     タスクの要約と次に行うべき操作を表示\n" +
    "  doctor     orchestrator 利用に必要な環境全体の診断を実行\n" +
    "  fix        特定タスクが進まない理由と次のアクションを説明\n" +
    "  completion bash/PowerShell 用の補完設定スニペットを生成\n" +
    "\n" +
    "詳細設定向けの低レベルサブコマンド:\n" +
    '  loop  --task <task-name> [--session <ses_...> | --continue] [--commit] [--max-loop N] [--max-restarts M] [--file <path>] "prompt..."\n' +
    "  list  [--json]   orchestrator タスク一覧または proposal 一覧を表示\n" +
    '  exec  [--allow-fs-read <path>] [--allow-fs-write <path>] [--file <path>] ["helper-source"]\n' +
    "  clear --task <task-name> --proposals [-y]   指定タスクの proposal を削除\n" +
    "  install [-g|--global]   OpenCode 設定ファイルにプラグインを追加\n" +
    "\n" +
    "共通オプション:\n" +
    "  -h, --help       このヘルプを表示\n" +
    "  -v, --version    バージョン番号を表示\n",

  "cli.root.unknown_subcommand":
    "[opencode-orchestrator] 不明なサブコマンドです: {subcommand}",

  "cli.root.fatal_error": "[opencode-orchestrator] fatal error: {message}",

  "cli.list.usage":
    "使い方: opencode-orchestrator list [--json] [--task <task-name> --proposals]\n" +
    "\n" +
    "orchestrator の状態ディレクトリに存在するタスク一覧を表示します。\n" +
    "\n" +
    "オプション:\n" +
    "  --json                タスク一覧を JSON 形式で出力する\n" +
    "  --task <name>         対象タスクを 1 つに絞り込む (--proposals と併用)\n" +
    "  --proposals           タスク一覧の代わりに指定タスクの proposal 一覧を表示する\n" +
    "  --open                proposal 一覧では status='open' のものだけ表示する\n",

  "cli.list.proposals.none":
    '[opencode-orchestrator] タスク "{task}" に proposal はありません。',

  "cli.list.proposals.header":
    '[opencode-orchestrator] タスク "{task}" の proposal 一覧:',

  "cli.list.error.base_missing":
    "[opencode-orchestrator] orchestrator タスク用のベースディレクトリが存在しません: {baseDir}",

  "cli.list.error.base_read_failed":
    "[opencode-orchestrator] orchestrator ベースディレクトリの読み取りに失敗しました: {message}",

  "cli.list.info.no_tasks":
    "[opencode-orchestrator] ベースディレクトリ配下に orchestrator タスクが見つかりませんでした: {baseDir}",

  "cli.list.status.ready_for_loop": "実行可能",

  "cli.list.status.needs_refinement": "計画の見直しが必要",

  "cli.list.status.blocked_by_environment": "環境の制約で実行できません",

  "cli.exec.usage":
    "使い方: opencode-orchestrator exec [options] [helper-source]\n" +
    "\n" +
    "制限付き helper スクリプトを実行します。helper-source を省略した場合は --file または stdin を使います。\n" +
    "\n" +
    "オプション:\n" +
    "  --allow-fs-read <path>   読み取りを許可する作業ディレクトリ基準の相対パス/グロブ (複数可)\n" +
    "  --allow-fs-write <path>  書き込みを許可する作業ディレクトリ基準の相対パス/グロブ (複数可)\n" +
    "  --timeout <ms>           実行タイムアウト (デフォルト: 30000)\n" +
    "  --max-output <bytes>     stdout/stderr 合計の最大収集量 (デフォルト: 65536)\n" +
    "  --file <path>            helper ソースファイルを指定する\n" +
    "  --arg <value>            helper 内で argv として見せる値 (複数可)\n" +
    "  --help, -h               このヘルプを表示する\n",

  "cli.loop.usage":
    "使い方: opencode-orchestrator loop --task <task-name> [options] [prompt]\n" +
    "\n" +
    "指定したタスクの Executor/Auditor ループを実行します。\n" +
    "\n" +
    "必須:\n" +
    "  --task <name>        実行するタスクキー (例: 'my-task')\n" +
    "\n" +
    "オプション:\n" +
    "  --session <id>      既存セッション ID を指定して継続する\n" +
    "  --continue           直近のセッションから継続する\n" +
    "  --commit             ループ完了時に autocommit を依頼する\n" +
    "  --max-loop <n>      最大ステップ数 (デフォルト: 100)\n" +
    "  --max-restarts <n>  safety 関連の再起動上限 (デフォルト: 20)\n" +
    "  --dangerously-skip-command-policy\n" +
    "    計画フェーズで決めたコマンド定義を無視して自由なコマンド実行を許可する。\n" +
    "    OpenCode の permission.bash 権限設定は引き続き適用される。\n" +
    "  --bwrap-skip-command-policy (Windows では利用不可)\n" +
    "    計画フェーズで決めたコマンド定義を無視して自由なコマンド実行を許可する。\n" +
    "    ただし、Executor 用の opencode run プロセス全体を Bubblewrap サンドボックス内で実行する。\n" +
    "    OpenCode の permission.bash 権限設定はサンドボックス内でもそのまま適用される。\n" +
    "  --bwrap-arg <arg>    bwrap に渡す追加引数 (複数指定可)\n" +
    "  --file, -f <path>   各ステップの opencode run に添付するファイル\n" +
    "  --help, -h          このヘルプを表示する\n" +
    "\n" +
    "末尾の prompt 引数は省略可能です。省略時は spec.md / acceptance-index.json を元にした既定プロンプトを使用します。\n",

  "cli.run.error.no_tasks_found":
    "[opencode-orchestrator] 実行可能な orchestrator タスクが見つかりません。まず Refiner/Todo-Writer で少なくとも 1 つタスクを用意してから run を使ってください。",

  "cli.run.error.multiple_tasks":
    "[opencode-orchestrator] 利用可能なタスクが複数あります。--task <タスク名> を指定してください。利用可能なタスク: {tasks}",

  "cli.run.error.unknown_task_with_suggestions":
    "[opencode-orchestrator] タスク '{input}' は見つかりませんでした。もしかして: {candidates} ?",

  "cli.run.error.unknown_task_no_suggestions":
    "[opencode-orchestrator] タスク '{input}' は見つかりませんでした。利用可能なタスクは 'ococ list' で確認できます。",

  "cli.run.error.missing_task":
    "[opencode-orchestrator] run コマンドを使うときは --task <タスク名> を指定してください。",

  "cli.run.info.not_ready_generic":
    "[opencode-orchestrator] このタスク向けの高レベル run はまだ実行の準備ができていません。現時点では計画フェーズを完了させたうえで 'ococ loop --task {task}' を直接実行してください。",

  "cli.resume.error.no_tasks_found":
    "[opencode-orchestrator] 実行可能な orchestrator タスクが見つかりません。まず Refiner/Todo-Writer で少なくとも 1 つタスクを用意してから resume を使ってください。",

  "cli.resume.error.multiple_tasks":
    "[opencode-orchestrator] 利用可能なタスクが複数あります。resume には --task <タスク名> を指定してください。利用可能なタスク: {tasks}",

  "cli.resume.info.not_ready_generic":
    "[opencode-orchestrator] 高レベル resume はまだセッション再開の準備ができていません。セッションの状態や次のアクションを確認するには 'ococ status --task {task}' や 'ococ fix --task {task}' を利用してください。",

  "cli.resume.info.not_ready_planning":
    "[opencode-orchestrator] このタスクのセッションは、計画フェーズや事前チェックが完了していないため再開できません。まず 'ococ status --task {task}' でタスクの状況を確認し、必要に応じて 'ococ fix --task {task}' や 'ococ doctor' を実行してください。",

  "cli.resume.info.not_ready_env":
    "[opencode-orchestrator] このタスクのセッションは環境要因 (必要なコマンドが利用できない・実行できない など) によって再開できません。'ococ doctor' を実行して環境を確認し、必要であれば 'ococ fix --task {task}' や 'ococ run --task {task}' を使って状況を改善してから 'ococ resume --task {task}' を再実行してください。",

  "cli.status.error.no_tasks_found":
    "[opencode-orchestrator] 実行可能な orchestrator タスクが見つかりません。まず Refiner/Todo-Writer で少なくとも 1 つタスクを用意してから status を使ってください。",

  "cli.status.error.multiple_tasks":
    "[opencode-orchestrator] 利用可能なタスクが複数あります。status には --task <タスク名> を指定してください。利用可能なタスク: {tasks}",

  "cli.status.error.unknown_task_with_suggestions":
    "[opencode-orchestrator] タスク '{input}' は見つかりませんでした。もしかして: {candidates} ?",

  "cli.status.error.unknown_task_no_suggestions":
    "[opencode-orchestrator] タスク '{input}' は見つかりませんでした。利用可能なタスクは 'ococ list' で確認できます。",

  "cli.status.info.not_ready_generic":
    "[opencode-orchestrator] このタスク向けの高レベル status はまだ要約表示の準備ができていません。現時点では 'ococ list' と 'ococ loop --task {task}' を組み合わせて進捗を確認してください。",

  "cli.status.error.state_missing":
    "[opencode-orchestrator] タスク '{task}' の状態ディレクトリが見つかりません。まず計画フェーズを実行してから status を利用してください。",

  "cli.status.summary.header":
    "[opencode-orchestrator] タスク '{task}' のステータス:",

  "cli.status.summary.phase.planning":
    "[opencode-orchestrator] フェーズ: 計画中 (command-policy や事前チェックがまだ完了していません)",

  "cli.status.summary.phase.execution_ready":
    "[opencode-orchestrator] フェーズ: 実行可能 (このタスク向けの orchestrator ループを開始できます)",

  "cli.status.summary.phase.env_blocked":
    "[opencode-orchestrator] フェーズ: 環境要因でブロック中 (必要なツールや権限の不足などで実行できません)",

  "cli.status.summary.phase.completed":
    "[opencode-orchestrator] フェーズ: 完了 (このタスクに紐づく既知の要件はすべて監査済みです)",

  "cli.status.summary.phase.unknown":
    "[opencode-orchestrator] フェーズ: 不明 (保存されている状態から現在のステータスを特定できませんでした)",

  "cli.status.summary.last_failure":
    "[opencode-orchestrator] 直近の失敗: {summary}",

  "cli.status.summary.open_proposals.none":
    "[opencode-orchestrator] このタスクに未解決の proposal はありません。",

  "cli.status.summary.open_proposals.some":
    "[opencode-orchestrator] このタスクには未解決の proposal が {count} 件あります。",

  "cli.status.summary.next_action.planning":
    "[opencode-orchestrator] 次のステップ: 'ococ fix --task {task}' で計画フェーズの問題を確認し、環境に不安があれば 'ococ doctor' を実行してください。",

  "cli.status.summary.next_action.env_blocked":
    "[opencode-orchestrator] 次のステップ: まず 'ococ doctor' で環境要因の問題を診断し、その後 'ococ fix --task {task}' や 'ococ run'/'ococ resume' を再実行してください。",

  "cli.status.summary.next_action.execution_ready":
    "[opencode-orchestrator] 次のステップ: 'ococ run --task {task}' で orchestrator ループを開始するか、最近のセッションを再開する場合は 'ococ resume --task {task}' を実行してください。",

  "cli.status.summary.next_action.completed":
    "[opencode-orchestrator] 次のステップ: 直ちに必要な orchestrator 操作はありません。リポジトリの変更内容を確認するか、別のタスクを開始してください。",

  "cli.status.summary.next_action.unknown":
    "[opencode-orchestrator] 次のステップ: 計画フェーズや環境チェックが完了していることを確認したうえで 'ococ status --task {task}' を再実行するか、'ococ fix --task {task}' で詳細を確認してください。",

  "cli.fix.error.no_tasks_found":
    "[opencode-orchestrator] 実行可能な orchestrator タスクが見つかりません。まず Refiner/Todo-Writer で少なくとも 1 つタスクを用意してから fix を使ってください。",

  "cli.fix.error.multiple_tasks":
    "[opencode-orchestrator] 利用可能なタスクが複数あります。fix には --task <タスク名> を指定してください。利用可能なタスク: {tasks}",

  "cli.fix.error.unknown_task_with_suggestions":
    "[opencode-orchestrator] タスク '{input}' は見つかりませんでした。もしかして: {candidates} ?",

  "cli.fix.error.unknown_task_no_suggestions":
    "[opencode-orchestrator] タスク '{input}' は見つかりませんでした。利用可能なタスクは 'ococ list' で確認できます。",

  "cli.fix.info.not_ready_generic":
    "[opencode-orchestrator] このタスク向けの高レベル fix はまだ診断の準備ができていません。現時点では 'ococ status' と 'ococ doctor' を組み合わせて状況を確認してください。",

  "cli.fix.info.planning_blocked":
    "[opencode-orchestrator] このタスクはまだ計画フェーズや事前チェックの結果から実行可能な状態ではありません。まず 'ococ status --task {task}' で状況を確認し、必要であれば 'ococ doctor' で環境を確認してから 'ococ run' や 'ococ resume' を実行してください。",

  "cli.fix.info.env_blocked":
    "[opencode-orchestrator] このタスクは環境要因 (必要なコマンドが利用できない・実行できない など) によって実行できない状態です。'ococ doctor' を実行して不足しているツールや権限を確認し、問題を解消してから 'ococ run' や 'ococ resume' を再実行してください。",

  "cli.doctor.info.tools_ok":
    "[opencode-orchestrator] Node/npm/npx/opencode CLI は一通り見つかりました。環境面の前提条件はおおむね満たされています。",

  "cli.doctor.error.missing_tools":
    "[opencode-orchestrator] 一部のコマンドが見つかりませんでした: {tools}。これらをインストールしてから 'ococ doctor' を再実行してください。",

  "cli.doctor.error.state_base_missing":
    "[opencode-orchestrator] orchestrator の状態ディレクトリが見つかりません。XDG_STATE_HOME の設定やディレクトリ作成権限を確認してください。",

  "cli.doctor.warn.state_base_not_writable":
    "[opencode-orchestrator] orchestrator の状態ディレクトリを書き込み不可として検出しました。権限やマウント設定を確認してください。",

  "cli.clear.error.no_target":
    "[opencode-orchestrator] clear: 実行対象が指定されていません (--proposals か --resolve/--dismiss のいずれかが必要です)",

  "cli.clear.usage":
    "使い方: opencode-orchestrator clear --task <task-name> [--proposals | --resolve <id> | --dismiss <id>] [-y]\n" +
    "\n" +
    "指定したタスクに紐づく提案の状態を更新します。\n" +
    "\n" +
    "オプション:\n" +
    "  --task <name>   対象となるタスクキー (例: 'my-task')\n" +
    "  --proposals     すべての open proposal を resolved にする\n" +
    "  --resolve <id>  指定した proposal を resolved にする\n" +
    "  --dismiss <id>  指定した proposal を dismissed にする\n" +
    "  -y              確認なしで削除を実行する\n",

  "cli.clear.error.missing_task_name":
    "[opencode-orchestrator] clear: --task にはタスク名が必要です。",

  "cli.clear.error.missing_resolve_id":
    "[opencode-orchestrator] clear: --resolve には proposal の ID が必要です。",

  "cli.clear.error.missing_dismiss_id":
    "[opencode-orchestrator] clear: --dismiss には proposal の ID が必要です。",

  "cli.clear.error.missing_task":
    "[opencode-orchestrator] clear: --task <タスク名> は必須です。",

  "cli.clear.error.unknown_option":
    "[opencode-orchestrator] clear: 不明なオプションです: {option}",

  "cli.clear.error.unexpected_arg":
    "[opencode-orchestrator] clear: 想定外の引数です: {arg}",

  "cli.clear.info.no_proposals":
    '[opencode-orchestrator] タスク "{task}" には更新対象の proposal はありません。',

  "cli.clear.info.confirm":
    '[opencode-orchestrator] タスク "{task}" から {count} 件の proposal を更新しようとしています。',

  "cli.clear.info.confirm_hint":
    "[opencode-orchestrator] 本当に更新してよい場合は -y を付けてもう一度実行してください。",

  "cli.clear.info.backup_created":
    "[opencode-orchestrator] 既存の proposal をバックアップしました: {path}",

  "cli.clear.warn.backup_failed":
    "[opencode-orchestrator] WARN: proposal のバックアップに失敗しました。バックアップなしで更新を続行します。",

  "cli.clear.info.updated":
    '[opencode-orchestrator] タスク "{task}" の proposal を更新しました。',

  "cli.install.usage":
    "使い方: opencode-orchestrator install [options]\n" +
    "\n" +
    "OpenCode の設定ファイル (opencode.json) にこのプラグインを追加します。\n" +
    "\n" +
    "オプション:\n" +
    "  (指定なし)      カレントディレクトリの ./opencode.json を作成/更新\n" +
    "  -g, --global    XDG_CONFIG_HOME/opencode/opencode.json または ~/.config/opencode/opencode.json を作成/更新\n",

  "cli.install.error.invalid_config":
    "[opencode-orchestrator] ERROR: 設定ファイルを JSON として読み取れませんでした: {path}",

  "cli.install.error.invalid_config_hint":
    "[opencode-orchestrator] 元のファイルを変更せずに終了します。JSON として有効な形式に修正してから再度実行してください。",

  "cli.install.error.config_dir":
    "[opencode-orchestrator] ERROR: 設定ディレクトリの作成に失敗しました: {dir}",

  "cli.install.info.already_enabled":
    '[opencode-orchestrator] すでに "{plugin}" が有効化されています: {path}',

  "cli.install.info.created":
    "[opencode-orchestrator] 新しい OpenCode 設定ファイルを作成しました: {path}",

  "cli.install.info.updated":
    "[opencode-orchestrator] 設定ファイルを更新しました: {path}",

  "cli.completion.subcommand.run": "タスク用の orchestrator ループを開始します",

  "cli.completion.subcommand.resume": "最近のタスクやセッションを再開します",

  "cli.completion.subcommand.status":
    "タスクの概要と次に行うべき操作を表示します",

  "cli.completion.subcommand.doctor":
    "orchestrator 利用に関連する環境全体の診断を実行します",

  "cli.completion.subcommand.fix":
    "特定のタスクが進まない理由と次に行うべき対応を説明します",

  "cli.completion.subcommand.completion":
    "bash/PowerShell 用の補完設定スニペットを生成します",

  "cli.completion.subcommand.loop":
    "低レベルの Executor/Auditor ループを実行します",

  "cli.completion.subcommand.list":
    "orchestrator タスクや proposal の一覧を表示します",

  "cli.completion.subcommand.exec": "制限付き helper スクリプトを実行します",

  "cli.completion.subcommand.clear":
    "タスクに紐づく proposal の状態を更新します",

  "cli.completion.subcommand.install":
    "このプラグインを OpenCode 設定ファイルに追加します",

  "cli.completion.option.task": "orchestrator タスクキーを指定します",

  "cli.completion.task.known": "既知の orchestrator タスク",

  "cli.completion.script_header.bash":
    "# ococ / opencode-orchestrator 用 bash 補完設定",

  "cli.completion.script_header.powershell":
    "# ococ / opencode-orchestrator 用 PowerShell 補完設定",
} as const;

export type MessageKeyJa = keyof typeof messagesJa;
