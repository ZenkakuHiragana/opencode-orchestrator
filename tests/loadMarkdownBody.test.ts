import { describe, it, expect } from "vitest";

import { loadMarkdownBody } from "../src/markdown.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("loadMarkdownBody", () => {
  function writeTmpFile(content: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loadmd-"));
    const filePath = path.join(dir, "test.md");
    fs.writeFileSync(filePath, content, "utf8");
    return filePath;
  }

  it("returns full content when no frontmatter", () => {
    const p = writeTmpFile("Hello world\nSecond line");
    expect(loadMarkdownBody(p)).toBe("Hello world\nSecond line");
  });

  it("strips YAML frontmatter", () => {
    const p = writeTmpFile("---\ntitle: Test\n---\nBody text here");
    expect(loadMarkdownBody(p)).toBe("Body text here");
  });

  it("strips frontmatter with leading whitespace after closing fence", () => {
    const p = writeTmpFile("---\nkey: val\n---\n\n  Indented body");
    expect(loadMarkdownBody(p)).toBe("Indented body");
  });

  it("returns full content when frontmatter is not closed", () => {
    const p = writeTmpFile("---\nunclosed frontmatter\nNo closing fence");
    expect(loadMarkdownBody(p)).toBe(
      "---\nunclosed frontmatter\nNo closing fence",
    );
  });

  it("handles empty file", () => {
    const p = writeTmpFile("");
    expect(loadMarkdownBody(p)).toBe("");
  });

  it("handles file with only frontmatter (body is empty after closing fence)", () => {
    const p = writeTmpFile("---\nkey: val\n---");
    // "\n---" at index 12 is found, text.slice(12+4) = "", trimStart() = ""
    expect(loadMarkdownBody(p)).toBe("");
  });

  it("handles frontmatter with content after closing fence on same line", () => {
    const p = writeTmpFile("---\nkey: val\n---content starts here");
    // "\n---" at position 12 is the closing fence but "content starts here" follows
    const end = "\n---content starts here".indexOf("\n---", 4);
    // The function looks for "\n---" starting from index 4 of "---\n"
    // Original: "---\nkey: val\n---content starts here"
    // text starts with "---\n", end = text.indexOf("\n---", 4)
    // At index 4: "key: val\n---content starts here"
    // "\n---" found at index 11 (relative to string start)
    // end = 11, text.slice(11 + 4).trimStart() = "content starts here"
    expect(loadMarkdownBody(p)).toBe("content starts here");
  });
});
