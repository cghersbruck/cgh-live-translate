import { test } from "node:test";
import assert from "node:assert/strict";
const pfad = "./hoerer-identitaet.ts";
const { istHoererIdentitaet } = await import(pfad) as typeof import("./hoerer-identitaet");

test("Hörer-Identität: nur attendee-Muster ist erlaubt", () => {
  assert.equal(istHoererIdentitaet("attendee-k3j9x2"), true);
  assert.equal(istHoererIdentitaet("organizer-host"), false);
  assert.equal(istHoererIdentitaet("translator-en"), false);
  assert.equal(istHoererIdentitaet("attendee-"), false);
  assert.equal(istHoererIdentitaet("attendee-abc\norganizer-host"), false);
  assert.equal(istHoererIdentitaet("xattendee-abc"), false);
});
