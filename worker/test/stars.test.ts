// Yıldız dağıtımı (stars.ts assignStars): 10 eşit dilim, kopyalardan en iyisi
// node --experimental-strip-types worker/test/stars.test.ts
import { assignStars } from "../stars.ts";

let fails = 0;
const check = (n: string, c: boolean, i: unknown = "") => { console.log(`${c ? "OK  " : "HATA"} ${n}${c ? "" : "  " + JSON.stringify(i)}`); if (!c) fails++; };
const rows = Array.from({ length: 100 }, (_, i) => ({ id: `p${String(i).padStart(3, "0")}`, score: 100 - i, dupKeys: [`img:${i}`] }));
const { stars } = assignStars(rows);
check("en iyi 10 yıldız", stars.get("p000") === 10);
check("en kötü 1 yıldız", stars.get("p099") === 1);
check("her dilimde 10 ürün", [...Array(10)].every((_, k) => [...stars.values()].filter((s) => s === k + 1).length === 10));
const d = assignStars([{ id: "a", score: 50, dupKeys: ["img:x"] }, { id: "b", score: 80, dupKeys: ["img:x"] }, { id: "c", score: 60, dupKeys: ["t:aynı|100"] }, { id: "e", score: 40, dupKeys: ["t:aynı|100"] }]);
check("kopyada en yüksek puanlı kalır", d.stars.has("b") && d.dup.has("a") && d.stars.has("c") && d.dup.has("e"), { s: [...d.stars], d: [...d.dup] });
check("tek ürün 10 yıldız", assignStars([{ id: "x", score: 1, dupKeys: [] }]).stars.get("x") === 10);
if (fails) { console.log(`${fails} hata`); process.exit(1); }
console.log("Yıldız testleri geçti");
