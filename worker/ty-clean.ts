// Trendyol kapalı ilan temizliği (K, 06.11: "kapalı pasif ilanları sil"). Trendyol kuralı: onaylı ürün önce arşivlenir, arşivde 1 günü dolunca silinir (core/retire.ts).
//   node --experimental-strip-types worker/ty-clean.ts archive [--apply]   canlı listeden kapalı (kilitli / kara liste / arşiv) ilanlar: say, --apply ile arşivle
//   node --experimental-strip-types worker/ty-clean.ts nostock [--limit N] [--apply]   tedarikçide de stoğu olmayan stok-0 ilanlar: say, --apply ile arşivle (K 12.11)
//   node --experimental-strip-types worker/ty-clean.ts delete [--apply]    arşivde 25 saati dolanları kalıcı sil (geri alınamaz)
// Durum listing_retire tablosunda. K'nın "hepsi kalsın" kararı verdiği ilan (listing_holds keep_all) ve yayında stoklu ilan atlanır.
import { createClient } from "@supabase/supabase-js";
import { getMarketplace } from "./marketplaces/index.ts";
import { env, readAll, chunk, isSupplierKey, isOwnListing } from "./core/util.ts";
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
  const ids = listings.filter((l) => l.status === "closed" && !keep.has(l.id) && isSupplierKey(l.id)).map((l) => l.id); // K'nın kendi ilanı hariç (14.11)
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
  let cand = ls.data.filter((l: any) => isSupplierKey(l.listing_key) && why(l) && !sold.has(l.listing_key) && !keep.has(l.listing_key) && !archived.has(l.listing_key));
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
  // --eski: tedarikçi kalıbında olmayan ama K'nın da olmayan arşivli ilanlar (tedarikçiden kalkmış eski ilan; K 14.11 "sil, kişiye özel falan benim değil")
  const titles = new Map<string, string>();
  if (process.argv.includes("--eski")) { const t = await readAll<any>((a, b) => db.from("marketplace_listings").select("listing_key, title").eq("marketplace", "trendyol").is("variant_id", null).order("listing_key").range(a, b)); for (const x of t.data ?? []) titles.set(x.listing_key, x.title ?? ""); }
  const mine = (k: string) => isSupplierKey(k) || (process.argv.includes("--eski") && !isOwnListing(k, titles.get(k) ?? null) && titles.has(k));
  const ids = rows.data.filter((r: any) => mine(r.listing_key) && r.archived_at && !r.deleted_at && (Date.now() - Date.parse(r.archived_at)) / 3600_000 >= AFTER_H).map((r: any) => r.listing_key);
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
} else if (cmd === "retire-source" || cmd === "withdraw-rejected") {
  // K 15.11: "toptancım bayisini Trendyol'dan tamamen kaldır" (retire-source xml:toptancim) / "1500+ revize bekleyeni geri çek" (withdraw-rejected).
  // Onaylı (canlı/kapalı) ilan arşivlenir (24 saat sonra "delete" siler); onaysız/reddedilen ilan doğrudan silinir. Ürünler engel listesine
  // (app_state exclude_sources / exclude_products) yazılır: gönderim, yıldız kuyruğu ve yaşam döngüsü yeniden açmaz. Ürün kaydı bizde kalır (HB'ye gider).
  const source = cmd === "retire-source" ? process.argv[3] : null;
  if (cmd === "retire-source" && !/^xml:[a-z0-9_-]+$/.test(source ?? "")) throw new Error("kullanım: ty-clean.ts retire-source xml:<tedarikçi> [--apply]");
  const ls = await readAll<any>((a, b) => db.from("marketplace_listings").select("listing_key, product_id, status, products(source)").eq("marketplace", "trendyol").neq("status", "gone").order("listing_key").range(a, b));
  if (ls.error) throw new Error(ls.error.message);
  const mine = ls.data.filter((l: any) => isSupplierKey(l.listing_key) || l.product_id);
  const pick = source ? mine.filter((l: any) => l.products?.source === source) : mine.filter((l: any) => l.status === "rejected");
  const archiveIds = pick.filter((l: any) => ["live", "closed"].includes(l.status)).map((l: any) => l.listing_key);
  const deleteIds = pick.filter((l: any) => ["rejected", "pending_approval"].includes(l.status)).map((l: any) => l.listing_key);
  const pids = [...new Set(pick.map((l: any) => l.product_id).filter(Boolean))] as string[];
  console.log(JSON.stringify({ komut: cmd, kaynak: source, arsivlenecek: archiveIds.length, dogrudanSilinecek: deleteIds.length, urun: pids.length }));
  if (apply) {
    const now = new Date().toISOString();
    // önce engel listesi (iş yarıda kalsa da yeniden gönderilmesin)
    const key = source ? "exclude_sources:trendyol" : "exclude_products:trendyol";
    const { data: cur } = await db.from("app_state").select("value").eq("key", key).maybeSingle();
    let list: string[] = []; try { list = JSON.parse(cur?.value ?? "[]"); } catch { list = []; }
    const next = [...new Set([...list, ...(source ? [source] : pids)])];
    const { error: ae } = await db.from("app_state").upsert({ key, value: JSON.stringify(next), updated_at: now }, { onConflict: "key" });
    if (ae) throw new Error(`engel listesi yazılamadı: ${ae.message}`);
    const reason = source ? `tedarikçi Trendyol'dan kaldırıldı (K 15.11): ${source}` : "revize bekleyen geri çekildi (K 15.11)";
    const run = async (ids: string[], fn: (x: string[]) => Promise<any>) => {
      if (!ids.length) return new Map<string, string>();
      const r = await fn(ids); const chk = r.batchIds.length && mp.checkBatches ? await mp.checkBatches(r.batchIds) : null;
      const fail = new Map<string, string>(); for (const f of [...(r.failedItems ?? []), ...(chk?.failed ?? [])]) fail.set(f.id, f.reason); return fail;
    };
    const fa = await run(archiveIds, (x) => mp.archiveProducts!(x));
    await upsert(archiveIds.map((k) => ({ marketplace: "trendyol", listing_key: k, archived_at: fa.has(k) && !/daha önce yapılmış/i.test(fa.get(k)!) ? null : now, reason, last_attempt_at: now, attempts: 1, last_error: fa.get(k)?.slice(0, 300) ?? null })));
    const fd = await run(deleteIds, (x) => mp.deleteProducts!(x));
    const gone = deleteIds.filter((k) => !fd.has(k));
    await upsert(deleteIds.map((k) => ({ marketplace: "trendyol", listing_key: k, archived_at: now, deleted_at: fd.has(k) ? null : now, reason, last_attempt_at: now, last_error: fd.get(k)?.slice(0, 300) ?? null })));
    for (const part of chunk(gone, 500)) await db.from("marketplace_listings").update({ status: "gone", last_error: reason, updated_at: now }).eq("marketplace", "trendyol").in("listing_key", part);
    await db.from("audit_log").insert({ actor: "claude ty-clean", action: cmd, entity: "marketplace_listings", entity_id: source ?? "rejected", before: null, after: { arsivlenen: archiveIds.length - fa.size, silinen: gone.length, hata: fa.size + fd.size } });
    console.log(JSON.stringify({ arsivlenen: archiveIds.length - fa.size, silinen: gone.length, arsivHata: fa.size, silmeHata: fd.size, nedenler: [...new Set([...fa.values(), ...fd.values()])].slice(0, 5).map((x) => x.slice(0, 160)) }));
  }
} else if (cmd === "restore-own") {
  // K 14.11: 12.11 toplu temizlik K'nın kendi (tedarikçi barkodu olmayan) stoksuz ilanlarını da arşivledi -> arşivden çıkar, dokunma
  const rows = await readAll<any>((a, b) => db.from("listing_retire").select("listing_key, archived_at, deleted_at").eq("marketplace", "trendyol").order("listing_key").range(a, b));
  if (rows.error) throw new Error(rows.error.message);
  const ids = rows.data.filter((r: any) => r.archived_at && !r.deleted_at && !isSupplierKey(r.listing_key)).map((r: any) => r.listing_key);
  console.log(JSON.stringify({ geriAlinacak: ids.length, ornek: ids.slice(0, 5) }));
  if (apply && ids.length) {
    const r = await mp.archiveProducts!(ids, false);
    const chk = r.batchIds.length && mp.checkBatches ? await mp.checkBatches(r.batchIds) : null;
    const fail = new Map<string, string>();
    for (const f of r.failedItems ?? []) fail.set(f.id, f.reason);
    for (const f of chk?.failed ?? []) fail.set(f.id, f.reason);
    const now = new Date().toISOString();
    await upsert(ids.map((k) => ({ marketplace: "trendyol", listing_key: k, archived_at: fail.has(k) ? now : null, restored_at: fail.has(k) ? null : now, reason: "K'nın kendi ilanı: dokunulmaz (14.11)", last_attempt_at: now, last_error: fail.get(k)?.slice(0, 300) ?? null })));
    console.log(JSON.stringify({ arsivdenCikan: ids.length - fail.size, hatali: fail.size, nedenler: [...new Set(fail.values())].slice(0, 5).map((s) => s.slice(0, 160)) }));
  }
} else {
  console.log("kullanım: ty-clean.ts archive|nostock|delete|restore-own|retire-source <xml:x>|withdraw-rejected [--limit N] [--apply]");
}
