// Yapay zekâ açıklama taslağının kurallı kontrolü (saf fonksiyonlar, test: worker/test/desc-check.test.ts).
// Amaç "%100": taslak tedarikçi metninde olmayan hiçbir bilgi içermesin. Model kendine güvense bile buradan geçmeyen taslak kullanılmaz.
// Kontroller: izinli HTML, uzunluk, sayılar ve model kodları kaynakta var mı, kaynakta olmayan iddia kalıpları (orijinal, garanti, kargo,
// sağlık...), iletişim bilgisi, marka riski listesi (kaynakta yoksa), yasaklı kelimeler.

const ALLOWED = new Set(["p", "ul", "li", "strong", "br"]);
export const stripTags = (html: string) => html.replace(/<br\s*\/?>/gi, " ").replace(/<\/?[a-z][^>]*>/gi, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
// Türkçe küçük harf + ı/i birleştirme (I -> ı tuzağı: "IŞIK".toLocaleLowerCase("tr") = "ışık")
export const norm = (s: string) => ` ${stripTags(String(s ?? "")).toLocaleLowerCase("tr").replace(/ı/g, "i").replace(/[^0-9a-zçğöşü%.,]+/g, " ").replace(/\s+/g, " ").trim()} `;

// Kaynakta geçmiyorsa taslakta da olamaz (pazaryeri yanıltıcı iddia sayar ya da uydurma olabilir)
const CLAIMS: [string, RegExp][] = [
  ["orijinal", /orijinal|original|lisansl/], ["%100", /%\s?100|yüzde yüz|yuzde yuz/], ["garanti", /garanti/], ["kargo", /kargo|teslimat|aynı gün|ayni gun|hızlı gönderim|hizli gonderim/],
  ["fiyat/indirim", /indirim|kampanya|fiyat|ucuz|uygun fiyat|hediye|bedava|ücretsiz|ucretsiz/], ["en iyi", /en iyi|en kaliteli|1\.? kalite|birinci sınıf|birinci sinif|lüks|luks|premium/],
  ["sağlık", /tedavi|şifa|sifa|iyileştir|iyilestir|hastalık|hastalik|ağrı|agri|zayıfla|zayifla|kilo ver|bağışıklık|bagisiklik|antibakteriyel|antibakteriel/],
  ["sertifika", /sertifika|ce belgeli|tse|onaylı|onayli|patentli/], ["su geçirmez", /su geçirmez|su gecirmez|waterproof|suya dayanıklı|suya dayanikli/],
  ["el yapımı", /el yapımı|el yapimi|el işi|el isi|handmade/], ["yerli", /yerli üretim|yerli uretim|türk malı|turk mali|made in/], ["çocuk güvenli", /zehirsiz|bpa|toksik/],
  ["stok", /stokta|sınırlı stok|sinirli stok|tükenmeden|tukenmeden/],
];
const CONTACT = /(https?:\/\/|www\.|\.com\b|\.net\b|@[a-z0-9-]+\.|(\+?90|0)?\s?5\d{2}\s?\d{3}\s?\d{2}\s?\d{2}|whatsapp|instagram|telefon numara)/i;

export type DescCheck = { ok: boolean; reasons: string[]; text: string; html: string };

// Sınırlı HTML: yalnızca izinli etiketler, özniteliksiz. Başka etiket varsa taslak reddedilir (temizlenip geçirilmez).
export function cleanHtml(html: string): { html: string; error?: string } {
  const s = String(html ?? "").trim();
  for (const m of s.matchAll(/<\s*(\/?)\s*([a-z0-9]+)([^>]*)>/gi)) {
    const tag = m[2].toLowerCase();
    if (!ALLOWED.has(tag)) return { html: "", error: `izin verilmeyen etiket <${tag}>` };
    if (m[3].replace(/\s*\/\s*$/, "").trim()) return { html: "", error: `etikette öznitelik <${tag}${m[3].slice(0, 30)}>` };
  }
  if (/<(?![a-z\/])/i.test(s.replace(/<\s*\/?\s*[a-z0-9]+[^>]*>/gi, ""))) return { html: "", error: "bozuk HTML" };
  return { html: s.replace(/<\s*(\/?)\s*([a-z0-9]+)\s*\/?\s*>/gi, (_, c, t) => (t.toLowerCase() === "br" ? "<br>" : `<${c}${t.toLowerCase()}>`)) };
}

// Sayı belirteçleri (12, 1.5, 2,5, 220v'deki 220): taslaktaki her sayı kaynakta olmalı
const numbers = (s: string) => [...s.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0].replace(",", "."));
// Harf+rakam karışık model kodları (X200, A54, 4K): kaynakta olmalı
const codes = (s: string) => [...s.matchAll(/\b(?=[a-z0-9-]*\d)(?=[a-z0-9-]*[a-zçğıöşü])[a-zçğıöşü0-9-]{2,}\b/gi)].map((m) => m[0].toLocaleLowerCase("tr").replace(/ı/g, "i"));

