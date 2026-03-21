import { describe, it, expect } from "vitest";

import { parseNameOnlyList, isDeniedPath } from "../src/autocommit.js";

describe("parseNameOnlyList", () => {
  it("splits non-empty lines", () => {
    const text = "a\n\n b \n";
    expect(parseNameOnlyList(text)).toEqual(["a", "b"]);
  });
});

describe("isDeniedPath", () => {
  it("blocks obvious secret-like paths", () => {
    expect(isDeniedPath(".env")).toBe(true);
    expect(isDeniedPath("config/credentials.json")).toBe(true);
  });

  it("blocks common build artifacts", () => {
    expect(isDeniedPath("dist/index.js")).toBe(true);
    expect(isDeniedPath("logs/output.log")).toBe(true);
  });

  it("allows normal source files", () => {
    expect(isDeniedPath("src/index.ts")).toBe(false);
  });
});
