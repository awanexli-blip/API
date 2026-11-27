// Trendyol güvenli liste (worker/core/ty-safe.ts). node --experimental-strip-types worker/test/ty-safe.test.ts
import { isTyGtin, tyHardBlock, tySafeCheck, parseTySafe, placeholderBrand, brandKey, gs1Assigned, gtinPrefix, TY_NOBRAND } from "../core/ty-safe.ts";

let fails = 0;
const check = (name: string, cond: boolean, info: unknown = "") => { console.log(`${cond ? "OK  " : "HATA"} ${name}${cond ? "" : "  " + JSON.stringify(info)}`); if (!cond) fails++; };

check("GTIN: geçerli EAN-13", isTyGtin("8690000000001") === (() => { const d = "869000000000".split("").map(Number); const s = d.reverse().reduce((t, x, i) => t + x * (i % 2 === 0 ? 3 : 1), 0); return (10 - (s % 10)) % 10 === 1; })());
check("GTIN: 4006381333931 geçerli", isTyGtin("4006381333931"));
check("GTIN: sağlama hanesi yanlış", !isTyGtin("4006381333932"));
check("GTIN: iç kodlar geçersiz", !isTyGtin("BZ200700004550") && !isTyGtin("ÖS13-ABC") && !isTyGtin("OS13-ABC") && !isTyGtin("HS3102760150") && !isTyGtin("TCXBYP-401074"));
check("GTIN: mağaza içi 2xx ve sıfırlar geçersiz", !isTyGtin("2000000000008") && !isTyGtin("0000000000000"));

check("marka: yer tutucular", placeholderBrand("Eco Lounge") && placeholderBrand("TCX") && placeholderBrand("ÇERÇİCİ") && placeholderBrand("colezium") && placeholderBrand("") && placeholderBrand(null) && placeholderBrand("Genel Markalar"));
check("marka: gerçek marka geçer", !placeholderBrand("Sertec") && !placeholderBrand("Whiskas"));

const ok = { id: "4006381333931", brand: "Sertec", title: "Sertec Nokia BL-5C Uyumlu Batarya", category: "Elektronik > Telefon" };
check("son kapı: temiz ürün geçer", tyHardBlock(ok) === null, tyHardBlock(ok));
check("son kapı: iç barkod", /GTIN/.test(tyHardBlock({ ...ok, id: "BZ200700004550" }) ?? ""));
check("son kapı: Eco Lounge markası", /gerçek markası değil/.test(tyHardBlock({ ...ok, brand: "Eco Lounge" }) ?? ""));
check("son kapı: +18 kategori", /\+18/.test(tyHardBlock({ ...ok, title: "Kaz Gagası Kremi 100 ml", category: "Ev & Yaşam > +18 Ürünler > Genital Bölge Bakımı" }) ?? ""));
check("son kapı: çakmak", /yasak/.test(tyHardBlock({ ...ok, title: "Figürlü Çakmak" }) ?? ""));

const base = { title: "Sertec Nokia BL-5C Uyumlu Batarya", brand: "Sertec", category: "Elektronik", barcodes: ["4006381333931"], images: ["https://x/1.jpg"], stock: 20 };
const allowed = new Set([brandKey("Sertec")]);
check("tam denetim: temiz + onaylı marka + eşlemeli kategori", tySafeCheck(base, { allowedBrands: allowed, categorySource: "map", minStock: 5 }).length === 0, tySafeCheck(base, { allowedBrands: allowed, categorySource: "map", minStock: 5 }));
check("tam denetim: onaysız marka", tySafeCheck(base, { allowedBrands: new Set(), categorySource: "map" }).some((r) => /onaylı markalar/.test(r)));
check("tam denetim: marka listesi kapalıysa marka sorulmaz", !tySafeCheck(base, { categorySource: "map" }).some((r) => /onaylı/.test(r)));
check("tam denetim: tahmin kategori strict'te geçmez", tySafeCheck(base, { categorySource: "predicted", predictedHigh: true }).some((r) => /tahmin/.test(r)));
check("tam denetim: high modda yüksek tahmin geçer", !tySafeCheck(base, { categorySource: "predicted", predictedHigh: true, categoryMode: "high" }).some((r) => /kategori/.test(r)));
check("tam denetim: çoklanan barkod", tySafeCheck(base, { categorySource: "map", dupBarcodes: new Set(["4006381333931"]) }).some((r) => /çoklama/.test(r)));
check("tam denetim: uyumluluk ifadesi marka riski değil", !tySafeCheck({ ...base, title: "Samsung Galaxy S5 Uyumlu Batarya" }, { categorySource: "map" }).some((r) => /lisans/.test(r)));
check("tam denetim: lisanslı karakter", tySafeCheck({ ...base, title: "Spiderman Desenli Kupa" }, { categorySource: "map" }).some((r) => /lisans/.test(r)));
check("tam denetim: sağlık beyanı", tySafeCheck({ ...base, description: "Eklem ağrılarını tedavi eder" }, { categorySource: "map" }).some((r) => /sağlık/.test(r)));
check("tam denetim: düşük stok", tySafeCheck({ ...base, stock: 2 }, { categorySource: "map", minStock: 5 }).some((r) => /stok/.test(r)));
check("tam denetim: görsel yok", tySafeCheck({ ...base, images: [] }, { categorySource: "map" }).some((r) => /görsel/.test(r)));

