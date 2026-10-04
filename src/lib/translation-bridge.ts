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

/**
 * TranslationBridge: Connects a LiveKit room to a Gemini Live API WebSocket
 * for real-time audio translation.
 *
 * Each bridge instance:
 * 1. Joins the LiveKit room as a bot participant (e.g., "translator-es")
 * 2. Subscribes to the organizer's audio track
 * 3. Pipes PCM audio frames to Gemini Live API via WebSocket
 * 4. Receives translated audio back and publishes it as a new track
 */

import {
  Room,
  RoomEvent,
  LocalAudioTrack,
  AudioSource,
  AudioFrame,
  TrackPublishOptions,
  TrackSource,
  RemoteTrackPublication,
  RemoteParticipant,
  RemoteAudioTrack,
  TrackKind,
  AudioStream,
} from "@livekit/rtc-node";
import WebSocket from "ws";
import { kostenUsd, type Verbrauch } from "./kosten";
import {
  GeminiCloseError,
  klassifiziere,
  klartext,
  type Stoerung,
  type StoerungsArt,
} from "./gemini-stoerung";

export type BridgeStatus = "starting" | "active" | "error" | "closed";

/**
 * Tatsaechlicher Zustand, abgeleitet aus dem Audiofluss statt aus einem Flag.
 * `status === "active"` sagt nur "wurde einmal gestartet" - bei einer haengenden
 * Wiederverbindung blieb er gruen, waehrend nichts mehr uebersetzt wurde.
 */
export type Gesundheit =
  | "startet"
  | "gesund"
  | "verbindet"
  | "stockend"
  | "pausiert"
  | "gestoert"
  | "beendet";

/** Wiederholen nach einem behebbaren Abbruch: 1 s, 2 s, 5 s ... 30 s. */
const BACKOFF_MS = [1000, 2000, 5000, 10000, 20000, 30000];
/** So lange wird ein behebbarer Ausfall ueberbrueckt, dann gilt er als Stoerung. */
const WIEDERHOL_BUDGET_MS = 120_000;
/** Takt der Erholungsversuche waehrend einer Stoerung, solange jemand zuhoert. */
const ERHOLUNG_MS = 60_000;
/** Ohne Rueckkanal so lange, obwohl gesprochen wird -> "stockend". */
const STOCKEND_NACH_MS = 20_000;
/** Ohne Sprache am Eingang so lange -> "pausiert" (Lobpreis, Pause). */
const PAUSIERT_NACH_MS = 5_000;
/**
 * So lange muss der Sender pausiert sein, bis die Gemini-Verbindung getrennt
 * wird. Verhindert staendiges Neuverbinden bei kurzem Antippen.
 */
const PAUSE_TRENNEN_NACH_MS = 5_000;
/** Pegel, ab dem ein Eingangsframe als Sprache zaehlt: etwa -50 dBFS. */
const SPRACHSCHWELLE = 100;

export class TranslationBridge {
  private room: Room | null = null;
  private geminiWs: WebSocket | null = null;
  private audioSource: AudioSource | null = null;
  private localTrack: LocalAudioTrack | null = null;
  private publishedTrackSid: string = "";
  private transcriptionSegmentId: number = 0;
  private framesSentToGemini: number = 0;
  private framesReceivedFromGemini: number = 0;
  private resumptionHandle: string | null = null;
  private isReconnecting: boolean = false;
  private stopping: boolean = false;
  private pendingInterimText: string = "";
  private interimTimeout: NodeJS.Timeout | null = null;

  public readonly targetLanguage: string;
  public readonly sessionId: string;
  public readonly identity: string;
  public status: BridgeStatus = "starting";
  public subscriberCount: number = 0;
  public onStop?: () => void;

  // Gemini Live API config
  private readonly geminiApiKey: string;
  private readonly geminiModel: string = "gemini-3.5-live-translate-preview";
  private readonly sampleRate: number = 24000; // Gemini outputs 24kHz
  // Eingangsrate an Gemini. Upstream fest 48 kHz (LiveKit-Default); Google
  // empfiehlt 16 kHz. Am 2026-10-04 wurde die Eingabe mit Faktor 3 abgerechnet,
  // was genau 48 : 16 entspricht. LiveKit rechnet beim Abholen selbst um, am
  // Mischpult aendert sich nichts. Voreinstellung bleibt 48 kHz, bis ein A/B-
  // Test die Umstellung bestaetigt (so verlangt es das Briefing).
  private readonly inputSampleRate: number = TranslationBridge.eingangsrate();

  private static eingangsrate(): number {
    const r = Number(process.env.GEMINI_INPUT_SAMPLE_RATE);
    return [16000, 24000, 48000].includes(r) ? r : 48000;
  }
  private readonly channels: number = 1;

    // LiveKit config
  private readonly livekitUrl: string;
  private readonly livekitApiKey: string;
  private readonly livekitApiSecret: string;
  public readonly systemInstruction?: string;

  private geminiSetupComplete: boolean = false;
  private organizerIdentity: string;
  private lastAudioFrameTime: number = 0;
  private captureChain: Promise<void> = Promise.resolve();

