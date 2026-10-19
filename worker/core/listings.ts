// Pazaryeri ilanlarının anlık görüntüsü -> marketplace_listings (Faz 3). Her senkronda çağrılır.
// Durum yalnızca pazaryerinden okunanla yazılır: "live" = pazaryeri onaylı ve açık (ürün doğrulanmadan yayında sayılmaz).
import type { Listing } from "../marketplaces/types.ts";
import { chunk } from "./util.ts";

const STATUS: Record<string, string> = { active: "live", closed: "closed", pending: "pending_approval" };

// Senkronun hesabı (yalnızca XML ile eşleşen ilanlar): maliyet, gönderilen fiyat, o fiyatta tek adet net kâr
export type ListingCalc = { cost: number | null; price: number | null; net: number | null; note: string; xmlStock?: number | null; sentStock?: number | null };

export function listingRows(marketplace: string, listings: Listing[], now: string, calc?: Map<string, ListingCalc>) {
  return listings.map((l) => ({
    marketplace, listing_key: l.id, status: l.reject ? "rejected" : STATUS[l.status ?? "active"] ?? "live",
    last_error: l.reject ? l.reject.details.join(" | ").slice(0, 1000) || l.reject.types.join(", ") : null,
    title: l.title?.slice(0, 300) || null,
    price: Number.isFinite(l.price) ? l.price : null,
    stock: Number.isFinite(l.quantity) ? Math.max(0, Math.floor(l.quantity)) : null,
    commission: l.commission ?? null, category_id: l.categoryId ?? null, category_name: l.categoryName || null,
    seen_at: now, updated_at: now,
    ...(calc ? (() => { const c = calc.get(l.id); return { xml_cost: c?.cost ?? null, calc_price: c?.price ?? null, calc_net: c?.net ?? null, calc_note: c ? c.note.slice(0, 300) : "XML ile eşleşmedi: fiyat/stok sistem tarafından yönetilmiyor", xml_stock: c?.xmlStock ?? null, sent_stock: c?.sentStock ?? null }; })() : {}),
  }));
}

// Yaz, bağla, kaybolanları işaretle. Hata senkronu durdurmaz (tablo yoksa / ağ hatası): özete not düşülür.
export async function snapshotListings(db: any, marketplace: string, listings: Listing[], calc?: Map<string, ListingCalc>): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();
  const rows = listingRows(marketplace, listings, now, calc);
  let written = 0;
  for (const part of chunk(rows, 1000)) {
    const { error } = await db.from("marketplace_listings").upsert(part, { onConflict: "marketplace,listing_key" });
    if (error) return { error: error.message, written };
    written += part.length;
  }
  // Bu çalışmada görülmeyen ilanlar pazaryerinden kalkmış (yalnızca liste tam geldiyse)
  let gone = 0;
  if (rows.length > 0) {
    const r = await db.from("marketplace_listings").update({ status: "gone", updated_at: now }).eq("marketplace", marketplace).lt("seen_at", now).in("status", ["live", "pending_approval", "closed", "rejected"]).select("listing_key");
    gone = r.data?.length ?? 0;
  }
  const link = await db.rpc("listings_link", { mp: marketplace });
  return { written, gone, linked: typeof link.data === "number" ? link.data : 0 };
}
