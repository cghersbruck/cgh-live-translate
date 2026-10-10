/**
 * Einstellungen, die die Startseite zur Laufzeit braucht.
 *
 * Warum ein eigener Endpunkt statt NEXT_PUBLIC_-Variablen: Die backt Next beim
 * Bauen fest ins Image. Die Event-ID ist aber je Deployment verschieden und
 * soll ueber die Umgebung des Containers kommen, ohne neuen Build.
 */

import { NextResponse } from "next/server";

// Bei jedem Aufruf neu auswerten - der Wert kommt aus der Umgebung des
// laufenden Containers und darf nicht beim Bauen eingefroren werden.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    // Vorbelegung des Feldes "Event-ID". Leer = wie im Upstream eine
    // zufaellige ID beim Anlegen.
    standardEventId: process.env.DEFAULT_EVENT_ID?.trim() ?? "",
  });
}
