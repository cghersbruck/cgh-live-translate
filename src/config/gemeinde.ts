/**
 * Gemeinde-spezifische Konfiguration.
 *
 * Bewusst getrennt von `src/lib/languages.ts` (Upstream-Datei), damit
 * Anpassungen ein spaeteres `git pull` vom Upstream nicht behindern.
 * Hier stehen nur eigene Werte, keine Kopien der Upstream-Sprachliste.
 */

/**
 * Vorauswahl beim Anlegen einer Session - KEINE Festlegung.
 *
 * Diese Sprachen sind auf der Startseite vorangehakt, damit der uebliche Fall
 * ohne Klickarbeit auskommt. Die vollstaendige Liste bleibt dort auswaehlbar:
 * Haken lassen sich entfernen und beliebige andere Sprachen hinzufuegen.
 *
 * Was die Hoerer angeboten bekommen, entscheidet allein diese Auswahl beim
 * Anlegen der Session. Auf der Hoererseite wird bewusst nicht noch einmal
 * gefiltert - sonst koennte der Sender eine Sprache freigeben, die beim
 * Besucher gar nicht auftaucht.
 *
 * Die Codes muessen exakt denen in `SUPPORTED_LANGUAGES` entsprechen, sonst
 * greift die Vorauswahl ins Leere.
 * Geprueft gegen src/lib/languages.ts: alle fuenf vorhanden.
 *
 * Bewusst `zh-Hans` (vereinfacht) und nicht `zh-Hant`. Zeigt sich Bedarf
 * aus Hongkong oder Taiwan, wird nachtraeglich ergaenzt - nicht vorsorglich
 * beides anbieten, das verwirrt in der Auswahl mehr als es hilft.
 */
export const GEMEINDE_LANGUAGES: string[] = [
  "en",      // English
  "ro",      // Romana
  "ru",      // Russkij
  "hu",      // Magyar
  "zh-Hans", // Chinesisch (vereinfacht)
];

/**
 * Anzeigenamen in der jeweiligen Sprache selbst.
 *
 * Der Upstream fuehrt in `SUPPORTED_LANGUAGES` nur englische Namen
 * ("Romanian", "Hungarian"). Wer die Auswahlliste braucht, liest aber oft
 * weder Deutsch noch Englisch - deshalb die native Schreibweise.
 *
 * Die Tabelle deckt absichtlich mehr als die fuenf Standardsprachen ab:
 * Die Liste muss zur Laufzeit erweiterbar bleiben (Besuch aus einem anderen
 * Land), und dann soll der native Name sofort mitkommen.
 */
export const NATIVE_LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  ro: "Română",
  ru: "Русский",
  hu: "Magyar",
  "zh-Hans": "简体中文",
  // Reserve fuer kurzfristige Erweiterung zur Laufzeit:
  "zh-Hant": "繁體中文",
  uk: "Українська",
  ar: "العربية",
  fa: "فارسی",
  tr: "Türkçe",
  pl: "Polski",
  es: "Español",
  fr: "Français",
  it: "Italiano",
  "pt-BR": "Português",
  bg: "Български",
  hr: "Hrvatski",
  sr: "Српски",
  el: "Ελληνικά",
  vi: "Tiếng Việt",
  de: "Deutsch",
};

/**
 * Nativer Anzeigename mit Rueckfall auf den englischen Upstream-Namen.
 * So bleibt eine zur Laufzeit ergaenzte Sprache bedienbar, auch wenn sie
 * in NATIVE_LANGUAGE_NAMES noch fehlt.
 */
export function getNativeLanguageName(
  code: string,
  fallbackName: string
): string {
  return NATIVE_LANGUAGE_NAMES[code] ?? fallbackName;
}

/**
 * Feste Session-ID fuer den Regelbetrieb (T-06).
 *
 * Ergibt eine gleichbleibende URL, die auf Handzettel, Beamer-Folie und
 * Aushang gedruckt werden kann - ohne jeden Sonntag einen neuen QR-Code.
 */
export const GEMEINDE_SESSION_ID = "cgh";
