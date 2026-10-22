import { NextRequest, NextResponse } from "next/server";
import { safeFetch } from "@/worker/core/safe-fetch";
import { imgSigOk } from "@/worker/core/img-proxy";

export const runtime = "nodejs";
export const maxDuration = 60;

// Herkese açık görsel dönüştürücü: /api/img/<imza>/<base64url adres>.jpg -> 1200x1200 kare JPG (beyaz zemin, küçük görsel büyütülür).
// Pazaryerleri en az 600-1000 px ve kare görsel istiyor; tedarikçide 500x500 ve 1200x1800 görseller var.
// Hepsiburada WebP kabul etmiyor. Adres imzalı (worker/core/img-proxy.ts); imzasız istek 404. CDN önbelleği uzun (görsel değişmez).
export async function GET(_req: NextRequest, ctx: { params: Promise<{ sig: string; file: string }> }) {
  const { sig, file } = await ctx.params;
  const m = /^([A-Za-z0-9_-]{4,4000})\.jpg$/.exec(file);
  if (!m || !/^[A-Za-z0-9_-]{22}$/.test(sig)) return new NextResponse("Bulunamadı", { status: 404 });
  const url = Buffer.from(m[1], "base64url").toString("utf8");
  if (!/^https?:\/\//i.test(url) || !imgSigOk(url, sig)) return new NextResponse("Bulunamadı", { status: 404 });
  try {
    // Tedarikçi CDN'i yoğunlukta anlık hata verebilir: 3 deneme, artan bekleme
    let r: Awaited<ReturnType<typeof safeFetch>> | null = null;
    for (let i = 0; i < 3; i++) {
      try { r = await safeFetch(url, { maxBytes: 15 * 1024 * 1024, timeoutMs: 15000, accept: /^image\// }); if (r.ok) break; } catch { r = null; }
      await new Promise((ok) => setTimeout(ok, 700 * (i + 1)));
    }
    if (!r?.ok) return new NextResponse("Kaynak görsel alınamadı", { status: 503, headers: { "Cache-Control": "no-store" } });
    const sharp = (await import("sharp")).default;
    const out = await sharp(r.body).rotate().flatten({ background: "#ffffff" })
      .resize({ width: 1200, height: 1200, fit: "contain", background: "#ffffff" }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    return new NextResponse(new Uint8Array(out), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable", "Content-Length": String(out.length) },
    });
  } catch (e: any) {
    console.error("görsel dönüştürülemedi:", String(e?.message ?? e).slice(0, 200));
    return new NextResponse("Görsel dönüştürülemedi", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
