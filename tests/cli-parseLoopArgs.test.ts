import { describe, it, expect } from "vitest";
import { parseLoopArgs } from "../src/cli.js";

describe("parseLoopArgs", () => {
  it("parses minimal required args", () => {
    const opts = parseLoopArgs(["--task", "foo", "do something"]);
    expect(opts.task).toBe("foo");
    expect(opts.prompt).toBe("do something");
    expect(opts.sessionId).toBeUndefined();
    expect(opts.continueLast).toBe(false);
    expect(opts.commitOnDone).toBe(false);
  });

  it("throws when task is missing", () => {
    expect(() => parseLoopArgs(["do", "something"])).toThrow(
      /--task is required/,
    );
  });

  it("rejects unknown options", () => {
    expect(() => parseLoopArgs(["--task", "foo", "--unknown"])).toThrow(
      /unknown option/,
    );
  });

  it("builds default prompt when none given", () => {
    const opts = parseLoopArgs(["--task", "foo"]);
    expect(opts.prompt).toContain('task key "foo"');
  });
});
