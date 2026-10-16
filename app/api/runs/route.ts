import { NextRequest, NextResponse } from "next/server";
import { admin, guard, unauthorized, bad, mpOf } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const mp = mpOf(req);
  if (!mp) return bad("Geçersiz pazaryeri");
  const db = admin();
  // Migration 002 sonrası kolonla, öncesi özet içindeki pazaryeri alanıyla filtrelenir
  let r = await db.from("sync_runs").select("*").eq("marketplace", mp).order("id", { ascending: false }).limit(20);
  if (r.error) r = await db.from("sync_runs").select("*").order("id", { ascending: false }).limit(40);
  if (r.error) return bad(r.error.message);
  const rows = (r.data ?? []).filter((x: any) => (x.marketplace ?? x.summary?.marketplace ?? "trendyol") === mp).slice(0, 20);
  return NextResponse.json(rows);
}
