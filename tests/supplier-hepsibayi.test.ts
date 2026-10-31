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
