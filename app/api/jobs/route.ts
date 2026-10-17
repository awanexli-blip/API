import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/server";
import { authorize, dbError } from "@/lib/products";

export const dynamic = "force-dynamic";

// İş kuyruğu (yönetici): son işler ve durum sayıları
export async function GET(req: NextRequest) {
  const a = await authorize(req, "admin");
  if (a instanceof NextResponse) return a;
  const db = admin();
  const { data, error } = await db.from("jobs").select("id, type, marketplace, status, attempts, max_attempts, run_after, last_error, result, created_by, created_at, updated_at").order("id", { ascending: false }).limit(50);
  if (error) return dbError(error);
  return NextResponse.json(data);
}

// { id, action: "retry" | "cancel" }: başarısız işi yeniden kuyruğa al / bekleyen işi iptal et
export async function PUT(req: NextRequest) {
  const a = await authorize(req, "admin");
  if (a instanceof NextResponse) return a;
  const b = await req.json().catch(() => ({}));
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Geçersiz iş" }, { status: 400 });
  const db = admin();
  const q = b.action === "retry"
    ? db.from("jobs").update({ status: "queued", attempts: 0, run_after: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("id", id).in("status", ["failed", "cancelled"])
    : b.action === "cancel"
      ? db.from("jobs").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", id).eq("status", "queued")
      : null;
  if (!q) return NextResponse.json({ error: "Geçersiz işlem" }, { status: 400 });
  const { data, error } = await q.select("id");
  if (error) return dbError(error);
  if (!data?.length) return NextResponse.json({ error: "İş bu durumda değiştirilemez" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
