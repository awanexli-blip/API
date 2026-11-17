// ozsaraytr.com vitrin (K 16.11). Saf yardımcılar (testli) + sunucu tarafı veri okuma (service_role, yalnızca store_catalog ve ürün detayı).
// Gösterme amaçlı: sepet/ödeme/kargo yok ("Yakında"); fiyat Trendyol satış fiyatı.
export const STORE_HOSTS = ["ozsaraytr.com", "www.ozsaraytr.com"];
export const STORE_NAME = "Özsaray";
export const PAGE_SIZE = 48;

// Mağaza alan adında yollar kökten ("/urun/x"), panel alan adında önizleme "/magaza" altında
export const isStoreHost = (host: string | null | undefined) => STORE_HOSTS.includes(String(host ?? "").split(":")[0].toLowerCase());
export const basePath = (host: string | null | undefined) => (isStoreHost(host) ? "" : "/magaza");

export function slugify(s: string) {
  const tr: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };
  return String(s ?? "").toLocaleLowerCase("tr").replace(/[çğıöşüâîû]/g, (c) => tr[c] ?? c).normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

export const tl = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: 2 }).format(Number(n) || 0);

// Tedarikçi açıklaması (HTML, çoğu kez çift kaçışlı: "&amp;Uuml;") -> düz metin paragraf/madde. HTML olarak basılmaz (XSS).
const ENT: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ccedil: "ç", Ccedil: "Ç", ouml: "ö", Ouml: "Ö", uuml: "ü", Uuml: "Ü",
  ndash: "–", mdash: "—", bull: "•", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", deg: "°", plusmn: "±", times: "×", reg: "®", trade: "™", copy: "©",
  scaron: "š", Scaron: "Š", iacute: "í", eacute: "é", aacute: "á", oacute: "ó", uacute: "ú", acirc: "â", icirc: "î", ucirc: "û", radic: "√", Omega: "Ω", micro: "µ", frac12: "½", sup2: "²", sup3: "³", middot: "·" };
export function decodeEntities(s: string) {
  let out = String(s ?? "");
  for (let i = 0; i < 2 && /&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/i.test(out); i++) {
    out = out.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (m, e: string) => {
      if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; }
      return ENT[e] ?? m;
    });
  }
  return out;
}
export type DescBlock = { kind: "p" | "li"; text: string };
export function descriptionBlocks(html: string | null | undefined): DescBlock[] {
  const s = String(html ?? "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<li[^>]*>/gi, "\n• ").replace(/<\/(p|div|li|h\d|tr|ul|ol)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const lines = decodeEntities(s).split(/\n|;\s*-\s+|(?:^|\s)-\s(?=[A-ZÇĞİÖŞÜ])/).map((x) => x.replace(/\s+/g, " ").trim()).filter((x) => x && x !== "•");
  const out: DescBlock[] = [];
  for (const l of lines) {
    if (/^[•\-*]\s*/.test(l)) { const t = l.replace(/^[•\-*]\s*/, ""); if (t) out.push({ kind: "li", text: t }); }
    else out.push({ kind: "p", text: l });
  }
  return out.slice(0, 80);
}

// Görsel adresi: depodaki görseller "/storage/..." (her iki alan adında da Caddy sunar), diğerleri tedarikçi CDN'i
export const imgUrl = (u: string | null | undefined) => (!u ? null : /^https?:\/\//i.test(u) ? u : u.startsWith("/") ? u : `/${u}`);

export const SORTS = { onerilen: "Önerilen", "fiyat-artan": "Fiyat (artan)", "fiyat-azalan": "Fiyat (azalan)", yeni: "En yeniler" } as const;
export type Sort = keyof typeof SORTS;
export const parseSort = (s: unknown): Sort => (typeof s === "string" && s in SORTS ? (s as Sort) : "onerilen");
export const parsePage = (s: unknown) => { const n = Math.floor(Number(s)); return n >= 1 && n <= 500 ? n : 1; };
// Arama: ILIKE kalıbı kaçışı (% _ \) ve en az 2 harf
export const searchTerm = (q: unknown) => { const t = String(q ?? "").trim().slice(0, 80); return t.length >= 2 ? t : ""; };
// Fiyat aralığı filtresi (TL, tam sayı); geçersiz ya da ters aralık yok sayılır
export const parsePrice = (s: unknown) => { const n = Math.floor(Number(String(s ?? "").replace(/[^\d]/g, ""))); return String(s ?? "").trim() && n >= 0 && n <= 1_000_000 ? n : undefined; };
export const PRICE_BANDS: [number | undefined, number | undefined, string][] = [[undefined, 250, "250 TL altı"], [250, 500, "250 - 500 TL"], [500, 1000, "500 - 1.000 TL"], [1000, 2500, "1.000 - 2.500 TL"], [2500, undefined, "2.500 TL üstü"]];
export const likeEscape = (t: string) => t.replace(/[\\%_]/g, (c) => `\\${c}`);
