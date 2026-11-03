import test from 'node:test';
import assert from 'node:assert/strict';
import { JSON_BEGIN, JSON_END, extractJson } from '../src/json-io.js';

test('extractJson slices JSON payload between delimiters', () => {
  const payload = '{"count":42}';
  const raw = `noise before\n${JSON_BEGIN}${payload}${JSON_END}\nnoise after`;
  assert.equal(extractJson(raw), payload);
});

test('extractJson trims whitespace around the payload', () => {
  const raw = `${JSON_BEGIN}\n  {"a":1}  \n${JSON_END}`;
  assert.equal(extractJson(raw), '{"a":1}');
});

test('extractJson finds JSON_END *after* JSON_BEGIN even when a stray END appears earlier', () => {
  const stray = `garbage ${JSON_END} more garbage`;
  const payload = '{"ok":true}';
  const raw = `${stray}\n${JSON_BEGIN}${payload}${JSON_END}\ntrailer`;
  assert.equal(extractJson(raw), payload);
});

test('extractJson returns raw output when JSON_BEGIN is missing', () => {
  const raw = `just some output ${JSON_END} without a begin marker`;
  assert.equal(extractJson(raw), raw);
});

test('extractJson returns raw output when JSON_END is missing after JSON_BEGIN', () => {
  const raw = `prefix ${JSON_BEGIN} {"unterminated":1} no end here`;
  assert.equal(extractJson(raw), raw);
});