const d = parseTySafe(null);
check("ayar: yoksa açık, strict, min stok 5, marka listesi açık", d.enabled && d.categoryMode === "strict" && d.minStock === 5 && d.brandAllowlist, d);
check("ayar: kapatılabilir", parseTySafe({ enabled: false }).enabled === false);

console.log(fails ? `\n${fails} test başarısız` : "\nGüvenli liste testleri geçti");

// 27.11 Bezos "NW NessiWorld": sağlama hanesi doğru ama rastgele barkod (GS1 dışı önek / firma kodu katalogda tek)
const withCheck = (b12: string) => { const d = b12.split("").map(Number); const s = d.reverse().reduce((t, x, i) => t + x * (i % 2 === 0 ? 3 : 1), 0); return b12 + ((10 - (s % 10)) % 10); };
check("GS1: 583 öneki hiçbir ülkeye ait değil", !gs1Assigned(withCheck("583619251782")) && !isTyGtin(withCheck("583619251782")));
check("GS1: 196/161 önekleri geçersiz, 869/400/0 geçerli", !isTyGtin(withCheck("196707012345")) && !isTyGtin(withCheck("161000012345")) && isTyGtin(withCheck("869000012345")) && gs1Assigned("4006381333931") && gs1Assigned("012345678905"));
check("GS1: firma kodu 7 hane, UPC başına 0", gtinPrefix("4006381333931") === "4006381" && gtinPrefix("012345678905") === "0012345");
{
  const b = { title: "Kupa", brand: "Sertec", category: "Mutfak", barcodes: ["4006381333931"], images: ["https://i/1.jpg"], stock: 10 };
  check("rastgele barkod: firma kodu katalogda tek -> engel", tySafeCheck(b, { categorySource: "map", knownPrefixes: new Set(["8690000"]) }).some((r) => /firma kodu katalogda tek/.test(r)));
  check("rastgele barkod: bilinen firma kodu geçer", !tySafeCheck(b, { categorySource: "map", knownPrefixes: new Set(["4006381"]) }).some((r) => /firma kodu/.test(r)));
}

check("yer tutucu: NW NessiWorld / BEZOS / Akıllı Bayi", placeholderBrand("NW NessiWorld") && placeholderBrand("BEZOS") && placeholderBrand("Akıllı Bayi"));

// Markasız (K 27.11): Trendyol "Ürünümün Markası Yok" yalnızca iki modelin marka görmediği üründe; iç barkod kabul, "uyumlu" ve korumalı marka hayır
{
  const g = { title: "Çevirmeli Metal Kasa Numaratör", brand: "", category: "Ev", barcodes: ["BZ5A56ADF60666F3705C"], images: ["https://i/1.jpg"], stock: 10 };
  check("markasız: doğrulanmamış -> GTIN/marka engeli", tySafeCheck(g, { categorySource: "map" }).some((r) => /GTIN|marka/.test(r)));
  check("markasız: doğrulanmış -> geçer", tySafeCheck({ ...g, verifiedNoBrand: true }, { categorySource: "map", allowedBrands: new Set() }).length === 0, tySafeCheck({ ...g, verifiedNoBrand: true }, { categorySource: "map", allowedBrands: new Set() }));
  check("markasız: başlıkta uyumlu -> engel", tySafeCheck({ ...g, title: "Samsung Uyumlu Kılıf", verifiedNoBrand: true }, { categorySource: "map" }).some((r) => /uyumlu/.test(r)));
  check("markasız: açıklamada korumalı marka -> engel", tySafeCheck({ ...g, description: "Lego ile uyumlu değil, Hasbro oyuncağı", verifiedNoBrand: true }, { categorySource: "map" }).some((r) => /lisans/.test(r)));
  check("son kapı: markasız + iç barkod geçer, markasız + bozuk barkod engel", tyHardBlock({ id: "BZ5A56ADF60666F3705C", brand: TY_NOBRAND, title: "Numaratör" }) === null && !!tyHardBlock({ id: "ÖS13-x y", brand: TY_NOBRAND, title: "Numaratör" }));
  check("korumalı oyuncak markası", tySafeCheck({ ...g, title: "Hasbro Nerf Tabanca Seti", verifiedNoBrand: true }, { categorySource: "map" }).some((r) => /lisans/.test(r)));
}

check("korumalı: araba markası ve başka marka blok (Porsche, LOZ)", tySafeCheck({ title: "1:14 Porsche GT3 RS Uzaktan Kumandalı Araba", brand: "Sunman", category: "Oyuncak", barcodes: ["4006381333931"], images: ["https://i/1.jpg"], stock: 10 }, { categorySource: "map" }).some((r) => /lisans/.test(r)) && tySafeCheck({ title: "LZ-8877 LOZ KESİŞ MODEL 380 PARÇA BLOCK OYUNCAK", brand: "Vagon", category: "Oyuncak", barcodes: ["4006381333931"], images: ["https://i/1.jpg"], stock: 10 }, { categorySource: "map" }).some((r) => /lisans/.test(r)));

if (fails) process.exit(1);
