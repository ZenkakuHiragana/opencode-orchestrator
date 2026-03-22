import { describe, it, expect } from "vitest";

import { truncateExcerpt } from "../src/preflight-cli.js";

describe("truncateExcerpt", () => {
  it("returns string unchanged when shorter than maxLen", () => {
    expect(truncateExcerpt("short text")).toBe("short text");
  });

  it("returns string unchanged when equal to maxLen", () => {
    const text = "a".repeat(200);
    expect(truncateExcerpt(text)).toBe(text);
  });

  it("truncates and appends ellipsis when longer than maxLen", () => {
    const text = "a".repeat(250);
    const result = truncateExcerpt(text);
    expect(result).toHaveLength(203); // 200 + "..."
    expect(result.endsWith("...")).toBe(true);
    expect(result.slice(0, 200)).toBe("a".repeat(200));
  });

  it("respects custom maxLen", () => {
    const text = "hello world";
    expect(truncateExcerpt(text, 5)).toBe("hello...");
  });

  it("handles empty string", () => {
    expect(truncateExcerpt("")).toBe("");
  });

  it("handles maxLen of 0", () => {
    expect(truncateExcerpt("text", 0)).toBe("...");
  });

  it("handles unicode characters", () => {
    const text = "あ".repeat(300);
    const result = truncateExcerpt(text, 10);
    expect(result).toHaveLength(13); // 10 + "..."
    expect(result.endsWith("...")).toBe(true);
  });
});
