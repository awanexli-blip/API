import { NextRequest, NextResponse } from "next/server";
import { guard, unauthorized, bad, MARKETPLACES } from "@/lib/server";
import { dispatchWorkflow } from "@/lib/github";

export const dynamic = "force-dynamic";

const MODES = ["preview", "update", "create", "auto"];

// Senkronu başlatır: sunucu ana sistemken sunucu iş kuyruğu, Vercel yedeğinde GitHub Actions (lib/github.ts)
export async function POST(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const { mode, marketplace = "trendyol" } = (await req.json().catch(() => ({}))) ?? {};
  if (!MODES.includes(mode)) return bad("Geçersiz mod");
  if (!MARKETPLACES.includes(marketplace)) return bad("Geçersiz pazaryeri");
  // part=all: GitHub'da (yedek) elle çalıştırma tam senkron; sunucuda kapsam birimlere göre (ilan + sipariş)
  const r = await dispatchWorkflow("sync.yml", { mode, marketplace, part: "all" });
  return r.ok ? NextResponse.json({ ok: true }) : bad(r.error ?? "Başlatılamadı");
}
