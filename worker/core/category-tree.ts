// Kategori ağacından başlığa göre kategori bulma (sınıflandırıcı emin değilse son çare).
// Trendyol gibi ürünün adına bakar: yaprak kategori adının tüm kelimeleri başlıkta geçiyorsa aday olur
// ("Bluetooth Hoparlör" <- "Ahşap Bluetooth Hoparlör 1800 Mah"); en uzun/özgül ad kazanır, tedarikçi kategori yolu ve mağazada kullanılan kategoriler ek puan.
// Kelime eşleşmesi: kısa kelime tam kök, uzun kelimede son 2 harf ek payı ("hoparlörü" = "hoparlör", ama "süpürgesi" ≠ "süpürgelik").
// "-siz/-sız" ekli kelime eşleşmez ("kilitsiz" ≠ "kilit"). Saf fonksiyon, test: category-tree.test.ts.

export type TreeNode = { id: number; name: string; subCategories?: TreeNode[] };
export type Leaf = { id: string; name: string; path: string[] };

const lo = (s: string) => s.replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr");
const STOP = new Set(["ve", "ile", "için", "diğer"]);
const wordsOf = (s: string) => lo(s).match(/[0-9a-zçğıöşü]+/g) ?? [];
const keyOf = (w: string) => w.slice(0, w.length <= 5 ? w.length : Math.max(5, w.length - 2));
const negated = (w: string) => /(siz|sız|suz|süz)$/.test(w);

export function leavesOf(tree: TreeNode[]): Leaf[] {
  const out: Leaf[] = [];
  const walk = (n: TreeNode, path: string[]) => {
    const p = [...path, n.name];
    if (!n.subCategories?.length) out.push({ id: String(n.id), name: n.name, path: p });
    for (const c of n.subCategories ?? []) walk(c, p);
  };
  for (const n of tree) walk(n, []);
  return out;
}

export function buildLeafMatcher(leaves: Leaf[], known: Set<string> = new Set()) {
  const idx = leaves.map((l) => ({
    l,
    need: [...new Set(wordsOf(l.name).filter((w) => !STOP.has(w)).map(keyOf))],
    path: new Set(l.path.slice(0, -1).flatMap(wordsOf).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.slice(0, 5))),
    other: /^diğer/i.test(l.name),
  })).filter((x) => x.need.length > 0);
  return function match(title: string, supplierCategory = ""): { categoryId: string; categoryName: string; score: number } | null {
    const tw = wordsOf(title).filter((w) => !negated(w));
    const t5 = new Set(tw.filter((w) => w.length > 2).map((w) => w.slice(0, 5)));
    const sup = new Set(wordsOf(supplierCategory).map((w) => w.slice(0, 5)));
    let best: { x: (typeof idx)[number]; score: number } | null = null;
    for (const x of idx) {
      // Kısa kelime (≤3 harf: "oto", "led") tam kelime olmalı; uzun kelimede en fazla 4 harf ek ("lambası", "hoparlörü")
      if (!x.need.every((k) => tw.some((w) => (k.length <= 3 ? w === k : w.startsWith(k) && w.length - k.length <= 4)))) continue;
      let score = x.need.reduce((s, k) => s + k.length, 0) + (x.need.length - 1) * 3;
      for (const w of x.path) if (sup.has(w) || t5.has(w)) score += 1;
      if (known.has(x.l.id)) score += 3;
      if (x.other) score -= 4;
      if (!best || score > best.score) best = { x, score };
    }
    return best && best.score >= 5 ? { categoryId: best.x.l.id, categoryName: best.x.l.name, score: best.score } : null;
  };
}

// Tedarikçi kategori yolundan pazaryeri kategorisi (Toptancım yolları Hepsiburada ağacına çok benzer: "Anne, Bebek, Çocuk >>> Oyuncak >>> Eğitici Oyuncak").
// 1) Yolun son (yoksa sondan bir önceki) adımıyla aynı adlı yaprak (kelime kökleriyle; "Perukları" = "Peruğu" değil, tam kök eşitliği);
//    birden çoksa üst yol kelimeleri en çok örtüşen. 2) Son adım ağaçta ara kategori ise: altındaki yapraklardan başlıkla eşleşen, yoksa "Diğer ...".
// "Diğer" atılmaz: "Diğer Oyuncak Araçlar" yaprağı "Oyuncak Araçlar" ara kategorisiyle aynı ad sayılmasın
const stemKey = (s: string) => wordsOf(s).filter((w) => w !== "ve" && w !== "ile" && w !== "için").map(keyOf).join(" ");
export function buildPathMatcher(leaves: Leaf[]) {
  const byName = new Map<string, Leaf[]>(), byAncestor = new Map<string, Leaf[]>();
  for (const l of leaves) {
    const k = stemKey(l.name);
    if (k) byName.set(k, [...(byName.get(k) ?? []), l]);
    for (const a of new Set(l.path.slice(0, -1).map(stemKey).filter(Boolean))) byAncestor.set(a, [...(byAncestor.get(a) ?? []), l]);
  }
  const sub = new Map<string, ReturnType<typeof buildLeafMatcher>>();
  return function match(supplierCategory: string, title: string): { categoryId: string; categoryName: string; score: number } | null {
    const segs = String(supplierCategory ?? "").split(/>{1,3}|\//).map((s) => s.trim()).filter(Boolean);
    if (!segs.length) return null;
    const upper = new Set(segs.flatMap(wordsOf).map((w) => w.slice(0, 5)));
    const best = (cands: Leaf[]) => cands.map((l) => ({ l, o: l.path.slice(0, -1).flatMap(wordsOf).filter((w) => upper.has(w.slice(0, 5))).length })).sort((a, b) => b.o - a.o)[0].l;
    for (const [i, seg] of [[0, segs[segs.length - 1]], [1, segs[segs.length - 2]]] as [number, string | undefined][]) {
      if (!seg) continue;
      const k = stemKey(seg);
      const exact = byName.get(k);
      if (exact?.length) { const l = best(exact); return { categoryId: l.id, categoryName: l.name, score: i ? 12 : 20 }; }
      if (i) break; // ara kategori araması yalnızca son adım için (üst adım çok geniş)
      const under = byAncestor.get(k);
      if (under?.length) {
        if (!sub.has(k)) sub.set(k, buildLeafMatcher(under));
        const hit = sub.get(k)!(title, supplierCategory);
        if (hit) return { ...hit, score: 15 };
        const other = under.find((l) => /^diğer/i.test(l.name));
        if (other) return { categoryId: other.id, categoryName: other.name, score: 8 };
      }
    }
    return null;
  };
}
