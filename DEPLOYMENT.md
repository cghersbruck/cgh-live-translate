# Bereitstellung per Docker

Ziel: Auf dem Server liegen am Ende **nur zwei Dateien** — `docker-compose.yml`
und `.env`. Kein Quellcode, kein Node, kein Build. Das Image baut GitHub.

```
Push auf Branch gemeinde
        ↓
GitHub Action: prüft Typen, baut, veröffentlicht Image nach GHCR
        ↓
Server: docker compose pull && docker compose up -d
```

---

## Teil 1 — Einmalig: Repository einrichten

Das Repository zeigt nach dem Klonen noch auf das Original von Google. Das
eigene Repository kommt als zusätzliches Remote dazu, damit ein späteres
`git pull` vom Upstream weiterhin möglich bleibt.

```bash
# Upstream unter eigenem Namen behalten
git remote rename origin upstream

# Eigenes Repository als neues origin eintragen
git remote add origin https://github.com/cghersbruck/cgh-live-translate.git

# Branch gemeinde hochladen
git push -u origin gemeinde
```

> **Nicht nach `upstream` pushen.** Das ist das öffentliche Google-Repository.

Sobald der Push durch ist, läuft die Action automatisch. Zu sehen unter
*Actions* im Repository. Beim ersten Lauf dauert sie einige Minuten, weil zwei
Architekturen gebaut werden (amd64 und arm64) und der Cache noch leer ist.

### Umzug des Repositories (Oktober 2026)

Das Repository ist von `The-Walker443` nach `cghersbruck` umgezogen. Die
GitHub Action benennt das Image nach dem Repository, **der Image-Pfad hat sich
damit geändert**:

```
alt:  ghcr.io/the-walker443/cgh-live-translate
neu:  ghcr.io/cghersbruck/cgh-live-translate
```

In der `.env` auf dem Server muss `IMAGE` entsprechend angepasst werden. Der
alte Pfad bekommt keine neuen Builds mehr — ohne Anpassung bliebe der Server
still auf altem Stand stehen, genau wie beim eingefrorenen Tag weiter unten.

Beim ersten Build unter dem neuen Namen entsteht ein **neues Paket**, das
möglicherweise auf privat steht. Dann einmalig die Sichtbarkeit umstellen,
siehe nächster Abschnitt.

### Sichtbarkeit des Images

**Aktueller Stand: öffentlich abrufbar, keine Anmeldung nötig.** Geprüft am
2026-09-19 gegen die Registry — die Tag-Liste ist anonym abrufbar, und das
Manifest enthält `linux/amd64` und `linux/arm64`. Auf der Synology genügt also
`docker compose pull`, unabhängig von der CPU.

Das Image enthält keine Zugangsdaten; die kommen erst zur Laufzeit aus der
`.env`.

> Sollte die Sichtbarkeit später auf privat umgestellt werden, muss sich der
> Server anmelden: Personal Access Token (classic) mit `read:packages` anlegen
> und einmalig ausführen:
>
> ```bash
> echo "<token>" | docker login ghcr.io -u cghersbruck --password-stdin
> ```

---

## Teil 2 — Auf dem Server

Nur diese beiden Dateien werden gebraucht:

```bash
mkdir -p /volume1/docker/live-uebersetzung
cd /volume1/docker/live-uebersetzung

# docker-compose.yml und .env.example aus dem Repository herunterladen
curl -O https://raw.githubusercontent.com/cghersbruck/cgh-live-translate/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/cghersbruck/cgh-live-translate/main/.env.example
```

Danach die `.env` ausfüllen. Mindestens:

| Variable | Bedeutung |
| :--- | :--- |
| `IMAGE` | `ghcr.io/cghersbruck/cgh-live-translate:latest` |
| `APP_PORT` | Port auf dem Server, Standard 8080 |
| `LIVEKIT_API_KEY` / `_SECRET` / `_URL` | LiveKit-Zugangsdaten |
| `GEMINI_API_KEY` | Muss aus einem Paid-Tier-Projekt stammen |
| `BROADCAST_PASSWORD` | Schutz der Sender-Seite |

