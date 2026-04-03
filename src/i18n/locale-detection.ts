import { spawnSync } from "node:child_process";

export type SupportedLanguage = "en" | "ja";

export type LocaleSource =
  | "LC_ALL"
  | "LANG"
  | "default"
  | "windows_ui_override"
  | "windows_ui_culture"
  | "windows_system_locale"
  | "windows_default";

export interface LocaleSelectionResult {
  language: SupportedLanguage;
  source: LocaleSource;
  rawLocale: string | null;
}

function normalizeLocaleTag(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isJapaneseLocaleTag(tag: string): boolean {
  const lower = tag.toLowerCase();
  return lower.startsWith("ja");
}

export type WindowsLocaleDetectorKind =
  | "ui-override"
  | "ui-culture"
  | "system-locale";

export type WindowsLocaleDetector = (
  kind: WindowsLocaleDetectorKind,
) => string | null;

function createDefaultWindowsLocaleDetector(): WindowsLocaleDetector {
  return (kind: WindowsLocaleDetectorKind): string | null => {
    const powershell = "powershell";
    let script: string;

    if (kind === "ui-override") {
      // Based on Get-WinUILanguageOverride (International module).
      // https://learn.microsoft.com/en-us/powershell/module/international/get-winuilanguageoverride
      script = "(Get-WinUILanguageOverride).UILanguage";
    } else if (kind === "ui-culture") {
      // Get-UICulture provides the current UI culture for the session.
      // https://learn.microsoft.com/powershell/module/microsoft.powershell.utility/get-uiculture
      script = "(Get-UICulture).Name";
    } else {
      // Fallback: Get-WinSystemLocale returns the system locale.
      // https://learn.microsoft.com/en-us/powershell/module/international/get-winsystemlocale
      script = "(Get-WinSystemLocale).Name";
    }

    try {
      const result = spawnSync(powershell, ["-NoProfile", "-Command", script], {
        encoding: "utf8",
      });
      if (result.status !== 0 || !result.stdout) {
        return null;
      }
      const value = result.stdout.trim();
      return value.length > 0 ? value : null;
    } catch {
      return null;
    }
  };
}

/**
 * Detect the CLI message language from environment variables and, on Windows,
 * from the OS UI/display language.
 *
 * Unix 系環境では LC_ALL を最優先し、次に LANG を参照します。値が
 * "ja" または "ja_*" で始まる場合は日本語 ("ja"), それ以外は英語
 * ("en") として扱います。LC_ALL/LANG が設定されていない、または空の
 * 場合は英語を安全なフォールバックとして選択します。
 *
 * Windows 環境では PowerShell 経由で UI 言語に近いロケールタグを取得
 * します。優先順位は次のとおりです:
 *   1) Get-WinUILanguageOverride().UILanguage (UI 言語オーバーライド)
 *   2) (Get-UICulture).Name (現在の UI カルチャ)
 *   3) (Get-WinSystemLocale).Name (システムロケール)
 * これらのいずれかが "ja" または "ja_*" で始まる場合は日本語、それ以外
 * は英語として扱います。すべての取得に失敗した場合は英語 ("en") を
 * フォールバックとして返します。
 *
 * Windows の詳細な背景や参考 URL は docs/windows-locale-detection-notes.md
 * を参照してください。
 */
export function detectCliLanguageFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  windowsDetector?: WindowsLocaleDetector,
): LocaleSelectionResult {
  if (platform === "win32") {
    const detector = windowsDetector ?? createDefaultWindowsLocaleDetector();

    const uiOverride = normalizeLocaleTag(detector("ui-override"));
    if (uiOverride) {
      return {
        language: isJapaneseLocaleTag(uiOverride) ? "ja" : "en",
        source: "windows_ui_override",
        rawLocale: uiOverride,
      };
    }

    const uiCulture = normalizeLocaleTag(detector("ui-culture"));
    if (uiCulture) {
      return {
        language: isJapaneseLocaleTag(uiCulture) ? "ja" : "en",
        source: "windows_ui_culture",
        rawLocale: uiCulture,
      };
    }

    const systemLocale = normalizeLocaleTag(detector("system-locale"));
    if (systemLocale) {
      return {
        language: isJapaneseLocaleTag(systemLocale) ? "ja" : "en",
        source: "windows_system_locale",
        rawLocale: systemLocale,
      };
    }

    return { language: "en", source: "windows_default", rawLocale: null };
  }

  const lcAll = normalizeLocaleTag(env.LC_ALL as string | undefined);
  if (lcAll) {
    return {
      language: isJapaneseLocaleTag(lcAll) ? "ja" : "en",
      source: "LC_ALL",
      rawLocale: lcAll,
    };
  }

  const lang = normalizeLocaleTag(env.LANG as string | undefined);
  if (lang) {
    return {
      language: isJapaneseLocaleTag(lang) ? "ja" : "en",
      source: "LANG",
      rawLocale: lang,
    };
  }

  return {
    language: "en",
    source: "default",
    rawLocale: null,
  };
}
