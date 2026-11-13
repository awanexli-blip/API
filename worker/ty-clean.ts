// Trendyol kapalı ilan temizliği (K, 06.11: "kapalı pasif ilanları sil"). Trendyol kuralı: onaylı ürün önce arşivlenir, arşivde 1 günü dolunca silinir (core/retire.ts).
//   node --experimental-strip-types worker/ty-clean.ts archive [--apply]   canlı listeden kapalı (kilitli / kara liste / arşiv) ilanlar: say, --apply ile arşivle
//   node --experimental-strip-types worker/ty-clean.ts nostock [--limit N] [--apply]   tedarikçide de stoğu olmayan stok-0 ilanlar: say, --apply ile arşivle (K 12.11)
//   node --experimental-strip-types worker/ty-clean.ts delete [--apply]    arşivde 25 saati dolanları kalıcı sil (geri alınamaz)
// Durum listing_retire tablosunda. K'nın "hepsi kalsın" kararı verdiği ilan (listing_holds keep_all) ve yayında stoklu ilan atlanır.
import { createClient } from "@supabase/supabase-js";
import { getMarketplace } from "./marketplaces/index.ts";
import { env, readAll, chunk } from "./core/util.ts";
import { DELETE_AFTER_H } from "./core/retire.ts";
// Trendyol en az 24 saat arşiv ister; --after-h ile pay küçültülebilir (en az 24,1; K 13.11 "daha erken silelim")
const AFTER_H = Math.max(24.1, Number(process.argv[process.argv.indexOf("--after-h") + 1]) || DELETE_AFTER_H);

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
    await upsert(ids.map((k) => ({ marketplace: "trendyol", listing_key: k, archived_at: fail.has(k) && !/daha önce yapılmış/i.test(fail.get(k)!) ? null : now, last_attempt_at: now, attempts: 1, last_error: fail.get(k)?.slice(0, 300) ?? null }))); // "daha önce yapılmıştır" = zaten arşivde
    console.log(JSON.stringify({ arsivlenen: ids.length - fail.size, hatali: fail.size, nedenler: [...new Set(fail.values())].slice(0, 5).map((s) => s.slice(0, 160)) }));
  }
} else if (cmd === "nostock") {
  // K 12.11: "stoğu olmayan ürünleri çıkar" (ürün yükleme limiti doldu, 21 bin pasif ilan). Yalnızca TEDARİKÇİDE DE stoğu olmayanlar:
  // ürün yok (eşleşmeyen eski ilan) / ürün aktif değil / varyant stoklarının toplamı 0. Bizim kapattığımız ama tedarikçide stoklu
  // ilanlar (kopya, min stok, zararına) silinmez. Ek koruma: Trendyol canlı verisinde de stok 0, son 30 günde siparişi yok, keep_all yok.
  //   ty-clean.ts nostock [--limit N] [--apply]   -> arşivle (25 saat sonra "delete" kalıcı siler)
  const lim = Number(process.argv[process.argv.indexOf("--limit") + 1]) || 0;
  const ls = await readAll<any>((a, b) => db.from("marketplace_listings").select("listing_key, product_id, stock").eq("marketplace", "trendyol").eq("status", "live").lte("stock", 0).order("listing_key").range(a, b));
  if (ls.error) throw new Error(ls.error.message);
  const pids = [...new Set(ls.data.map((l: any) => l.product_id).filter(Boolean))] as string[];
  const supStock = new Map<string, number>(); const active = new Map<string, boolean>();
  for (const part of chunk(pids, 200)) {
    const { data, error } = await db.from("products").select("id, status, product_variants(stock)").in("id", part);
    if (error) throw new Error(error.message);
    for (const p of data ?? []) { active.set(p.id, p.status === "active"); supStock.set(p.id, (p.product_variants ?? []).reduce((s: number, v: any) => s + Math.max(0, Number(v.stock ?? 0)), 0)); }
  }
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const ol = await readAll<any>((a, b) => db.from("order_lines").select("listing_key, orders!inner(ordered_at)").gte("orders.ordered_at", since).order("order_id").order("line_no").range(a, b));
  const sold = new Set((ol.data ?? []).map((r: any) => r.listing_key).filter(Boolean));
  const { data: holds } = await db.from("listing_holds").select("listing_key").eq("marketplace", "trendyol").eq("status", "keep_all").limit(1000);
  const keep = new Set((holds ?? []).map((h: any) => h.listing_key));
  const done = await readAll<any>((a, b) => db.from("listing_retire").select("listing_key").eq("marketplace", "trendyol").not("archived_at", "is", null).order("listing_key").range(a, b));
  const archived = new Set((done.data ?? []).map((r: any) => r.listing_key));
  const why = (l: any) => !l.product_id ? "eşleşmeyen eski ilan" : !active.get(l.product_id) ? "ürün tedarikçide yok/pasif" : (supStock.get(l.product_id) ?? 0) === 0 ? "tedarikçide stok yok" : null;
  let cand = ls.data.filter((l: any) => why(l) && !sold.has(l.listing_key) && !keep.has(l.listing_key) && !archived.has(l.listing_key));
  // Canlı doğrulama: Trendyol'da da stok 0 olmayan (ya da bulunamayan) atlanır
  const live = new Map((await mp.loadListings()).map((x) => [x.id, x]));
  const notZeroLive = cand.filter((l: any) => { const x = live.get(l.listing_key); return !x || Number(x.quantity ?? 0) > 0; }).length;
  cand = cand.filter((l: any) => { const x = live.get(l.listing_key); return x && Number(x.quantity ?? 0) === 0; });
  const by: Record<string, number> = {};
  for (const l of cand) by[why(l)!] = (by[why(l)!] ?? 0) + 1;
  const ids = (lim ? cand.slice(0, lim) : cand).map((l: any) => l.listing_key);
  console.log(JSON.stringify({ stok0Ilan: ls.data.length, aday: cand.length, nedenler: by, atlanan: { son30GunSiparis: ls.data.filter((l: any) => sold.has(l.listing_key)).length, kalsin: keep.size, zatenArsivde: archived.size, trendyoldaStokluYaDaYok: notZeroLive }, buCalisma: ids.length, ornek: ids.slice(0, 5) }));
  if (apply && ids.length) {
    const r = await mp.archiveProducts!(ids);
    const chk = r.batchIds.length && mp.checkBatches ? await mp.checkBatches(r.batchIds) : null;
    const fail = new Map<string, string>();
    for (const f of r.failedItems ?? []) fail.set(f.id, f.reason);
    for (const f of chk?.failed ?? []) fail.set(f.id, f.reason);
    const now = new Date().toISOString();
    await upsert(ids.map((k) => ({ marketplace: "trendyol", listing_key: k, archived_at: fail.has(k) && !/daha önce yapılmış/i.test(fail.get(k)!) ? null : now, reason: "toplu temizlik (K 12.11): tedarikçide stok yok", last_attempt_at: now, attempts: 1, last_error: fail.get(k)?.slice(0, 300) ?? null })));
    console.log(JSON.stringify({ arsivlenen: ids.length - fail.size, hatali: fail.size, nedenler: [...new Set(fail.values())].slice(0, 5).map((s) => s.slice(0, 160)) }));
  }
} else if (cmd === "delete") {
  const rows = await readAll<any>((a, b) => db.from("listing_retire").select("listing_key, archived_at, deleted_at, attempts").eq("marketplace", "trendyol").order("listing_key").range(a, b));
  if (rows.error) throw new Error(rows.error.message);
  const ids = rows.data.filter((r: any) => r.archived_at && !r.deleted_at && (Date.now() - Date.parse(r.archived_at)) / 3600_000 >= AFTER_H).map((r: any) => r.listing_key);
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
  console.log("kullanım: ty-clean.ts archive|nostock|delete [--limit N] [--apply]");
}
