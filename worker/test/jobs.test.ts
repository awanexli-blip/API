// İş kuyruğu çalıştırıcısı birim testi (sahte veritabanı).
// node --experimental-strip-types worker/test/jobs.test.ts
import { HANDLERS, runJobs } from "../jobs.ts";
import { listingRows } from "../core/listings.ts";

let fails = 0;
const check = (name: string, cond: boolean, info: unknown = "") => { console.log(`${cond ? "OK  " : "HATA"} ${name}${cond ? "" : "  " + JSON.stringify(info)}`); if (!cond) fails++; };

// Sahte kuyruk: iki iş (biri başarılı, biri hata), job_finish çağrıları kaydedilir
HANDLERS.test_ok = async () => ({ ok: 1 });
HANDLERS.test_fail = async () => { throw new Error("bozuk"); };
let queue = [{ id: 1, type: "test_ok", marketplace: null, payload: {}, attempts: 1 }, { id: 2, type: "test_fail", marketplace: null, payload: {}, attempts: 1 }];
const finished: any[] = [];
const db = {
  rpc: async (fn: string, args: any) => {
    if (fn === "job_claim") { const out = queue.filter((j) => args.kinds.includes(j.type)); queue = []; return { data: out, error: null }; }
    if (fn === "job_finish") { finished.push(args); return { data: null, error: null }; }
    return { data: null, error: null };
  },
};
const stats = await runJobs(db, { worker: "t", deadline: Date.now() + 5000, log: () => {} });
check("kuyruk: başarı ve hata sayıldı", stats.done === 1 && stats.failed === 1, stats);
check("kuyruk: başarılı iş ok=true", finished.find((f) => f.job_id === 1)?.ok === true, finished);
check("kuyruk: hatalı iş mesajıyla ok=false", finished.find((f) => f.job_id === 2)?.ok === false && finished.find((f) => f.job_id === 2)?.err === "bozuk", finished);
check("kuyruk: boş kuyrukta durur", (await runJobs(db, { worker: "t", deadline: Date.now() + 5000, log: () => {} })).done === 0);

// İlan satırları: durum eşlemesi, sayılar
const rows = listingRows("trendyol", [
  { id: "ÖS13-A", title: "A", price: 99.9, quantity: 5.7, status: "active", commission: 0.18 },
  { id: "OS13-B", title: "B", price: NaN, quantity: NaN, status: "pending" },
  { id: "ÖS13-C", title: "C", price: 0, quantity: 0, status: "closed" },
] as any, "2026-10-17T00:00:00Z");
check("ilan: durum eşlemesi", rows.map((r) => r.status).join(",") === "live,pending_approval,closed", rows);
check("ilan: stok tam sayı, NaN boş", rows[0].stock === 5 && rows[1].stock === null && rows[1].price === null, rows);

if (fails) { console.log(`\n${fails} kuyruk testi başarısız`); process.exit(1); }
console.log("\nKuyruk testleri geçti");