  // --- Ausfallerkennung (Anpassung, siehe ANPASSUNGEN.md) -----------------
  /** Aktuelle Stoerung, null wenn alles laeuft. */
  public stoerung: Stoerung | null = null;
  public onStoerung?: (s: Stoerung) => void;
  public onWiederhergestellt?: () => void;
  private fehlversuche: number = 0;
  private ausfallSeit: number = 0;
  private fehlversucheMitHandle: number = 0;
  private wiederholTimer: NodeJS.Timeout | null = null;
  private letzteSprache: number = 0;
  private spracheSeit: number = 0;
  private verbundenSeit: number = 0;
  private teststoerungGeplant: boolean = false;

  // --- Verbrauch fuer die Kostenschaetzung ------------------------------
  // Exakt aus den tatsaechlich gesendeten bzw. empfangenen Samples, nicht aus
  // der Laufzeit: Waehrend Pausen und Ausfaellen fliesst nichts.
  private eingabeSamples: number = 0;
  private ausgabeBytes: number = 0;

  // Track des Senders, um seinen Mute-Zustand abzufragen.
  private organizerTrack: RemoteAudioTrack | null = null;
  private senderPausiert: boolean = false;
  private pausiertSeit: number = 0;
  /** Gemini-Verbindung waehrend einer Pause bewusst getrennt. */
  private ruhend: boolean = false;

  constructor(
    sessionId: string,
    targetLanguage: string,
    organizerIdentity: string,
    config: {
      geminiApiKey: string;
      livekitUrl: string;
      livekitApiKey: string;
      livekitApiSecret: string;
      systemInstruction?: string;
    }
  ) {
    this.sessionId = sessionId;
    this.targetLanguage = targetLanguage;
    this.organizerIdentity = organizerIdentity;
    this.identity = `translator-${targetLanguage}`;
    this.geminiApiKey = config.geminiApiKey;
    this.livekitUrl = config.livekitUrl;
    this.livekitApiKey = config.livekitApiKey;
    this.livekitApiSecret = config.livekitApiSecret;
    this.systemInstruction = config.systemInstruction;
  }

  async start(): Promise<void> {
    console.log(
      `[TranslationBridge:${this.targetLanguage}] Starting bridge for session ${this.sessionId}`
    );

    try {
      // 1. Generate token and join LiveKit room
      await this.joinLiveKitRoom();

      // 2. Connect to Gemini Live API
      await this.connectGemini();

      // 3. Subscribe to organizer's audio and wire up the pipeline
      await this.subscribeToOrganizer();

      this.status = "active";
      this.verbundenSeit = Date.now();
      console.log(
        `[TranslationBridge:${this.targetLanguage}] Bridge is active`
      );
      this.teststoerungPlanen();
    } catch (error) {
      console.error(
        `[TranslationBridge:${this.targetLanguage}] Failed to start:`,
        error
      );
      this.status = "error";
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.status === "closed" || this.stopping) return;
    this.stopping = true;
    console.log(
      `[TranslationBridge:${this.targetLanguage}] Stopping bridge`
    );
    this.status = "closed";

    if (this.wiederholTimer) {
      clearTimeout(this.wiederholTimer);
      this.wiederholTimer = null;
    }

    if (this.interimTimeout) {
      clearTimeout(this.interimTimeout);
      this.interimTimeout = null;
    }
    this.pendingInterimText = "";

    if (this.geminiWs) {
      this.geminiWs.close();
      this.geminiWs = null;
    }

    if (this.room) {
      await this.room.disconnect();
      this.room = null;
    }

    this.audioSource = null;
    this.localTrack = null;
    this.geminiSetupComplete = false;

    if (this.onStop) {
      this.onStop();
    }
  }

