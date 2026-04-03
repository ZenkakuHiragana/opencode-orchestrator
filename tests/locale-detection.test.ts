import { describe, it, expect } from "vitest";
import { detectCliLanguageFromEnv } from "../src/i18n/locale-detection.js";

type ProcessEnv = Record<string, string | undefined>;

describe("detectCliLanguageFromEnv (Unix)", () => {
  it("prefers LC_ALL over LANG and treats ja* as Japanese", () => {
    const result = detectCliLanguageFromEnv(
      { LC_ALL: "ja_JP.UTF-8", LANG: "en_US.UTF-8" } as ProcessEnv,
      "linux",
    );
    expect(result.language).toBe("ja");
    expect(result.source).toBe("LC_ALL");
    expect(result.rawLocale).toBe("ja_JP.UTF-8");
  });

  it("falls back to LANG when LC_ALL is not set", () => {
    const result = detectCliLanguageFromEnv(
      { LANG: "en_US.UTF-8" } as ProcessEnv,
      "linux",
    );
    expect(result.language).toBe("en");
    expect(result.source).toBe("LANG");
    expect(result.rawLocale).toBe("en_US.UTF-8");
  });

  it("treats ja without region as Japanese", () => {
    const result = detectCliLanguageFromEnv(
      { LANG: "ja" } as ProcessEnv,
      "linux",
    );
    expect(result.language).toBe("ja");
    expect(result.source).toBe("LANG");
    expect(result.rawLocale).toBe("ja");
  });

  it("falls back safely to English when LC_ALL/LANG are empty or missing", () => {
    const resultNoVars = detectCliLanguageFromEnv({} as ProcessEnv, "linux");
    expect(resultNoVars.language).toBe("en");
    expect(resultNoVars.source).toBe("default");
    expect(resultNoVars.rawLocale).toBeNull();

    const resultEmpty = detectCliLanguageFromEnv(
      { LC_ALL: " ", LANG: "" } as ProcessEnv,
      "linux",
    );
    expect(resultEmpty.language).toBe("en");
    expect(resultEmpty.source).toBe("default");
    expect(resultEmpty.rawLocale).toBeNull();
  });

  it("handles non-ja locales like C or POSIX as English", () => {
    const result = detectCliLanguageFromEnv(
      { LANG: "C" } as ProcessEnv,
      "linux",
    );
    expect(result.language).toBe("en");
    expect(result.source).toBe("LANG");
    expect(result.rawLocale).toBe("C");
  });

  it("respects LC_ALL precedence when it is non-ja and LANG is ja", () => {
    const result = detectCliLanguageFromEnv(
      { LC_ALL: "en_GB.UTF-8", LANG: "ja_JP.UTF-8" } as ProcessEnv,
      "linux",
    );
    expect(result.language).toBe("en");
    expect(result.source).toBe("LC_ALL");
    expect(result.rawLocale).toBe("en_GB.UTF-8");
  });
});

describe("detectCliLanguageFromEnv (Windows)", () => {
  it("prefers UI override and treats ja* as Japanese", () => {
    const detector = (kind: "ui-override" | "ui-culture" | "system-locale") => {
      if (kind === "ui-override") return "ja-JP";
      if (kind === "ui-culture") return "en-US";
      return "en-US";
    };

    const result = detectCliLanguageFromEnv(
      {} as ProcessEnv,
      "win32",
      detector,
    );
    expect(result.language).toBe("ja");
    expect(result.source).toBe("windows_ui_override");
    expect(result.rawLocale).toBe("ja-JP");
  });

  it("falls back to UI culture when override is empty", () => {
    const detector = (kind: "ui-override" | "ui-culture" | "system-locale") => {
      if (kind === "ui-override") return "";
      if (kind === "ui-culture") return "en-US";
      return "ja-JP";
    };

    const result = detectCliLanguageFromEnv(
      {} as ProcessEnv,
      "win32",
      detector,
    );
    expect(result.language).toBe("en");
    expect(result.source).toBe("windows_ui_culture");
    expect(result.rawLocale).toBe("en-US");
  });

  it("falls back to system locale when both override and UI culture are empty", () => {
    const detector = (kind: "ui-override" | "ui-culture" | "system-locale") => {
      if (kind === "system-locale") return "ja-JP";
      return "";
    };

    const result = detectCliLanguageFromEnv(
      {} as ProcessEnv,
      "win32",
      detector,
    );
    expect(result.language).toBe("ja");
    expect(result.source).toBe("windows_system_locale");
    expect(result.rawLocale).toBe("ja-JP");
  });

  it("falls back safely to English when all sources fail", () => {
    const detector = () => "";
    const result = detectCliLanguageFromEnv(
      {} as ProcessEnv,
      "win32",
      detector,
    );
    expect(result.language).toBe("en");
    expect(result.source).toBe("windows_default");
    expect(result.rawLocale).toBeNull();
  });
});
