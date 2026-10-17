import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/server";
import { authorize, dbError } from "@/lib/products";

export const dynamic = "force-dynamic";

const DEFAULT_BRAND = "Eco Lounge"; // mağazadaki ürünlerin çoğu bu markayla açık

// Ürün formu seçenekleri: markalar ve kategoriler (Kategoriler sekmesindeki eşleşmeler + ürünlerde kullanılanlar)
export async function GET(req: NextRequest) {
  const a = await authorize(req, "viewer");
  if (a instanceof NextResponse) return a;
  const db = admin();
  const [cm, pr] = await Promise.all([
    db.from("category_map").select("xml_category, marketplace, category_name").limit(5000),
    db.from("products").select("brand, category").limit(10000),
  ]);
  if (cm.error) return dbError(cm.error);
  if (pr.error) return dbError(pr.error);

  const cats = new Map<string, { markets: Set<string>; names: Record<string, string> }>();
  const add = (n: string) => { if (!cats.has(n)) cats.set(n, { markets: new Set(), names: {} }); return cats.get(n)!; };
  for (const c of cm.data ?? []) { const e = add(c.xml_category); e.markets.add(c.marketplace ?? "trendyol"); if (c.category_name) e.names[c.marketplace ?? "trendyol"] = c.category_name; }
  for (const p of pr.data ?? []) if (p.category) add(p.category);

  const brands = new Map<string, number>([[DEFAULT_BRAND, 1]]);
  for (const p of pr.data ?? []) if (p.brand) brands.set(p.brand, (brands.get(p.brand) ?? 0) + 1);

  return NextResponse.json({
    brands: [...brands].sort((x, y) => y[1] - x[1]).map(([b]) => b),
    defaultBrand: DEFAULT_BRAND,
    categories: [...cats].sort((x, y) => x[0].localeCompare(y[0], "tr")).map(([name, e]) => ({ name, markets: [...e.markets], names: e.names })),
  });
}
