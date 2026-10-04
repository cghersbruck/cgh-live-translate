/**
 * Steuer-Endpunkt fuer Bitfocus Companion.
 *
 * Companion nutzt sein Generic-HTTP-Modul. Damit eine Taste mit einer einzigen
 * URL auskommt, sind GET und POST gleichwertig - GET ist in Companion mit
 * Abstand am einfachsten einzurichten.
 *
 *   GET /api/control?session=gottesdienst&action=start&password=...
 *
 * Aktionen: start | pause | resume | stop | status
 * "status" setzt keinen Befehl, sondern liefert nur den Zustand zurueck -
 * dafuer gedacht, Companion-Tasten einzufaerben.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  befehlSetzen,
  statusLesen,
  zustandMelden,
  type ControlAction,
} from "@/lib/broadcast-control";
import TranslationSessionManager from "@/lib/translation-session-manager";

const ERLAUBTE_AKTIONEN: ControlAction[] = ["start", "pause", "resume", "stop"];

function pruefePasswort(uebergeben: string | null): boolean {
  const erwartet = process.env.BROADCAST_PASSWORD;
  if (!erwartet) return true;
  return uebergeben === erwartet;
}

function antwort(sessionId: string, extra: Record<string, unknown> = {}) {
  const e = statusLesen(sessionId);

  // Gestoerte Uebersetzungen. Damit Companion eine Taste rot faerben kann,
  // wenn etwa das Gemini-Guthaben erschoepft ist - waehrend die Sendeseite
  // selbst einwandfrei sendet.
  const stoerungen = TranslationSessionManager.getInstance()
    .getActiveTranslations(sessionId)
    .filter((t) => t.gesundheit === "gestoert")
    .map((t) => ({ sprache: t.language, text: t.stoerung?.text ?? "unbekannt" }));

  return NextResponse.json({
    sessionId,
    // Klartext fuer die Companion-Anzeige. Reihenfolge = Prioritaet.
    status: !e.state.connected
      ? "getrennt"
      : stoerungen.length > 0
        ? "fehler"
        : e.state.paused
        ? "pausiert"
        : e.state.sending
          ? "sendet"
          : "bereit",
    connected: e.state.connected,
    sending: e.state.sending,
    paused: e.state.paused,
    stoerungen,
    // Geschaetzte Kosten der Session, z. B. fuer eine Companion-Anzeige.
    kostenUsd: Math.round(TranslationSessionManager.getInstance().kostenLesen(sessionId).gesamtUsd * 100) / 100,
    pendingAction: e.action,
    seq: e.seq,
    ...extra,
  });
}

async function bearbeiten(req: NextRequest): Promise<NextResponse> {
  const p = req.nextUrl.searchParams;

  // Bei POST duerfen die Werte auch im Rumpf stehen.
  let body: Record<string, unknown> = {};
  if (req.method === "POST") {
    body = await req.json().catch(() => ({}));
  }

  const sessionId =
    p.get("session") ?? p.get("sessionId") ?? (body.session as string) ?? (body.sessionId as string);
  const action = (p.get("action") ?? (body.action as string) ?? "status").toLowerCase();
  const passwort = p.get("password") ?? (body.password as string) ?? null;

  if (!sessionId) {
    return NextResponse.json(
      { error: "Parameter 'session' fehlt" },
      { status: 400 }
    );
  }

  if (!pruefePasswort(passwort)) {
    return NextResponse.json({ error: "Falsches Passwort" }, { status: 401 });
  }

  if (action === "status") {
    return antwort(sessionId);
  }

  if (!ERLAUBTE_AKTIONEN.includes(action as ControlAction)) {
    return NextResponse.json(
      {
        error: `Unbekannte Aktion "${action}"`,
        erlaubt: [...ERLAUBTE_AKTIONEN, "status"],
      },
      { status: 400 }
    );
  }

  befehlSetzen(sessionId, action as ControlAction);
  return antwort(sessionId, { accepted: action });
}

export async function GET(req: NextRequest) {
  return bearbeiten(req);
}

export async function POST(req: NextRequest) {
  return bearbeiten(req);
}

/**
 * Rueckmeldung der Sendeseite. Nicht fuer Companion gedacht, sondern fuer die
 * Broadcast-Seite selbst: Sie meldet im Sekundentakt, was sie tatsaechlich tut,
 * und holt sich dabei den naechsten Befehl ab.
 */
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sessionId = body.sessionId as string;
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId fehlt" }, { status: 400 });
  }
  zustandMelden(sessionId, {
    sending: Boolean(body.sending),
    paused: Boolean(body.paused),
  });
  const e = statusLesen(sessionId);
  return NextResponse.json({ seq: e.seq, action: e.action });
}
