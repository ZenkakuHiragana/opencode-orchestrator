import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

declare const __dirname: string;

describe("packaged orchestrator skills", () => {
  it("ships orchestrator skill files in the repository", () => {
    const root = path.join(__dirname, "..");
    const files = [
      "skills/orch-planner-gate-cycle/SKILL.md",
      "skills/orch-refiner-evidence-design/SKILL.md",
      "skills/orch-spec-operational-check/SKILL.md",
      "skills/orch-todo-decomposition/SKILL.md",
    ];

    for (const relativePath of files) {
      const absolutePath = path.join(root, relativePath);
      expect(fs.existsSync(absolutePath)).toBe(true);
      const content = fs.readFileSync(absolutePath, "utf8");
      expect(content).toContain("name:");
      expect(content).toContain("description:");
    }
  });

  it("publishes the skills directory in package.json", () => {
    const pkgPath = path.join(__dirname, "..", "package.json");
    const raw = fs.readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { files?: string[] };
    expect(pkg.files).toContain("skills");
  });
});
