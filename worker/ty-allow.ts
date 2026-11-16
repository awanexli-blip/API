// Kapalı tedarikçinin (Trendyol'da Toptancım, K 15.11) kazandıran ilanlarını geri aç (K 17.11: "bu formülde hâlâ buybox kazanan Toptancım ürünü varsa ekle").
//   node --experimental-strip-types worker/ty-allow.ts xml:toptancim [--apply]
// Seçim: stok >= en az stok, başka tedarikçide birebir aynısı daha ucuz değil (product_dupes), ve (Trendyol'da satmış ya da tek satıcı / buybox bizde /
// yeni formül fiyatı buybox fiyatının altında). Uygula: ürünler app_state allow_products:trendyol'a yazılır (senkron stok/fiyat gönderir),
// ilanlar Trendyol'da arşivden çıkarılır. Deneme varsayılan.
import { createClient } from "@supabase/supabase-js";
import { env, readAll, chunk, isOwnListing } from "./core/util.ts";
import { calcPrice, cfgFromSettings } from "./pricing.ts";
import { parseDyn, marginFor, DEFAULT_DYN } from "./core/dynamic-margin.ts";
import { getMarketplace } from "./marketplaces/index.ts";

const source = process.argv[2] ?? "";
const APPLY = process.argv.includes("--apply");
if (!/^xml:[a-z0-9_-]+$/.test(source)) throw new Error("kullanım: ty-allow.ts xml:<tedarikçi> [--apply]");
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const { data: s } = await db.from("settings").select("*").eq("id", 1).single();
const cfg = cfgFromSettings(s), dyn = parseDyn(s.dynamic_margin) ?? DEFAULT_DYN, minStock = Number(s.min_stock ?? 3);
const ls = await readAll<any>((a, b) => db.from("marketplace_listings").select("listing_key, product_id, title, status, commission, product_variants(stock, reserved, cost_price), products!inner(source, status, cost_price)")
  .eq("marketplace", "trendyol").eq("products.source", source).in("status", ["live", "closed"]).order("listing_key").range(a, b));
if (ls.error) throw new Error(ls.error.message);
const keys = ls.data.map((l: any) => l.listing_key);
const bb = new Map<string, any>(), sold = new Set<string>(), dupe = new Map<string, boolean>();
for (const part of chunk(keys, 300)) {
  const { data } = await db.from("listing_buybox").select("listing_key, buybox_order, buybox_price, multiple").eq("marketplace", "trendyol").in("listing_key", part);
  for (const x of data ?? []) bb.set(x.listing_key, x);
  const { data: o } = await db.from("order_lines").select("listing_key, orders!inner(marketplace, status)").in("listing_key", part).eq("orders.marketplace", "trendyol").neq("orders.status", "cancelled");
  for (const x of o ?? []) sold.add(x.listing_key);
}
const pids = [...new Set(ls.data.map((l: any) => l.product_id))] as string[];
for (const part of chunk(pids, 300)) { const { data } = await db.from("product_dupes").select("product_id, cheapest").in("product_id", part); for (const x of data ?? []) dupe.set(x.product_id, x.cheapest); }
const pick: any[] = []; const why: Record<string, number> = {};
const r2 = (n: number) => Math.round(n * 100) / 100;
for (const l of ls.data as any[]) {
  if (isOwnListing(l.listing_key, l.title) || l.products?.status !== "active") continue;
  const v = l.product_variants, avail = Math.max(0, Number(v?.stock ?? 0) - Number(v?.reserved ?? 0));
  if (avail < minStock) { why.stoksuz = (why.stoksuz ?? 0) + 1; continue; }
  if (dupe.get(l.product_id) === false) { why.baskaTedarikcideUcuz = (why.baskaTedarikcideUcuz ?? 0) + 1; continue; }
  const cost = Number(v?.cost_price) || Number(l.products?.cost_price), comm = Number(l.commission) > 0 ? Number(l.commission) : cfg.commissionRate;
  const b = bb.get(l.listing_key);
  const base = calcPrice(cost, cfg, comm);
  if (!base.ok) { why.fiyatYok = (why.fiyatYok ?? 0) + 1; continue; }
  const comp = b ? b.multiple === true : undefined;
  const r = calcPrice(cost, { ...cfg, netMarginMin: marginFor(dyn, { competition: comp, price: base.price }) }, comm);
  const price = r.ok ? r.price : base.price;
  const reason = sold.has(l.listing_key) ? "satmış" : b && b.multiple === false ? "tek satıcı" : b && Number(b.buybox_order) === 1 ? "buybox bizde" : b && Number(b.buybox_price) > 0 && price < Number(b.buybox_price) ? "yeni fiyat buybox altında" : null;
  if (!reason) { why[b ? "buyboxRakipte" : "buyboxVerisiYok"] = (why[b ? "buyboxRakipte" : "buyboxVerisiYok"] ?? 0) + 1; continue; }
  why[reason] = (why[reason] ?? 0) + 1;
  pick.push({ key: l.listing_key, pid: l.product_id, price: r2(price), status: l.status });
}
console.log(JSON.stringify({ kaynak: source, ilan: ls.data.length, acilacak: pick.length, neden: why }, null, 1));
if (!APPLY || !pick.length) process.exit(0);
const now = new Date().toISOString();
const { data: cur } = await db.from("app_state").select("value").eq("key", "allow_products:trendyol").maybeSingle();
let list: string[] = []; try { list = JSON.parse(cur?.value ?? "[]"); } catch { list = []; }
const next = [...new Set([...list, ...pick.map((p) => p.pid)])];
const { error: ae } = await db.from("app_state").upsert({ key: "allow_products:trendyol", value: JSON.stringify(next), updated_at: now }, { onConflict: "key" });
if (ae) throw new Error(`izin listesi yazılamadı: ${ae.message}`);
const mp = getMarketplace("trendyol");
let ok = 0, fail = 0;
for (const part of chunk(pick.map((p) => p.key), 500)) {
  const r = await mp.archiveProducts!(part, false);
  const chk = r.batchIds.length && mp.checkBatches ? await mp.checkBatches(r.batchIds) : null;
  const bad = new Set([...(r.failedItems ?? []), ...(chk?.failed ?? [])].filter((f: any) => !/daha önce yapılmış/i.test(f.reason)).map((f: any) => f.id));
  const good = part.filter((k) => !bad.has(k)); ok += good.length; fail += bad.size;
  for (const g of chunk(good, 500)) await db.from("listing_retire").update({ archived_at: null, restored_at: now, reason: "kazandıran ilan geri açıldı (K 17.11)", last_error: null }).eq("marketplace", "trendyol").in("listing_key", g);
}
await db.from("audit_log").insert({ actor: "claude ty-allow", action: "allow-source-products", entity: "marketplace_listings", entity_id: source, before: null, after: { acilan: ok, hata: fail, izinListesi: next.length } });
console.log(JSON.stringify({ arsivdenCikan: ok, hata: fail, izinListesi: next.length }));
