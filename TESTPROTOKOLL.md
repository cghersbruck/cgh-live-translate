# Testprotokoll

Go/No-go-Entscheidung für den sonntäglichen Einsatz der Live-Übersetzung.

Alle Tests laufen im Produktionsmodus (`npm run build`, dann Start über
`scripts/testlauf.mjs`) — **nicht** mit `npm run dev`. Hot Reload startet den
Node-Prozess neu, und der `TranslationSessionManager` ist ein In-Memory-Singleton:
Jeder Reload killt alle laufenden Bridges und alle Sessions.

---

## Testumgebung

| Punkt | Wert |
| :--- | :--- |
| Upstream-Basis | `26d9a62` |
| Branch | `gemeinde` |
| Node | 22.23.2 |
| Next.js | 16.2.6 |
| Modell | `gemini-3.5-live-translate-preview` |
| LiveKit | Cloud, Build-Stufe (Entwicklungsstufe, nicht Zielarchitektur) |
| Code-Stand | **unverändert gegenüber Upstream.** `src/config/gemeinde.ts` existiert, ist aber bewusst noch nirgends eingebunden. |

---

## Smoke-Test (Briefing §1.5)

**Datum:** 2026-09-19 — **Ergebnis: bestanden, mit einer Einschränkung**

Serverseitig automatisiert geprüft:

| Prüfung | Ergebnis |
| :--- | :--- |
| Produktionsbuild des unveränderten Upstream | bestanden, TypeScript fehlerfrei, 11 Routen |
| Startseite erreichbar | bestanden, HTTP 200 |
| Passwortschutz der Sender-Seite | bestanden, falsches Passwort → HTTP 401 |
| Session mit fester `eventId` anlegen | bestanden, ergibt `sessionId: smoketest` (bestätigt den T-06-Mechanismus) |
| LiveKit-Zugangsdaten | bestanden, Raum beigetreten als `translator-en`, Audio-Track veröffentlicht |
| Gemini-Zugangsdaten und Modell | bestanden, WebSocket verbunden, `setupComplete` empfangen |
| `echoTargetLanguage: true` aktiv | bestanden, im gesendeten Setup bestätigt |
| `sessionResumption` im Setup | bestanden, vorhanden |
| Sauberer Abbau | bestanden, WebSocket Code 1000, Raum verlassen, Session entfernt, danach 0 Bridges |

**Einschränkung — noch nicht geprüft:** Der eigentliche Audioweg
(Mikrofon/Tab-Audio → Bridge → Hörer hört Ton) lässt sich nur im Browser
verifizieren und ist daher **nicht** Teil dieses automatisierten Durchlaufs.
Das passiert im ersten T-10-Lauf und wird dort mit abgehakt.

**Nebenbefund:** `next.config.ts` setzt `output: "standalone"`. Next warnt beim
Start, `next start` sei dafür nicht vorgesehen, und empfiehlt
`node .next/standalone/server.js`. In der Praxis funktioniert `next start`
trotzdem vollständig. Für den Regelbetrieb ist zu prüfen, ob der
Standalone-Server das robustere Startkommando fürs RUNBOOK ist.

**Bestätigt:** `contextWindowCompression` fehlt im gesendeten Setup (im Log
nachlesbar) — T-03 ist also real erforderlich, nicht nur vermutet.

---

## T-10 — Inhaltliche Qualität (Go/No-go)

> **Das ist der eigentliche Go/No-go-Test.** Ist die Qualität nicht gut genug,
> ist alles andere wertlos.

Wird **vor** Phase 2 am unveränderten Upstream durchgeführt. Das liefert eine
saubere Baseline: Spätere Änderungen lassen sich dagegen vergleichen.

### Testmaterial

Echte Predigt der Gemeinde, 46 min 45 s, MP3 128 kbps Mono 44,1 kHz:

`https://cg-hersbruck.de/podcasts/034bb0f3c346ec0aec79a552b6db19a5baae8efb2396c9db6913f6de4833af08.mp3`

