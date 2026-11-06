// Hepsibayi XML (dokümandaki gerçek örnekler, kaynaklar/tedarikciler/hepsibayi): iç içe varyant, "Hata:" görsel, başlık sonu depo kodu. npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { XMLParser } from "fast-xml-parser";
import { findItems, itemsToGroups, supplierPayload } from "../lib/supplier-xml.ts";

const xml = `<?xml version="1.0" encoding="UTF-8"?><products>
  <product><title>Siyah Özel Bölgesi Açık Fantazi Külotlu Çorap TM0367</title><stock_code>HS9482-1771</stock_code><barcode>HS2872688636</barcode><brand>Hepsibayi</brand>
    <desi>1</desi><repo>13</repo><category>Fantazi İç Giyim &gt;&gt;&gt; Fantazi Külotlu Çorap</category><stock>1195</stock><sale_price>158</sale_price><currency>TL</currency><tax>10</tax>
    <description>Siyah çorap</description><image_count>2</image_count><image_1>https://cdn.qukasoft.com/a-1.png</image_1><image_2>https://cdn.qukasoft.com/a-2.png</image_2>
    <variants><variant><barcode>HS5474888860</barcode><stock>246</stock><name>Beden</name><value>XS</value><color>Siyah</color></variant>
      <variant><barcode>HS7139104000</barcode><stock>244</stock><name>Beden</name><value>S</value><color>Siyah</color></variant></variants></product>
  <product><title>ALLY Kablosuz sarj Göz Korumali Portatif Led Masa Lambasi Kalemlik-(5775)</title><stock_code>HS8618-2726</stock_code><barcode>HS8939937757</barcode><brand>Hepsibayi</brand>
    <desi>1</desi><category>ELEKTRONİK &gt;&gt;&gt; Cep Telefonu</category><stock>686</stock><sale_price>465.5</sale_price><currency>TL</currency><tax>20</tax><description>Lamba</description>
    <image_1>https://hepsicdn.com.tr/static/product/hbnet0e8d7c93_4906301.png</image_1><image_2>https://hepsicdn.com.tr/static/product/Hata: Görsel indirilemedi.</image_2>
    <image_3>https://hepsicdn.com.tr/static/product/hbnet0e8d7c93_4906303.png</image_3><variants/></product>
  <product><title>24K 1.4V 3D ALTIN UÇLU 25 METRE ÖRGÜLÜ POŞETLİ HDMI KABLO (4767)</title><stock_code>HS7374-7898</stock_code><barcode>HS2789703748</barcode>
    <category>ELEKTRONİK</category><stock>1</stock><sale_price>856.53</sale_price><currency>TL</currency><tax>20</tax><image_1>https://www.cdnaws.com/x.JPG</image_1><variants/></product>
</products>`;
const mapping: any = { title: "title", stock_code: "model", barcode: "barcode", brand: "brand", desi: "desi", category: "category", stock: "stock", sale_price: "cost_price",
  currency: "currency", tax: "vat_rate", description: "description", image_1: "images", image_2: "images", image_3: "images",
  "variants.variant.barcode": "barcode", "variants.variant.stock": "stock", "variants.variant.color": "color" };

test("Hepsibayi: varyantlar ayrı stok/barkod, Hata görseli atlanır, başlıktaki depo kodu atılır", () => {
  const { items, path } = findItems(new XMLParser({ ignoreAttributes: true, trimValues: true, parseTagValue: false }).parse(xml));
  assert.equal(path, "products.product"); assert.equal(items.length, 3);
  const groups = itemsToGroups(items, mapping);
  const seen = new Set<string>();
  const out = groups.map((g) => supplierPayload(g, { code: "hepsibayi", name: "Hepsibayi", sku_prefix: "HB-" } as any, seen));
  const [corap, lamba, kablo] = out.map((x) => x.payload);
  assert.ok(corap && lamba && kablo, JSON.stringify(out.map((x) => x.error)));
  assert.equal(corap.variants.length, 2);
  assert.deepEqual(corap.variants.map((v: any) => [v.barcode, v.stock]), [["HS5474888860", 246], ["HS7139104000", 244]]);
  assert.ok(corap.variants.every((v: any) => /XS|S/.test(JSON.stringify(v))), "beden");
  assert.equal(lamba.title, "ALLY Kablosuz sarj Göz Korumali Portatif Led Masa Lambasi Kalemlik");
  assert.equal(kablo.title, "24K 1.4V 3D ALTIN UÇLU 25 METRE ÖRGÜLÜ POŞETLİ HDMI KABLO");
  const imgs = JSON.stringify(lamba.images ?? lamba);
  assert.ok(!/Hata/.test(imgs) && /4906301/.test(imgs) && /4906303/.test(imgs), imgs);
  assert.equal(corap.title, "Siyah Özel Bölgesi Açık Fantazi Külotlu Çorap TM0367", "kod olmayan başlık değişmez");
});

