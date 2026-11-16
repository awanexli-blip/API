// Sipariş kâr analizi (K 17.11: "Trendyol siparişlerini analiz et, kuponları saymadan her siparişten ortalama net kârımız ne kadar"). SALT OKUNUR.
//   node --experimental-strip-types worker/order-profit.ts [trendyol] [--days 90]
// Her teslim edilen / yoldaki sipariş: bugünkü kâr hesabı (orders.fin, kupon düşülmüş gelir) ve satıcının karşıladığı indirim/kupon gelire
// geri eklenerek aynı fiyat motoruyla (breakdown) yeniden hesap. Müşteri verisi basılmaz.
import { createClient } from "@supabase/supabase-js";
import { env, readAll, isOwnListing } from "./core/util.ts";
import { breakdown, cfgFromSettings } from "./pricing.ts";

const mp = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "trendyol";
const days = Number(process.argv[process.argv.indexOf("--days") + 1]) || 90;
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const { data: s } = await db.from("settings").select("*").eq("id", 1).single();
const cfg = { ...cfgFromSettings(s), returnRate: 0 };
const since = new Date(Date.now() - days * 864e5).toISOString();
const r = await readAll<any>((a, b) => db.from("orders").select("id, order_no, status, ordered_at, total, fin, order_lines(listing_key, title, qty, unit_price, discount, ty_discount, cost_snapshot, commission_rate)")
  .eq("marketplace", mp).gte("ordered_at", since).order("id").range(a, b));
if (r.error) throw new Error(r.error.message);
const r2 = (n: number) => Math.round(n * 100) / 100;
const rows: any[] = [];
for (const o of r.data) {
  if (!["delivered", "shipped", "ready", "new", "picking"].includes(o.status) || !o.fin || o.fin.net == null) continue;
  const ls = o.order_lines ?? [];
  // Satıcı indirimi = toplam indirim - pazaryerinin karşıladığı (Trendyol satırı: discount toplam, ty_discount Trendyol payı)
  const sellerDisc = r2(ls.reduce((t: number, l: any) => t + Math.max(0, (Number(l.discount) || 0) - (Number(l.ty_discount) || 0)), 0));
  const comm = Number(o.fin.commission_rate) || cfg.commissionRate;
  const b = breakdown(Number(o.fin.revenue) + sellerDisc, Number(o.fin.cost), cfg, comm);
  const own = ls.some((l: any) => isOwnListing(l.listing_key, l.title));
  rows.push({ own, no: o.order_no, status: o.status, revenue: Number(o.fin.revenue), sellerDisc, net: Number(o.fin.net), netNoCoupon: r2(b.net), cost: Number(o.fin.cost), shipping: Number(o.fin.shipping) });
}
const avg = (k: string, xs = rows) => (xs.length ? r2(xs.reduce((t, x) => t + x[k], 0) / xs.length) : 0);
const med = (k: string) => { const v = rows.map((x) => x[k]).sort((a, b) => a - b); return v.length ? r2(v[Math.floor(v.length / 2)]) : 0; };
const withCoupon = rows.filter((x) => x.sellerDisc > 0);
const band = (k: string) => ({ zarar: rows.filter((x) => x[k] < 0).length, "0-40": rows.filter((x) => x[k] >= 0 && x[k] < 40).length, "40-60": rows.filter((x) => x[k] >= 40 && x[k] < 60).length, "60+": rows.filter((x) => x[k] >= 60).length });
const grp = (xs: any[]) => ({ siparis: xs.length, ortSepet: avg("revenue", xs), ortNetKuponDahil: avg("net", xs), ortNetKuponsuz: avg("netNoCoupon", xs), zarar: xs.filter((x) => x.netNoCoupon < 0).length, alti60: xs.filter((x) => x.netNoCoupon < 60).length, toplamNetKuponsuz: r2(xs.reduce((t, x) => t + x.netNoCoupon, 0)) });
console.log(JSON.stringify({ kendiUrunlerin: grp(rows.filter((x) => x.own)), tedarikciUrunleri: grp(rows.filter((x) => !x.own)),
  tedarikci_en_dusuk_10: rows.filter((x) => !x.own).sort((a, b) => a.netNoCoupon - b.netNoCoupon).slice(0, 10).map((x) => ({ no: x.no, satis: x.revenue, maliyet: x.cost, kargo: x.shipping, kupon: x.sellerDisc, netKuponsuz: x.netNoCoupon })) }, null, 1));
console.log(JSON.stringify({
  pazaryeri: mp, gun: days, siparis: rows.length, kuponlu: withCoupon.length, toplamSaticiIndirimi: r2(rows.reduce((t, x) => t + x.sellerDisc, 0)),
  ortalamaSepet: avg("revenue"),
  netKuponDahil: { ortalama: avg("net"), medyan: med("net"), toplam: r2(rows.reduce((t, x) => t + x.net, 0)), dagilim: band("net") },
  netKuponsuz: { ortalama: avg("netNoCoupon"), medyan: med("netNoCoupon"), toplam: r2(rows.reduce((t, x) => t + x.netNoCoupon, 0)), dagilim: band("netNoCoupon") },
  kuponluSiparisler: { adet: withCoupon.length, ortIndirim: avg("sellerDisc", withCoupon), ortNetKuponDahil: avg("net", withCoupon), ortNetKuponsuz: avg("netNoCoupon", withCoupon) },
  en_dusuk_10_kuponsuz: [...rows].sort((a, b) => a.netNoCoupon - b.netNoCoupon).slice(0, 10).map((x) => ({ no: x.no, satis: x.revenue, maliyet: x.cost, kupon: x.sellerDisc, net: x.net, netKuponsuz: x.netNoCoupon })),
}, null, 1));
