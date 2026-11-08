import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readdir } from 'node:fs/promises';
const modulePath = './ui-locale.ts';
const { normalizeLocale, selectLocale, messages, locales } = await import(modulePath) as typeof import('./ui-locale');

test('selects supported browser languages and safely falls back', () => {
  assert.equal(normalizeLocale('en-US'), 'en');
  assert.equal(normalizeLocale('zh-CN'), 'zh-Hans');
  assert.equal(normalizeLocale('zh-Hans'), 'zh-Hans');
  assert.equal(normalizeLocale('es-MX'), 'es');
  assert.equal(normalizeLocale('unknown'), 'de');
  assert.equal(normalizeLocale(null), 'de');
});

test('uses supported browser preferences when storage is invalid', () => {
  assert.equal(selectLocale('invalid', ['fr-FR', 'en-US']), 'en');
  assert.equal(selectLocale(null, ['zh-TW']), 'zh-Hans');
  assert.equal(selectLocale('en-US', ['es-ES']), 'es');
  assert.equal(selectLocale('ru', ['en-US']), 'ru');
});

test('listener counts use the locale plural forms', async () => {
  const path = './review-messages.ts';
  const { listenerLabel } = await import(path) as typeof import('./review-messages');
  assert.equal(listenerLabel(1, 'ru'), '1 слушатель');
  assert.equal(listenerLabel(2, 'ru'), '2 слушателя');
  assert.equal(listenerLabel(5, 'ru'), '5 слушателей');
  assert.equal(listenerLabel(1, 'en'), '1 listener');
  assert.equal(listenerLabel(2, 'en'), '2 listeners');
});

test('all message catalogs have complete locale entries', async () => {
  const files = (await readdir(new URL('.', import.meta.url))).filter((name) => name.endsWith('-messages.ts'));
  for (const file of files) {
    const exports = await import(`./${file}`);
    for (const catalog of Object.values(exports)) {
      if (!catalog || typeof catalog !== 'object' || !('de' in catalog)) continue;
      const entries = catalog as Record<string, Record<string, unknown>>;
      assert.deepEqual(Object.keys(entries).sort(), [...locales].sort(), file);
      const keys = Object.keys(entries.de).sort();
      for (const locale of locales) {
        assert.deepEqual(Object.keys(entries[locale]).sort(), keys, `${file}: ${locale}`);
        for (const value of Object.values(entries[locale])) {
          assert.ok(value !== undefined && value !== null, `${file}: ${locale}`);
          if (typeof value === 'string') assert.ok(value.trim(), `${file}: ${locale}`);
          if (typeof value === 'object' && value !== null) {
            for (const item of Object.values(value)) assert.ok(typeof item === 'string' && item.trim(), `${file}: ${locale}`);
          }
        }
      }
    }
  }
});

test('each language contains the same nonempty UI messages', () => {
  assert.deepEqual(Object.keys(messages).sort(), [...locales].sort());
  const keys = Object.keys(messages.de).sort();
  for (const locale of locales) {
    assert.deepEqual(Object.keys(messages[locale]).sort(), keys);
    for (const value of Object.values(messages[locale])) assert.ok(value.trim());
  }
});
