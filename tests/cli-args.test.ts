import { describe, expect, it } from "vitest";

import { parseListArgs, parseLoopArgs } from "../src/cli-args.js";

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
});
