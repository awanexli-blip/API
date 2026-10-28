// Formda girilen satış fiyatı: girildiyse olduğu gibi gider (zararda / maliyetsiz bile), boşsa formül
// node --experimental-strip-types worker/test/sale-price.test.ts
import { priceFor } from "../core/db-products.ts";
import { defaultConfig as cfg, calcPrice } from "../pricing.ts";

let fails = 0;
const check = (n: string, c: boolean, i: unknown = "") => { console.log(`${c ? "OK  " : "HATA"} ${n}${c ? "" : "  " + JSON.stringify(i)}`); if (!c) fails++; };
const skips: string[] = [];
const ctx: any = { fx: { TRY: 1 }, cfg, catMap: new Map(), marketplaceId: "trendyol", rules: [], shipFor: null, dyn: null,
  mp: { commission: () => ({ rate: 0.18 }) }, skip: (r: string) => skips.push(r) };
const p = (cost: number | null, attrs: Record<string, string> = {}) => ({ cost_price: cost, currency: "TRY", vat_rate: 20, category: "X", attributes: attrs });

const f1 = priceFor(ctx, p(100), {}, null, 10);
check("boş: formül fiyatı", f1.ok && f1.price === calcPrice(100, cfg, 0.18).price && !("fixed" in f1), f1);
const f2 = priceFor(ctx, p(100, { "Satış fiyatı": "499,90" }), {}, null, 10);
check("girilen kârlı fiyat aynen", f2.ok && f2.price === 499.9 && "fixed" in f2 && f2.fixed && !f2.loss, f2);
const f3 = priceFor(ctx, p(500, { "Satış fiyatı": "199" }), {}, null, 10);
check("girilen zararlı fiyat yine aynen (zarar işaretli)", f3.ok && f3.price === 199 && "loss" in f3 && f3.loss === true, f3);
const f4 = priceFor(ctx, p(null, { "Satış fiyatı": "250" }), {}, null, 10);
check("maliyet yok ama fiyat girildi: gider", f4.ok && f4.price === 250, f4);
check("maliyet yok, fiyat yok: atlanır", !priceFor(ctx, p(null), {}, null, 10).ok);
const f5 = priceFor({ ...ctx, marketplaceId: "hepsiburada" }, p(100, { "Satış fiyatı": "400", "Satış fiyatı@hepsiburada": "450" }), {}, null, 10);
check("pazaryerine özel fiyat ezer", f5.ok && f5.price === 450, f5);
check("formül uyarısı yazılmadı", skips.length === 0, skips);

if (fails) { console.log(`\n${fails} satış fiyatı testi başarısız`); process.exit(1); }
console.log("\nSatış fiyatı testleri geçti");
