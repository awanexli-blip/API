// Trendyol kapalı ilan temizliği (K, 06.11: "kapalı pasif ilanları sil"). Trendyol kuralı: onaylı ürün önce arşivlenir, arşivde 1 günü dolunca silinir (core/retire.ts).
//   node --experimental-strip-types worker/ty-clean.ts archive [--apply]   canlı listeden kapalı (kilitli / kara liste / arşiv) ilanlar: say, --apply ile arşivle
//   node --experimental-strip-types worker/ty-clean.ts delete [--apply]    arşivde 25 saati dolanları kalıcı sil (geri alınamaz)
// Durum listing_retire tablosunda. K'nın "hepsi kalsın" kararı verdiği ilan (listing_holds keep_all) ve yayında stoklu ilan atlanır.
import { createClient } from "@supabase/supabase-js";
import { getMarketplace } from "./marketplaces/index.ts";
import { env, readAll, chunk } from "./core/util.ts";
import { DELETE_AFTER_H } from "./core/retire.ts";

const cmd = process.argv[2];
const apply = process.argv.includes("--apply");
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const mp = getMarketplace("trendyol");
const upsert = async (rows: any[]) => { for (const part of chunk(rows, 500)) { const { error } = await db.from("listing_retire").upsert(part, { onConflict: "marketplace,listing_key" }); if (error) throw new Error(error.message); } };

if (cmd === "archive") {
  const listings = await mp.loadListings();
  const { data: holds } = await db.from("listing_holds").select("listing_key").eq("marketplace", "trendyol").eq("status", "keep_all").limit(1000);
  const keep = new Set((holds ?? []).map((h: any) => h.listing_key));
  const ids = listings.filter((l) => l.status === "closed" && !keep.has(l.id)).map((l) => l.id);
  console.log(JSON.stringify({ toplamIlan: listings.length, kapali: ids.length, korunan: keep.size, ornek: ids.slice(0, 5) }));
  if (apply && ids.length) {
    const r = await mp.archiveProducts!(ids);
    const chk = r.batchIds.length && mp.checkBatches ? await mp.checkBatches(r.batchIds) : null;
    const fail = new Map<string, string>();
    for (const f of r.failedItems ?? []) fail.set(f.id, f.reason);
    for (const f of chk?.failed ?? []) fail.set(f.id, f.reason);
    const now = new Date().toISOString();
    await upsert(ids.map((k) => ({ marketplace: "trendyol", listing_key: k, archived_at: fail.has(k) ? null : now, last_attempt_at: now, attempts: 1, last_error: fail.get(k)?.slice(0, 300) ?? null })));
    console.log(JSON.stringify({ arsivlenen: ids.length - fail.size, hatali: fail.size, nedenler: [...new Set(fail.values())].slice(0, 5).map((s) => s.slice(0, 160)) }));
  }
} else if (cmd === "delete") {
  const rows = await readAll<any>((a, b) => db.from("listing_retire").select("listing_key, archived_at, deleted_at, attempts").eq("marketplace", "trendyol").order("listing_key").range(a, b));
  if (rows.error) throw new Error(rows.error.message);
  const ids = rows.data.filter((r: any) => r.archived_at && !r.deleted_at && (Date.now() - Date.parse(r.archived_at)) / 3600_000 >= DELETE_AFTER_H).map((r: any) => r.listing_key);
  console.log(JSON.stringify({ silinecek: ids.length }));
  if (apply && ids.length) {
    const r = await mp.deleteProducts!(ids);
    const chk = r.batchIds.length && mp.checkBatches ? await mp.checkBatches(r.batchIds) : null;
    const fail = new Map<string, string>();
    for (const f of r.failedItems ?? []) fail.set(f.id, f.reason);
    for (const f of chk?.failed ?? []) fail.set(f.id, f.reason);
    const now = new Date().toISOString();
    await upsert(ids.map((k) => ({ marketplace: "trendyol", listing_key: k, deleted_at: fail.has(k) ? null : now, last_attempt_at: now, last_error: fail.get(k)?.slice(0, 300) ?? null })));
    console.log(JSON.stringify({ silinen: ids.length - fail.size, hatali: fail.size, nedenler: [...new Set(fail.values())].slice(0, 5).map((s) => s.slice(0, 160)) }));
  }
} else {
  console.log("kullanım: ty-clean.ts archive|delete [--apply]");
}
