// Vitrin verisi (yalnızca sunucu: service_role). Liste sorguları store_catalog'dan (saatlik), ürün detayı canlı tablolardan.
import { admin } from "@/lib/server";
import { PAGE_SIZE, likeEscape, slugify, type Sort } from "@/lib/store";

export type Card = { product_id: string; slug: string; title: string; price: number; image: string | null; top: string; sub: string | null; leaf: string | null };
const CARD = "product_id, slug, title, price, image, top, sub, leaf";

export type SubCat = { sub: string; slug: string; n: number; image: string | null };
export type TopCat = { top: string; slug: string; n: number; image: string | null; subs: SubCat[] };
export async function categories(): Promise<TopCat[]> {
  const { data, error } = await admin().from("store_category_counts").select("top, sub, n, image").limit(5000);
  if (error) throw new Error(`kategoriler okunamadı: ${error.message}`);
  const by = new Map<string, TopCat>();
  for (const r of data ?? []) {
    const t = by.get(r.top) ?? by.set(r.top, { top: r.top, slug: slugify(r.top), n: 0, image: null, subs: [] }).get(r.top)!;
    t.n += r.n;
    if (r.sub) t.subs.push({ sub: r.sub, slug: slugify(r.sub), n: r.n, image: r.image ?? null });
    else t.image ??= r.image ?? null;
  }
  for (const t of by.values()) { t.subs.sort((a, b) => b.n - a.n); t.image = t.subs.find((x) => x.image)?.image ?? t.image; }
  return [...by.values()].sort((a, b) => b.n - a.n);
}

export async function list(o: { top?: string; sub?: string; q?: string; min?: number; max?: number; sort: Sort; page: number; size?: number }) {
  const size = o.size ?? PAGE_SIZE;
  let qb = admin().from("store_catalog").select(CARD, { count: "exact" });
  if (o.top) qb = qb.eq("top", o.top);
  if (o.sub) qb = qb.eq("sub", o.sub);
  if (o.min != null) qb = qb.gte("price", o.min);
  if (o.max != null) qb = qb.lte("price", o.max);
  if (o.q) qb = qb.ilike("title", `%${likeEscape(o.q)}%`);
  qb = o.sort === "fiyat-artan" ? qb.order("price", { ascending: true }) : o.sort === "fiyat-azalan" ? qb.order("price", { ascending: false })
    : o.sort === "yeni" ? qb.order("created_at", { ascending: false }) : qb.order("stock", { ascending: false });
  const from = (o.page - 1) * size;
  const { data, error, count } = await qb.order("product_id").range(from, from + size - 1);
  if (error) throw new Error(`ürünler okunamadı: ${error.message}`);
  return { items: (data ?? []) as Card[], total: count ?? 0, pages: Math.max(1, Math.ceil((count ?? 0) / size)) };
}

export type Variant = { id: string; label: string; price: number; inStock: boolean };
export type Detail = Card & { description: string | null; images: string[]; variants: Variant[]; path: string | null; attrs: [string, string][] };
const HIDE_ATTR = /kategori|web color|barkod|stok|maliyet|tedarik|xml|desi|garanti süresi \(ay\)|^hb |^ty |trendyol|hepsiburada|amazon/i;
export async function product(slug: string): Promise<Detail | null> {
  const db = admin();
  const { data: c, error } = await db.from("store_catalog").select(`${CARD}, path`).eq("slug", slug).maybeSingle();
  if (error) throw new Error(`ürün okunamadı: ${error.message}`);
  if (!c) return null;
  const [p, imgs, vs, ls] = await Promise.all([
    db.from("products").select("description, attributes").eq("id", c.product_id).maybeSingle(),
    db.from("product_images").select("url, position").eq("product_id", c.product_id).order("position").limit(12),
    db.from("product_variants").select("id, attributes, stock").eq("product_id", c.product_id).order("id").limit(100),
    db.from("marketplace_listings").select("variant_id, price, stock").eq("marketplace", "trendyol").eq("status", "live").eq("product_id", c.product_id).limit(200),
  ]);
  for (const r of [p, imgs, vs, ls]) if (r.error) throw new Error(`ürün ayrıntısı okunamadı: ${r.error.message}`);
  const live = new Map((ls.data ?? []).map((l: any) => [l.variant_id, l]));
  const variants: Variant[] = [];
  for (const v of vs.data ?? []) {
    const l: any = live.get(v.id);
    if (!l) continue; // pazaryerinde satışta olmayan seçenek gösterilmez
    const a = (v.attributes ?? {}) as Record<string, unknown>;
    const label = ["Renk", "Beden", "Numara", "Ebat", "Boyut", "Seçenek"].map((k) => a[k]).filter((x) => x != null && String(x).trim()).join(" / ");
    variants.push({ id: v.id, label: label || "Standart", price: Number(l.price), inStock: Number(l.stock) > 0 });
  }
  const attrs = Object.entries((p.data?.attributes ?? {}) as Record<string, unknown>)
    .filter(([k, v]) => v != null && typeof v !== "object" && String(v).trim() && String(v).length <= 80 && !HIDE_ATTR.test(k))
    .map(([k, v]) => [k, String(v)] as [string, string]).slice(0, 20);
  return { ...(c as any), description: p.data?.description ?? null, images: (imgs.data ?? []).map((i: any) => i.url), variants: variants.length > 1 ? variants : [], attrs };
}

export async function similar(c: Card, n = 8): Promise<Card[]> {
  let qb = admin().from("store_catalog").select(CARD).neq("product_id", c.product_id);
  qb = c.leaf ? qb.eq("leaf", c.leaf) : c.sub ? qb.eq("sub", c.sub) : qb.eq("top", c.top);
  const { data } = await qb.order("stock", { ascending: false }).limit(n);
  return (data ?? []) as Card[];
}
