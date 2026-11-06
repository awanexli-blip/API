// Görsel JPG dönüştürücü adresi (varsayılan wsrv.nl; IMAGE_CDN=self: panel app/api/img/[sig]/[file]). Hepsiburada WebP kabul etmiyor; tedarikçi CDN'i yalnızca WebP veriyor.
// Adres imzalıdır (HMAC, anahtar IMAGE_PROXY_SECRET ya da service_role): uç herkese açık ama yalnızca bizim ürettiğimiz adresleri çevirir.
import { createHmac, timingSafeEqual } from "node:crypto";

const keyOf = () => process.env.IMAGE_PROXY_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
export const PANEL_URL = (process.env.PANEL_URL || "https://trentakip.vercel.app").replace(/\/+$/, "");

// Biçim: "" = 1200x1200 kare (Hepsiburada), "p" = 1200x1800 dikey (Trendyol kuralı). İmza biçimi de kapsar.
export type ImgShape = "" | "p";
export const imgSig = (url: string, key = keyOf(), shape: ImgShape = "") => createHmac("sha256", key).update("img2:" + (shape ? shape + ":" : "") + url).digest("base64url").slice(0, 22);
export function imgSigOk(url: string, sig: string, key = keyOf(), shape: ImgShape = "") {
  if (!key) return false;
  const a = Buffer.from(imgSig(url, key, shape)), b = Buffer.from(String(sig));
  return a.length === b.length && timingSafeEqual(a, b);
}

// JPG/PNG adresi olduğu gibi kalır; diğerleri (webp, avif, uzantısız) dönüştürücüden geçer.
// Varsayılan dönüştürücü wsrv.nl (ücretsiz, ticari kullanım serbest, önbellekli; 23.10 denendi: percdn WebP -> 1200x1800 JPEG).
// Vercel'deki kendi dönüştürücümüz ücretsiz işlemci kotasını bitiriyordu (3s50dk/4s); IMAGE_CDN=self ile geri alınır.
// wsrv.nl sınırı: aynı IP'den önbellekte olmayan en fazla 2.500 görsel / 10 dk.
export function jpgUrl(url: string, key = keyOf(), shape: ImgShape = "") {
  if (/\.(jpe?g|png)(\?.*)?$/i.test(url)) return url;
  if (process.env.IMAGE_CDN !== "self") return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=1200&h=${shape === "p" ? 1800 : 1200}&fit=contain&cbg=white&output=jpg&q=85`;
  if (!key) return url;
  return `${PANEL_URL}/api/img/${imgSig(url, key, shape)}/${Buffer.from(url).toString("base64url")}${shape ? "." + shape : ""}.jpg`;
}

// Görsel gerçekten açılıyor mu: HTTP 200, görsel türü, 1 KB - 10 MB (Trendyol sınırı). Açılan kaynak adreslerin kümesi döner.
export async function aliveImages(urls: string[], toFetch: (u: string) => string = (u) => u, par = 8, timeoutMs = 20000): Promise<Set<string>> {
  const ok = new Set<string>();
  let i = 0;
  const work = async () => {
    while (i < urls.length) {
      const u = urls[i++];
      try {
        const r = await fetch(toFetch(u), { signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "Mozilla/5.0" } });
        const type = String(r.headers.get("content-type") ?? "");
        const b = r.ok && /^image\//i.test(type) ? (await r.arrayBuffer()).byteLength : 0;
        if (!b) await r.body?.cancel().catch(() => {});
        if (b >= 1024 && b <= 10 * 1048576) ok.add(u);
      } catch { /* açılmıyor */ }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, par) }, work));
  return ok;
}
