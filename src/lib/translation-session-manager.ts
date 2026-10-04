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
 * TranslationSessionManager: Singleton that enforces "max 1 Gemini Live API
 * session per language per room" constraint.
 *
 * Usage:
 *   const manager = TranslationSessionManager.getInstance();
 *   const bridge = await manager.getOrCreate(sessionId, targetLanguage, organizerIdentity);
 */

import { TranslationBridge, BridgeStatus, Gesundheit } from "./translation-bridge";
import { ausFehler, klassifiziere, klartext, type Stoerung } from "./gemini-stoerung";
import { eurKurs } from "./kosten";

/** Verbrauch einer Sprache, aufsummiert ueber alle Bridges dieser Session. */
export interface SprachKosten {
  sprache: string;
  eingabeSek: number;
  ausgabeSek: number;
  usd: number;
  /** Laeuft gerade eine Bridge fuer diese Sprache? */
  laeuft: boolean;
}

export interface SessionKosten {
  sprachen: SprachKosten[];
  gesamtUsd: number;
  /** Gesetzt, wenn KOSTEN_USD_EUR konfiguriert ist. */
  eurKurs: number | null;
}

/**
 * Nach einem endgueltigen Fehler (etwa erschoepftem Guthaben) wird so lange
 * jede neue Anforderung dieser Sprache sofort mit dem bekannten Grund
 * beantwortet, ohne Gemini erneut anzufragen. Etwas kuerzer als der
 * 60-s-Neuversuch der Hoererseite, damit dieser sicher durchkommt.
 */
const SCHONFRIST_MS = 50_000;

/** Fehler, der eine bekannte Stoerung an die API-Route weiterreicht. */
export class StoerungsFehler extends Error {
  public readonly stoerung: Stoerung;
  constructor(stoerung: Stoerung) {
    super(stoerung.text);
    this.name = "StoerungsFehler";
    this.stoerung = stoerung;
  }
}

export interface TranslationInfo {
  language: string;
  translatorIdentity: string;
  status: BridgeStatus;
  subscriberCount: number;
  /** Aus dem Audiofluss abgeleiteter Zustand, siehe TranslationBridge. */
  gesundheit: Gesundheit;
  /** Tatsaechlich verbundene Hoerer laut LiveKit. */
  hoerer: number;
  stoerung: Stoerung | null;
}

export interface SessionInfo {
  sessionId: string;
  organizerIdentity: string;
  createdAt: Date;
  allowedLanguages?: string[];
  systemInstruction?: string;
}

const globalForSessionManager = global as unknown as {
  sessionManagerInstance: TranslationSessionManager;
};

class TranslationSessionManager {
  // Map<sessionId, Map<languageCode, TranslationBridge>>
  private translations: Map<string, Map<string, TranslationBridge>> = new Map();

  // Map<sessionId, SessionInfo>
  private sessions: Map<string, SessionInfo> = new Map();
  // Stoerungen je Session und Sprache. Ueberleben den Abbau der Bridge, damit
  // sichtbar bleibt, WARUM eine Sprache weg ist.
  private stoerungen: Map<string, Map<string, Stoerung>> = new Map();

  // Verbrauch bereits beendeter Bridges. Ohne das verschwaenden die Kosten
  // einer Sprache, sobald ihre Bridge abgebaut wird - am 2026-10-04 lief
  // Ungarisch zum Beispiel in zwei getrennten Bridges.
  private abgeschlossen: Map<string, Map<string, { eingabeSek: number; ausgabeSek: number; usd: number }>> = new Map();
  // Schutz vor doppelter Verbuchung: Mehrere Abbaupfade koennen dieselbe
  // Bridge erreichen (onStop und expliziter Abbau).
  private verbucht = new WeakSet<TranslationBridge>();

