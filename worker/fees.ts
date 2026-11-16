// Gider takibi (K 17.11): Trendyol cari hesap kesintileri + kargo faturası kalemleri -> mp_fees; siparişin gerçek kargosu (orders.act_shipping),
// ürünün gerçek desisi (products.desi_actual), aylık gider özeti ve gerçek kargoyla taban altına düşen siparişler (app_state fees_report:trendyol).
// Yeni ceza (tedarik edememe, termin gecikme...) ve zarar eden sipariş Telegram'a bir kez bildirilir. Salt okunur pazaryeri; müşteri verisi yok.
//   node --experimental-strip-types worker/fees.ts [--days 30]
import { createClient } from "@supabase/supabase-js";
import { env, sleep, chunk, readAll } from "./core/util.ts";
import { notifyOnce } from "./core/notify.ts";
import { esc } from "./core/telegram.ts";
import { feeCategory } from "./core/fee-category.ts";

const DAYS = Math.min(365, Number(process.argv[process.argv.indexOf("--days") + 1]) || 30);
const MP = "trendyol";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const S = env("TRENDYOL_SELLER_ID");
const H = { Authorization: "Basic " + Buffer.from(`${env("TRENDYOL_API_KEY")}:${env("TRENDYOL_API_SECRET")}`).toString("base64"), "User-Agent": `${S} - SelfIntegration` };
const log = (m: string) => console.error(`${new Date().toISOString().slice(11, 19)} ${m}`);
const r2 = (n: number) => Math.round(n * 100) / 100;

async function get(path: string): Promise<any> {
  for (let i = 0; ; i++) {
    const r = await fetch(`https://apigw.trendyol.com/integration${path}`, { headers: H, signal: AbortSignal.timeout(60000) }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }) as any);
    if (r.ok) return r.json();
    if (i >= 3 || (r.status && r.status < 500 && r.status !== 429)) throw new Error(`Trendyol ${r.status}: ${(await r.text()).slice(0, 200)}`);
    await sleep(3000 * (i + 1));
  }
}

const rows: any[] = [];
const types = ["DeductionInvoices", "ReturnInvoice", "Stoppage", "FinancialItem"];
const now = Date.now();
for (const tt of types) {
  for (let e = now; e > now - DAYS * 864e5; e -= 15 * 864e5) {
    const s = Math.max(now - DAYS * 864e5, e - 15 * 864e5 + 1);
    for (let page = 0; ; page++) {
      let r: any;
      try { r = await get(`/finance/che/sellers/${S}/otherfinancials?transactionType=${tt}&startDate=${s}&endDate=${e}&page=${page}&size=500`); }
      catch (err: any) { log(`${tt} okunamadı: ${err.message}`); break; }
      for (const x of r.content ?? []) {
        const kind = String(x.transactionType ?? tt);
        rows.push({ marketplace: MP, fee_id: String(x.id), kind, category: feeCategory(kind), order_no: x.orderNumber ? String(x.orderNumber) : null, package_id: x.shipmentPackageId ? String(x.shipmentPackageId) : null,
          amount: r2(Number(x.debt || 0) - Number(x.credit || 0)), desi: null, invoice_id: null, fee_date: x.transactionDate ? new Date(x.transactionDate).toISOString() : null, description: String(x.description ?? "").slice(0, 300), fetched_at: new Date().toISOString() });
      }
      await sleep(300);
      if (page + 1 >= (r.totalPages ?? 1)) break;
    }
  }
}
const uniq = [...new Map(rows.map((x) => [x.fee_id, x])).values()];
for (const part of chunk(uniq, 500)) { const { error } = await db.from("mp_fees").upsert(part, { onConflict: "marketplace,fee_id" }); if (error) throw new Error(`mp_fees yazılamadı: ${error.message}`); }
log(`kesinti: ${uniq.length}`);

