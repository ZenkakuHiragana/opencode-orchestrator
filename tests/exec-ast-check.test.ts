import { describe, expect, it } from "vitest";

import { assertExecHelperSourceIsSafe } from "../src/exec-ast-check.js";

describe("assertExecHelperSourceIsSafe", () => {
  it("accepts simple helper code", () => {
    expect(() =>
      assertExecHelperSourceIsSafe(`
        const value = 1;
        console.log(value);
      `),
    ).not.toThrow();
  });

  it("rejects process access", () => {
    expect(() => assertExecHelperSourceIsSafe("process.exit(1);"))
      .toThrowError(/process is not allowed/);
  });

  it("rejects import declarations", () => {
    expect(() => assertExecHelperSourceIsSafe('import fs from "node:fs";'))
      .toThrowError(/import declarations are not allowed/);
  });
});