test("Hepsibayi: tek varyantlı üründe 'RZ' renk sayılmaz; gerçek renk kalır", () => {
  const x = `<products><product><title>Ally Loca 2500uv 50g-(5775)</title><stock_code>HS4198-4069</stock_code><barcode>HS4047040576</barcode><stock>92</stock><sale_price>220.28</sale_price><currency>TL</currency><tax>20</tax>
    <image_1>https://hepsicdn.com.tr/a.png</image_1><variants><variant><barcode>HS5265798466</barcode><stock>92</stock><price>220.28</price><name>Renk</name><value>RZ</value><color>RZ</color></variant></variants></product>
    <product><title>Filtre</title><stock_code>HS4491-6324</stock_code><barcode>HS5083137840</barcode><stock>547</stock><sale_price>88.52</sale_price><currency>TL</currency><tax>20</tax>
    <image_1>https://hepsicdn.com.tr/b.png</image_1><variants><variant><barcode>HS6754511399</barcode><stock>547</stock><price>88.52</price><name>Renk</name><value>Beyaz</value><color>Beyaz</color></variant></variants></product></products>`;
  const { items } = findItems(new XMLParser({ ignoreAttributes: true, trimValues: true, parseTagValue: false }).parse(x));
  const m = { ...mapping, "variants.variant.price": "cost_price" };
  const [a, b] = itemsToGroups(items, m).map((g) => supplierPayload(g, { code: "hepsibayi", name: "Hepsibayi", sku_prefix: "HBY" } as any, new Set()).payload);
  assert.ok(!a.variants[0].attributes?.Renk, JSON.stringify(a.variants[0]));
  assert.equal(b.variants[0].attributes?.Renk, "Beyaz");
  assert.equal(a.cost_price, 220.28);
});

import { flattenVarDeger } from "../lib/supplier-xml.ts";
test("Bezos varyantı: seçenek adı/değeri, kendi kodu, BZ barkodu ve KDV eklenmiş kendi fiyatı", () => {
  const xml = flattenVarDeger(`<urunler><urun><stok_kodu>RPPN06K</stok_kodu><isim>PARMA Halı</isim><barkod>BZCREA1</barkod><alis_fiyat>1000,00</alis_fiyat><kdv>10</kdv><stok>5</stok><varyasyonlar>
    <varyasyon><kod>PN06K08080</kod><stok>3</stok><var_fiyat>1000,00</var_fiyat><var_deger isim="EBAT">80X80</var_deger></varyasyon>
    <varyasyon><kod>BZPN06K200</kod><stok>2</stok><var_fiyat>2.500,50</var_fiyat><var_deger isim="EBAT">200X290</var_deger><var_deger isim="Renk">Krem</var_deger></varyasyon>
  </varyasyonlar></urun><urun><stok_kodu>TEK1</stok_kodu><isim>Tek Ürün</isim><barkod>BZTEK1</barkod><alis_fiyat>100,00</alis_fiyat><kdv>20</kdv><stok>9</stok></urun></urunler>`);
  const items = new XMLParser({ ignoreAttributes: true, trimValues: true, parseTagValue: false }).parse(xml).urunler.urun;
  const m: any = { stok_kodu: "model", isim: "title", barkod: "barcode", alis_fiyat: "cost_price", kdv: "vat_rate", stok: "stock",
    "varyasyonlar.varyasyon.kod": "variant_sku", "varyasyonlar.varyasyon.stok": "stock", "varyasyonlar.varyasyon.var_fiyat": "cost_price", "varyasyonlar.varyasyon.var_barkod": "barcode" };
  const [a, b] = itemsToGroups(items, m).map((g) => supplierPayload(g, { code: "bezos", name: "Bezos", sku_prefix: "BZS", price_includes_vat: false } as any, new Set()).payload);
  assert.equal(a.sku, "BZSRPPN06K");
  assert.equal(a.cost_price, 1100);
  assert.deepEqual(a.variants.map((v: any) => [v.sku, v.barcode, v.stock, v.cost_price, v.attributes]), [
    ["BZSPN06K08080", "BZPN06K08080", 3, undefined, { Beden: "80X80" }],
    ["BZSBZPN06K200", "BZPN06K200", 2, 2750.55, { Renk: "Krem", Beden: "200X290" }],
  ]);
  assert.equal(b.sku, "BZSTEK1", "seçeneksiz ürün eskisi gibi");
  assert.equal(b.variants[0].barcode, "BZTEK1");
  assert.equal(b.variants[0].cost_price, undefined);
});

