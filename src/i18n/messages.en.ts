export const messagesEn = {
  "cli.root.usage":
    "Usage: opencode-orchestrator <subcommand> [options]\n" +
    "\n" +
    "High-level subcommands (recommended):\n" +
    "  run        Start an orchestrator loop for a task (short alias: ococ run)\n" +
    "  resume     Resume the most relevant recent task/session\n" +
    "  status     Show a high-level summary and next actions for a task\n" +
    "  doctor     Run environment-wide diagnostics for orchestrator usage\n" +
    "  fix        Explain why a specific task cannot progress and what to do next\n" +
    "  completion Generate shell completion setup snippets for bash/PowerShell\n" +
    "\n" +
    "Low-level subcommands (advanced/expert):\n" +
    '  loop    --task <task-name> [--session <ses_...> | --continue] [--commit] [--max-loop N] [--max-restarts M] [--file <path>] "prompt..."\n' +
    "  list    [--json]   Show orchestrator task list or proposals for a task\n" +
    '  exec    [--allow-fs-read <path>] [--allow-fs-write <path>] [--file <path>] ["helper-source"]\n' +
    "  clear   --task <task-name> --proposals [-y]   Update proposals recorded for a task\n" +
    "  install [-g|--global]   Add this plugin to an OpenCode config file\n" +
    "\n" +
    "Common options:\n" +
    "  -h, --help       Show this help\n" +
    "  -v, --version    Show version number\n",

  "cli.root.unknown_subcommand":
    "[opencode-orchestrator] unknown subcommand: {subcommand}",

  "cli.root.fatal_error": "[opencode-orchestrator] fatal error: {message}",

  "cli.root.error.task_flag_conflict":
    "[opencode-orchestrator] {subcommand}: please use either --task or -t, not both.",

  "cli.list.usage":
    "Usage: opencode-orchestrator list [--json] [--task/-t <task-name> --proposals]\n" +
    "\n" +
    "List orchestrator tasks found under the orchestrator state directory.\n" +
    "\n" +
    "Options:\n" +
    "  --json                Output the task list as JSON\n" +
    "  --task, -t <name>     Filter to a single task (used together with --proposals)\n" +
    "  --proposals           Show proposals for the selected task instead of the task list\n" +
    "  --open                When showing proposals, only include status='open' entries\n",

  "cli.list.proposals.none":
    '[opencode-orchestrator] Task "{task}" has no proposals.',

  "cli.list.proposals.header":
    '[opencode-orchestrator] Proposals for task "{task}":',

  "cli.list.error.base_missing":
    "[opencode-orchestrator] The orchestrator base directory for tasks does not exist: {baseDir}",

  "cli.list.error.base_read_failed":
    "[opencode-orchestrator] Failed to read the orchestrator base directory {baseDir}: {message}",

  "cli.list.info.no_tasks":
    "[opencode-orchestrator] No orchestrator tasks were found under the base directory: {baseDir}",

  "cli.list.status.ready_for_loop": "ready to run",

  "cli.list.status.needs_refinement": "needs planning refinement",

  "cli.list.status.blocked_by_environment": "blocked by environment",

  "cli.exec.usage":
    "Usage: opencode-orchestrator exec [options] [helper-source]\n" +
    "\n" +
    "Run a constrained helper script. If helper-source is omitted, use --file or stdin.\n" +
    "\n" +
    "Options:\n" +
    "  --allow-fs-read <path>   Workspace-relative path/glob allowed for reading (repeatable)\n" +
    "  --allow-fs-write <path>  Workspace-relative path/glob allowed for writing (repeatable)\n" +
    "  --timeout <ms>           Execution timeout (default: 30000)\n" +
    "  --max-output <bytes>     Maximum combined stdout/stderr to collect (default: 65536)\n" +
    "  --file <path>            Read helper source from the given file\n" +
    "  --arg <value>            Value exposed as argv inside the helper (repeatable)\n" +
    "  --help, -h               Show this help\n",

  "cli.loop.usage":
    "Usage: opencode-orchestrator loop --task/-t <task-name> [options] [prompt]\n" +
    "\n" +
    "Run the Executor/Auditor loop for the specified task.\n" +
    "\n" +
    "Required:\n" +
    "  --task, -t <name>    Task key to run (for example: 'my-task')\n" +
    "\n" +
    "Options:\n" +
    "  --session <id>       Continue a specific existing session id\n" +
    "  --continue           Continue from the most recent recorded session for this task\n" +
    "  --commit             Ask the Executor to create a commit when the loop finishes\n" +
    "  --max-loop <n>       Maximum number of steps (default: 100)\n" +
    "  --max-restarts <n>   Safety-related restart limit (default: 20)\n" +
    "  --dangerously-skip-command-policy\n" +
    "    Skip the planned command-policy gate and allow arbitrary commands (no sandbox).\n" +
    "  --bwrap-skip-command-policy (not available on Windows)\n" +
    "    Skip the command-policy gate but run the Executor in a Bubblewrap sandbox.\n" +
    "  --bwrap-arg <arg>    Additional argument passed to bwrap (repeatable)\n" +
    "                       In bwrap-skip mode, bare bwrap flags such as --unshare-net are also accepted\n" +
    "  --file, -f <path>    Attach a file to each opencode run step\n" +
    "  --help, -h           Show this help\n" +
    "\n" +
    "The trailing prompt argument is optional. When omitted, a default prompt derived from\n" +
    "spec.md / acceptance-index.json is used.\n",

  "cli.install.usage":
    "Usage: opencode-orchestrator install [options]\n" +
    "\n" +
    "Add this plugin to an OpenCode config file (opencode.json).\n" +
    "\n" +
    "Options:\n" +
    "  (default)       Create/update ./opencode.json in the current directory\n" +
    "  -g, --global    Create/update XDG_CONFIG_HOME/opencode/opencode.json or ~/.config/opencode/opencode.json\n",

  "cli.install.error.invalid_config":
    "[opencode-orchestrator] ERROR: Failed to read config as JSON: {path}",

  "cli.install.error.invalid_config_hint":
    "[opencode-orchestrator] The original file was not changed. Please fix it as valid JSON and try again.",

  "cli.install.error.config_dir":
    "[opencode-orchestrator] ERROR: Failed to create config directory: {dir}",

  "cli.install.info.already_enabled":
    '[opencode-orchestrator] "{plugin}" is already enabled in: {path}',

  "cli.install.info.created":
    "[opencode-orchestrator] Created a new OpenCode config file: {path}",

  "cli.install.info.updated":
    "[opencode-orchestrator] Updated OpenCode config file: {path}",

  "cli.clear.error.no_target":
    "[opencode-orchestrator] clear: nothing to do; specify --proposals or --resolve/--dismiss.",

  "cli.clear.usage":
    "Usage: opencode-orchestrator clear --task/-t <task-name> [--proposals | --resolve <id> | --dismiss <id>] [-y]\n" +
    "\n" +
    "Update the state of proposals associated with the specified task.\n" +
    "\n" +
    "Options:\n" +
    "  --task, -t <name>   Task key to target (for example: 'my-task')\n" +
    "  --proposals     Mark all open proposals as resolved\n" +
    "  --resolve <id>  Mark the specified proposal as resolved\n" +
    "  --dismiss <id>  Mark the specified proposal as dismissed\n" +
    "  -y              Apply changes without confirmation\n",

  "cli.clear.error.missing_task_name":
    "[opencode-orchestrator] clear: --task requires a task name.",

  "cli.clear.error.missing_resolve_id":
    "[opencode-orchestrator] clear: --resolve requires a proposal id.",

  "cli.clear.error.missing_dismiss_id":
    "[opencode-orchestrator] clear: --dismiss requires a proposal id.",

  "cli.clear.error.missing_task":
    "[opencode-orchestrator] clear: --task <task-name> is required.",

  "cli.clear.error.unknown_option":
    "[opencode-orchestrator] clear: unknown option: {option}",

  "cli.clear.error.unexpected_arg":
    "[opencode-orchestrator] clear: unexpected argument: {arg}",

  "cli.clear.info.no_proposals":
    '[opencode-orchestrator] Task "{task}" has no proposals to update.',

  "cli.clear.info.confirm":
    '[opencode-orchestrator] You are about to update {count} proposals for task "{task}".',

  "cli.clear.info.confirm_hint":
    "[opencode-orchestrator] Re-run with -y if you really want to update these proposals.",

  "cli.clear.info.backup_created":
    "[opencode-orchestrator] Backed up existing proposals: {path}",

  "cli.clear.warn.backup_failed":
    "[opencode-orchestrator] WARN: Failed to back up proposals. Continuing without backup.",

  "cli.clear.info.updated":
    '[opencode-orchestrator] Updated proposals for task "{task}".',

  "cli.run.error.no_tasks_found":
    "[opencode-orchestrator] No orchestrator tasks were found. Run planning for at least one task before using 'run'.",

  "cli.run.error.multiple_tasks":
    "[opencode-orchestrator] Multiple tasks are available. Please specify --task <task-name>. Available tasks: {tasks}",

  "cli.run.error.unknown_task_with_suggestions":
    "[opencode-orchestrator] Task '{input}' was not found. Did you mean: {candidates}?",

  "cli.run.error.unknown_task_no_suggestions":
    "[opencode-orchestrator] Task '{input}' was not found. Run 'ococ list' to see available tasks.",

  "cli.run.error.missing_task":
    "[opencode-orchestrator] Please specify --task <task-name> when using 'run'.",

  "cli.run.info.not_ready_generic":
    "[opencode-orchestrator] High-level 'run' is not ready to start the loop for this task yet. For now, use 'ococ loop --task {task}' after finishing planning.",

  "cli.run.info.multiple_tasks_hint_use_list":
    "[opencode-orchestrator] Showing only the most recently updated tasks above. Run 'ococ list' to see all available tasks.",

  "cli.run.info.unknown_task_hint_use_list":
    "[opencode-orchestrator] Showing only the most recently updated tasks above. Run 'ococ list' to see all available tasks.",

  "cli.resume.error.no_tasks_found":
    "[opencode-orchestrator] No orchestrator tasks were found. Run planning for at least one task before using 'resume'.",

  "cli.resume.error.multiple_tasks":
    "[opencode-orchestrator] Multiple tasks are available. Please specify --task <task-name> for 'resume'. Available tasks: {tasks}",

  "cli.resume.info.not_ready_generic":
    "[opencode-orchestrator] High-level 'resume' is not ready to continue a session yet. Use 'ococ status --task {task}' and 'ococ fix --task {task}' to inspect what remains before resuming.",

  "cli.resume.info.multiple_tasks_hint_use_list":
    "[opencode-orchestrator] Showing only the most recently updated tasks above. Run 'ococ list' to see all available tasks.",

  "cli.resume.info.unknown_task_hint_use_list":
    "[opencode-orchestrator] Showing only the most recently updated tasks above. Run 'ococ list' to see all available tasks.",

  "cli.resume.info.not_ready_planning":
    "[opencode-orchestrator] This task's session cannot be resumed yet because planning or preflight checks are not finished. Start with 'ococ status --task {task}' to inspect the task, then use 'ococ fix --task {task}' or 'ococ doctor' if needed before running 'ococ resume' again.",

  "cli.resume.info.not_ready_env":
    "[opencode-orchestrator] This task's session cannot be resumed because of environment issues (for example, required commands are unavailable). Run 'ococ doctor' to check the environment, then use 'ococ fix --task {task}' or 'ococ run --task {task}' to address problems before re-running 'ococ resume --task {task}'.",

  "cli.status.error.no_tasks_found":
    "[opencode-orchestrator] No orchestrator tasks were found. Run planning for at least one task before using 'status'.",

  "cli.status.error.multiple_tasks":
    "[opencode-orchestrator] Multiple tasks are available. Please specify --task <task-name> for 'status'. Available tasks: {tasks}",

  "cli.status.error.unknown_task_with_suggestions":
    "[opencode-orchestrator] Task '{input}' was not found. Did you mean: {candidates}?",

  "cli.status.error.unknown_task_no_suggestions":
    "[opencode-orchestrator] Task '{input}' was not found. Run 'ococ list' to see available tasks.",

  "cli.status.info.not_ready_generic":
    "[opencode-orchestrator] High-level 'status' is not ready to summarize this task yet. For now, combine 'ococ list' and 'ococ loop --task {task}' to inspect progress.",

  "cli.status.info.multiple_tasks_hint_use_list":
    "[opencode-orchestrator] Showing only the most recently updated tasks above. Run 'ococ list' to see all available tasks.",

  "cli.status.info.unknown_task_hint_use_list":
    "[opencode-orchestrator] Showing only the most recently updated tasks above. Run 'ococ list' to see all available tasks.",

  "cli.status.error.state_missing":
    "[opencode-orchestrator] State directory for task '{task}' could not be found. Run planning for this task before using 'status'.",

  "cli.status.summary.header":
    "[opencode-orchestrator] Status for task '{task}':",

  "cli.status.summary.phase.planning":
    "[opencode-orchestrator] Phase: planning – command-policy and refinement are not yet ready to start the loop.",

  "cli.status.summary.phase.execution_ready":
    "[opencode-orchestrator] Phase: execution – the orchestrator loop is ready to run for this task.",

  "cli.status.summary.phase.env_blocked":
    "[opencode-orchestrator] Phase: blocked by environment – required tools or permissions are currently preventing execution.",

  "cli.status.summary.phase.completed":
    "[opencode-orchestrator] Phase: completed – all known requirements for this task have been audited as passed.",

  "cli.status.summary.phase.unknown":
    "[opencode-orchestrator] Phase: unknown – the current phase could not be derived from stored state.",

  "cli.status.summary.last_failure":
    "[opencode-orchestrator] Last failure: {summary}",

  "cli.status.summary.open_proposals.none":
    "[opencode-orchestrator] There are no open proposals for this task.",

  "cli.status.summary.open_proposals.some":
    "[opencode-orchestrator] There are {count} open proposals for this task.",

  "cli.status.summary.next_action.planning":
    "[opencode-orchestrator] Next step: run 'ococ fix --task {task}' to inspect planning issues, and 'ococ doctor' if environment problems are suspected.",

  "cli.status.summary.next_action.env_blocked":
    "[opencode-orchestrator] Next step: run 'ococ doctor' to diagnose environment issues, then use 'ococ fix --task {task}' and re-run 'ococ run' or 'ococ resume' once they are resolved.",

  "cli.status.summary.next_action.execution_ready":
    "[opencode-orchestrator] Next step: run 'ococ run --task {task}' to start the orchestrator loop, or 'ococ resume --task {task}' if you want to continue a recent session.",

  "cli.status.summary.next_action.completed":
    "[opencode-orchestrator] Next step: no immediate orchestrator action is required. Review the repository changes or start another task as needed.",

  "cli.status.summary.next_action.unknown":
    "[opencode-orchestrator] Next step: run 'ococ status --task {task}' again after ensuring planning and environment checks have completed, or consult 'ococ fix --task {task}'.",

  "loop.executor.error.opencode_retry":
    "[opencode-orchestrator] Detected an OpenCode execution error in the executor step ({kind}); this is failure {current} of {max} in the current session. Skipping the auditor for this step and retrying in the same session on the next loop step.",

  "loop.executor.error.opencode_restart":
    "[opencode-orchestrator] OpenCode execution errors occurred {current} times in a row within the same session; starting a new session.",

  "loop.executor.error.opencode_restart_limit_reached":
    "[opencode-orchestrator] Tried to restart the session for OpenCode execution errors, but MAX_RESTARTS={maxRestarts} was reached; aborting the loop.",

  "loop.executor.failure.opencode_unexpected_summary":
    "Executor hit an OpenCode Unexpected error: {message}",

  "loop.executor.failure.opencode_reasoning_summary":
    "Executor hit an OpenCode 'Item of type ...' reasoning-format error: {message}",

  "cli.fix.error.no_tasks_found":
    "[opencode-orchestrator] No orchestrator tasks were found. Run planning for at least one task before using 'fix'.",

  "cli.fix.error.multiple_tasks":
    "[opencode-orchestrator] Multiple tasks are available. Please specify --task <task-name> for 'fix'. Available tasks: {tasks}",

  "cli.fix.error.unknown_task_with_suggestions":
    "[opencode-orchestrator] Task '{input}' was not found. Did you mean: {candidates}?",

  "cli.fix.error.unknown_task_no_suggestions":
    "[opencode-orchestrator] Task '{input}' was not found. Run 'ococ list' to see available tasks.",

  "cli.fix.info.not_ready_generic":
    "[opencode-orchestrator] High-level 'fix' is not ready to diagnose this task yet. For now, consult 'ococ status' and 'ococ doctor' for guidance.",

  "cli.fix.info.planning_blocked":
    "[opencode-orchestrator] This task is still blocked by planning or preflight checks and is not ready to run. Start with 'ococ status --task {task}' to inspect the situation, then use 'ococ doctor' for environment checks before re-running 'ococ run' or 'ococ resume'.",

  "cli.fix.info.env_blocked":
    "[opencode-orchestrator] This task cannot run because required commands are unavailable or cannot execute in the current environment. Run 'ococ doctor' to identify missing tools or permission issues, fix them, and then re-run 'ococ run' or 'ococ resume'.",

  "cli.fix.info.completed":
    "[opencode-orchestrator] This task is already recorded as completed by the latest final audit. Run 'ococ status --task {task}' if you want to confirm the completion state.",

  "cli.fix.info.execution_ready":
    "[opencode-orchestrator] This task is ready to execute. Run 'ococ run --task {task}' to start fresh, or 'ococ resume --task {task}' to continue the most recent session.",

  "cli.fix.info.last_failure":
    "[opencode-orchestrator] Last failure: {summary}",

  "cli.fix.info.open_proposals":
    "[opencode-orchestrator] This task has {count} open proposals. Latest summary: {summary}. Run 'ococ list --task {task} --proposals' for details, then re-run 'ococ resume --task {task}' if appropriate.",

  "cli.fix.info.audit_failed":
    "[opencode-orchestrator] This task still has unmet requirements in the latest audit: {requirements}. Run 'ococ list --task {task} --proposals' to inspect the findings, then continue with 'ococ resume --task {task}'.",

  "cli.fix.info.first_requirement_reason":
    "[opencode-orchestrator] Representative audit reason: {reason}",

  "cli.fix.info.last_failure_only":
    "[opencode-orchestrator] This task is not ready to continue yet. Last failure: {summary}. Check 'ococ status --task {task}' and 'ococ doctor' before retrying.",

  "cli.fix.info.multiple_tasks_hint_use_list":
    "[opencode-orchestrator] Showing only the most recently updated tasks above. Run 'ococ list' to see all available tasks.",

  "cli.fix.info.unknown_task_hint_use_list":
    "[opencode-orchestrator] Showing only the most recently updated tasks above. Run 'ococ list' to see all available tasks.",

  "cli.doctor.info.tools_ok":
    "[opencode-orchestrator] Node, npm, npx, and the opencode CLI were all found. Environment prerequisites look OK.",

  "cli.doctor.error.missing_tools":
    "[opencode-orchestrator] Some commands were not found: {tools}. Please install them and re-run 'ococ doctor'.",

  "cli.doctor.error.state_base_missing":
    "[opencode-orchestrator] The orchestrator state directory could not be found. Please check XDG_STATE_HOME and ensure the directory has been created.",

  "cli.doctor.warn.state_base_not_writable":
    "[opencode-orchestrator] The orchestrator state directory does not appear to be writable. Please check directory permissions or mount options.",

  "cli.completion.subcommand.run": "Start an orchestrator loop for a task",

  "cli.completion.subcommand.resume":
    "Resume the most relevant recent task/session",

  "cli.completion.subcommand.status":
    "Show a high-level summary and next actions for a task",

  "cli.completion.subcommand.doctor":
    "Run environment-wide diagnostics related to orchestrator usage",

  "cli.completion.subcommand.fix":
    "Explain why a specific task cannot progress and what to do next",

  "cli.completion.subcommand.completion":
    "Generate shell completion setup snippets for bash/PowerShell",

  "cli.completion.subcommand.loop": "Run the low-level Executor/Auditor loop",

  "cli.completion.subcommand.list": "List orchestrator tasks or proposals",

  "cli.completion.subcommand.exec": "Run a constrained helper script",

  "cli.completion.subcommand.clear": "Update proposals for a task",

  "cli.completion.subcommand.install":
    "Add this plugin to an OpenCode config file",

  "cli.completion.option.task": "Specify the orchestrator task key",

  "cli.completion.task.known": "Known orchestrator task",

  "cli.completion.script_header.bash":
    "# bash completion for ococ / opencode-orchestrator",

  "cli.completion.script_header.powershell":
    "# PowerShell completion for ococ / opencode-orchestrator",
} as const;

export type MessageKeyEn = keyof typeof messagesEn;
