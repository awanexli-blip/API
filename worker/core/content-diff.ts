// Yayındaki ilanı yeniden gönderince yalnızca değişen içerik gider (K, 28.10: "neyi değiştirirsem onu güncellesin").
// Karşılaştırma önce son gönderdiğimiz içeriğin parmak iziyle (marketplace_listings.content_sent, migration 068); iz yoksa
// (eski ilan) pazaryerindeki canlı içerikle: başlık metni, açıklama özeti, görsel sayısı. Emin olunamayan alan gönderilmez.
import { createHash } from "node:crypto";

export type ContentFp = { t?: string; d?: string; i?: string };
export type Content = { title: string; description: string; images: string[] };
export type LiveContent = { title?: string; descHash?: string; images?: string[] };

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
// HTML etiketi, karakter kodu, boşluk ve büyük/küçük harf farkı "değişiklik" sayılmaz (pazaryeri metni biçimlendirebilir)
export const normText = (s: string) => String(s ?? "")
  .replace(/<[^>]*>/g, " ")
  .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m)
  .replace(/\s+/g, " ").trim().toLocaleLowerCase("tr");
export const hashOf = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);
export const descHashOf = (html: string) => hashOf(normText(html));
export const fpOf = (c: Content): ContentFp => ({ t: hashOf(normText(c.title)), d: descHashOf(c.description), i: hashOf(c.images.join("|")) });

export function contentChanges(cur: Content, sent: ContentFp | null | undefined, live: LiveContent): Partial<Content> {
  const fp = fpOf(cur), out: Partial<Content> = {};
  const titleChanged = sent?.t ? sent.t !== fp.t : live.title != null && normText(live.title) !== normText(cur.title);
  const descChanged = sent?.d ? sent.d !== fp.d : live.descHash != null && live.descHash !== fp.d;
  const imgChanged = sent?.i ? sent.i !== fp.i : Array.isArray(live.images) && live.images.length > 0 && live.images.length !== cur.images.length;
  if (titleChanged && cur.title.trim()) out.title = cur.title;
  if (descChanged && normText(cur.description)) out.description = cur.description;
  if (imgChanged && cur.images.length) out.images = cur.images;
  return out;
}
