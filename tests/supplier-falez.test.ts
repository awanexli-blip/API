// Falez (GOLDFALEZ mobilya, Google Merchant RSS): düz ürüne çevirme, barkod=g:id, fiyat sayı (KDV dahil), özellikler, desi, stok sabiti. npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { XMLParser } from "fast-xml-parser";
import { FALEZ_STOCK, findItems, flattenGoogleFeed, itemsToGroups, supplierPayload } from "../lib/supplier-xml.ts";

const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>Mağaza</title>
<item><g:id>142369574123</g:id><g:mpn>2004</g:mpn><g:title>Orta Sehpa Torna Ayak 2004 Efes</g:title><g:description>Modern masa; sunta &amp; ahşap</g:description>
<g:image_link>https://cdn.example/1.jpg</g:image_link><g:additional_image_link>https://cdn.example/2.jpg</g:additional_image_link><g:additional_image_link>https://cdn.example/3.jpg</g:additional_image_link>
<g:availability>in_stock</g:availability><g:price>1599.00 TRY</g:price><g:brand>GOLDFALEZ</g:brand><g:product_type>Orta Sehpa</g:product_type><g:color>Efes</g:color>
<g:product_detail><g:section_name>Ürün</g:section_name><g:attribute_name>Materyal</g:attribute_name><g:attribute_value>Suntalam</g:attribute_value></g:product_detail>
<g:product_detail><g:section_name>Ürün</g:section_name><g:attribute_name>Tema / Stil</g:attribute_name><g:attribute_value>Modern: Şık</g:attribute_value></g:product_detail>
<g:product_detail><g:section_name>Ürün</g:section_name><g:attribute_name>Desi</g:attribute_name><g:attribute_value>10</g:attribute_value></g:product_detail></item>
<item><g:id>2474125084128</g:id><g:mpn>9814</g:mpn><g:title>Sandalye 9814</g:title><g:availability>out_of_stock</g:availability><g:price>3652.50 TRY</g:price><g:brand>GOLDFALEZ</g:brand></item>
</channel></rss>`;
const mapping: any = { id: "barcode", mpn: "model", title: "title", description: "description", image: "images", price: "cost_price", stock: "stock", brand: "brand", type: "category", desi: "desi", attributes: "attributes" };
const sup: any = { code: "falez", mapping, item_path: "rss.channel.item", sku_prefix: "FLZ", sku_ascii: true, price_includes_vat: true, default_vat: 20, default_brand: "", currency: "TRY" };

test("falez: RSS düz ürüne çevrilir", () => {
  const items = findItems(new XMLParser({ ignoreAttributes: true, trimValues: true, parseTagValue: false }).parse(flattenGoogleFeed(xml)), "rss.channel.item").items;
  assert.equal(items.length, 2);
  const [a, b] = itemsToGroups(items, mapping).map((g) => supplierPayload(g, sup, new Set()).payload);
  assert.equal(a.sku, "FLZ2004");
  assert.equal(a.brand, "GOLDFALEZ");
  assert.equal(a.cost_price, 1599);
  assert.equal(a.desi, 10);
  assert.equal(a.variants[0].barcode, "142369574123");
  assert.equal(a.variants[0].stock, FALEZ_STOCK);
  assert.equal(a.images.length, 3);
  assert.equal(a.category, "Orta Sehpa");
  assert.equal(a.attributes.Materyal, "Suntalam");
  assert.equal(a.attributes.Renk, "Efes");
  assert.equal(a.attributes["Tema / Stil"], "Modern, Şık");
  assert.equal(b.variants[0].stock, 0);
  assert.equal(b.cost_price, 3652.5);
});
test("flattenGoogleFeed: Google biçimi değilse dokunmaz", () => { assert.equal(flattenGoogleFeed("<a><item><id>1</id></item></a>"), "<a><item><id>1</id></item></a>"); });