### Einspielweg: direkte Einspeisung über `scripts/demo-sender.mjs`

**Umgestellt am 2026-09-19.** Ursprünglich war Tab-Audio über die
Broadcast-Seite vorgesehen. In der Praxis zeigte sich sofort ein Problem: Wer
bewertet, müsste gleichzeitig den Browser bedienen — Tab spulen, Freigabe
starten — und kann dabei nicht konzentriert zuhören.

Eingespielt wird daher über [`scripts/demo-sender.mjs`](scripts/demo-sender.mjs).
Das Skript tritt dem LiveKit-Raum selbst als Sender bei, dekodiert die Datei mit
ffmpeg nach 48 kHz Mono und veröffentlicht sie als Audio-Track. Es **wartet, bis
die Übersetzer-Bridge im Raum ist**, und startet die Wiedergabe erst dann — die
bewertende Person muss nur den Link öffnen, die Sprache wählen und zuhören.

Vorteile gegenüber Tab-Audio, zusätzlich zu den unten genannten:

- **Exakt derselbe Startpunkt für alle fünf Läufe.** Manuelles Spulen im Tab
  trifft die Sekunde nie zuverlässig; das Skript bekommt sie als Parameter.
- **Nachweislich driftfrei.** Im ersten Lauf: 90.000 Frames = 15:00 Audio bei
  15:00 Laufzeit. Die Taktung übernimmt der Rückstau von `captureFrame`.
- **Material verifiziert.** Der SHA256 der Datei ist identisch mit ihrem
  Dateinamen im Podcast-Feed
  (`034bb0f3c346ec0aec79a552b6db19a5baae8efb2396c9db6913f6de4833af08`).

Die ursprüngliche Begründung gegen das X32 gilt unverändert:

- **Reproduzierbar.** Alle fünf Bewerter hören exakt dasselbe Eingangssignal.
  Über Mikrofon und Pult wäre jeder Lauf leicht anders, und die Bewertungen
  wären nicht mehr vergleichbar — bei einem Test, dessen Ergebnis über das
  Projekt entscheidet, ist das der wichtigste Punkt.
- **Isoliert die Fragestellung.** T-10 misst die Übersetzungsqualität, nicht die
  Audiokette. Tab-Audio nimmt X32, USB-Treiber und Raumakustik aus der Gleichung.
- **Keine Browser-Signalverarbeitung im Weg.** Tab-Audio läuft nicht über
  `getUserMedia`, also greifen Chromes Echo Cancellation, Noise Suppression und
  Auto Gain Control hier gar nicht erst. Genau die Effekte, die T-01 später
  abschaltet, können das Ergebnis also nicht verfälschen.
- **Ohne Hardware durchführbar.** Kein Zugang zum Pult nötig, die Läufe können
  unter der Woche stattfinden.

**Was dieser Weg ausdrücklich nicht abdeckt:** Er prüft T-01 nicht, und er sagt
nichts über das reale Pultsignal. Ein Podcast-MP3 ist bereits geschnitten und
nachbearbeitet; das Live-Signal vom X32 hat mehr Raumanteil und andere Dynamik.
**Das Ergebnis von T-10 ist daher eine Obergrenze.** Fällt T-10 gut aus, ist ein
späterer Gegentest mit echtem Pultsignal nötig, bevor der Dienst in den
Regelbetrieb geht.

> **Zusätzlich offen durch die Umstellung:** Die direkte Einspeisung umgeht die
> Broadcast-Seite vollständig. Der **Browser-Audioweg des Senders** (Mikrofon
> bzw. Tab-Audio) ist damit weiterhin ungeprüft — der offene Rest des
> Smoke-Tests schließt sich hier also *nicht*. Dafür ist ein eigener kurzer
> Durchgang über die Broadcast-Seite nötig. Für die Übersetzungsqualität ist es
> unerheblich, woher der Track kommt.

