// Pazaryeri kataloğu (ürün formu için): kategori ağaçları ve panelden istenen kategori özellikleri (iş kuyruğu "mp_attrs:<pazaryeri>").
// Hepsiburada anahtarları yalnızca GitHub Secrets'ta olduğu için HB isteklerini burası karşılar; sonuç Supabase önbelleğine yazılır
// (mp_categories, mp_category_attrs; migration 055), panel oradan okur. Kullanım: node --experimental-strip-types worker/catalog.ts
import { createClient } from "@supabase/supabase-js";
import { ensureCategories, getAttrs } from "../lib/mp-catalog.ts";
import { env } from "./core/util.ts";

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const hb = !!(process.env.HB_MERCHANT_ID && process.env.HB_USERNAME && process.env.HB_PASSWORD);
const out: Record<string, any> = { trees: {}, attrs: { ok: 0, failed: 0, errors: [] as string[] } };

// 1) Kategori ağaçları (7 günde bir yenilenir)
for (const mp of ["trendyol", ...(hb ? ["hepsiburada"] : [])]) {
  try { await ensureCategories(db, mp); out.trees[mp] = "ok"; } catch (e: any) { out.trees[mp] = String(e?.message ?? e).slice(0, 200); }
}

// 2) Panelden istenen kategori özellikleri: kuyruk boşalana kadar (en fazla 10 dk)
const kinds = ["mp_attrs:trendyol", ...(hb ? ["mp_attrs:hepsiburada"] : [])];
const until = Date.now() + 10 * 60 * 1000;
while (Date.now() < until) {
  const { data: jobs, error } = await db.rpc("job_claim", { worker: "catalog", kinds, max_n: 10 });
  if (error) { console.error(error.message); break; }
  if (!jobs?.length) break;
  for (const j of jobs as any[]) {
    const mp = String(j.type).split(":")[1], cid = String(j.payload?.category_id ?? "");
    try {
      const attrs = await getAttrs(db, mp, cid, true);
      await db.rpc("job_finish", { job_id: j.id, ok: true, res: { attrs: attrs.length, required: attrs.filter((a) => a.required).length }, err: null });
      out.attrs.ok++;
    } catch (e: any) {
      const msg = String(e?.message ?? e).slice(0, 300);
      await db.rpc("job_finish", { job_id: j.id, ok: false, res: null, err: msg });
      out.attrs.failed++; out.attrs.errors.push(`${mp}/${cid}: ${msg}`);
    }
  }
}
console.log(JSON.stringify(out, null, 1));
if (out.attrs.failed) process.exitCode = 1;
