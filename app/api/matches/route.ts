import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/server";
import { authorize, dbError } from "@/lib/products";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/i;

// Katalog eşleşmeleri (Amazon ASIN): GET ?product=<id>
export async function GET(req: NextRequest) {
  const a = await authorize(req, "viewer");
  if (a instanceof NextResponse) return a;
  const pid = req.nextUrl.searchParams.get("product") ?? "";
  if (!UUID.test(pid)) return NextResponse.json({ error: "Geçersiz ürün" }, { status: 400 });
  const { data, error } = await admin().from("marketplace_matches").select("id, marketplace, variant_id, external_id, title, brand, image, matched_by, status, decided_by, updated_at").eq("product_id", pid).order("status").order("id");
  if (error) return NextResponse.json([]); // tablo yoksa (migration 014 öncesi)
  return NextResponse.json(data);
}

// Onay / ret: { id, status: "confirmed" | "rejected" } — bir varyant için onay, diğer adayları reddeder.
// Elle ASIN: { variant_id, product_id, marketplace, external_id, status: "confirmed" }
export async function PUT(req: NextRequest) {
  const a = await authorize(req, "editor");
  if (a instanceof NextResponse) return a;
  const b = await req.json().catch(() => ({}));
  if (!["confirmed", "rejected"].includes(b.status)) return NextResponse.json({ error: "Geçersiz durum" }, { status: 400 });
  const db = admin();
  const now = new Date().toISOString();
  let row: any;
  if (b.id) {
    const { data, error } = await db.from("marketplace_matches").update({ status: b.status, decided_by: a.email, updated_at: now }).eq("id", Number(b.id)).select("*").single();
    if (error) return dbError(error);
    row = data;
  } else {
    const asin = String(b.external_id ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) return NextResponse.json({ error: "ASIN 10 karakter olmalı (ör. B0ABC12345)" }, { status: 400 });
    if (!UUID.test(String(b.variant_id)) || !UUID.test(String(b.product_id))) return NextResponse.json({ error: "Geçersiz ürün" }, { status: 400 });
    const { data, error } = await db.from("marketplace_matches").upsert({ marketplace: b.marketplace ?? "amazon", variant_id: b.variant_id, product_id: b.product_id, external_id: asin, matched_by: "manual", status: "confirmed", decided_by: a.email, updated_at: now }, { onConflict: "marketplace,variant_id,external_id" }).select("*").single();
    if (error) return dbError(error);
    row = data;
  }
  if (b.status === "confirmed" && row) {
    await db.from("marketplace_matches").update({ status: "rejected", decided_by: a.email, updated_at: now }).eq("marketplace", row.marketplace).eq("variant_id", row.variant_id).neq("id", row.id).neq("status", "rejected");
  }
  return NextResponse.json({ ok: true });
}