### Abschnitt

**Einheitlich für alle fünf Läufe: Minute 12:00 bis 27:00.**

Die Lage ist so gewählt, dass Begrüßung, Moderation und Musik am Anfang sicher
übersprungen sind und der Abschnitt mitten in der Auslegung liegt, wo
Bibelstellen und theologische Begriffe am dichtesten vorkommen.

> **Einmalige Vorprüfung durch das Technik-Team vor dem ersten Lauf:**
> Die Datei bei 12:00 anspielen und 60 Sekunden hineinhören. Wird dort
> durchgehend gepredigt? Falls nicht (z. B. noch Moderation oder ein Lied), in
> 3-Minuten-Schritten nach hinten verschieben, bis es passt.
> **Der so gefundene Startpunkt gilt dann für alle fünf Läufe.**
>
> Tatsächlich verwendeter Abschnitt: **von ............ bis ............**

### Ablauf eines Laufs (ca. 20 Minuten)

Jeder Lauf braucht eine sendende Person (Technik-Team) und eine bewertende
Person. „Unabhängig" heißt hier: **unabhängiges Urteil** — die Bewerter sollen
sich vorher nicht austauschen und die Bögen nicht gemeinsam ausfüllen. Die fünf
Läufe finden nacheinander statt, nicht gleichzeitig.

**Technik-Team, vor dem Lauf:**

1. `npm run build` (nur nötig, wenn sich der Code geändert hat)
2. `node scripts/testlauf.mjs` starten — schreibt ein Log mit Zeitstempeln nach
   `logs/` und wertet am Ende automatisch aus
3. Session anlegen, Broadcast-Seite öffnen, Passwort eingeben
4. MP3 in einem eigenen Browser-Tab öffnen, auf den festgelegten Startpunkt
   spulen, **pausiert** stehen lassen
5. Auf der Broadcast-Seite Tab-Audio aktivieren und diesen Tab freigeben —
   dabei **„Audio des Tabs teilen" anhaken**, sonst kommt kein Ton an
6. Watch-Link an die bewertende Person geben

**Bewertende Person:**

7. Link öffnen, eigene Sprache wählen, Kopfhörer aufsetzen
8. Kurz bestätigen, dass Ton ankommt
9. Erst dann startet das Technik-Team die Wiedergabe
10. **15 Minuten am Stück zuhören**, nebenbei Stichpunkte für Abschnitt 6 des
    Bogens notieren
11. Bogen direkt im Anschluss ausfüllen, nicht später aus dem Gedächtnis

**Technik-Team, nach dem Lauf:**

12. Wiedergabe stoppen, Session beenden (sonst laufen Kosten weiter)
13. `scripts/testlauf.mjs` mit Strg+C beenden → Auswertung erscheint
14. Werte in die Tabellen unten eintragen

### Kosten und Kontingent

Pro Lauf sind drei Teilnehmer 15 Minuten verbunden (Sender, Übersetzer-Bot,
Hörer) = 45 Teilnehmerminuten. Fünf Läufe = **225 Teilnehmerminuten** von 5.000
im Monatskontingent der Build-Stufe. Gemini-Kosten rund **2,80 USD** insgesamt.

### Ergebnisse

Skala 1–5, 5 ist am besten. Empfehlung: Ja / Mit Einschränkung / Nein.

| Sprache | Bewerter | Datum | Verständlichkeit | Bibelstellen & Namen | Theol. Begriffe | Aussetzer | Empfehlung |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| English (en) | | | | | | | |
| Română (ro) | | | | | | | |
| Русский (ru) | | | | | | | |
| Magyar (hu) | | | | | | | |
| 简体中文 (zh-Hans) | | | | | | | |

**Bewertungskriterium:** Eine Sprache gilt als bestanden, wenn Verständlichkeit
mindestens 4 beträgt **und** die Empfehlung „Ja" lautet.

