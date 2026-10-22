import { NextRequest, NextResponse } from "next/server";
import { safeFetch } from "@/worker/core/safe-fetch";
import { imgSigOk } from "@/worker/core/img-proxy";

export const runtime = "nodejs";
export const maxDuration = 60;

// Herkese açık görsel dönüştürücü: /api/img/<imza>/<base64url adres>.jpg -> JPG (beyaz zemin, en fazla 2000 px).
// Hepsiburada WebP kabul etmiyor. Adres imzalı (worker/core/img-proxy.ts); imzasız istek 404. CDN önbelleği uzun (görsel değişmez).
export async function GET(_req: NextRequest, ctx: { params: Promise<{ sig: string; file: string }> }) {
  const { sig, file } = await ctx.params;
  const m = /^([A-Za-z0-9_-]{4,4000})\.jpg$/.exec(file);
  if (!m || !/^[A-Za-z0-9_-]{22}$/.test(sig)) return new NextResponse("Bulunamadı", { status: 404 });
  const url = Buffer.from(m[1], "base64url").toString("utf8");
  if (!/^https?:\/\//i.test(url) || !imgSigOk(url, sig)) return new NextResponse("Bulunamadı", { status: 404 });
  try {
    const r = await safeFetch(url, { maxBytes: 15 * 1024 * 1024, timeoutMs: 20000, accept: /^image\// });
    if (!r.ok) return new NextResponse("Kaynak görsel alınamadı", { status: 502 });
    const sharp = (await import("sharp")).default;
    const out = await sharp(r.body).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    return new NextResponse(new Uint8Array(out), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable", "Content-Length": String(out.length) },
    });
  } catch (e: any) {
    console.error("görsel dönüştürülemedi:", String(e?.message ?? e).slice(0, 200));
    return new NextResponse("Görsel dönüştürülemedi", { status: 502 });
  }
}
