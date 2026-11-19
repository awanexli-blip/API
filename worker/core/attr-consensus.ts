// Başka satıcılardan ÖZELLİK alma kabul kuralları (K 19.11, kesin olsun). Saf fonksiyonlar, test: worker/test/attr-consensus.test.ts.
// Bir değer YALNIZCA şunların hepsi sağlanırsa alınır:
//  (a) diğer ilan aynı ürün olarak doğrulanmış: birebir barkod/GTIN eşleşmesi, ya da model kodu eşleşmesi + fotoğraf eşleşmesi
//      (yalnızca fotoğraf benzerliği YETMEZ),
//  (b) değer o sayfada alıntılı (sayfa ayrı çağrıda okunup alıntı bulundu, alıntı değeri aynen içeriyor),
//  (c) en az İKİ bağımsız doğrulanmış kaynak aynı değeri veriyor (farklı site ya da aynı sitede farklı satıcı); istisna: büyük pazaryerinde
//      birebir barkod eşleşmesi tek güçlü kaynak sayılır ama yine ikinci kaynak ya da tedarikçi metni/başlık aynı değeri söylemeli,
//  (d) değer pazaryerinin izinli listesinde BİREBİR karşılığı var (büyük/küçük harf ve boşluk dışında fark yok; serbest metin özellik doldurulmaz).
// Doğrulanmış kaynaklardan biri farklı değer diyorsa ya da tedarikçi metni başka bir izinli değeri söylüyorsa: doldurulmaz.
import { nrm } from "./contradictions.ts";

export type AttrQuote = { name: string; value: string; quote: string; found?: boolean; sentence?: string };
export type AttrCand = {
  url: string; seller?: string;
  matchKind: "barcode" | "model+photo" | "photo" | "none"; // doğrulama sonucu (worker/core/attr-research.ts)
  attrs: AttrQuote[];
};
export type WantAttr = { mp: string; name: string; values: string[]; required?: boolean };
export type AttrSource = { url: string; host: string; seller?: string; matchKind: string; quote: string };
export type AttrProposal = { mp: string; name: string; value: string; sources: AttrSource[]; supplierAgrees: boolean };
export type Abstain = { mp: string; name: string; reason: string };

export const OPEN_LIST = 5000; // lib/mp-catalog.ts ile aynı: bu kadar değerli liste serbest metin sayılır
export const MAJOR = /(^|\.)(trendyol\.com|hepsiburada\.com|amazon\.com\.tr|n11\.com|ciceksepeti\.com)$/;
export const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };

