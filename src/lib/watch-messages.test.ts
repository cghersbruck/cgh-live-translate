import { strict as assert } from "node:assert";
import { test } from "node:test";
const localePath = "./ui-locale.ts";
const messagesPath = "./watch-messages.ts";
const { locales } = await import(localePath) as typeof import("./ui-locale");
const { watchMessages } = await import(messagesPath) as typeof import("./watch-messages");

// Fehlende Schlüssel fängt TypeScript ab. Hier geht es um leere Texte
// und darum, dass jede Sprache genau die Schlüssel des Deutschen führt.
test("every locale has a catalog", () => {
  assert.deepEqual(Object.keys(watchMessages).sort(), [...locales].sort());
});

test("every locale has the same keys with nonempty texts", () => {
  const keys = Object.keys(watchMessages.de).sort();
  for (const locale of locales) {
    assert.deepEqual(Object.keys(watchMessages[locale]).sort(), keys, locale);
    for (const [key, value] of Object.entries(watchMessages[locale])) {
      assert.ok(value.trim(), `${locale}.${key}`);
    }
  }
});