> **Wenn eine Sprache durchfällt:** melden und auf Entscheidung warten. Sie wird
> **nicht** stillschweigend aus der Liste genommen.

**Zusammenfassung / Entscheidung:**

...................................................................

---

## Nebenbefund: Reconnect-Verhalten (Vorstufe zu T-09)

Wird während der T-10-Läufe nebenbei miterhoben — es läuft ohnehin Audio über
die Bridge. Das ist **noch nicht T-09**, liefert aber einen frühen Hinweis
darauf, ob `contextWindowCompression` (T-03) wirklich nötig ist.

`scripts/testlauf.mjs` erkennt die Ereignisse automatisch und fasst sie beim
Beenden zusammen.

Hintergrund: Eine einzelne Gemini-WebSocket-Verbindung lebt rund 10 Minuten,
eine Audio-Session ohne Kompression maximal 15 Minuten. Bei 15 Minuten Laufzeit
ist **mindestens ein Reconnect zu erwarten**. Bleibt er aus, ist das ebenfalls
ein verwertbares Ergebnis und gehört notiert.

| Sprache | Laufzeit | goAway? | Erster Reconnect bei | Handle vorhanden? | Größte Audio-Lücke | Hörbar? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| English (en) | 15:02 | ja, „Time left: 50s" | **9:00** nach Bridge-Start | **ja** | **4,6 s** | offen |
| Română (ro) | | | | | | |
| Русский (ru) | | | | | | |
| Magyar (hu) | | | | | | |
| 简体中文 (zh-Hans) | | | | | | |

„Hörbar?" beantwortet die bewertende Person aus Abschnitt 4 des Bogens, nicht
das Log. Interessant ist gerade der Fall, dass das Log eine Lücke zeigt, dem
Hörer aber nichts aufgefallen ist.

### Ablauf des ersten Laufs (English, 2026-09-19)

```
+06:53  Bridge aktiv, Gemini-Setup vollständig
+15:53  goAway von Gemini, "Time left: 50s"
+15:53  Reconnect mit Resumption-Handle c0ae2902-…
+15:53  Reconnect-WebSocket offen
+15:54  Reconnect-Setup vollständig  (rund 1 Sekunde)
+15:58  Audio wieder da nach 4570 ms Lücke
+21:55  Sender verlässt den Raum → Bridge stoppt sich selbst, Code 1000
```

**Drei Befunde:**

1. **Session Resumption funktioniert.** Der Handle war vorhanden, das
   Reconnect-Setup war nach rund einer Sekunde abgeschlossen, die Übersetzung
   lief danach weiter. Kein Abbruch.
2. **Die Audio-Lücke betrug 4,6 s und liegt damit über dem
   3-Sekunden-Kriterium aus T-03.** Auffällig ist die Aufteilung: Das
   Reconnect-Setup dauerte nur 1 s, bis zum ersten Audio vergingen aber 4,6 s.
   Der Engpass liegt also nicht im Verbindungsaufbau, sondern danach —
   vermutlich braucht das Modell nach der Wiederaufnahme Anlauf, bis wieder
   Audio kommt.
3. **Der Abbau beim Weggang des Senders funktioniert** (`Organizer
   disconnected, stopping bridge`). Das bestätigt den in T-08 zu
   verifizierenden Mechanismus — nicht neu bauen.

**Vorläufige Einschätzung zu T-03 — wichtige Abgrenzung:**

Dieser Lauf beweist **nicht**, dass `contextWindowCompression` das Problem löst.
Hier sind zwei verschiedene Grenzen im Spiel, die nicht verwechselt werden
dürfen:

- Die **Verbindungslebensdauer** (rund 10 Minuten) — sie hat das `goAway`
  ausgelöst und wird durch Session Resumption aufgefangen.
  `contextWindowCompression` ändert daran nichts.
- Die **Session-Lebensdauer** (ohne Kompression 15 Minuten Audio) — genau dagegen
  wirkt `contextWindowCompression`. Diese Grenze wurde hier **nicht erreicht**,
  weil der Lauf nur 15 Minuten dauerte.

