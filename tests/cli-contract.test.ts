import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CLI_SUBCOMMANDS,
  getCliOptionValues,
  SUPPORTED_COMPLETION_SHELLS,
} from "../src/cli-contract.js";
import { resetLocaleCache } from "../src/i18n/messages.js";
import { messagesEn } from "../src/i18n/messages.en.js";
import { messagesJa } from "../src/i18n/messages.ja.js";
import { runCompleteCommand } from "../src/orchestrator-completion.js";

declare const process: { env: Record<string, string | undefined> };
declare const __dirname: string;

const usageKeyBySubcommand = {
  loop: "cli.loop.usage",
  list: "cli.list.usage",
  exec: "cli.exec.usage",
  clear: "cli.clear.usage",
  run: "cli.run.usage",
  resume: "cli.resume.usage",
  status: "cli.status.usage",
  doctor: "cli.doctor.usage",
  fix: "cli.fix.usage",
  completion: "cli.completion.usage",
} as const;

describe("CLI contract metadata", () => {
  let prevLC_ALL: string | undefined;
  let prevLANG: string | undefined;

  beforeEach(() => {
    prevLC_ALL = process.env.LC_ALL;
    prevLANG = process.env.LANG;
  });

  afterEach(() => {
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
    resetLocaleCache();
    vi.restoreAllMocks();
  });

  it("documents every contract option in both usage catalogs", () => {
    for (const subcommand of CLI_SUBCOMMANDS) {
      const usageKey = usageKeyBySubcommand[subcommand];
      const usageJa = messagesJa[usageKey];
      const usageEn = messagesEn[usageKey];
      for (const option of getCliOptionValues(subcommand)) {
        expect(usageJa, `${subcommand} usageJa missing ${option}`).toContain(
          option,
        );
        expect(usageEn, `${subcommand} usageEn missing ${option}`).toContain(
          option,
        );
      }
    }
  });

  it("documents the visible command surface in root help and README", () => {
    const rootUsageJa = messagesJa["cli.root.usage"];
    const rootUsageEn = messagesEn["cli.root.usage"];
    const readme = fs.readFileSync(
      path.join(__dirname, "..", "README.md"),
      "utf8",
    );

    for (const subcommand of CLI_SUBCOMMANDS) {
      expect(rootUsageJa).toContain(subcommand);
      expect(rootUsageEn).toContain(subcommand);
      expect(readme).toContain(`ococ ${subcommand}`);
    }

    for (const option of getCliOptionValues("loop")) {
      expect(readme, `README missing loop option ${option}`).toContain(option);
    }
  });

  it("offers completion candidates that match the shared contract", async () => {
    const lines: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args.map((a) => String(a)).join(" "));
    });

    process.env.LC_ALL = "en_US.UTF-8";
    process.env.LANG = "en_US.UTF-8";

    for (const subcommand of CLI_SUBCOMMANDS) {
      lines.length = 0;
      const line =
        subcommand === "completion"
          ? "ococ completion "
          : `ococ ${subcommand} -`;
      const code = await runCompleteCommand({
        argv: ["bash", line, String(line.length)],
      });
      expect(code).toBe(0);
      const values = lines.map((entry) => JSON.parse(entry).value as string);

      if (subcommand === "completion") {
        expect(values.sort()).toEqual([...SUPPORTED_COMPLETION_SHELLS].sort());
        continue;
      }

      expect(values.sort()).toEqual(getCliOptionValues(subcommand).sort());
    }

    logSpy.mockRestore();
  });
});
