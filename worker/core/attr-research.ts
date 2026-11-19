// Aynı ürünün başka satıcı ilanlarından ÖZELLİK araştırması (K 19.11). İşi diğer yapay zekâ yapar (Gemini + Google araması + sayfa okuma),
// kabul kararını kural verir (worker/core/attr-consensus.ts). Aşamalar:
//  0) Ürünün doğrulanabilir kimliği yoksa (geçerli GTIN ya da model kodu) hiç arama yapılmaz: yalnızca fotoğrafla eşleşme K kuralına göre yetmez.
//  1) Ara: GTIN / model kodu + başlık; aday ilanlar (farklı satıcılar), sayfadaki barkod / model kodu, istenen özelliklerin değeri ve alıntısı.
//  2) Doğrula (her aday, ayrı çağrı, sayfa okunur): barkod / model kodu sayfada aynen geçiyor mu, her alıntı sayfada geçiyor mu (cümle aynen).
//  3) Model kodu eşleşmesinde ayrıca fotoğraf karşılaştırması (bizim görsel + adayın görseli) "evet" olmalı.
// Müşteri verisi gönderilmez: yalnızca ürün başlığı, barkod, model kodu, özellik adları/izinli değerleri ve ürün görseli.
import { geminiCall, parseLooseJson, type GeminiPart } from "./gemini.ts";
import { imagePart, realUrl } from "./research.ts";
import { isGtin, modelCodes, type AttrCand, type WantAttr } from "./attr-consensus.ts";
import { nrm } from "./contradictions.ts";

const SEARCH = (title: string, gtins: string[], codes: string[], want: { name: string; values: string[] }[]) => `Bu ürünün BİREBİR AYNISINI satan ilanları ara (Trendyol, Hepsiburada, Amazon.com.tr, n11, üretici sitesi).
Ürün: "${title}"${gtins.length ? `\nBarkod (GTIN): ${gtins.join(", ")}` : ""}${codes.length ? `\nModel kodu: ${codes.join(", ")}` : ""}
Kurallar:
- Yalnızca barkodu ya da model kodu sayfada AYNEN yazan ilanları ver. Benzer ürün verme. En fazla 4 ilan, mümkünse farklı satıcılar.
- Her ilan için: url, satıcı adı (seller), sayfada yazan barkod (page_barcode) ve model kodu (page_model), ana ürün görselinin doğrudan adresi (image_url).
- Her ilanı OKU; aşağıdaki özelliklerin değerini sayfadan al ve geçtiği ifadeyi AYNEN alıntıla (quote). Sayfada yazmıyorsa o özelliği yazma. Tahmin etme.
${want.map((w) => `  - ${w.name}${w.values.length <= 40 ? ` (olası değerler: ${w.values.join(" | ")})` : ""}`).join("\n")}
Sadece JSON: {"candidates":[{"url":"","seller":"","page_barcode":"","page_model":"","image_url":"","attrs":[{"name":"","value":"","quote":""}]}]}`;

const VERIFY = (url: string, ids: string[], quotes: string[]) => `Bu sayfayı oku: ${url}
1) Şu kimliklerden hangileri sayfada AYNEN yazıyor? ${ids.map((x) => `«${x}»`).join(", ") || "(yok)"} — yazanı ve geçtiği ifadeyi ver.
2) Aşağıdaki alıntıların her biri sayfada (ürün bilgileri, özellikler, açıklama) geçiyor mu? Geçiyorsa sayfadaki cümleyi AYNEN kopyala; geçmiyorsa found:false.
${quotes.map((q, i) => `${i + 1}. «${q}»`).join("\n") || "(alıntı yok)"}
3) Satıcı adı nedir?
Sadece JSON: {"ids":[{"id":"","found":true,"text":""}],"results":[{"i":1,"found":true,"sentence":""}],"seller":""}`;

const SAME = (ours: string, theirs: string) => `İki ürün fotoğrafı: 1. bizim ürün ("${ours}"), 2. başka ilan ("${theirs}"). BİREBİR AYNI ürün modeli mi? Şekil, renk, parça,
düğme/detay ve üzerindeki yazılar aynı olmalı; arka plan ve marka etiketi önemsiz. Emin değilsen "emin_degil". Sadece JSON: {"same":"evet|hayir|emin_degil","differences":[]}`;

export type ResearchOut = { cands: AttrCand[]; status: string; calls: number; detail: { url: string; seller?: string; matchKind: string; why: string }[] };