Daraus folgt: T-03 bleibt für den 45-Minuten-Betrieb erforderlich, ist durch
diesen Lauf aber weder bestätigt noch widerlegt. Das klärt erst der
60-Minuten-Dauerlauf T-09.

**Die 4,6-Sekunden-Lücke ist ein eigenständiges Problem**, das
`contextWindowCompression` voraussichtlich *nicht* behebt, weil Reconnects
weiterhin alle rund 10 Minuten auftreten. Bei einer 45-Minuten-Predigt sind das
etwa vier Lücken. Ob das im Gottesdienst stört, entscheidet das Hörurteil, nicht
das Log — deshalb ist die Spalte „Hörbar?" der eigentliche Maßstab.

---

## Vorfall 2026-10-04: Ausfall gegen Ende des Gottesdienstes

Live-Test über den ganzen Gottesdienst, zwei Sprachen, eigener Docker-Host.

| Beobachtung | Bewertung |
| :--- | :--- |
| Stimmwechsel alle 2–5 Minuten (Mann/Frau, andere Sprecher) | **Dokumentiertes Modellverhalten**, laut Google: „Voice replication can be inconsistent", Stimmen wechseln nach längeren Pausen. Eine feste Stimme ist beim Translate-Modell nicht einstellbar. Akzeptiert; Dämpfung über Pause-Knopf in Lobpreis und Moderation. |
| Pause/Weiter fehlte auf der Sendeseite | behoben |
| Hörer-Verbindung bricht bei gesperrtem Bildschirm ab | Media Session + Audio Session eingebaut, **Messung am Gerät steht aus** (T-13) |
| Übersetzung tot, Sendeseite grün | Ursache: Gemini-Guthaben erschöpft (1011). Ausfallerkennung gebaut, siehe ANPASSUNGEN.md |

### Test der Ausfallerkennung (2026-10-04, lokal)

**Lauf 1 — Ausfall im Betrieb mit Testschalter (40 s):**

```
+  4 s  Bridge aktiv, gesundheit=pausiert, 1 Hörer
+ 46 s  Testschalter: 1011 "credits depleted" -> gestoert,
        "Gemini-Guthaben erschöpft. In AI Studio aufladen."
+107 s  Erholungsversuch genau 60 s später -> wiederhergestellt
```

**Lauf 2 — Startfehler mit ungültigem Schlüssel:**

| Schritt | Ergebnis |
| :--- | :--- |
| Erste Anforderung | HTTP 500, Störung erfasst: „Gemini-Zugang abgelehnt", endgültig |
| Companion-Status | `fehler`, mit Grund |
| Sofortige Wiederholungen | HTTP 503 in 16–17 ms **ohne Anfrage an Gemini** (Schonfrist) |
| Nach 52 s | echter Neuversuch, Zähler steigt auf 2 |
| Log | Stacktrace nur für die zwei echten Versuche, Schlüssel nicht im Log |

### Log-Auswertung des Gottesdienstes (2026-10-04)

| Sprache | Laufzeit | Audio gesendet | Frames/s | goAway | Wiederverb. (davon ok) |
| :--- | :--- | ---: | ---: | ---: | :--- |
| Ungarisch | 09:19–11:10 | 84 min | 10,0 | 9 | 271 (9) |
| Rumänisch | 09:41–11:10 | 64 min | 10,0 | 7 | 248 (6) |
| Englisch | Tests, zusammen ~18 min | | 10,0 | | |

- Guthaben leer ab **10:43** (Ungarisch) bzw. **10:46** (Rumänisch). Laufende
  Verbindungen übersetzten bis zum nächsten `goAway` weiter; erst die
  Wiederverbindung scheiterte. Danach rund 500 vergebliche Versuche bis 11:10.