  private verbuchen(sessionId: string, sprache: string, bridge: TranslationBridge): void {
    if (this.verbucht.has(bridge)) return;
    this.verbucht.add(bridge);
    const v = bridge.verbrauch;
    if (v.eingabeSek === 0 && v.ausgabeSek === 0) return;
    let m = this.abgeschlossen.get(sessionId);
    if (!m) {
      m = new Map();
      this.abgeschlossen.set(sessionId, m);
    }
    const bisher = m.get(sprache) ?? { eingabeSek: 0, ausgabeSek: 0, usd: 0 };
    m.set(sprache, {
      eingabeSek: bisher.eingabeSek + v.eingabeSek,
      ausgabeSek: bisher.ausgabeSek + v.ausgabeSek,
      usd: bisher.usd + bridge.kostenUsd,
    });
    console.log(
      `[SessionManager] Kosten verbucht ${sprache}: ${Math.round(v.eingabeSek)} s ein, ${Math.round(v.ausgabeSek)} s aus, ~${bridge.kostenUsd.toFixed(2)} USD`
    );
  }

  /** Geschaetzte Kosten der Session, laufende und beendete Bridges zusammen. */
  kostenLesen(sessionId: string): SessionKosten {
    const summe = new Map<string, SprachKosten>();
    for (const [sprache, k] of this.abgeschlossen.get(sessionId) ?? []) {
      summe.set(sprache, { sprache, ...k, laeuft: false });
    }
    for (const [sprache, bridge] of this.translations.get(sessionId) ?? []) {
      if (this.verbucht.has(bridge)) continue;
      const v = bridge.verbrauch;
      const bisher = summe.get(sprache) ?? { sprache, eingabeSek: 0, ausgabeSek: 0, usd: 0, laeuft: false };
      summe.set(sprache, {
        sprache,
        eingabeSek: bisher.eingabeSek + v.eingabeSek,
        ausgabeSek: bisher.ausgabeSek + v.ausgabeSek,
        usd: bisher.usd + bridge.kostenUsd,
        laeuft: bridge.status === "active",
      });
    }
    const sprachen = Array.from(summe.values()).sort((a, b) => b.usd - a.usd);
    return {
      sprachen,
      gesamtUsd: sprachen.reduce((s, k) => s + k.usd, 0),
      eurKurs: eurKurs(),
    };
  }

  private stoerungMerken(sessionId: string, sprache: string, s: Stoerung): void {
    let m = this.stoerungen.get(sessionId);
    if (!m) {
      m = new Map();
      this.stoerungen.set(sessionId, m);
    }
    m.set(sprache, s);
  }

  private stoerungLoeschen(sessionId: string, sprache: string): void {
    const m = this.stoerungen.get(sessionId);
    if (!m) return;
    m.delete(sprache);
    if (m.size === 0) this.stoerungen.delete(sessionId);
  }

  private constructor() {}

  static getInstance(): TranslationSessionManager {
    if (!globalForSessionManager.sessionManagerInstance) {
      globalForSessionManager.sessionManagerInstance = new TranslationSessionManager();
    }
    return globalForSessionManager.sessionManagerInstance;
  }

