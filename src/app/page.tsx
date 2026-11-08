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
import { useUiLocale } from "@/components/UiLanguage";
import { homeMessages } from "@/lib/home-messages";
import { SUPPORTED_LANGUAGES } from "@/lib/languages";
import { languageLabel, matchesLanguage } from "@/lib/language-search";
import { reviewMessages } from "@/lib/review-messages";
import { GEMEINDE_LANGUAGES } from "@/config/gemeinde";
import {
  AutostartEinrichtung,
  autostartLaden,
  autostartLoeschen,
  autostartSpeichern,
} from "@/lib/sender-einstellungen";

export default function Home() {
  const router = useRouter();
  const locale = useUiLocale();
  const text = homeMessages[locale];
  const [loading, setLoading] = useState(false);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [password, setPassword] = useState("");
  // Wird beim Laden aus DEFAULT_EVENT_ID vorbelegt (siehe /api/config), damit
  // Links und QR-Codes je Deployment dauerhaft gleich bleiben.
  const [eventId, setEventId] = useState("");
  const [error, setError] = useState<{ kind: "savedPassword" | "createFailed" | "detail"; detail?: string } | null>(null);
  
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

  const filteredLanguages = SUPPORTED_LANGUAGES.filter((lang) =>
    matchesLanguage(lang, locale, langSearch)
  ).sort((a, b) => Number(b.code.toLowerCase() === langSearch.trim().toLowerCase()) - Number(a.code.toLowerCase() === langSearch.trim().toLowerCase()));

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
    let errorKind: "savedPassword" | "createFailed" | "detail" = "detail";
    try {
      // Beim Autostart eine noch laufende Session wiederverwenden (Browser
      // abgestuerzt, Seite neu geoeffnet). Neu anlegen wuerde alle laufenden
      // Uebersetzungen abreissen - die Hoerer saessen ploetzlich im Stillen.
      if (wiederEinsteigen && e.sessionId) {
        const vorhanden = await fetch(`/api/sessions/${encodeURIComponent(e.sessionId)}`);
        if (vorhanden.ok) {
          if (e.passwort) { try { sessionStorage.setItem("broadcast_password", e.passwort); } catch { /* continue without cached password */ } }
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
          errorKind = "savedPassword";
          throw new Error();
        }
        if (!data.error) errorKind = "createFailed";
        throw new Error(data.error || "");
      }
      if (merken) {
        autostartSpeichern({ ...e, sessionId: data.sessionId });
      } else {
        autostartLoeschen();
      }
      // Upstream setzte das nur bei passwordRequired. Beim Autostart ist der
      // Status womoeglich noch nicht geladen; ein leeres Passwort bleibt weg.
      if (e.passwort) {
        try { sessionStorage.setItem("broadcast_password", e.passwort); } catch { /* continue without cached password */ }
      }
      router.push(`/session/${data.sessionId}/broadcast`);
    } catch (err) {
      console.error("Failed to create session:", err);
      setError({ kind: errorKind, detail: (err as Error).message });
      setLoading(false);
      setAutostart((a) => (a === "laeuft" ? "angehalten" : a));
    }
  }

  if (autostart === "laeuft") {
    return (
      <div className="page">
        <div className="container" style={{ textAlign: "center" }}>
          <div className="spinner" style={{ margin: "0 auto 16px" }} />
          <p className="body-sm">{text.starting}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page page-top">
      <div className="home">
        {/* Title */}
        <div className="home-head">
          <h1 className="display display-xl enter" style={{ marginBottom: 12 }}>
            {text.title}
          </h1>

          {/* Subtitle */}
          <p
            className="body enter-d1"
            style={{ maxWidth: 380 }}
          >
            {text.subtitle}
          </p>
        </div>

        <div className="home-grid">
          {/* So läuft die Übertragung */}
          <div className="home-steps enter-d3">
            {[
              {
                titel: text.micTitle,
                text: text.micDescription,
              },
              {
                titel: text.qrTitle,
                text: text.qrDescription,
              },
              {
                titel: text.languageTitle,
                text: text.languageDescription,
              },
            ].map((schritt, index) => (
              <div key={schritt.titel} style={{ display: "grid", gridTemplateColumns: "2rem 1fr", columnGap: 8 }}>
                <span style={{ gridRow: "span 2", fontWeight: 700, color: "var(--accent)" }}>{index + 1}.</span>
                <p style={{ margin: 0, fontWeight: 600, fontSize: 15, color: "var(--fg)" }}>
                  {schritt.titel}
                </p>
                <p className="body-sm" style={{ color: "var(--fg-secondary)", margin: "2px 0 0" }}>
                  {schritt.text}
                </p>
              </div>
            ))}

            <div className="panel" style={{ background: "var(--bg-elevated)" }}>
              <p className="body-sm" style={{ color: "var(--fg-secondary)", margin: 0 }}>
                {text.privacy}
              </p>
            </div>
          </div>

          <div className="home-form">

        <div
          className="enter-d2"
          style={{
            maxWidth: 360,
            margin: "0 auto 20px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            textAlign: "left",
          }}
        >
          {passwordRequired && (
            <input
              type="password"
              className="input-field"
              placeholder={text.password}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              aria-label={text.password}
            />
          )}
          <input
            type="text"
            className="input-field"
            placeholder={text.eventId}
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            disabled={loading}
            aria-label={text.eventId}
          />
          <textarea
            className="input-field"
            placeholder={text.instructions}
            value={systemInstruction}
            onChange={(e) => setSystemInstruction(e.target.value)}
            rows={3}
            style={{ resize: "vertical", minHeight: "72px", fontSize: "14px" }}
            disabled={loading}
            aria-label={text.instructions}
          />

          {/* Allowlisting control */}
          <div style={{ marginTop: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "14px", color: "var(--fg-secondary)", fontWeight: 500 }}>
              <input
                type="checkbox"
                checked={restrictLanguages}
                onChange={(e) => {
                  setRestrictLanguages(e.target.checked);
                }}
                style={{ accentColor: "var(--accent)", width: 16, height: 16, cursor: "pointer" }}
              />
              {text.restrict}
            </label>

            {restrictLanguages && (
              <div className="enter" style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                {/* Chip container to show selected languages at a glance */}
                {selectedLanguages.length > 0 && (
                  <div style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "6px",
                    paddingBottom: "4px",
                  }}>
                    {selectedLanguages.map((code) => {
                      const lang = SUPPORTED_LANGUAGES.find((l) => l.code === code);
                      if (!lang) return null;
                      return (
                        <button
                          key={code}
                          type="button"
                          onClick={() => setSelectedLanguages((prev) => prev.filter((c) => c !== code))}
                          className="lang-chip"
                          title={text.removeLanguage}
                          aria-label={`${languageLabel(lang, locale)}: ${text.removeLanguage}`}
                        >
                          <span aria-hidden="true">{lang.flag}</span>
                          <span>{languageLabel(lang, locale)}</span>
                          <span aria-hidden="true" style={{ opacity: 0.55, fontWeight: 700 }}>×</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                <input
                  type="text"
                  placeholder={text.search}
                  className="input-field"
                  value={langSearch}
                  onChange={(e) => setLangSearch(e.target.value)}
                  style={{ padding: "9px 12px", fontSize: "14px" }}
                  aria-label={text.search}
                />

                <div style={{
                  maxHeight: "168px",
                  overflowY: "auto",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  padding: "8px",
                  background: "var(--surface)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2
                }}>
                  {filteredLanguages.length === 0 ? (
                    <span style={{ fontSize: "13px", color: "var(--fg-tertiary)", padding: "4px" }}>{text.noLanguage}</span>
                  ) : (
                    filteredLanguages.map(lang => {
                      const isChecked = selectedLanguages.includes(lang.code);
                      return (
                        <label key={lang.code} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: "14px", padding: "4px 6px", borderRadius: 6, background: isChecked ? "var(--accent-soft)" : "transparent", color: isChecked ? "var(--accent-ink)" : "var(--fg)" }}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              setSelectedLanguages(prev =>
                                isChecked ? prev.filter(c => c !== lang.code) : [...prev, lang.code]
                              );
                            }}
                            style={{ accentColor: "var(--accent)", width: 15, height: 15 }}
                          />
                          <span aria-hidden="true">{lang.flag}</span> {languageLabel(lang, locale)}
                        </label>
                      );
                    })
                  )}
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", color: "var(--fg-tertiary)" }}>
                  <span className="meta">{selectedLanguages.length} {text.selected}</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => setSelectedLanguages(SUPPORTED_LANGUAGES.map(l => l.code))}
                      style={{ background: "none", border: "none", color: "var(--fg-secondary)", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3, fontSize: "13px", fontFamily: "inherit" }}
                    >
                      {text.all}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedLanguages([])}
                      style={{ background: "none", border: "none", color: "var(--fg-secondary)", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3, fontSize: "13px", fontFamily: "inherit" }}
                    >
                      {text.none}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Error message */}
        {error && (
          <p className="body-sm enter-d2 notice notice--error" style={{ margin: "0 0 20px" }} role="alert">
            {error.kind === "detail" ? `${text.createFailed}: ${error.detail}` : text[error.kind]}
          </p>
        )}

        {/* Eingerichteter Sende-PC, Autostart diesmal nicht ausgeloest */}
        {autostart === "angehalten" && (
          <div
            className="enter-d2 panel"
            style={{
              margin: "0 0 20px",
              fontSize: "13.5px",
              textAlign: "left",
              color: "var(--fg-secondary)",
            }}
          >
            <p style={{ margin: "0 0 8px" }}>
              {text.autostartSet}
            </p>
            <button
              type="button"
              onClick={() => {
                autostartLoeschen();
                setMerken(false);
                setAutostart("aus");
              }}
              disabled={loading}
              style={{ background: "none", border: "none", color: "var(--fg-secondary)", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3, fontSize: "13px", fontFamily: "inherit" }}
            >
              {text.removeSetup}
            </button>
          </div>
        )}

        {/* Opt-in: Nur auf dem Sende-PC setzen - das Passwort liegt dann im Browser. */}
        <div className="enter-d2" style={{ margin: "0 0 24px", textAlign: "left" }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: "14px", color: "var(--fg-secondary)" }}>
            <input
              type="checkbox"
              checked={merken}
              onChange={(e) => setMerken(e.target.checked)}
              style={{ accentColor: "var(--accent)", cursor: "pointer", marginTop: 3, width: 16, height: 16 }}
              disabled={loading}
            />
            <span>
              {text.remember}
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
                <span className="spinner" /> {text.creating}
              </>
            ) : (
              text.start
            )}
          </button>
        </div>
        </div>
      </div>

      {/* Footer */}
      <p className="meta enter-d4" style={{ marginTop: 48 }}>
        {reviewMessages[locale].powered} Gemini Live API + LiveKit
      </p>
      </div>
    </div>
  );
}
