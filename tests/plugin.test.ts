import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { OrchestratorPlugin } from "../src/index.js";
import { getOpencodeClient } from "../src/opencode-client-store.js";

describe("OrchestratorPlugin", () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    process.argv = ["node", "test.js"];
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it("registers preflight-cli tool when not running orch-preflight", async () => {
    const client = { tag: "client" };
    const plugin = await OrchestratorPlugin({ client } as any);
    expect(getOpencodeClient()).toBe(client);
    expect(plugin.tool).toHaveProperty("autocommit");
    expect(plugin.tool).toHaveProperty("orch_todo_read");
    expect(plugin.tool).toHaveProperty("orch_todo_write");
    expect(plugin.tool).toHaveProperty("preflight-cli");
  });

  it("omits preflight-cli tool inside orch-preflight command session", async () => {
    process.argv = ["node", "x", "run", "--command", "orch-preflight"];
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    expect(plugin.tool).toHaveProperty("autocommit");
    expect(plugin.tool).not.toHaveProperty("preflight-cli");
  });

  it("wires orchestrator agents and commands into config", async () => {
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {};
    expect(typeof plugin.config).toBe("function");
    await plugin.config!(config);

    expect(typeof config.agent).toBe("object");
    expect(typeof config.command).toBe("object");

    expect(config.agent["orch-executor"]).toBeTruthy();
    expect(typeof config.agent["orch-executor"].prompt).toBe("string");
    expect(config.command["orch-exec"]).toBeTruthy();
    expect(typeof config.command["orch-exec"].template).toBe("string");
  });
});
