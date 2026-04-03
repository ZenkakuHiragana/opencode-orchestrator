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

export function getActiveLanguage(): SupportedLanguage {
  const { language } = detectCliLanguageFromEnv();
  return language;
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
