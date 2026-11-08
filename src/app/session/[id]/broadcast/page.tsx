/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

"use client";

import { useEffect, useState, useCallback, use, useRef, FormEvent } from "react";
import {
  LiveKitRoom,
  useRoomContext,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { Track, RoomEvent, type LocalTrackPublication } from "livekit-client";
import SessionQRCode from "@/components/SessionQRCode";
import CompanionControl from "@/components/CompanionControl";
import { useUiLocale } from "@/components/UiLanguage";
import { broadcastExtra, broadcastMessages } from "@/lib/broadcast-messages";
import { getLanguageByCode } from "@/lib/languages";
import { languageLabel } from "@/lib/language-search";
import type { UiLocale } from "@/lib/ui-locale";
import { reviewMessages, listenerLabel } from "@/lib/review-messages";
import {
  einstellungenLaden,
  einstellungenSpeichern,
  geraetFinden,
} from "@/lib/sender-einstellungen";

interface TranslationInfo {
  language: string;
  translatorIdentity: string;
  status: string;
  subscriberCount: number;
  // Ergaenzt fuer die Ausfallerkennung (siehe ANPASSUNGEN.md)
  gesundheit?: string;
  hoerer?: number;
  stoerung?: { text: string; seit: number; versuche: number } | null;
}

/**
 * Anzeige je Zustand. Bewusst aus dem Audiofluss abgeleitet statt aus dem
 * Statusfeld: "active" blieb am 2026-10-04 gruen, waehrend die Uebersetzung
 * wegen erschoepften Guthabens laengst ausgefallen war.
 */
interface SessionKosten {
  sprachen: { sprache: string; eingabeSek: number; ausgabeSek: number; usd: number; laeuft: boolean }[];
  gesamtUsd: number;
  eurKurs: number | null;
}

function betrag(usd: number, eurKurs: number | null, locale: UiLocale): string {
  const dollar = usd.toLocaleString(locale, { style: "currency", currency: "USD" });
  if (!eurKurs) return dollar;
  const euro = (usd * eurKurs).toLocaleString(locale, { style: "currency", currency: "EUR" });
  return `${euro} (${dollar})`;
}

const GESUNDHEIT_ANZEIGE: Record<string, { text: string; klasse: string }> = {
  gesund: { text: "Übersetzt", klasse: "active" },
  pausiert: { text: "Wartet auf Sprache", klasse: "waiting" },
  verbindet: { text: "Verbindet …", klasse: "waiting" },
  startet: { text: "Startet …", klasse: "waiting" },
  stockend: { text: "Keine Übersetzung seit 20 s", klasse: "error" },
  gestoert: { text: "Gestört", klasse: "error" },
  beendet: { text: "Beendet", klasse: "waiting" },
};

function BroadcastControls({
  sessionId,
  onEndBroadcast,
}: {
  sessionId: string;
  onEndBroadcast: () => void;
}) {
  const room = useRoomContext();
  const locale = useUiLocale();
  const text = broadcastMessages[locale];
  const extra = broadcastExtra[locale];
  const [translations, setTranslations] = useState<TranslationInfo[]>([]);
  const [kosten, setKosten] = useState<SessionKosten | null>(null);
  const [listenerCount, setListenerCount] = useState(0);

  // Track active attendees count without useRemoteParticipants hook overhead
  useEffect(() => {
    if (!room) return;

    const updateCount = () => {
      const count = Array.from(room.remoteParticipants.values()).filter(
        (p) => !p.identity.startsWith("translator-")
      ).length;
      setListenerCount(count);
    };

    updateCount();

    room.on(RoomEvent.ParticipantConnected, updateCount);
    room.on(RoomEvent.ParticipantDisconnected, updateCount);
    return () => {
      room.off(RoomEvent.ParticipantConnected, updateCount);
      room.off(RoomEvent.ParticipantDisconnected, updateCount);
    };
  }, [room]);

  // Custom audio mixer states
  const [isMicEnabled, setIsMicEnabled] = useState(false);
  const [isTabAudioEnabled, setIsTabAudioEnabled] = useState(false);
  const [micVolume, setMicVolume] = useState(100);
  const [tabVolume, setTabVolume] = useState(100);
  const [isWakeLockActive, setIsWakeLockActive] = useState(false);
  // Ton angehalten per Companion. Die Session bleibt dabei bestehen, es wird
  // nur kein Audio mehr uebertragen - gedacht fuer Lobpreis und Moderation.
  const [isPaused, setIsPaused] = useState(false);

  // Mikrofonauswahl und Autostart (siehe ANPASSUNGEN.md). Gespeichert wird je
  // Sende-PC in localStorage, nicht je Session.
  const [mikrofone, setMikrofone] = useState<MediaDeviceInfo[]>([]);
  const [gewaehltesMikrofon, setGewaehltesMikrofon] = useState("");
  const [mixerBereit, setMixerBereit] = useState(false);
  // Chrome laesst einen AudioContext ohne Benutzeraktion nicht anlaufen. Beim
  // Autostart nach einem Neuladen kann das passieren - dann fliesst nur Stille.
  const [audioGesperrt, setAudioGesperrt] = useState(false);
  const [autostartHinweis, setAutostartHinweis] = useState<string | null>(null);
  const autostartErledigt = useRef(false);

  // Manage Screen Wake Lock to prevent the phone/device from sleeping during broadcast
  useEffect(() => {
    if (typeof window === "undefined" || !("wakeLock" in navigator)) {
      return;
    }

    let wakeLock: WakeLockSentinel | null = null;

    async function requestWakeLock() {
      try {
        wakeLock = await navigator.wakeLock.request("screen");
        setIsWakeLockActive(true);
        
        wakeLock.addEventListener("release", () => {
          setIsWakeLockActive(false);
        });
      } catch (err) {
        console.error("Failed to acquire Screen Wake Lock:", err);
      }
    }

    requestWakeLock();

    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible" && !wakeLock) {
        await requestWakeLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (wakeLock) {
        wakeLock.release().catch((err: unknown) => {
          console.error("Failed to release Screen Wake Lock:", err);
        });
      }
    };
  }, []);

  // References to keep Web Audio API elements alive
  const audioContextRef = useRef<AudioContext | null>(null);
  const destinationNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micGainNodeRef = useRef<GainNode | null>(null);
  const tabStreamRef = useRef<MediaStream | null>(null);
  const tabSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const tabGainNodeRef = useRef<GainNode | null>(null);
  const publishedTrackPubRef = useRef<LocalTrackPublication | null>(null);



  const joinUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/session/${sessionId}/watch`
      : "";

  const [systemInstruction, setSystemInstruction] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSession() {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.systemInstruction) {
            setSystemInstruction(data.systemInstruction);
          }
        }
      } catch (err) {
        console.error("Failed to fetch session details:", err);
      }
    }
    fetchSession();
  }, [sessionId]);

  useEffect(() => {
    async function fetchTranslations() {
      try {
        const res = await fetch(`/api/translate/status?sessionId=${sessionId}`);
        const data = await res.json();
        setTranslations(data.translations || []);
        setKosten(data.kosten ?? null);
      } catch (err) {
        console.error("Failed to fetch translations:", err);
      }
    }
    fetchTranslations();
    const interval = setInterval(fetchTranslations, 3000);
    return () => clearInterval(interval);
  }, [sessionId]);

  // Main AudioContext and track publishing lifecycle
  useEffect(() => {
    if (!room || !room.localParticipant) return;

    let active = true;
    let localPub: LocalTrackPublication | null = null;

    async function initAudio() {
      try {
        const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioContextClass();
        audioContextRef.current = ctx;
        setAudioGesperrt(ctx.state === "suspended");
        ctx.onstatechange = () => setAudioGesperrt(ctx.state === "suspended");

        const dest = ctx.createMediaStreamDestination();
        destinationNodeRef.current = dest;

        const mixedTrack = dest.stream.getAudioTracks()[0];

        if (active && room.localParticipant) {
          const pub = await room.localParticipant.publishTrack(mixedTrack, {
            name: "broadcast-audio",
            source: Track.Source.Microphone,
          });
          publishedTrackPubRef.current = pub;
          localPub = pub;
          await pub.mute();
          console.log("Published and initially muted mixed audio track:", pub.trackSid);
          setMixerBereit(true);
        }
      } catch (err) {
        console.error("Failed to initialize client audio mixer:", err);
      }
    }

    initAudio();

    return () => {
      active = false;
      if (localPub?.track && room.localParticipant) {
        room.localParticipant.unpublishTrack(localPub.track).catch((err) => {
          console.error("Failed to unpublish mixed track:", err);
        });
      }
      
      // Stop all streams and close AudioContext
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((track) => track.stop());
        micStreamRef.current = null;
      }
      if (micSourceNodeRef.current) {
        micSourceNodeRef.current.disconnect();
        micSourceNodeRef.current = null;
      }
      if (micGainNodeRef.current) {
        micGainNodeRef.current.disconnect();
        micGainNodeRef.current = null;
      }
      if (tabStreamRef.current) {
        tabStreamRef.current.getTracks().forEach((track) => track.stop());
        tabStreamRef.current = null;
      }
      if (tabSourceNodeRef.current) {
        tabSourceNodeRef.current.disconnect();
        tabSourceNodeRef.current = null;
      }
      if (tabGainNodeRef.current) {
        tabGainNodeRef.current.disconnect();
        tabGainNodeRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      destinationNodeRef.current = null;
      publishedTrackPubRef.current = null;
      setMixerBereit(false);
    };
  }, [room, room?.localParticipant]);

  // Synchronize muted status of the published track with active inputs
  useEffect(() => {
    const pub = publishedTrackPubRef.current;
    if (!pub) return;

    // isPaused kommt aus der Companion-Fernsteuerung. Es muss hier einfliessen
    // und nicht separat stummschalten: Dieser Effekt laeuft bei jeder
    // Eingangsaenderung erneut und wuerde eine von aussen gesetzte Stummschaltung
    // sonst wieder aufheben.
    const hasActiveInput = (isMicEnabled || isTabAudioEnabled) && !isPaused;
    if (hasActiveInput) {
      pub.unmute()
        .then(() => console.log("[BroadcastControls] Unmuted broadcast-audio track"))
        .catch((err: unknown) => console.error("Failed to unmute track:", err));
    } else {
      pub.mute()
        .then(() => console.log("[BroadcastControls] Muted broadcast-audio track"))
        .catch((err: unknown) => console.error("Failed to mute track:", err));
    }
  }, [isMicEnabled, isTabAudioEnabled, isPaused]);

  /** Liest die angeschlossenen Mikrofone. Namen liefert Chrome erst nach erteilter Freigabe. */
  const mikrofoneAuflisten = useCallback(async () => {
    try {
      const alle = await navigator.mediaDevices.enumerateDevices();
      const liste = alle.filter((g) => g.kind === "audioinput" && g.deviceId);
      setMikrofone(liste);
      return liste;
    } catch {
      return [];
    }
  }, []);

  // Ein- und Ausstecken waehrend der Sendung. Die erste Liste holt der
  // Autostart-Effekt weiter unten.
  useEffect(() => {
    navigator.mediaDevices?.addEventListener("devicechange", mikrofoneAuflisten);
    return () => {
      navigator.mediaDevices?.removeEventListener("devicechange", mikrofoneAuflisten);
    };
  }, [mikrofoneAuflisten]);

  /** Trennt den Mikrofoneingang vom Mixer, ohne den Zustand anzufassen. */
  const mikrofonTrennen = () => {
    if (micSourceNodeRef.current) {
      micSourceNodeRef.current.disconnect();
      micSourceNodeRef.current = null;
    }
    if (micGainNodeRef.current) {
      micGainNodeRef.current.disconnect();
      micGainNodeRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
  };

  /**
   * Schaltet das Mikrofon ein bzw. auf ein anderes Geraet um. Liefert bei
   * Erfolg null, sonst die Fehlermeldung - der Aufrufer entscheidet, ob sie
   * als alert() oder still als Hinweis erscheint.
   */
  const startMicrophone = async (
    deviceId: string,
    lautstaerke: number = micVolume
  ): Promise<string | null> => {
    const ctx = audioContextRef.current;
    const dest = destinationNodeRef.current;
    if (!ctx || !dest) return text.mixer;

    // Bewusst ohne await: Ohne Benutzeraktion (Autostart nach Neuladen) bleibt
    // das Promise in Chrome haengen, bis jemand klickt. Der Graph wird trotzdem
    // aufgebaut; der Hinweis "Ton freigeben" erscheint ueber onstatechange.
    ctx.resume().catch(() => {});

    try {
      // Browser-Signalverarbeitung abschalten.
      //
      // Bei `audio: true` aktiviert Chrome automatisch Echo-Unterdrueckung,
      // Rauschfilter und automatische Aussteuerung. Die sind fuer
      // Videotelefonie gedacht und arbeiten gegen ein fertig gemischtes
      // Pultsignal: Die Automatik regelt in Sprechpausen hoch und beim
      // Einsetzen der Stimme wieder herunter, der Rauschfilter schneidet
      // leise Passagen weg. Abschalten geht nur hier - in den
      // Chrome-Einstellungen gibt es dafuer keine Option.
      //
      // Das Geraet kommt aus der Auswahl auf der Seite. "exact", damit
      // Chrome bei fehlendem Geraet nicht stillschweigend ein anderes nimmt
      // - etwa das eingebaute Laptop-Mikrofon.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });

      // Chrome uebernimmt diese Vorgaben bei manchen Treibern stillschweigend
      // nicht. Deshalb gegenpruefen statt annehmen - im Zweifel steht es im
      // Log und laesst sich nachvollziehen.
      const einstellungen = stream.getAudioTracks()[0]?.getSettings();
      console.log("[BroadcastControls] Aufnahme-Einstellungen:", {
        geraet: stream.getAudioTracks()[0]?.label,
        echoCancellation: einstellungen?.echoCancellation,
        noiseSuppression: einstellungen?.noiseSuppression,
        autoGainControl: einstellungen?.autoGainControl,
        channelCount: einstellungen?.channelCount,
        sampleRate: einstellungen?.sampleRate,
      });

      // Erst jetzt den alten Eingang abloesen: Beim Geraetewechsel bleibt
      // so das bisherige Mikrofon aktiv, falls das neue nicht startet.
      mikrofonTrennen();
      micStreamRef.current = stream;

      const source = ctx.createMediaStreamSource(stream);
      micSourceNodeRef.current = source;

      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(lautstaerke / 100, ctx.currentTime);
      micGainNodeRef.current = gainNode;

      source.connect(gainNode);
      gainNode.connect(dest);

      setIsMicEnabled(true);

      const track = stream.getAudioTracks()[0];
      const tatsaechlich = einstellungen?.deviceId || deviceId;
      setGewaehltesMikrofon(tatsaechlich);
      einstellungenSpeichern({ deviceId: tatsaechlich, label: track?.label ?? "", lautstaerke });
      setAutostartHinweis(null);
      // Nach der ersten Freigabe liefert Chrome die Geraetenamen.
      mikrofoneAuflisten();
      return null;
    } catch (err) {
      console.error("Failed to access microphone:", err);
      const e = err as Error;
      return e.name === "OverconstrainedError" || e.name === "NotFoundError"
        ? text.micMissing
        : e.message;
    }
  };

  const stopMicrophone = () => {
    mikrofonTrennen();
    setIsMicEnabled(false);
  };

  const toggleMicrophone = async () => {
    if (isMicEnabled) {
      stopMicrophone();
      return;
    }
    const fehler = await startMicrophone(gewaehltesMikrofon);
    if (fehler) alert(text.micAccess + fehler);
  };

  const mikrofonWechseln = async (deviceId: string) => {
    const vorher = gewaehltesMikrofon;
    setGewaehltesMikrofon(deviceId);
    if (!isMicEnabled) return;
    const fehler = await startMicrophone(deviceId);
    if (fehler) {
      setGewaehltesMikrofon(vorher);
      alert(text.micSwitch + fehler);
    }
  };

  // Autostart: Beim Oeffnen der Sendeseite mit dem zuletzt verwendeten
  // Mikrofon und derselben Lautstaerke senden. Gilt auch nach einem Neuladen
  // oder Browser-Neustart. Ohne gespeicherte Einstellung (erster Start an
  // diesem PC) bleibt es beim manuellen Einschalten.
  useEffect(() => {
    if (!mixerBereit || autostartErledigt.current) return;
    autostartErledigt.current = true;
    const gespeichert = einstellungenLaden();

    (async () => {
      const liste = await mikrofoneAuflisten();
      if (!gespeichert) return;
      setMicVolume(gespeichert.lautstaerke);
      // Ohne erteilte Freigabe liefert Chrome keine Namen. Dann direkt
      // versuchen - getUserMedia fragt nach, "exact" verhindert ein falsches Geraet.
      const namenBekannt = liste.some((g) => g.label);
      const geraet = geraetFinden(liste, gespeichert);
      if (namenBekannt && !geraet && (gespeichert.deviceId || gespeichert.label)) {
        setAutostartHinweis(
          `Zuletzt verwendetes Mikrofon „${gespeichert.label || gespeichert.deviceId}" ist nicht angeschlossen. Bitte Gerät wählen und einschalten.`
        );
        return;
      }
      const id = geraet?.deviceId ?? gespeichert.deviceId;
      setGewaehltesMikrofon(id);
      console.log("[Autostart] Starte mit gespeichertem Mikrofon:", geraet?.label || id || "Standard");
      const fehler = await startMicrophone(id, gespeichert.lautstaerke);
      if (fehler) setAutostartHinweis(`Automatischer Start fehlgeschlagen: ${fehler}`);
    })();
    // Laeuft genau einmal, sobald der Mixer steht. startMicrophone ist bewusst
    // keine Abhaengigkeit - es aendert sich bei jedem Rendern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mixerBereit, mikrofoneAuflisten]);

  // Gesperrten AudioContext mit der ersten Beruehrung der Seite freigeben.
  useEffect(() => {
    if (!audioGesperrt) return;
    const freigeben = () => {
      audioContextRef.current?.resume().catch(() => {});
    };
    document.addEventListener("pointerdown", freigeben);
    document.addEventListener("keydown", freigeben);
    return () => {
      document.removeEventListener("pointerdown", freigeben);
      document.removeEventListener("keydown", freigeben);
    };
  }, [audioGesperrt]);

  const toggleTabAudio = async () => {
    const ctx = audioContextRef.current;
    const dest = destinationNodeRef.current;
    if (!ctx || !dest) return;

    if (isTabAudioEnabled) {
      if (tabSourceNodeRef.current) {
        tabSourceNodeRef.current.disconnect();
        tabSourceNodeRef.current = null;
      }
      if (tabGainNodeRef.current) {
        tabGainNodeRef.current.disconnect();
        tabGainNodeRef.current = null;
      }
      if (tabStreamRef.current) {
        tabStreamRef.current.getTracks().forEach((track) => track.stop());
        tabStreamRef.current = null;
      }
      setIsTabAudioEnabled(false);
    } else {
      try {
        await ctx.resume();
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface: "browser" },
          audio: true,
        });

        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length === 0) {
          stream.getTracks().forEach((track) => track.stop());
          alert(text.tabMissing);
          return;
        }

        tabStreamRef.current = stream;

        const source = ctx.createMediaStreamSource(stream);
        tabSourceNodeRef.current = source;

        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(tabVolume / 100, ctx.currentTime);
        tabGainNodeRef.current = gainNode;

        source.connect(gainNode);
        gainNode.connect(dest);

        setIsTabAudioEnabled(true);

        const handleTrackEnded = () => {
          if (tabSourceNodeRef.current) {
            tabSourceNodeRef.current.disconnect();
            tabSourceNodeRef.current = null;
          }
          if (tabGainNodeRef.current) {
            tabGainNodeRef.current.disconnect();
            tabGainNodeRef.current = null;
          }
          stream.getTracks().forEach((track) => track.stop());
          tabStreamRef.current = null;
          setIsTabAudioEnabled(false);
        };

        audioTracks[0].onended = handleTrackEnded;
        const videoTracks = stream.getVideoTracks();
        if (videoTracks.length > 0) {
          videoTracks[0].onended = handleTrackEnded;
        }
      } catch (err) {
        console.error("Failed to capture tab audio:", err);
        if ((err as Error).name !== "NotAllowedError") {
          alert(reviewMessages[locale].tabError + ": " + (err as Error).message);
        }
      }
    }
  };

  const handleMicVolumeChange = (vol: number) => {
    setMicVolume(vol);
    if (micGainNodeRef.current && audioContextRef.current) {
      micGainNodeRef.current.gain.setValueAtTime(vol / 100, audioContextRef.current.currentTime);
    }
    const gespeichert = einstellungenLaden();
    if (gespeichert) einstellungenSpeichern({ ...gespeichert, lautstaerke: vol });
  };

  const handleTabVolumeChange = (vol: number) => {
    setTabVolume(vol);
    if (tabGainNodeRef.current && audioContextRef.current) {
      tabGainNodeRef.current.gain.setValueAtTime(vol / 100, audioContextRef.current.currentTime);
    }
  };

  const isAudioActive = isMicEnabled || isTabAudioEnabled;
  let statusText = text.muted;
  // Pause zuerst pruefen: Sie ueberlagert die Eingangsanzeige, sonst stuende
  // dort "Live", obwohl gerade nichts uebertragen wird.
  if (isPaused && isAudioActive) {
    statusText = text.paused;
  } else
  if (isMicEnabled && isTabAudioEnabled) {
    statusText = text.liveBoth;
  } else if (isMicEnabled) {
    statusText = text.liveMic;
  } else if (isTabAudioEnabled) {
    statusText = text.liveBrowser;
  }

  return (
    <div className="container container-wide enter">
      {/* Header */}
      <div style={{ marginBottom: 40 }}>
        <h1 className="display display-lg" style={{ marginBottom: 8 }}>
          {text.broadcast}
        </h1>
        <p className="meta">{sessionId}</p>
      </div>

      {/* Stoerungsbanner. Nicht zu uebersehen, mit Grund in Klartext. */}
      {translations.some((t) => t.gesundheit === "gestoert") && (
        <div
          role="alert"
          className="notice notice--error"
          style={{ margin: "0 0 24px" }}
        >
          <strong style={{ display: "block", marginBottom: 6 }}>
            {text.failed}
          </strong>
          {translations
            .filter((t) => t.gesundheit === "gestoert")
            .map((t) => (
              <p key={t.language} className="body-sm" style={{ margin: "4px 0" }}>
                <strong>{getLanguageByCode(t.language) ? languageLabel(getLanguageByCode(t.language)!, locale) : t.language}:</strong>{" "}
                {t.stoerung?.text ?? text.unknown}
                {t.stoerung?.seit
                  ? (() => {
                      const time = new Date(t.stoerung.seit).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
                      return ` · ${locale === "hu" ? `${time} ${text.since}` : `${text.since} ${time}${locale === "zh-Hans" ? " 起" : ""}`}`;
                    })()
                  : ""}
              </p>
            ))}
          <p className="body-sm" style={{ margin: "8px 0 0", opacity: 0.75 }}>
            {text.retry}
          </p>
        </div>
      )}

      {/* Fernsteuerung durch Bitfocus Companion. Die gesamte Logik liegt in
          der Komponente, damit diese Upstream-Datei moeglichst wenig abweicht. */}
      <CompanionControl
        sessionId={sessionId}
        sending={isAudioActive}
        paused={isPaused}
        onStart={() => {
          setIsPaused(false);
          // Mit Standardeinstellungen senden: Mikrofoneingang an. Laeuft er
          // schon, hebt "start" nur eine bestehende Pause auf.
          if (!isMicEnabled) toggleMicrophone();
        }}
        onPause={() => setIsPaused(true)}
        onResume={() => setIsPaused(false)}
        onStop={() => {
          setIsPaused(false);
          onEndBroadcast();
        }}
      />

      {/* Audio Inputs */}
      <div style={{ marginBottom: 40 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 20,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className={`waveform ${isAudioActive ? "active" : "idle"}`}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="waveform-bar" />
              ))}
            </div>
            <span
              className={`status ${isAudioActive ? "status--active" : ""}`}
              style={{ color: isAudioActive ? undefined : "var(--fg-tertiary)" }}
            >
              <span className={`status-dot ${isAudioActive ? "pulse" : ""}`} />
              {statusText}
            </span>

            {/* Pause schaltet den Ton stumm. Nach 5 s trennt die Bridge die
                Gemini-Verbindung, weil Gemini sonst weiter (Stille) liefert
                und abrechnet. "Weiter" baut sie mit Resumption-Handle neu
                auf, das dauert 1-2 s. Gedacht fuer Lobpreis und Moderation. */}
            {isAudioActive && (
              <button
                onClick={() => setIsPaused((p) => !p)}
                className="btn"
                style={{
                  marginLeft: 12,
                  padding: "7px 14px",
                  fontSize: "13px",
                  border: isPaused ? "none" : "1px solid var(--warning)",
                  background: isPaused ? "var(--warning-soft)" : "transparent",
                  color: "var(--warning-ink)",
                  fontWeight: 600,
                }}
              >
                {isPaused ? text.resume : text.pause}
              </button>
            )}

            {isWakeLockActive && (
              <span
                className="status status--active"
                style={{
                  marginLeft: 12,
                  padding: "4px 8px",
                  background: "var(--success-soft)",
                  color: "var(--success-ink)",
                  borderRadius: "6px",
                  fontSize: "12px",
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ marginRight: 4, verticalAlign: "middle" }}
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                {text.screenOn}
              </span>
            )}
          </div>

          <span className="meta">
            {listenerLabel(listenerCount, locale)}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Microphone Box */}
          <div
            className="panel"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 600, fontSize: "14.5px" }}>{text.microphone}</span>
              <button
                onClick={toggleMicrophone}
                className={isMicEnabled ? "btn btn-outline" : "btn btn-dark"}
                style={{
                  padding: "7px 14px",
                  fontSize: "13px",
                }}
              >
                {isMicEnabled ? text.off : text.on}
              </button>
            </div>
            {/* Geraeteauswahl. Die Wahl wird beim Einschalten gespeichert und
                beim naechsten Oeffnen der Seite automatisch gestartet. */}
            <select
              aria-label={text.microphone}
              className="input-field"
              value={gewaehltesMikrofon}
              onChange={(e) => mikrofonWechseln(e.target.value)}
              style={{ fontSize: "13px", padding: "8px 10px" }}
            >
              {!mikrofone.some((g) => g.deviceId === gewaehltesMikrofon) && (
                <option value={gewaehltesMikrofon}>
                  {gewaehltesMikrofon ? text.savedMic : text.defaultDevice}
                </option>
              )}
              {mikrofone.map((g, i) => (
                <option key={g.deviceId} value={g.deviceId}>
                  {g.label || `${text.micName} ${i + 1}`}
                </option>
              ))}
            </select>
            {autostartHinweis && (
              <p className="body-sm" role="alert" style={{ color: "var(--warning)", margin: 0 }}>
                {(() => {
                  const missing = autostartHinweis.match(/^Zuletzt verwendetes Mikrofon „(.*)" ist nicht angeschlossen\. Bitte Gerät wählen und einschalten\.$/);
                  if (missing) return extra.missingDevice(missing[1]);
                  const prefix = "Automatischer Start fehlgeschlagen: ";
                  if (autostartHinweis.startsWith(prefix)) {
                    const detail = autostartHinweis.slice(prefix.length);
                    const known = (["mixer", "micMissing"] as const).find((key) => Object.values(broadcastMessages).some((message) => message[key] === detail));
                    return `${extra.autoFailed}: ${known ? text[known] : detail}`;
                  }
                  return `${extra.detail}: ${autostartHinweis}`;
                })()}
              </p>
            )}
            {isMicEnabled && audioGesperrt && (
              <button
                className="btn"
                onClick={() => audioContextRef.current?.resume().catch(() => {})}
                style={{
                  padding: "12px 16px",
                  border: "2px solid var(--error)",
                  background: "var(--error-soft)",
                  color: "var(--error)",
                  fontWeight: 600,
                }}
              >
                {text.audioBlocked}
              </button>
            )}
            {isMicEnabled && (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="meta" style={{ fontSize: "12px" }}>{reviewMessages[locale].volume}</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={micVolume}
                  aria-label={`${text.microphone}: ${reviewMessages[locale].volume}`}
                  onChange={(e) => handleMicVolumeChange(Number(e.target.value))}
                  style={{ flexGrow: 1, accentColor: "var(--accent)", cursor: "pointer" }}
                />
                <span className="meta" style={{ width: "40px", textAlign: "right", fontSize: "12px" }}>
                  {micVolume}%
                </span>
              </div>
            )}
          </div>

          {/* Browser Tab Audio Box */}
          <div
            className="panel"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 600, fontSize: "14.5px" }}>{text.browserAudio}</span>
              <button
                onClick={toggleTabAudio}
                className={isTabAudioEnabled ? "btn btn-outline" : "btn btn-dark"}
                style={{
                  padding: "7px 14px",
                  fontSize: "13px",
                }}
              >
                {isTabAudioEnabled ? text.stopSharing : text.shareTab}
              </button>
            </div>
            {isTabAudioEnabled && (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="meta" style={{ fontSize: "12px" }}>{reviewMessages[locale].volume}</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={tabVolume}
                  aria-label={`${text.browserAudio}: ${reviewMessages[locale].volume}`}
                  onChange={(e) => handleTabVolumeChange(Number(e.target.value))}
                  style={{ flexGrow: 1, accentColor: "var(--accent)", cursor: "pointer" }}
                />
                <span className="meta" style={{ width: "40px", textAlign: "right", fontSize: "12px" }}>
                  {tabVolume}%
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* QR code */}
      <div
        className="panel"
        style={{
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          marginBottom: 8,
        }}
      >
        <span className="label" style={{ fontSize: "15px", color: "var(--fg)", fontWeight: 600 }}>
          {text.community}
        </span>
        <SessionQRCode url={joinUrl} size={140} />
        <p className="meta" style={{ wordBreak: "break-all", textAlign: "center" }}>
          {joinUrl}
        </p>
      </div>

      {/* Active translations */}
      <div style={{ padding: "24px 0" }}>
        <h2 className="label" style={{ fontSize: "16px", color: "var(--fg)", marginBottom: 12, display: "block" }}>
          {text.translations} · {translations.length}
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {translations.length === 0 ? (
          <p className="body-sm italic" style={{ margin: 0 }}>
            {text.noneYet}
          </p>
        ) : (
          translations.map((t) => {
            const lang = getLanguageByCode(t.language);
            return (
              <div key={t.language} className="lang-row">
                <div className="lang-row-left">
                  <span className="lang-flag" aria-hidden="true">{lang?.flag || ""}</span>
                  <span className="lang-name">
                    {lang ? languageLabel(lang, locale) : t.language.toUpperCase()}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span className="lang-meta">
                    {/* hoerer zaehlt die tatsaechlich verbundenen Teilnehmer;
                        subscriberCount bleibt bei hart beendeten Browsern stehen. */}
                    {listenerLabel(t.hoerer ?? t.subscriberCount, locale)}
                  </span>
                  {(() => {
                    const a =
                      GESUNDHEIT_ANZEIGE[t.gesundheit ?? ""] ??
                      { text: t.status === "active" ? text.healthy : text.waiting, klasse: t.status === "active" ? "active" : "waiting" };
                    return (
                      <span
                        className={`status status--${a.klasse}`}
                        title={t.stoerung?.text}
                      >
                        <span className="status-dot pulse" />
                        {({ gesund: text.healthy, pausiert: text.waiting, verbindet: text.connecting, startet: text.starting, stockend: text.stalled, gestoert: text.disturbed, beendet: text.ended } as Record<string, string>)[t.gesundheit ?? ""] ?? a.text}
                      </span>
                    );
                  })()}
                </div>
              </div>
            );
          })
        )}
        </div>

        {/* Kostenschaetzung. Aktualisiert sich mit jeder Statusabfrage
            (alle 3 s). Gemessen am 2026-10-04: Gemini rechnet die Zeit ab,
            in der die Verbindung offen ist, nicht den gesprochenen Text. */}
        {kosten && kosten.sprachen.length > 0 && (
          <div
            className="panel"
            style={{
              marginTop: 24,
              textAlign: "left",
            }}
          >
            <span className="label" style={{ display: "block", marginBottom: 4 }}>
              {text.costs}
            </span>
            <p style={{ fontSize: 26, fontWeight: 600, margin: "0 0 12px", fontVariantNumeric: "tabular-nums" }}>
              {betrag(kosten.gesamtUsd, kosten.eurKurs, locale)}
            </p>
            {kosten.sprachen.map((k) => (
              <div
                key={k.sprache}
                className="body-sm"
                style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}
              >
                <span>
                  {getLanguageByCode(k.sprache) ? languageLabel(getLanguageByCode(k.sprache)!, locale) : k.sprache}
                  {k.laeuft ? ` · ${text.running}` : ""}
                </span>
                <span className="meta">
                  {Math.round(k.eingabeSek / 60)} min · {betrag(k.usd, kosten.eurKurs, locale)}
                </span>
              </div>
            ))}
            <p className="body-sm" style={{ margin: "10px 0 0", opacity: 0.7 }}>
              {text.costInfo}
            </p>
          </div>
        )}

        {systemInstruction && (
          <div
            className="panel"
            style={{
              marginTop: 16,
              textAlign: "left",
            }}
          >
            <span className="label" style={{ display: "block", marginBottom: 6 }}>
              {text.instruction}
            </span>
            <p
              className="body-sm"
              style={{
                color: "var(--fg-secondary)",
                wordBreak: "break-word",
                whiteSpace: "pre-wrap",
                margin: 0,
              }}
            >
              {systemInstruction}
            </p>
          </div>
        )}
      </div>

      {/* End */}
      <div style={{ paddingTop: 8 }}>
        <button
          className="btn-danger"
          onClick={async () => {
            onEndBroadcast();
            try {
              // Explicitly notify server that broadcast is ended to stop all translator bots
              await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
            } catch (err) {
              console.error("Failed to explicitly delete session on broadcast end:", err);
            }
            room.disconnect();
            // ?beendet: sonst startet der Autostart der Startseite sofort neu.
            window.location.href = "/?beendet";
          }}
          style={{ width: "100%" }}
        >
          {text.end}
        </button>
      </div>
    </div>
  );
}

