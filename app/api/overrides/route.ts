import { NextRequest, NextResponse } from "next/server";
import { admin, guard, unauthorized, bad } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const { data, error } = await admin().from("product_overrides").select("*").order("barcode");
  if (error) return bad(error.message);
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const b = await req.json();
  const barcode = String(b.barcode ?? "").trim();
  if (!barcode) return bad("Barkod gerekli");
  const price = b.price_override === "" || b.price_override == null ? null : Number(b.price_override);
  if (price != null && !(price > 0)) return bad("Fiyat 0'dan büyük olmalı");
  const hidden = !!b.hidden;
  if (price == null && !hidden) return bad("Özel fiyat yaz veya ürünü gizle");
  const { error } = await admin().from("product_overrides").upsert({ barcode, price_override: price, hidden, note: b.note ? String(b.note).slice(0, 200) : null });
  if (error) return bad(error.message);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const barcode = req.nextUrl.searchParams.get("barcode");
  if (!barcode) return bad("barcode gerekli");
  const { error } = await admin().from("product_overrides").delete().eq("barcode", barcode);
  if (error) return bad(error.message);
  return NextResponse.json({ ok: true });
}
