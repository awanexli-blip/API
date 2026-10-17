// Ürün doğrulama birim testleri. npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { barcodeError, isValidGtin, issuesByPath, productSchema } from "../lib/validation/product.ts";

const base = { sku: "URUN-1", title: "Deneme Ürün", variants: [{ sku: "URUN-1-A" }] };
const parse = (p: unknown) => productSchema.safeParse(p);
const errs = (p: unknown) => { const r = parse(p); return r.success ? {} : issuesByPath(r.error); };

test("GTIN sağlama toplamı", () => {
  assert.equal(isValidGtin("8690000000012"), true);   // EAN-13
  assert.equal(isValidGtin("8690000000013"), false);
  assert.equal(isValidGtin("96385074"), true);        // EAN-8
  assert.equal(isValidGtin("036000291452"), true);    // UPC-A
  assert.equal(isValidGtin("10012345678902"), true);  // GTIN-14
  assert.equal(isValidGtin("12345"), false);
});

test("barkod kuralları", () => {
  assert.equal(barcodeError(""), null);
  assert.equal(barcodeError(null), null);
  assert.equal(barcodeError("OS13-SFKUCZSULUKUMSAAT2"), null, "iç kod geçerli");
  assert.match(barcodeError("8690000000013")!, /kontrol hanesi/);
  assert.match(barcodeError("123456789")!, /8, 12, 13 veya 14/);
  assert.equal(barcodeError("ÖS13-SFKXUCZZZBENZNLZPPOOOOO-2-1"), null, "mevcut Trendyol barkodu (Ö) geçerli");
  assert.match(barcodeError("OS13 ABC")!, /boşluk/);
  assert.match(barcodeError("OS13/ABC")!, /harf, rakam/);
  assert.match(barcodeError("A".repeat(41))!, /40 karakter/);
});

test("geçerli minimum ürün ve varsayılanlar", () => {
  const r = parse(base);
  assert.ok(r.success);
  assert.equal(r.data.status, "draft");
  assert.equal(r.data.vat_rate, 20);
  assert.equal(r.data.currency, "TRY");
  assert.deepEqual(r.data.images, []);
  assert.equal(r.data.variants[0].stock, 0);
  assert.equal(r.data.variants[0].barcode, null);
});

test("form değerleri dönüştürülür (virgüllü sayı, boş alan)", () => {
  const r = parse({ ...base, cost_price: "149,90", desi: "", vat_rate: "10", variants: [{ sku: "URUN-1-A", stock: "7", cost_price: "" }] });
  assert.ok(r.success);
  assert.equal(r.data.cost_price, 149.9);
  assert.equal(r.data.desi, null);
  assert.equal(r.data.vat_rate, 10);
  assert.equal(r.data.variants[0].stock, 7);
});

test("SKU kuralı", () => {
  assert.match(errs({ ...base, sku: "Ü RÜN" }).sku, /boşluk/);
  assert.ok(parse({ ...base, sku: "ÖS13-G0Eo_S01.S00094819" }).success, "mevcut Trendyol stok kodu geçerli");
  assert.match(errs({ ...base, sku: "A" }).sku, /2-64/);
  assert.match(errs({ ...base, variants: [{ sku: "x y" }] })["variants.0.sku"], /SKU/);
});

test("zorunlu alanlar ve sınırlar", () => {
  assert.ok(errs({ ...base, title: "" }).title);
  assert.match(errs({ ...base, variants: [] }).variants, /En az bir varyant/);
  assert.match(errs({ ...base, vat_rate: 18 }).vat_rate, /0, 1, 10 veya 20/);
  assert.match(errs({ ...base, cost_price: -1 }).cost_price, /Negatif/);
  assert.match(errs({ ...base, variants: [{ sku: "URUN-1-A", stock: 1.5 }] })["variants.0.stock"], /tam sayı/);
  assert.match(errs({ ...base, status: "yayinda" }).status, /taslak, aktif veya arşiv/);
});

test("görseller https ve en fazla 20", () => {
  assert.match(errs({ ...base, images: ["http://x.com/a.jpg"] })["images.0"], /https/);
  assert.match(errs({ ...base, images: Array(21).fill("https://x.com/a.jpg") }).images, /20/);
  assert.ok(parse({ ...base, images: ["https://cdn.x.com/a.jpg"] }).success);
});

test("varyant SKU ve barkodu ürün içinde tekrarsız", () => {
  const e = errs({ ...base, variants: [{ sku: "A-1", barcode: "8690000000012" }, { sku: "a-1", barcode: "8690000000012" }] });
  assert.match(e["variants.1.sku"], /tekrar/);
  assert.match(e["variants.1.barcode"], /tekrar/);
});