/** GTIN-8/12/13/14 sağlama toplamı (lib/validation/product.ts isValidGtin ile aynı kural). İç barkodlar (ÖS13-, OS13-, harfli) GTIN değildir. */
export function isGtin(code: string): boolean {
  const c = String(code ?? "").trim();
  if (!/^\d+$/.test(c) || ![8, 12, 13, 14].includes(c.length)) return false;
  if (/^0+$/.test(c)) return false;
  const d = c.split("").map(Number), check = d.pop()!;
  const sum = d.reverse().reduce((a, x, i) => a + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}
/** Ürünün model kodları: harf + rakam karışık, en az 4 karakter, ölçü/birim/adet değil ("XR-200", "A54", "KM5017"). */
export function modelCodes(...texts: string[]): string[] {
  const out = new Set<string>();
  for (const t of texts) for (const m of String(t ?? "").matchAll(/\b(?=[A-Za-z0-9-]*\d)(?=[A-Za-z0-9-]*[A-Za-z])[A-Za-z0-9][A-Za-z0-9-]{2,}[A-Za-z0-9]\b/g)) {
    const c = m[0].toUpperCase();
    if (/^\d+(CM|MM|M|MT|KG|GR|G|ML|L|LT|W|V|MAH|GB|TB|HZ|LI|LU|LÜ|LIK|ADET|X\d+|K|P|D)$/.test(c)) continue;
    if (/^(X\d+|\d+X\d+(X\d+)?|\d+X)$/.test(c)) continue;
    if (/^(OS13|ÖS13|TCX|BZS|HB)/.test(c) || /^(316L|304L?|18K|14K|925S?)$/.test(c)) continue; // iç kodlar, malzeme sınıfları
    if (c.replace(/[^A-Z]/g, "").length < 1 || c.replace(/[^0-9]/g, "").length < 2) continue;
    out.add(c);
  }
  return [...out].slice(0, 5);
}
const vnorm = (s: string) => nrm(s).trim();

/** İzinli listede birebir karşılık (yalnızca büyük/küçük harf, Türkçe harf ve noktalama farkı). Yoksa null. */
export function exactAllowed(value: string, allowed: string[]): string | null {
  const v = vnorm(value);
  if (!v) return null;
  const hits = allowed.filter((a) => vnorm(a) === v);
  return hits.length === 1 ? hits[0] : null; // iki izinli değer aynı biçime düşüyorsa belirsiz
}
const phraseIn = (text: string, phrase: string) => { const p = vnorm(phrase); return p.length >= 2 && nrm(text).includes(` ${p} `); };

export function attrConsensus(cands: AttrCand[], want: WantAttr[], supplierText: string): { accepted: AttrProposal[]; abstained: Abstain[] } {
  const accepted: AttrProposal[] = [], abstained: Abstain[] = [];
  const verified = cands.filter((c) => c.matchKind === "barcode" || c.matchKind === "model+photo");
  for (const w of want) {
    const no = (reason: string) => abstained.push({ mp: w.mp, name: w.name, reason });
    if (!w.values.length || w.values.length >= OPEN_LIST) { no("serbest metin özellik (izinli liste yok): doldurulmaz"); continue; }
    if (!verified.length) { no(cands.length ? "aynı ürün olduğu barkod / model kodu ile doğrulanamadı" : "başka ilan bulunamadı"); continue; }
    const hits: { value: string; src: AttrSource; strong: boolean }[] = [];
    const rejects: string[] = [];
    for (const c of verified) for (const a of c.attrs) {
      if (vnorm(a.name) !== vnorm(w.name)) continue;
      const quote = String(a.quote ?? ""), sent = String(a.sentence ?? "");
      if (!a.found || !sent.trim()) { rejects.push("alıntı sayfada bulunamadı"); continue; }
      if (!(nrm(sent).includes(nrm(quote).trim()) || nrm(quote).includes(nrm(sent).trim()))) { rejects.push("sayfadaki cümle alıntıyla uyuşmuyor"); continue; }
      if (!phraseIn(`${quote} ${sent}`, a.value)) { rejects.push("değer alıntıda aynen geçmiyor"); continue; }
      const mapped = exactAllowed(a.value, w.values);
      if (!mapped) { rejects.push(`"${String(a.value).slice(0, 40)}" izinli listede birebir yok`); continue; }
      const host = hostOf(c.url);
      hits.push({ value: mapped, strong: c.matchKind === "barcode" && MAJOR.test(host), src: { url: c.url, host, seller: c.seller, matchKind: c.matchKind, quote: quote.slice(0, 200) } });
    }
    if (!hits.length) { no(rejects.length ? `kaynak değeri kabul edilmedi: ${[...new Set(rejects)].slice(0, 2).join("; ")}` : "doğrulanmış kaynaklarda bu özellik yok"); continue; }
    const vals = [...new Set(hits.map((h) => h.value))];
    if (vals.length > 1) { no(`kaynaklar çelişiyor: ${vals.slice(0, 3).join(" / ")}`); continue; }
    const value = vals[0];
    // Tedarikçi metni başka bir izinli değeri söylüyorsa (ve bunu söylemiyorsa) doldurulmaz
    const supplierAgrees = phraseIn(supplierText, value);
    const supplierOther = w.values.filter((x) => x !== value && vnorm(x).length >= 3 && phraseIn(supplierText, x));
    if (!supplierAgrees && supplierOther.length) { no(`tedarikçi metni farklı değer diyor (${supplierOther.slice(0, 2).join(", ")})`); continue; }
    // Bağımsızlık: farklı site ya da aynı sitede farklı (adı bilinen) satıcı; satıcı adı yoksa site başına tek kaynak
    // Bir sitede satıcı adı bilinmeyen kaynak varsa o sitenin tüm kaynakları tek sayılır
    const noSeller = new Set(hits.filter((h) => !h.src.seller).map((h) => h.src.host));
    const key = (s: AttrSource) => (s.seller && !noSeller.has(s.host) ? `${s.host}|${vnorm(s.seller)}` : s.host);
    const indep = new Map<string, (typeof hits)[number]>();
    for (const h of hits) { const k = key(h.src); if (!indep.has(k) || (h.strong && !indep.get(k)!.strong)) indep.set(k, h); }
    const n = indep.size, strong = [...indep.values()].some((h) => h.strong);
    if (n >= 2 || (n === 1 && strong && supplierAgrees)) accepted.push({ mp: w.mp, name: w.name, value, sources: [...indep.values()].map((h) => h.src), supplierAgrees });
    else no(n === 1 ? (strong ? "tek güçlü kaynak (barkod) ama tedarikçi metni bu değeri söylemiyor" : "tek bağımsız kaynak (en az iki gerekli)") : "kaynak yok");
  }
  return { accepted, abstained };
}
