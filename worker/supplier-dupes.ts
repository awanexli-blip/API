// Tedarikçiler arası birebir aynı ürünler (K 16.11). Salt okunur ürün verisi -> product_dupes tablosu + CSV rapor.
//   node --experimental-strip-types worker/supplier-dupes.ts [--apply] [--limit-pairs N]
// Aday: farklı tedarikçilerden, başlık sözcük örtüşmesi (Jaccard >= 0.5) olan aktif + stoklu ürünler. Onay: ana görsel dHash Hamming <= 6
// (başlık tek başına yanıltıyordu: Çerçici kapı zili örneği). Grup: birleşim-bul. En ucuz: stoklu, KDV dahil maliyeti en düşük.
// Görsel parmak izleri önbellekte (/var/lib/trentakip/dupes-hash.json) tutulur; ikinci çalıştırma hızlıdır.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import sharp from "sharp";
import { env, readAll } from "./core/util.ts";

const APPLY = process.argv.includes("--apply");
const LIMIT = Number(process.argv[process.argv.indexOf("--limit-pairs") + 1]) || 0;
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const CACHE = process.env.DUPES_HASH_FILE || "/var/lib/trentakip/claude-home/dupes-hash.json";
const OUT = process.env.DUPES_CSV || "/var/lib/trentakip/claude-home/tedarikci-ayni-urunler.csv";
const log = (m: string) => console.error(`${new Date().toISOString().slice(11, 19)} ${m}`);
const lo = (s: string) => s.toLocaleLowerCase("tr");
const toks = (t: string) => [...new Set(lo(t).replace(/[^a-zçğıöşü0-9]+/g, " ").split(" ").filter((w) => w.length >= 2 && !(/\d/.test(w) && /[a-zçğıöşü]/.test(w) && w.length >= 5) && !/^\d{6,}$/.test(w) && !["uyumlu", "adet", "set", "li", "lı", "lu", "lü"].includes(w)))];

type P = { id: string; source: string; title: string; cost: number; stock: number; img: string | null; t: string[] };
const rows = await readAll<any>((a, b) => db.from("products").select("id, source, title, cost_price, product_variants(stock, cost_price), product_images(url, position)")
  .like("source", "xml:%").eq("status", "active").order("id").range(a, b));
if (rows.error) throw new Error(rows.error.message);
const items: P[] = [];
for (const r of rows.data as any[]) {
  const vs = r.product_variants ?? [];
  const stock = vs.reduce((t: number, v: any) => t + Math.max(0, Number(v.stock) || 0), 0);
  if (stock <= 0) continue;
  const costs = vs.map((v: any) => Number(v.cost_price ?? r.cost_price)).filter((c: number) => c > 0);
  const cost = costs.length ? Math.min(...costs) : Number(r.cost_price);
  if (!(cost > 0)) continue;
  const img = [...(r.product_images ?? [])].sort((a: any, b: any) => a.position - b.position)[0]?.url ?? null;
  items.push({ id: r.id, source: r.source, title: String(r.title ?? ""), cost, stock, img, t: toks(String(r.title ?? "")) });
}
log(`aktif + stoklu ürün: ${items.length}`);

