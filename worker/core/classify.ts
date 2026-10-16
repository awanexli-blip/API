// Başlıktan kategori tahmini: mağazadaki mevcut ilanlardan (başlık + XML kategorisi -> pazaryeri kategorisi) öğrenir,
// yeni ürüne en benzer 5 ilanın kategorisine benzerlik ağırlıklı oy verir.
// Kelime kökü yerine ilk 5 harf (Türkçe ekler için kaba kök). 18 bin Trendyol ürününde ölçüm (16.10):
// tümünde %80 isabet, "yüksek" güvende (%58 ürün) %95 isabet.

export interface Example { title: string; xmlCategory: string; categoryId: string; categoryName: string; commission?: number }
export interface Prediction {
  categoryId: string; categoryName: string;
  confidence: number;      // kazanan kategorinin oy payı (0-1)
  similarity: number;      // en benzer ilanın benzerliği (0-1)
  level: "yuksek" | "orta" | "dusuk";
  commission?: number;     // aynı kategorideki komşuların en yüksek komisyonu (güvenli taraf)
  nearest: string;         // en benzer mevcut ilanın başlığı
}

const lower = (s: string) => s.replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr");
const words = (s: string) => (lower(s).match(/[0-9a-zçğıöşü]+/g) ?? []).filter((w) => w.length > 1).map((w) => w.slice(0, 5));

function tokens(title: string, xmlCategory: string): string[] {
  const leaf = xmlCategory.split(">>>").pop() ?? "";
  return [...words(title), ...words(leaf).map((w) => "x:" + w)];
}

export function buildClassifier(examples: Example[], k = 5) {
  const docs = examples.map((e) => tokens(e.title, e.xmlCategory));
  const N = docs.length || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log(N / (1 + (df.get(t) ?? 0)));
  const vec = (d: string[]) => {
    const c = new Map<string, number>();
    for (const t of d) c.set(t, (c.get(t) ?? 0) + 1);
    const v = new Map<string, number>();
    let s = 0;
    for (const [t, n] of c) { const a = (1 + Math.log(n)) * (df.has(t) ? idf(t) : Math.log(N)); v.set(t, a); s += a * a; }
    s = Math.sqrt(s) || 1;
    for (const [t, a] of v) v.set(t, a / s);
    return v;
  };
  const inv = new Map<string, [number, number][]>();
  docs.forEach((d, i) => { for (const [t, a] of vec(d)) { let l = inv.get(t); if (!l) inv.set(t, (l = [])); l.push([i, a]); } });
  const tooCommon = Math.max(3000, N * 0.15);

  return function predict(title: string, xmlCategory: string): Prediction | null {
    const scores = new Map<number, number>();
    for (const [t, a] of vec(tokens(title, xmlCategory))) {
      const l = inv.get(t);
      if (!l || l.length > tooCommon) continue;
      for (const [j, b] of l) scores.set(j, (scores.get(j) ?? 0) + a * b);
    }
    const top = [...scores].sort((x, y) => y[1] - x[1]).slice(0, k);
    if (!top.length) return null;
    const votes = new Map<string, number>();
    let total = 0;
    for (const [j, s] of top) { votes.set(examples[j].categoryId, (votes.get(examples[j].categoryId) ?? 0) + s); total += s; }
    const [catId, score] = [...votes].sort((x, y) => y[1] - x[1])[0];
    const confidence = total ? score / total : 0;
    const similarity = top[0][1];
    const same = top.map(([j]) => examples[j]).filter((e) => e.categoryId === catId);
    const comms = same.map((e) => e.commission).filter((c): c is number => c != null && c > 0);
    return {
      categoryId: catId, categoryName: same[0].categoryName, confidence, similarity,
      level: confidence >= 0.8 && similarity >= 0.5 ? "yuksek" : confidence >= 0.6 && similarity >= 0.35 ? "orta" : "dusuk",
      commission: comms.length ? Math.max(...comms) : undefined,
      nearest: examples[top[0][0]].title,
    };
  };
}
