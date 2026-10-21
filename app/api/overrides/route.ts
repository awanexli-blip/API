import { NextRequest, NextResponse } from "next/server";
import { admin, guard, unauthorized, bad, mpOf, mpSelect } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const mp = mpOf(req);
  if (!mp) return bad("Geçersiz pazaryeri");
  const r = await mpSelect("product_overrides", mp, "barcode");
  if (r.error) return bad(r.error);
  return NextResponse.json(r.data);
}

export async function PUT(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const mp = mpOf(req);
  if (!mp) return bad("Geçersiz pazaryeri");
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return bad("Geçersiz istek gövdesi");
  const barcode = String(b.barcode ?? "").trim();
  if (!barcode) return bad("Barkod gerekli");
  const price = b.price_override === "" || b.price_override == null ? null : Number(b.price_override);
  if (price != null && !(price > 0)) return bad("Fiyat 0'dan büyük olmalı");
  const hidden = !!b.hidden;
  if (price == null && !hidden) return bad("Özel fiyat yaz veya ürünü gizle");
  const row = { barcode, price_override: price, hidden, note: b.note ? String(b.note).slice(0, 200) : null };
  let { error } = await admin().from("product_overrides").upsert({ ...row, marketplace: mp });
  if (error && mp === "trendyol") ({ error } = await admin().from("product_overrides").upsert(row)); // migration 002 öncesi
  if (error) return bad(error.message);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const mp = mpOf(req);
  const barcode = req.nextUrl.searchParams.get("barcode");
  if (!barcode || !mp) return bad("barcode gerekli");
  let { error } = await admin().from("product_overrides").delete().eq("barcode", barcode).eq("marketplace", mp);
  if (error && mp === "trendyol") ({ error } = await admin().from("product_overrides").delete().eq("barcode", barcode));
  if (error) return bad(error.message);
  return NextResponse.json({ ok: true });
}