export async function researchAttributes(p: { title: string; image_url: string | null; barcodes: string[]; attrsText?: string }, want: WantAttr[], o: { maxCands?: number } = {}): Promise<ResearchOut> {
  const gtins = [...new Set(p.barcodes.filter(isGtin))].slice(0, 3);
  const codes = modelCodes(p.title, p.attrsText ?? "");
  const out: ResearchOut = { cands: [], status: "", calls: 0, detail: [] };
  if (!gtins.length && !codes.length) return { ...out, status: "doğrulanabilir kimlik yok (geçerli GTIN ya da model kodu): araştırılmadı" };
  const names = [...new Map(want.map((w) => [w.name, { name: w.name, values: w.values }])).values()].slice(0, 10);
  if (!names.length) return { ...out, status: "doldurulacak özellik yok" };
  const s = await geminiCall({ parts: [{ text: SEARCH(p.title, gtins, codes, names) }], tools: ["google_search", "url_context"] });
  out.calls++;
  const found = (parseLooseJson<{ candidates: any[] }>(s.text)?.candidates ?? []).slice(0, o.maxCands ?? 4);
  if (!found.length) return { ...out, status: "aynı ürün bulunamadı" };
  const ours: GeminiPart | null = p.image_url ? await imagePart(p.image_url) : null;
  const seen = new Set<string>();
  for (const c of found) {
    const url = await realUrl(String(c.url ?? ""));
    if (!/^https?:\/\//.test(url) || /vertexaisearch/.test(url) || seen.has(url)) continue;
    seen.add(url);
    const attrs = (Array.isArray(c.attrs) ? c.attrs : []).slice(0, 12).map((a: any) => ({ name: String(a?.name ?? "").slice(0, 60), value: String(a?.value ?? "").slice(0, 80), quote: String(a?.quote ?? "").slice(0, 300) }));
    const ids = [...gtins, ...codes];
    const v = await geminiCall({ parts: [{ text: VERIFY(url, ids, attrs.map((a: any) => a.quote)) }], tools: ["url_context"] });
    out.calls++;
    const r = parseLooseJson<{ ids?: { id: string; found: boolean; text: string }[]; results?: { i: number; found: boolean; sentence: string }[]; seller?: string }>(v.text);
    const pageOk = v.urls.some((u) => u.ok);
    // Kimlik sayfada: modelin "found" demesi yetmez, verdiği ifade kimliği aynen içermeli
    const idHit = (id: string) => !!r?.ids?.some((x) => x.found && nrm(x.text).includes(nrm(id).trim()) && nrm(id).trim().length >= 4);
    let matchKind: AttrCand["matchKind"] = "none", why = "";
    if (!pageOk) why = "sayfa okunamadı";
    else if (gtins.some(idHit)) { matchKind = "barcode"; why = "barkod sayfada"; }
    else if (codes.some(idHit)) {
      const theirs = c.image_url ? await imagePart(String(c.image_url)) : null;
      if (ours && theirs) {
        const sv = parseLooseJson<{ same: string; differences: string[] }>((await geminiCall({ parts: [ours, theirs, { text: SAME(p.title, String(c.seller ?? "")) }] })).text);
        out.calls++;
        const diff = (sv?.differences ?? []).filter((d) => d && !/yok|none|fark yok/i.test(d));
        if (sv?.same === "evet" && !diff.length) { matchKind = "model+photo"; why = "model kodu sayfada + fotoğraf aynı"; }
        else { matchKind = "photo"; why = `model kodu var, fotoğraf doğrulanmadı (${sv?.same ?? "yanıt yok"})`; }
      } else why = "model kodu var, fotoğraf karşılaştırılamadı";
    } else why = "barkod / model kodu sayfada bulunamadı";
    const cand: AttrCand = { url, seller: String(r?.seller || c.seller || "").slice(0, 80) || undefined, matchKind,
      attrs: attrs.map((a: any, i: number) => { const x = r?.results?.find((y) => Number(y.i) === i + 1); return { ...a, found: pageOk && !!x?.found, sentence: String(x?.sentence ?? "").slice(0, 400) }; }) };
    out.cands.push(cand);
    out.detail.push({ url, seller: cand.seller, matchKind, why });
  }
  out.status = `${out.cands.length} aday, ${out.cands.filter((c) => c.matchKind === "barcode" || c.matchKind === "model+photo").length} doğrulandı`;
  return out;
}
