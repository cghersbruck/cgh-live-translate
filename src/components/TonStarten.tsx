"use client";

/**
 * Grosser Knopf "Ton starten" fuer blockierte Tonwiedergabe.
 *
 * Safari auf iOS und Chrome geben Ton erst nach einer Nutzerinteraktion frei.
 * Ohne Gegenmassnahme sieht der Besucher eine verbundene Seite und hoert
 * nichts - im Gottesdienst der haeufigste Supportfall.
 *
 * Warum nicht die mitgelieferte `StartAudio`-Komponente: Die steuert ihr
 * `style.display` selbst und laesst sich damit nicht in ein eigenes,
 * bildschirmfuellendes Layout einbetten. Hier wird stattdessen direkt auf den
 * stabilen Room-APIs aufgesetzt (`canPlaybackAudio`, `startAudio()` und
 * `RoomEvent.AudioPlaybackStatusChanged`).
 */

import { useEffect, useState } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent } from "livekit-client";
import { UiLanguageSelector, useUiLanguage } from "@/components/UiLanguage";

export default function TonStarten() {
  const room = useRoomContext();
  const text = useUiLanguage();
  const [kannAbspielen, setKannAbspielen] = useState(true);
  const [laeuft, setLaeuft] = useState(false);

  useEffect(() => {
    if (!room) return;

    const aktualisieren = () => setKannAbspielen(room.canPlaybackAudio);
    aktualisieren();

    room.on(RoomEvent.AudioPlaybackStatusChanged, aktualisieren);
    return () => {
      room.off(RoomEvent.AudioPlaybackStatusChanged, aktualisieren);
    };
  }, [room]);

  if (kannAbspielen) return null;

  async function starten() {
    setLaeuft(true);
    try {
      await room.startAudio();
    } catch (err) {
      console.error("[TonStarten] Tonwiedergabe konnte nicht gestartet werden:", err);
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-live="assertive"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        padding: 24,
        background: "rgba(0, 0, 0, 0.88)",
        textAlign: "center",
      }}
    >
      <div style={{ color: "#fff" }}><UiLanguageSelector /></div>
      <p style={{ fontSize: 20, lineHeight: 1.4, color: "#fff", margin: 0, maxWidth: 420 }}>
        {text.audioPrompt}
      </p>

      <button
        onClick={starten}
        disabled={laeuft}
        style={{
          // Bewusst gross: Der Knopf muss auch fuer jemanden erreichbar sein,
          // der das Telefon nur halb hinsieht.
          minWidth: 260,
          minHeight: 88,
          padding: "24px 40px",
          fontSize: 26,
          fontWeight: 600,
          color: "#000",
          background: "#fff",
          border: "none",
          borderRadius: 12,
          cursor: "pointer",
        }}
      >
        {laeuft ? text.wait : text.startAudio}
      </button>

      <p style={{ fontSize: 15, color: "rgba(255,255,255,0.7)", margin: 0, maxWidth: 420 }}>
        {text.audioContinues}
      </p>
    </div>
  );
}
