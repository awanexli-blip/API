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


// Bezos satır çözümü (sahte bağımlılıklar)
import { resolveBezosLine, planBezosOrder } from "../core/supplier-bezos.ts";
{
  const bezosDb: Record<string, any> = {
    "RSLV000050301": { id: 194449, code: "RSLV000050301", barcode: "", stock: 75, unitPrice: 300, carriers: ["Aras Kargo", "Sürat Kargo"], variantParentId: 165453 },
    "BZ200700046527": { id: 9, code: "3DP-0053-Kırmızı", barcode: "BZ200700046527", stock: 5, unitPrice: 100, carriers: ["DHL", "PTT Kargo"] },
    "BZ2DCACB93D8A1315472": { id: 7, code: "8683140700577", barcode: "BZ2DCACB93D8A1315472", stock: 3, unitPrice: 90, carriers: ["Aras Kargo"] },
  };
  const deps = {
    variantsOfProduct: async (pid: string) => (pid === "fantezi" ? fantezi : pid === "vazo" ? [{ barcode: "BZ200700046527", sku: "BZS3DP-0053-Krmz" }] : [{ barcode: "BZ2DCACB93D8A1315472", sku: "BZS8683140700577" }]),
    productOfBarcode: async (bc: string) => (bc === "BZ2DCACB93D8A1315472" ? { productId: "kilif", sourceRef: "8683140700577" } : null),
    sourceRefOf: async () => null,
    bezos: async (q: string) => bezosDb[q] ?? null,
  };
  const a = await resolveBezosLine({ listing_key: "BZRSL0000503", title: "Fantezi Kostüm, S/M", product_id: "fantezi", qty: 1 }, deps);
  check("Bezos: ana barkod + S/M -> RSLV000050301 (varyant kodu)", a.ok && a.code === "RSLV000050301", a);
  const b = await resolveBezosLine({ listing_key: "BZ200700046527", title: "Vazo", product_id: "vazo", qty: 1 }, deps);
  check("Bezos: barkod sorgusu Türkçe karakterli orijinal kodu verir", b.ok && b.code === "3DP-0053-Kırmızı", b);
  const c = await resolveBezosLine({ listing_key: "BZ2DCACB93D8A1315472", title: "Kılıf", product_id: null, qty: 1 }, deps);
  check("Bezos: ürüne bağlı olmayan HB satırı barkoddan bulunur", c.ok && c.code === "8683140700577", c);
  const plan = planBezosOrder([{ qty: 1, res: a }, { qty: 2, res: a }], "Sürat Kargo Marketplace", "trendyol");
  check("Sepet: aynı ürün iki satır -> tek kalem 3 adet, kargo Sürat", plan.ok && plan.items.length === 1 && plan.items[0].quantity === 3 && plan.carrier === "Sürat Kargo", plan);
  const mix = planBezosOrder([{ qty: 1, res: a }, { qty: 1, res: b }], "Aras Kargo", "trendyol");
  check("Sepet: ortak kargo yok -> sorun + gönderilmez", !mix.ok && mix.problems.some((p) => /kargo/.test(p)), mix);
  const stok = planBezosOrder([{ qty: 9, res: b }], "PTT Kargo", "trendyol");
  check("Sepet: stok yetersiz -> gönderilmez", !stok.ok && stok.problems.some((p) => /stoğu/.test(p)), stok);
}

if (fails) { console.log(`\n${fails} tedarikçi çözümleyici testi başarısız`); process.exit(1); }
console.log("\nTedarikçi çözümleyici testleri geçti");
