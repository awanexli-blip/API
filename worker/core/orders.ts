// Faz 6 F2/F5/F8: pazaryeri siparişlerini çek ve orders/order_lines'a yaz. Pazaryerine yalnızca paneldeki onaylı "takip kodunu bildir"
// kuyruğu yazar (pushTracking). Tekrar çalıştırmada kopya yok (order_upsert, migration 037/039/042). Alıcı ad-soyad + adres yalnızca
// tedarikçiye sipariş için (K kararı 23.10), loglanmaz, biten siparişte 30 gün sonra silinir (orders_purge_pii).
// Kâr kalemleri (orders.fin) fiyat motoruyla (worker/pricing.ts breakdown): sipariş anı maliyeti (satırda sabit), komisyon (pazaryerinin
// siparişte bildirdiği oran > ilan oranı > varsayılan), kargo, sabit gider, KDV farkı. Beklenen iade payı DÜŞÜLMEZ: gerçek iadeler ayrıca.
import { breakdown, type PricingConfig } from "../pricing.ts";
import { mapOrderStatus } from "./order-status.ts";
import type { Marketplace, OrderIn } from "../marketplaces/types.ts";

type Ref = { product_id: string | null; variant_id: string | null; commission: number | null; cost: number | null; sku?: string | null };
const r2 = (n: number) => Math.round(n * 100) / 100;
const STOPAJ = 0.01; // e-ticaret stopajı (KDV hariç satış üzerinden, gelir vergisinden mahsup edilir: gider değil, nakit kesinti)

export function orderRow(marketplace: string, o: OrderIn, refs: Map<string, Ref>, cfg: PricingConfig, frozen?: Map<number, number>) {
  const st = mapOrderStatus(marketplace, o.status);
  const lines = o.lines.map((l) => {
    const r = refs.get(l.key);
    return { line_no: l.lineNo, listing_key: l.key || null, product_id: r?.product_id ?? null, variant_id: r?.variant_id ?? null, title: l.title, qty: l.qty, unit_price: l.unitPrice,
      commission_rate: l.commissionRate ?? r?.commission ?? null, cost_snapshot: frozen?.get(l.lineNo) ?? r?.cost ?? null,
      list_price: l.listPrice ?? null, discount: l.discount ?? null, ty_discount: l.tyDiscount ?? null, supplier_sku: r?.sku ?? null };
  });
  const missing = lines.filter((l) => l.cost_snapshot == null);
  const units = lines.reduce((t, l) => t + l.qty, 0);
  const cost = missing.length ? null : r2(lines.reduce((t, l) => t + Number(l.cost_snapshot) * l.qty, 0));
  const gross = lines.reduce((t, l) => t + l.unit_price * l.qty, 0) || o.total;
  const comm = lines.every((l) => l.commission_rate != null) && gross > 0 ? lines.reduce((t, l) => t + Number(l.commission_rate) * l.unit_price * l.qty, 0) / gross : cfg.commissionRate;
  // Satıcının eline geçen: müşterinin ödediği + pazaryerinin karşıladığı indirim (satıcının kendi indirimi/kuponu düşülmüş kalır)
  const revenue = r2(o.total + lines.reduce((t, l) => t + (Number(l.ty_discount) || 0), 0));
  const sv = cfg.serviceVatRate ?? 0.2, v = cfg.vatRate ?? 0.2;
  let fin: Record<string, number | null> | null = null, net: number | null = null;
  if (st.status === "returned") {
    // İade: komisyon iade edilir, ürün geri gelir; kayıp = gidiş + dönüş kargosu ve paketleme (ayar: iade başına maliyet, KDV'si indirilir)
    const loss = r2((cfg.returnCost ?? 0) / (1 + sv));
    net = -loss;
    fin = { revenue, commission: 0, shipping: 0, service: 0, vat_due: 0, stopaj: 0, cost, return_loss: loss, net, commission_rate: r2(comm * 10000) / 10000 };
  } else if (st.status !== "cancelled" && revenue > 0) {
    const b = breakdown(revenue, cost ?? 0, { ...cfg, returnRate: 0 }, comm);
    net = cost != null ? b.net : null;
    fin = { revenue, commission: b.commission, shipping: b.shipping, service: r2(cfg.fixedCost), vat_due: cost != null ? b.vatDue : null, stopaj: r2(revenue / (1 + v) * STOPAJ),
      cost, return_loss: 0, net, commission_rate: r2(comm * 10000) / 10000 };
  }
  // Maliyeti bilinmeyen satır = ürün tedarikçi XML'inde yok (kalkmış ya da sistem dışında açılmış): tedarikçide olmayabilir, elle bakılmalı
  const open = !/^(cancelled|returned|delivered)$/.test(st.status);
  const late = open && st.status !== "shipped" && o.deadline != null && o.deadline < Date.now() ? "Kargoya verme süresi geçti" : null;
  const attention = st.attention ?? (missing.length && open ? `Tedarikçi XML'inde yok / maliyeti bilinmiyor: ${missing.map((l) => l.title || l.listing_key).slice(0, 3).join(", ")}` : late);
  return {
    marketplace, package_id: o.packageId, order_no: o.orderNo || null, status: st.status, marketplace_status: o.status, total: o.total, currency: o.currency,
    ordered_at: o.orderedAt ? new Date(o.orderedAt).toISOString() : null, ship_deadline: o.deadline ? new Date(o.deadline).toISOString() : null,
    cargo_provider: o.cargo, tracking_no: o.tracking, city: o.city, customer_name: o.customer?.name ?? null, address: o.customer?.address ?? null, est_cost: cost, est_net: net,
    needs_attention: !!attention, attention_reason: attention, lines, units, fin,
  };
}

