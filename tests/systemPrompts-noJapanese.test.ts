import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// Simple detector for Japanese characters (Hiragana, Katakana, Kanji).
// This is intentionally conservative: if any such code point appears,
// we treat the file as containing Japanese text.
const japaneseCharPattern =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9f]/;

function readFile(relativePath: string): string {
  const fullPath = path.join(__dirname, "..", relativePath);
  return fs.readFileSync(fullPath, "utf8");
}

describe("system prompts must not contain Japanese text", () => {
  it("orch-executor system prompt has no Japanese characters", () => {
    const content = readFile("agents/orch-executor.md");
    expect(japaneseCharPattern.test(content)).toBe(false);
  });

  it("orch-planner system prompt has no Japanese characters", () => {
    const content = readFile("agents/orch-planner.md");
    expect(japaneseCharPattern.test(content)).toBe(false);
  });

  it("orch-refiner system prompt has no Japanese characters", () => {
    const content = readFile("agents/orch-refiner.md");
    expect(japaneseCharPattern.test(content)).toBe(false);
  });

  it("orch-spec-checker system prompt has no Japanese characters", () => {
    const content = readFile("agents/orch-spec-checker.md");
    expect(japaneseCharPattern.test(content)).toBe(false);
  });
});
