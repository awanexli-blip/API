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

export async function syncBuybox(db: any, mp: Marketplace, listings: Listing[], econ: Map<string, Econ>, max = 2000) {
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
    const target = targetFor(b.price, b.order);
    return {
      marketplace: mp.id, listing_key: b.id, buybox_order: b.order, buybox_price: b.price, second_price: b.second, third_price: b.third, multiple: b.multiple,
      our_price: ours, cost: e ? r2(e.cost) : null, commission: e?.comm ?? null,
      net_now: e && ours ? breakdown(ours, e.cost, { ...e.pcfg, returnRate: 0 }, e.comm).net : null,
      target_price: target, net_at_target: e && target ? breakdown(target, e.cost, { ...e.pcfg, returnRate: 0 }, e.comm).net : null,
      checked_at: now,
    };
  });
  let errors = 0;
  for (let i = 0; i < rows.length; i += 500) { const { error } = await db.from("listing_buybox").upsert(rows.slice(i, i + 500), { onConflict: "marketplace,listing_key" }); if (error) errors++; }
  return { live: live.length, checked: rows.length, asked: pick.length, lost: rows.filter((r) => (r.buybox_order ?? 1) > 1).length, winnable: rows.filter((r) => (r.net_at_target ?? 0) > 0).length, errors };
}
