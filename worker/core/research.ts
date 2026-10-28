// Ürün araştırması (K, 28.10): aynı ürünün başka ilanını bul, oradaki BİLGİLERİ (ölçü, ağırlık, malzeme, kullanım; soru-cevaplardaki
// satıcı cevapları dahil) al, açıklamayı kendi cümlemizle yazarken kullan. Metin kopyalanmaz; başka ilanın markası / adı yazılmaz.
// Toptancım'da gerçek barkod yok (28.10: 26.104 varyantın hiçbiri), eşleşme fotoğraf + başlıkla yapılır; bu yüzden üç aşamalı doğrulama:
//  1) Ara (gemini-2.5-flash + Google araması + sayfa okuma): aday ilanlar, ilan fotoğrafı, alıntılı bilgiler
//  2) Aynı ürün mü: adayın fotoğrafı indirilir, bizimkiyle ayrı çağrıda karşılaştırılır; yalnızca "evet" ve fark yok geçer
//  3) Alıntı sayfada mı: sayfa ayrı çağrıda yeniden okunur, her alıntı aranır
// Sonra kabul kuralları (acceptFacts, saf, test edilir): sayı alıntıda olmalı, iki ilan çelişirse bilgi atılır, garanti / orijinal /
// fiyat / kargo / sağlık gibi iddialar alınmaz. Kalan bilgiler taslağa kaynaklarıyla gider ve yine panel onayı gerekir.
import { safeFetch } from "./safe-fetch.ts";
import { geminiCall, parseLooseJson, type GeminiPart } from "./gemini.ts";
import { CLAIMS, norm } from "./desc-check.ts";

export type Fact = { name: string; value: string; quote: string; url: string };
export type CandFact = { name: string; value: string; quote: string; found?: boolean; sentence?: string };
export type Cand = { url: string; name: string; image_url?: string; same?: boolean; sameReason?: string; facts: CandFact[] };

// Alınan bilgi türleri (ad üzerinden, normalize: ı -> i)
const FACT_TYPES = /olcu|boyut|ebat|yukseklik|genislik|derinlik|uzunluk|cap|en x|agirlik|kilo|gram|malzeme|materyal|kumas|kapasite|hacim|litre|guc|watt|volt|pil|batarya|sarj|sure|dakika|saat|adet|parca|paket|icerik|renk|baglanti|kablo|mod|kademe|hiz/;
const fold = (s: string) => norm(s).replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u");
const digits = (s: string) => [...String(s).matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0].replace(",", "."));
const factKey = (n: string) => norm(n).trim().replace(/\b(urun|ürün|toplam|yaklasik|yaklaşık)\b/g, "").replace(/\s+/g, " ").trim();

