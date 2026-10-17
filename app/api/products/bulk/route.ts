import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/server";
import { authorize, dbError } from "@/lib/products";
import { STATUSES } from "@/lib/validation/product";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/i;

// Toplu işlem: { ids: [...], status?: active|draft|archived, brand?: string, category?: string }. Her ürün denetim kaydına yazılır.
export async function POST(req: NextRequest) {
  const a = await authorize(req, "editor");
  if (a instanceof NextResponse) return a;
  const b = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(b.ids) ? b.ids.filter((x: unknown) => typeof x === "string" && UUID.test(x)) : [];
  if (!ids.length || ids.length > 1000) return NextResponse.json({ error: "1-1000 ürün seç" }, { status: 400 });
  const patch: Record<string, string> = {};
  if (b.status != null) { if (!(STATUSES as readonly string[]).includes(b.status)) return NextResponse.json({ error: "Geçersiz durum" }, { status: 400 }); patch.status = b.status; }
  if (b.brand != null) { const v = String(b.brand).trim(); if (v.length > 100) return NextResponse.json({ error: "Marka en fazla 100 karakter" }, { status: 400 }); patch.brand = v; }
  if (b.category != null) { const v = String(b.category).trim(); if (v.length > 200) return NextResponse.json({ error: "Kategori en fazla 200 karakter" }, { status: 400 }); patch.category = v; }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Değiştirilecek alan yok" }, { status: 400 });
  const { data, error } = await admin().rpc("product_bulk_update", { ids, patch, actor: a.email });
  if (error) return dbError(error);
  return NextResponse.json({ ok: true, updated: data });
}
