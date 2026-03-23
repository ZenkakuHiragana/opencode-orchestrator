import { describe, it, expect } from "vitest";

describe("autocommit isDeniedPath", () => {
  it("blocks .ssh directory", async () => {
    const { isDeniedPath } = await import("../src/autocommit.js");

    expect(isDeniedPath(".ssh")).toBe(true);
    expect(isDeniedPath(".ssh/id_rsa")).toBe(true);
    expect(isDeniedPath("home/.ssh/authorized_keys")).toBe(true);
  });

  it("blocks .gnupg directory", async () => {
    const { isDeniedPath } = await import("../src/autocommit.js");

    expect(isDeniedPath(".gnupg")).toBe(true);
    expect(isDeniedPath(".gnupg/secring.gpg")).toBe(true);
  });

  it("blocks .aws directory", async () => {
    const { isDeniedPath } = await import("../src/autocommit.js");

    expect(isDeniedPath(".aws")).toBe(true);
    expect(isDeniedPath(".aws/credentials")).toBe(true);
  });

  it("blocks .kube directory", async () => {
    const { isDeniedPath } = await import("../src/autocommit.js");

    expect(isDeniedPath(".kube")).toBe(true);
    expect(isDeniedPath(".kube/config")).toBe(true);
  });

  it("blocks .npmrc and .pypirc", async () => {
    const { isDeniedPath } = await import("../src/autocommit.js");

    expect(isDeniedPath(".npmrc")).toBe(true);
    expect(isDeniedPath(".pypirc")).toBe(true);
  });

  it("allows normal project files", async () => {
    const { isDeniedPath } = await import("../src/autocommit.js");

    expect(isDeniedPath("src/index.ts")).toBe(false);
    expect(isDeniedPath("README.md")).toBe(false);
    expect(isDeniedPath("package.json")).toBe(false);
  });
});

describe("parseNameOnlyList", () => {
  it("handles empty input", async () => {
    const { parseNameOnlyList } = await import("../src/autocommit.js");

    expect(parseNameOnlyList("")).toEqual([]);
    expect(parseNameOnlyList("   ")).toEqual([]);
    expect(parseNameOnlyList("\n\n")).toEqual([]);
  });

  it("splits on newlines", async () => {
    const { parseNameOnlyList } = await import("../src/autocommit.js");

    expect(parseNameOnlyList("foo\nbar")).toEqual(["foo", "bar"]);
    expect(parseNameOnlyList("foo\r\nbar")).toEqual(["foo", "bar"]);
  });

  it("trims whitespace", async () => {
    const { parseNameOnlyList } = await import("../src/autocommit.js");

    expect(parseNameOnlyList("  foo  \n  bar  ")).toEqual(["foo", "bar"]);
  });
});
