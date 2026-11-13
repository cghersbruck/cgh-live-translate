/**
 * Speist eine Audiodatei als Sender ("Organizer") in den LiveKit-Raum ein.
 *
 * Zweck: T-10 reproduzierbar machen. Wer bewertet, soll nur zuhoeren muessen -
 * nicht gleichzeitig den Browser bedienen. Ausserdem hoeren so alle fuenf
 * Bewerter bitidentisches Eingangsmaterial ab derselben Stelle, was bei
 * manuellem Spulen im Tab nie exakt gelingt.
 *
 * Der Ablauf ist absichtlich so gebaut, dass das Skript wartet, bis eine
 * Uebersetzer-Bridge im Raum ist, und erst dann die Wiedergabe startet. Sonst
 * laeuft der Anfang der Predigt ins Leere, waehrend der Hoerer noch seine
 * Sprache waehlt.
 *
 * Aufruf (Beispiel):
 *   node scripts/demo-sender.mjs --session t10-en --start 12:00 --dauer 15:00
 *
 * Optionen:
 *   --session <id>    Session-/Raumname            (Standard: t10)
 *   --datei <pfad>    Audiodatei                   (Standard: aus --url geladen)
 *   --start <mm:ss>   Startpunkt in der Datei      (Standard: 12:00)
 *   --dauer <mm:ss>   Spieldauer                   (Standard: 15:00)
 *   --sofort          Nicht auf die Bridge warten, sofort abspielen
 *   --app <url>       Basis-URL der App            (Standard: http://localhost:3000)
 *
 * WICHTIG: Dieses Skript umgeht die Broadcast-Seite vollstaendig. Es prueft
 * daher NICHT den Browser-Audioweg (getUserMedia bzw. Tab-Audio). Fuer die
 * Uebersetzungsqualitaet ist das unerheblich - der Bridge ist gleich, woher
 * der Track kommt -, aber der Browser-Pfad braucht weiterhin einen eigenen
 * Test.
 */
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { Room, AudioSource, LocalAudioTrack, AudioFrame, TrackPublishOptions, TrackSource, RoomEvent } from "@livekit/rtc-node";

// ---------------------------------------------------------------- Argumente
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : fallback;
}
const hasFlag = (n) => process.argv.includes(`--${n}`);

/** "12:00" oder "720" -> 720 */
function toSeconds(v) {
  if (/^\d+$/.test(v)) return Number(v);
  const m = v.match(/^(\d+):(\d{1,2})$/);
  if (!m) throw new Error(`Zeitangabe nicht verstanden: "${v}" (erwartet mm:ss)`);
  return Number(m[1]) * 60 + Number(m[2]);
}
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const SESSION = arg("session", "t10");
const APP = arg("app", "http://localhost:3000").replace(/\/$/, "");
const START = toSeconds(arg("start", "12:00"));
const DAUER = toSeconds(arg("dauer", "15:00"));
const SOFORT = hasFlag("sofort");
const DATEI = arg("datei", null);

// ------------------------------------------------------------------ .env
function ladeEnv() {
  const out = {};
  if (!existsSync(".env.local")) return out;
  for (const zeile of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    if (!zeile || zeile.startsWith("#")) continue;
    const i = zeile.indexOf("=");
    if (i < 0) continue;
    out[zeile.slice(0, i).trim()] = zeile.slice(i + 1).trim();
  }
  return out;
}
const env = ladeEnv();
const LIVEKIT_URL = env.LIVEKIT_URL;
const PASSWORT = env.BROADCAST_PASSWORD || "";
if (!LIVEKIT_URL) {
  console.error("FEHLER: LIVEKIT_URL fehlt in .env.local");
  process.exit(1);
}
if (!DATEI || !existsSync(DATEI)) {
  console.error(`FEHLER: Audiodatei nicht gefunden. Bitte --datei <pfad> angeben.`);
  process.exit(1);
}

const ORGANIZER_NAME = "demo";
const ORGANIZER_IDENTITY = `organizer-${ORGANIZER_NAME}`;

// Zaehler fuer die Abschlussmeldung
let framesGesendet = 0;
let room = null;
let ff = null;
let beendet = false;

