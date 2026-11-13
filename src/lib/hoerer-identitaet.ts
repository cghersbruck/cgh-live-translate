/**
 * Hörer-Tokens tragen eine Identität, die der Aufrufer wählt. Nur dieses Muster
 * ist für Hörer erlaubt. Sonst könnte ein Besucher mit `organizer-…` oder
 * `translator-…` den Sender oder eine Übersetzung aus dem Raum werfen, weil
 * LiveKit bei doppelter Identität die ältere Verbindung trennt.
 * Die Hörerseite erzeugt `attendee-` plus 6 Zeichen aus [a-z0-9]; erlaubt sind 1 bis 16.
 */
const HOERER_IDENTITAET = /^attendee-[a-z0-9]{1,16}$/;

export function istHoererIdentitaet(identity: string): boolean {
  return HOERER_IDENTITAET.test(identity);
}
