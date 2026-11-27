// Tedarikçiler arası ürün eşleştirme (K 28.11, migration 104). npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { sigOf, tokens, hamming, imageClose, isGtin, buildGroups, candidates, type XMember } from "../worker/core/xsup.ts";

const H = "f8d88fd69266b821", H2 = "f8d88fd69266b823" /* 1 bit fark */, HFAR = "0727702d6d99d4de";
const m = (id: string, source: string, title: string, o: Partial<XMember> = {}): XMember => ({ id, source, title, ph: H, dh: H, ...o });

test("imza: Türkçe normalleştirme, sıra ve tekrar önemsiz", () => {
  assert.equal(sigOf("Şık Akıllı Saat Spor"), sigOf("spor SAAT akilli sik saat"));
  assert.equal(sigOf("İki kelime"), null); // 3 sözcükten az
  assert.ok(!tokens("Kalem 5 adet ve set x").includes("adet"));
});

test("Hamming ve görsel yakınlığı", () => {
  assert.equal(hamming(H, H), 0);
  assert.equal(hamming(H, H2), 1);
  assert.ok(hamming(H, HFAR) > 6);
  assert.equal(hamming(null, H), 99);
  assert.ok(imageClose({ ph: H, dh: HFAR }, { ph: H2, dh: H })); // biri yakınsa yeter
  assert.ok(!imageClose({ ph: H, dh: H }, { ph: HFAR, dh: HFAR }));
});

test("GTIN: yalnızca rakam ve 8/12/13/14 hane", () => {
  assert.ok(isGtin("8690000000012")); assert.ok(!isGtin("AKYI354F741F")); assert.ok(!isGtin("123456")); assert.ok(!isGtin(null));
});

test("aynı imza + yakın görsel + farklı tedarikçi = grup", () => {
  const g = buildGroups([m("a", "xml:bezos", "Mini Taşınabilir Boyun Fanı Mavi"), m("b", "xml:akillibayi", "Mavi Mini Taşınabilir Boyun Fanı", { ph: H2 })]);
  assert.equal(g.length, 2); assert.equal(g[0].group_key, g[1].group_key); assert.equal(g[0].method, "sig+img");
});

test("aynı imza ama görsel farklıysa (renk/model) grup yok", () => {
  assert.equal(buildGroups([m("a", "xml:bezos", "Mini Taşınabilir Boyun Fanı Mavi"), m("b", "xml:akillibayi", "Mavi Mini Taşınabilir Boyun Fanı", { ph: HFAR, dh: HFAR })]).length, 0);
});

test("görsel özeti yoksa imza tek başına yetmez", () => {
  assert.equal(buildGroups([m("a", "xml:bezos", "Mini Taşınabilir Boyun Fanı Mavi", { ph: null, dh: null }), m("b", "xml:akillibayi", "Mavi Mini Taşınabilir Boyun Fanı", { ph: null, dh: null })]).length, 0);
});

test("aynı tedarikçinin iki ürünü doğrudan bağlanmaz", () => {
  assert.equal(buildGroups([m("a", "xml:bezos", "Mini Taşınabilir Boyun Fanı Mavi"), m("b", "xml:bezos", "Mavi Mini Taşınabilir Boyun Fanı")]).length, 0);
});

test("farklı imza (sayı/model farkı) grup yapmaz", () => {
  assert.equal(buildGroups([m("a", "xml:bezos", "Xiaomi Mi 8 Lite Batarya Pil"), m("b", "xml:akillibayi", "Xiaomi Mi 9 Lite Batarya Pil")]).length, 0);
});

test("aynı gerçek barkod + ortak sözcük = grup; ortak sözcük yoksa ya da iç barkodsa grup yok", () => {
  const t = "Bluetooth Kulaklık Siyah Kablosuz";
  assert.equal(buildGroups([m("a", "xml:bezos", t, { gtin: "8690000000012", ph: null, dh: null }), m("b", "xml:colezium", "Kablosuz Siyah Kulaklık Bluetooth Yeni", { gtin: "8690000000012", ph: null, dh: null })])[0]?.method, "gtin");
  assert.equal(buildGroups([m("a", "xml:bezos", t, { gtin: "8690000000012", ph: null, dh: null }), m("b", "xml:colezium", "Mutfak Rendesi Paslanmaz Çelik", { gtin: "8690000000012", ph: null, dh: null })]).length, 0);
  assert.equal(buildGroups([m("a", "xml:bezos", t, { gtin: "AKYI123", ph: null, dh: null }), m("b", "xml:colezium", t, { gtin: "AKYI123", ph: null, dh: null })]).length, 0);
});

test("grup anahtarı kararlı; üç tedarikçi tek grupta", () => {
  const ms = [m("c", "xml:colezium", "Mini Taşınabilir Boyun Fanı Mavi"), m("a", "xml:bezos", "Mini Taşınabilir Boyun Fanı Mavi"), m("b", "xml:akillibayi", "Mini Taşınabilir Boyun Fanı Mavi")];
  const g = buildGroups(ms), g2 = buildGroups([...ms].reverse());
  assert.equal(new Set(g.map((x) => x.group_key)).size, 1); assert.equal(g.length, 3);
  assert.equal(g[0].group_key, g2[0].group_key);
});

test("aday: yalnızca >=2 tedarikçili ve pazaryerinde ilanı olan kovalar", () => {
  const t = "Mini Taşınabilir Boyun Fanı Mavi";
  assert.equal(candidates([m("a", "xml:bezos", t, { live: ["hepsiburada"] }), m("b", "xml:akillibayi", t)]).length, 2);
  assert.equal(candidates([m("a", "xml:bezos", t), m("b", "xml:akillibayi", t)]).length, 0); // hiçbirinin ilanı yok
  assert.equal(candidates([m("a", "xml:bezos", t, { live: ["hepsiburada"] }), m("b", "xml:bezos", t)]).length, 0); // tek tedarikçi
});
