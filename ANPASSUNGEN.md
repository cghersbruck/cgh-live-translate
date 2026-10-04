# Anpassungen gegenüber dem Upstream

Dieses Dokument richtet sich an den **nächsten Entwickler** und an alle, die
später ein `git pull` vom Upstream machen wollen.

Upstream: <https://github.com/google-gemini/gemini-live-translate-livekit>
Basis-Commit: `26d9a62`
Arbeitsbranch: `gemeinde` — `main` bleibt unverändert auf Upstream-Stand.

Grundsatz: minimal-invasive Diffs. Jede Änderung unten hat eine Begründung.
Was suboptimal erscheint, aber funktioniert, wurde notiert statt umgebaut.

---

## Stand

Phase 1 ist abgeschlossen. **Phase 2 (T-01 bis T-08) ist bewusst noch nicht
begonnen:** Zuerst läuft T-10 am unveränderten Upstream, weil das der einzige
Test ist, der das Projekt kippen kann, und weil er so eine saubere
Vergleichsbasis für alle späteren Änderungen liefert.

| Was | Stand |
| :--- | :--- |
| Repo geklont, Branch `gemeinde` | ✅ |
| Node 22.23.2, Abhängigkeiten installiert | ✅ |
| Baseline-Build des unveränderten Upstream | ✅ grün |
| Smoke-Test, serverseitig | ✅ bestanden (siehe `TESTPROTOKOLL.md`) |
| Smoke-Test, Audioweg im Browser | offen — wird im ersten T-10-Lauf abgehakt |
| T-10 (Go/No-go) | vorbereitet, Durchführung steht aus |
| Phase 2 | nicht begonnen |

---

## Geänderte und neue Dateien

