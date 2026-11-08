import type { UiLocale } from "./ui-locale";

export const reviewMessages: Record<UiLocale, { volume: string; companion: string; tabError: string; powered: string; listeners: Partial<Record<Intl.LDMLPluralRule, string>> }> = {
  de: { volume: "Lautstärke", companion: "Companion-Steuerung aktiv · Sitzung", tabError: "Tab-Audio konnte nicht erfasst werden", powered: "Bereitgestellt von", listeners: { one: "Zuhörer", other: "Zuhörer" } },
  en: { volume: "Volume", companion: "Companion control active · Session", tabError: "Could not capture tab audio", powered: "Powered by", listeners: { one: "listener", other: "listeners" } },
  "zh-Hans": { volume: "音量", companion: "Companion 控制已启用 · 会话", tabError: "无法捕获标签页音频", powered: "技术支持", listeners: { other: "位听众" } },
  es: { volume: "Volumen", companion: "Control de Companion activo · Sesión", tabError: "No se pudo capturar el audio de la pestaña", powered: "Con tecnología de", listeners: { one: "oyente", other: "oyentes" } },
  ro: { volume: "Volum", companion: "Control Companion activ · Sesiune", tabError: "Nu s-a putut captura sunetul filei", powered: "Oferit de", listeners: { one: "ascultător", few: "ascultători", other: "de ascultători" } },
  ru: { volume: "Громкость", companion: "Управление Companion активно · Сеанс", tabError: "Не удалось захватить звук вкладки", powered: "Работает на", listeners: { one: "слушатель", few: "слушателя", many: "слушателей", other: "слушателя" } },
  hu: { volume: "Hangerő", companion: "Companion vezérlés aktív · Munkamenet", tabError: "A lap hangja nem rögzíthető", powered: "Technológia:", listeners: { one: "hallgató", other: "hallgató" } },
};

export function listenerLabel(count: number, locale: UiLocale): string {
  const forms = reviewMessages[locale].listeners;
  return `${count} ${forms[new Intl.PluralRules(locale).select(count)] ?? forms.other}`;
}
