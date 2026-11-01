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
