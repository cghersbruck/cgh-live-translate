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
export function selectLocale(saved: string | null, languages: readonly string[]): UiLocale {
  const stored = locales.find((locale) => locale === saved);
  return stored ?? languages.map(supportedLocale).find((locale) => locale !== undefined) ?? "de";
}
const keys = ["uiLanguage","audioLanguage","original","translations","translating","startingTranslation","translationError","audioPrompt","startAudio","wait","audioContinues","back","loading","error","retry"] as const;
type Key = typeof keys[number];
type StringTuple<T extends readonly unknown[]> = { [K in keyof T]: string };
const from = (values: StringTuple<typeof keys>) => Object.fromEntries(keys.map((key, index) => [key, values[index]])) as Record<Key, string>;
export const messages: Record<UiLocale, Record<Key, string>> = {
 de: from(["Oberflächensprache","Audiosprache","Original (Deutsch)","Übersetzungen","Übersetzung nach","Übersetzung wird gestartet …","Die Übersetzung ist gerade nicht erreichbar. Neuer Versuch in einer Minute.","Dein Telefon erlaubt den Ton erst nach einer Berührung.","Ton starten","Einen Moment …","Danach läuft die Übersetzung von selbst weiter.","Zurück","Laden …","Etwas ist schiefgelaufen","Erneut versuchen"]),
 en: from(["Interface language","Audio language","Original (German)","Translations","Translation into","Starting translation …","Translation is unavailable. We will retry in one minute.","Your phone needs a tap before it can play audio.","Start audio","One moment …","The translation continues automatically.","Back","Loading …","Something went wrong","Try again"]),
 "zh-Hans": from(["界面语言","音频语言","原声（德语）","翻译","翻译为","正在启动翻译……","暂时无法连接翻译。一分钟后重试。","请轻触屏幕以允许手机播放声音。","开启声音","请稍候……","翻译随后会自动继续。","返回","加载中……","出现错误","重试"]),
 es: from(["Idioma de la interfaz","Idioma del audio","Original (alemán)","Traducciones","Traducción a","Iniciando traducción …","La traducción no está disponible. Se reintentará en un minuto.","Toca la pantalla para permitir que tu teléfono reproduzca audio.","Activar sonido","Un momento …","La traducción continuará automáticamente.","Volver","Cargando …","Ha ocurrido un error","Reintentar"]),
 ro: from(["Limba interfeței","Limba audio","Original (germană)","Traduceri","Traducere în","Se pornește traducerea …","Traducerea nu este disponibilă. Reîncercăm într-un minut.","Atinge ecranul pentru a permite redarea sunetului.","Pornește sunetul","Un moment …","Traducerea va continua automat.","Înapoi","Se încarcă …","A apărut o eroare","Reîncearcă"]),
 ru: from(["Язык интерфейса","Язык аудио","Оригинал (немецкий)","Переводы","Перевод на","Запуск перевода …","Перевод недоступен. Повторная попытка через минуту.","Коснитесь экрана, чтобы разрешить воспроизведение звука.","Включить звук","Подождите …","Перевод продолжится автоматически.","Назад","Загрузка …","Произошла ошибка","Повторить"]),
 hu: from(["Felület nyelve","Hang nyelve","Eredeti (német)","Fordítások","Fordítás erre:","Fordítás indítása …","A fordítás nem érhető el. Egy perc múlva újra próbáljuk.","Érintse meg a képernyőt a hang lejátszásához.","Hang indítása","Egy pillanat …","A fordítás ezután automatikusan folytatódik.","Vissza","Betöltés …","Hiba történt","Újrapróbálás"]),
};
