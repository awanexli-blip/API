// İlan yaşam döngüsü (K 12.11: "stoğu biterse yayından çıksın, gelirse tekrar eklensin, yeni ürün gelirse yüklensin; bilgiler saklansın").
// Yalnızca Trendyol (ürün sayısı sınırı var; Hepsiburada'da stok 0 ilanı zaten satışa kapatır, sınır yok).
//   1) out_since: ilan satılabilir stoksuz kaldığı ilk an (tedarikçi stok - rezerv < minStock, ürün pasif ya da panelde gizli). Stok gelince null.
//   2) ARŞİV: yayında, 48 saattir stoksuz, son 30 günde siparişi yok, "kalsın" (keep_all) değil.
//   3) ARŞİVDEN ÇIKAR: arşivde ve stok geldi -> archived=false (Trendyol'daki içerik/kategori/onay aynen kalır; stok/fiyat sonraki turda gider).
//   4) SİL: arşivde 25 saati dolmuş ve (ürün tedarikçide yok/pasif ya da 30 gündür stoksuz) -> kalıcı sil, ilan "gone". Ürün bilgisi bizde kalır.
//   5) YENİDEN GÖNDER: silinmiş (gone) ilanın ürünü yeniden stokta -> gönderim kuyruğu. Onaylı ilanın kategori numarası ve özellikleri
//      ürüne öğrenilmiş olduğundan (learnFromListings) kategori/özellik yeniden tahmin edilmez.
// Kapatma: app_state "lifecycle:trendyol" = "off". Tur başına sınırlar: arşiv/sil 3000, yeniden gönderim 2000 ürün.
import { readAll, chunk } from "./util.ts";
import type { Listing, Marketplace } from "../marketplaces/types.ts";

const H = 3600_000;
export const ARCHIVE_AFTER_H = 48, DELETE_AFTER_H = 25, DEAD_AFTER_D = 30;

export type LcRow = { key: string; productId: string | null; inStock: boolean; productActive: boolean; outSince: string | null; status: string };
export type LcRetire = { archived_at: string | null; deleted_at: string | null; reason?: string | null };
// Bizim kaldırdığımız ilanlar (yeniden gönderilebilir). Trendyol'un kapattığı (marka ihlali vb.) "gone" ilanlar geri gönderilmez.
export const OURS = /^(48 saattir stoksuz|arşivde|toplu temizlik)/;
// K onaylı toplu temizlik (12.11): 30 gün beklemeden, arşivde 25 saat dolunca silinir
const BULK = /^toplu temizlik/;

// Saf karar fonksiyonu (test edilir)
export function planLifecycle(rows: LcRow[], live: Map<string, Pick<Listing, "status" | "archived">>, retire: Map<string, LcRetire>, o: { now: number; sold: Set<string>; keep: Set<string>; max?: number }) {
  const max = o.max ?? 3000;
  const setOut: string[] = [], clearOut: string[] = [], archive: string[] = [], unarchive: string[] = [], del: string[] = [], resend = new Set<string>();
  const age = (t: string | null) => (t ? (o.now - Date.parse(t)) / H : 0);
  for (const r of rows) {
    if (!r.inStock && !r.outSince) setOut.push(r.key);
    if (r.inStock && r.outSince) clearOut.push(r.key);
    const l = live.get(r.key), rt = retire.get(r.key);
    const archived = !!(l?.archived || (rt?.archived_at && !rt.deleted_at));
    if (r.status === "gone" || rt?.deleted_at) { if (r.inStock && r.productId && rt?.deleted_at && OURS.test(rt.reason ?? "")) resend.add(r.productId); continue; }
    if (!l) continue; // Trendyol'da görünmüyor (onay bekliyor / bilinmiyor): dokunma
    if (archived) {
      if (r.inStock) { if (unarchive.length < max) unarchive.push(r.key); continue; }
      const dead = !r.productActive || age(r.outSince) >= DEAD_AFTER_D * 24 || BULK.test(rt?.reason ?? "");
      if (dead && rt?.archived_at && age(rt.archived_at) >= DELETE_AFTER_H && del.length < max) del.push(r.key);
      continue;
    }
    if (l.status !== "active" || r.inStock) continue;
    if (age(r.outSince) >= ARCHIVE_AFTER_H && !o.sold.has(r.key) && !o.keep.has(r.key) && archive.length < max) archive.push(r.key);
  }
  return { setOut, clearOut, archive, unarchive, del, resend: [...resend].slice(0, 2000) };
}