// Doğrulanmış adaylardan kabul edilen bilgiler + atılanlar (neden)
export function acceptFacts(cands: Cand[]): { facts: Fact[]; dropped: { name: string; value: string; reason: string }[] } {
  const dropped: { name: string; value: string; reason: string }[] = [];
  const ok: Fact[] = [];
  for (const c of cands) {
    if (!c.same) { for (const f of c.facts) dropped.push({ name: f.name, value: f.value, reason: "aynı ürün olduğu doğrulanmadı" }); continue; }
    for (const f of c.facts) {
      const name = String(f.name ?? "").trim().slice(0, 40), value = String(f.value ?? "").trim(), quote = String(f.quote ?? "").trim();
      const drop = (reason: string) => dropped.push({ name, value, reason });
      if (!name || !value || !quote) { drop("eksik alan"); continue; }
      // Yalnızca ölçülebilir / somut bilgi (pazarlama cümlesi, stok, kod alınmaz)
      if (!FACT_TYPES.test(fold(name)) || /stok|kod|sku|barkod|fiyat|satıcı|satici/i.test(name)) { drop("bilgi türü alınmıyor"); continue; }
      if (value.length > 80) { drop("değer cümle gibi (bilgi değil)"); continue; }
      if (!f.found) { drop("alıntı sayfada bulunamadı"); continue; }
      const sent = norm(f.sentence ?? ""), q = norm(quote);
      if (!sent.trim() || !(sent.includes(q.trim()) || q.includes(sent.trim()))) { drop("sayfadaki cümle alıntıyla uyuşmuyor"); continue; }
      const qd = new Set(digits(`${quote} ${f.sentence ?? ""}`));
      if (digits(value).some((d) => !qd.has(d))) { drop("değerdeki sayı alıntıda yok"); continue; }
      const claim = CLAIMS.find(([, re]) => re.test(norm(`${name} ${value}`)));
      if (claim) { drop(`iddia alınmaz: ${claim[0]}`); continue; }
      ok.push({ name, value, quote: quote.slice(0, 300), url: c.url });
    }
  }
  // Aynı bilgi için farklı değer (iki ilan farklı ölçü veriyor): hiçbiri kullanılmaz
  const by = new Map<string, Fact[]>();
  for (const f of ok) by.set(factKey(f.name), [...(by.get(factKey(f.name)) ?? []), f]);
  const facts: Fact[] = [];
  for (const [, list] of by) {
    const vals = new Set(list.map((f) => digits(f.value).join("x") || norm(f.value).trim()));
    if (vals.size > 1) { for (const f of list) dropped.push({ name: f.name, value: f.value, reason: "ilanlar arasında çelişki" }); continue; }
    facts.push(list[0]);
  }
  return { facts: facts.slice(0, 15), dropped };
}

