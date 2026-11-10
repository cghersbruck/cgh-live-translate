"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { normalizeLocale, selectLocale, type UiLocale } from "@/lib/ui-locale";
import { watchMessages } from "@/lib/watch-messages";

// Sprache der Hörerseite. Nur dort eingehängt (watch/layout.tsx).
const storageKey = "cgh-ui-language";
const names: Record<UiLocale, string> = { de: "Deutsch", en: "English", "zh-Hans": "简体中文", es: "Español", ro: "Română", ru: "Русский", hu: "Magyar" };
const Context = createContext<{ locale: UiLocale; setLocale: (locale: UiLocale) => void }>({ locale: "de", setLocale: () => {} });

export function UiLanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<UiLocale>("de");
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(storageKey); } catch { /* storage may be blocked */ }
    const initial = selectLocale(saved, navigator.languages);
    Promise.resolve().then(() => setLocaleState(initial));
  }, []);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const setLocale = useCallback((next: UiLocale) => {
    setLocaleState(next);
    try { localStorage.setItem(storageKey, next); } catch { /* language still works for this page */ }
  }, []);
  return <Context.Provider value={{ locale, setLocale }}>{children}</Context.Provider>;
}

export function useUiLocale() {
  return useContext(Context).locale;
}

export function useUiLanguage() {
  return watchMessages[useUiLocale()];
}

export function UiLanguageSelector() {
  const { locale, setLocale } = useContext(Context);
  return <label className="ui-language">
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-5 5-5 13 0 18M12 3c5 5 5 13 0 18"/></svg>
    <span className="sr-only">{watchMessages[locale].uiLanguage}</span>
    <select className="select-field select-field--small" value={locale} onChange={(event) => setLocale(normalizeLocale(event.target.value))}>
      {Object.entries(names).map(([code, name]) => <option key={code} value={code} lang={code}>{name}</option>)}
    </select>
  </label>;
}
