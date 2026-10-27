// Rekabet / buybox takibi (salt okunur): satıştaki ilanların buybox sırası ve fiyatı (Trendyol Ürün Buybox Kontrol), kâr hesabıyla
// listing_buybox'a yazılır (migration 046). Fiyat değiştirmez: öneri panelde (Pazaryeri > Rekabet), uygulama kullanıcı onayıyla elle fiyat.
// Çalışma başına en fazla `max` ilan; hiç bakılmamış ve en eski bakılanlar önce (tüm mağaza birkaç çalışmada döner).
import { breakdown, type PricingConfig } from "../pricing.ts";
import type { Listing, Marketplace } from "../marketplaces/types.ts";

type Econ = { cost: number; comm: number; pcfg: PricingConfig; price: number };
const r2 = (n: number) => Math.round(n * 100) / 100;

// Buybox'ı almak için önerilen fiyat: buybox fiyatının 1 TL altı (x9,90 yuvarlaması yapılmaz: fark küçük kalsın)
export function targetFor(buyboxPrice: number | null, order: number | null) {
  if (!buyboxPrice || !order || order <= 1) return null;
  return r2(Math.max(0, buyboxPrice - 1));
}

// Öneri (K, 27.10: "her seferinde güncel verilere göre araştırsın, karşılaştıralım sonra kabul edelim"); uygulama yalnızca onayla:
//  lower: buybox başkasında, 1 TL altına inince net kâr en az minNet (40 TL) kalıyor
//  raise: buybox bizde, ikinci satıcı bizden %2+ pahalı -> ikincinin 1 TL altına çıkarak buybox korunur, kâr artar
//  reset: elle (rekabet) fiyatı var ama artık rakip yok -> formül fiyatına dön
export function suggestFor(o: { order: number | null; multiple: boolean | null; buybox: number | null; second: number | null; ours: number | null; overridden: boolean; minNet: number; netAt: (p: number) => number }) {
  if (o.order != null && o.order > 1 && o.buybox) {
    const price = r2(Math.max(0, o.buybox - 1)), net = r2(o.netAt(price));
    return net >= o.minNet ? { kind: "lower" as const, price, net } : null;
  }
  if (o.order === 1 && o.multiple && o.second && o.ours && o.second - 1 > o.ours * 1.02) {
    const price = r2(o.second - 1);
    return { kind: "raise" as const, price, net: r2(o.netAt(price)) };
  }
  if (o.overridden && o.multiple === false) return { kind: "reset" as const, price: null, net: null };
  return null;
}

export async function syncBuybox(db: any, mp: Marketplace, listings: Listing[], econ: Map<string, Econ>, max = 2000, opts: { minNet?: number; overridden?: Set<string> } = {}) {
  if (!mp.buybox) return { skipped: true };
  const live = listings.filter((l) => (l.status ?? "active") === "active" && Number(l.price) > 0 && econ.has(l.id));
  if (!live.length) return { live: 0 };
  // Son bakılma zamanları (anahtar sıralı sayfalama)
  const seen = new Map<string, string>();
  for (let last = ""; ; ) {
    const { data, error } = await db.from("listing_buybox").select("listing_key, checked_at").eq("marketplace", mp.id).gt("listing_key", last).order("listing_key").limit(1000);
    if (error || !data?.length) break;
    for (const r of data) seen.set(r.listing_key, r.checked_at);
    last = data[data.length - 1].listing_key;
    if (data.length < 1000) break;
  }
  const pick = live.map((l) => l.id).sort((a, b) => (seen.get(a) ?? "").localeCompare(seen.get(b) ?? "")).slice(0, max);
  const info = await mp.buybox(pick);
  const now = new Date().toISOString();
  const rows = info.map((b) => {
    const e = econ.get(b.id)!;
    const ours = e?.price ?? null;
    const netAt = (p: number) => (e ? breakdown(p, e.cost, { ...e.pcfg, returnRate: 0 }, e.comm).net : -Infinity);
    const sg = suggestFor({ order: b.order, multiple: b.multiple, buybox: b.price, second: b.second, ours, overridden: !!opts.overridden?.has(b.id), minNet: opts.minNet ?? 0, netAt });
    const target = sg?.price ?? targetFor(b.price, b.order);
    return {
      marketplace: mp.id, listing_key: b.id, buybox_order: b.order, buybox_price: b.price, second_price: b.second, third_price: b.third, multiple: b.multiple,
      our_price: ours, cost: e ? r2(e.cost) : null, commission: e?.comm ?? null,
      net_now: e && ours ? breakdown(ours, e.cost, { ...e.pcfg, returnRate: 0 }, e.comm).net : null,
      target_price: target, net_at_target: e && target ? breakdown(target, e.cost, { ...e.pcfg, returnRate: 0 }, e.comm).net : null,
      suggestion: sg?.kind ?? null, checked_at: now,
    };
  });
  let errors = 0;
  for (let i = 0; i < rows.length; i += 500) { const { error } = await db.from("listing_buybox").upsert(rows.slice(i, i + 500), { onConflict: "marketplace,listing_key" }); if (error) errors++; }
  return { live: live.length, checked: rows.length, asked: pick.length, lost: rows.filter((r) => (r.buybox_order ?? 1) > 1).length, lower: rows.filter((r) => r.suggestion === "lower").length, raise: rows.filter((r) => r.suggestion === "raise").length, reset: rows.filter((r) => r.suggestion === "reset").length, errors };
}
