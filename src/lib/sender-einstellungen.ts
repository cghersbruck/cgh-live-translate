/**
 * Merkt sich am Sende-PC das zuletzt verwendete Mikrofon samt Lautstaerke.
 *
 * Damit startet die Sendeseite beim naechsten Oeffnen von selbst mit
 * derselben Quelle - am Sonntag muss niemand mehr "Enable" druecken oder das
 * Geraet in den Chrome-Seiteneinstellungen suchen.
 *
 * Bewusst localStorage: Die Einstellung gehoert zum Sende-PC, nicht zur
 * Session. Ein anderer Rechner hat andere Geraete.
 */

const SCHLUESSEL = "cgh_sender_einstellungen";

export interface SenderEinstellungen {
  /** deviceId aus enumerateDevices. Leer = Standardgeraet des Browsers. */
  deviceId: string;
  /**
   * Klartextname des Geraets. Rueckfallebene, falls Chrome die deviceId neu
   * vergibt (passiert nach geloeschten Websitedaten oder Treiberwechsel).
   */
  label: string;
  /** Lautstaerke 0-100. */
  lautstaerke: number;
}

export function einstellungenLaden(): SenderEinstellungen | null {
  try {
    const roh = localStorage.getItem(SCHLUESSEL);
    if (!roh) return null;
    const e = JSON.parse(roh) as Partial<SenderEinstellungen>;
    return {
      deviceId: typeof e.deviceId === "string" ? e.deviceId : "",
      label: typeof e.label === "string" ? e.label : "",
      lautstaerke:
        typeof e.lautstaerke === "number" && e.lautstaerke >= 0 && e.lautstaerke <= 100
          ? e.lautstaerke
          : 100,
    };
  } catch {
    // Kaputter Eintrag oder gesperrter Speicher - dann eben manuell starten.
    return null;
  }
}

export function einstellungenSpeichern(e: SenderEinstellungen): void {
  try {
    localStorage.setItem(SCHLUESSEL, JSON.stringify(e));
  } catch {
    // Speicher gesperrt (privates Fenster). Senden geht trotzdem.
  }
}

// --- Autostart der Session -------------------------------------------------
//
// Ist ein PC einmal eingerichtet, legt die Startseite beim Oeffnen die Session
// selbst an und springt in die Sendeseite. Das Passwort liegt dafuer im
// Klartext im Browser - vertretbar nur auf dem Sende-PC, deshalb Opt-in.

const SCHLUESSEL_AUTOSTART = "cgh_autostart";

export interface AutostartEinrichtung {
  passwort: string;
  eventId: string;
  /** Freigegebene Sprachen, null = keine Einschraenkung. */
  sprachen: string[] | null;
  systemInstruction: string;
  /** Vom Server vergebene ID, um eine laufende Session wiederzufinden. */
  sessionId: string;
}

export function autostartLaden(): AutostartEinrichtung | null {
  try {
    const roh = localStorage.getItem(SCHLUESSEL_AUTOSTART);
    if (!roh) return null;
    const e = JSON.parse(roh) as Partial<AutostartEinrichtung>;
    return {
      passwort: typeof e.passwort === "string" ? e.passwort : "",
      eventId: typeof e.eventId === "string" ? e.eventId : "",
      sprachen: Array.isArray(e.sprachen) ? e.sprachen.filter((s) => typeof s === "string") : null,
      systemInstruction: typeof e.systemInstruction === "string" ? e.systemInstruction : "",
      sessionId: typeof e.sessionId === "string" ? e.sessionId : "",
    };
  } catch {
    return null;
  }
}

export function autostartSpeichern(e: AutostartEinrichtung): void {
  try {
    localStorage.setItem(SCHLUESSEL_AUTOSTART, JSON.stringify(e));
  } catch {
    // Speicher gesperrt - dann eben kein Autostart.
  }
}

export function autostartLoeschen(): void {
  try {
    localStorage.removeItem(SCHLUESSEL_AUTOSTART);
  } catch {
    // nichts zu tun
  }
}

/**
 * Findet das gespeicherte Geraet in der aktuellen Liste wieder: zuerst ueber
 * die deviceId, dann ueber den Namen. Liefert null, wenn es nicht
 * angeschlossen ist.
 */
export function geraetFinden(
  geraete: MediaDeviceInfo[],
  e: SenderEinstellungen
): MediaDeviceInfo | null {
  return (
    geraete.find((g) => e.deviceId && g.deviceId === e.deviceId) ??
    geraete.find((g) => e.label && g.label === e.label) ??
    null
  );
}
