/**
 * Kostenschaetzung fuer die Live-Uebersetzung.
 *
 * Preise laut https://ai.google.dev/gemini-api/docs/pricing, Stand
 * 2026-10-04, Modell gemini-3.5-live-translate-preview. Das Modell ist im
 * Preview-Status - Google kann die Preise jederzeit aendern. Dann HIER
 * anpassen.
 */
export const PREISE = {
  /** USD je 1 Mio. Audio-Eingabetokens. */
  eingabeUsdProMio: 3.5,
  /** USD je 1 Mio. Audio-Ausgabetokens. */
  ausgabeUsdProMio: 21.0,
  /** Google rechnet 25 Tokens je Sekunde Audio ab. */
  tokensProSekunde: 25,
};

/**
 * Abgerechnete Eingabe relativ zur gesendeten Audiodauer.
 *
 * Am 2026-10-04 lag die abgerechnete Eingabe beim Dreifachen dessen, was laut
 * Log gesendet wurde - bei 48 kHz Eingangsrate. 48 : 16 = 3. Die naheliegende
 * Erklaerung: Google bewertet Audio so, als kaeme es mit 16 kHz. Bis ein
 * A/B-Test das bestaetigt, ist das eine ANNAHME. Sie wird hier verwendet, weil
 * die Schaetzung sonst am tatsaechlichen Rechnungsbetrag vorbeigeht.
 */
export function eingabeFaktor(abtastrate: number): number {
  return Math.max(1, abtastrate / 16000);
}

export interface Verbrauch {
  /** Sekunden Audio, die an Gemini gesendet wurden. */
  eingabeSek: number;
  /** Sekunden Audio, die Gemini zurueckgeliefert hat. */
  ausgabeSek: number;
  /** Eingangs-Abtastrate, mit der gesendet wurde. */
  abtastrate: number;
}

export function kostenUsd(v: Verbrauch): number {
  const ein =
    v.eingabeSek * PREISE.tokensProSekunde * eingabeFaktor(v.abtastrate) *
    (PREISE.eingabeUsdProMio / 1_000_000);
  const aus =
    v.ausgabeSek * PREISE.tokensProSekunde * (PREISE.ausgabeUsdProMio / 1_000_000);
  return ein + aus;
}

/**
 * Wechselkurs fuer die Anzeige in Euro. Google rechnet in USD ab; ein fester
 * Kurs im Code waere schnell veraltet. Deshalb nur, wenn KOSTEN_USD_EUR gesetzt
 * ist (z. B. 0.86) - sonst zeigt die Sendeseite nur Dollar.
 */
export function eurKurs(): number | null {
  const k = Number(process.env.KOSTEN_USD_EUR);
  return k > 0 ? k : null;
}
