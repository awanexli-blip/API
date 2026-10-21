import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/products";
import { queueSend } from "@/lib/listings-send";

export const dynamic = "force-dynamic";

// "Pazaryerine gönder": { product_ids: [...], marketplace, now?: true } (mantık: lib/listings-send.ts)
export async function POST(req: NextRequest) {
  const a = await authorize(req, "editor");
  if (a instanceof NextResponse) return a;
  const r = await queueSend(a, await req.json().catch(() => ({})));
  return NextResponse.json(r.body, { status: r.status });
}
