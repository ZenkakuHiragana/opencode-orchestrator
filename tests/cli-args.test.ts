import { describe, expect, it } from "vitest";

import {
  parseCompletionCliArgs,
  parseDoctorArgs,
  parseExecArgs,
  parseFixArgs,
  parseListArgs,
  parseLoopArgs,
  parseResumeArgs,
  parseRunArgs,
  parseStatusArgs,
} from "../src/cli-args.js";

declare const process: { platform: string };

describe("parseLoopArgs", () => {
  it("parses minimal required arguments", () => {
    const opts = parseLoopArgs(["--task", "foo", "do something"]);
    expect(opts.task).toBe("foo");
    expect(opts.prompt).toBe("do something");
    expect(opts.sessionId).toBeUndefined();
    expect(opts.continueLast).toBe(false);
    expect(opts.commitOnDone).toBe(false);
    expect(opts.maxLoop).toBe(100);
    expect(opts.maxRestarts).toBe(20);
    expect(opts.files).toEqual([]);
  });

  it("throws when --task is missing", () => {
    expect(() => parseLoopArgs(["do", "something"])).toThrow(
      "--task is required",
    );
  });

  it("detects mutually exclusive --session and --continue", () => {
    expect(() =>
      parseLoopArgs([
        "--task",
        "foo",
        "--session",
        "sess-1",
        "--continue",
        "do",
        "something",
      ]),
    ).toThrow("--session and --continue are mutually exclusive");
  });

  it("parses numeric options and files", () => {
    const opts = parseLoopArgs([
      "--task",
      "foo",
      "--max-loop",
      "5",
      "--max-restarts",
      "1",
      "--file",
      "a.txt",
      "--file",
      "b.txt",
      "do",
      "something",
    ]);
    expect(opts.maxLoop).toBe(5);
    expect(opts.maxRestarts).toBe(1);
    expect(opts.files).toEqual(["a.txt", "b.txt"]);
  });

  it("accepts -t as an alias for --task", () => {
    const opts = parseLoopArgs(["-t", "foo", "do something"]);
    expect(opts.task).toBe("foo");
    expect(opts.prompt).toBe("do something");
  });

  it("captures direct bwrap flag arguments after --bwrap-skip-command-policy", () => {
    const opts = parseLoopArgs([
      "--task",
      "foo",
      "--bwrap-skip-command-policy",
      "--unshare-net",
      "--new-session",
      "do",
      "something",
    ]);
    expect(opts.bwrapSkipCommandPolicy).toBe(true);
    expect(opts.bwrapArgs).toEqual(["--unshare-net", "--new-session"]);
    expect(opts.prompt).toBe("do something");
  });

  it("still parses --file after bare bwrap flags are enabled", () => {
    const opts = parseLoopArgs([
      "--task",
      "foo",
      "--bwrap-skip-command-policy",
      "--unshare-net",
      "--file",
      "note.md",
      "do",
      "something",
    ]);
    expect(opts.bwrapSkipCommandPolicy).toBe(true);
    expect(opts.bwrapArgs).toEqual(["--unshare-net"]);
    expect(opts.files).toEqual(["note.md"]);
    expect(opts.prompt).toBe("do something");
  });

  it("generates a fallback prompt when none is provided", () => {
    const opts = parseLoopArgs(["--task", "foo"]);
    expect(opts.prompt).toContain("foo");
    expect(opts.prompt).toContain("spec.md");
    expect(opts.prompt).toContain("acceptance-index.json");
  });
});

