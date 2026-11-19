// Tedarikçi açıklamasındaki ÇELİŞKİLER (K 19.11: "yanlış istemiyorum, kesin olsun"). Saf fonksiyonlar, test: worker/test/contradictions.test.ts.
// K kuralları: yalnızca çelişki tedarikçi metnini değiştirir, bilgi uydurulmaz.
//  - Malzeme: başlık/kategori "316L çelik" (baz metal) iken açıklama "925 ayar / saf gümüş / 14 ayar altın" diyor -> o cümle çıkar.
//    "gümüş renk", "altın kaplama" çelişki DEĞİL (renk/kaplama). Başlığın kendisi değerli metal diyorsa ("925 ayar gümüş çivili") dokunulmaz.
//    Plastik/ahşap/cam/seramik: açıklama açıkça "Malzeme: X" / "X'ten üretilmiştir" diyor, başlık başka bir malzeme ailesi diyor, açıklama
//    başlıktaki malzemeyi hiç anmıyor -> o cümle çıkar. Deri ve kumaş: yalnızca açıklama FAZLA iddia ediyorsa (suni deri ürüne "hakiki deri").
//  - Ürün tipi: başlık "bileklik", açıklama hiç bileklik demeden "kolye" anlatıyor -> açıklama gövdesi atılır, yalnızca başlıkla çelişmeyen
//    "Ad: değer" satırları kalır (hiç kalmazsa başlık).
//  - Ölçü: açıklamadaki NNxNN(xNN) ölçüsü başlıkla ya da görselden okunan ölçüyle uyuşmuyor -> iki görsel modeli aynı ölçüyü okuduysa
//    o ölçü yazılır, okuyamadı/anlaşamadıysa ölçü cümlesi çıkar ("Ölçü: ürün görseline bakınız."). Birden çok ölçü (set: kutu + defter) varsa dokunulmaz.
// Çıkarmak bilgi kaybıdır ama yanlış bilgi değildir; değiştirmek (ölçü) yalnızca iki modelin uzlaşmasıyla.

