// Eski tedarikçinin (BayilikXML) ilanlarını pazaryerinden kaldırma: önce arşiv, arşivde 1 günü dolunca kalıcı silme.
// Trendyol kuralı: onaylı ürün ancak arşivde 1 günden fazla kaldıktan sonra silinebilir; onay bekleyen/reddedilen doğrudan silinir.
// Durum `listing_retire` tablosunda tutulur (arşivlenen ilan listeden düşse de silme adımı oradan yürür).
import type { Listing, Marketplace } from "../marketplaces/types.ts";

export const RETIRE_PREFIXES = ["ÖS13-", "OS13-"]; // BayilikXML barkod kuralı (CLAUDE.md)
export const DELETE_AFTER_H = 25;
const RETRY_H = 6;

export type RetireRow = { listing_key: string; archived_at: string | null; deleted_at: string | null; last_attempt_at: string | null; attempts: number; last_error: string | null };

export const isRetireTarget = (id: string) => RETIRE_PREFIXES.some((p) => id.startsWith(p));

// Bu çalışmada ne yapılacağı (saf fonksiyon, test edilir)
export function planRetire(listings: Listing[], rows: Map<string, RetireRow>, now: number) {
  const archive: string[] = [], del: string[] = [];
  const h = (t: string | null) => (t ? (now - Date.parse(t)) / 3600_000 : Infinity);
  const seen = new Set<string>();
  for (const l of listings) {
    if (!isRetireTarget(l.id)) continue;
    seen.add(l.id);
    const r = rows.get(l.id);
    if (r?.deleted_at) continue;
    const retryOk = !r?.last_attempt_at || h(r.last_attempt_at) >= RETRY_H;
    if (l.status === "pending") { if (retryOk) del.push(l.id); continue; } // onay bekleyen / reddedilen: doğrudan sil
    if (!r?.archived_at) { if (retryOk || !r) archive.push(l.id); continue; }
    if (h(r.archived_at) >= DELETE_AFTER_H && retryOk) del.push(l.id);
  }
  // Arşivlenip listeden düşenler: silme tablodan yürür
  for (const r of rows.values()) {
    if (seen.has(r.listing_key) || r.deleted_at || !r.archived_at) continue;
    if (h(r.archived_at) >= DELETE_AFTER_H && (!r.last_attempt_at || h(r.last_attempt_at) >= RETRY_H)) del.push(r.listing_key);
  }
  return { archive, del };
}

async function loadRows(db: any, marketplace: string): Promise<Map<string, RetireRow>> {
  const out = new Map<string, RetireRow>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("listing_retire").select("listing_key, archived_at, deleted_at, last_attempt_at, attempts, last_error").eq("marketplace", marketplace).range(from, from + 999);
    if (error) throw new Error(`listing_retire okunamadı (migration 022?): ${error.message}`);
    for (const r of data ?? []) out.set(r.listing_key, r);
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function upsert(db: any, rows: any[]) {
  for (let i = 0; i < rows.length; i += 500) await db.from("listing_retire").upsert(rows.slice(i, i + 500), { onConflict: "marketplace,listing_key" });
}

export async function retireLegacy(db: any, mp: Marketplace, marketplace: string, listings: Listing[]): Promise<Record<string, unknown>> {
  if (!mp.archiveProducts || !mp.deleteProducts) return { skipped: `${mp.label} arşiv/silme desteklemiyor` };
  const rows = await loadRows(db, marketplace);
  const { archive, del } = planRetire(listings, rows, Date.now());
  const nowIso = new Date().toISOString();
  const out: Record<string, unknown> = { targets: listings.filter((l) => isRetireTarget(l.id)).length, archived: 0, deleteSent: 0, failed: 0, errors: [] as string[] };
  const fail = new Map<string, string>();

  if (archive.length) {
    const r = await mp.archiveProducts(archive);
    for (const f of r.failedItems ?? []) fail.set(f.id, f.reason);
    const chk = r.batchIds.length && mp.checkBatches ? await mp.checkBatches(r.batchIds) : null;
    for (const f of chk?.failed ?? []) fail.set(f.id, f.reason);
    out.archived = archive.filter((k) => !fail.has(k)).length; out.archiveBatches = r.batchIds.length; out.failed = (out.failed as number) + r.failed;
    await upsert(db, archive.map((k) => ({ marketplace, listing_key: k, archived_at: fail.has(k) ? rows.get(k)?.archived_at ?? null : nowIso, last_attempt_at: nowIso, attempts: (rows.get(k)?.attempts ?? 0) + 1, last_error: fail.get(k) ?? null, updated_at: nowIso })));
  }
  if (del.length) {
    const before = fail.size;
    const r = await mp.deleteProducts(del);
    for (const f of r.failedItems ?? []) fail.set(f.id, f.reason);
    const chk = r.batchIds.length && mp.checkBatches ? await mp.checkBatches(r.batchIds) : null;
    for (const f of chk?.failed ?? []) fail.set(f.id, f.reason);
    out.deleteSent = del.length; out.deleteFailed = fail.size - before; out.failed = (out.failed as number) + r.failed;
    await upsert(db, del.map((k) => ({ marketplace, listing_key: k, archived_at: rows.get(k)?.archived_at ?? null, deleted_at: fail.has(k) ? null : nowIso, last_attempt_at: nowIso, attempts: (rows.get(k)?.attempts ?? 0) + 1, last_error: fail.get(k) ?? null, updated_at: nowIso })));
  }
  out.errors = [...fail.values()].slice(0, 10);
  return out;
}
