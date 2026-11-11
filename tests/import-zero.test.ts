// XML'den kalkan ürünlerin stoğunu sıfırlama kuralı (worker/import-xml.ts zeroAllowed). npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { zeroAllowed } from "../worker/import-xml.ts";

const now = Date.parse("2026-11-12T12:00:00Z");
const ago = (h: number) => new Date(now - h * 3600_000).toISOString();

test("az ürün kalkınca her zaman sıfırlanır", () => {
  assert.equal(zeroAllowed(40, 10000, 10000, [], now).ok, true);
  assert.equal(zeroAllowed(2000, 10000, 10000, [], now).ok, true);
});

test("XML bir anda küçülünce sıfırlanmaz", () => {
  const prev = [{ total: 35000, at: ago(1) }, { total: 35000, at: ago(2) }, { total: 35000, at: ago(20) }];
  assert.equal(zeroAllowed(26000, 10600, 10600, prev, now).ok, false);
});

test("XML 12 saatten uzun süredir aynı küçük boyuttaysa sıfırlanır", () => {
  const prev = [{ total: 10601, at: ago(1) }, { total: 10601, at: ago(6) }, { total: 10590, at: ago(13) }, { total: 21500, at: ago(30) }];
  const r = zeroAllowed(26542, 10601, 10601, prev, now);
  assert.equal(r.ok, true, r.why);
});

test("son 12 saatte büyük XML gelmişse küçülme geçici sayılır", () => {
  const prev = [{ total: 10601, at: ago(1) }, { total: 21500, at: ago(5) }, { total: 10601, at: ago(13) }, { total: 10601, at: ago(20) }];
  assert.equal(zeroAllowed(26542, 10601, 10601, prev, now).ok, false);
});

test("elle zorlama", () => {
  assert.equal(zeroAllowed(26542, 10601, 10601, [], now, true).ok, true);
});