// --- metin yardımcıları ---
const lower = (s: string) => String(s ?? "").replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr");
export const fold = (s: string) => lower(s).replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u").replace(/â/g, "a").replace(/î/g, "i").replace(/û/g, "u");
const decode = (s: string) => s.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&rsquo;|&lsquo;/gi, "'");
/** Karşılaştırma biçimi: ASCII'ye katlanmış, yalnızca harf/rakam/%, kelimeler tek boşlukla, başta ve sonda boşluk. */
export const nrm = (s: string) => ` ${fold(decode(String(s ?? "").replace(/<[^>]+>/g, " "))).replace(/[^a-z0-9%]+/g, " ").replace(/\s+/g, " ").trim()} `;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type Line = { text: string; list: boolean; sentences: string[] };
/** HTML/düz metin -> satırlar (madde mi) -> cümleler. Tedarikçi metinlerinde "Malzeme: X      Detay: Y" çok boşlukla ayrılıyor: o da satır sonu. */
export function toLines(html: string): Line[] {
  const s = decode(String(html ?? ""))
    .replace(/<\s*li[^>]*>/gi, "\n• ").replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/\s*(p|div|li|ul|ol|h[1-6]|tr)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ").replace(/\r/g, "").replace(/[ \t ]{3,}/g, "\n");
  const out: Line[] = [];
  for (const raw of s.split("\n")) {
    let t = raw.replace(/\s+/g, " ").trim();
    if (!t) continue;
    const list = /^[•·\-*–]\s*/.test(t);
    t = t.replace(/^[•·\-*–]\s*/, "").trim();
    if (!t || /^[•·\-*–.]+$/.test(t)) continue;
    const sentences = t.split(/(?<=[.!?])\s+(?=[A-ZÇĞİÖŞÜ0-9"“(])/).map((x) => x.trim()).filter(Boolean);
    out.push({ text: t, list, sentences });
  }
  return out;
}
export const allSentences = (lines: Line[]) => lines.flatMap((l) => l.sentences);

/** Satırları sınırlı HTML'e çevirir (p, ul, li): worker/core/desc-check.ts cleanHtml'den geçer. */
export function linesToHtml(lines: Line[]): string {
  const parts: string[] = [];
  let ul: string[] = [];
  const flush = () => { if (ul.length) parts.push(`<ul>${ul.join("")}</ul>`); ul = []; };
  for (const l of lines) {
    const t = l.sentences.join(" ").trim();
    if (!t) continue;
    if (l.list) ul.push(`<li>${esc(t)}</li>`); else { flush(); parts.push(`<p>${esc(t)}</p>`); }
  }
  flush();
  return parts.join("");
}

export type Finding = {
  kind: "malzeme" | "urun_tipi" | "olcu";
  action: "remove" | "replace" | "drop_body" | "note";
  sentence?: string;          // açıklamadaki cümle (aynen)
  replacement?: string;       // replace: yeni cümle
  reason: string;             // insan için neden
  evidence: string;           // başlıktaki / görseldeki dayanak
  by: "kural" | "yapay_zeka+kural" | "iki_model";
};

// --- malzeme ---
const PLATING = / (kaplama|kaplamali|kapli|plated|rengi|renk|renkli|tonu|tonlu|gorunum|gorunumlu|gorunumunde|sarisi|efekt|efektli|desen|desenli|yaldiz|yaldizli|varak) /;
const SILVER = / (925|sterling|(saf|halis|som|gercek|hakiki|katiksiz|katisiksiz) gumus|ayar gumus|gumus(ten|den)? (malzeme|malzemeden|uretil|yapil|imal)\w*) /g;
const GOLD = / ((8|9|10|14|18|22|24) ?(k|ayar|karat)|ayar altin|(saf|som|gercek|hakiki|katiksiz|katisiksiz) altin|altin(dan)? (malzeme|malzemeden|uretil|yapil|imal)\w*) /g;
const BASE_METAL = / (celik|316l|316 l|paslanmaz|pirinc|bakir|alpaka|zamak|bijuteri|titanyum|aluminyum|metal|demir) /;

/** Cümle değerli metal (gümüş/altın) İDDİA ediyor mu (kaplama/renk değil). Dönüş: eşleşen ifade ya da null. */
export function preciousClaim(sentence: string): string | null {
  const n = nrm(sentence);
  for (const re of [SILVER, GOLD]) {
    re.lastIndex = 0;
    for (const m of n.matchAll(re)) {
      const after = ` ${n.slice((m.index ?? 0) + m[0].length - 1).trim().split(" ").slice(0, 4).join(" ")} `;
      const before = ` ${n.slice(0, (m.index ?? 0) + 1).trim().split(" ").slice(-2).join(" ")} `;
      if (PLATING.test(after) || / (kaplama|kapli|plated) /.test(before)) continue;
      return m[0].trim();
    }
  }
  return null;
}

// Malzeme aileleri (katlanmış kelime kökleri). Kök kelime başında eşleşir: "plastikten", "ahsaptan".
const FAMILIES: Record<string, string[]> = {
  ahsap: ["ahsap", "tahta", "bambu", "mdf", "kontrplak"],
  plastik: ["plastik", "pvc", "abs", "polipropilen", "polietilen"],
  cam: ["cam", "borosilikat"],
  seramik: ["seramik", "porselen"],
  metal: ["metal", "celik", "paslanmaz", "aluminyum", "demir", "dokum", "pirinc", "bakir"],
};
// Görünüm niteleyicisiyle gelen malzeme ("ahşap görünümlü", "metal renkli") malzeme iddiası değil
function familiesIn(text: string): Set<string> {
  const n = nrm(text), out = new Set<string>();
  for (const [fam, stems] of Object.entries(FAMILIES)) {
    for (const m of n.matchAll(new RegExp(` (${stems.join("|")})(ten|tan|den|dan)?(?= )`, "g"))) {
      const after = ` ${n.slice((m.index ?? 0) + m[0].length).trim().split(" ").slice(0, 2).join(" ")} `;
      if (PLATING.test(after)) continue;
      if (fam === "cam" && / (cam|kristal) (efekt|gibi) /.test(after)) continue;
      out.add(fam); break;
    }
  }
  return out;
}
/** Açık malzeme ifadesi: "Malzeme: plastik", "Malzemesi ahşap", "plastikten üretilmiştir", "cam gövdeli". Ailelerin kümesi. */
export function explicitMaterials(sentence: string): Set<string> {
  const n = nrm(sentence), out = new Set<string>();
  for (const [fam, stems] of Object.entries(FAMILIES)) {
    const st = stems.join("|");
    const p1 = new RegExp(` (malzeme|malzemesi|materyal|materyali|govde|govdesi|uretim malzemesi|hammadde|hammaddesi)( \\w+){0,2} (${st})(?! (gorunum|gorunumlu|desen|desenli|renk|renkli|rengi|efekt|efektli|kaplama|kaplamali|baski|baskili))`);
    const p2 = new RegExp(` (${st})(ten|tan|den|dan)? (malzemeden |malzeme ile |govdeli |govdeden )?(uretil|yapil|imal)\\w* `);
    if (p1.test(n) || p2.test(n)) out.add(fam);
  }
  return out;
}

const FAKE_LEATHER = / (suni deri|pu deri|deri gorunumlu|vegan deri|yapay deri|sentetik deri|eko deri|ekoderi|polyuretan) /;
const REAL_LEATHER = / (hakiki deri|gercek deri|%100 deri|100 deri|dana derisi|keci derisi|kuzu derisi|inek derisi|sigir derisi|naturel deri) /;
const COTTON = / (pamuk|pamuklu|cotton) /, POLY = / (polyester|polyesterli) /;

export function findMaterialContradictions(title: string, category: string, lines: Line[]): Finding[] {
  const out: Finding[] = [];
  const nt = nrm(title), nc = nrm(category);
  const sents = allSentences(lines);
  // 1) Baz metal ürüne değerli metal iddiası
  const titleBase = BASE_METAL.exec(nt)?.[1] ?? (/ bijuteri /.test(nc) ? "bijuteri (kategori)" : null);
  if (titleBase && !preciousClaim(title)) {
    for (const s of sents) {
      const c = preciousClaim(s);
      if (c) out.push({ kind: "malzeme", action: "remove", sentence: s, reason: `başlık ${titleBase} diyor, açıklama değerli metal iddia ediyor ("${c}")`, evidence: title, by: "kural" });
    }
  }
  // 2) Deri: suni deri ürüne hakiki deri iddiası
  if (FAKE_LEATHER.test(nt) && !REAL_LEATHER.test(nt)) {
    for (const s of sents) if (REAL_LEATHER.test(nrm(s))) out.push({ kind: "malzeme", action: "remove", sentence: s, reason: "başlık suni/PU deri diyor, açıklama hakiki deri iddia ediyor", evidence: title, by: "kural" });
  }
  // 3) Kumaş: %100 pamuk / %100 polyester başlıkla çelişiyorsa
  for (const s of sents) {
    const n = nrm(s);
    if (/ %?100 (pamuk|cotton)/.test(n) && POLY.test(nt) && !COTTON.test(nt)) out.push({ kind: "malzeme", action: "remove", sentence: s, reason: "başlık polyester diyor, açıklama %100 pamuk diyor", evidence: title, by: "kural" });
    else if (/ %?100 polyester/.test(n) && COTTON.test(nt) && !POLY.test(nt)) out.push({ kind: "malzeme", action: "remove", sentence: s, reason: "başlık pamuk diyor, açıklama %100 polyester diyor", evidence: title, by: "kural" });
  }
  // 4) Plastik / ahşap / cam / seramik / metal: başlıkta TEK aile, açıklamada başka ailenin açık malzeme ifadesi, başlıktaki aile açıklamada açıkça yok
  const tf = familiesIn(title);
  if (tf.size === 1) {
    const [A] = [...tf];
    const descExplicit = new Set(sents.flatMap((s) => [...explicitMaterials(s)]));
    const descMentionsA = sents.some((s) => familiesIn(s).has(A));
    if (!descExplicit.has(A) && !descMentionsA) {
      for (const s of sents) {
        const ex = [...explicitMaterials(s)].filter((f) => f !== A);
        // metal ailesinde baz metal başlık + metal cümle zaten aynı aile; burada yalnızca farklı aile
        if (ex.length) out.push({ kind: "malzeme", action: "remove", sentence: s, reason: `başlık ${A} diyor, açıklama malzemeyi ${ex.join("/")} olarak yazıyor`, evidence: title, by: "kural" });
      }
    }
  }
  // Aynı cümle birden çok kez çıkmasın
  const seen = new Set<string>();
  return out.filter((f) => (seen.has(f.sentence!) ? false : (seen.add(f.sentence!), true)));
}

// --- ürün tipi ---
const TYPE_FAMILIES: Record<string, string[]> = {
  taki: ["bileklik", "kolye", "kupe", "yuzuk", "halhal", "bros", "sahmeran"],
  canta: ["canta", "cuzdan", "kartlik"],
  ayakkabi: ["terlik", "ayakkabi", "cizme", "sandalet", "babet"],
  giyim: ["tisort", "gomlek", "elbise", "pantolon", "etek", "kazak", "hirka", "mont", "ceket", "esofman", "pijama"],
  mutfak: ["kupa", "bardak", "tabak", "kase", "tencere", "tava", "caydanlik", "termos"],
};
const typesIn = (text: string) => {
  const n = nrm(text), found: { fam: string; stem: string; count: number }[] = [];
  for (const [fam, stems] of Object.entries(TYPE_FAMILIES)) for (const st of stems) {
    const count = [...n.matchAll(new RegExp(` ${st}`, "g"))].length;
    if (count) found.push({ fam, stem: st, count });
  }
  return found;
};
export function findTypeContradiction(title: string, lines: Line[]): Finding | null {
  const tt = typesIn(title);
  if (tt.length !== 1) return null; // tip yok ya da set ("kolye küpe seti")
  if (/ (set|seti|takim|takimi|kombin|ikili|uclu|2 li|3 lu) /.test(nrm(title))) return null;
  const T = tt[0];
  const sents = allSentences(lines);
  if (!sents.length) return null;
  const dt = typesIn(sents.join(" "));
  if (dt.some((x) => x.stem === T.stem)) return null;               // açıklama başlıktaki tipi anıyor
  const others = dt.filter((x) => x.fam === T.fam && x.stem !== T.stem);
  const first = typesIn(sents[0]).filter((x) => x.fam === T.fam && x.stem !== T.stem);
  const total = others.reduce((a, x) => a + x.count, 0);
  if (!others.length || (total < 2 && !first.length)) return null;
  return { kind: "urun_tipi", action: "drop_body", reason: `başlık "${T.stem}" diyor, açıklama başka ürünü anlatıyor (${others.map((x) => x.stem).join(", ")})`, evidence: title, by: "kural" };
}

// --- ölçü ---
export type Dims = { values: number[]; raw: string }; // santimetre
const DIM_RE = /(\d+(?:[.,]\d+)?)\s*(cm|mm|m)?\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*(cm|mm|m)?(?:\s*[x×*]\s*(\d+(?:[.,]\d+)?))?\s*(cm|mm|mt|metre|m|santim|santimetre)?(?![a-zçğıöşü])/gi;
const LABEL_RE = /(ölçü|ölçüsü|ölçüleri|ölçülerde|ölçüsünde|ölçülerinde|olcu|boyut|boyutu|boyutları|ebat|ebatı|ebatları|genişlik|yükseklik|uzunluk|en x boy|size)\s*[:=]?\s*[^.]{0,25}$/i;
const toNum = (s: string) => Number(s.replace(",", "."));
const unitMul = (u?: string) => (!u ? null : /^mm$/i.test(u) ? 0.1 : /^(m|mt|metre)$/i.test(u) ? 100 : 1);
/** Metindeki ölçü ifadeleri (birim ya da önünde "ölçü/boyut/ebat" etiketi zorunlu: "10x40 dürbün", "2x" sayılmaz). Değerler cm. */
export function dimStatements(text: string): Dims[] {
  const s = decode(String(text ?? "").replace(/<[^>]+>/g, " "));
  const out: Dims[] = [];
  for (const m of s.matchAll(DIM_RE)) {
    const unit = m[6] ?? m[4] ?? m[2];
    const before = s.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0);
    if (!unit && !LABEL_RE.test(before)) continue;
    const mul = unitMul(unit) ?? 1;
    const vals = [m[1], m[3], m[5]].filter(Boolean).map((v) => Math.round(toNum(v!) * mul * 100) / 100);
    if (vals.some((v) => !(v > 0) || v > 100000)) continue;
    out.push({ values: vals, raw: m[0].trim() });
  }
  return out;
}
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.15, 0.03 * Math.max(a, b));
/** Küçük küme büyüğün alt kümesi mi (sıra önemsiz, çoklu küme): 18x17 ile 18x17x4 tutarlı; 10x10x10 ile 13x15x20 değil. */
export function dimsConsistent(a: number[], b: number[]): boolean {
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  const pool = [...l];
  for (const x of s) { const i = pool.findIndex((y) => close(x, y)); if (i < 0) return false; pool.splice(i, 1); }
  return true;
}
export const dimsEqual = (a: number[], b: number[]) => a.length === b.length && dimsConsistent(a, b);
const uniqDims = (ds: Dims[]) => ds.filter((d, i) => ds.findIndex((e) => dimsEqual(e.values, d.values)) === i);
export const fmtDims = (v: number[]) => `${v.map((x) => String(Math.round(x * 10) / 10).replace(".", ",")).join(" x ")} cm`;

/** Görsel okuması: model başına ölçü listesi (boş = görselde yazı yok, null = okunamadı / hata). */
export type DimReads = { a: Dims[] | null; b: Dims[] | null; models: [string, string] };
export function resolveDimensions(lines: Line[], title: string, reads: DimReads | null): Finding[] {
  const sents = allSentences(lines);
  const stmts = uniqDims(sents.flatMap((s) => dimStatements(s)));
  if (stmts.length !== 1) return []; // ölçü yok ya da birden çok (set / kutu + ürün): dokunulmaz
  const d = stmts[0];
  const targets = sents.filter((s) => dimStatements(s).some((x) => dimsEqual(x.values, d.values)));
  const titleDims = uniqDims(dimStatements(title));
  const titleConflict = titleDims.length > 0 && !titleDims.some((t) => dimsConsistent(t.values, d.values));
  const a = reads?.a ?? null, b = reads?.b ?? null;
  const agreed = a && b && a.length === 1 && b.length === 1 && dimsEqual(a[0].values, b[0].values) ? a[0] : null;
  const anyRead = [...(a ?? []), ...(b ?? [])];
  const imageConflict = anyRead.length > 0 && !anyRead.some((x) => dimsConsistent(x.values, d.values));
  const out: Finding[] = [];
  if (agreed) {
    if (dimsConsistent(agreed.values, d.values)) {
      if (titleConflict) out.push({ kind: "olcu", action: "note", reason: `başlıktaki ölçü (${titleDims.map((t) => t.raw).join(", ")}) görselle uyuşmuyor; başlık değiştirilmez`, evidence: `görsel: ${agreed.raw}`, by: "iki_model" });
      return out;
    }
    for (const s of targets) out.push({ kind: "olcu", action: "replace", sentence: s, replacement: s.replace(d.raw, fmtDims(agreed.values)),
      reason: `açıklamadaki ölçü (${d.raw}) görseldekiyle uyuşmuyor; iki model görselde aynı ölçüyü okudu`, evidence: `${reads!.models[0]}: ${a![0].raw} · ${reads!.models[1]}: ${b![0].raw}`, by: "iki_model" });
    if (titleConflict && !titleDims.some((t) => dimsConsistent(t.values, agreed.values))) out.push({ kind: "olcu", action: "note", reason: "başlıktaki ölçü de görselle uyuşmuyor; başlık değiştirilmez", evidence: titleDims.map((t) => t.raw).join(", "), by: "iki_model" });
    return out;
  }
  if (!titleConflict && !imageConflict) return [];
  const why = titleConflict ? `başlıktaki ölçüyle (${titleDims.map((t) => t.raw).join(", ")}) uyuşmuyor` : "görselden okunan ölçüyle uyuşmuyor";
  const ev = `${titleConflict ? `başlık: ${titleDims.map((t) => t.raw).join(", ")}` : ""}${imageConflict ? `${titleConflict ? " · " : ""}görsel: ${reads!.models[0]}=${a ? a.map((x) => x.raw).join("|") || "yazı yok" : "okunamadı"}, ${reads!.models[1]}=${b ? b.map((x) => x.raw).join("|") || "yazı yok" : "okunamadı"}` : ""}`;
  for (const s of targets) out.push({ kind: "olcu", action: "remove", sentence: s, reason: `açıklamadaki ölçü (${d.raw}) ${why}; iki model görselde aynı ölçüyü okuyamadı, ölçü çıkarıldı`, evidence: ev, by: titleConflict ? "kural" : "iki_model" });
  return out;
}

// --- yapay zekâ önerisi + kural onayı ---
export type AiContra = { kind?: string; quote?: string; title_term?: string; desc_term?: string };
/** İşçi modelin önerdiği malzeme çelişkisi yalnızca kural da doğrularsa kabul: alıntı açıklamada aynen var, cümle başka bir malzeme
 *  ailesini AÇIKÇA iddia ediyor (ya da baz metal başlığa değerli metal), başlık o aileyi anmıyor, başlıkta tek aile var. */
export function confirmAiContradiction(ai: AiContra, title: string, category: string, lines: Line[]): Finding | null {
  const q = nrm(String(ai.quote ?? ""));
  if (q.trim().length < 6) return null;
  const sentence = allSentences(lines).find((s) => nrm(s).includes(q) || (q.includes(nrm(s)) && nrm(s).trim().length > 15));
  if (!sentence) return null;
  if (!/malzeme|material/i.test(String(ai.kind ?? ""))) return null;
  const nt = nrm(title);
  const tBase = BASE_METAL.test(nt) || / bijuteri /.test(nrm(category));
  const c = preciousClaim(sentence);
  if (c && tBase && !preciousClaim(title)) return { kind: "malzeme", action: "remove", sentence, reason: `başlık baz metal diyor, açıklama değerli metal iddia ediyor ("${c}")`, evidence: title, by: "yapay_zeka+kural" };
  const tf = familiesIn(title);
  if (tf.size !== 1) return null;
  const [A] = [...tf];
  const ex = [...explicitMaterials(sentence)].filter((f) => f !== A);
  if (!ex.length || explicitMaterials(sentence).has(A)) return null;
  return { kind: "malzeme", action: "remove", sentence, reason: `başlık ${A} diyor, açıklama malzemeyi ${ex.join("/")} olarak yazıyor`, evidence: title, by: "yapay_zeka+kural" };
}

// --- uygula ---
export type FixResult = { changed: boolean; html: string; text: string; findings: Finding[] };
/** Bulguları açıklamaya uygular: remove -> cümle çıkar, replace -> cümle değişir, drop_body -> yalnızca başlıkla çelişmeyen "Ad: değer" satırları. */
export function applyFindings(description: string, title: string, findings: Finding[]): FixResult {
  const lines = toLines(description);
  const acts = findings.filter((f) => f.action !== "note");
  if (!acts.length) return { changed: false, html: "", text: "", findings };
  let out: Line[];
  const drop = acts.find((f) => f.action === "drop_body");
  if (drop) {
    const wrong = typesIn(allSentences(lines).join(" ")).map((x) => x.stem);
    const titleType = typesIn(title).map((x) => x.stem);
    const bad = wrong.filter((w) => !titleType.includes(w));
    out = lines.filter((l) => /^[^:]{2,30}:\s*\S/.test(l.text) && !bad.some((w) => nrm(l.text).includes(` ${w}`)))
      .map((l) => ({ ...l, list: true }));
    if (!out.length) out = [{ text: title, list: false, sentences: [title] }];
  } else out = lines;
  const rm = new Set(acts.filter((f) => f.action === "remove").map((f) => f.sentence));
  const rep = new Map(acts.filter((f) => f.action === "replace").map((f) => [f.sentence, f.replacement!]));
  let removedDims = false;
  out = out.map((l) => ({ ...l, sentences: l.sentences.flatMap((s) => {
    if (rm.has(s)) { if (acts.some((f) => f.kind === "olcu" && f.action === "remove" && f.sentence === s)) removedDims = true; return []; }
    return [rep.get(s) ?? s];
  }) })).filter((l) => l.sentences.length);
  if (removedDims) out.push({ text: "Ölçü: ürün görseline bakınız.", list: false, sentences: ["Ölçü: ürün görseline bakınız."] });
  if (!out.length) out = [{ text: title, list: false, sentences: [title] }];
  const html = linesToHtml(out);
  return { changed: true, html, text: out.map((l) => l.sentences.join(" ")).join("\n"), findings };
}

/** Tek ürün için kurallı bulgular (görsel okuması ve yapay zekâ önerileri dışarıdan verilir). */
export function detectAll(p: { title: string; category?: string | null; description: string }, extra: { dimReads?: DimReads | null; ai?: AiContra[] } = {}): Finding[] {
  const lines = toLines(p.description);
  const f: Finding[] = [];
  const type = findTypeContradiction(p.title, lines);
  if (type) f.push(type);
  f.push(...findMaterialContradictions(p.title, p.category ?? "", lines));
  for (const a of extra.ai ?? []) {
    const c = confirmAiContradiction(a, p.title, p.category ?? "", lines);
    if (c && !f.some((x) => x.sentence === c.sentence)) f.push(c);
  }
  if (!type) for (const d of resolveDimensions(lines, p.title, extra.dimReads ?? null)) if (!f.some((x) => x.sentence && x.sentence === d.sentence)) f.push(d);
  return f;
}
/** Görsel okuması gerekiyor mu: açıklamada tek bir ölçü ifadesi var (yoksa ya da set ise model çağrılmaz). */
export function needsDimRead(description: string): Dims | null {
  const st = uniqDims(allSentences(toLines(description)).flatMap((s) => dimStatements(s)));
  return st.length === 1 ? st[0] : null;
}