// Kargo faturası kalemleri (sipariş bazında gerçek kargo + desi): yalnızca kalemi henüz alınmamış faturalar
const invoices = uniq.filter((x) => x.kind === "Kargo Fatura").map((x) => x.fee_id);
const { data: done } = await db.from("mp_fees").select("invoice_id").eq("marketplace", MP).in("invoice_id", invoices.length ? invoices : ["-"]);
const have = new Set((done ?? []).map((x: any) => x.invoice_id));
let items = 0;
for (const inv of invoices.filter((i) => !have.has(i))) {
  const its: any[] = [];
  for (let page = 0; ; page++) {
    const r = await get(`/finance/che/sellers/${S}/cargo-invoice/${encodeURIComponent(inv)}/items?page=${page}&size=500`);
    its.push(...(r.content ?? []));
    await sleep(300);
    if (page + 1 >= (r.totalPages ?? 1)) break;
  }
  const head = uniq.find((x) => x.fee_id === inv);
  const recs = its.map((x) => ({ marketplace: MP, fee_id: `${inv}:${x.parcelUniqueId}:${x.shipmentPackageType}`, kind: String(x.shipmentPackageType ?? "Kargo"), category: /iade/i.test(x.shipmentPackageType ?? "") ? "iade_kargo_kalem" : "kargo_kalem",
    order_no: x.orderNumber ? String(x.orderNumber) : null, package_id: x.parcelUniqueId ? String(x.parcelUniqueId) : null, amount: r2(Number(x.amount) || 0), desi: x.desi != null ? Number(x.desi) : null,
    invoice_id: inv, fee_date: head?.fee_date ?? null, description: null, fetched_at: new Date().toISOString() }));
  for (const part of chunk([...new Map(recs.map((x) => [x.fee_id, x])).values()], 500)) { const { error } = await db.from("mp_fees").upsert(part, { onConflict: "marketplace,fee_id" }); if (error) throw new Error(`kargo kalemi yazılamadı: ${error.message}`); }
  items += recs.length;
}
log(`kargo kalemi: ${items} (yeni fatura ${invoices.filter((i) => !have.has(i)).length})`);

// Siparişin gerçek kargosu ve ürünün gerçek desisi (tüm kalemlerden; tek ürünlü tek adetli siparişte desi ürüne yazılır)
const k = await readAll<any>((a, b) => db.from("mp_fees").select("order_no, amount, desi, category").eq("marketplace", MP).eq("category", "kargo_kalem").not("order_no", "is", null).order("fee_id").range(a, b));
if (k.error) throw new Error(k.error.message);
const byOrder = new Map<string, { amt: number; desi: number }>();
for (const x of k.data) { const o = byOrder.get(x.order_no) ?? { amt: 0, desi: 0 }; o.amt += Number(x.amount); o.desi = Math.max(o.desi, Number(x.desi) || 0); byOrder.set(x.order_no, o); }
const nos = [...byOrder.keys()];
let desiSet = 0;
for (const part of chunk(nos, 200)) {
  const { data: os } = await db.from("orders").select("id, order_no, act_shipping, order_lines(product_id, qty)").eq("marketplace", MP).in("order_no", part);
  for (const o of os ?? []) {
    const a = byOrder.get(o.order_no)!;
    if (Number(o.act_shipping) !== r2(a.amt)) await db.from("orders").update({ act_shipping: r2(a.amt), act_desi: a.desi || null }).eq("id", o.id);
    const ls = (o.order_lines ?? []).filter((l: any) => l.product_id);
    if (ls.length === 1 && Number(ls[0].qty) === 1 && a.desi > 0) { await db.from("products").update({ desi_actual: a.desi }).eq("id", ls[0].product_id); desiSet++; }
  }
}
log(`gerçek kargo: ${nos.length} sipariş, desi öğrenilen ürün ${desiSet}`);

