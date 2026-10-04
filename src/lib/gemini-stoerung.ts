/**
 * Einstufung von Verbindungsabbruechen zu Gemini.
 *
 * Hintergrund: Am 2026-10-04 brach die Uebersetzung im Gottesdienst ab, weil
 * das Gemini-Guthaben aufgebraucht war (Close-Code 1011, "Your prepayment
 * credits are depleted"). Die Bridge behandelte das wie einen Netzaussetzer
 * und versuchte es im Sekundentakt endlos weiter - rund 500 abgelehnte
 * Anfragen in zwei Stunden - waehrend die Sendeseite "active" anzeigte.
 *
 * Diese Datei trennt deshalb behebbare von endgueltigen Abbruechen. Google
 * transportiert den eigentlichen Grund als Klartext im Close-Grund, Code 1011
 * allein bedeutet nur "interner Fehler". Ausgewertet werden daher immer Code
 * UND Grundtext gemeinsam.
 */

/**
 * endgueltig      - loest sich nicht von selbst (Guthaben, Kontingent, Schluessel).
 *                   Kein schnelles Wiederholen, nur Erholungsversuch im Minutentakt.
 * voruebergehend  - Netzaussetzer, Neustart auf Google-Seite. Sofort wiederholen.
 * unklar          - 1011 ohne erkennbaren Grund. Begrenzt wiederholen.
 */
export type StoerungsArt = "endgueltig" | "voruebergehend" | "unklar";

export interface Stoerung {
  /** WebSocket-Close-Code, sofern vorhanden. */
  code: number | null;
  /** Originaler Grundtext von Google (vom WebSocket auf 123 Byte gekuerzt). */
  grund: string;
  /** Deutscher Klartext fuer die Sendeseite. */
  text: string;
  art: StoerungsArt;
  /** Beginn der Stoerung. */
  seit: number;
  /** Letzter gescheiterter Versuch. */
  zuletzt: number;
  /** Anzahl gescheiterter Versuche in dieser Stoerung. */
  versuche: number;
}

const MUSTER_GUTHABEN = /credit|prepay|billing|payment/i;
const MUSTER_KONTINGENT = /quota|exhaust|rate.?limit|too many|\b429\b/i;
const MUSTER_ZUGANG = /api.?key|unauthori[sz]ed|permission|forbidden|\b40[13]\b/i;
const MUSTER_RICHTLINIE = /policy|safety/i;
const MUSTER_VORUEBERGEHEND = /unavailable|overload|try again|deadline|timeout|\b50[234]\b/i;
/**
 * Nach einem goAway muss die alte Verbindung bis zum Fristende durch die neue
 * ersetzt sein, sonst bricht Google sie mit 1008 ab ("Connection aborted
 * because the client failed to close the connection after receiving a GoAway
 * signal ..."). Beobachtet am 2026-10-04 als Folgefehler des leeren Guthabens.
 * Der Abbruch selbst ist kein Grund zur Aufgabe - eine langsame
 * Wiederverbindung kann ihn ebenso ausloesen.
 */
const MUSTER_GOAWAY_FRIST = /goaway|failed to close the connection/i;

/** Ordnet einen Abbruch ein. `code` ist null bei Fehlern ohne Close-Frame. */
export function klassifiziere(code: number | null, grund: string): StoerungsArt {
  const g = grund || "";
  if (
    MUSTER_GUTHABEN.test(g) ||
    MUSTER_KONTINGENT.test(g) ||
    MUSTER_ZUGANG.test(g) ||
    MUSTER_RICHTLINIE.test(g)
  ) {
    return "endgueltig";
  }

  if (MUSTER_GOAWAY_FRIST.test(g)) return "voruebergehend";

  // 1002/1003/1007 Protokoll- bzw. Datenfehler, 4xxx anwendungsspezifisch -
  // nichts, was ein Wiederholen behebt.
  if (
    code === 1002 ||
    code === 1003 ||
    code === 1007 ||
    (code !== null && code >= 4000 && code < 5000)
  ) {
    return "endgueltig";
  }

  // 1008 ("policy violation") nutzt Google auch fuer Protokollabbrueche, siehe
  // MUSTER_GOAWAY_FRIST. Ein echter Richtlinienverstoss ist oben schon ueber den
  // Grundtext erfasst. Ohne erkennbaren Grund daher begrenzt wiederholen statt
  // sofort aufgeben.
  if (code === 1008) return "unklar";

  if (code === 1011) {
    return MUSTER_VORUEBERGEHEND.test(g) ? "voruebergehend" : "unklar";
  }

  // 1000/1001 unerwartet, 1006 Verbindung weg, 1012/1013/1014 Serverneustart,
  // null = Netzwerkfehler ohne Close-Frame.
  return "voruebergehend";
}

/** Deutscher Klartext fuer die Sendeseite. */
export function klartext(code: number | null, grund: string): string {
  const g = grund || "";
  if (MUSTER_GUTHABEN.test(g)) return "Gemini-Guthaben erschöpft. In AI Studio aufladen.";
  if (MUSTER_KONTINGENT.test(g)) return "Gemini-Kontingent erschöpft.";
  if (MUSTER_ZUGANG.test(g)) return "Gemini-Zugang abgelehnt. API-Schlüssel prüfen.";
  if (MUSTER_RICHTLINIE.test(g)) return "Von Gemini aus Richtliniengründen abgelehnt.";
  if (g) return `Gemini meldet: ${g}`;
  return `Verbindung zu Gemini getrennt (Code ${code ?? "–"}).`;
}

/**
 * Abbruch vor Abschluss des Setups. Traegt Code und Grund weiter, damit der
 * Session-Manager den Fehler einstufen kann - eine reine Error-Message wuerde
 * beides nur noch als Text enthalten.
 */
export class GeminiCloseError extends Error {
  public readonly code: number;
  public readonly grund: string;

  constructor(code: number, grund: string) {
    super(`Gemini WebSocket closed before setup: code=${code} reason=${grund}`);
    this.name = "GeminiCloseError";
    this.code = code;
    this.grund = grund;
  }
}

/** Code und Grund aus einem beliebigen Fehler gewinnen. */
export function ausFehler(error: unknown): { code: number | null; grund: string } {
  if (error instanceof GeminiCloseError) return { code: error.code, grund: error.grund };
  return { code: null, grund: error instanceof Error ? error.message : String(error) };
}