| Datei | Art | Begründung |
| :--- | :--- | :--- |
| `src/config/gemeinde.ts` | **neu** | Gemeinde-spezifische Sprachliste, native Anzeigenamen und feste Session-ID. Bewusst eine eigene Datei, damit `src/lib/languages.ts` (Upstream) unangetastet bleibt. Noch von nichts importiert — wird in T-05/T-06 verdrahtet. |
| `.env.local` | **neu, nicht im Git** | Lokale Konfiguration. Durch `.gitignore` (`.env*`) ausgeschlossen. |
| `ANPASSUNGEN.md` | **neu** | Dieses Dokument. |
| `TESTPROTOKOLL.md` | **neu** | Testprotokoll und Ergebnisse. Enthält den Ablauf für T-10. |
| `T10-BEWERTUNGSBOGEN.md` | **neu** | Einseitiger Bogen zum Ausdrucken für die Muttersprachler in T-10. |
| `scripts/testlauf.mjs` | **neu** | Startet den Server für Testläufe. Next schreibt keine Zeitstempel — ohne die lässt sich „Laufzeit bis zum ersten Reconnect" nicht bestimmen. Erkennt goAway, Reconnects und Audio-Lücken und fasst sie beim Beenden zusammen. **Redigiert außerdem Secrets**, weil die Gemini-WebSocket-URL den API-Key als Query-Parameter enthält und Fehlerobjekte die URL mitführen können — ein Logfile soll gefahrlos weitergegeben werden können. |
| `scripts/demo-sender.mjs` | **neu** | Speist eine Audiodatei direkt als Sender in den LiveKit-Raum ein, statt sie über die Broadcast-Seite per Tab-Audio zu teilen. Wer bewertet, kann nicht gleichzeitig den Browser bedienen und konzentriert zuhören. Wartet auf die Bridge, bevor die Wiedergabe startet, und liefert allen Läufen bitidentisches Material ab derselben Sekunde. |
| `DEPLOYMENT.md` | **neu** | Anleitung für die Bereitstellung per Docker Compose. |
| `.github/workflows/docker.yml` | **neu** | Prüft Typen und Build, baut danach ein Multi-Arch-Image (amd64 + arm64) und veröffentlicht es nach GHCR. Ziel: Auf dem Server genügen `docker-compose.yml` und `.env`. |
| LiveKit-Konfiguration | **in `docker-compose.yml`** | Bewusst keine eigene `livekit.yaml`: LiveKit nimmt die komplette Konfiguration über `LIVEKIT_CONFIG` entgegen, sodass der Stack sich unverändert in Portainer einfügen lässt — ohne Datei auf dem Host. Nebeneffekt: Die Schlüssel stehen nur noch in der `.env` statt doppelt, womit die Fehlerquelle „Schlüssel laufen auseinander" entfällt. Enthält UDP-Multiplexing auf einem Port statt des Standardbereichs 50000-60000. |
| `src/lib/translation-session-manager.ts` | **geändert** | `LIVEKIT_URL_INTERNAL` als Vorrang vor `LIVEKIT_URL` für die serverseitige Bridge. Bei lokalem LiveKit sind Browser-Adresse und Server-Adresse nicht mehr dieselbe; ohne die Trennung scheitert die Bridge an fehlendem NAT-Hairpin. Ist die Variable nicht gesetzt, bleibt das Verhalten unverändert — LiveKit Cloud ist nicht betroffen. |
| `docker-compose.yml` | **neu** | Bereitstellung aus dem fertigen Image. Enthält zusätzlich einen abgeschalteten Dienst für selbst gehostetes LiveKit als Ausbaustufe. |
| `.env.example` | **neu** | Vorlage für die `.env` auf dem Server. Enthält keine Werte. |
| `Dockerfile` | **1 Zeile ergänzt** | `ENV HOSTNAME=0.0.0.0`. Docker setzt `HOSTNAME` auf die Container-ID, und der Standalone-Server von Next liest genau diese Variable (`process.env.HOSTNAME \|\| '0.0.0.0'`). Ohne die Zeile bindet er auf den Container-Namen statt auf alle Interfaces. |
| `.dockerignore` | **erweitert** | `.env.local` zu `.env*` verallgemeinert, damit auch `.env` und `.env.production` nie ins Image geraten. `logs` ergänzt. |
| `src/lib/broadcast-control.ts` | **neu** | Zustandsspeicher für die Companion-Fernsteuerung. Nur im Arbeitsspeicher — Befehle sind flüchtig und ergeben nach einem Neustart ohnehin keinen Sinn. |
| `src/app/api/control/route.ts` | **neu** | Steuer-Endpunkt für Companion. GET und POST gleichwertig, weil GET im Generic-HTTP-Modul am einfachsten einzurichten ist. PUT dient der Rückmeldung der Sendeseite. |
| `src/components/CompanionControl.tsx` | **neu** | Holt Befehle ab und meldet den Zustand. Eigene Datei, damit die Upstream-Sendeseite kaum abweicht. |
| `src/components/TonStarten.tsx` | **neu** | T-04: großer Knopf „Ton starten" bei blockierter Wiedergabe. Bewusst nicht die mitgelieferte `StartAudio`-Komponente — die steuert ihr `style.display` selbst und lässt sich nicht bildschirmfüllend einbetten. Setzt stattdessen auf `canPlaybackAudio`, `startAudio()` und `AudioPlaybackStatusChanged`. |
| `COMPANION.md` | **neu** | Einrichtung der Companion-Tasten. |
| `src/app/session/[id]/broadcast/page.tsx` | **geändert** | Drei Eingriffe: (1) T-01 — `getUserMedia` bekommt explizite Vorgaben, weil Chrome bei `audio: true` Echo-Unterdrückung, Rauschfilter und Auto-Aussteuerung einschaltet und die auf einem gemischten Pultsignal schaden; das Ergebnis wird per `getSettings()` gegengeprüft, da Chrome die Vorgaben bei manchen Treibern ignoriert. (2) Pause-Zustand, eingehängt in den vorhandenen Mute-Sync-Effekt — separat stummzuschalten hätte nicht funktioniert, da der Effekt es wieder aufgehoben hätte. (3) Einbindung von `CompanionControl`. |
| `src/app/session/[id]/watch/page.tsx` | **geändert** | T-05: vollständig deutsche Oberfläche; technische Fehlermeldungen werden nicht mehr roh an Besucher durchgereicht. Einbindung von `TonStarten`. |
| `src/app/session/[id]/watch/components/LanguageSelector.tsx` | **geändert** | T-05: native Anzeigenamen, deutsche Texte und Fehlermeldungen. Die Sprachauswahl selbst folgt weiter dem Upstream-Verhalten — maßgeblich ist allein, was beim Anlegen der Session freigegeben wurde. |
| `src/app/page.tsx` | **geändert** | Vorauswahl der Sprachen beim Anlegen einer Session auf `GEMEINDE_LANGUAGES` umgestellt (Upstream hatte dort ebenfalls eine feste Liste: en, zh-Hans, hi, es, fr, ar, bn, pt-BR, ru, ur). |
| `README.md` | **ersetzt** | Eigenes README für Installation, Konfiguration und Nutzung. Das englische Original liegt unverändert als `README.upstream.md` bei. |
| `src/lib/gemini-stoerung.ts` | **neu** | Einstufung von Gemini-Abbrüchen in endgültig, vorübergehend und unklar — anhand von Close-Code **und** Grundtext, weil Google den eigentlichen Grund als Klartext in Code 1011 transportiert. Dazu deutscher Klartext für die Sendeseite. |
| `src/lib/translation-bridge.ts` | **geändert (Ausfallerkennung)** | Siehe Abschnitt „Ausfallerkennung". Der größte Eingriff in Upstream-Code; begründet durch den Ausfall vom 2026-10-04. Der goAway-/Resumption-Pfad bleibt in seinem Verhalten unverändert. |
| `src/lib/translation-session-manager.ts` | **geändert (Ausfallerkennung)** | Störungsliste je Sprache, die den Abbau der Bridge überlebt; 50-s-Schonfrist nach endgültigem Fehler; Status liefert `gesundheit`, `hoerer` und `stoerung`. |
| `src/app/api/translate/route.ts` | **geändert** | Bekannte Störung innerhalb der Schonfrist → HTTP 503 mit `Retry-After` statt 500 mit Stacktrace. |
| `src/app/session/[id]/watch/page.tsx` (erneut) | **geändert** | Stopp-Knopf „Beenden", Media Session API, Audio Session API, Störungshinweis für Besucher. |
| `src/lib/kosten.ts` | **neu** | Preise des Translate-Modells (Stand 2026-10-04) und Kostenschätzung. Bei Preisänderungen durch Google nur hier anpassen. |
| `scripts/log-auswertung.sh` | **neu** | Fasst ein Container-Log nach dem Gottesdienst zusammen: je Bridge Laufzeit, Audio, geschätzte Kosten, Wiederverbindungen, Fehler. Läuft direkt auf dem Server. |
| `src/lib/translation-bridge.ts` | **geändert (Kosten)** | Exakte Zähler für gesendetes und empfangenes Audio; Pause trennt die Gemini-Verbindung (siehe Abschnitt „Kosten"); Eingangsrate per `GEMINI_INPUT_SAMPLE_RATE` umschaltbar. |
| `.gitignore` | **ergänzt** | `/logs` — Testlauf-Logs gehören nicht ins Repository. Dazu `!.env.example`: Das vorhandene Muster `.env*` hätte sonst auch die Vorlage ausgeschlossen, die eingecheckt werden muss. |

### Bewusst unverändert gelassen

- `src/lib/languages.ts` — die über 70 Sprachen bleiben stehen. Die Einschränkung
  auf die Gemeinde-Auswahl läuft über den vorhandenen `allowedLanguages`-
  Mechanismus, nicht durch Löschen von Einträgen.
- `package-lock.json` — `npm install` hatte nur `peer`-Metadaten umsortiert,
  ohne Versionsänderung. Zurückgesetzt, um den Diff sauber zu halten.

---

## Warum T-01 nur halb umgesetzt ist

T-01 sah ursprünglich ein Dropdown zur Gerätewahl vor. Das ist **entfallen**:
Chrome lässt das Eingangsgerät pro Seite auswählen, und der Sende-PC hat das
Pultsignal bereits als Eingang. Ein eigenes Dropdown wäre doppelte Bedienung
für dieselbe Sache gewesen.

Geblieben ist der Teil, den Chrome **nicht** anbietet: das Abschalten der
Signalaufbereitung. Dafür gibt es in Chrome keine Einstellung, es geht nur beim
Anfordern des Audios.

---

## Ausfallerkennung

**Anlass:** Am 2026-10-04 fiel die Übersetzung gegen Ende des Gottesdienstes
aus, während die Sendeseite „active" zeigte. Ursache laut Log: Code 1011,
„Your prepayment credits are depleted". Das Gemini-Dashboard zeigte danach
rund 500 abgelehnte Anfragen (429/409) in zwei Stunden.

Drei Mängel im Upstream-Code machten aus einem leeren Guthaben einen stillen
Totalausfall:

1. **Der Status log.** `status` wurde nur beim ersten Start gesetzt. Scheiterte
   die Wiederverbindung im Betrieb, blieb er `active`.
2. **Endlosschleife.** Jeder Abbruch wurde wie ein Netzaussetzer behandelt und
   im Sekundentakt wiederholt — auch einer, der sich nie von selbst löst.
3. **Ein ungültiger Resumption-Handle wurde nie verworfen** und bei jedem
   Versuch erneut gesendet.

**Jetzt:**

| Abbruch | Reaktion |
| :--- | :--- |
| `goAway` | Resumption mit Handle — unverändert |
| vorübergehend (1006, Netzfehler, Serverneustart) | Wiederholen nach 1, 2, 5, 10, 20, 30 s, höchstens 2 Minuten |
| endgültig (Guthaben, Kontingent, Schlüssel, Richtlinie) | sofort Störung, kein schnelles Wiederholen |
| Wiederholbudget erschöpft | Störung |
| während einer Störung | ein Versuch pro Minute, **nur solange jemand zuhört**; nach Aufladen läuft es von selbst wieder an |

Nach zwei Fehlschlägen mit Resumption-Handle wird dieser verworfen und frisch
begonnen.

**Gesundheit statt Statusflag.** Abgeleitet aus dem Audiofluss: `gesund`,
`pausiert` (keine Sprache am Eingang), `stockend` (Sprache kommt an, aber seit
20 s keine Übersetzung zurück), `verbindet`, `gestoert`. Sprache wird per
Pegel erkannt (etwa −50 dBFS), damit Stille keinen Fehlalarm auslöst.

**Testschalter:** `GEMINI_TESTSTOERUNG_NACH_S=<Sekunden>` simuliert nach dieser
Zeit einen Abbruch 1011 mit dem Guthaben-Grund. Optional
`GEMINI_TESTSTOERUNG_CODE` und `GEMINI_TESTSTOERUNG_GRUND`. Ohne gesetzte
Variable wirkungslos. **Nie im Produktivbetrieb setzen.**

**Bekannte Upstream-Schwäche, nicht behoben:** Beim Sprachwechsel melden
`LanguageSelector` und die Hörerseite den Hörer beide ab, der
`subscriberCount` kann dadurch doppelt sinken. Für den neuen Stopp-Knopf ist
das abgefangen; der Sprachwechsel selbst gehört zu T-08.

---

## Kosten

Drei Messungen vom 2026-10-04 bestimmen das Kostenmodell:

**1. Bezahlt wird Verbindungszeit, nicht gesprochener Text.** Gemini liefert bei
offener Verbindung durchgehend Audio zurück — auch Stille — und rechnet es als
Ausgabe ab. Die Ausgabe kostet das Sechsfache der Eingabe (21 $ gegenüber 3,50 $
je Mio. Tokens). Kosten ≈ Minuten × Sprachen.

**2. Pause sparte ursprünglich nichts.** Gemessen über 30 s Stummschaltung:

| | Eingabe | Ausgabe |
| :--- | ---: | ---: |
| Upstream-Verhalten | +30,2 s | +30,2 s |
| nur Eingabe gesperrt | +0,2 s | +30,3 s |
| **jetzt: Verbindung nach 5 s getrennt** | **+0,2 s** | **+5,3 s** |

Ein stummer Track liefert weiter Stille-Frames, und die bloße Sperre der
Eingabe genügt nicht. Deshalb trennt die Bridge nach 5 s Pause die
Gemini-Verbindung und baut sie beim Fortsetzen mit Resumption-Handle wieder
auf (1–2 s). Ausgelöst wird das ausschließlich durch den Mute-Zustand des
Sender-Tracks (Pause-Knopf, Companion, Mikrofon aus) — bewusst **keine**
Sprachpausenerkennung, die Satzenden abschneiden könnte.

**3. Die Eingabe wurde mit Faktor 3,0 abgerechnet.** Log-Auswertung:
286 000 Tokens gesendet, Dashboard rund 870 000. Doppelt gesendetes Audio ist
ausgeschlossen (exakt 10,0 Frames/s). Wir senden 48 kHz, Google empfiehlt
16 kHz — 48 : 16 = 3. `GEMINI_INPUT_SAMPLE_RATE=16000` stellt um; LiveKit
rechnet beim Abholen selbst um, am Mischpult ändert sich nichts.
**Voreinstellung bleibt 48 000, bis ein A/B-Test die Annahme bestätigt.** Die
Kostenschätzung rechnet bis dahin mit dem beobachteten Faktor.

**Kostenanzeige** auf der Sendeseite: je Sprache und gesamt, alle 3 s
aktualisiert, inklusive bereits beendeter Bridges. Optional in Euro über
`KOSTEN_USD_EUR`. Beim Beenden der Session schreibt der Server die Schlusssumme
ins Log (`grep KOSTEN`).

---

## Branches und CI

`main` und `gemeinde` zeigen auf denselben Stand. `main` ist der Standardbranch
und liefert den `latest`-Tag des Images; `gemeinde` bleibt als Arbeitsbranch
bestehen. Der ursprüngliche Plan, `main` dauerhaft auf dem reinen
Upstream-Stand zu halten, wurde damit aufgegeben — die Vergleichsbasis liefert
stattdessen das Remote `upstream`, das weiterhin auf das Google-Repository
zeigt (`git diff upstream/main`).

**Lint läuft bewusst nur über `src/config` und `scripts`.** Der Upstream hat 17
offene Lint-Befunde, überwiegend `any`-Typen in `broadcast/page.tsx`,
`watch/page.tsx` und `api/sessions/route.ts`. Sie werden **nicht behoben**: Das
wären Änderungen an Upstream-Dateien, die bei jedem `git pull` vom Upstream
Konflikte erzeugen. Würde das gesamte Projekt gelintet, produzierte jeder
CI-Lauf 17 Annotationen, die niemand mehr liest — und ein echter Fehler in
eigenem Code ginge darin unter. Die **Typprüfung** läuft dagegen unverändert
über das gesamte Projekt; die ist upstream sauber.

---

## Entscheidungen, die den Code betreffen

### LiveKit Cloud ist Entwicklung, nicht Zielarchitektur

Für Entwicklung und Feldtest läuft LiveKit Cloud (Build-Stufe, kostenlos),
weil auf dem Entwicklungsrechner kein Docker installiert ist. **Für den
Regelbetrieb ist selbst gehostetes LiveKit auf der Gemeinde-NAS vorgesehen**
(Apache-2.0, kostenlos).

Daraus folgt eine harte Regel für allen künftigen Code:

> Nichts bauen, was an LiveKit Cloud gebunden ist. Keine Cloud-spezifischen
> APIs, keine Annahmen über TLS-Terminierung, keine hartkodierten URLs.

Der Wechsel ist dann reine Konfiguration — drei Werte in `.env.local`.

**Merksatz:** `LIVEKIT_URL` ist immer die Adresse aus Sicht des
Besucher-Handys, nicht aus Sicht des Servers. Bei Betrieb auf der NAS steht
dort niemals `localhost`.

**Kontingent Build-Stufe:** 5.000 WebRTC-Teilnehmerminuten pro Monat, gezählt
wird jede verbundene Minute jedes Teilnehmers — Hörer, Sender und
Übersetzer-Bots gleichermaßen. Ein Feldtest mit 20 Hörern über eine Stunde
verbraucht rund 1.380 Minuten. Für Entwicklung und zwei bis drei Testläufe mit
Publikum reicht das; darüber hinaus wird nicht abgerechnet, sondern
abgeschaltet.

### Der eigentliche Aufwand des NAS-Umzugs sind die Zertifikate

LiveKit Cloud liefert eine fertige `wss://`-URL. **Beim Umzug auf selbst
gehostetes LiveKit fällt die weg.** Dann brauchen *beide* ein Zertifikat: die
App und der LiveKit-Server. Das ist der eigentliche Aufwand des Umzugs — nicht
das Docker-Setup, das oft dafür gehalten wird.

### Was LiveKit Cloud bei T-07 nicht erledigt

Die `wss://`-URL sichert nur den **Medientransport**. Die App selbst wird
weiterhin von `localhost:3000` ausgeliefert, und genau diese Seite rufen die
Besucher-Handys auf — über die LAN-IP also aus unsicherer Herkunft. T-07
(HTTPS für die App) bleibt davon unberührt bestehen.

Der Gewinn durch Cloud liegt woanders: Der Medienpfad läuft nicht mehr durchs
Gemeindenetz, wodurch **Client-Isolation und VLAN-Trennung im Gäste-WLAN
umgangen** werden. Das ist der Grund, warum Cloud den Feldtest erleichtert —
nicht das Zertifikat.

---

## Datenschutz

Solange LiveKit Cloud genutzt wird, **verlässt Predigtaudio das Gemeindenetz
zweifach**:

1. Das Originalaudio läuft über die LiveKit-Server.
2. Die Übersetzung zusätzlich über Google.

Regions-Pinning bietet LiveKit erst in der höchsten Preisstufe an — eine
Zusicherung auf EU-Verarbeitung ist auf der Build-Stufe **nicht möglich**.

Mit selbst gehostetem LiveKit entfällt der erste Weg wieder. Das ist ein
weiteres Argument für den Umzug nach dem Feldtest.

Unabhängig davon gilt: Bei Gemini Paid Tier werden die Daten nicht zur
Produktverbesserung genutzt, die Verarbeitung findet aber statt. Ein Hinweis
auf der Hörerseite und im Gottesdienst ist angemessen.

---

## Offene Punkte

- **Modell im Preview-Status.** `gemini-3.5-live-translate-preview` — Google
  kann Verhalten, Preise und Verfügbarkeit ändern. Kein Verlass auf
  unveränderte Funktion über Monate. Die Gemeinde sollte einen manuellen
  Plan B für Besucher haben, die auf Übersetzung angewiesen sind.
- **Messergebnisse** aus dem Testprotokoll werden hier ergänzt, sobald die
  Tests gelaufen sind (insbesondere T-03 `contextWindowCompression`,
  T-13 iPhone-Sperrbildschirm, T-16 `systemInstruction`).