- Folgefehler 1008 „client failed to close the connection after receiving a
  GoAway signal": Die alte Verbindung wurde zum Fristende abgebrochen, weil die
  neue nicht zustande kam. Wird jetzt als vorübergehend eingestuft.
- Normale Lücke beim `goAway` rund 4 s, Maximum 12 s.

### Kostenmessungen (2026-10-04, lokal, Demo-Sender)

Pause = Sender-Track stummgeschaltet, gemessen über 30 s:

| Stand | Eingabe | Ausgabe |
| :--- | ---: | ---: |
| Upstream | +30,2 s | +30,2 s |
| nur Eingabe gesperrt | +0,2 s | +30,3 s |
| Verbindung nach 5 s getrennt | +0,2 s | +5,3 s |

**Noch offen:** das Fortsetzen nach einer Pause. LiveKit Cloud verweigert das
Freigeben per API, der Pfad ist nur im Quellcode von `rtc-node` geprüft
(`trackUnmuted` setzt das Flag zurück). **Vor dem nächsten Gottesdienst einmal
im Browser testen:** Pause → 10 s warten → Weiter → Übersetzung muss nach 1–2 s
wieder kommen. Im Log: „Gemini-Verbindung waehrend der Pause getrennt", dann
„Pause beendet - Gemini-Verbindung wird wieder aufgebaut".

**A/B-Test Abtastrate:** offen. Je 10 min Demo-Sender mit
`GEMINI_INPUT_SAMPLE_RATE=48000` und `=16000`, in getrennten Stunden, dann die
Eingabetokens im Dashboard vergleichen.

**Nicht automatisiert getestet:** das Wiederholbudget von 2 Minuten bei
anhaltend vorübergehenden Fehlern (dafür bräuchte es einen Server, der
wiederholt mit 1006 abbricht). Die Logik ist einfach; Prüfung über T-17.

---

## Übrige Tests

Alle noch offen. Werden erst nach Abschluss von T-10 und Phase 2 durchgeführt.

| # | Test | Kriterium | Status |
| :--- | :--- | :--- | :--- |
| T-09 | Dauerlauf 60 Minuten mit echtem Predigtmaterial | Keine Abbrüche, keine Audio-Lücke über 3 s | offen |
| T-11 | Zitat in der Zielsprache (englischer Satz bei Zielsprache Englisch) | Modell schweigt nicht, gibt das Zitat wieder | offen |
| T-12 | Lobpreis und Musik bei aktiver Übersetzung | Prüfen, ob Artefakte entstehen — daraus ergibt sich, ob ein Stopp-Knopf nötig ist | offen |
| T-13 | iPhone mit gesperrtem Bildschirm, 20 Minuten | Ton läuft weiter — oder das Gegenteil ist dokumentiert. **Neu zu prüfen:** Erscheint die Steuerung „Live-Übersetzung" auf dem Sperrbildschirm? Funktioniert Pause/Play dort? Konsole: `[AudioSession]`/`[MediaSession]` zeigen, was der Browser unterstützt. Dasselbe auf Android. | offen |
| T-14 | Zwei Sprachen gleichzeitig, je zwei Hörer | Beide Bridges stabil, keine gegenseitige Störung | offen |
| T-15 | Hörer verlässt und kommt zurück | Bridge korrekt abgebaut und wieder aufgebaut, kein Session-Leak | offen |
| T-16 | `systemInstruction` mit Glossar | Wirkt es oder wird es ignoriert? Keine Zusage vor der Messung. | offen |
| T-17 | Netzwerkabriss am Sender-PC (10 s) | App erholt sich, oder klare Fehlermeldung. Prüfen, ob fälschlich alle Bridges abgebaut werden. | offen |
| T-18 | Browser am Handy hart beenden | Bridge wird binnen 10 Minuten abgebaut, im Log begründet | offen |
| T-19 | Hörer bleibt 30 Minuten still verbunden | Übersetzung bleibt aktiv, der Abgleich räumt nichts ab | offen |
