import { describe, it, expect } from "vitest";

import helperCommandsData from "../resources/helper-commands.json";

describe("helper-commands.json", () => {
  it("should have valid structure with helper_commands array", () => {
    expect(helperCommandsData).toBeDefined();
    expect(helperCommandsData.helper_commands).toBeDefined();
    expect(Array.isArray(helperCommandsData.helper_commands)).toBe(true);
  });

  it("should contain expected helper commands", () => {
    const ids = helperCommandsData.helper_commands.map((h) => h.id);
    expect(ids).toContain("grep");
    expect(ids).toContain("rg");
    expect(ids).toContain("sort");
    expect(ids).toContain("uniq");
    expect(ids).toContain("wc");
    expect(ids).toContain("jq");
  });

  it("each helper command should have required fields", () => {
    for (const cmd of helperCommandsData.helper_commands) {
      expect(cmd.id).toBeDefined();
      expect(typeof cmd.id).toBe("string");
      expect(cmd.command).toBeDefined();
      expect(typeof cmd.command).toBe("string");
      expect(cmd.probe).toBeDefined();
      expect(typeof cmd.probe).toBe("string");
      expect(cmd.purpose).toBeDefined();
      expect(typeof cmd.purpose).toBe("string");
    }
  });

  it("helper commands should use parameter placeholders where appropriate", () => {
    const withPlaceholders = helperCommandsData.helper_commands.filter((h) =>
      h.command.includes("{{"),
    );
    expect(withPlaceholders.length).toBeGreaterThan(0);

    // Verify that commands with placeholders have placeholders definition
    for (const cmd of withPlaceholders) {
      expect(cmd.placeholders).toBeDefined();
      expect(typeof cmd.placeholders).toBe("object");
    }
  });

  it("rg command should have correct structure for executor use", () => {
    const rg = helperCommandsData.helper_commands.find((h) => h.id === "rg");
    expect(rg).toBeDefined();
    expect(rg?.command).toBe("rg {{params}}");
    expect(rg?.probe).toBe("rg --version");
    expect(rg?.placeholders?.params).toContain("rg のオプションとパターン");
  });

  it("jq command should mention safety in purpose", () => {
    const jq = helperCommandsData.helper_commands.find((h) => h.id === "jq");
    expect(jq).toBeDefined();
    expect(jq?.purpose).toContain("JSON");
  });
});