// ------------------------------------------------------------------ Ablauf
async function main() {
  console.log("=".repeat(62));
  console.log("DEMO-SENDER");
  console.log("=".repeat(62));
  console.log(`Datei:     ${DATEI}`);
  console.log(`Abschnitt: ${fmt(START)} bis ${fmt(START + DAUER)}  (Dauer ${fmt(DAUER)})`);
  console.log(`Session:   ${SESSION}`);
  console.log("");

  // 1) Session in der App anlegen. Das raeumt eine gleichnamige Altsession
  //    sauber ab (removeAllTranslations) und legt sie neu an.
  const anlegen = await fetch(`${APP}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      organizerName: ORGANIZER_NAME,
      eventId: SESSION,
      password: PASSWORT,
    }),
  });
  if (!anlegen.ok) {
    console.error(`FEHLER beim Anlegen der Session: HTTP ${anlegen.status}`, await anlegen.text());
    process.exit(1);
  }
  const sess = await anlegen.json();
  console.log(`Session angelegt: ${sess.sessionId}`);
  console.log("");
  console.log("  >>> HOERER-LINK:");
  console.log(`  >>> ${sess.joinUrl}`);
  console.log("");

  // 2) Organizer-Token ueber die App holen (nutzt deren eigene Logik,
  //    statt den Token hier selbst zu bauen).
  const tokUrl = new URL(`${APP}/api/token`);
  tokUrl.searchParams.set("room", sess.sessionId);
  tokUrl.searchParams.set("identity", ORGANIZER_IDENTITY);
  tokUrl.searchParams.set("role", "organizer");
  if (PASSWORT) tokUrl.searchParams.set("password", PASSWORT);
  const tokRes = await fetch(tokUrl);
  if (!tokRes.ok) {
    console.error(`FEHLER beim Token: HTTP ${tokRes.status}`, await tokRes.text());
    process.exit(1);
  }
  const { token } = await tokRes.json();

  // 3) Raum betreten und Audio-Track veroeffentlichen.
  room = new Room();
  await room.connect(LIVEKIT_URL, token, { autoSubscribe: false, dynacast: false });
  console.log(`Raum betreten als ${ORGANIZER_IDENTITY}`);

  // 48 kHz mono entspricht dem LiveKit-Default, den die Bridge ohnehin
  // anfordert - so wird nirgends unnoetig resampelt.
  const source = new AudioSource(48000, 1, 1000);
  const track = LocalAudioTrack.createAudioTrack("predigt", source);
  const opts = new TrackPublishOptions();
  opts.source = TrackSource.SOURCE_MICROPHONE;
  await room.localParticipant.publishTrack(track, opts);
  console.log("Audio-Track veroeffentlicht");
  console.log("");

  // 4) Auf die Uebersetzer-Bridge warten.
  if (!SOFORT) {
    const schonDa = [...room.remoteParticipants.values()].some((p) =>
      p.identity.startsWith("translator-")
    );
    if (!schonDa) {
      console.log("Warte auf die Uebersetzer-Bridge...");
      console.log("-> Jetzt den Hoerer-Link oeffnen und die Sprache waehlen.");
      await new Promise((resolve) => {
        const onJoin = (p) => {
          if (p.identity.startsWith("translator-")) {
            room.off(RoomEvent.ParticipantConnected, onJoin);
            console.log(`Bridge da: ${p.identity}`);
            resolve();
          }
        };
        room.on(RoomEvent.ParticipantConnected, onJoin);
      });
    } else {
      console.log("Bridge ist bereits im Raum.");
    }
    // Kurz Luft lassen, damit das Gemini-Setup der Bridge fertig wird.
    console.log("3 Sekunden Vorlauf...");
    await new Promise((r) => setTimeout(r, 3000));
  }

  // 5) Dekodieren und einspeisen.
  console.log("");
  console.log(`Wiedergabe laeuft (${fmt(DAUER)}). Abbruch mit Strg+C.`);
  console.log("");

  ff = spawn("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-ss", String(START),
    "-i", DATEI,
    "-t", String(DAUER),
    "-ac", "1",
    "-ar", "48000",
    "-f", "s16le",
    "-acodec", "pcm_s16le",
    "-",
  ]);
  ff.stderr.on("data", (d) => process.stderr.write(`[ffmpeg] ${d}`));

  const SAMPLES = 480;              // 10 ms bei 48 kHz
  const BYTES = SAMPLES * 2;        // 16 bit mono
  let rest = Buffer.alloc(0);
  const beginn = Date.now();
  let letzteMeldung = 0;

  for await (const stueck of ff.stdout) {
    rest = rest.length ? Buffer.concat([rest, stueck]) : stueck;
    while (rest.length >= BYTES) {
      const roh = rest.subarray(0, BYTES);
      rest = rest.subarray(BYTES);
      const pcm = new Int16Array(SAMPLES);
      for (let i = 0; i < SAMPLES; i++) pcm[i] = roh.readInt16LE(i * 2);
      // captureFrame staut zurueck, sobald die Queue voll ist. Das taktet
      // die Wiedergabe von selbst auf Echtzeit - ohne eigenes Timing.
      await source.captureFrame(new AudioFrame(pcm, 48000, 1, SAMPLES));
      framesGesendet++;
    }
    const lauf = Math.floor((Date.now() - beginn) / 1000);
    if (lauf >= letzteMeldung + 30) {
      letzteMeldung = lauf - (lauf % 30);
      console.log(`  ... ${fmt(lauf)} von ${fmt(DAUER)} gesendet`);
    }
  }

  await source.waitForPlayout();
  console.log("");
  console.log("Wiedergabe beendet.");
  await abschluss(beginn);
}

async function abschluss(beginn) {
  if (beendet) return;
  beendet = true;
  const lauf = (Date.now() - beginn) / 1000;
  console.log("=".repeat(62));
  console.log(`Gesendet: ${framesGesendet} Frames = ${fmt(framesGesendet / 100)} Audio`);
  console.log(`Laufzeit: ${fmt(lauf)}`);
  console.log("=".repeat(62));
  console.log("");
  console.log("Session wird NICHT automatisch beendet, damit die Bridge-Logs");
  console.log("auswertbar bleiben. Zum Abbauen:");
  console.log(`  curl -X DELETE -H "x-broadcast-password: $BROADCAST_PASSWORD" ${APP}/api/sessions/${SESSION}`);
  try { if (ff) ff.kill(); } catch {}
  try { if (room) await room.disconnect(); } catch {}
  process.exit(0);
}

process.on("SIGINT", () => {
  console.log("\nAbbruch durch Benutzer.");
  abschluss(Date.now());
});

main().catch((err) => {
  console.error("FEHLER:", err);
  try { if (ff) ff.kill(); } catch {}
  try { if (room) room.disconnect(); } catch {}
  process.exit(1);
});
