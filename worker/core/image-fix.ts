// Görsel onarımı (23.10): Toptancım görselleri WebP; Trendyol'a doğrudan gidince ~800 üründe görsel görünmedi.
// Onaylı ilanda görsel yoksa ya da hâlâ tedarikçinin WebP adresiyse, ürün kaydındaki görseller 1200x1800 JPG dönüştürücüden
// yeniden gönderilir (content-bulk-update). Aynı ilan 3 günde bir kereden fazla denenmez (marketplace_listings.img_fix_at, migration 040).
import type { Listing, Marketplace } from "../marketplaces/types.ts";

const BROKEN = /\.webp(\?|$)|percdn\.com/i;
export const imagesBroken = (imgs: string[] | undefined) => Array.isArray(imgs) && (imgs.length === 0 || imgs.every((u) => BROKEN.test(u)));

export async function fixImages(db: any, mp: Marketplace, listings: Listing[], max = 1000) {
  if (!mp.updateImages) return { skipped: "pazaryerinde görsel güncelleme yok" };
  const live = listings.filter((l) => l.status === "active" && l.contentId);
  const withField = live.filter((l) => Array.isArray(l.images));
  const broken = withField.filter((l) => imagesBroken(l.images));
  const out: Record<string, unknown> = { checked: live.length, imagesField: withField.length, broken: broken.length, sent: 0, noDbImages: 0, recent: 0 };
  if (!broken.length) return out;
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const todo: { contentId: string; images: string[]; key: string }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < broken.length && todo.length < max; i += 300) {
    const part = broken.slice(i, i + 300);
    const { data } = await db.from("marketplace_listings").select("listing_key, img_fix_at, products(product_images(url, position))").eq("marketplace", mp.id).in("listing_key", part.map((l) => l.id));
    const byKey = new Map((data ?? []).map((r: any) => [r.listing_key, r]));
    for (const l of part) {
      const r: any = byKey.get(l.id);
      if (r?.img_fix_at && r.img_fix_at > since) { (out.recent as number)++; continue; }
      const imgs = [...(r?.products?.product_images ?? [])].sort((a: any, b: any) => a.position - b.position).map((x: any) => String(x.url)).filter(Boolean);
      if (!imgs.length) { (out.noDbImages as number)++; continue; }
      if (seen.has(l.contentId!)) continue; // aynı içerik (varyantlar) tek sefer
      seen.add(l.contentId!);
      todo.push({ contentId: l.contentId!, images: imgs, key: l.id });
      if (todo.length >= max) break;
    }
  }
  if (!todo.length) return out;
  const r = await mp.updateImages(todo);
  out.sent = r.ok; out.failed = r.failed; out.batchIds = r.batchIds;
  const now = new Date().toISOString();
  const keys = todo.map((t) => t.key);
  for (let i = 0; i < keys.length; i += 500) await db.from("marketplace_listings").update({ img_fix_at: now }).eq("marketplace", mp.id).in("listing_key", keys.slice(i, i + 500));
  return out;
}
