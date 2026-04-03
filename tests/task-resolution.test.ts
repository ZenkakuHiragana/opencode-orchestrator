import { describe, it, expect } from "vitest";
import { computeEditDistance, suggestTasks } from "../src/task-resolution.js";

describe("computeEditDistance", () => {
  it("returns 0 for identical strings", () => {
    expect(computeEditDistance("task", "task")).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(computeEditDistance("Task", "task")).toBe(0);
  });

  it("returns expected distance for simple edits", () => {
    expect(computeEditDistance("task", "taks")).toBe(2);
    expect(computeEditDistance("task", "tas")).toBe(1);
  });
});

describe("suggestTasks", () => {
  const tasks = ["cli-ux-i18n-and-completion", "another-task", "sample"];

  it("returns empty list when input is empty", () => {
    expect(suggestTasks("", tasks)).toEqual([]);
  });

  it("returns best match for close name", () => {
    const suggestions = suggestTasks("cli-ux-i18n-and-completin", tasks);
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    expect(suggestions[0].task).toBe("cli-ux-i18n-and-completion");
  });

  it("returns no suggestions when all tasks are very far", () => {
    const suggestions = suggestTasks("zzzzzzzzzz", tasks);
    expect(suggestions.length).toBe(0);
  });
});
