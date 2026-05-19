import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runCli } from "../src/cli.js";

// NOTE: These tests assume a Node-like runtime where `process.env` exists.
declare const process: { env: Record<string, string | undefined> };

describe("ococ / opencode-orchestrator help parity", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  const writes: string[] = [];

  beforeEach(() => {
    writes.length = 0;
    process.env.LC_ALL = "ja_JP.UTF-8";
    process.env.LANG = "ja_JP.UTF-8";
    errSpy = vi.spyOn(console, "error").mockImplementation((...args: any[]) => {
      writes.push(args.map((a) => String(a)).join(" "));
    });
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  it("shows high-level subcommands in Japanese help", async () => {
    const code = await runCli(["--help"]);
    expect(code).toBe(0);
    const out = writes.join("\n");
    expect(out).toContain("run        タスク用の orchestrator ループを開始");
    expect(out).toContain("resume     指定タスクの直近セッションを再開");
    expect(out).toContain("status     タスクの要約と次に行うべき操作を表示");
    expect(out).toContain(
      "doctor     orchestrator 利用に必要な環境全体の診断を実行",
    );
    expect(out).toContain(
      "fix        特定タスクが進まない理由と次のアクションを説明",
    );
    expect(out).toContain(
      "completion bash/PowerShell 用の補完設定スニペットを生成",
    );
  });

  it("shows high-level subcommands in English help when LANG=en_US.UTF-8", async () => {
    process.env.LC_ALL = "";
    process.env.LANG = "en_US.UTF-8";
    const code = await runCli(["--help"]);
    expect(code).toBe(0);
    const out = writes.join("\n");
    expect(out).toContain("High-level subcommands (recommended):");
    expect(out).toContain("run        Start an orchestrator loop for a task");
    expect(out).toContain(
      "resume     Resume the most recent session for a task",
    );
    expect(out).toContain(
      "status     Show a high-level summary and next actions for a task",
    );
    expect(out).toContain(
      "doctor     Run environment-wide diagnostics for orchestrator usage",
    );
    expect(out).toContain(
      "fix        Explain why a specific task cannot progress and what to do next",
    );
    expect(out).toContain(
      "completion Generate shell completion setup snippets for bash/PowerShell",
    );
  });
});
