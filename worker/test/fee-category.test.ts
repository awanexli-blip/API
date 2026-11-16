// Trendyol kesinti tipi -> gider kategorisi (worker/core/fee-category.ts)
import { feeCategory } from "../core/fee-category.ts";
let fails = 0;
const check = (n: string, c: boolean, i: unknown = "") => { console.log(`${c ? "OK  " : "HATA"} ${n}${c ? "" : "  " + JSON.stringify(i)}`); if (!c) fails++; };
const cases: [string, string][] = [["Kargo Fatura", "kargo"], ["Platform Hizmet Bedeli", "platform"], ["Komisyon Faturası", "komisyon"], ["Reklam Bedeli", "reklam"],
  ["Müşteri Duyuruları Faturası", "duyuru"], ["E-ticaret Stopajı", "stopaj"], ["Tedarik Edememe", "ceza"], ["Termin Gecikme Bedeli", "ceza"], ["Uluslararası Hizmet Bedeli", "diger"]];
for (const [k, c] of cases) check(`${k} -> ${c}`, feeCategory(k) === c, feeCategory(k));
if (fails) { console.log(`\n${fails} gider kategorisi testi başarısız`); process.exit(1); }
console.log("\nGider kategorisi testleri geçti");
