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

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { SUPPORTED_LANGUAGES } from "@/lib/languages";
import { GEMEINDE_LANGUAGES } from "@/config/gemeinde";
import {
  AutostartEinrichtung,
  autostartLaden,
  autostartLoeschen,
  autostartSpeichern,
} from "@/lib/sender-einstellungen";

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [password, setPassword] = useState("");
  // Wird beim Laden aus DEFAULT_EVENT_ID vorbelegt (siehe /api/config), damit
  // Links und QR-Codes je Deployment dauerhaft gleich bleiben.
  const [eventId, setEventId] = useState("");
  const [error, setError] = useState<string | null>(null);
  
  const [restrictLanguages, setRestrictLanguages] = useState(true);
  // Vorauswahl, keine Festlegung: Die vollstaendige Liste bleibt hier
  // auswaehlbar, und was hier ausgewaehlt ist, bekommen die Hoerer angeboten.
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([
    ...GEMEINDE_LANGUAGES,
  ]);
  const [langSearch, setLangSearch] = useState("");
  const [systemInstruction, setSystemInstruction] = useState("");
  // Autostart (siehe ANPASSUNGEN.md). "laeuft": Session wird gerade
  // automatisch gestartet. "angehalten": eingerichtet, aber diesmal nicht
  // ausgeloest - nach "End broadcast" oder mit ?einrichten.
  const [autostart, setAutostart] = useState<"aus" | "laeuft" | "angehalten">("aus");
  const [merken, setMerken] = useState(false);

  const filteredLanguages = SUPPORTED_LANGUAGES.filter(lang => 
    lang.name.toLowerCase().includes(langSearch.toLowerCase()) ||
    lang.code.toLowerCase().includes(langSearch.toLowerCase())
  );

  useEffect(() => {
    async function checkAuthStatus() {
      try {
        const res = await fetch("/api/auth/status");
        const data = await res.json();
        setPasswordRequired(data.passwordRequired);
      } catch (err) {
        console.error("Failed to check auth status:", err);
      }
    }
    checkAuthStatus();

    // Vorbelegung der Event-ID aus der Container-Umgebung. Nur setzen, wenn
    // das Feld noch leer ist - wer schneller tippt, wird nicht ueberschrieben.
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: { standardEventId?: string }) => {
        if (c.standardEventId) {
          setEventId((bisher) => (bisher === "" ? c.standardEventId! : bisher));
        }
      })
      .catch(() => {
        // Ohne Vorbelegung funktioniert die Seite wie im Upstream.
      });

    // Eingerichteter Sende-PC: Formular mit der gespeicherten Einrichtung
    // fuellen und direkt in die Sendeseite starten. Nicht nach "End
    // broadcast" (?beendet) - sonst kaeme man nie mehr heraus - und nicht mit
    // ?einrichten, um die Einrichtung zu aendern.
    const gespeichert = autostartLaden();
    if (gespeichert) {
      const params = new URLSearchParams(window.location.search);
      const unterdrueckt = params.has("beendet") || params.has("einrichten");
      Promise.resolve().then(() => {
        setPassword(gespeichert.passwort);
        setEventId(gespeichert.eventId);
        setRestrictLanguages(gespeichert.sprachen !== null);
        if (gespeichert.sprachen) setSelectedLanguages(gespeichert.sprachen);
        setSystemInstruction(gespeichert.systemInstruction);
        setMerken(true);
        if (unterdrueckt) {
          setAutostart("angehalten");
        } else {
          setAutostart("laeuft");
          sessionStarten(gespeichert, { merken: true, wiederEinsteigen: true });
        }
      });
    }
    // sessionStarten liest nur seine Argumente; einmal beim Laden genuegt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function formularWerte(): AutostartEinrichtung {
    return {
      passwort: password,
      eventId,
      sprachen: restrictLanguages ? selectedLanguages : null,
      systemInstruction,
      sessionId: "",
    };
  }

  async function sessionStarten(
    e: AutostartEinrichtung,
    { merken, wiederEinsteigen }: { merken: boolean; wiederEinsteigen: boolean }
  ) {
    setLoading(true);
    setError(null);
    try {
      // Beim Autostart eine noch laufende Session wiederverwenden (Browser
      // abgestuerzt, Seite neu geoeffnet). Neu anlegen wuerde alle laufenden
      // Uebersetzungen abreissen - die Hoerer saessen ploetzlich im Stillen.
      if (wiederEinsteigen && e.sessionId) {
        const vorhanden = await fetch(`/api/sessions/${encodeURIComponent(e.sessionId)}`);
        if (vorhanden.ok) {
          if (e.passwort) sessionStorage.setItem("broadcast_password", e.passwort);
          router.push(`/session/${e.sessionId}/broadcast`);
          return;
        }
      }

      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizerName: "host",
          password: e.passwort,
          eventId: e.eventId,
          allowedLanguages: e.sprachen ?? undefined,
          systemInstruction: e.systemInstruction.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401 && wiederEinsteigen) {
          throw new Error("Gespeichertes Passwort wurde abgelehnt. Bitte neu eingeben und starten.");
        }
        throw new Error(data.error || "Failed to create session");
      }
      if (merken) {
        autostartSpeichern({ ...e, sessionId: data.sessionId });
      } else {
        autostartLoeschen();
      }
      // Upstream setzte das nur bei passwordRequired. Beim Autostart ist der
      // Status womoeglich noch nicht geladen; ein leeres Passwort bleibt weg.
      if (e.passwort) {
        sessionStorage.setItem("broadcast_password", e.passwort);
      }
      router.push(`/session/${data.sessionId}/broadcast`);
    } catch (err) {
      console.error("Failed to create session:", err);
      setError((err as Error).message);
      setLoading(false);
      setAutostart((a) => (a === "laeuft" ? "angehalten" : a));
    }
  }

  if (autostart === "laeuft") {
    return (
      <div className="page">
        <div className="container" style={{ textAlign: "center" }}>
          <div className="spinner" style={{ margin: "0 auto 16px" }} />
          <p className="body-sm">Übertragung wird automatisch gestartet …</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container" style={{ textAlign: "center" }}>
        {/* Title */}
        <h1 className="display display-xl enter" style={{ marginBottom: 24 }}>
          <em>Live</em> Translate
        </h1>

        {/* Subtitle */}
        <p
          className="body enter-d1"
          style={{ maxWidth: 340, margin: "0 auto 48px" }}
        >
          Broadcast your voice. Attendees choose their language.
          Translation spins up on demand.
        </p>

        {/* Inputs */}
        <div
          className="enter-d2"
          style={{
            maxWidth: 340,
            margin: "0 auto 20px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {passwordRequired && (
            <input
              type="password"
              className="input-field"
              placeholder="Enter broadcast password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ textAlign: "center" }}
              disabled={loading}
            />
          )}
          <input
            type="text"
            className="input-field"
            placeholder="Event ID (optional, e.g. weekly-sync)"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            style={{ textAlign: "center" }}
            disabled={loading}
          />
          <textarea
            className="input-field"
            placeholder="Custom system instructions (optional, e.g. terminology, tone, context)"
            value={systemInstruction}
            onChange={(e) => setSystemInstruction(e.target.value)}
            rows={3}
            style={{ resize: "vertical", minHeight: "72px", fontSize: "13px" }}
            disabled={loading}
          />

          {/* Allowlisting control */}
          <div style={{ textAlign: "left", marginTop: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "13px", color: "var(--fg-secondary)" }}>
              <input
                type="checkbox"
                checked={restrictLanguages}
                onChange={(e) => {
                  setRestrictLanguages(e.target.checked);
                }}
                style={{ accentColor: "var(--fg)", cursor: "pointer" }}
              />
              Restrict attendee languages
            </label>

            {restrictLanguages && (
              <div className="enter" style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                {/* Chip container to show selected languages at a glance */}
                {selectedLanguages.length > 0 && (
                  <div style={{ 
                    display: "flex", 
                    flexWrap: "wrap", 
                    gap: "6px", 
                    marginBottom: "4px",
                    padding: "8px",
                    border: "1px dashed var(--border)",
                    background: "var(--bg-elevated)" 
                  }}>
                    {selectedLanguages.map((code) => {
                      const lang = SUPPORTED_LANGUAGES.find((l) => l.code === code);
                      if (!lang) return null;
                      return (
                        <div
                          key={code}
                          onClick={() => setSelectedLanguages((prev) => prev.filter((c) => c !== code))}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            background: "var(--bg)",
                            border: "1px solid var(--border)",
                            padding: "3px 6px",
                            fontSize: "11px",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                          title="Click to remove"
                        >
                          <span>{lang.flag}</span>
                          <span style={{ color: "var(--fg-secondary)" }}>{lang.name}</span>
                          <span style={{ marginLeft: "2px", opacity: 0.5, fontWeight: "bold" }}>×</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                <input
                  type="text"
                  placeholder="Search languages..."
                  className="input-field"
                  value={langSearch}
                  onChange={(e) => setLangSearch(e.target.value)}
                  style={{ padding: "8px 12px", fontSize: "13px" }}
                />
                
                <div style={{ 
                  maxHeight: "130px", 
                  overflowY: "auto", 
                  border: "1px solid var(--border)", 
                  padding: "8px", 
                  background: "var(--bg-elevated)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6
                }}>
                  {filteredLanguages.length === 0 ? (
                    <span style={{ fontSize: "12px", color: "var(--fg-tertiary)" }}>No languages found</span>
                  ) : (
                    filteredLanguages.map(lang => {
                      const isChecked = selectedLanguages.includes(lang.code);
                      return (
                        <label key={lang.code} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "13px" }}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              setSelectedLanguages(prev => 
                                isChecked ? prev.filter(c => c !== lang.code) : [...prev, lang.code]
                              );
                            }}
                            style={{ accentColor: "var(--fg)" }}
                          />
                          <span>{lang.flag} {lang.name}</span>
                        </label>
                      );
                    })
                  )}
                </div>
                
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--fg-tertiary)" }}>
                  <span>{selectedLanguages.length} selected</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button 
                      type="button" 
                      onClick={() => setSelectedLanguages(SUPPORTED_LANGUAGES.map(l => l.code))}
                      style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", textDecoration: "underline" }}
                    >
                      Select all
                    </button>
                    <button 
                      type="button" 
                      onClick={() => setSelectedLanguages([])}
                      style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", textDecoration: "underline" }}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Error message */}
        {error && (
          <p className="body-sm enter-d2" style={{ color: "var(--error)", marginBottom: 20 }}>
            {error}
          </p>
        )}

        {/* Eingerichteter Sende-PC, Autostart diesmal nicht ausgeloest */}
        {autostart === "angehalten" && (
          <div
            className="enter-d2"
            style={{
              maxWidth: 340,
              margin: "0 auto 20px",
              padding: "12px 16px",
              border: "1px solid var(--border)",
              background: "var(--bg-elevated)",
              fontSize: "13px",
            }}
          >
            <p style={{ margin: "0 0 8px" }}>
              Automatischer Start ist auf diesem PC eingerichtet.
            </p>
            <button
              type="button"
              onClick={() => {
                autostartLoeschen();
                setMerken(false);
                setAutostart("aus");
              }}
              disabled={loading}
              style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", textDecoration: "underline", fontSize: "12px" }}
            >
              Einrichtung entfernen
            </button>
          </div>
        )}

        {/* Opt-in: Nur auf dem Sende-PC setzen - das Passwort liegt dann im Browser. */}
        <div className="enter-d2" style={{ maxWidth: 340, margin: "0 auto 20px", textAlign: "left" }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", fontSize: "13px", color: "var(--fg-secondary)" }}>
            <input
              type="checkbox"
              checked={merken}
              onChange={(e) => setMerken(e.target.checked)}
              style={{ accentColor: "var(--fg)", cursor: "pointer", marginTop: 2 }}
              disabled={loading}
            />
            <span>
              Auf diesem PC merken und beim Öffnen automatisch starten.
              Nur am Sende-PC — das Passwort wird im Browser gespeichert.
            </span>
          </label>
        </div>

        {/* CTA */}
        <div className="enter-d2">
          <button
            className="btn btn-dark"
            onClick={() =>
              // Von Hand angelegt wird wie im Upstream immer neu - so lassen
              // sich geaenderte Sprachen oder Anweisungen uebernehmen.
              sessionStarten(formularWerte(), { merken, wiederEinsteigen: false })
            }
            disabled={loading}
            id="create-session-btn"
          >
            {loading ? (
              <>
                <span className="spinner" /> Creating…
              </>
            ) : (
              "Create session"
            )}
          </button>
        </div>

        {/* Steps */}
        <div
          className="enter-d3"
          style={{
            marginTop: 80,
            display: "flex",
            flexDirection: "column",
            gap: 0,
            textAlign: "left",
          }}
        >
          <hr className="rule" />
          {[
            "Speak into your microphone — your audio goes live",
            "Share the QR code with your audience",
            "Each language picked spins up one Gemini session",
          ].map((text, i) => (
            <div key={i}>
              <div
                style={{
                  display: "flex",
                  gap: 16,
                  padding: "18px 0",
                  alignItems: "baseline",
                }}
              >
                <span className="mono" style={{ flexShrink: 0 }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <p className="body-sm" style={{ color: "var(--fg-secondary)" }}>
                  {text}
                </p>
              </div>
              <hr className="rule" />
            </div>
          ))}
        </div>

        {/* Footer */}
        <p className="mono enter-d4" style={{ marginTop: 48 }}>
          Powered by Gemini Live API + LiveKit
        </p>
      </div>
    </div>
  );
}
