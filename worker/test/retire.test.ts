// Eski tedarikçi ilanlarını kaldırma planı: arşiv -> 25 saat sonra silme; onaysız doğrudan silinir; diğer barkodlara dokunulmaz.
// node --experimental-strip-types worker/test/retire.test.ts
import { planRetire, type RetireRow } from "../core/retire.ts";
let fails = 0;
const check = (n: string, c: boolean, i: unknown = "") => { console.log(`${c ? "OK  " : "HATA"} ${n}${c ? "" : "  " + JSON.stringify(i)}`); if (!c) fails++; };
const now = Date.parse("2026-10-21T12:00:00Z"), ago = (h: number) => new Date(now - h * 3600_000).toISOString();
const L = (id: string, status: any = "active") => ({ id, status, title: "", price: 0, quantity: 0 } as any);
const row = (k: string, p: Partial<RetireRow>): [string, RetireRow] => [k, { listing_key: k, archived_at: null, deleted_at: null, last_attempt_at: null, attempts: 0, last_error: null, ...p }];
{
  const p = planRetire([L("ÖS13-A"), L("OS13-B", "closed"), L("ÖS13-C", "pending"), L("1400089484"), L("2900-K149")], new Map(), now);
  check("ilk çalışma: onaylılar arşivlenir", p.archive.join() === "ÖS13-A,OS13-B", p);
  check("ilk çalışma: onaysız doğrudan silinir", p.del.join() === "ÖS13-C", p);
  check("başka barkodlara dokunulmaz", ![...p.archive, ...p.del].some((k) => !k.includes("S13-")), p);
}
{
  const rows = new Map([row("ÖS13-A", { archived_at: ago(2), last_attempt_at: ago(2) }), row("ÖS13-D", { archived_at: ago(26), last_attempt_at: ago(26) }), row("ÖS13-E", { archived_at: ago(30), deleted_at: ago(4) })]);
  const p = planRetire([L("ÖS13-A"), L("ÖS13-D")], rows, now);
  check("arşivde 25 saat dolmadan silinmez", !p.del.includes("ÖS13-A") && !p.archive.includes("ÖS13-A"), p);
  check("25 saat dolunca silinir", p.del.includes("ÖS13-D"), p);
  check("silinmiş tekrar silinmez", !p.del.includes("ÖS13-E"), p);
}
{
  const rows = new Map([row("ÖS13-F", { archived_at: ago(40), last_attempt_at: ago(40) }), row("ÖS13-G", { archived_at: ago(40), last_attempt_at: ago(1), last_error: "x" })]);
  const p = planRetire([], rows, now);
  check("listeden düşen arşivli ilan tablodan silinir", p.del.includes("ÖS13-F"), p);
  check("hata sonrası 6 saat beklenir", !p.del.includes("ÖS13-G"), p);
}
if (fails) { console.log(`\n${fails} kaldırma testi başarısız`); process.exit(1); }
console.log("\nKaldırma testleri geçti");