  // Session management
  createSession(
    sessionId: string,
    organizerIdentity: string,
    allowedLanguages?: string[],
    systemInstruction?: string
  ): SessionInfo {
    const info: SessionInfo = {
      sessionId,
      organizerIdentity,
      createdAt: new Date(),
      allowedLanguages,
      systemInstruction,
    };
    this.sessions.set(sessionId, info);
    console.log(
      `[SessionManager] Created session ${sessionId} for organizer ${organizerIdentity} with allowed languages: ${allowedLanguages?.join(", ") || "all"}${systemInstruction ? `, systemInstruction: "${systemInstruction.slice(0, 50)}..."` : ""}`
    );
    return info;
  }

  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  // Translation management
  async getOrCreate(
    sessionId: string,
    targetLanguage: string,
    organizerIdentity: string
  ): Promise<TranslationBridge> {
    // Check if we already have a bridge for this language
    let languageMap = this.translations.get(sessionId);
    if (languageMap) {
      const existingBridge = languageMap.get(targetLanguage);
      if (existingBridge && existingBridge.status === "active") {
        console.log(
          `[SessionManager] Reusing existing bridge for ${targetLanguage} in session ${sessionId}`
        );
        existingBridge.subscriberCount++;
        return existingBridge;
      }
      // If bridge exists but is in error/closed state, clean it up
      if (existingBridge && (existingBridge.status === "error" || existingBridge.status === "closed")) {
        console.log(
          `[SessionManager] Cleaning up stale bridge for ${targetLanguage}`
        );
        this.verbuchen(sessionId, targetLanguage, existingBridge);
        await existingBridge.stop();
        languageMap.delete(targetLanguage);
      }
    }

    // Bekannte endgueltige Stoerung: innerhalb der Schonfrist nicht erneut bei
    // Gemini anklopfen. Am 2026-10-04 erzeugten wiederholte Anforderungen rund
    // 500 abgelehnte Anfragen.
    const bekannt = this.stoerungen.get(sessionId)?.get(targetLanguage);
    if (
      bekannt &&
      bekannt.art === "endgueltig" &&
      Date.now() - bekannt.zuletzt < SCHONFRIST_MS
    ) {
      throw new StoerungsFehler(bekannt);
    }

    // Create a new bridge
    console.log(
      `[SessionManager] Creating new bridge for ${targetLanguage} in session ${sessionId}`
    );

    const session = this.getSession(sessionId);

    const config = {
      geminiApiKey: process.env.GEMINI_API_KEY!,
      // LIVEKIT_URL ist die Adresse aus Sicht des Besucher-Handys und wird in
      // api/token an den Browser gereicht. Die Bridge laeuft dagegen
      // serverseitig: Liegt LiveKit im selben Docker-Netz, erreicht sie es
      // direkt unter seinem Dienstnamen.
      //
      // Ohne diese Trennung muesste der Container die oeffentliche Adresse
      // aufloesen und ueber den Reverse Proxy zurueckfinden. Das scheitert auf
      // vielen Routern an fehlendem NAT-Hairpin - und zwar erst zur Laufzeit,
      // wenn der erste Hoerer eine Sprache waehlt.
      //
      // Ist LIVEKIT_URL_INTERNAL nicht gesetzt, bleibt das Verhalten exakt wie
      // bisher. Fuer LiveKit Cloud aendert sich dadurch nichts.
      livekitUrl:
        process.env.LIVEKIT_URL_INTERNAL ||
        process.env.LIVEKIT_URL ||
        "ws://localhost:7880",
      livekitApiKey: process.env.LIVEKIT_API_KEY!,
      livekitApiSecret: process.env.LIVEKIT_API_SECRET!,
      systemInstruction: session?.systemInstruction,
    };

    const bridge = new TranslationBridge(
      sessionId,
      targetLanguage,
      organizerIdentity,
      config
    );

    bridge.onStoerung = (s) => this.stoerungMerken(sessionId, targetLanguage, s);
    bridge.onWiederhergestellt = () => this.stoerungLoeschen(sessionId, targetLanguage);

    bridge.onStop = () => {
      this.verbuchen(sessionId, targetLanguage, bridge);
      const languageMap = this.translations.get(sessionId);
      if (languageMap) {
        languageMap.delete(targetLanguage);
        if (languageMap.size === 0) {
          this.translations.delete(sessionId);
          console.log(
            `[SessionManager] Cleaned up active translations for session ${sessionId} as all translation bridges stopped.`
          );
        }
      }
    };

    // Store the bridge before starting (to prevent race conditions)
    if (!languageMap) {
      languageMap = new Map();
      this.translations.set(sessionId, languageMap);
    }
    languageMap.set(targetLanguage, bridge);

    try {
      await bridge.start();
      bridge.subscriberCount = 1;
      this.stoerungLoeschen(sessionId, targetLanguage);
      return bridge;
    } catch (error) {
      // Clean up on failure
      languageMap.delete(targetLanguage);

      // Grund festhalten, damit die Sendeseite ihn anzeigen kann.
      const { code, grund } = ausFehler(error);
      const vorher = this.stoerungen.get(sessionId)?.get(targetLanguage);
      const jetzt = Date.now();
      const stoerung: Stoerung = {
        code,
        grund,
        text: klartext(code, grund),
        art: klassifiziere(code, grund),
        seit: vorher?.seit ?? jetzt,
        zuletzt: jetzt,
        versuche: (vorher?.versuche ?? 0) + 1,
      };
      this.stoerungMerken(sessionId, targetLanguage, stoerung);
      console.error(
        `[SessionManager] STOERUNG beim Start von ${targetLanguage}: ${stoerung.text}`,
        { code, grund, art: stoerung.art, versuche: stoerung.versuche }
      );
      throw error;
    }
  }

