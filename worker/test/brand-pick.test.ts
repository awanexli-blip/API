// Tedarikçi markası birden çok (pickBrand): ürün koduna göre sabit, yaklaşık eşit dağılım
// node --experimental-strip-types worker/test/brand-pick.test.ts
import { pickBrand } from "../core/db-products.ts";

let fails = 0;
const check = (n: string, c: boolean, i: unknown = "") => { console.log(`${c ? "OK  " : "HATA"} ${n}${c ? "" : "  " + JSON.stringify(i)}`); if (!c) fails++; };
const spec = "Eco Lounge|Genel Markalar|TCX";
check("tek marka aynen", pickBrand("Tcx", "X1") === "Tcx");
check("boş", pickBrand("", "X1") === "");
check("aynı ürün hep aynı marka", pickBrand(spec, "HBYHS4198-4069") === pickBrand(spec, "HBYHS4198-4069"));
check("boşluklar temizlenir", ["Eco Lounge", "Genel Markalar", "TCX"].includes(pickBrand(" Eco Lounge | Genel Markalar |TCX ", "A")));
const n = new Map<string, number>();
for (let i = 0; i < 3000; i++) { const b = pickBrand(spec, `HBYHS${1000 + i}-${i * 7}`); n.set(b, (n.get(b) ?? 0) + 1); }
check("üç marka da kullanılır, her biri %25-%42", n.size === 3 && [...n.values()].every((x) => x > 750 && x < 1250), Object.fromEntries(n));
if (fails) { console.log(`${fails} hata`); process.exit(1); }
console.log("Marka seçimi testleri geçti");
