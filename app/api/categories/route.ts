import { NextRequest, NextResponse } from "next/server";
import { admin, guard, unauthorized, bad, mpOf, mpSelect } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const mp = mpOf(req);
  if (!mp) return bad("Geçersiz pazaryeri");
  const [m, u] = await Promise.all([mpSelect("category_map", mp, "xml_category"), mpSelect("unmapped_categories", mp, "product_count", false)]);
  if (m.error) return bad(m.error);
  return NextResponse.json({ mapped: m.data, unmapped: u.data ?? [] });
}

export async function PUT(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const mp = mpOf(req);
  if (!mp) return bad("Geçersiz pazaryeri");
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return bad("Geçersiz istek gövdesi");
  // Tek kayıt veya { items: [...] } ile toplu onay
  const list: any[] = Array.isArray(b?.items) ? b.items : [b];
  if (!list.length || list.length > 1000) return bad("Kayıt listesi boş veya çok uzun");

  // Toplu onayda geçersiz satır (örn. adı boş XML kategorisi) atlanır, diğerleri kaydedilir
  const rows: any[] = [];
  let skipped = 0;
  for (const it of list) {
    const r = parseRow(it);
    if (typeof r !== "string") rows.push(r);
    else if (list.length === 1) return bad(r);
    else skipped++;
  }
  if (!rows.length) return bad("Kaydedilecek geçerli kayıt yok");

  const db = admin();
  let { error } = await db.from("category_map").upsert(rows.map((r) => ({ ...r, marketplace: mp })));
  if (error && /category_name/.test(error.message)) // migration 004 öncesi
    ({ error } = await db.from("category_map").upsert(rows.map(({ category_name, ...r }) => ({ ...r, marketplace: mp }))));
  if (error && mp === "trendyol") ({ error } = await db.from("category_map").upsert(rows.map(({ category_name, ...r }) => r))); // migration 002 öncesi
  if (error) return bad(error.message);
  const names = rows.map((r) => r.xml_category);
  const del = await db.from("unmapped_categories").delete().in("xml_category", names).eq("marketplace", mp);
  if (del.error && mp === "trendyol") await db.from("unmapped_categories").delete().in("xml_category", names);
  return NextResponse.json({ ok: true, saved: rows.length, skipped });
}

function parseRow(b: any) {
  const xml_category = String(b?.xml_category ?? "").trim();
  const category_id = Number(b?.category_id);
  if (!xml_category || !Number.isInteger(category_id) || category_id <= 0) return "Kategori adı ve geçerli kategori ID gerekli";

  const opt = (v: unknown) => (v === "" || v == null ? null : Number(v));
  const commission_rate = opt(b.commission_rate);
  const vat_rate = opt(b.vat_rate);
  if (commission_rate != null && !(commission_rate >= 0 && commission_rate < 0.6)) return "Komisyon 0 ile 0,6 arasında olmalı (örn. 0,15)";
  if (vat_rate != null && !(vat_rate >= 0 && vat_rate <= 100)) return "Geçersiz KDV";

  let attributes: unknown = [];
  if (b.attributes) {
    try { attributes = typeof b.attributes === "string" ? JSON.parse(b.attributes) : b.attributes; }
    catch { return "Özellikler (attributes) geçerli JSON olmalı"; }
    if (!Array.isArray(attributes)) return "Özellikler bir liste olmalı";
  }
  const category_name = b.category_name ? String(b.category_name).slice(0, 200) : null;
  return { xml_category, category_id, category_name, commission_rate, vat_rate, attributes };
}

export async function DELETE(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const mp = mpOf(req);
  const xml_category = req.nextUrl.searchParams.get("xml_category");
  if (!xml_category || !mp) return bad("xml_category gerekli");
  let { error } = await admin().from("category_map").delete().eq("xml_category", xml_category).eq("marketplace", mp);
  if (error && mp === "trendyol") ({ error } = await admin().from("category_map").delete().eq("xml_category", xml_category));
  if (error) return bad(error.message);
  return NextResponse.json({ ok: true });
}
