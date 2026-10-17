// İçe aktarma birim testleri (CSV ayrıştırma, başlık eşleme, gruplama, XML eşleme). npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupRows, groupToPayload, mapHeaders, parseCsv, toRawRows, errorRow, TEMPLATE_HEADERS, TEMPLATE_EXAMPLE } from "../lib/import.ts";
import { buildItems, parseXml } from "../worker/import-xml.ts";
import { suggestMapping, fieldStats, findItems } from "../lib/supplier-xml.ts";

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

const BAYILIK = { code: "bayilik", sku_prefix: "", sku_ascii: true, default_brand: "Eco Lounge", default_vat: 20, mapping: Object.fromEntries([["productCode", "model"], ["name", "title"], ["detail", "description"], ["category", "category"], ["price", "cost_price"], ["currency", "currency"], ["quantity", "stock"], ["barcode", "barcode"], ["desi", "desi"], ...Array.from({ length: 12 }, (_, i) => [`image${i + 1}`, "images"])]) } as any;
const xml = (items: string) => parseXml(`<?xml version="1.0"?><root><products>${items}</products></root>`);

test("BayilikXML: SKU, barkod tekrarı, para birimi, görseller, hatalar", () => {
  const { items, errors, total } = buildItems(xml(`
    <product><productCode>SFKXUCZZZBENZİNLİ-2</productCode><barcode>BX5XM1</barcode><name>Çakmak</name><price>12,5</price><currency>TL</currency><quantity>7.9</quantity><image1>http://a.com/1.jpg</image1><image2>ftp://x</image2><category>Hobi</category><detail><![CDATA[<b>d</b>]]></detail></product>
    <product><productCode>B-2</productCode><barcode>BX5XM1</barcode><name>Bardak</name><price>3</price><currency>USD</currency><quantity>-1</quantity></product>
    <product><productCode></productCode><barcode></barcode><name>Kodsuz</name></product>
    <product><productCode>C-3</productCode><name>X</name></product>`), BAYILIK);
  assert.equal(total, 4);
  assert.equal(items.length, 2);
  const [a, b] = items.map((i) => i.payload);
  assert.equal(a.sku, "SFKXUCZZZBENZNL-2");
  assert.equal(a.cost_price, 12.5);
  assert.equal(a.brand, "Eco Lounge");
  assert.equal(a.variants[0].stock, 7);
  assert.equal(a.variants[0].barcode, "BX5XM1");
  assert.deepEqual(a.images, ["https://a.com/1.jpg"]);
  assert.equal(a.description, "<b>d</b>");
  assert.equal(b.currency, "USD");
  assert.equal(b.variants[0].barcode, undefined);   // tekrar eden barkod düşer
  assert.equal(b.variants[0].stock, 0);
  assert.deepEqual(errors.map((e) => e.error), ["ürün kodu (model) yok", "ürün adı yok"]);
  // stok değişince içerik özeti aynı kalır
  const again = buildItems(xml(`<product><productCode>SFKXUCZZZBENZİNLİ-2</productCode><barcode>BX5XM1</barcode><name>Çakmak</name><price>12,5</price><currency>TL</currency><quantity>100</quantity><image1>http://a.com/1.jpg</image1><category>Hobi</category><detail><![CDATA[<b>d</b>]]></detail></product>`), BAYILIK);
  assert.equal(again.items[0].hash, items[0].hash);
});

test("başka tedarikçi: iç içe alanlar, öneri eşleme, varyant gruplama, önek, KDV hariç fiyat", () => {
  const parsed = parseXml(`<Urunler>
    <Urun><UrunKodu>TS-1</UrunKodu><VaryantKodu>TS-1-S</VaryantKodu><UrunAdi>Tişört</UrunAdi><AlisFiyati>100</AlisFiyati><KDV>10</KDV><Stok>3</Stok><Renk>Siyah</Renk><Beden>S</Beden><Resimler><Resim>https://r/1.jpg</Resim><Resim>https://r/2.jpg</Resim></Resimler><Barkod>8690000000012</Barkod></Urun>
    <Urun><UrunKodu>TS-1</UrunKodu><VaryantKodu>TS-1-M</VaryantKodu><UrunAdi>Tişört</UrunAdi><AlisFiyati>100</AlisFiyati><KDV>10</KDV><Stok>5</Stok><Renk>Siyah</Renk><Beden>M</Beden><Barkod>123</Barkod></Urun>
  </Urunler>`);
  const found = findItems(parsed);
  assert.equal(found.path, "Urunler.Urun");
  const paths = fieldStats(found.items).map((f) => f.path);
  assert.ok(paths.includes("Resimler.Resim"));
  const mapping = suggestMapping(paths);
  assert.equal(mapping["UrunKodu"], "model");
  assert.equal(mapping["VaryantKodu"], "variant_sku");
  assert.equal(mapping["AlisFiyati"], "cost_price");
  assert.equal(mapping["Resimler.Resim"], "images");
  const { items } = buildItems(parsed, { code: "t", mapping, sku_prefix: "TD-", price_includes_vat: false } as any);
  assert.equal(items.length, 1);
  const p = items[0].payload;
  assert.equal(p.sku, "TD-TS-1");
  assert.equal(p.cost_price, 110);                    // KDV hariç 100 + %10
  assert.equal(p.vat_rate, 10);
  assert.equal(p.variants.length, 2);
  assert.deepEqual(p.variants.map((v: any) => v.sku), ["TD-TS-1-S", "TD-TS-1-M"]);
  assert.deepEqual(p.variants[1].attributes, { Renk: "Siyah", Beden: "M" });
  assert.equal(p.variants[0].barcode, "8690000000012");
  assert.equal(p.variants[1].barcode, undefined);     // 3 haneli rakam GTIN değil
  assert.deepEqual(p.images, ["https://r/1.jpg", "https://r/2.jpg"]);
});
