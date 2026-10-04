#!/bin/sh
# Kompakte Auswertung eines Container-Logs nach einem Gottesdienst.
#
# Erwartet ein Log mit Zeitstempeln, erzeugt mit:
#   docker logs -t --since <von> --until <bis> cgh-live-translate > datei.log 2>&1
#
# Aufruf:
#   sh log-auswertung.sh datei.log
#
# Ausgabe: je Uebersetzungs-Bridge Laufzeit, gesendetes und empfangenes Audio,
# geschaetzte Tokens, Wiederverbindungen und Luecken - dazu Fehlerstatistik.
# Laeuft mit dem awk, das auf Debian/Synology vorinstalliert ist (mawk/busybox).
#
# Grundlagen der Schaetzung:
#   - "Sent audio frame #N": ein Frame = 100 ms Eingangsaudio.
#   - "Received audio frame #N": ein Frame = 0,25 s Ausgabe (16000 Zeichen
#     Base64 = 6000 Samples bei 24 kHz). Naeherung; Gemini kann die Groesse
#     variieren.
#   - Google rechnet 25 Tokens je Sekunde Audio ab.

f="${1:?Logdatei angeben, z. B.: sh log-auswertung.sh nutzung.log}"

awk '
function sek(ts) { return substr(ts,12,2)*3600 + substr(ts,15,2)*60 + substr(ts,18,2) }
function uhr(ts) { return substr(ts,12,8) }
function sprache() {
  if (match($0, /\[TranslationBridge:[A-Za-z-]+\]/)) return substr($0, RSTART+19, RLENGTH-20)
  return ""
}
function nummer() {
  if (match($0, /#[0-9]+/)) return substr($0, RSTART+1, RLENGTH-1) + 0
  return -1
}
{
  ts = $1
  # Frueheste und spaeteste Zeit statt erster und letzter Zeile - robust,
  # falls Zeilen aus mehreren Quellen nicht streng sortiert sind.
  if (ts ~ /^[0-9][0-9][0-9][0-9]-/) {
    if (erst == "" || sek(ts) < sek(erst)) erst = ts
    if (letzt == "" || sek(ts) > sek(letzt)) letzt = ts
  }
  l = sprache()
}

/Starting bridge for session/ && l != "" {
  n++; inst[l] = n; I_l[n] = l; I_start[n] = ts
}

l != "" && (l in inst) {
  i = inst[l]
  if ($0 ~ /Bridge is active/)            I_aktiv[i] = ts
  if ($0 ~ /Stopping bridge/)             I_stop[i] = ts
  if ($0 ~ /Organizer .* disconnected/)   I_ende[i] = "Sender weg"
  if ($0 ~ /Sent audio frame #/) {
    k = nummer()
    if (k > I_sent[i]) I_sent[i] = k
    if (I_s1t[i] == "") { I_s1t[i] = ts; I_s1n[i] = k }
    I_snt[i] = ts; I_snn[i] = k
  }
  if ($0 ~ /Received audio frame #/) { k = nummer(); if (k > I_recv[i]) I_recv[i] = k }
  if ($0 ~ /Received goAway/)                            I_goaway[i]++
  if ($0 ~ /Reconnecting Gemini WebSocket with handle/)  I_rc[i]++
  if ($0 ~ /reconnect setup complete/)                   I_rcok[i]++
  if ($0 ~ /Audio resumed after [0-9]+ms/) {
    match($0, /after [0-9]+ms/); g = substr($0, RSTART+6, RLENGTH-8) + 0
    I_lueck[i]++; if (g > I_maxl[i]) I_maxl[i] = g
  }
}

/Failed to start/ && l != ""     { fs[l]++; if (fs1[l] == "") fs1[l] = ts; fsl[l] = ts }
/Reusing existing bridge for/    { wieder++ }
/Unsubscribed from/              { abm++ }
/No more subscribers for/        { leer++ }
/Error requesting translation/   { anfFehler++ }
/code[:=] ?[0-9][0-9][0-9][0-9]/ {
  match($0, /code[:=] ?[0-9][0-9][0-9][0-9]/); c = substr($0, RSTART, RLENGTH); gsub(/[^0-9]/, "", c); codes[c]++
}
/reason[:=]/ {
  match($0, /reason[:=] ?/); r = substr($0, RSTART + RLENGTH, 60)
  gsub(/^[^A-Za-z]+/, "", r)
  # Derselbe Grund erscheint je nach Logzeile unterschiedlich abgeschnitten.
  # Auf die ersten 36 Zeichen kuerzen, damit er als ein Eintrag zaehlt.
  r = substr(r, 1, 36)
  if (r != "") gruende[r]++
}

END {
  print "======================================================================"
  print "Zeitraum im Log: " uhr(erst) " bis " uhr(letzt) " (UTC)"
  print "======================================================================"
  print ""
  print "Bridges, die erfolgreich liefen:"
  print "Nr  Spr.  Start    Ende      Min | Ein: s     Tok  | Aus: s     Tok  | Frames/s | goAway Reconn ok | Luecken max"
  si = 0; so = 0; fehlstarts = 0
  for (i = 1; i <= n; i++) {
    if (I_aktiv[i] == "") { fehlstarts++; continue }
    ende = (I_stop[i] != "") ? I_stop[i] : letzt
    dauer = (sek(ende) - sek(I_aktiv[i])) / 60
    ein = I_sent[i] / 10; aus = I_recv[i] * 0.25
    si += ein; so += aus
    dt = sek(I_snt[i]) - sek(I_s1t[i]); rate = (dt > 0) ? (I_snn[i] - I_s1n[i]) / dt : 0
    printf "%-3d %-5s %s %s %5.0f | %6.0f %7.0f | %6.0f %7.0f | %8.1f | %6d %6d %3d | %4d %5d ms %s\n", \
      i, I_l[i], uhr(I_aktiv[i]), uhr(ende), dauer, ein, ein*25, aus, aus*25, rate, \
      I_goaway[i], I_rc[i], I_rcok[i], I_lueck[i], I_maxl[i], I_ende[i]
  }
  print ""
  printf "Summe Eingabe:  %6.0f s = %5.1f min  ~ %8.0f Tokens  ~ %6.2f USD\n", si, si/60, si*25, si*25*3.5/1000000
  printf "Summe Ausgabe:  %6.0f s = %5.1f min  ~ %8.0f Tokens  ~ %6.2f USD\n", so, so/60, so*25, so*25*21/1000000
  print "  (Frames/s sollte bei etwa 10 liegen. Deutlich mehr = Audio wird doppelt gesendet.)"
  print ""
  print "Fehlgeschlagene Starts: " fehlstarts
  for (s in fs) printf "  %-5s %4d mal, von %s bis %s\n", s, fs[s], uhr(fs1[s]), uhr(fsl[s])
  print "Abgelehnte Anforderungen (Error requesting translation): " anfFehler+0
  print ""
  print "Hoerer: wiederverwendet " wieder+0 ", abgemeldet " abm+0 ", Bridge mangels Hoerer abgebaut " leer+0
  print ""
  print "Close-Codes:"
  for (c in codes) printf "  %s  %d mal\n", c, codes[c]
  print "Gruende (gekuerzt):"
  for (r in gruende) printf "  %4d x  %s\n", gruende[r], r
}
' "$f"