  getActiveTranslations(sessionId: string): TranslationInfo[] {
    const languageMap = this.translations.get(sessionId);
    const result: TranslationInfo[] = [];

    for (const [language, bridge] of languageMap ?? []) {
      result.push({
        language,
        translatorIdentity: bridge.identity,
        status: bridge.status,
        subscriberCount: bridge.subscriberCount,
        gesundheit: bridge.gesundheit,
        hoerer: bridge.anzahlHoerer(),
        stoerung: bridge.stoerung,
      });
    }

    // Sprachen, deren Start gescheitert ist, haben keine Bridge mehr - sie
    // sollen trotzdem als gestoert sichtbar sein.
    for (const [language, stoerung] of this.stoerungen.get(sessionId) ?? []) {
      if (languageMap?.has(language)) continue;
      result.push({
        language,
        translatorIdentity: `translator-${language}`,
        status: "error",
        subscriberCount: 0,
        gesundheit: "gestoert",
        hoerer: 0,
        stoerung,
      });
    }
    return result;
  }

  /**
   * Decrement subscriber count for a language. If the last subscriber
   * leaves, stop the bridge and tear down the Gemini session.
   */
  async unsubscribe(
    sessionId: string,
    targetLanguage: string
  ): Promise<void> {
    const languageMap = this.translations.get(sessionId);
    if (!languageMap) return;

    const bridge = languageMap.get(targetLanguage);
    if (!bridge || bridge.status === "closed") return;

    bridge.subscriberCount = Math.max(0, bridge.subscriberCount - 1);
    console.log(
      `[SessionManager] Unsubscribed from ${targetLanguage} in session ${sessionId} (${bridge.subscriberCount} remaining)`
    );

    if (bridge.subscriberCount === 0) {
      languageMap.delete(targetLanguage);
      if (languageMap.size === 0) {
        this.translations.delete(sessionId);
      }

      console.log(
        `[SessionManager] No more subscribers for ${targetLanguage}, tearing down bridge`
      );
      this.verbuchen(sessionId, targetLanguage, bridge);
      bridge.onStop = undefined;
      await bridge.stop();
    }
  }

  async removeTranslation(
    sessionId: string,
    targetLanguage: string
  ): Promise<void> {
    const languageMap = this.translations.get(sessionId);
    if (!languageMap) return;

    const bridge = languageMap.get(targetLanguage);
    if (bridge) {
      this.verbuchen(sessionId, targetLanguage, bridge);
      bridge.onStop = undefined;
      await bridge.stop();
      languageMap.delete(targetLanguage);
      console.log(
        `[SessionManager] Removed bridge for ${targetLanguage} in session ${sessionId}`
      );
    }
  }

  async removeAllTranslations(sessionId: string): Promise<void> {
    // Schlusssumme ins Log, bevor die Session samt Zaehlern verschwindet -
    // auffindbar nach dem Gottesdienst mit: grep KOSTEN
    const kosten = this.kostenLesen(sessionId);
    if (kosten.sprachen.length > 0) {
      console.log(
        `[SessionManager] KOSTEN Session ${sessionId}: ~${kosten.gesamtUsd.toFixed(2)} USD gesamt (` +
          kosten.sprachen
            .map((k) => `${k.sprache} ${Math.round(k.eingabeSek / 60)} min ~${k.usd.toFixed(2)} USD`)
            .join(", ") +
          ")"
      );
    }

    const languageMap = this.translations.get(sessionId);
    if (languageMap) {
      for (const [, bridge] of languageMap) {
        bridge.onStop = undefined;
        await bridge.stop();
      }
      languageMap.clear();
      this.translations.delete(sessionId);
    }
    this.sessions.delete(sessionId);
    this.stoerungen.delete(sessionId);
    this.abgeschlossen.delete(sessionId);
    console.log(
      `[SessionManager] Removed all bridges and session for ${sessionId}`
    );
  }

  getAllSessions(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }
}

export default TranslationSessionManager;
