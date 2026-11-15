// Tedarikçiye sipariş: DENEME TASLAĞI (K 15.11). Bezos'a GÖNDERMEZ; gönderilecek isteğin birebir aynısını hazırlar ve raporlar.
//   node --experimental-strip-types worker/supplier-order.ts dry [--order <siparişNo>] [--days 7]
// Açık siparişler (new / ready) içindeki Bezos satırları: varyant ve Bezos kodu (supplier-bezos.ts), anlık stok/fiyat, ortak kargo,
// Trendyol kargo değiştirme önerisi, POST /orders gövdesi (requestKey sipariş+tedarikçiden türetilir: tekrar gönderimde aynı sipariş),
// bakiye yeterliliği, tahmini kâr. Rapor: app_state "supplier_order_dry" (panel okuyacak). Müşteri adı rapora ve günlüğe yazılmaz.
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { env, readAll } from "./core/util.ts";
import { resolveBezosLine, planBezosOrder, type ResolveDeps } from "./core/supplier-bezos.ts";

const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const cmd = process.argv[2];
if (cmd !== "dry") { console.log("kullanım: supplier-order.ts dry [--order <no>] [--days 7]"); process.exit(1); }
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const KEY = env("BEZOS_API_KEY"), BASE = "https://bezos.com.tr/api/v1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function bezosGet(path: string) {
  const wait = 520 - (Date.now() - last); if (wait > 0) await sleep(wait); last = Date.now(); // dakikada en fazla 120 istek
  const r = await fetch(BASE + path, { headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
// Sipariş + tedarikçiden kararlı UUID (aynı sipariş -> aynı requestKey -> Bezos aynı siparişi döndürür)
const requestKey = (orderId: string, supplier: string) => { const h = createHash("sha256").update(`${orderId}:${supplier}:1`).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };

const deps: ResolveDeps = {
  variantsOfProduct: async (pid) => (await db.from("product_variants").select("barcode, sku, attributes, stock").eq("product_id", pid)).data ?? [],
  productOfBarcode: async (bc) => { const { data } = await db.from("product_variants").select("product_id, products(source_ref)").eq("barcode", bc).limit(1); const v: any = data?.[0]; return v ? { productId: v.product_id, sourceRef: v.products?.source_ref ?? null } : null; },
  sourceRefOf: async (pid) => (await db.from("products").select("source_ref").eq("id", pid).maybeSingle()).data?.source_ref ?? null,
  bezos: async (q) => { const r = await bezosGet(`/products/${encodeURIComponent(q)}`); const d = r.body?.product ?? r.body; return r.status === 200 && d?.code ? d : null; },
};

const days = Number(arg("--days") ?? 7), one = arg("--order");
let q = db.from("orders").select("id, marketplace, order_no, status, ordered_at, total, est_net, cargo_provider, tracking_no, package_id, customer_name, order_lines(listing_key, supplier_sku, qty, unit_price, title, product_id)").order("ordered_at", { ascending: false }).limit(200);
q = one ? q.eq("order_no", one) : q.in("status", ["new", "ready"]).gte("ordered_at", new Date(Date.now() - days * 86400000).toISOString());
const { data: orders, error } = await q;
if (error) throw new Error(error.message);
const isBezos = (l: any) => /^BZ/i.test(l.supplier_sku ?? "") || /^BZ/i.test(l.listing_key ?? "");
const me = await bezosGet("/me");
// Bezos'ta zaten verilmiş siparişler (elle ya da önceki gönderim): aynı pazaryeri kargo barkodu = aynı sipariş, ikinci kez gönderilmez
const existing = new Map<string, { id: string; status: string }>();
{ const r = await bezosGet("/orders?page=1&limit=100"); for (const x of r.body?.orders ?? []) if (x.barcode && !/iptal/i.test(String(x.status))) existing.set(String(x.barcode), { id: String(x.id), status: String(x.status) }); }
let balance = Number(me.body?.balance ?? me.body?.data?.balance ?? NaN);
const drafts: any[] = [];
for (const o of (orders ?? []) as any[]) {
  const lines = (o.order_lines ?? []).filter(isBezos);
  if (!lines.length) continue;
  const others = (o.order_lines ?? []).length - lines.length;
  const res = [] as { qty: number; res: any }[];
  for (const l of lines) res.push({ qty: Math.max(1, Number(l.qty) || 1), res: await resolveBezosLine(l, deps) });
  const plan = planBezosOrder(res, o.cargo_provider, o.marketplace);
  const problems = [...plan.problems];
  if (!o.tracking_no) problems.push("pazaryeri kargo barkodu (takip no) henüz yok: Bezos barkodsuz sipariş almaz");
  const already = o.tracking_no ? existing.get(String(o.tracking_no)) : undefined;
  if (already) problems.unshift(`ZATEN BEZOS'TA SİPARİŞ VAR (${already.status}): ikinci kez gönderilmez`);
  if (!o.customer_name) problems.push("alıcı adı yok (silinmiş)");
  const amount = plan.items.reduce((t, i) => t + i.quantity * i.expectedUnitPrice, 0);
  if (Number.isFinite(balance) && amount > balance) problems.push(`bakiye yetersiz (${balance.toFixed(2)} TL < ${amount.toFixed(2)} TL)`);
  const body = { requestKey: requestKey(o.id, "bezos"), acceptContracts: true, paymentMethod: "wallet", channel: o.marketplace === "hepsiburada" ? "Hepsiburada" : "Trendyol",
    carrier: plan.carrier, barcode: o.tracking_no ?? null, customer: "‹alıcı adı›", items: plan.items.map(({ name, ...i }) => i) };
  const ready = plan.ok && !problems.length;
  if (ready && Number.isFinite(balance)) balance -= amount; // aynı turda sıradaki siparişler için kalan bakiye
  drafts.push({ alreadyOrdered: already ?? null, order_id: o.id, marketplace: o.marketplace, order_no: o.order_no, status: o.status, ordered_at: o.ordered_at, ready, problems, cargoChange: plan.cargoChange ?? null,
    otherSupplierLines: others, amount: Math.round(amount * 100) / 100, saleTotal: Number(o.total), estNet: o.est_net,
    lines: res.map((x, i) => ({ title: String(lines[i].title ?? "").slice(0, 80), qty: x.qty, ok: x.res.ok, code: x.res.ok ? x.res.code : null, by: x.res.ok ? x.res.by : null, reason: x.res.ok ? null : x.res.reason, stock: x.res.ok ? x.res.product.stock : null, unitPrice: x.res.ok ? x.res.product.unitPrice : null })),
    request: body });
}
const report = { at: new Date().toISOString(), mode: "dry", balance: Number(me.body?.balance ?? NaN), orders: drafts.length, ready: drafts.filter((d) => d.ready).length, drafts };
await db.from("app_state").upsert({ key: "supplier_order_dry", value: JSON.stringify(report), updated_at: report.at }, { onConflict: "key" });
console.log(JSON.stringify({ bakiye: report.balance, siparis: report.orders, hazir: report.ready, zatenVerilmis: drafts.filter((d) => d.alreadyOrdered).length, sorunlu: report.orders - report.ready }));
for (const d of drafts) {
  console.log(`\n${d.ready ? "✅ HAZIR" : "⛔ GÖNDERİLMEZ"} ${d.marketplace} ${d.order_no} (${d.status}) · Bezos tutarı ${d.amount} TL · satış ${d.saleTotal} TL${d.otherSupplierLines ? ` · ${d.otherSupplierLines} satır başka tedarikçide` : ""}`);
  for (const l of d.lines) console.log(`   - ${l.title} x${l.qty} -> ${l.ok ? `${l.code} (${l.by}) stok ${l.stock} · ${l.unitPrice} TL` : `ÇÖZÜLEMEDİ: ${l.reason}`}`);
  if (d.problems.length) console.log(`   sorun: ${d.problems.join(" · ")}`);
  if (d.cargoChange) console.log(`   öneri: Trendyol'da kargoyu ${d.cargoChange.carrier} (${d.cargoChange.code}) yap`);
  console.log(`   gönderilecek istek: ${JSON.stringify(d.request)}`);
}
