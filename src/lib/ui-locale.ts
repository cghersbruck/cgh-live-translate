export const locales = ["de", "en", "zh-Hans", "es", "ro", "ru", "hu"] as const;
export type UiLocale = typeof locales[number];

function supportedLocale(value: string | null | undefined): UiLocale | undefined {
  const language = value?.toLowerCase().split("-")[0];
  if (language === "zh") return "zh-Hans";
  return locales.find((locale) => locale === language);
}

export function normalizeLocale(value: string | null | undefined): UiLocale {
  return supportedLocale(value) ?? "de";
}

// Gespeicherte Wahl zuerst, danach die Browsersprachen, sonst Deutsch.
export function selectLocale(saved: string | null, languages: readonly string[]): UiLocale {
  const stored = locales.find((locale) => locale === saved);
  return stored ?? languages.map(supportedLocale).find((locale) => locale !== undefined) ?? "de";
}
