// İçe aktarma birim testleri (CSV ayrıştırma, başlık eşleme, gruplama, XML eşleme). npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupRows, groupToPayload, mapHeaders, parseCsv, toRawRows, errorRow, TEMPLATE_HEADERS, TEMPLATE_EXAMPLE } from "../lib/import.ts";
import { mapXml } from "../worker/import-xml.ts";

test("CSV: ayraç tahmini, tırnak, BOM, boş satır", () => {
  const t = parseCsv('﻿Model kodu;Ürün adı;Açıklama\nA-1;"Kesme; Tahtası";"Satır 1\nSatır 2"\n\n;;\nB-2;Bardak;"Çift ""tırnak"""\n');
  assert.equal(t.length, 3);
  assert.deepEqual(t[1], ["A-1", "Kesme; Tahtası", "Satır 1\nSatır 2"]);
  assert.equal(t[2][2], 'Çift "tırnak"');
  assert.equal(parseCsv("a,b\n1,2").at(1)?.[1], "2");
});

test("başlık eşleme: Türkçe/İngilizce eşanlamlılar ve numaralı görseller", () => {
  const f = mapHeaders(["Ürün Kodu", "Başlık", "BARKOD", "Stok Adedi", "Alış Fiyatı", "Görsel 1", "image_2", "Bilinmeyen", "KDV Oranı"]);
  assert.deepEqual(f, ["model", "title", "barcode", null, "cost_price", "images", "images", null, "vat_rate"]);
  assert.equal(mapHeaders(["Stok"])[0], "stock");
});

test("şablon: varyantlı ürün tek ürün olarak gruplanır", () => {
  const table = [TEMPLATE_HEADERS, ...TEMPLATE_EXAMPLE];
  const groups = groupRows(toRawRows(table, mapHeaders(TEMPLATE_HEADERS)));
  assert.equal(groups.length, 2);
  const [kesme, tshirt] = groups.map(groupToPayload);
  assert.equal(kesme.sku, "KESME-01");
  assert.equal(kesme.cost_price, "149.90");
  assert.equal(kesme.status, "active");
  assert.deepEqual(kesme.attributes, { Malzeme: "Bambu", "Menşei": "Türkiye" });
  assert.equal(kesme.variants[0].sku, "KESME-01");
  assert.equal(tshirt.variants.length, 2);
  assert.deepEqual(tshirt.variants[1], { sku: "TSHIRT-01-SYH-L", attributes: { Renk: "Siyah", Beden: "L" }, stock: "8" });
  assert.equal(tshirt.vat_rate, "10");
  assert.equal(errorRow(groups[1], "variants.1.barcode"), 4);
  assert.equal(errorRow(groups[1], "title"), 3);
});

test("kısmi dosya: yalnızca olan alanlar yüke girer (mevcut değerler korunur)", () => {
  const table = [["Model kodu", "Stok"], ["A-1", "5"], ["A-2", "-3"]];
  const [a, b] = groupRows(toRawRows(table, mapHeaders(table[0]))).map(groupToPayload);
  assert.deepEqual(a, { sku: "A-1", variants: [{ sku: "A-1", stock: "5" }] });
  assert.equal(b.variants[0].stock, "0");
  assert.equal(groupToPayload(groupRows(toRawRows([["Fiyat", "KDV"], ["1.234,50", "%18"]], mapHeaders(["Fiyat", "KDV"])))[0]).cost_price, "1234.50");
});

test("XML eşleme: SKU, barkod tekrarı, para birimi, görseller, hatalar", () => {
  const { items, errors } = mapXml([
    { productCode: "SFKXUCZZZBENZİNLİ-2", barcode: "BX5XM1", name: "Çakmak", price: "12,5", currency: "TL", quantity: "7.9", image1: "http://a.com/1.jpg", image2: "ftp://x", category: "Hobi", detail: "d" },
    { productCode: "B-2", barcode: "BX5XM1", name: "Bardak", price: "3", currency: "USD", quantity: "-1" },
    { productCode: "B-2", barcode: "X", name: "Tekrar", price: "1" },
    { productCode: "", barcode: "", name: "Kodsuz" },
    { productCode: "C-3", name: "Kuruş", currency: "GBP" },
  ]);
  assert.equal(items.length, 2);
  const [a, b] = items.map((i) => i.payload);
  assert.equal(a.sku, "SFKXUCZZZBENZNL-2");
  assert.equal(a.cost_price, 12.5);
  assert.equal(a.variants[0].stock, 7);
  assert.deepEqual(a.images, ["https://a.com/1.jpg"]);
  assert.equal(a.source, "xml:bayilik");
  assert.equal(b.currency, "USD");
  assert.equal(b.variants[0].barcode, null);   // tekrar eden barkod düşer
  assert.equal(b.variants[0].stock, 0);
  assert.deepEqual(errors.map((e) => e.row), [3, 4, 5]);
  // stok değişince içerik özeti aynı kalır
  const again = mapXml([{ productCode: "SFKXUCZZZBENZİNLİ-2", barcode: "BX5XM1", name: "Çakmak", price: "12,5", currency: "TL", quantity: "100", image1: "http://a.com/1.jpg", category: "Hobi", detail: "d" }]);
  assert.equal(again.items[0].hash, items[0].hash);
});
