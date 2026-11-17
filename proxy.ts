// ozsaraytr.com (vitrin) ve panel aynı Next uygulamasında (sunucu belleği dar: ayrı uygulama yok). Alan adına göre:
// - Vitrin alan adı: her yol /magaza altına yeniden yazılır ("/urun/x" -> "/magaza/urun/x"); panel ve /api bu alan adında erişilemez (404).
//   "/magaza/..." ile gelen istek kanonik köke yönlendirilir. www -> çıplak alan adı (Caddy de yapar).
// - Diğer alan adları (panel): dokunulmaz; /magaza önizleme olarak açıktır.
import { NextResponse, type NextRequest } from "next/server";
import { isStoreHost } from "@/lib/store";

export function proxy(req: NextRequest) {
  const host = req.headers.get("host");
  if (!isStoreHost(host)) return;
  const url = req.nextUrl.clone();
  const p = url.pathname;
  // Yönlendirme mutlak adresle: arka uçta istek adresi 127.0.0.1:3100 görünür (Caddy), Host başlığı gerçek alan adıdır
  if (p === "/magaza" || p.startsWith("/magaza/")) return NextResponse.redirect(new URL((p.slice(7) || "/") + url.search, `https://${String(host).split(":")[0].toLowerCase()}`), 308);
  url.pathname = p === "/" ? "/magaza" : `/magaza${p}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Statik dosyalar ve Next iç yolları hariç
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|brand/).*)"],
};
