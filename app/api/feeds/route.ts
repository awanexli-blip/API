import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { admin } from "@/lib/server";
import { authorize, dbError } from "@/lib/products";

export const dynamic = "force-dynamic";

const MODES = ["none", "cost", "formula"];
const SOURCES = [null, "manual", "csv", "xml:bayilik"];
const token = () => randomBytes(24).toString("hex");

// Feed listesi (admin): adres = <site>/api/feed/<token>
export async function GET(req: NextRequest) {
  const a = await authorize(req, "admin");
  if (a instanceof NextResponse) return a;
  const { data, error } = await admin().from("feeds").select("*").order("created_at", { ascending: false });
  if (error) return dbError(error);
  return NextResponse.json(data);
}

// Oluştur: { name, price_mode, only_in_stock, source_filter }
export async function POST(req: NextRequest) {
  const a = await authorize(req, "admin");
  if (a instanceof NextResponse) return a;
  const b = await req.json().catch(() => ({}));
  const name = String(b.name ?? "").trim().slice(0, 80);
  if (!name) return NextResponse.json({ error: "Feed adı gerekli" }, { status: 400 });
  if (!MODES.includes(b.price_mode ?? "none")) return NextResponse.json({ error: "Geçersiz fiyat modu" }, { status: 400 });
  const source_filter = b.source_filter || null;
  if (!SOURCES.includes(source_filter)) return NextResponse.json({ error: "Geçersiz kaynak" }, { status: 400 });
  const { data, error } = await admin().from("feeds").insert({ name, price_mode: b.price_mode ?? "none", only_in_stock: !!b.only_in_stock, source_filter, token: token(), created_by: a.email }).select("*").single();
  if (error) return dbError(error);
  return NextResponse.json(data, { status: 201 });
}

// { id, rotate: true } -> yeni adres (eski adres çalışmaz)
export async function PUT(req: NextRequest) {
  const a = await authorize(req, "admin");
  if (a instanceof NextResponse) return a;
  const b = await req.json().catch(() => ({}));
  if (!b.id) return NextResponse.json({ error: "id gerekli" }, { status: 400 });
  const patch: any = {};
  if (b.rotate) patch.token = token();
  if (b.price_mode && MODES.includes(b.price_mode)) patch.price_mode = b.price_mode;
  if ("only_in_stock" in b) patch.only_in_stock = !!b.only_in_stock;
  const { data, error } = await admin().from("feeds").update(patch).eq("id", b.id).select("*").single();
  if (error) return dbError(error);
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const a = await authorize(req, "admin");
  if (a instanceof NextResponse) return a;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id gerekli" }, { status: 400 });
  const { error } = await admin().from("feeds").delete().eq("id", id);
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}
