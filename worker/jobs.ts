// İş kuyruğu çalıştırıcısı (Faz 3). GitHub Actions'ta senkrondan sonra çalışır.
// node --experimental-strip-types worker/jobs.ts [en fazla süre sn = 300]
// İşler "jobs" tablosunda; job_claim kilitler, job_finish başarı/yeniden deneme/başarısızlık yazar.
// Yeni iş türü = HANDLERS'a bir fonksiyon. Pazaryerine ürün gönderme işleri Faz 4'te eklenecek.
import { createClient } from "@supabase/supabase-js";
import { env } from "./core/util.ts";

type Job = { id: number; type: string; marketplace: string | null; payload: any; attempts: number };
type Ctx = { db: any; log: (m: string) => void };

export const HANDLERS: Record<string, (job: Job, ctx: Ctx) => Promise<unknown>> = {
  // İlanları ürün veritabanına yeniden bağla (ör. tedarikçi içe aktarmasından sonra)
  async link_listings(job, { db }) {
    const { data, error } = await db.rpc("listings_link", { mp: job.marketplace ?? "trendyol" });
    if (error) throw new Error(error.message);
    return { linked: data };
  },
};

export async function runJobs(db: any, opts: { worker: string; deadline: number; log?: (m: string) => void }) {
  const log = opts.log ?? console.log;
  const stats = { done: 0, failed: 0, retried: 0 };
  while (Date.now() < opts.deadline) {
    const { data: jobs, error } = await db.rpc("job_claim", { worker: opts.worker, kinds: Object.keys(HANDLERS), max_n: 5 });
    if (error) { log(`Kuyruk okunamadı: ${error.message}`); break; }
    if (!jobs?.length) break;
    for (const job of jobs as Job[]) {
      const h = HANDLERS[job.type];
      try {
        const res = await h(job, { db, log });
        await db.rpc("job_finish", { job_id: job.id, ok: true, res: res ?? null, err: null });
        stats.done++;
        log(`#${job.id} ${job.type}: tamam`);
      } catch (e: any) {
        await db.rpc("job_finish", { job_id: job.id, ok: false, res: null, err: String(e?.message ?? e) });
        stats.failed++;
        log(`#${job.id} ${job.type}: hata (${job.attempts}. deneme): ${e?.message ?? e}`);
      }
    }
  }
  return stats;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("worker/jobs.ts")) {
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const secs = Number(process.argv[2] ?? 300);
  const stats = await runJobs(db, { worker: `actions-${process.env.GITHUB_RUN_ID ?? "yerel"}`, deadline: Date.now() + secs * 1000 });
  console.log("İş kuyruğu:", stats);
}