export function checkDescription(draftHtml: string, source: { title: string; description: string; attributes?: Record<string, unknown> | null; brand?: string | null },
  opts: { brandMatch?: (t: string, d?: string) => string | null; banned?: string[] } = {}): DescCheck {
  const reasons: string[] = [];
  const c = cleanHtml(draftHtml);
  if (c.error) return { ok: false, reasons: [c.error], text: "", html: "" };
  const text = stripTags(c.html);
  const attrText = Object.entries(source.attributes ?? {}).filter(([k, v]) => !/kategori|satış fiyatı|@/.test(k) && typeof v !== "object").map(([k, v]) => `${k} ${v}`).join(" ");
  const src = `${source.title} ${source.description} ${attrText} ${source.brand ?? ""}`;
  const nSrc = norm(src), nOut = norm(text);
  if (text.length < 120) reasons.push(`çok kısa (${text.length} karakter)`);
  if (text.length > 3000) reasons.push(`çok uzun (${text.length} karakter)`);
  const srcNums = new Set(numbers(stripTags(src)));
  const extraNums = [...new Set(numbers(text))].filter((n) => !srcNums.has(n));
  if (extraNums.length) reasons.push(`kaynakta olmayan sayı: ${extraNums.slice(0, 5).join(", ")}`);
  const srcCodes = new Set(codes(stripTags(src)));
  const extraCodes = [...new Set(codes(text))].filter((x) => !srcCodes.has(x) && !srcNums.has(x));
  if (extraCodes.length) reasons.push(`kaynakta olmayan model/kod: ${extraCodes.slice(0, 5).join(", ")}`);
  for (const [name, re] of CLAIMS) if (re.test(nOut) && !re.test(nSrc)) reasons.push(`kaynakta olmayan iddia: ${name}`);
  if (CONTACT.test(text)) reasons.push("iletişim / bağlantı bilgisi");
  if (opts.brandMatch) {
    const b = opts.brandMatch(text);
    if (b && !opts.brandMatch(src)) reasons.push(`marka riski: ${b}`);
  }
  for (const w of opts.banned ?? []) if (w && norm(text).includes(` ${norm(w).trim()} `)) reasons.push(`yasaklı kelime: ${w}`);
  // Kaynaktaki içeriğin büyük kısmı korunmalı (model metni kısaltıp bilgiyi atmasın): kaynağın anlamlı kelimelerinin en az %40'ı taslakta
  const words = (s: string) => new Set(norm(s).split(" ").filter((w) => w.length >= 5));
  const sw = words(source.description), ow = words(text);
  const kept = sw.size ? [...sw].filter((w) => ow.has(w)).length / sw.size : 1;
  if (kept < 0.4) reasons.push(`kaynak bilgisinin çoğu atılmış (kelimelerin %${Math.round(kept * 100)}'i kaldı)`);
  return { ok: reasons.length === 0, reasons, text, html: c.html };
}
