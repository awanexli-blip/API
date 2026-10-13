import { NextRequest, NextResponse } from "next/server";
import { admin, guard, unauthorized, bad } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const db = admin();
  const [m, u] = await Promise.all([
    db.from("category_map").select("*").order("xml_category"),
    db.from("unmapped_categories").select("*").order("product_count", { ascending: false }),
  ]);
  if (m.error) return bad(m.error.message);
  return NextResponse.json({ mapped: m.data, unmapped: u.data ?? [] });
}

export async function PUT(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const b = await req.json();
  const xml_category = String(b.xml_category ?? "").trim();
  const category_id = Number(b.category_id);
  if (!xml_category || !Number.isInteger(category_id) || category_id <= 0) return bad("Kategori adı ve geçerli Trendyol kategori ID gerekli");

  const opt = (v: unknown) => (v === "" || v == null ? null : Number(v));
  const commission_rate = opt(b.commission_rate);
  const vat_rate = opt(b.vat_rate);
  if (commission_rate != null && !(commission_rate >= 0 && commission_rate < 0.6)) return bad("Komisyon 0 ile 0,6 arasında olmalı (örn. 0,15)");
  if (vat_rate != null && !(vat_rate >= 0 && vat_rate <= 100)) return bad("Geçersiz KDV");

  let attributes: unknown = [];
  if (b.attributes) {
    try { attributes = typeof b.attributes === "string" ? JSON.parse(b.attributes) : b.attributes; }
    catch { return bad("Özellikler (attributes) geçerli JSON olmalı"); }
    if (!Array.isArray(attributes)) return bad("Özellikler bir liste olmalı");
  }

  const db = admin();
  const { error } = await db.from("category_map").upsert({ xml_category, category_id, commission_rate, vat_rate, attributes });
  if (error) return bad(error.message);
  await db.from("unmapped_categories").delete().eq("xml_category", xml_category);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const xml_category = req.nextUrl.searchParams.get("xml_category");
  if (!xml_category) return bad("xml_category gerekli");
  const { error } = await admin().from("category_map").delete().eq("xml_category", xml_category);
  if (error) return bad(error.message);
  return NextResponse.json({ ok: true });
}
