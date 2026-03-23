import { describe, it, expect, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const original: any = await importOriginal();
  const originalExistsSync = original.existsSync;
  return {
    ...original,
    existsSync: (p: any) => {
      const s = String(p);
      if (
        s.endsWith("commands/orch-exec.md") ||
        s.endsWith("commands\\orch-exec.md")
      ) {
        return false;
      }
      return originalExistsSync(p);
    },
  };
});

describe("OrchestratorPlugin command fallback", () => {
  it("uses minimal template when command markdown is missing", async () => {
    const { OrchestratorPlugin } = await import("../src/index.js");
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {};
    await plugin.config!(config);

    expect(config.command["orch-exec"]).toBeTruthy();
    expect(typeof config.command["orch-exec"].template).toBe("string");
    expect(config.command["orch-exec"].template).toContain("$ARGUMENTS");
  });
});