Starten:

```bash
docker compose pull
docker compose up -d
docker compose logs -f
```

Prüfen, ob es läuft:

```bash
curl http://localhost:8080/api/auth/status
# erwartet: {"passwordRequired":true}
```

Der Container hat einen Healthcheck; `docker compose ps` zeigt `healthy`,
sobald die App antwortet.

### Welcher Stand läuft gerade?

Jedes Image trägt den Commit, aus dem es gebaut wurde, als Label:

```bash
docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' live-uebersetzung
```

Das Ergebnis mit dem neuesten Commit auf `main` vergleichen. Stimmen sie nicht
überein, läuft ein alter Stand — siehe Stolpersteine.

### Störungen im Log finden

Jeder Ausfall der Übersetzung erzeugt genau eine auffindbare Zeile:

```bash
docker logs cgh-live-translate 2>&1 | grep -E "STOERUNG|wiederhergestellt"
```

### Aktualisieren

```bash
docker compose pull && docker compose up -d
```

Die Action schreibt bei jedem Lauf in die Zusammenfassung, welche Tags
veröffentlicht wurden. Wer nicht immer `latest` will, setzt in der `.env` einen
festen Tag, etwa `IMAGE=ghcr.io/cghersbruck/cgh-live-translate:sha-1a2b3c4`.

---

## Teil 3 — Was damit noch nicht erledigt ist

### HTTPS für die App (T-07)

Der Container liefert **HTTP** aus. Das genügt für einen Test im lokalen Netz
per `localhost`, **nicht** für Besucher-Handys: Browser behandeln nur
`localhost` als sicheren Kontext. Über die LAN-IP ist `getUserMedia` gesperrt
und der WebRTC-Empfangspfad unzuverlässig.

Für den Betrieb gehört daher ein Reverse Proxy mit Zertifikat davor — auf einer
Synology etwa der eingebaute Reverse Proxy plus Let's Encrypt, alternativ Caddy
oder Traefik im selben Compose-Verbund.

Dass LiveKit Cloud bereits eine `wss://`-URL liefert, ersetzt das **nicht**:
Das betrifft nur den Medientransport, nicht die Auslieferung der Seite.

### Selbst gehostetes LiveKit

Die `docker-compose.yml` betreibt LiveKit als eigenen Dienst. Einzurichten sind:

**1. Schlüsselpaar erzeugen**

```bash
docker run --rm livekit/livekit-server generate-keys
```

Das Ergebnis als `LIVEKIT_API_KEY` und `LIVEKIT_API_SECRET` in die `.env`
eintragen. Beide Dienste bekommen die Werte von dort — eine doppelte Pflege
gibt es nicht.

**2. `LIVEKIT_NODE_IP` in der `.env` setzen**

Die feste LAN-Adresse der NAS, etwa `192.168.1.50`.

> `use_external_ip` hat **Vorrang** vor `node_ip`. Es muss ausdrücklich auf
> `false` stehen, sonst wird `node_ip` ignoriert und LiveKit meldet den Handys
> die öffentliche IP. Für Besucher im Haus ist das in der Regel falsch.

Im Docker-Bridge-Netz kennt der Container nur seine interne Adresse (172.x) —
die ist für die Besucher nutzlos, deshalb muss die richtige ausdrücklich
gesetzt werden.

**3. Reverse Proxy für die Signalisierung**

`livekit.<domain>` → `cgh-livekit:7880`, mit TLS und **WebSocket-Upgrade**. Ohne
das Upgrade schlägt die Verbindung fehl, ohne eine verständliche Fehlermeldung.

**4. Medienports**

Der Medienverkehr kann **nicht** über einen HTTP-Reverse-Proxy laufen und geht
direkt auf die veröffentlichten Ports:

