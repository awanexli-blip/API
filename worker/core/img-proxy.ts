// Görsel JPG dönüştürücü adresi (panel: app/api/img/[sig]/[file]). Hepsiburada WebP kabul etmiyor; tedarikçi CDN'i yalnızca WebP veriyor.
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

// JPG/PNG adresi olduğu gibi kalır; diğerleri (webp, avif, uzantısız) dönüştürücüden geçer
export function jpgUrl(url: string, key = keyOf(), shape: ImgShape = "") {
  if (/\.(jpe?g|png)(\?.*)?$/i.test(url) || !key) return url;
  return `${PANEL_URL}/api/img/${imgSig(url, key, shape)}/${Buffer.from(url).toString("base64url")}${shape ? "." + shape : ""}.jpg`;
}