// Özet: aylık kategori toplamları, sipariş başına genel gider (ceza+duyuru+reklam+diğer), gerçek kargoyla taban altı/zarar eden siparişler
const all = await readAll<any>((a, b) => db.from("mp_fees").select("fee_id, kind, category, amount, fee_date, order_no").eq("marketplace", MP).not("category", "in", "(kargo_kalem,iade_kargo_kalem)").order("fee_id").range(a, b));
const months: Record<string, Record<string, number>> = {};
for (const x of all.data ?? []) { const m = String(x.fee_date ?? "").slice(0, 7) || "?"; months[m] ??= {}; months[m][x.category] = r2((months[m][x.category] ?? 0) + Number(x.amount)); }
const { data: st } = await db.from("settings").select("net_profit_min").eq("id", 1).single();
const floor = Number(st?.net_profit_min ?? 50);
const since30 = new Date(now - 30 * 864e5).toISOString();
const ord = await readAll<any>((a, b) => db.from("orders").select("order_no, status, ordered_at, fin, act_shipping, order_lines(listing_key, title)").eq("marketplace", MP).gte("ordered_at", new Date(now - 90 * 864e5).toISOString()).order("id").range(a, b));
const sv = 0.2;
const orders = (ord.data ?? []).filter((o: any) => o.fin && o.fin.net != null && !["cancelled", "returned"].includes(o.status));
const { isOwnListing } = await import("./core/util.ts");
const enriched = orders.map((o: any) => {
  const est = Number(o.fin.shipping) || 0, act = o.act_shipping != null ? Number(o.act_shipping) : null;
  const netAct = act != null ? r2(Number(o.fin.net) - (act - est) / (1 + sv)) : Number(o.fin.net); // kargo farkı (KDV'si indirilir)
  return { no: o.order_no, at: o.ordered_at, revenue: Number(o.fin.revenue), est, act, net: Number(o.fin.net), netAct, own: (o.order_lines ?? []).some((l: any) => isOwnListing(l.listing_key, l.title)) };
});
const last30 = enriched.filter((o) => o.at >= since30);
const overheadCats = ["ceza", "duyuru", "reklam", "diger"];
const overhead30 = r2((all.data ?? []).filter((x: any) => x.fee_date >= since30 && overheadCats.includes(x.category)).reduce((t: number, x: any) => t + Number(x.amount), 0));
const withAct = enriched.filter((o) => o.act != null);
const report = {
  at: new Date().toISOString(), days: DAYS, floor,
  months,
  shipping: { orders: withAct.length, estimated: r2(withAct.reduce((t, o) => t + o.est, 0)), actual: r2(withAct.reduce((t, o) => t + (o.act ?? 0), 0)), underEstimated: withAct.filter((o) => (o.act ?? 0) > o.est + 1).length },
  overhead30: { total: overhead30, orders: last30.length, perOrder: last30.length ? r2(overhead30 / last30.length) : 0 },
  belowFloor: enriched.filter((o) => !o.own && o.netAct < floor).sort((a, b) => a.netAct - b.netAct).slice(0, 50),
  supplierAvgNet: (() => { const xs = enriched.filter((o) => !o.own && o.at >= since30); return xs.length ? r2(xs.reduce((t, o) => t + o.netAct, 0) / xs.length) : null; })(),
};
await db.from("app_state").upsert({ key: `fees_report:${MP}`, value: JSON.stringify(report), updated_at: new Date().toISOString() }, { onConflict: "key" });
console.log(JSON.stringify({ kesinti: uniq.length, kargoKalem: items, gercekKargoSiparis: nos.length, desiOgrenilen: desiSet, kargo: report.shipping, genelGider30: report.overhead30, tabanAlti: report.belowFloor.length, tedarikciOrtNet30: report.supplierAvgNet }));

// Telegram: yeni ceza kalemi ve gerçek kargoyla zarar eden tedarikçi siparişi (her biri bir kez)
for (const x of uniq.filter((x) => x.category === "ceza" && x.amount > 0 && x.fee_date >= since30)) {
  await notifyOnce(db, `fee:${x.fee_id}`, `⚠️ <b>Trendyol ceza kesintisi</b>\n${esc(x.kind)}: <b>${x.amount.toFixed(2)} TL</b>${x.order_no ? `\nSipariş ${esc(x.order_no)}` : ""}\n${esc(String(x.description).slice(0, 160))}`);
}
for (const o of enriched.filter((o) => !o.own && o.act != null && o.netAct < 0 && o.at >= since30)) {
  await notifyOnce(db, `feeloss:${o.no}`, `🔻 <b>Gerçek kargoyla zarar</b>\nSipariş ${esc(o.no)}: satış ${o.revenue.toFixed(2)} TL, kargo tahmini ${o.est.toFixed(2)} / gerçek ${(o.act ?? 0).toFixed(2)} TL, net <b>${o.netAct.toFixed(2)} TL</b>`);
}