  private async joinLiveKitRoom(): Promise<void> {
    // Generate a token for the bot participant using the server SDK
    const { AccessToken } = await import("livekit-server-sdk");

    const at = new AccessToken(this.livekitApiKey, this.livekitApiSecret, {
      identity: this.identity,
      name: `Translator (${this.targetLanguage.toUpperCase()})`,
    });

    at.addGrant({
      roomJoin: true,
      room: this.sessionId,
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();

    // Create and connect to the room
    this.room = new Room();

    this.room.on(RoomEvent.Disconnected, () => {
      console.log(
        `[TranslationBridge:${this.targetLanguage}] Disconnected from room`
      );
      this.status = "closed";
    });

    this.room.on(
      RoomEvent.ParticipantDisconnected,
      (participant: RemoteParticipant) => {
        if (participant.identity === this.organizerIdentity) {
          console.log(
            `[TranslationBridge:${this.targetLanguage}] Organizer ${this.organizerIdentity} disconnected, stopping bridge`
          );
          this.stop().catch((err) => {
            console.error(
              `[TranslationBridge:${this.targetLanguage}] Error stopping bridge after organizer disconnect:`,
              err
            );
          });
        }
      }
    );

    await this.room.connect(this.livekitUrl, token, {
      autoSubscribe: false,
      dynacast: false,
    });

    console.log(
      `[TranslationBridge:${this.targetLanguage}] Joined room as ${this.identity}`
    );

    // Create an AudioSource to publish translated audio
    // Gemini outputs 24kHz mono PCM
    this.audioSource = new AudioSource(this.sampleRate, this.channels);
    this.localTrack = LocalAudioTrack.createAudioTrack(
      `translated-audio-${this.targetLanguage}`,
      this.audioSource
    );

    const publishOptions = new TrackPublishOptions();
    publishOptions.source = TrackSource.SOURCE_MICROPHONE;

    await this.room.localParticipant!.publishTrack(
      this.localTrack,
      publishOptions
    );

    // Save published track SID for transcription
    const pubs = this.room.localParticipant!.trackPublications;
    for (const [, pub] of pubs) {
      if (pub.track === this.localTrack) {
        this.publishedTrackSid = pub.sid || "";
        break;
      }
    }

    console.log(
      `[TranslationBridge:${this.targetLanguage}] Published translated audio track (sid: ${this.publishedTrackSid || 'pending'})`
    );
  }

  private async connectGemini(): Promise<void> {
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.geminiApiKey}`;

    return new Promise<void>((resolve, reject) => {
      this.geminiWs = new WebSocket(wsUrl);

      this.geminiWs.on("open", () => {
        console.log(
          `[TranslationBridge:${this.targetLanguage}] Gemini WebSocket connected`
        );
        this.sendGeminiSetup();
      });

      this.geminiWs.on("message", (data: WebSocket.Data) => {
        this.handleGeminiMessage(data);
        if (!this.geminiSetupComplete) {
          // Wait for setup complete message
          // resolve will be called in handleGeminiMessage
        }
      });

      this.geminiWs.on("error", (error) => {
        console.error(
          `[TranslationBridge:${this.targetLanguage}] Gemini WebSocket error:`,
          error
        );
        if (!this.geminiSetupComplete) {
          reject(error);
        }
      });

      this.geminiWs.on("close", (code: number, reason: Buffer) => {
        const reasonStr = reason.toString();
        console.log(
          `[TranslationBridge:${this.targetLanguage}] Gemini WebSocket closed`,
          { code, reason: reasonStr }
        );
        if (!this.geminiSetupComplete) {
          // Typisiert, damit der Session-Manager Code und Grund einstufen kann.
          reject(new GeminiCloseError(code, reasonStr));
        } else if (this.status === "active") {
          // Nicht mehr blind wiederverbinden: erst einstufen. Ein erschoepftes
          // Guthaben loest sich durch Wiederholen nicht.
          this.geminiSetupComplete = false;
          this.beiVerbindungsabbruch(code, reasonStr);
        }
      });

      // Store resolve for use when setup complete arrives
      const checkSetup = setInterval(() => {
        if (this.geminiSetupComplete) {
          clearInterval(checkSetup);
          resolve();
        }
      }, 100);

      // Timeout after 15 seconds
      setTimeout(() => {
        if (!this.geminiSetupComplete) {
          clearInterval(checkSetup);
          reject(new Error("Gemini setup timeout"));
        }
      }, 15000);
    });
  }

  /**
   * Reconnect the Gemini WebSocket after a GoAway or unexpected closure.
   * Reuses the existing LiveKit room + audio pipeline.
   *
   * Angepasst: Ein gescheiterter Versuch fuehrt nicht mehr in eine
   * Endlosschleife, sondern ueber versuchGescheitert() in begrenztes
   * Wiederholen bzw. in eine sichtbare Stoerung.
   */
  private async reconnectGemini(): Promise<void> {
    if (this.isReconnecting) {
      console.log(
        `[TranslationBridge:${this.targetLanguage}] Reconnection already in progress. Skipping duplicate request.`
      );
      return;
    }
    if (this.status !== "active" || this.stopping) return;
    // Waehrend einer Pause wird nicht verbunden - genau das soll ja sparen.
    // Beim Fortsetzen ruft geminiAufwecken() diese Methode erneut auf.
    if (this.ruhend) return;
    this.isReconnecting = true;
    if (this.wiederholTimer) {
      clearTimeout(this.wiederholTimer);
      this.wiederholTimer = null;
    }

    try {
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.geminiApiKey}`;
      console.log(
        `[TranslationBridge:${this.targetLanguage}] Reconnecting Gemini WebSocket with handle: ${this.resumptionHandle || "none"}...`
      );

      // handshakeTimeout: Ohne ihn kann ein Verbindungsaufbau unbegrenzt haengen,
      // und dann kommt nie ein close-Ereignis, das den naechsten Versuch ausloest.
      const nextWs = new WebSocket(wsUrl, { handshakeTimeout: 15000 });
      let nextSetupComplete = false;

      // Offen, aber kein setupComplete: gilt ebenfalls als gescheitert.
      const setupTimer = setTimeout(() => {
        if (!nextSetupComplete) {
          console.warn(
            `[TranslationBridge:${this.targetLanguage}] Gemini reconnect setup timeout`
          );
          nextWs.terminate();
        }
      }, 15000);

      nextWs.on("open", () => {
        console.log(
          `[TranslationBridge:${this.targetLanguage}] Gemini reconnect WebSocket opened`
        );
        this.sendGeminiSetup(nextWs);
      });

      nextWs.on("message", (data: WebSocket.Data) => {
        try {
          if (!nextSetupComplete) {
            const msg = JSON.parse(data.toString());
            if (msg.setupComplete) {
              console.log(
                `[TranslationBridge:${this.targetLanguage}] Gemini reconnect setup complete`
              );
              nextSetupComplete = true;
              clearTimeout(setupTimer);
              this.geminiSetupComplete = true;

              const oldWs = this.geminiWs;
              this.geminiWs = nextWs;
              this.isReconnecting = false;

              if (oldWs && oldWs !== nextWs) {
                console.log(
                  `[TranslationBridge:${this.targetLanguage}] Gracefully closing old Gemini WebSocket`
                );
                oldWs.removeAllListeners();
                oldWs.close();
              }

              this.verbundenSeit = Date.now();
              this.wiederhergestellt();
              return;
            }
          }
          this.handleGeminiMessage(data);
        } catch (error) {
          console.error(
            `[TranslationBridge:${this.targetLanguage}] Error handling reconnect message:`,
            error
          );
        }
      });

      nextWs.on("error", (error) => {
        console.error(
          `[TranslationBridge:${this.targetLanguage}] Gemini reconnect error:`,
          error
        );
      });

      nextWs.on("close", (code: number, reason: Buffer) => {
        clearTimeout(setupTimer);
        const reasonStr = reason.toString();
        console.log(
          `[TranslationBridge:${this.targetLanguage}] Gemini reconnect WebSocket closed`,
          { code, reason: reasonStr }
        );

        if (!nextSetupComplete) {
          // Versuch gescheitert, bevor die neue Verbindung uebernommen wurde.
          this.isReconnecting = false;
          this.versuchGescheitert(code, reasonStr);
        } else if (this.geminiWs === nextWs) {
          // Die laufende Verbindung ist abgebrochen.
          this.geminiSetupComplete = false;
          this.beiVerbindungsabbruch(code, reasonStr);
        }
      });
    } catch (error) {
      console.error(
        `[TranslationBridge:${this.targetLanguage}] Gemini reconnect initialization failed:`,
        error
      );
      this.isReconnecting = false;
      this.versuchGescheitert(
        null,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  // ---------------------------------------------------------------------
  // Ausfallerkennung (Anpassung, siehe ANPASSUNGEN.md)
  // ---------------------------------------------------------------------

  /** Eine laufende Verbindung ist abgebrochen. */
  private beiVerbindungsabbruch(code: number | null, grund: string): void {
    if (this.status !== "active" || this.stopping) return;
    const art = klassifiziere(code, grund);
    console.warn(
      `[TranslationBridge:${this.targetLanguage}] Verbindungsabbruch`,
      { code, grund, art }
    );

    // Vor der Verzweigung: Auch ein endgueltiger Ausfall braucht seinen
    // Beginn, sonst meldet die Wiederherstellung "Ausfall 0 s".
    if (!this.ausfallSeit) this.ausfallSeit = Date.now();
    if (art === "endgueltig") {
      this.stoerungSetzen(code, grund, art);
      return;
    }
    // Besteht bereits eine Stoerung, laeuft der Erholungstakt schon. Typischer
    // Fall vom 2026-10-04: Wiederverbindung scheitert am leeren Guthaben,
    // Sekunden spaeter bricht Google die alte Verbindung mit 1008 ab. Ohne
    // diese Sperre gaebe es einen zusaetzlichen Sofortversuch.
    if (this.stoerung) return;
    // Erster Versuch sofort - so verhaelt sich auch der bewaehrte goAway-Pfad.
    this.reconnectGemini();
  }

  /** Ein Wiederverbindungsversuch ist gescheitert. */
  private versuchGescheitert(code: number | null, grund: string): void {
    if (this.status !== "active" || this.stopping) return;
    const art = klassifiziere(code, grund);
    if (!this.ausfallSeit) this.ausfallSeit = Date.now();
    this.fehlversuche++;

    // Ein ungueltiger Handle wurde frueher bei jedem Versuch erneut gesendet.
    // Nach zwei Fehlschlaegen mit Handle wird frisch begonnen - der kurze
    // Kontextverlust ist fuer Uebersetzung unerheblich.
    if (this.resumptionHandle) {
      this.fehlversucheMitHandle++;
      if (this.fehlversucheMitHandle >= 2) {
        console.warn(
          `[TranslationBridge:${this.targetLanguage}] Resumption-Handle verworfen, naechster Versuch mit frischer Session`
        );
        this.resumptionHandle = null;
      }
    }

    console.warn(
      `[TranslationBridge:${this.targetLanguage}] Wiederverbindung gescheitert (Versuch ${this.fehlversuche})`,
      { code, grund, art }
    );

    if (art === "endgueltig" || this.stoerung) {
      // Endgueltig, oder bereits in Stoerung: nur noch im Erholungstakt.
      this.stoerungSetzen(code, grund, art);
      return;
    }

    const vergangen = Date.now() - this.ausfallSeit;
    if (vergangen >= WIEDERHOL_BUDGET_MS) {
      this.stoerungSetzen(code, grund, art);
      return;
    }

    const pause = BACKOFF_MS[Math.min(this.fehlversuche - 1, BACKOFF_MS.length - 1)];
    console.log(
      `[TranslationBridge:${this.targetLanguage}] Naechster Versuch in ${pause / 1000} s (Ausfall seit ${Math.round(vergangen / 1000)} s)`
    );
    this.wiederholTimer = setTimeout(() => {
      this.wiederholTimer = null;
      this.reconnectGemini();
    }, pause);
  }

  private stoerungSetzen(code: number | null, grund: string, art: StoerungsArt): void {
    const jetzt = Date.now();
    const neu = !this.stoerung;
    this.stoerung = {
      code,
      grund,
      text: klartext(code, grund),
      art,
      seit: this.stoerung?.seit ?? jetzt,
      zuletzt: jetzt,
      versuche: this.fehlversuche,
    };
    this.geminiSetupComplete = false;

    // Eine Zeile je Stoerung, gut auffindbar mit: grep STOERUNG
    if (neu) {
      console.error(
        `[TranslationBridge:${this.targetLanguage}] STOERUNG: ${this.stoerung.text}`,
        { code, grund, art, versuche: this.fehlversuche }
      );
    } else {
      console.warn(
        `[TranslationBridge:${this.targetLanguage}] STOERUNG haelt an (${this.fehlversuche} Versuche): ${this.stoerung.text}`
      );
    }

    this.onStoerung?.(this.stoerung);
    this.erholungPlanen();
  }

  /**
   * Waehrend einer Stoerung einmal pro Minute ein frischer Versuch - aber nur,
   * solange jemand zuhoert. So laeuft es nach dem Aufladen des Guthabens von
   * selbst wieder an, ohne die API im Sekundentakt zu belasten.
   */
  private erholungPlanen(): void {
    if (this.wiederholTimer) clearTimeout(this.wiederholTimer);
    this.wiederholTimer = setTimeout(() => {
      this.wiederholTimer = null;
      if (this.status !== "active" || this.stopping) return;
      if (this.ruhend) {
        this.erholungPlanen();
        return;
      }
      if (this.anzahlHoerer() === 0) {
        console.log(
          `[TranslationBridge:${this.targetLanguage}] Stoerung, aber niemand hoert zu - kein Erholungsversuch`
        );
        this.erholungPlanen();
        return;
      }
      console.log(
        `[TranslationBridge:${this.targetLanguage}] Erholungsversuch nach Stoerung`
      );
      this.resumptionHandle = null;
      this.reconnectGemini();
    }, ERHOLUNG_MS);
  }

  private wiederhergestellt(): void {
    const warGestoert = !!this.stoerung;
    if (warGestoert || this.fehlversuche > 0) {
      const beginn = this.stoerung?.seit ?? this.ausfallSeit;
      const dauer = beginn ? Math.round((Date.now() - beginn) / 1000) : 0;
      console.log(
        `[TranslationBridge:${this.targetLanguage}] Verbindung wiederhergestellt nach ${this.fehlversuche} Fehlversuchen, Ausfall ${dauer} s`
      );
    }
    if (this.wiederholTimer) {
      clearTimeout(this.wiederholTimer);
      this.wiederholTimer = null;
    }
    this.stoerung = null;
    this.fehlversuche = 0;
    this.ausfallSeit = 0;
    this.fehlversucheMitHandle = 0;
    if (warGestoert) this.onWiederhergestellt?.();
  }

  /**
   * Tatsaechlich verbundene Hoerer dieser Sprache. Massgeblich ist das
   * Teilnehmer-Attribut in LiveKit, nicht der subscriberCount - der wird nur
   * per sendBeacon heruntergezaehlt und bleibt bei hart beendeten Browsern
   * stehen.
   */
  /** Bisheriger Verbrauch dieser Bridge. */
  public get verbrauch(): Verbrauch {
    return {
      eingabeSek: this.eingabeSamples / this.inputSampleRate,
      // 16 Bit = 2 Bytes je Sample, Gemini liefert 24 kHz mono.
      ausgabeSek: this.ausgabeBytes / 2 / this.sampleRate,
      abtastrate: this.inputSampleRate,
    };
  }

  /** Geschaetzte Kosten dieser Bridge in USD. */
  public get kostenUsd(): number {
    return kostenUsd(this.verbrauch);
  }

  public anzahlHoerer(): number {
    if (!this.room) return 0;
    return Array.from(this.room.remoteParticipants.values()).filter(
      (p) => p.attributes?.language === this.targetLanguage
    ).length;
  }

  public get gesundheit(): Gesundheit {
    if (this.status === "starting") return "startet";
    if (this.status !== "active") return "beendet";
    if (this.stoerung) return "gestoert";
    if (this.ruhend) return "pausiert";
    if (!this.geminiSetupComplete) return "verbindet";

    const jetzt = Date.now();
    if (jetzt - this.letzteSprache > PAUSIERT_NACH_MS) return "pausiert";

    // Bezug ist das juengste von: letztes Audio zurueck, Verbindungsaufbau,
    // Wiedereinsetzen der Sprache nach einer Pause. Sonst gaebe es nach jeder
    // Pause einen Fehlalarm, bevor die erste Uebersetzung zurueckkommt.
    const bezug = Math.max(this.lastAudioFrameTime, this.verbundenSeit, this.spracheSeit);
    return jetzt - bezug > STOCKEND_NACH_MS ? "stockend" : "gesund";
  }

  /** Gemini-Verbindung waehrend einer Pause trennen, um Kosten zu sparen. */
  private geminiRuhenLassen(): void {
    const ws = this.geminiWs;
    this.geminiWs = null;
    this.geminiSetupComplete = false;
    this.ruhend = true;
    if (ws) {
      // Listener entfernen: Dieser Abbruch ist gewollt und darf nicht als
      // Verbindungsabbruch gewertet werden.
      ws.removeAllListeners();
      ws.close();
    }
    console.log(
      `[TranslationBridge:${this.targetLanguage}] Gemini-Verbindung waehrend der Pause getrennt (spart Kosten)`
    );
  }

  /** Nach der Pause wieder verbinden, mit Resumption-Handle. */
  private geminiAufwecken(): void {
    this.ruhend = false;
    console.log(
      `[TranslationBridge:${this.targetLanguage}] Pause beendet - Gemini-Verbindung wird wieder aufgebaut`
    );
    this.reconnectGemini();
  }

  /** Pegel des Eingangsframes messen, um Sprache von Stille zu trennen. */
  private eingangMessen(samples: Int16Array): void {
    // Jeder vierte Wert genuegt fuer eine Pegelschaetzung und spart Rechenzeit.
    let summe = 0;
    let n = 0;
    for (let i = 0; i < samples.length; i += 4) {
      summe += samples[i] * samples[i];
      n++;
    }
    if (n === 0 || Math.sqrt(summe / n) < SPRACHSCHWELLE) return;

    const jetzt = Date.now();
    if (jetzt - this.letzteSprache > PAUSIERT_NACH_MS) this.spracheSeit = jetzt;
    this.letzteSprache = jetzt;
  }

  /**
   * Testschalter: GEMINI_TESTSTOERUNG_NACH_S=<Sekunden> simuliert nach dieser
   * Zeit einen Abbruch mit Code 1011 und dem Guthaben-Grund aus dem Vorfall vom
   * 2026-10-04. Ohne ihn waere der Stoerungspfad nur mit echtem leerem Guthaben
   * testbar. Ist die Variable nicht gesetzt, ist dieser Code wirkungslos.
   */
  private teststoerungPlanen(): void {
    const sekunden = Number(process.env.GEMINI_TESTSTOERUNG_NACH_S);
    if (!sekunden || sekunden <= 0 || this.teststoerungGeplant) return;
    this.teststoerungGeplant = true;

    const code = Number(process.env.GEMINI_TESTSTOERUNG_CODE) || 1011;
    const grund =
      process.env.GEMINI_TESTSTOERUNG_GRUND ??
      "Your prepayment credits are depleted (TESTSCHALTER)";
    console.warn(
      `[TranslationBridge:${this.targetLanguage}] TESTSCHALTER aktiv: Abbruch ${code} in ${sekunden} s`
    );

    setTimeout(() => {
      if (this.status !== "active") return;
      console.warn(
        `[TranslationBridge:${this.targetLanguage}] TESTSCHALTER loest aus: ${code} "${grund}"`
      );
      const ws = this.geminiWs;
      if (ws) {
        ws.removeAllListeners();
        ws.terminate();
      }
      this.geminiWs = null;
      this.geminiSetupComplete = false;
      this.beiVerbindungsabbruch(code, grund);
    }, sekunden * 1000);
  }

  private sendGeminiSetup(ws: WebSocket = this.geminiWs!): void {
    const setupMessage = {
      setup: {
        model: `models/${this.geminiModel}`,
        outputAudioTranscription: {},
        ...(this.systemInstruction
          ? {
              systemInstruction: {
                parts: [{ text: this.systemInstruction }],
              },
            }
          : {}),
        generationConfig: {
          responseModalities: ["AUDIO"],
          translationConfig: {
            targetLanguageCode: this.targetLanguage,
            echoTargetLanguage: true,
          },
        },
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: false,
          },
        },
        sessionResumption: this.resumptionHandle
          ? { handle: this.resumptionHandle }
          : {},
      },
    };

    console.log(
      `[TranslationBridge:${this.targetLanguage}] Sending Gemini setup (resuming: ${!!this.resumptionHandle}):`,
      JSON.stringify(setupMessage, null, 2)
    );

    ws.send(JSON.stringify(setupMessage));
  }

  private handleGeminiMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());