// Aday çiftler (farklı tedarikçi)
const df = new Map<string, P[]>();
for (const p of items) for (const w of p.t) (df.get(w) ?? df.set(w, []).get(w)!).push(p);
const pairs: [P, P][] = []; const seen = new Set<string>();
for (const a of items) {
  if (a.t.length < 2 || !a.img) continue;
  const rare = a.t.filter((w) => (df.get(w)?.length ?? 0) < 3000).sort((x, y) => df.get(x)!.length - df.get(y)!.length).slice(0, 3);
  const cand = new Set<P>(); for (const w of rare) for (const b of df.get(w)!) if (b.source !== a.source && b.img) cand.add(b);
  const scored = [...cand].map((b) => { const inter = b.t.filter((w) => a.t.includes(w)).length; return { b, j: inter / new Set([...a.t, ...b.t]).size }; }).filter((x) => x.j >= 0.5).sort((x, y) => y.j - x.j).slice(0, 4);
  for (const { b } of scored) { const k = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`; if (!seen.has(k)) { seen.add(k); pairs.push([a, b]); } }
}
const work = LIMIT ? pairs.slice(0, LIMIT) : pairs;
log(`aday çift: ${pairs.length}${LIMIT ? ` (ilk ${LIMIT})` : ""}`);

const cache: Record<string, string | null> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
let fresh = 0;
const abs = (u: string) => (u.startsWith("http") ? u : `https://trentakip.duckdns.org${u.startsWith("/") ? "" : "/"}${u}`);
const inflight = new Map<string, Promise<bigint | null>>();
function dhash(u: string): Promise<bigint | null> {
  if (u in cache) return Promise.resolve(cache[u] == null ? null : BigInt(cache[u]!));
  if (inflight.has(u)) return inflight.get(u)!;
  const pr = (async () => {
    try {
      const r = await fetch(abs(u), { signal: AbortSignal.timeout(20000), headers: { "User-Agent": "Mozilla/5.0" } });
      if (!r.ok) throw new Error(String(r.status));
      const px = await sharp(Buffer.from(await r.arrayBuffer())).flatten({ background: "#fff" }).grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
      let h = 0n; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) h = (h << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
      cache[u] = h.toString(); return h;
    } catch { cache[u] = null; return null; } finally { if (++fresh % 2000 === 0) writeFileSync(CACHE, JSON.stringify(cache)); }
  })();
  inflight.set(u, pr); return pr;
}
const ham = (a: bigint, b: bigint) => { let x = a ^ b, n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; };

const same: [P, P][] = []; let done = 0; const queue = [...work];
await Promise.all(Array.from({ length: 10 }, async () => {
  while (queue.length) {
    const [a, b] = queue.shift()!;
    const [x, y] = await Promise.all([dhash(a.img!), dhash(b.img!)]);
    if (x != null && y != null && ham(x, y) <= 6) same.push([a, b]);
    if (++done % 5000 === 0) log(`${done}/${work.length} karşılaştırıldı, aynı ${same.length}`);
  }
}));
writeFileSync(CACHE, JSON.stringify(cache));

// Gruplar (birleşim-bul)
const parent = new Map<string, string>();
const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
for (const [a, b] of same) { const ra = find(a.id), rb = find(b.id); if (ra !== rb) parent.set(ra, rb); }
const byId = new Map(items.map((p) => [p.id, p]));
const groups = new Map<string, P[]>();
for (const id of new Set(same.flatMap(([a, b]) => [a.id, b.id]))) { const g = find(id); (groups.get(g) ?? groups.set(g, []).get(g)!).push(byId.get(id)!); }
const out: any[] = [];
for (const [gid, ps] of groups) {
  // Aynı tedarikçiden birden çok ürün grupta kalabilir (renk varyantı gibi); en ucuz tüm gruptan seçilir
  const sorted = [...ps].sort((a, b) => a.cost - b.cost);
  sorted.forEach((p, i) => out.push({ product_id: p.id, group_id: gid, source: p.source, cost: p.cost, stock: p.stock, cheapest: i === 0, title: p.title }));
}
const sum = { grup: groups.size, urun: out.length, enUcuzOlmayan: out.filter((o) => !o.cheapest).length,
  kaynak: Object.fromEntries(["xml:bezos", "xml:hepsibayi", "xml:toptancim", "xml:cercici"].map((s) => [s.slice(4), { grupta: out.filter((o) => o.source === s).length, enUcuz: out.filter((o) => o.source === s && o.cheapest).length }])) };
console.log(JSON.stringify(sum));

// CSV: grup bazında (en ucuz ilk), tasarruf
const esc = (v: any) => { const s = v == null ? "" : typeof v === "number" ? String(Math.round(v * 100) / 100).replace(".", ",") : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const lines = ["grup;tedarikci;urun;maliyet_kdv_dahil;stok;en_ucuz;en_ucuza_gore_fark_tl"];
for (const [gid, ps] of groups) { const min = Math.min(...ps.map((p) => p.cost)); for (const p of [...ps].sort((a, b) => a.cost - b.cost)) lines.push([gid.slice(0, 8), p.source.slice(4), p.title.slice(0, 120), p.cost, p.stock, p.cost === min ? "evet" : "", p.cost - min].map(esc).join(";")); }
writeFileSync(OUT, "﻿" + lines.join("\n"));
log(`rapor: ${OUT}`);

if (APPLY) {
  const del = await db.from("product_dupes").delete().neq("group_id", "");
  if (del.error) throw new Error(del.error.message);
  for (let i = 0; i < out.length; i += 500) {
    const { error } = await db.from("product_dupes").insert(out.slice(i, i + 500).map(({ title, ...r }) => ({ ...r, computed_at: new Date().toISOString() })));
    if (error) throw new Error(error.message);
  }
  log(`product_dupes: ${out.length} satır yazıldı`);
}
