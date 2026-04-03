import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// NOTE: These tests assume a Node-like runtime where __dirname exists.
declare const __dirname: string;

describe("package.json bin alias", () => {
  it("exposes both 'opencode-orchestrator' and 'ococ' pointing to the same CLI entrypoint", () => {
    const pkgPath = path.join(__dirname, "..", "package.json");
    const raw = fs.readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as {
      bin?: Record<string, string>;
    };

    expect(pkg.bin).toBeDefined();
    expect(pkg.bin?.["opencode-orchestrator"]).toBe("dist/cli.js");
    expect(pkg.bin?.ococ).toBe("dist/cli.js");
  });
});