// Görsel dosya adındaki ipucu (tedarikçiler çoğu zaman orijinal ürün adını dosya adına koyuyor): ".../buffer-elektrikli-masaj-aleti-1-44107388-sw1200sh1200.webp"
export function imageHint(url: string): string {
  const file = decodeURIComponent(String(url).split("?")[0].split("/").pop() ?? "").replace(/\.(webp|jpe?g|png|gif)$/i, "");
  return file.replace(/(-\d+)*-sw\d+sh\d+$/i, "").replace(/-\d{4,}$/g, "").replace(/[-_]+/g, " ").replace(/\b\d+\b/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
}

async function imagePart(url: string): Promise<GeminiPart | null> {
  try {
    const r = await safeFetch(url, { maxBytes: 8 * 1048576, timeoutMs: 30_000, accept: /^image\// });
    if (!r.ok || r.body.length < 500) return null;
    return { inline_data: { mime_type: r.contentType || "image/jpeg", data: r.body.toString("base64") } };
  } catch { return null; }
}

// Google arama yönlendirme adresi -> gerçek ilan adresi (sayfa indirilmez, yalnızca Location okunur)
async function realUrl(u: string): Promise<string> {
  if (!/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect/.test(u)) return u;
  try {
    const r = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    const loc = r.headers.get("location") ?? "";
    return /^https?:\/\//.test(loc) ? loc : u;
  } catch { return u; }
}

const SEARCH_PROMPT = (title: string, hint: string, desc: string) => `Bu fotoğraftaki ürünle BİREBİR AYNI ürünün satıldığı ilanları Türk e-ticaret sitelerinde ara (Trendyol, Hepsiburada, n11, Amazon.com.tr, üretici sitesi).
Bizim başlığımız: "${title}". Görsel dosya adı ipucu: "${hint || "-"}". ${desc ? `Bizim açıklamamız: "${desc.slice(0, 600)}"` : ""}
Kurallar:
- Yalnızca fotoğraftaki ürünle aynı model olduğundan emin olduğun ilanları ver (görünüm, renk, parça, şekil, üzerindeki yazılar aynı). Benzer ama farklı model verme. En fazla 3 ilan.
- Her ilanın ana ürün fotoğrafının adresini ver (image_url, doğrudan görsel dosyası).
- Her ilanı OKU; şu bilgileri çıkar: ölçü/boyut, ağırlık, malzeme, kapasite, güç/pil/şarj süresi, paket içeriği, kullanım bilgisi. Soru-cevaplarda satıcının verdiği bilgiler dahil.
- Her bilginin geçtiği cümleyi sayfadan AYNEN alıntıla (quote). İlanda yazmayanı yazma, tahmin etme. Garanti, fiyat, kargo, kampanya bilgisi alma.
Sadece JSON yaz: {"candidates":[{"url":"","name":"","image_url":"","facts":[{"name":"","value":"","quote":""}]}]}`;

const SAME_PROMPT = (ours: string, theirs: string) => `İki ürün fotoğrafı var: 1. fotoğraf bizim ürünümüz ("${ours}"), 2. fotoğraf başka bir ilan ("${theirs}").
Bunlar BİREBİR AYNI ürün modeli mi? Şekil, renk, parça sayısı, düğmeler/detaylar, üzerindeki yazılar ve oranlar aynı olmalı. Marka etiketi ve arka plan farkı önemsiz.
Emin değilsen "emin_degil" de. Sadece JSON: {"same":"evet|hayir|emin_degil","differences":["..."]}`;

const QUOTE_PROMPT = (url: string, quotes: string[]) => `Bu sayfayı oku: ${url}
Aşağıdaki alıntıların her biri sayfada (ürün bilgileri, açıklama, özellikler, soru-cevaplar dahil) geçiyor mu? Geçiyorsa sayfadaki cümleyi AYNEN kopyala; geçmiyorsa found:false.
${quotes.map((q, i) => `${i + 1}. «${q}»`).join("\n")}
Sadece JSON: {"results":[{"i":1,"found":true,"sentence":""}]}`;

const PAGE_PROMPT = (url: string, ours: string, quotes: string[]) => `Bu sayfayı oku: ${url}
1) Sayfadaki ürün, ekteki fotoğraftaki ürünle ("${ours}") BİREBİR AYNI model mi? Şekil, renk, parça sayısı, düğmeler/detaylar, üzerindeki yazılar aynı olmalı;
   marka etiketi ve arka plan farkı önemsiz. Emin değilsen "emin_degil".
2) Aşağıdaki alıntıların her biri sayfada (ürün bilgileri, açıklama, özellikler, soru-cevaplar dahil) geçiyor mu? Geçiyorsa sayfadaki cümleyi AYNEN kopyala.
${quotes.map((q, i) => `${i + 1}. «${q}»`).join("\n") || "(alıntı yok)"}
Sadece JSON: {"same":"evet|hayir|emin_degil","differences":["..."],"results":[{"i":1,"found":true,"sentence":""}]}`;

export async function researchProduct(p: { title: string; description: string; image_url: string }) {
  const out: Record<string, any> = { at: new Date().toISOString(), status: "", candidates: [] as any[], dropped: [] as any[] };
  const ours = await imagePart(p.image_url);
  if (!ours) return { facts: [] as Fact[], research: { ...out, status: "ürün görseli indirilemedi" } };
  const hint = imageHint(p.image_url);
  const desc = norm(p.description).trim() === norm(p.title).trim() ? "" : p.description;
  const s = await geminiCall({ parts: [ours, { text: SEARCH_PROMPT(p.title, hint, desc) }], tools: ["google_search", "url_context"] });
  out.queries = s.queries.slice(0, 6);
  const found = parseLooseJson<{ candidates: Cand[] }>(s.text)?.candidates ?? [];
  if (!found.length) return { facts: [] as Fact[], research: { ...out, status: "aynı ürün bulunamadı" } };
  const cands: Cand[] = [];
  const seenUrl = new Set<string>();
  for (const c of found.slice(0, 3)) {
    const url = await realUrl(String(c.url ?? ""));
    if (seenUrl.has(url)) continue; // aynı ilan iki kez gelmesin
    seenUrl.add(url);
    const cand: Cand = { url, name: String(c.name ?? "").slice(0, 200), image_url: c.image_url, facts: (c.facts ?? []).slice(0, 15) };
    // 2) aynı ürün mü (fotoğraf karşılaştırma)
    const theirs = c.image_url ? await imagePart(String(c.image_url)) : null;
    if (!theirs) {
      // İlan fotoğrafı indirilemedi (adres yanlış / site engelli): sayfayı okuyan ayrı çağrı bizim fotoğrafla karşılaştırır ve alıntıları arar
      if (!/^https?:\/\//.test(url) || /vertexaisearch/.test(url)) { cand.same = false; cand.sameReason = "ilan adresi çözülemedi"; cands.push(cand); continue; }
      const pg = await geminiCall({ parts: [ours, { text: PAGE_PROMPT(url, p.title, cand.facts.map((f) => String(f.quote ?? "").slice(0, 300))) }], tools: ["url_context"] });
      const v = parseLooseJson<{ same: string; differences: string[]; results: { i: number; found: boolean; sentence: string }[] }>(pg.text);
      const pageOk = pg.urls.some((u) => u.ok);
      cand.same = pageOk && v?.same === "evet" && !(v.differences ?? []).filter((d) => d && !/yok|none|fark yok/i.test(d)).length;
      cand.sameReason = !pageOk ? "ilan sayfası okunamadı" : v ? `sayfadan: ${v.same}${v.differences?.length ? `: ${v.differences.slice(0, 3).join("; ")}` : ""}`.slice(0, 300) : "karşılaştırma yanıtı okunamadı";
      cand.facts = cand.facts.map((f, i) => { const r = v?.results?.find((x) => Number(x.i) === i + 1); return { ...f, found: !!cand.same && !!r?.found, sentence: r?.sentence ?? "" }; });
      cands.push(cand); continue;
    }
    const v = parseLooseJson<{ same: string; differences: string[] }>((await geminiCall({ parts: [ours, theirs, { text: SAME_PROMPT(p.title, cand.name) }] })).text);
    cand.same = v?.same === "evet" && !(v.differences ?? []).filter((d) => d && !/yok|none|fark yok/i.test(d)).length;
    cand.sameReason = v ? `${v.same}${v.differences?.length ? `: ${v.differences.slice(0, 3).join("; ")}` : ""}`.slice(0, 300) : "karşılaştırma yanıtı okunamadı";
    // 3) alıntılar sayfada mı (yalnızca aynı ürünse)
    if (cand.same && cand.facts.length && /^https?:\/\//.test(url) && !/vertexaisearch/.test(url)) {
      const q = await geminiCall({ parts: [{ text: QUOTE_PROMPT(url, cand.facts.map((f) => String(f.quote ?? "").slice(0, 300))) }], tools: ["url_context"] });
      const res = parseLooseJson<{ results: { i: number; found: boolean; sentence: string }[] }>(q.text)?.results ?? [];
      const pageOk = q.urls.some((u) => u.ok);
      cand.facts = cand.facts.map((f, i) => { const r = res.find((x) => Number(x.i) === i + 1); return { ...f, found: pageOk && !!r?.found, sentence: r?.sentence ?? "" }; });
    } else if (cand.same) cand.facts = cand.facts.map((f) => ({ ...f, found: false }));
    cands.push(cand);
  }
  const { facts, dropped } = acceptFacts(cands);
  out.candidates = cands.map((c) => ({ url: c.url, name: c.name, same: !!c.same, reason: c.sameReason }));
  out.dropped = dropped.slice(0, 30);
  out.status = facts.length ? `${facts.length} bilgi doğrulandı` : cands.some((c) => c.same) ? "aynı ürün bulundu, doğrulanan bilgi yok" : "aynı ürün doğrulanamadı";
  // Başka ilanın markası açıklamaya giremez: aday adlarının ilk kelimesi (bizim metinde yoksa)
  out.foreignNames = [...new Set(cands.map((c) => c.name.split(/\s+/)[0]).filter((w) => w && w.length >= 3 && !norm(`${p.title} ${p.description}`).includes(` ${norm(w).trim()} `)))].slice(0, 6);
  return { facts, research: out };
}
