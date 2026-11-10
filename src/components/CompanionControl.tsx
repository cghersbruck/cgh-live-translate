"use client";

/**
 * Nimmt Befehle von Bitfocus Companion entgegen und meldet den Zustand zurueck.
 *
 * Bewusst eine eigene Datei: Die Broadcast-Seite stammt aus dem Upstream und
 * soll so wenig wie moeglich abweichen, damit ein spaeteres `git pull` nicht
 * in Konflikte laeuft. Dort kommen nur die Einbindung und ein Pause-Zustand
 * dazu, die gesamte Logik steht hier.
 *
 * Die Komponente rendert nichts Sichtbares ausser einer kleinen Statuszeile.
 */

import { useEffect, useRef } from "react";

export interface CompanionControlProps {
  sessionId: string;
  /** Tatsaechlicher Zustand, wird im Sekundentakt gemeldet. */
  sending: boolean;
  paused: boolean;
  /** Senden mit Standardeinstellungen beginnen. */
  onStart: () => void;
  /** Ton anhalten, Session laeuft weiter. */
  onPause: () => void;
  /** Ton wieder freigeben. */
  onResume: () => void;
  /** Uebertragung beenden. */
  onStop: () => void;
}

export default function CompanionControl({
  sessionId,
  sending,
  paused,
  onStart,
  onPause,
  onResume,
  onStop,
}: CompanionControlProps) {
  // Die Callbacks kommen bei jedem Rendern neu herein. Sie in einem Ref zu
  // halten verhindert, dass das Abfrageintervall staendig neu aufgesetzt wird.
  //
  // Die Zuweisung gehoert in einen Effekt, nicht in den Renderdurchlauf: Refs
  // waehrend des Renderns zu beschreiben ist in React nicht zulaessig.
  const cb = useRef({ onStart, onPause, onResume, onStop });
  useEffect(() => {
    cb.current = { onStart, onPause, onResume, onStop };
  }, [onStart, onPause, onResume, onStop]);

  const zustand = useRef({ sending, paused });
  useEffect(() => {
    zustand.current = { sending, paused };
  }, [sending, paused]);

  /** Zuletzt ausgefuehrter Befehl. Verhindert doppelte Ausfuehrung. */
  const letzteSeq = useRef<number | null>(null);

  useEffect(() => {
    let aktiv = true;

    async function runde() {
      try {
        const res = await fetch("/api/control", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            sending: zustand.current.sending,
            paused: zustand.current.paused,
          }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { seq: number; action: string | null };

        // Beim ersten Durchlauf nur den Stand merken. Sonst wuerde ein Befehl
        // ausgefuehrt, der vor dem Oeffnen der Seite abgesetzt wurde - etwa ein
        // "stop" vom Vorsonntag.
        if (letzteSeq.current === null) {
          letzteSeq.current = data.seq;
          return;
        }

        if (data.seq > letzteSeq.current && data.action) {
          letzteSeq.current = data.seq;
          console.log(`[Companion] Befehl empfangen: ${data.action}`);
          switch (data.action) {
            case "start":
              cb.current.onStart();
              break;
            case "pause":
              cb.current.onPause();
              break;
            case "resume":
              cb.current.onResume();
              break;
            case "stop":
              cb.current.onStop();
              break;
          }
        }
      } catch {
        // Netzwerkaussetzer sind hier belanglos - die naechste Runde kommt in
        // einer Sekunde. Bewusst kein Logging, sonst laeuft die Konsole voll.
      }
    }

    runde();
    const timer = setInterval(() => {
      if (aktiv) runde();
    }, 1000);

    return () => {
      aktiv = false;
      clearInterval(timer);
    };
  }, [sessionId]);

  return (
    <p className="mono" style={{ fontSize: 12, opacity: 0.6, marginTop: 8 }}>
      Companion-Steuerung aktiv · Session {sessionId}
    </p>
  );
}