| Port | Zweck |
| :--- | :--- |
| `7882/udp` | eigentlicher Medienverkehr (ein einziger Port dank UDP-Multiplexing) |
| `7881/tcp` | Rückfallweg, wenn UDP blockiert ist — in Gäste-WLANs keine Seltenheit |

Sollen Besucher auch von außerhalb des WLANs zuhören, müssen beide im Router
auf die NAS zeigen.

### Zwei Adressen, nicht eine

`LIVEKIT_URL` wird an zwei Stellen gebraucht, und bei lokalem LiveKit sind es
nicht mehr dieselben:

| Variable | Wer nutzt sie | Wert |
| :--- | :--- | :--- |
| `LIVEKIT_URL` | der Browser des Besuchers | `wss://livekit.<domain>` |
| `LIVEKIT_URL_INTERNAL` | die Übersetzer-Bridge im Container | `ws://cgh-livekit:7880` |

Ohne die zweite müsste der Container die öffentliche Adresse auflösen und über
den Router zu sich selbst zurückfinden. Das scheitert auf vielen Routern an
fehlendem NAT-Hairpin — und zwar erst zur Laufzeit, sobald der erste Hörer eine
Sprache wählt. Bei LiveKit Cloud bleibt `LIVEKIT_URL_INTERNAL` einfach leer.

Merksatz: `LIVEKIT_URL` ist immer die Adresse aus Sicht des Besucher-Handys,
niemals `localhost` und niemals der Containername.

### Datenschutz

Solange LiveKit Cloud genutzt wird, verlässt Predigtaudio das Gemeindenetz
zweifach — über LiveKit und über Google. Siehe `ANPASSUNGEN.md`.

---

## Stolpersteine

| Symptom | Ursache | Lösung |
| :--- | :--- | :--- |
| `denied` beim `docker compose pull` | Image ist privat | Sichtbarkeit umstellen oder `docker login ghcr.io` (Teil 1) |
| `IMAGE muss gesetzt sein` | `.env` fehlt oder `IMAGE` ist leer | `.env` neben die `docker-compose.yml` legen |
| Container läuft, aber nicht erreichbar | Portkonflikt auf dem Server | `APP_PORT` in der `.env` ändern |
| `no matching manifest` | Falsche CPU-Architektur | Die Action baut amd64 und arm64; prüfen, ob der Lauf durchlief |
| Hörer bekommt keinen Ton | App per HTTP über LAN-IP aufgerufen | HTTPS einrichten, siehe T-07 |
| **Update kommt nicht an**, `pull` sagt „up to date" | In der `.env` steht ein Tag, der nicht mehr gebaut wird — etwa `:gemeinde`. Seit der Umstellung auf „nur `main` veröffentlicht" wird ausschließlich `latest`, `main` und `sha-<commit>` aktualisiert. | `IMAGE=ghcr.io/cghersbruck/cgh-live-translate:latest` setzen, dann `docker compose pull && docker compose up -d --force-recreate` |
| Hörer verbindet, aber Übersetzung startet nie | Bridge erreicht LiveKit nicht — `LIVEKIT_URL_INTERNAL` fehlt oder zeigt auf die öffentliche Adresse | `LIVEKIT_URL_INTERNAL=ws://cgh-livekit:7880` setzen |
| Verbindung bricht sofort ab, kein Ton | Reverse Proxy reicht kein WebSocket-Upgrade an `cgh-livekit:7880` durch | Upgrade-Header im Proxy aktivieren |
| Ton nur im selben WLAN, nicht von außen (oder umgekehrt) | `LIVEKIT_NODE_IP` bzw. `use_external_ip` passen nicht zum Nutzungsfall | `.env` bzw. den `LIVEKIT_CONFIG`-Block in der `docker-compose.yml` anpassen, siehe oben |
| Container läuft auf altem Stand | Tag unverändert, daher wurde der Container nicht neu erzeugt | `docker compose up -d --force-recreate` |