export async function syncOrders(db: any, mp: Marketplace, cfg: PricingConfig, costOf: (key: string) => number | null, days = 14) {
  if (!mp.fetchOrders) return { skipped: "pazaryerinde sipariş çekme yok" };
  const orders = await mp.fetchOrders(Date.now() - days * 86400000, Date.now());
  const keys = [...new Set(orders.flatMap((o) => o.lines.map((l) => l.key)).filter(Boolean))];
  const refs = new Map<string, Ref>();
  for (let i = 0; i < keys.length; i += 300) {
    const { data } = await db.from("marketplace_listings").select("listing_key, product_id, variant_id, commission, products(cost_price, sku)").eq("marketplace", mp.id).in("listing_key", keys.slice(i, i + 300));
    for (const r of data ?? []) refs.set(r.listing_key, { product_id: r.product_id, variant_id: r.variant_id, commission: r.commission != null ? Number(r.commission) : null, cost: costOf(r.listing_key) ?? (r.products?.cost_price != null ? Number(r.products.cost_price) : null), sku: r.products?.sku ?? null });
  }
  for (const k of keys) if (!refs.has(k)) { const c = costOf(k); if (c != null) refs.set(k, { product_id: null, variant_id: null, commission: null, cost: c }); }
  // Sipariş anında kaydedilen maliyet sabit kalır (sonradan XML maliyeti değişse geçmiş kâr bozulmaz)
  const frozen = new Map<string, Map<number, number>>();
  const ids = orders.map((o) => o.packageId);
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("orders").select("package_id, order_lines(line_no, cost_snapshot)").eq("marketplace", mp.id).in("package_id", ids.slice(i, i + 200));
    for (const r of data ?? []) frozen.set(r.package_id, new Map((r.order_lines ?? []).filter((l: any) => l.cost_snapshot != null).map((l: any) => [l.line_no, Number(l.cost_snapshot)])));
  }
  const out = { fetched: orders.length, inserted: 0, updated: 0, same: 0, errors: 0, attention: 0, statuses: {} as Record<string, number> };
  for (const o of orders) {
    const row = orderRow(mp.id, o, refs, cfg, frozen.get(o.packageId));
    out.statuses[row.status] = (out.statuses[row.status] ?? 0) + 1;
    if (row.needs_attention) out.attention++;
    const { data, error } = await db.rpc("order_upsert", { p: row });
    if (error) { out.errors++; if (out.errors <= 3) console.error("sipariş yazılamadı:", error.message.slice(0, 200)); continue; } // sipariş no/kişisel veri basılmaz
    if (data === "inserted") out.inserted++; else if (data === "updated") out.updated++; else out.same++;
  }
  if (mp.orderDiag) (out as any).diag = mp.orderDiag;
  // KVKK: biten siparişlerde ad/adres 30 gün sonra silinir
  const pg = await db.rpc("orders_purge_pii", { p_days: 30 });
  (out as any).piiPurged = pg.error ? `hata: ${pg.error.message.slice(0, 100)}` : pg.data;
  return out;
}

