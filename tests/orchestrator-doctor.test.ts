import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { runDoctorCommand } from "../src/orchestrator-doctor.js";
import { getOrchestratorBaseDir } from "../src/orchestrator-paths.js";

// NOTE: These tests assume a Node-like runtime where `process.env` exists.
declare const process: { env: Record<string, string | undefined> };

describe("runDoctorCommand", () => {
  let prevXdg: string | undefined;
  let prevLC_ALL: string | undefined;
  let prevLANG: string | undefined;

  beforeEach(() => {
    prevXdg = process.env.XDG_STATE_HOME;
    prevLC_ALL = process.env.LC_ALL;
    prevLANG = process.env.LANG;
    process.env.LC_ALL = "ja_JP.UTF-8";
    process.env.LANG = "ja_JP.UTF-8";
  });

  afterEach(() => {
    if (prevXdg === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = prevXdg;
    }
    if (prevLC_ALL === undefined) {
      delete process.env.LC_ALL;
    } else {
      process.env.LC_ALL = prevLC_ALL;
    }
    if (prevLANG === undefined) {
      delete process.env.LANG;
    } else {
      process.env.LANG = prevLANG;
    }
    vi.restoreAllMocks();
  });

  it("emits some output and returns a numeric exit code", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await runDoctorCommand({ argv: [] });

    expect(typeof code).toBe("number");
    expect(errSpy).toHaveBeenCalled();
  }, 15_000);

  it("rejects unsupported arguments instead of ignoring them", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await runDoctorCommand({ argv: ["--task", "demo-task"] });

    expect(code).toBe(1);
    expect(errSpy).toHaveBeenCalled();
  });

  it("reports when the orchestrator state base directory is missing", async () => {
    const tmpBase = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-doctor-missing-"),
    );
    process.env.XDG_STATE_HOME = tmpBase;

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await runDoctorCommand({ argv: [] });
    expect(typeof code).toBe("number");

    const text = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("状態ディレクトリが見つかりません");
  });

  it("reports when the orchestrator state base directory is not writable", async () => {
    // chmod does not reliably restrict write access on Windows due to ACLs.
    if ((globalThis as any).process?.platform === "win32") {
      return;
    }

    const tmpBase = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-doctor-nowrite-"),
    );
    process.env.XDG_STATE_HOME = tmpBase;

    const baseDir = getOrchestratorBaseDir();
    fs.mkdirSync(baseDir, { recursive: true });

    try {
      fs.chmodSync(baseDir, 0o500);
    } catch {
      // If chmod fails (e.g. on certain platforms), we still run doctor; the
      // test will pass as long as at least one message is printed.
    }

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await runDoctorCommand({ argv: [] });
    expect(typeof code).toBe("number");

    const text = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("状態ディレクトリを書き込み不可として検出しました");
  });
});
