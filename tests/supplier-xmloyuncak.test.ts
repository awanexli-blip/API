// xmloyuncak (oyuncak toptancısı): kök <root><item>, gerçek marka korunur, KDV dahil fiyat3, üç kademeli kategori " > " ile birleşir. npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { XMLParser } from "fast-xml-parser";
import { findItems, itemsToGroups, supplierPayload } from "../lib/supplier-xml.ts";

const xml = `<?xml version="1.0" encoding="UTF-8"?><root>
 <item><id>1</id><stockCode><![CDATA[Eo_CALKAN.CLK294]]></stockCode><label><![CDATA[CLK-294 Market Arabası Meyveli Fileli]]></label><brand><![CDATA[Çalkan Plastik]]></brand>
  <barcode><![CDATA[8681900552947]]></barcode><mainCategory><![CDATA[Oyun Setleri]]></mainCategory><category><![CDATA[Minik Şefler]]></category><subCategory><![CDATA[Yazar Kasa - Market Setleri]]></subCategory>
  <price2>201.25</price2><price3>241.50</price3><tax>20</tax><currencyAbbr>TL</currencyAbbr><stockAmount>16</stockAmount>
  <picture1Path><![CDATA[https://www.xmloyuncak.com/a.jpg]]></picture1Path><picture2Path><![CDATA[]]></picture2Path><details><![CDATA[Meyveli Alışveriş Arabası]]></details></item>
</root>`;
const mapping: any = { stockCode: "model", label: "title", brand: "brand", barcode: "barcode", price3: "cost_price", tax: "vat_rate", currencyAbbr: "currency", stockAmount: "stock", details: "description",
  mainCategory: "category", category: "category", subCategory: "category", picture1Path: "images", picture2Path: "images" };
const sup: any = { code: "xmloyuncak", mapping, item_path: "root.item", sku_prefix: "XOY", sku_ascii: true, price_includes_vat: true, default_vat: 20, default_brand: "", currency: "TRY" };

test("xmloyuncak: gerçek marka, KDV dahil maliyet, kategori yolu, stok, görsel", () => {
  const items = findItems(new XMLParser({ ignoreAttributes: false }).parse(xml), "root.item").items;
  assert.equal(items.length, 1);
  const g = itemsToGroups(items, mapping);
  const { payload: p, error } = supplierPayload(g[0], sup, new Set());
  assert.equal(error, undefined);
  assert.equal(p.sku, "XOYEo_CALKAN.CLK294");
  assert.equal(p.brand, "Çalkan Plastik");
  assert.equal(p.cost_price, 241.5);
  assert.equal(p.category, "Oyun Setleri > Minik Şefler > Yazar Kasa - Market Setleri");
  assert.equal(p.variants[0].stock, 16);
  assert.equal(p.variants[0].barcode, "8681900552947");
  assert.equal(p.images?.length ?? 1, 1);
});
