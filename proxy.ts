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
  if (p === "/magaza" || p.startsWith("/magaza/")) { url.pathname = p.slice(7) || "/"; return NextResponse.redirect(url, 308); }
  url.pathname = p === "/" ? "/magaza" : `/magaza${p}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Statik dosyalar ve Next iç yolları hariç
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