// İade talepleri (F8): claims tablosuna yaz, siparişe bağla, siparişe iade nedenini yaz. Salt okunur.
export async function syncClaims(db: any, mp: Marketplace, days = 30) {
  if (!mp.fetchClaims) return { skipped: true };
  const list = await mp.fetchClaims(Date.now() - days * 86400000, Date.now());
  const nos = [...new Set(list.map((c) => c.orderNo).filter(Boolean))] as string[];
  const byNo = new Map<string, string>();
  for (let i = 0; i < nos.length; i += 200) {
    const { data } = await db.from("orders").select("id, order_no").eq("marketplace", mp.id).in("order_no", nos.slice(i, i + 200));
    for (const r of data ?? []) byNo.set(r.order_no, r.id);
  }
  const now = new Date().toISOString();
  const rows = list.map((c) => ({ marketplace: mp.id, claim_id: c.id, order_no: c.orderNo, order_id: c.orderNo ? byNo.get(c.orderNo) ?? null : null, status: c.status || null, reason: c.reason,
    reason_code: c.reasonCode, claimed_at: c.claimedAt ? new Date(c.claimedAt).toISOString() : null, amount: c.amount, lines: c.lines, cargo_provider: c.cargo, tracking_no: c.tracking, updated_at: now }));
  let errors = 0;
  for (let i = 0; i < rows.length; i += 200) { const { error } = await db.from("claims").upsert(rows.slice(i, i + 200), { onConflict: "marketplace,claim_id" }); if (error) errors++; }
  // Siparişe iade nedeni (kabul edilmemiş/iptal talepler hariç)
  let linked = 0;
  for (const r of rows) {
    if (!r.order_id || !r.reason || /^(Cancelled|Rejected)$/i.test(r.status ?? "")) continue;
    const { error } = await db.from("orders").update({ return_reason: r.reason.slice(0, 200) }).eq("id", r.order_id).is("return_reason", null);
    if (!error) linked++;
  }
  return { fetched: list.length, linked, errors, open: rows.filter((r) => /^(Created|WaitingInAction|InAnalysis|Unresolved)$/i.test(r.status ?? "")).length };
}

// Hakediş (gerçek komisyon): son 30 gün satış kayıtları siparişe yazılır; raporda tahmini komisyonun yerine geçer
export async function syncSettlements(db: any, mp: Marketplace, days = 30) {
  if (!mp.fetchSettlements) return { skipped: true };
  const list = await mp.fetchSettlements(Date.now() - days * 86400000, Date.now());
  let matched = 0;
  const now = new Date().toISOString();
  for (const s of list) {
    if (!(s.commission > 0)) continue;
    let q = db.from("orders").update({ act_commission: s.commission, act_revenue: s.revenue, settled_at: now }).eq("marketplace", mp.id);
    q = s.packageId ? q.eq("package_id", s.packageId) : q.eq("order_no", s.orderNo);
    const { data, error } = await q.select("id");
    if (!error && data?.length) matched++;
  }
  return { records: list.length, matched };
}

// Takip kodunu pazaryerine bildir (F5): yalnızca panelde "Pazaryerine bildir" ile onaylanmış (tracking_push = pending) siparişler.
// pending -> sending kilidi çift gönderimi önler; sonuç done / failed + hata. Takip no loglanmaz.
export async function pushTracking(db: any, mp: Marketplace) {
  if (!mp.updateTracking) return { skipped: true };
  const { data } = await db.from("orders").select("id, package_id, supplier_tracking, tracking_push_provider").eq("marketplace", mp.id).eq("tracking_push", "pending").limit(50);
  const out = { sent: 0, failed: 0 };
  for (const o of data ?? []) {
    const lock = await db.from("orders").update({ tracking_push: "sending" }).eq("id", o.id).eq("tracking_push", "pending").select("id");
    if (!lock.data?.length) continue;
    const provider = String(o.tracking_push_provider ?? "");
    try {
      if (!provider || !o.supplier_tracking) throw new Error("Kargo firması kodu veya takip no yok");
      await mp.updateTracking(o.package_id, provider, o.supplier_tracking);
      await db.from("orders").update({ tracking_push: "done", tracking_push_error: null, tracking_pushed_at: new Date().toISOString() }).eq("id", o.id);
      await db.from("order_events").insert({ order_id: o.id, kind: "tracking", actor: "sync", detail: { pushed: true, provider } });
      out.sent++;
    } catch (e: any) {
      await db.from("orders").update({ tracking_push: "failed", tracking_push_error: String(e?.message ?? e).slice(0, 300) }).eq("id", o.id);
      out.failed++;
    }
  }
  return out;
}

// Stok rezervasyonu (F6): tedarikçiye henüz verilmemiş açık siparişlerin adedi (son 48 saat), ürün bazında. XML stoğu düşene kadar
// tüm pazaryerlerine gönderilen stoktan düşülür; böylece aynı son ürün iki pazaryerinde birden satılmaz.
export async function loadReservations(db: any): Promise<{ byProduct: Map<string, number>; byKey: Map<string, number> }> {
  const { data, error } = await db.rpc("order_reservations", { p_hours: 48 });
  const byProduct = new Map<string, number>(), byKey = new Map<string, number>();
  if (error) return { byProduct, byKey };
  for (const r of data ?? []) {
    if (r.product_id) byProduct.set(r.product_id, (byProduct.get(r.product_id) ?? 0) + Number(r.qty));
    else if (r.listing_key) byKey.set(r.listing_key, (byKey.get(r.listing_key) ?? 0) + Number(r.qty));
  }
  return { byProduct, byKey };
}
