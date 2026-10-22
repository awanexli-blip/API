// Pazaryerinin ürün başına inceleme durumu (Hepsiburada: Satışa Hazır / İncelenecek / ret nedeni).
// Gönderimin sonucu çoğu zaman aynı çalışmada çıkmaz (HB incelemesi saatler sürer): takip numaraları mp_batches'e yazılır,
// sonraki çalışmalarda beklemeden yeniden sorulur, ürün durumu marketplace_listings.mp_status'a işlenir (migration 035).
import type { BatchCheck, ItemState, Marketplace } from "../marketplaces/types.ts";

const MAX_AGE_DAYS = 10;   // bu kadar eski ve hâlâ "İncelenecek" olan grup bırakılır
const MAX_CHECKS = 200;    // saatlik sorguyla ~8 gün

export async function recordBatches(db: any, marketplace: string, ids: string[]) {
  const rows = ids.filter((i) => i.startsWith("product:")).map((batch_id) => ({ marketplace, batch_id }));
  if (rows.length) await db.from("mp_batches").upsert(rows, { onConflict: "marketplace,batch_id", ignoreDuplicates: true });
}

export async function applyStates(db: any, marketplace: string, states: ItemState[] = [], done: string[] = []) {
  let updated = 0;
  for (let i = 0; i < states.length; i += 500) {
    const part = states.slice(i, i + 500).map(({ id, status, reasons, bad }) => ({ id, status, reasons, bad }));
    const { data, error } = await db.rpc("listing_mp_status_apply", { p_mp: marketplace, p_rows: part });
    if (error) throw new Error(`durum yazılamadı: ${error.message}`);
    updated += Number(data ?? 0);
  }
  if (done.length) await db.from("mp_batches").update({ done: true }).eq("marketplace", marketplace).in("batch_id", done);
  return updated;
}

// Açık grupları (en uzun süredir sorulmayan önce) beklemeden sor
export async function refreshBatches(db: any, mp: Marketplace, limit = 25) {
  if (!mp.checkBatches) return { skipped: "pazaryerinde toplu sonuç sorgusu yok" };
  const { data, error } = await db.from("mp_batches").select("batch_id, created_at, checks").eq("marketplace", mp.id).eq("done", false)
    .order("checked_at", { ascending: true, nullsFirst: true }).limit(limit);
  if (error) return { skipped: error.message };
  if (!data?.length) return { open: 0 };
  const ids = data.map((r: any) => r.batch_id);
  const chk: BatchCheck = await mp.checkBatches(ids, { quick: true });
  const now = Date.now();
  // Çok eski / çok sorulmuş gruplar kapanır (ürün durumu son haliyle kalır)
  const stale = data.filter((r: any) => r.checks + 1 >= MAX_CHECKS || now - Date.parse(r.created_at) > MAX_AGE_DAYS * 864e5).map((r: any) => r.batch_id);
  const done = [...new Set([...(chk.done ?? []), ...stale])];
  const updated = await applyStates(db, mp.id, chk.states, done);
  for (const r of data as any[]) await db.from("mp_batches").update({ checked_at: new Date().toISOString(), checks: r.checks + 1 }).eq("marketplace", mp.id).eq("batch_id", r.batch_id);
  return { asked: ids.length, finished: done.length, items: chk.states?.length ?? 0, updated, rejected: chk.states?.filter((s) => s.bad).length ?? 0, statuses: chk.statuses ?? {} };
}
