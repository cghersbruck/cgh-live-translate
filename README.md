# Live-Übersetzung für den Gottesdienst

Besucher scannen einen Link, wählen im Browser ihre Sprache und hören die
Predigt live übersetzt über eigene Kopfhörer. Keine App-Installation, keine
ausgegebene Hardware.

Angepasste Fassung der Referenz-App
[google-gemini/gemini-live-translate-livekit](https://github.com/google-gemini/gemini-live-translate-livekit)
für die Christliche Gemeinde Hersbruck.

---

## Wie es funktioniert

```
Mischpult ──► Sende-PC (Browser) ──► LiveKit ──► Gemini ──► LiveKit ──► Handy des Besuchers
                                                   │
                                          eine Sitzung je Sprache
```

Der Sende-PC überträgt das Predigtsignal. Für jede Sprache, die mindestens ein
Zuhörer angefordert hat, läuft genau eine Übersetzungssitzung — unabhängig
davon, wie viele Personen zuhören. Wählt niemand mehr eine Sprache, wird sie
wieder abgebaut.

---

## Installation

Auf dem Server werden nur zwei Dateien gebraucht: `docker-compose.yml`
und `.env`. Der Quellcode wird dort nicht benötigt — das Image baut GitHub bei
jedem Push nach `main` automatisch.

```bash
mkdir -p /volume1/docker/live-uebersetzung
cd /volume1/docker/live-uebersetzung

curl -O https://raw.githubusercontent.com/cghersbruck/cgh-live-translate/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/cghersbruck/cgh-live-translate/main/.env.example
```

`.env` ausfüllen (siehe unten), dann:

```bash
docker compose pull
docker compose up -d
```

Prüfen, ob es läuft:

```bash
curl http://localhost:8080/api/auth/status
# erwartet: {"passwordRequired":true}
```

**Aktualisieren** später mit demselben Befehlspaar. Ausführliche Anleitung samt
Stolpersteinen: **[DEPLOYMENT.md](DEPLOYMENT.md)**

---

## Konfiguration

Alle Werte kommen zur Laufzeit aus der `.env`. Im Image ist nichts eingebacken —
dieselbe Image-Datei läuft gegen LiveKit Cloud wie gegen ein selbst gehostetes
LiveKit.

| Variable | Bedeutung |
| :--- | :--- |
| `IMAGE` | `ghcr.io/cghersbruck/cgh-live-translate:latest` |
| `APP_PORT` | Port auf dem Server (Standard `8080`) |
| `LIVEKIT_API_KEY` | Zugangsdaten des LiveKit-Servers |
| `LIVEKIT_API_SECRET` | dito |
| `LIVEKIT_URL` | `wss://…` — **die Adresse aus Sicht des Besucher-Handys**, nie `localhost` |
| `LIVEKIT_URL_INTERNAL` | Adresse aus Sicht des Servers, bei lokalem LiveKit `ws://cgh-livekit:7880`. Bei LiveKit Cloud leer lassen. |
| `GEMINI_API_KEY` | Schlüssel aus einem Projekt mit aktivierter Abrechnung |
| `BROADCAST_PASSWORD` | Schützt die Sender-Seite |
| `DEFAULT_EVENT_ID` | Vorbelegung der Event-ID, z. B. `cgh`. Ergibt die dauerhafte Hörer-Adresse `/session/<id>/watch` für Links und QR-Codes. |

> Der Gemini-Schlüssel sollte aus einem Paid-Tier-Projekt stammen. Der Free
> Tier begrenzt gleichzeitige Verbindungen auf etwa drei bis fünf, was bei
> mehreren Sprachen zu Abbrüchen führt.

Die Datei `.env` gehört **nicht** ins Git — sie ist ausgeschlossen. Als Vorlage
dient [.env.example](.env.example).

---

## Nutzung

### Übertragung starten

1. Startseite öffnen, Passwort eingeben.
2. **Sprachen auswählen.** Die fünf üblichen sind vorangehakt; jede weitere
   Sprache lässt sich dazunehmen oder abwählen. Genau diese Auswahl bekommen
   die Besucher später angeboten.
3. Session anlegen → Broadcast-Seite öffnet sich.
4. Mikrofon einschalten. Das Eingangsgerät wählt Chrome über seine
   Seiteneinstellungen; der Sende-PC sollte das Pultsignal als Eingang haben.
5. Hörer-Link bzw. QR-Code weitergeben.

Die Browser-Konsole zeigt nach dem Einschalten unter `Aufnahme-Einstellungen`,
welches Gerät verwendet wird und ob die Signalaufbereitung wirklich
abgeschaltet ist.

### Zuhören

Link öffnen, Sprache wählen, Kopfhörer aufsetzen. Fordert das Telefon eine
Berührung, erscheint ein großer Knopf **„Ton starten"**.

### Nach dem Gottesdienst

Übertragung beenden, damit keine Kosten weiterlaufen.

### Steuerung über Bitfocus Companion

Start, Pause und Stopp lassen sich vom Technik-PC über Companion bedienen.
Einrichtung und die vier Tasten: **[COMPANION.md](COMPANION.md)**

---

## Entwicklung

```bash
npm install
npm run build && npm start        # Produktionsmodus
```

**Nicht `npm run dev` für längere Tests verwenden.** Hot Reload startet den
Node-Prozess neu, und die Sitzungsverwaltung liegt im Arbeitsspeicher — jeder
Reload beendet alle laufenden Übersetzungen.

Lokal wird zusätzlich eine `.env.local` mit denselben Variablen gebraucht
(ohne `IMAGE` und `APP_PORT`).

### Hilfsskripte

| Skript | Zweck |
| :--- | :--- |
| `node scripts/testlauf.mjs` | Startet den Server mit Zeitstempeln, erkennt Verbindungsabbrüche und Tonlücken, redigiert Zugangsdaten aus dem Log |
| `node scripts/demo-sender.mjs --datei <pfad>` | Spielt eine Audiodatei als Sender ein — für reproduzierbare Tests ohne Mischpult |

### Änderungen gegenüber dem Original

Der Branch `main` enthält die angepasste Fassung, das Remote `upstream` zeigt
auf das Google-Repository. Vergleich mit `git diff upstream/main..main`.

Jede Abweichung ist begründet in **[ANPASSUNGEN.md](ANPASSUNGEN.md)**
dokumentiert. Das ursprüngliche englische README liegt als
[README.upstream.md](README.upstream.md) bei.

---

## Dokumentation

| Datei | Inhalt |
| :--- | :--- |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Bereitstellung, Aktualisierung, Stolpersteine |
| [COMPANION.md](COMPANION.md) | Steuerung über Bitfocus Companion |
| [ANPASSUNGEN.md](ANPASSUNGEN.md) | Abweichungen vom Original samt Begründung |
| [TESTPROTOKOLL.md](TESTPROTOKOLL.md) | Testplan und Ergebnisse |
| [T10-BEWERTUNGSBOGEN.md](T10-BEWERTUNGSBOGEN.md) | Bogen für die Qualitätsbewertung durch Muttersprachler |

---

## Datenschutz

Das Predigtaudio wird außerhalb des Gemeindenetzes verarbeitet — über den
LiveKit-Server und über Google. Bei Gemini Paid Tier werden die Daten nicht zur
Produktverbesserung genutzt, die Verarbeitung findet aber statt. Ein Hinweis
auf der Hörerseite und im Gottesdienst ist angemessen.

Das verwendete Übersetzungsmodell ist im Preview-Status; Google kann Verhalten,
Preise und Verfügbarkeit ändern.

---

## Herkunft und Lizenz

Abgeleitet von
[google-gemini/gemini-live-translate-livekit](https://github.com/google-gemini/gemini-live-translate-livekit),
lizenziert unter Apache License 2.0 — siehe [LICENSE](LICENSE).
