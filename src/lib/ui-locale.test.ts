import { strict as assert } from "node:assert";
import { test } from "node:test";
const modulePath = "./ui-locale.ts";
const { normalizeLocale, selectLocale } = await import(modulePath) as typeof import("./ui-locale");

test("selects supported browser languages and safely falls back", () => {
  assert.equal(normalizeLocale("en-US"), "en");
  assert.equal(normalizeLocale("zh-CN"), "zh-Hans");
  assert.equal(normalizeLocale("zh-Hans"), "zh-Hans");
  assert.equal(normalizeLocale("es-MX"), "es");
  assert.equal(normalizeLocale("unknown"), "de");
  assert.equal(normalizeLocale(null), "de");
});

test("uses supported browser preferences when storage is invalid", () => {
  assert.equal(selectLocale("invalid", ["fr-FR", "en-US"]), "en");
  assert.equal(selectLocale(null, ["zh-TW"]), "zh-Hans");
  assert.equal(selectLocale("en-US", ["es-ES"]), "es");
  assert.equal(selectLocale("ru", ["en-US"]), "ru");
  assert.equal(selectLocale(null, ["fr-FR"]), "de");
});
