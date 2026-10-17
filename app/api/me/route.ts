import { NextRequest, NextResponse } from "next/server";
import { getActor, unauthorized } from "@/lib/server";

export const dynamic = "force-dynamic";

// Giriş yapan kullanıcının rolü (arayüz yetkisiz düğmeleri gizler; asıl kontrol API'lerde)
export async function GET(req: NextRequest) {
  const a = await getActor(req);
  if (!a) return unauthorized();
  return NextResponse.json(a);
}
