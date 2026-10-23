// Faz 6 F2: pazaryeri siparişlerini çek ve orders/order_lines'a yaz (salt okunur; pazaryerine hiçbir şey yazılmaz).
// Tekrar çalıştırmada kopya yok (order_upsert, migration 037/039). Alıcı ad-soyad + adres yalnızca tedarikçiye sipariş için (K kararı 23.10),
// loglanmaz, biten siparişte 30 gün sonra silinir (orders_purge_pii).
// Tahmini net kâr fiyat motoruyla (worker/pricing.ts breakdown): sipariş toplamı, satır maliyetleri (sipariş anı), ağırlıklı komisyon.
import { breakdown, type PricingConfig } from "../pricing.ts";
import { mapOrderStatus } from "./order-status.ts";
import type { Marketplace, OrderIn } from "../marketplaces/types.ts";

type Ref = { product_id: string | null; variant_id: string | null; commission: number | null; cost: number | null; sku?: string | null };

export function orderRow(marketplace: string, o: OrderIn, refs: Map<string, Ref>, cfg: PricingConfig) {
  const st = mapOrderStatus(marketplace, o.status);
  const lines = o.lines.map((l) => {
    const r = refs.get(l.key);
    return { line_no: l.lineNo, listing_key: l.key || null, product_id: r?.product_id ?? null, variant_id: r?.variant_id ?? null, title: l.title, qty: l.qty, unit_price: l.unitPrice, commission_rate: r?.commission ?? null, cost_snapshot: r?.cost ?? null,
      list_price: l.listPrice ?? null, discount: l.discount ?? null, ty_discount: l.tyDiscount ?? null, supplier_sku: r?.sku ?? null };
  });
  const missing = lines.filter((l) => l.cost_snapshot == null);
  const units = lines.reduce((t, l) => t + l.qty, 0);
  const cost = missing.length ? null : lines.reduce((t, l) => t + Number(l.cost_snapshot) * l.qty, 0);
  const gross = lines.reduce((t, l) => t + l.unit_price * l.qty, 0) || o.total;
  const comm = lines.every((l) => l.commission_rate != null) && gross > 0 ? lines.reduce((t, l) => t + Number(l.commission_rate) * l.unit_price * l.qty, 0) / gross : cfg.commissionRate;
  // Satıcının eline geçen: müşterinin ödediği + pazaryerinin karşıladığı indirim (satıcının kendi indirimi/kuponu düşülmüş kalır)
  const revenue = o.total + lines.reduce((t, l) => t + (Number(l.ty_discount) || 0), 0);
  const net = cost != null && revenue > 0 && !/^(cancelled|returned)$/.test(st.status) ? breakdown(revenue, cost, cfg, comm).net : null;
  // Maliyeti bilinmeyen satır = ürün tedarikçi XML'inde yok (kalkmış ya da sistem dışında açılmış): tedarikçide olmayabilir, elle bakılmalı
  const open = !/^(cancelled|returned|delivered)$/.test(st.status);
  const attention = st.attention ?? (missing.length && open ? `Tedarikçi XML'inde yok / maliyeti bilinmiyor: ${missing.map((l) => l.title || l.listing_key).slice(0, 3).join(", ")}` : null);
  return {
    marketplace, package_id: o.packageId, order_no: o.orderNo || null, status: st.status, marketplace_status: o.status, total: o.total, currency: o.currency,
    ordered_at: o.orderedAt ? new Date(o.orderedAt).toISOString() : null, ship_deadline: o.deadline ? new Date(o.deadline).toISOString() : null,
    cargo_provider: o.cargo, tracking_no: o.tracking, city: o.city, customer_name: o.customer?.name ?? null, address: o.customer?.address ?? null, est_cost: cost != null ? Math.round(cost * 100) / 100 : null, est_net: net,
    needs_attention: !!attention, attention_reason: attention, lines, units,
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
  const out = { fetched: orders.length, inserted: 0, updated: 0, same: 0, errors: 0, attention: 0, statuses: {} as Record<string, number> };
  for (const o of orders) {
    const row = orderRow(mp.id, o, refs, cfg);
    out.statuses[row.status] = (out.statuses[row.status] ?? 0) + 1;
    if (row.needs_attention) out.attention++;
    const { data, error } = await db.rpc("order_upsert", { p: row });
    if (error) { out.errors++; if (out.errors <= 3) console.error("sipariş yazılamadı:", error.message.slice(0, 200)); continue; } // sipariş no/kişisel veri basılmaz
    if (data === "inserted") out.inserted++; else if (data === "updated") out.updated++; else out.same++;
  }
  // KVKK: biten siparişlerde ad/adres 30 gün sonra silinir
  const pg = await db.rpc("orders_purge_pii", { p_days: 30 });
  (out as any).piiPurged = pg.error ? `hata: ${pg.error.message.slice(0, 100)}` : pg.data;
  return out;
}