export async function runLifecycle(db: any, mp: Marketplace, marketplace: string, listings: Listing[], minStock: number, log: (m: string) => void = () => {}) {
  if (marketplace !== "trendyol" || !mp.archiveProducts || !mp.deleteProducts) return { skipped: "yalnızca Trendyol" };
  const { data: sw } = await db.from("app_state").select("value").eq("key", `lifecycle:${marketplace}`).maybeSingle();
  if (sw?.value === "off") return { skipped: "kapalı (app_state)" };
  const now = Date.now(), iso = new Date(now).toISOString();
  // İlanlar + ürün stok durumu (anahtar sıralı sayfalama)
  const rows: LcRow[] = [];
  const hidden = new Set<string>();
  { const r = await readAll<any>((a, b) => db.from("product_overrides").select("barcode").eq("marketplace", marketplace).eq("hidden", true).order("barcode").range(a, b)); for (const x of r.data ?? []) hidden.add(x.barcode); }
  for (let last = ""; ; ) {
    const { data, error } = await db.from("marketplace_listings").select("listing_key, product_id, status, out_since, product_variants(stock, reserved), products(status)")
      .eq("marketplace", marketplace).not("variant_id", "is", null).gt("listing_key", last).order("listing_key").limit(1000);
    if (error) { if (/out_since/.test(error.message)) return { skipped: "migration 079 yok" }; throw new Error(error.message); }
    if (!data?.length) break;
    last = data[data.length - 1].listing_key;
    for (const r of data as any[]) {
      const v = r.product_variants, active = r.products?.status === "active";
      const avail = Math.max(0, Number(v?.stock ?? 0) - Number(v?.reserved ?? 0));
      rows.push({ key: r.listing_key, productId: r.product_id, status: r.status, outSince: r.out_since, productActive: active, inStock: active && avail >= Math.max(1, minStock) && !hidden.has(r.listing_key) });
    }
    if (data.length < 1000) break;
  }
  const retire = new Map<string, LcRetire>();
  { const r = await readAll<any>((a, b) => db.from("listing_retire").select("listing_key, archived_at, deleted_at, reason").eq("marketplace", marketplace).order("listing_key").range(a, b)); for (const x of r.data ?? []) retire.set(x.listing_key, x); }
  const since = new Date(now - 30 * 86400_000).toISOString();
  const ol = await readAll<any>((a, b) => db.from("order_lines").select("listing_key, orders!inner(ordered_at)").gte("orders.ordered_at", since).order("order_id").order("line_no").range(a, b));
  const sold = new Set<string>((ol.data ?? []).map((r: any) => r.listing_key).filter(Boolean));
  const { data: holds } = await db.from("listing_holds").select("listing_key").eq("marketplace", marketplace).eq("status", "keep_all").limit(5000);
  const keep = new Set<string>((holds ?? []).map((h: any) => h.listing_key));
  const live = new Map(listings.map((l) => [l.id, l]));
  const plan = planLifecycle(rows, live, retire, { now, sold, keep });

  for (const part of chunk(plan.setOut, 500)) await db.from("marketplace_listings").update({ out_since: iso }).eq("marketplace", marketplace).in("listing_key", part);
  for (const part of chunk(plan.clearOut, 500)) await db.from("marketplace_listings").update({ out_since: null }).eq("marketplace", marketplace).in("listing_key", part);
  const upsert = async (rs: any[]) => { for (const part of chunk(rs, 500)) { const { error } = await db.from("listing_retire").upsert(part, { onConflict: "marketplace,listing_key" }); if (error) log(`listing_retire: ${error.message}`); } };
  const failsOf = async (r: any) => {
    const chk = r.batchIds?.length && mp.checkBatches ? await mp.checkBatches(r.batchIds) : null;
    const f = new Map<string, string>();
    for (const x of r.failedItems ?? []) f.set(x.id, x.reason);
    for (const x of chk?.failed ?? []) f.set(x.id, x.reason);
    return f;
  };
  const out: Record<string, any> = { stoksuzBasladi: plan.setOut.length, stokGeldi: plan.clearOut.length };
  if (plan.archive.length) {
    const f = await failsOf(await mp.archiveProducts!(plan.archive));
    await upsert(plan.archive.map((k) => ({ marketplace, listing_key: k, archived_at: f.has(k) && !/daha önce yapılmış/i.test(f.get(k)!) ? null : iso, restored_at: null, deleted_at: null, reason: "48 saattir stoksuz", last_attempt_at: iso, attempts: 1, last_error: f.get(k)?.slice(0, 300) ?? null })));
    out.arsiv = plan.archive.length - f.size; if (f.size) out.arsivHata = f.size;
  }
  if (plan.unarchive.length) {
    const f = await failsOf(await mp.archiveProducts!(plan.unarchive, false));
    await upsert(plan.unarchive.filter((k) => !f.has(k) || /daha önce yapılmış/i.test(f.get(k)!)).map((k) => ({ marketplace, listing_key: k, archived_at: null, restored_at: iso, reason: "stok geldi", last_attempt_at: iso, last_error: null })));
    out.arsivdenCikti = plan.unarchive.length - f.size; if (f.size) out.arsivdenCikmaHata = [...f.values()].slice(0, 3).map((s) => s.slice(0, 120));
  }
  if (plan.del.length) {
    const f = await failsOf(await mp.deleteProducts!(plan.del));
    const ok = plan.del.filter((k) => !f.has(k));
    await upsert(plan.del.map((k) => ({ marketplace, listing_key: k, deleted_at: f.has(k) ? null : iso, reason: "arşivde, tedarikçide yok / 30 gün stoksuz", last_attempt_at: iso, last_error: f.get(k)?.slice(0, 300) ?? null })));
    for (const part of chunk(ok, 500)) await db.from("marketplace_listings").update({ status: "gone", updated_at: iso }).eq("marketplace", marketplace).in("listing_key", part);
    out.silindi = ok.length; if (f.size) out.silmeHata = f.size;
  }
  if (plan.resend.length) {
    let n = 0;
    for (const [i, part] of chunk(plan.resend, 100).entries()) {
      const { error } = await db.from("jobs").insert({ type: `send_products:${marketplace}`, marketplace, payload: { product_ids: part }, idempotency_key: `lifecycle:${marketplace}:${iso.slice(0, 13)}:${i}`, created_by: "yaşam döngüsü (stok geri geldi)" });
      if (!error) n += part.length; else if (error.code !== "23505") log(`yeniden gönderim: ${error.message}`);
    }
    out.yenidenGonderim = n;
  }
  return out;
}
