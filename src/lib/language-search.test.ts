import { strict as assert } from "node:assert";
import { test } from "node:test";
const modulePath = "./language-search.ts";
const { languageLabel, matchesLanguage } = await import(modulePath) as typeof import("./language-search");

const spanish = { code: "es", name: "Spanish", flag: "🇪🇸" };
const german = { code: "de", name: "German", flag: "🇩🇪" };

test("German names are displayed and searchable alongside original names and codes", () => {
  assert.equal(languageLabel(spanish, "de"), "Spanisch");
  assert.ok(matchesLanguage(spanish, "de", "spanisch"));
  assert.ok(matchesLanguage(spanish, "de", "Spanish"));
  assert.ok(matchesLanguage(spanish, "de", "ES"));
  assert.ok(!matchesLanguage(spanish, "de", "französisch"));
});

test("Spanish names are displayed and searchable", () => {
  assert.equal(languageLabel(german, "es"), "alemán");
  assert.ok(matchesLanguage(german, "es", "Alemán"));
  assert.ok(matchesLanguage(german, "es", "aleman"));
  assert.ok(matchesLanguage(german, "es", " Alemán "));
  assert.ok(matchesLanguage(german, "zh-Hans", "德语"));
});

test("invalid language codes fall back to the original name", () => {
  const unknown = { code: "not_a_locale", name: "Known name", flag: "" };
  assert.equal(languageLabel(unknown, "de"), "Known name");
  assert.ok(matchesLanguage(unknown, "de", "known"));
});
