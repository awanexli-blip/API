// Tedarikçiler arası ürün eşleştirme (K 28.11, migration 104). Saf fonksiyonlar, test edilir (tests/xsup.test.ts).
// Sıkı kural: iki ürün aynı sayılır ancak
//   (a) aynı GERÇEK barkod (GTIN: yalnızca rakam, 8/12/13/14 hane) ve başlıkları en az %40 ortak sözcük içeriyorsa, ya da
//   (b) başlık imzası (sıralı, tekil, normalleştirilmiş sözcükler; en az 3 sözcük) AYNI ve ilk görsellerinin algısal özeti yakınsa
//       (pHash ya da dHash Hamming uzaklığı <= 6; 64 bit).
// Aynı tedarikçinin iki ürünü doğrudan birbirine bağlanmaz (renk/boy kardeşleri farklı görselle ayrılır), ancak ortak üyeyle aynı grupta olabilir.

const TR: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };
const STOP = new Set("ve ile icin için adet li lu lı lü 1 x cm mm ml gr kg lt set seti model yeni orjinal orijinal kaliteli uyumlu".split(" "));
export const MIN_TOKENS = 3;
export const MAX_DIST = 6;

export function tokens(title: string): string[] {
  const t = String(title ?? "").replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase().replace(/[çğıöşüâîû]/g, (c) => TR[c] ?? c);
  const out = new Set<string>();
  for (const w of t.match(/[a-z0-9]+/g) ?? []) if ((w.length > 1 || /^[2-9]$/.test(w)) && !STOP.has(w)) out.add(w); // tek haneli sayı (Mi 8 / Mi 9) model ayırır
  return [...out].sort();
}
export const sigOf = (title: string): string | null => { const t = tokens(title); return t.length >= MIN_TOKENS ? t.join(" ") : null; };

export const isGtin = (b: string | null | undefined) => /^\d+$/.test(String(b ?? "")) && [8, 12, 13, 14].includes(String(b).length);
const jaccard = (a: string[], b: string[]) => { const B = new Set(b); const i = a.filter((x) => B.has(x)).length; return i / (a.length + b.length - i || 1); };

const pop = (x: bigint) => { let n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; };
export function hamming(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b || !/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return 99;
  return pop(BigInt("0x" + a) ^ BigInt("0x" + b));
}
export const imageClose = (x: { ph?: string | null; dh?: string | null }, y: { ph?: string | null; dh?: string | null }, max = MAX_DIST) =>
  Math.min(hamming(x.ph, y.ph), hamming(x.dh, y.dh)) <= max;

export type XMember = { id: string; source: string; sku?: string; title: string; gtin?: string | null; ph?: string | null; dh?: string | null; img_url?: string | null; live?: string[] };

// Hash gerektiren aday üyeler: imzası en az iki tedarikçide geçen ve kovada en az bir üyenin pazaryerinde yayında ilanı olan kovalar
export function candidates(members: XMember[]) {
  const buckets = new Map<string, XMember[]>();
  for (const m of members) { const s = sigOf(m.title); if (s) (buckets.get(s) ?? buckets.set(s, []).get(s)!).push(m); }
  const out: { id: string; sig: string; img_url: string | null }[] = [];
  for (const [sig, ms] of buckets) {
    if (new Set(ms.map((m) => m.source)).size < 2) continue;
    if (!ms.some((m) => (m.live ?? []).length)) continue;
    for (const m of ms) out.push({ id: m.id, sig, img_url: m.img_url ?? null });
  }
  return out;
}

export function buildGroups(members: XMember[]): { id: string; group_key: string; method: string }[] {
  const parent = members.map((_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const methods = new Map<number, Set<string>>();
  const link = (a: number, b: number, method: string) => {
    const ra = find(a), rb = find(b);
    const ms = new Set([...(methods.get(ra) ?? []), ...(methods.get(rb) ?? []), method]);
    parent[ra] = rb; methods.set(rb, ms);
  };
  // (a) aynı gerçek barkod
  const byGtin = new Map<string, number[]>();
  members.forEach((m, i) => { if (isGtin(m.gtin)) (byGtin.get(m.gtin!) ?? byGtin.set(m.gtin!, []).get(m.gtin!)!).push(i); });
  for (const ids of byGtin.values()) for (let k = 1; k < ids.length; k++) {
    const a = members[ids[0]], b = members[ids[k]];
    if (a.source !== b.source && jaccard(tokens(a.title), tokens(b.title)) >= 0.4) link(ids[0], ids[k], "gtin");
  }
  // (b) aynı başlık imzası + yakın görsel
  const buckets = new Map<string, number[]>();
  members.forEach((m, i) => { const s = sigOf(m.title); if (s) (buckets.get(s) ?? buckets.set(s, []).get(s)!).push(i); });
  for (const ids of buckets.values()) {
    if (ids.length < 2 || ids.length > 60) continue; // çok büyük kova (genel başlık) şüpheli: atlanır
    for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) {
      const a = members[ids[x]], b = members[ids[y]];
      if (a.source !== b.source && imageClose(a, b)) link(ids[x], ids[y], "sig+img");
    }
  }
  const comp = new Map<number, number[]>();
  members.forEach((_, i) => { const r = find(i); (comp.get(r) ?? comp.set(r, []).get(r)!).push(i); });
  const out: { id: string; group_key: string; method: string }[] = [];
  for (const [r, ids] of comp) {
    if (ids.length < 2 || new Set(ids.map((i) => members[i].source)).size < 2) continue;
    const key = "x" + ids.map((i) => members[i].id).sort()[0].replace(/-/g, "").slice(0, 16);
    const method = [...(methods.get(find(r)) ?? [])].sort().join("+");
    for (const i of ids) out.push({ id: members[i].id, group_key: key, method });
  }
  return out;
}
