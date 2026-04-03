import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// NOTE: These tests assume a Node-like runtime where __dirname exists.
declare const __dirname: string;

describe("locale-detection documentation alignment", () => {
  it("does not claim Windows support is TODO or always English", () => {
    const filePath = path.join(__dirname, "../src/i18n/locale-detection.ts");
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).not.toContain("TODO");
    expect(source).not.toContain('常に\n * 英語 ("en") を返します');
  });
});
