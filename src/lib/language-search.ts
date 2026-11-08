import type { Language } from "./languages";
import type { UiLocale } from "./ui-locale";

const displayNames = new Map<UiLocale, Intl.DisplayNames | null>();

export function languageLabel(language: Language, locale: UiLocale): string {
  try {
    if (!displayNames.has(locale)) {
      displayNames.set(locale, new Intl.DisplayNames([locale], { type: "language", fallback: "none" }));
    }
    return displayNames.get(locale)?.of(language.code) || language.name;
  } catch {
    return language.name;
  }
}

export function matchesLanguage(language: Language, locale: UiLocale, query: string): boolean {
  const normalize = (value: string) => value.trim().toLocaleLowerCase(locale).normalize("NFD").replace(/\p{Diacritic}/gu, "");
  const needle = normalize(query);
  return [languageLabel(language, locale), language.name, language.code]
    .some((value) => normalize(value).includes(needle));
}
