# Steuerung über Bitfocus Companion

Start, Pause und Stopp der Übertragung lassen sich vom Technik-PC über
Companion bedienen, ohne die Broadcast-Seite anzufassen.

## Wie es zusammenhängt

Der Sender ist eine Browser-Seite, und Companion kann keine Browser-Tabs
fernsteuern. Deshalb der Umweg: Companion ruft eine Adresse der App auf, die
App merkt sich den Befehl, und die geöffnete Broadcast-Seite holt ihn sich im
Sekundentakt ab und führt ihn aus.

**Daraus folgt eine Regel für den Sonntag: Die Broadcast-Seite muss geöffnet
sein.** Companion kann sie nicht selbst starten. Einmal öffnen, danach läuft
alles über die Tasten.

Solange die Seite offen ist, meldet sie ihren Zustand zurück — Companion kann
die Tasten also einfärben.

## Die vier Tasten

Companion-Modul: **Generic HTTP**, Aktion **GET**.

`<server>` durch die Adresse des Servers ersetzen, `<passwort>` durch das
Broadcast-Passwort.

| Taste | URL |
| :--- | :--- |
| **Start** | `http://<server>:8080/api/control?session=cgh&action=start&password=<passwort>` |
| **Pause** | `http://<server>:8080/api/control?session=cgh&action=pause&password=<passwort>` |
| **Weiter** | `http://<server>:8080/api/control?session=cgh&action=resume&password=<passwort>` |
| **Stopp** | `http://<server>:8080/api/control?session=cgh&action=stop&password=<passwort>` |

`session` ist die Session-ID, die beim Anlegen vergeben wurde — also der Wert
aus `DEFAULT_EVENT_ID`, sofern das Feld beim Anlegen nicht geändert wurde.

### Was die Tasten bewirken

**Start** schaltet den Mikrofoneingang mit Standardeinstellungen ein. Läuft die
Übertragung schon, hebt Start lediglich eine bestehende Pause auf.

**Pause** hält den Ton an. Nach 5 Sekunden trennt die App zusätzlich die
Verbindung zu Gemini — sonst liefert Gemini weiter Stille und rechnet sie ab
(gemessen: 30 s Pause ergaben vorher 30 s abgerechnete Ausgabe). Gedacht für
Lobpreis und Moderation. **Weiter** baut die Verbindung wieder auf; bis wieder
übersetzt wird, vergehen 1–2 Sekunden. Also kurz vor dem Einsatz des
Predigers drücken.

**Stopp** beendet die Übertragung vollständig.

> Pause ist nicht dasselbe wie Stopp. Nach Pause geht es sofort weiter, nach
> Stopp muss die Übertragung neu gestartet werden.

## Rückmeldung für die Tastenfarben

Dieselbe Adresse mit `action=status` verändert nichts, sondern liefert nur den
Zustand:

```
http://<server>:8080/api/control?session=cgh&action=status&password=<passwort>
```

Antwort:

```json
{
  "status": "sendet",
  "connected": true,
  "sending": true,
  "paused": false,
  "stoerungen": [],
  "kostenUsd": 1.23
}
```

| `status` | Bedeutung |
| :--- | :--- |
| `getrennt` | Die Broadcast-Seite ist nicht offen. Tasten wirken nicht. |
| `fehler` | **Mindestens eine Übersetzung ist ausgefallen**, obwohl gesendet wird — etwa weil das Gemini-Guthaben erschöpft ist. Der Grund steht im Feld `stoerungen`. |
| `bereit` | Seite offen, es wird noch nicht gesendet. |
| `sendet` | Übertragung läuft. |
| `pausiert` | Ton angehalten, Sitzung läuft weiter. |

Für eine Companion-Rückmeldung das Feld `status` abfragen und auf diese fünf
Werte prüfen. **`fehler` sollte die Taste rot färben** — das ist der Fall, in
dem die Sendeseite selbst einwandfrei aussieht, die Besucher aber nichts mehr
hören. `connected` eignet sich gut als Warnung: Steht es auf `false`,
wurde vergessen, die Broadcast-Seite zu öffnen.

`kostenUsd` ist die geschätzte Summe der laufenden Session — etwa für eine
Anzeige auf einer Companion-Taste.

Die Abfrage kann bedenkenlos jede Sekunde laufen — sie ist sehr leichtgewichtig
und setzt keinen Befehl ab.

## Zwei Hinweise

**Das Passwort steht in der Companion-Konfiguration** und ist damit für jeden
sichtbar, der Zugriff auf Companion hat. Im Gemeindenetz ist das vertretbar;
über das offene Internet sollte diese Adresse nicht erreichbar sein.

**Ein Befehl, der abgesetzt wurde, bevor die Seite offen war, wird nicht
nachträglich ausgeführt.** Die Seite merkt sich beim Öffnen nur den aktuellen
Stand. Sonst würde ein Stopp vom vergangenen Sonntag die frisch geöffnete
Übertragung sofort wieder beenden.
