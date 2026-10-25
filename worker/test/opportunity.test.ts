// Fırsat puanı (ürün seçimi) birim testleri. node --experimental-strip-types worker/test/opportunity.test.ts
import { scoreOf } from "../opportunity.ts";
let fails = 0;
const check = (n: string, c: boolean, info: unknown = "") => { console.log(`${c ? "OK  " : "HATA"} ${n}${c ? "" : "  " + JSON.stringify(info)}`); if (!c) fails++; };
const base = { net: 60, margin: 0.15, stock: 200, sold7: 0, price: 349.9, images: 4, descLen: 400, level: "yuksek", brandOk: true, variants: 1 };
const a = scoreOf(base);
check("puan 0-100 arası", a.score > 0 && a.score <= 100, a);
check("satış hızı puanı artırır", scoreOf({ ...base, sold7: 50 }).score > a.score + 20);
check("izinsiz marka düşürür", scoreOf({ ...base, brandOk: false }).score === a.score - 10);
check("daha çok net kâr daha yüksek puan", scoreOf({ ...base, net: 110 }).score > a.score);
check("kategori tahmini yoksa ceza", scoreOf({ ...base, level: null }).score < scoreOf({ ...base, level: "dusuk" }).score);
if (fails) { console.log(`\n${fails} fırsat testi başarısız`); process.exit(1); }
console.log("\nFırsat testleri geçti");
