// Tedarikçi siparişi çözümleyicileri (worker/core/supplier-resolve.ts)
import { resolveVariant, planCarrier, supplierCode, carrierKey, optionText } from "../core/supplier-resolve.ts";
let fails = 0;
const check = (n: string, c: boolean, i: unknown = "") => { console.log(`${c ? "OK  " : "HATA"} ${n}${c ? "" : "  " + JSON.stringify(i)}`); if (!c) fails++; };

// 15.11 canlı vaka: ilan ana ürün barkoduyla (BZRSL0000503) açılmış, sipariş adı "..., S/M", K Bezos'ta RSLV000050301 (S/M) vermiş
const fantezi = [
  { barcode: "BZRSLV000050302", sku: "BZSRSLV000050302", attributes: { Renk: "SİYAH", Beden: "L/XL" } },
  { barcode: "BZRSLV000050301", sku: "BZSRSLV000050301", attributes: { Renk: "SİYAH", Beden: "S/M" } },
];
const r1 = resolveVariant({ listing_key: "BZRSL0000503", title: "Kadın Siyah Göğüs Dekolte ve Çorap Detaylı Fantezi Kostüm 2320 BZRSL0000503, S/M" }, fantezi);
check("ana barkod + 'S/M' -> S/M varyantı", r1.ok && r1.variant.sku === "BZSRSLV000050301" && r1.by === "secenek", r1);
check("Bezos kodu BZS öneki atılır", supplierCode("BZSRSLV000050301", "BZS") === "RSLV000050301");
const r2 = resolveVariant({ listing_key: "BZRSLV000050302", title: "x" }, fantezi);
check("varyant barkodu -> doğrudan", r2.ok && r2.by === "barkod" && r2.variant.sku === "BZSRSLV000050302", r2);
const r3 = resolveVariant({ listing_key: "BZRSL0000503", title: "Kostüm, Standart" }, fantezi);
check("seçenek uymuyor -> belirsiz (gönderilmez)", !r3.ok, r3);
const halı = [{ barcode: "A", attributes: { Beden: "80X150" } }, { barcode: "B", attributes: { Beden: "120X180" } }];
check("halı ebadı", (() => { const r = resolveVariant({ listing_key: "P", title: "Youday Halı, 120X180" }, halı); return r.ok && r.variant.barcode === "B"; })());
const renkli = [{ barcode: "K", attributes: { Renk: "Kırmızı", Beden: "M" } }, { barcode: "M", attributes: { Renk: "Mavi", Beden: "M" } }];
check("renk + beden ikisi de seçenekte", (() => { const r = resolveVariant({ listing_key: "P", title: "Tişört, Mavi M" }, renkli); return r.ok && r.variant.barcode === "M"; })());
check("yalnız beden, iki renkte aynı -> belirsiz", !resolveVariant({ listing_key: "P", title: "Tişört, M" }, renkli).ok);
check("tek varyantlı ürün", resolveVariant({ listing_key: "X", title: "a" }, [{ barcode: "Y" }]).ok);
check("seçenek metni son virgülden", optionText("A, B, S/M").trim() === "S/M");

// Kargo
check("DHL eCommerce = DHL", (() => { const p = planCarrier("DHL eCommerce", ["PTT Kargo", "DHL"], "trendyol"); return p.ok && p.carrier === "DHL"; })());
check("Sürat Kargo Marketplace = Sürat Kargo", (() => { const p = planCarrier("Sürat Kargo Marketplace", ["Aras Kargo", "Sürat Kargo"], "trendyol"); return p.ok && p.carrier === "Sürat Kargo"; })());
const ch = planCarrier("Aras Kargo", ["PTT Kargo", "DHL"], "trendyol");
check("uyuşmuyor (sehpa): Trendyol'da PTT'ye değiştir önerisi", !ch.ok && ch.change?.code === "PTTMP" && ch.change.carrier === "PTT Kargo", ch);
check("HB'de değişiklik önerisi yok, uyarı", (() => { const p = planCarrier("Aras Kargo", ["PTT Kargo"], "hepsiburada"); return !p.ok && !p.change; })());
check("Kolay Gelsin / Sendeo aynı anahtar", carrierKey("Kolay Gelsin") === "kolaygelsin" && carrierKey("Sendeo Marketplace") === "kolaygelsin");
check("Hepsijet", carrierKey("HepsiJET") === "hepsijet");

if (fails) { console.log(`\n${fails} tedarikçi çözümleyici testi başarısız`); process.exit(1); }
console.log("\nTedarikçi çözümleyici testleri geçti");