test("varyantlı ürün listenin ilerisinde olsa da görülür (3.000 sınırı yok)", () => {
  const plain = Array.from({ length: 3100 }, (_, i) => ({ stok_kodu: `P${i}`, isim: `Urun ${i}`, stok: "1" }));
  const items = [...plain, { stok_kodu: "V1", isim: "Secenekli", stok: "5", varyasyonlar: { varyasyon: [{ kod: "A", stok: "2" }, { kod: "B", stok: "3" }] } }];
  const m: any = { stok_kodu: "model", isim: "title", stok: "stock", "varyasyonlar.varyasyon.kod": "variant_sku", "varyasyonlar.varyasyon.stok": "stock" };
  const g = itemsToGroups(items, m).find((x) => x.model === "V1")!;
  assert.equal(g.rows.length, 2);
});

test("tek seçenekli Bezos ürünü: model kodu ve barkodu korunur, stok/fiyat seçenekten", () => {
  const xml = flattenVarDeger(`<urunler><urun><stok_kodu>TEK9</stok_kodu><isim>Tek Secenek</isim><barkod>BZTEK9</barkod><alis_fiyat>100,00</alis_fiyat><kdv>20</kdv><stok>9</stok><varyasyonlar><varyasyon><kod>XX1</kod><stok>4</stok><var_fiyat>110,00</var_fiyat><var_deger isim="RENK">Krem</var_deger></varyasyon></varyasyonlar></urun><urun><stok_kodu>V2</stok_kodu><isim>Iki</isim><barkod>BZV2</barkod><alis_fiyat>100,00</alis_fiyat><kdv>20</kdv><stok>2</stok><varyasyonlar><varyasyon><kod>A1</kod><stok>1</stok><var_fiyat>100,00</var_fiyat></varyasyon><varyasyon><kod>A2</kod><stok>1</stok><var_fiyat>100,00</var_fiyat></varyasyon></varyasyonlar></urun></urunler>`);
  const items = new XMLParser({ ignoreAttributes: true, trimValues: true, parseTagValue: false }).parse(xml).urunler.urun;
  const m: any = { stok_kodu: "model", isim: "title", barkod: "barcode", alis_fiyat: "cost_price", kdv: "vat_rate", stok: "stock",
    "varyasyonlar.varyasyon.kod": "variant_sku", "varyasyonlar.varyasyon.stok": "stock", "varyasyonlar.varyasyon.var_fiyat": "cost_price", "varyasyonlar.varyasyon.var_barkod": "barcode" };
  const p = supplierPayload(itemsToGroups(items, m)[0], { code: "bezos", sku_prefix: "BZS", price_includes_vat: false } as any, new Set()).payload;
  assert.equal(p.sku, "BZSTEK9");
  assert.equal(p.variants[0].sku, "BZSTEK9");
  assert.equal(p.variants[0].barcode, "BZTEK9");
  assert.equal(p.variants[0].stock, 4);
  assert.equal(p.cost_price, 132);
});

test("Bezos mobilya notu: yalnızca Mobilya yolunda ve yalnızca Bezos'ta", () => {
  const items = [{ k: "M1", t: "Zigon Sehpa", c: "Ev > Mobilya > Sehpa", d: "Metin" }, { k: "M2", t: "Mobilya Kulpu", c: "Yapı > Mobilya Hırdavatı", d: "Metin" }];
  const m: any = { k: "model", t: "title", c: "category", d: "description" };
  const [a, b] = itemsToGroups(items, m).map((g) => supplierPayload(g, { code: "bezos" } as any, new Set()).payload);
  assert.ok(a.description.endsWith("ertesi iş günü kargoya verilir."));
  assert.equal(b.description, "Metin");
  const c = supplierPayload(itemsToGroups(items, m)[0], { code: "hepsibayi" } as any, new Set()).payload;
  assert.equal(c.description, "Metin");
});