      // Log all messages before setup is complete for debugging
      if (!this.geminiSetupComplete) {
        console.log(
          `[TranslationBridge:${this.targetLanguage}] Gemini message (pre-setup):`,
          JSON.stringify(message).slice(0, 500)
        );
      }

      // Handle setup complete
      if (message.setupComplete) {
        console.log(
          `[TranslationBridge:${this.targetLanguage}] Gemini setup complete`
        );
        this.geminiSetupComplete = true;
        return;
      }

      // Handle session resumption update
      if (message.sessionResumptionUpdate) {
        const update = message.sessionResumptionUpdate;
        if (update.resumable && update.newHandle) {
          this.resumptionHandle = update.newHandle;
        }
      }

      // Handle GoAway message
      if (message.goAway) {
        console.log(
          `[TranslationBridge:${this.targetLanguage}] Received goAway message from Gemini. Time left: ${message.goAway.timeLeft || "unknown"}. Initiating graceful session resumption...`
        );
        this.reconnectGemini().catch((err) => {
          console.error(
            `[TranslationBridge:${this.targetLanguage}] Error during goAway reconnection:`,
            err
          );
        });
      }

      // Handle audio response
      const serverContent = message?.serverContent;
      const parts = serverContent?.modelTurn?.parts;

      if (parts?.length) {
        for (const part of parts) {
          if (part.inlineData?.data) {
            const b64: string = part.inlineData.data;
            this.ausgabeBytes +=
              (b64.length * 3) / 4 - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
            this.framesReceivedFromGemini++;
            if (this.framesReceivedFromGemini <= 3 || this.framesReceivedFromGemini % 100 === 0) {
              console.log(
                `[TranslationBridge:${this.targetLanguage}] Received audio frame #${this.framesReceivedFromGemini} from Gemini (${part.inlineData.data.length} bytes base64)`
              );
            }
            // Queue frame for sequential capture (avoid promise pile-up)
            this.queueAudioFrame(part.inlineData.data);
          }
        }
      }

