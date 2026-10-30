import { NextRequest, NextResponse } from "next/server";
import { admin, guard, unauthorized, bad } from "@/lib/server";
import { decideHold } from "@/lib/holds";

export const dynamic = "force-dynamic";

// Elle değişen / eklenen ilanlar (migration 074). GET: liste. POST { id, status: keep_all | keep_price | sync }: karar.
export async function GET(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const { data, error } = await admin().from("listing_holds").select("id, marketplace, listing_key, kind, status, title, mp_price, mp_qty, our_price, our_qty, sent_price, sent_qty, detected_at, decided_at, decided_by")
    .order("detected_at", { ascending: false }).limit(500);
  if (error) return /listing_holds/.test(error.message) ? NextResponse.json({ rows: [], missing: true }) : bad(error.message);
  return NextResponse.json({ rows: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const b = await req.json().catch(() => ({}));
  if (typeof b.id !== "string" || !["keep_all", "keep_price", "sync"].includes(b.status)) return bad("id ve geçerli karar gerekli");
  const r = await decideHold(b.id, b.status, "panel");
  return "error" in r ? bad(String(r.error)) : NextResponse.json(r);
}
