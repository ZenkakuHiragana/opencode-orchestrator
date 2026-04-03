import {
  detectCliLanguageFromEnv,
  type SupportedLanguage,
} from "./locale-detection.js";
import { messagesEn, type MessageKeyEn } from "./messages.en.js";
import { messagesJa, type MessageKeyJa } from "./messages.ja.js";

export type MessageKey = MessageKeyEn & MessageKeyJa;

export type MessageParams = Record<string, string | number>;

function getCatalog(language: SupportedLanguage): Record<MessageKey, string> {
  if (language === "ja") {
    return messagesJa as Record<MessageKey, string>;
  }
  return messagesEn as Record<MessageKey, string>;
}

let cachedLanguage: SupportedLanguage | null = null;
let cachedLcAll: string | undefined | null = null;
let cachedLang: string | undefined | null = null;

export function getActiveLanguage(): SupportedLanguage {
  const currentLcAll = process.env.LC_ALL;
  const currentLang = process.env.LANG;

  if (
    cachedLanguage !== null &&
    cachedLcAll === currentLcAll &&
    cachedLang === currentLang
  ) {
    return cachedLanguage;
  }

  const { language } = detectCliLanguageFromEnv();
  cachedLanguage = language;
  cachedLcAll = currentLcAll;
  cachedLang = currentLang;
  return language;
}

/**
 * Reset the cached locale. Useful in tests when process.env is modified
 * between assertions.
 */
export function resetLocaleCache(): void {
  cachedLanguage = null;
  cachedLcAll = null;
  cachedLang = null;
}

export function t(key: MessageKey, params?: MessageParams): string {
  const lang = getActiveLanguage();
  const catalog = getCatalog(lang);
  const template = catalog[key] ?? (messagesEn as Record<string, string>)[key];

  if (!template) {
    return key;
  }

  if (!params) {
    return template;
  }

  return template.replace(/\{([^}]+)\}/g, (match, name) => {
    if (Object.prototype.hasOwnProperty.call(params, name)) {
      return String(params[name]);
    }
    return match;
  });
}
