// Açıklaması eksik ürünler için kurallı taslak (worker/desc-fill.ts). npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { draftFromTitle } from "../worker/desc-fill.ts";
import { checkDescription, cleanHtml } from "../worker/core/desc-check.ts";

test("taslak izinli HTML üretir ve panel kontrolünden geçer", () => {
  const html = draftFromTitle("CAT6 Ethernet Kablosu 3 m", "Elektronik >>> Data Kablosu")!;
  assert.match(html, /^<p>CAT6 Ethernet Kablosu 3 m<\/p><ul><li>Ürün türü: Data Kablosu<\/li><\/ul><p>/);
  assert.equal(cleanHtml(html).error, undefined);
  const c = checkDescription(html, { title: "CAT6 Ethernet Kablosu 3 m Elektronik >>> Data Kablosu", description: "" });
  assert.deepEqual(c.reasons, []);
});

test("tedarikçinin kısa metni korunur, başlığın kopyasıysa tekrar yazılmaz", () => {
  assert.match(draftFromTitle("Küçük Uzay Su Tabancası", "Oyuncak", "Küçük uzay su tabancasıdır.")!, /<p>Küçük uzay su tabancasıdır\.<\/p>/);
  assert.equal((draftFromTitle("Küçük Uzay Su Tabancası", "Oyuncak", "küçük uzay su tabancası")!.match(/uzay su/gi) ?? []).length, 1);
});

test("renk yalnızca parantezde ya da son kelimeyse yazılır", () => {
  assert.doesNotMatch(draftFromTitle("Mavi Işık Filtreli Ekran Koruyucu Cam", "Ekran Koruyucu")!, /Renk:/);
  assert.match(draftFromTitle("Dokunmatik Ekran Çıtalı (Beyaz)", "Ekran Parçaları")!, /Renk: Beyaz/);
});

test("özel karakterler kaçırılır, kısa başlık taslak üretmez", () => {
  const html = draftFromTitle("Kablo A&B x>y model", "Kablo")!;
  assert.match(html, /A&amp;B x&gt;y/);
  assert.equal(cleanHtml(html).error, undefined);
  assert.equal(draftFromTitle("Kısa", "Kablo"), null);
});
