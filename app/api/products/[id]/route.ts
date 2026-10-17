import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/server";
import { authorize, dbError } from "@/lib/products";
import { issuesByPath, productSchema } from "@/lib/validation/product";

export const dynamic = "force-dynamic";
// Next 16: rota parametreleri Promise
type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f-]{36}$/i;

// Tek ürün (?audit=1 ile son değişiklik geçmişi)
export async function GET(req: NextRequest, ctx: Ctx) {
  const params = await ctx.params;
  const a = await authorize(req, "viewer");
  if (a instanceof NextResponse) return a;
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Geçersiz ürün" }, { status: 400 });
  const db = admin();
  if (req.nextUrl.searchParams.get("listings")) {
    const { data, error } = await db.from("marketplace_listings").select("marketplace, listing_key, variant_id, status, price, stock, commission, category_name, last_error, seen_at").eq("product_id", params.id).order("marketplace");
    if (error) return NextResponse.json([]); // tablo yoksa (migration 013 öncesi) boş
    return NextResponse.json(data);
  }
  if (req.nextUrl.searchParams.get("audit")) {
    const { data, error } = await db.from("audit_log").select("id, at, actor, action").eq("entity", "product").eq("entity_id", params.id).order("at", { ascending: false }).limit(30);
    if (error) return dbError(error);
    return NextResponse.json(data);
  }
  const { data, error } = await db.rpc("product_snapshot", { pid: params.id });
  if (error) return dbError(error);
  if (!data) return NextResponse.json({ error: "Ürün bulunamadı" }, { status: 404 });
  return NextResponse.json(data);
}

// Güncelle (tam kayıt: listede olmayan varyant ve görseller silinir)
export async function PUT(req: NextRequest, ctx: Ctx) {
  const params = await ctx.params;
  const a = await authorize(req, "editor");
  if (a instanceof NextResponse) return a;
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Geçersiz ürün" }, { status: 400 });
  const body = await req.json().catch(() => null);
  const parsed = productSchema.safeParse({ ...body, id: params.id });
  if (!parsed.success) return NextResponse.json({ error: "Doğrulama hatası", fields: issuesByPath(parsed.error) }, { status: 422 });
  const db = admin();
  const { error } = await db.rpc("product_save", { payload: parsed.data, actor: a.email });
  if (error) return dbError(error);
  const { data } = await db.rpc("product_snapshot", { pid: params.id });
  return NextResponse.json(data);
}

// Silme açık bir işlem: varsayılan arşivle (editor). Kalıcı silme: ?hard=1&confirm=<SKU> (admin).
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const params = await ctx.params;
  const hard = req.nextUrl.searchParams.get("hard") === "1";
  const a = await authorize(req, hard ? "admin" : "editor");
  if (a instanceof NextResponse) return a;
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Geçersiz ürün" }, { status: 400 });
  const db = admin();
  if (hard) {
    const { data: p } = await db.from("products").select("sku").eq("id", params.id).maybeSingle();
    if (!p) return NextResponse.json({ error: "Ürün bulunamadı" }, { status: 404 });
    if (req.nextUrl.searchParams.get("confirm") !== p.sku) return NextResponse.json({ error: "Kalıcı silme için ürünün SKU'sunu onay olarak yaz" }, { status: 400 });
  }
  const { error } = await db.rpc("product_delete", { pid: params.id, hard, actor: a.email });
  if (error) return dbError(error);
  return NextResponse.json({ ok: true, action: hard ? "deleted" : "archived" });
}