      // Handle output transcription (separate field from modelTurn)
      if (serverContent?.outputTranscription?.text) {
        const text = serverContent.outputTranscription.text;
        const isInterim = !serverContent.turnComplete;

        if (isInterim) {
          this.handleInterimTranscription(text);
        } else {
          if (this.interimTimeout) {
            clearTimeout(this.interimTimeout);
            this.interimTimeout = null;
          }
          const finalText = this.pendingInterimText + text;
          this.pendingInterimText = "";
          console.log(
            `[TranslationBridge:${this.targetLanguage}] Final Transcription:`,
            finalText.slice(0, 100)
          );
          this.publishTranscriptionText(finalText, false);
        }
      }

      // If turn is complete, flush remaining interim buffer and advance the segment id
      if (serverContent?.turnComplete) {
        if (this.interimTimeout) {
          clearTimeout(this.interimTimeout);
          this.interimTimeout = null;
        }
        if (this.pendingInterimText) {
          this.publishTranscriptionText(this.pendingInterimText, false);
          this.pendingInterimText = "";
        }
        this.transcriptionSegmentId++;
      }
    } catch (error) {
      console.error(
        `[TranslationBridge:${this.targetLanguage}] Error parsing Gemini message:`,
        error
      );
    }
  }

  /**
   * Queue an audio frame for sequential capture.
   * Chains each captureFrame call to avoid promise pile-up.
   */
  private queueAudioFrame(base64Audio: string): void {
    this.captureChain = this.captureChain.then(() =>
      this.publishTranslatedAudio(base64Audio)
    );
  }

  private async publishTranslatedAudio(base64Audio: string): Promise<void> {
    if (!this.audioSource || this.status === "closed") return;

    try {
      const pcmBuffer = Buffer.from(base64Audio, "base64");
      const int16 = new Int16Array(
        pcmBuffer.buffer,
        pcmBuffer.byteOffset,
        pcmBuffer.byteLength / 2
      );

      const frame = new AudioFrame(int16, this.sampleRate, this.channels, int16.length);
      await this.audioSource.captureFrame(frame);

      const now = Date.now();
      if (this.lastAudioFrameTime && now - this.lastAudioFrameTime > 2000) {
        console.log(
          `[TranslationBridge:${this.targetLanguage}] Audio resumed after ${now - this.lastAudioFrameTime}ms gap (frame #${this.framesReceivedFromGemini})`
        );
      }
      this.lastAudioFrameTime = now;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("InvalidState") || msg.includes("closed")) {
        console.warn(
          `[TranslationBridge:${this.targetLanguage}] AudioSource closed — stopping capture`
        );
        this.audioSource = null;
      } else {
        console.error(
          `[TranslationBridge:${this.targetLanguage}] Error capturing audio frame:`,
          error
        );
      }
    }
  }

  private async subscribeToOrganizer(): Promise<void> {
    if (!this.room) return;

    // Find the organizer participant and subscribe to their audio
    const participants = this.room.remoteParticipants;

    for (const [, participant] of participants) {
      if (participant.identity === this.organizerIdentity) {
        this.subscribeToParticipantAudio(participant);
        return;
      }
    }

    // If organizer hasn't joined yet, wait for them
    console.log(
      `[TranslationBridge:${this.targetLanguage}] Waiting for organizer ${this.organizerIdentity}...`
    );

    // Listen for the organizer to publish their track
    this.room.on(
      RoomEvent.TrackPublished,
      (
        publication: RemoteTrackPublication,
        participant: RemoteParticipant
      ) => {
        if (
          participant.identity === this.organizerIdentity &&
          publication.kind === TrackKind.KIND_AUDIO
        ) {
          publication.setSubscribed(true);
        }
      }
    );

    // Once subscribed, pipe to Gemini
    this.room.on(
      RoomEvent.TrackSubscribed,
      (
        track: RemoteAudioTrack,
        publication: RemoteTrackPublication,
        participant: RemoteParticipant
      ) => {
        if (
          participant.identity === this.organizerIdentity &&
          publication.kind === TrackKind.KIND_AUDIO
        ) {
          this.pipeTrackToGemini(track);
        }
      }
    );
  }

  /**
   * Manually subscribe to a participant's audio track (needed when autoSubscribe is off).
   */
  private subscribeToParticipantAudio(
    participant: RemoteParticipant
  ): void {
    for (const [, publication] of participant.trackPublications) {
      if (publication.kind === TrackKind.KIND_AUDIO) {
        // Manually subscribe — this triggers TrackSubscribed event
        publication.setSubscribed(true);
      }
    }

    // Also listen for TrackSubscribed to pipe to Gemini
    this.room!.on(
      RoomEvent.TrackSubscribed,
      (
        track: RemoteAudioTrack,
        pub: RemoteTrackPublication,
        p: RemoteParticipant
      ) => {
        if (
          p.identity === this.organizerIdentity &&
          pub.kind === TrackKind.KIND_AUDIO
        ) {
          this.pipeTrackToGemini(track);
        }
      }
    );
  }

  private pipeTrackToGemini(track: RemoteAudioTrack): void {
    this.organizerTrack = track;
    console.log(
      `[TranslationBridge:${this.targetLanguage}] Subscribed to organizer audio track, piping to Gemini`
    );

    const audioStream = new AudioStream(track, {
      sampleRate: this.inputSampleRate,
      numChannels: this.channels,
      frameSizeMs: 100,
    });

    // Process frames as they arrive via ReadableStream reader
    const reader = audioStream.getReader();
    const readLoop = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.sendAudioToGemini(value);
      }
    };

    readLoop().catch((err: Error) => {
      console.error(
        `[TranslationBridge:${this.targetLanguage}] Audio stream error:`,
        err
      );
    });
  }

  private sendAudioToGemini(frame: AudioFrame): void {
    // Vor der Verbindungspruefung: Auch waehrend eines Ausfalls muss bekannt
    // sein, ob gerade gesprochen wird.
    this.eingangMessen(frame.data);

    // Pausiert der Sender (Pause-Knopf, Companion oder Mikrofon aus), ist sein
    // Track stummgeschaltet. LiveKit liefert dann trotzdem weiter Frames -
    // Stille. Am 2026-10-04 gemessen: Wurden die gesendet, rechnete Gemini sie
    // ab und lieferte sogar 1:1 Ausgabe dafuer zurueck. Pause sparte also
    // nichts. Deshalb hier verwerfen.
    //
    // Die Eingabe anzuhalten genuegt aber nicht: Gemini liefert bei offener
    // Verbindung weiter Ausgabe (Stille) und rechnet sie ab - gemessen am
    // 2026-10-04, 30 s Pause ergaben weiterhin 30 s Ausgabe. Nach
    // PAUSE_TRENNEN_NACH_MS wird die Verbindung deshalb getrennt und beim
    // Fortsetzen mit Resumption-Handle wieder aufgebaut.
    const pausiert = this.organizerTrack?.muted === true;
    if (pausiert !== this.senderPausiert) {
      this.senderPausiert = pausiert;
      console.log(
        `[TranslationBridge:${this.targetLanguage}] ${pausiert ? "Sender pausiert - kein Audio an Gemini" : "Sender fortgesetzt"}`
      );
    }
    if (pausiert) {
      if (!this.pausiertSeit) this.pausiertSeit = Date.now();
      // Bedingung prueft die offene Verbindung statt nur das Flag: Eine
      // Wiederverbindung, die waehrend der Pause noch fertig wurde, wird so
      // ebenfalls getrennt.
      if (this.geminiWs && Date.now() - this.pausiertSeit > PAUSE_TRENNEN_NACH_MS) {
        this.geminiRuhenLassen();
      }
      return;
    }
    this.pausiertSeit = 0;
    if (this.ruhend) {
      this.geminiAufwecken();
      return;
    }

    if (
      !this.geminiWs ||
      this.geminiWs.readyState !== WebSocket.OPEN ||
      !this.geminiSetupComplete
    ) {
      return;
    }

    try {
      // Convert AudioFrame's Int16Array data to base64
      const int16Data = frame.data;
      const buffer = Buffer.from(int16Data.buffer, int16Data.byteOffset, int16Data.byteLength);
      const base64 = buffer.toString("base64");

      this.framesSentToGemini++;
      this.eingabeSamples += int16Data.length;
      if (this.framesSentToGemini <= 3 || this.framesSentToGemini % 500 === 0) {
        console.log(
          `[TranslationBridge:${this.targetLanguage}] Sent audio frame #${this.framesSentToGemini} to Gemini (${base64.length} bytes base64, ${int16Data.length} samples)`
        );
      }

      const message = {
        realtimeInput: {
          audio: {
            mimeType: `audio/pcm;rate=${this.inputSampleRate}`,
            data: base64,
          },
        },
      };

      this.geminiWs.send(JSON.stringify(message));
    } catch (error) {
      console.error(
        `[TranslationBridge:${this.targetLanguage}] Error sending audio to Gemini:`,
        error
      );
    }
  }

  private handleInterimTranscription(text: string): void {
    this.pendingInterimText += text;

    if (!this.interimTimeout) {
      this.interimTimeout = setTimeout(() => {
        this.flushInterimTranscription();
      }, 150); // Throttle interim text updates to 150ms
    }
  }

  private flushInterimTranscription(): void {
    this.interimTimeout = null;
    if (this.pendingInterimText && this.status === "active") {
      this.publishTranscriptionText(this.pendingInterimText, true);
      this.pendingInterimText = "";
    }
  }

  private async publishTranscriptionText(text: string, interim: boolean): Promise<void> {
    if (!this.room || !this.room.localParticipant) return;

    try {
      // Find all remote participants who have set their 'language' attribute to this.targetLanguage
      const destinationIdentities = Array.from(this.room.remoteParticipants.values())
        .filter((p) => p.attributes?.language === this.targetLanguage)
        .map((p) => p.identity);

      // If no one is listening to this language, skip publishing to save bandwidth
      if (destinationIdentities.length === 0) {
        return;
      }

      const payload = JSON.stringify({
        type: "transcription",
        language: this.targetLanguage,
        segmentId: `${this.targetLanguage}-${this.transcriptionSegmentId}`,
        text,
        final: !interim,
        timestamp: Date.now(),
      });

      await this.room.localParticipant.publishData(
        new TextEncoder().encode(payload),
        {
          reliable: !interim, // reliable only for final transcripts, lossy for interim
          topic: "transcription",
          destination_identities: destinationIdentities,
        }
      );
    } catch (error) {
      console.error(
        `[TranslationBridge:${this.targetLanguage}] Error publishing transcription:`,
        error
      );
    }
  }
}
