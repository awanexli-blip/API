import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/server";
import { authorize, dbError } from "@/lib/products";
import { issuesByPath, productSchema, STATUSES } from "@/lib/validation/product";

export const dynamic = "force-dynamic";

// Sıralama: ?sort=new|cost_desc|cost_asc|title (vitrin)
const SORTS: Record<string, [string, boolean]> = { new: ["updated_at", false], cost_desc: ["cost_price", false], cost_asc: ["cost_price", true], title: ["title", true] };

// Liste: ?q= (başlık / SKU) &status= &source= &stock=in|out &category= &page= &size=
export async function GET(req: NextRequest) {
  const a = await authorize(req, "viewer");
  if (a instanceof NextResponse) return a;
  const sp = req.nextUrl.searchParams;
  const size = Math.min(100, Math.max(1, Number(sp.get("size") ?? 25)));
  const page = Math.max(0, Number(sp.get("page") ?? 0));
  const status = sp.get("status");
  const q = (sp.get("q") ?? "").trim().replace(/[%,()*]/g, " ").slice(0, 100);
  const source = (sp.get("source") ?? "").slice(0, 60);
  const stock = sp.get("stock");
  const sort = sp.get("sort") ?? "";
  const category = (sp.get("category") ?? "").trim().replace(/[%,()*]/g, " ").slice(0, 100);

  let query = admin()
    .from("products")
    .select(`id, sku, title, brand, category, status, cost_price, currency, vat_rate, updated_at, source, product_variants${stock ? "!inner" : ""}(stock, reserved), product_images(url, position), marketplace_listings(marketplace, status, price, calc_price, calc_net, commission)`, { count: q || category || stock || source || status ? "exact" : "estimated" }) // filtresiz tam sayım 43 bin ürün: tahmini yeter
    .order(SORTS[sort]?.[0] ?? "updated_at", { ascending: SORTS[sort]?.[1] ?? false, nullsFirst: false })
    .range(page * size, page * size + size - 1);
  if (status && (STATUSES as readonly string[]).includes(status)) query = query.eq("status", status);
  if (q) query = query.or(`title.ilike.%${q}%,sku.ilike.%${q}%`);
  if (source) query = query.eq("source", source);
  if (category) query = query.ilike("category", `%${category}%`);
  // Stok filtresi varyant üzerinden (tek varyantlı ürünlerde tam, çok varyantlıda "en az bir varyant")
  if (stock === "in") query = query.gt("product_variants.stock", 0);
  if (stock === "out") query = query.eq("product_variants.stock", 0);

  const { data, count, error } = await query;
  if (error) return dbError(error);
  const rows = (data ?? []).map((p: any) => ({
    id: p.id, sku: p.sku, title: p.title, brand: p.brand, category: p.category, status: p.status,
    cost_price: p.cost_price, currency: p.currency, vat_rate: p.vat_rate, updated_at: p.updated_at, source: p.source,
    variants: p.product_variants.length,
    stock: p.product_variants.reduce((t: number, v: any) => t + v.stock - v.reserved, 0),
    image: [...p.product_images].sort((x: any, y: any) => x.position - y.position)[0]?.url ?? null,
    images: p.product_images.length,
    // Pazaryeri ilanları (pazaryeri başına en "ileri" durum): vitrinde satış fiyatı ve rozet
    listings: Object.values((p.marketplace_listings ?? []).reduce((m: any, l: any) => {
      const rank = (x: string) => ["live", "pending_approval", "sent", "queued", "error", "rejected", "archived"].indexOf(x) >>> 0;
      if (!m[l.marketplace] || rank(l.status) < rank(m[l.marketplace].status)) m[l.marketplace] = { mp: l.marketplace, status: l.status, price: l.price ?? l.calc_price ?? null, net: l.calc_net ?? null, commission: l.commission ?? null };
      return m;
    }, {})),
  }));
  return NextResponse.json({ rows, total: count ?? 0, page, size });
}

// Oluştur
export async function POST(req: NextRequest) {
  const a = await authorize(req, "editor");
  if (a instanceof NextResponse) return a;
  const body = await req.json().catch(() => null);
  const parsed = productSchema.safeParse({ ...body, id: undefined });
  if (!parsed.success) return NextResponse.json({ error: "Doğrulama hatası", fields: issuesByPath(parsed.error) }, { status: 422 });
  const db = admin();
  const { data: id, error } = await db.rpc("product_save", { payload: parsed.data, actor: a.email });
  if (error) return dbError(error);
  const { data } = await db.rpc("product_snapshot", { pid: id });
  return NextResponse.json(data, { status: 201 });
}
