// Yaş özelliği metindeki ay bilgisine uymalı (worker/core/attr-infer.ts). npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { inferAttribute, monthAge } from "../worker/core/attr-infer.ts";

const vals = ["0 - 1 Yaş", "1+ Yaş", "1 - 2 Yaş", "2 - 3 Yaş", "3+ Yaş", "Tüm Yaşlar"].map((name, id) => ({ id, name }));
const toy = "Anne, Bebek, Çocuk >>> Oyuncak >>> Eğitici Oyuncak";
const name = (a: string, t: string, d = "", c = "") => inferAttribute(a, vals, t, d, c)?.name ?? null;

test("0-3 aylık biberon 1+ Yaş olmaz", () => {
  assert.equal(name("Yaş", "Biberon 150 ml", "0-3 aylık bebekler içindir", "Bebek Beslenme"), "0 - 1 Yaş");
});

test("ay yazan oyuncak 3+ kuralına düşmez", () => {
  assert.equal(name("Yaş Aralığı", "Geometrik Şekiller +12 ay", "", toy), "1 - 2 Yaş");
  assert.equal(name("Yaş Aralığı", "Yarışçı Yumurtalar 12-36 ay", "", toy), "1 - 2 Yaş");
  assert.equal(name("Yaş Aralığı", "Sarı Bebe Flatörü 70 cm (6-12Ay)", "", toy), "0 - 1 Yaş");
});

test("yaş yazmayan oyuncak K kararıyla 3+ kalır, yazan oyuncak yazıldığı gibi", () => {
  assert.equal(name("Yaş Aralığı", "Peluş Tavşan 25 Cm", "", toy), "3+ Yaş");
  assert.equal(name("Yaş Aralığı", "Puzzle Seti 2-3 yaş", "", toy), "2 - 3 Yaş");
});

test("1+1 adet ifadesi yaş sayılmaz", () => {
  assert.notEqual(name("Yaş", "Oyun Hamuru 1+1 Set", "", toy), "1+ Yaş");
});

test("garanti süresi ve ay geçen başka ürünler yaş değildir", () => {
  assert.equal(monthAge("Oyuncak Robot", "24 ay garanti", toy), null);
  assert.equal(monthAge("Telefon Kılıfı 12 ay", "", "Aksesuar"), null);
  assert.deepEqual(monthAge("Biberon", "0-3 aylık", ""), { from: 0, to: 3 });
});