describe("parseListArgs", () => {
  it("defaults to text format", () => {
    const opts = parseListArgs([]);
    expect(opts.format).toBe("text");
    expect(opts.task).toBeUndefined();
    expect(opts.showProposals).toBeFalsy();
  });

  it("accepts --json", () => {
    const opts = parseListArgs(["--json"]);
    expect(opts.format).toBe("json");
  });

  it("throws on unknown options", () => {
    expect(() => parseListArgs(["--foo"])).toThrow(
      "unknown option for list: --foo",
    );
  });

  it("parses --task and --proposals together", () => {
    const opts = parseListArgs(["--task", "foo", "--proposals"]);
    expect(opts.task).toBe("foo");
    expect(opts.showProposals).toBe(true);
  });

  it("accepts -t for list", () => {
    const opts = parseListArgs(["-t", "foo", "--proposals"]);
    expect(opts.task).toBe("foo");
    expect(opts.showProposals).toBe(true);
  });

  it("throws when --proposals is used without --task", () => {
    expect(() => parseListArgs(["--proposals"])).toThrow(
      "--proposals requires --task <task-name>",
    );
  });
});

describe("high-level CLI parsers", () => {
  it("parseRunArgs delegates loop-compatible options without re-parsing them here", () => {
    const opts = parseRunArgs([
      "--task",
      "foo",
      "--max-loop",
      "5",
      "--file",
      "a.txt",
      "--commit",
    ]);
    expect(opts.task).toBe("foo");
    expect(opts.loopArgv).toEqual([
      "--task",
      "foo",
      "--max-loop",
      "5",
      "--file",
      "a.txt",
      "--commit",
    ]);
  });

  it("parseResumeArgs rejects low-level session control flags", () => {
    expect(() => parseResumeArgs(["--session", "ses-1"])).toThrow(
      /--session.*高レベルコマンド/,
    );
  });

  it("parseStatusArgs accepts only --task", () => {
    expect(parseStatusArgs(["--task", "foo"]).task).toBe("foo");
    expect(() => parseStatusArgs(["--json"])).toThrow(/不明なオプション/);
  });

  it("parseFixArgs accepts only --task", () => {
    expect(parseFixArgs(["--task", "foo"]).task).toBe("foo");
    expect(() => parseFixArgs(["extra"])).toThrow(/想定外の引数/);
  });

  it("parseDoctorArgs rejects extra arguments", () => {
    expect(parseDoctorArgs([])).toEqual({ help: false });
    expect(() => parseDoctorArgs(["--task"])).toThrow(/不明なオプション/);
  });

  it("parseCompletionCliArgs requires a supported shell", () => {
    expect(parseCompletionCliArgs(["bash"])).toEqual({ shell: "bash" });
    expect(() => parseCompletionCliArgs([])).toThrow(/bash.*powershell/);
    expect(() => parseCompletionCliArgs(["zsh"])).toThrow(/不明なシェル/);
  });
});

describe("parseExecArgs", () => {
  it("parses helper source and path limits", () => {
    const opts = parseExecArgs([
      "--allow-fs-read",
      "src/**,tests/**",
      "--allow-fs-write",
      "artifacts/**",
      "--timeout",
      "1234",
      "--max-output",
      "4321",
      "console.log('hi')",
      "--arg",
      "x",
    ]);
    expect(opts.allowFsRead).toEqual(["src/**", "tests/**"]);
    expect(opts.allowFsWrite).toEqual(["artifacts/**"]);
    expect(opts.timeoutMs).toBe(1234);
    expect(opts.maxOutputBytes).toBe(4321);
    expect(opts.scriptSource).toContain("console.log('hi')");
    expect(opts.scriptArgs).toEqual(["x"]);
  });

  it("accepts --file without inline source", () => {
    const opts = parseExecArgs(["--file", "helper.mjs"]);
    expect(opts.filePath).toBe("helper.mjs");
    expect(opts.scriptSource).toBe("");
  });

  it("rejects absolute allow-fs paths", () => {
    const absPath = process.platform === "win32" ? "C:\\tmp" : "/tmp";
    expect(() => parseExecArgs(["--allow-fs-read", absPath])).toThrow(
      "must be a workspace-relative path or glob",
    );
  });

  it("rejects parent-directory traversal in allow-fs paths", () => {
    expect(() => parseExecArgs(["--allow-fs-write", "../secret/**"])).toThrow(
      "must not contain .. path traversal",
    );
  });
});