export default function BroadcastPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: sessionId } = use(params);
  const locale = useUiLocale();
  const text = broadcastMessages[locale];
  const [token, setToken] = useState("");
  const [livekitUrl, setLivekitUrl] = useState("");
  const [error, setError] = useState<{ kind: "disconnected" | "tokenFailed" | "detail"; detail?: string } | null>(null);
  const [passwordPromptRequired, setPasswordPromptRequired] = useState(false);
  const [localPassword, setLocalPassword] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const isEndingRef = useRef(false);

  const handleEndBroadcast = useCallback(() => {
    isEndingRef.current = true;
  }, []);

  const fetchToken = useCallback((pass: string) => {
    async function requestToken() {
      const identity = `organizer-host`;
      const url = `/api/token?room=${sessionId}&identity=${identity}&role=organizer${pass ? `&password=${encodeURIComponent(pass)}` : ""}`;
      const res = await fetch(url);
      const data = await res.json();
      
      if (res.status === 401) {
        setPasswordPromptRequired(true);
        return false;
      }
      
      if (!res.ok || data.error) {
        if (data.error) throw new Error(data.error);
        setError({ kind: "tokenFailed" });
        return false;
      }
      
      if (pass) {
        try { sessionStorage.setItem("broadcast_password", pass); } catch { /* continue without cached password */ }
      }
      setToken(data.token);
      setLivekitUrl(data.serverUrl);
      setPasswordPromptRequired(false);
      return true;
    }

    return requestToken().catch((err: unknown) => {
      setError({ kind: "detail", detail: (err as Error).message });
      return false;
    });
  }, [sessionId]);

  useEffect(() => {
    let cachedPass = "";
    try { cachedPass = sessionStorage.getItem("broadcast_password") || ""; } catch { /* ask for password if needed */ }
    fetchToken(cachedPass);
  }, [fetchToken]);

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setVerifying(true);
    setPasswordError(false);
    const success = await fetchToken(localPassword);
    setVerifying(false);
    if (!success && !error) {
      setPasswordError(true);
    }
  };

  if (passwordPromptRequired) {
    return (
      <div className="page enter">
        <div className="container" style={{ textAlign: "center" }}>
          <h1 className="display display-md" style={{ marginBottom: 12 }}>
            {text.passwordRequired}
          </h1>
          <p className="body-sm" style={{ marginBottom: 32 }}>
            {text.protected}
          </p>
          <form onSubmit={handlePasswordSubmit}>
            <div style={{ marginBottom: 20 }}>
              <input
                type="password"
                className="input-field"
                placeholder={text.password}
                value={localPassword}
                onChange={(e) => setLocalPassword(e.target.value)}
                disabled={verifying}
                required
                aria-label={text.password}
              />
            </div>
            {passwordError && (
              <p className="body-sm" style={{ color: "var(--error-ink)", marginBottom: 20 }} role="alert">
                {text.wrongPassword}
              </p>
            )}
            <button
              type="submit"
              className="btn btn-dark"
              style={{ width: "100%" }}
              disabled={verifying}
            >
              {verifying ? text.checking : text.continue}
            </button>
          </form>
          <button
            className="btn btn-ghost"
            onClick={() => (window.location.href = "/?einrichten")}
            style={{ marginTop: 16 }}
          >
            {text.cancel}
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <div className="container" style={{ textAlign: "center" }}>
          <h1 className="display display-md" style={{ marginBottom: 16 }}>
            {text.error}
          </h1>
          <p className="body-sm" style={{ marginBottom: 32 }}>{error.kind === "detail" ? error.detail : error.kind === "tokenFailed" ? broadcastExtra[locale].tokenFailed : text.disconnected}</p>
          <button className="btn btn-outline" onClick={() => (window.location.href = "/?einrichten")}>
            {text.home}
          </button>
        </div>
      </div>
    );
  }

  if (!token || !livekitUrl) {
    return (
      <div className="page">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="page page-top">
      <LiveKitRoom
        video={false}
        audio={false}
        token={token}
        serverUrl={livekitUrl}
        options={{ disconnectOnPageLeave: false }}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "100%",
        }}
        onDisconnected={() => {
          if (!isEndingRef.current) {
            setError({ kind: "disconnected" });
          }
        }}
      >
        <BroadcastControls sessionId={sessionId} onEndBroadcast={handleEndBroadcast} />
      </LiveKitRoom>
    </div>
  );
}
