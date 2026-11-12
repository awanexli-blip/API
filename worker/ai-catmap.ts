// Hepsiburada "kategorisi yok" hataları için yapay zekâ kategori eşlemesi (K 12.11, TODO "OpenRouter/Gemma işçileri").
// Ürün başına değil TEDARİKÇİ KATEGORİSİ başına çalışır: bir eşleme o kategorideki bütün ürünleri açar (2.469 kategori, ~41 bin ilan).
// Adaylar: HB yaprak kategorileri (mp_categories) içinden kelime örtüşmesiyle en yakın 25; model YALNIZCA bu listeden seçer (uydurma yok).
//   node --experimental-strip-types worker/ai-catmap.ts eval [--limit 60]           yayındaki ilanların bilinen kategorisiyle isabet ölçümü
//   node --experimental-strip-types worker/ai-catmap.ts run  [--limit N] [--apply]  hatalı kategoriler; --apply: yalnızca "yuksek" güven category_map'e
// Kaldığı yerden devam eder (sonuç dosyası). Elle girilmiş eşlemenin üzerine yazmaz. Pazaryerine yazmaz: eşleme sonraki gönderim turunda kullanılır.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { env, readAll } from "./core/util.ts";
import { llmJson } from "./core/llm.ts";
import { normPath } from "../lib/mp-catalog.ts";

const MP = "hepsiburada";
const mode = process.argv[2];
const apply = process.argv.includes("--apply");
const limArg = process.argv.indexOf("--limit");
const LIMIT = limArg > 0 ? Number(process.argv[limArg + 1]) || 0 : 0;
if (!["eval", "run"].includes(mode)) { console.log("kullanım: ai-catmap.ts eval|run [--limit N] [--apply]"); process.exit(1); }
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const OUT = process.env.AI_CATMAP_FILE || `/var/lib/trentakip/ai-catmap-${mode}.json`;
const log = (m: string) => console.error(`${new Date().toISOString().slice(11, 19)} ${m}`);

// --- HB yaprakları ve kelime dizini
const STOP = new Set(["ve", "ile", "icin", "urun", "urunleri", "urunler", "diger", "aksesuar", "aksesuarlari", "set", "seti", "adet", "li", "lu", "lı", "renk", "model", "yeni", "orjinal", "orijinal", "kaliteli"]);
const toks = (s: string) => normPath(s).split(" ").filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.slice(0, 5));
const leavesRes = await readAll<any>((a, b) => db.from("mp_categories").select("id, name, path").eq("marketplace", MP).order("id").range(a, b));
if (leavesRes.error) throw new Error(leavesRes.error.message);
const leaves = leavesRes.data.map((l: any) => ({ id: String(l.id), name: String(l.name), path: String(l.path ?? l.name), nt: new Set(toks(l.name)), pt: new Set(toks(String(l.path ?? ""))) }));
const byId = new Map(leaves.map((l) => [l.id, l]));
const df = new Map<string, number>();
for (const l of leaves) for (const t of new Set([...l.nt, ...l.pt])) df.set(t, (df.get(t) ?? 0) + 1);
const idf = (t: string) => Math.log(1 + leaves.length / (1 + (df.get(t) ?? 0)));

function candidates(category: string, titles: string[], n = 25) {
  const segs = category.split(/>{1,3}|\//).map((s) => s.trim()).filter(Boolean);
  const q = new Map<string, number>();
  const addW = (ts: string[], w: number) => { for (const t of ts) q.set(t, (q.get(t) ?? 0) + w); };
  addW(toks(segs.at(-1) ?? ""), 4); addW(toks(segs.slice(0, -1).join(" ")), 1.5);
  for (const t of titles.slice(0, 6)) addW(toks(t), 1);
  const scored = leaves.map((l) => {
    let s = 0;
    for (const [t, w] of q) { if (l.nt.has(t)) s += 3 * w * idf(t); else if (l.pt.has(t)) s += w * idf(t); }
    return { l, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, n);
  return scored.map((x) => x.l);
}

const SYSTEM = `Sen Hepsiburada pazaryeri kategori uzmanısın. Bir tedarikçi kategorisi ve o kategorideki örnek ürün başlıkları verilecek.
Aday listesinden bu ürünlerin AÇILACAĞI EN UYGUN TEK yaprak kategoriyi seç. Kurallar:
- Yalnızca listedeki numaralardan birini seç. Listede uygun kategori yoksa id null ver. Uydurma.
- Ürünün kendisine bak (ör. telefon kılıfı -> kılıf kategorisi, telefonun kendisi değil; oyuncak -> oyuncak kategorisi, yetişkin ürünü değil).
- Örnek başlıklar farklı türde ürünler içeriyorsa ve tek kategori hepsine uymuyorsa guven "dusuk" ver.
Yalnızca JSON yaz: {"id": "<numara>" | null, "guven": "yuksek" | "orta" | "dusuk", "neden": "<en fazla 12 kelime>"}`;
const prompt = (category: string, titles: string[], cands: typeof leaves) =>
  `Tedarikçi kategorisi: ${category}\nÖrnek ürünler:\n${titles.slice(0, 6).map((t) => `- ${t.slice(0, 120)}`).join("\n")}\n\nAdaylar (numara | Hepsiburada yolu):\n${cands.map((c) => `${c.id} | ${c.path}`).join("\n")}`;

type Result = { category: string; n: number; stocked?: number; truth?: string | null; pick: string | null; guven: string; neden?: string; inCands?: boolean; by: string };
const done: Record<string, Result> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const save = () => writeFileSync(OUT, JSON.stringify(done, null, 1));

// --- hedef kategoriler
type Target = { category: string; n: number; stocked: number; titles: string[]; truth?: string };
let targets: Target[] = [];
if (mode === "eval") {
  // Doğru cevap: yayındaki HB ilanlarının kategori numarası (tedarikçi kategorisi başına %70+ çoğunluk, en az 3 ilan)
  const rows = await readAll<any>((a, b) => db.from("marketplace_listings").select("listing_key, category_id, products(category, title)").eq("marketplace", MP).eq("status", "live").not("category_id", "is", null).order("listing_key").range(a, b));
  if (rows.error) throw new Error(rows.error.message);
  const g = new Map<string, { ids: Map<string, number>; titles: string[]; n: number }>();
  for (const r of rows.data as any[]) {
    const c = r.products?.category; if (!c) continue;
    const x = g.get(c) ?? { ids: new Map(), titles: [], n: 0 };
    x.n++; x.ids.set(String(r.category_id), (x.ids.get(String(r.category_id)) ?? 0) + 1);
    if (x.titles.length < 6) x.titles.push(r.products.title); g.set(c, x);
  }
  for (const [category, x] of g) {
    const [top, cnt] = [...x.ids].sort((a, b) => b[1] - a[1])[0];
    if (x.n >= 3 && cnt / x.n >= 0.7 && byId.has(top)) targets.push({ category, n: x.n, stocked: x.n, titles: x.titles, truth: top });
  }
  targets.sort((a, b) => b.n - a.n);
  // Çeşitlilik: büyükler + rastgele küçükler (yalnızca kolay büyük kategorilerle ölçülmesin)
  const big = targets.slice(0, 20), rest = targets.slice(20).sort(() => Math.random() - 0.5);
  targets = [...big, ...rest].slice(0, LIMIT || 60);
} else {
  const { data: mapped } = await db.from("category_map").select("xml_category").eq("marketplace", MP).limit(5000);
  const has = new Set((mapped ?? []).map((m: any) => m.xml_category));
  const rows = await readAll<any>((a, b) => db.from("marketplace_listings").select("listing_key, products(category, title, product_variants(stock))").eq("marketplace", MP).eq("status", "error").ilike("last_error", "%kategorisi yok%").order("listing_key").range(a, b));
  if (rows.error) throw new Error(rows.error.message);
  const g = new Map<string, Target>();
  for (const r of rows.data as any[]) {
    const c = r.products?.category; if (!c || has.has(c)) continue;
    const x = g.get(c) ?? { category: c, n: 0, stocked: 0, titles: [] };
    x.n++; if ((r.products.product_variants ?? []).some((v: any) => Number(v.stock) > 0)) x.stocked++;
    if (x.titles.length < 6 && !x.titles.includes(r.products.title)) x.titles.push(r.products.title); g.set(c, x);
  }
  targets = [...g.values()].filter((t) => t.stocked > 0).sort((a, b) => b.stocked - a.stocked);
  if (LIMIT) targets = targets.slice(0, LIMIT);
}
log(`${mode}: ${targets.length} kategori (yapılmış ${Object.keys(done).length})`);

// --- çalıştır
for (const t of targets) {
  if (done[t.category]) continue;
  const cands = candidates(t.category, t.titles);
  if (!cands.length) { done[t.category] = { category: t.category, n: t.n, stocked: t.stocked, truth: t.truth ?? null, pick: null, guven: "aday yok", inCands: false, by: "-" }; save(); continue; }
  const { data, by } = await llmJson<{ id: string | null; guven: string; neden?: string }>(SYSTEM, prompt(t.category, t.titles, cands), { log });
  const id = data?.id != null ? String(data.id).trim() : null;
  const valid = id && cands.some((c) => c.id === id) ? id : null; // listede olmayan seçim geçersiz
  done[t.category] = { category: t.category, n: t.n, stocked: t.stocked, truth: t.truth ?? null, pick: valid, guven: valid ? String(data?.guven ?? "dusuk") : (id ? "geçersiz seçim" : String(data?.guven ?? "cevap yok")), neden: data?.neden?.slice(0, 120), inCands: t.truth ? cands.some((c) => c.id === t.truth) : undefined, by };
  save();
  log(`${t.category.slice(0, 60)} -> ${valid ? byId.get(valid)!.path.slice(-60) : "-"} [${done[t.category].guven}] (${by})`);
  await new Promise((r) => setTimeout(r, 1500));
}

// --- rapor
const res = targets.map((t) => done[t.category]).filter(Boolean);
if (mode === "eval") {
  const by = (f: (r: Result) => boolean) => res.filter(f);
  const acc = (rs: Result[]) => (rs.length ? `${rs.filter((r) => r.pick === r.truth).length}/${rs.length} (%${Math.round(100 * rs.filter((r) => r.pick === r.truth).length / rs.length)})` : "-");
  console.log(JSON.stringify({
    olculen: res.length, adayListesindeDogruVar: `${res.filter((r) => r.inCands).length}/${res.length}`,
    isabetTumu: acc(res), isabetYuksek: acc(by((r) => r.guven === "yuksek")), isabetYuksekAdayVarken: acc(by((r) => r.guven === "yuksek" && !!r.inCands)),
    yuksekOrani: `${by((r) => r.guven === "yuksek").length}/${res.length}`,
    yanlisYuksek: by((r) => r.guven === "yuksek" && r.pick !== r.truth).slice(0, 8).map((r) => `${r.category.slice(0, 50)} | secilen ${byId.get(r.pick!)?.path.slice(-50)} | dogru ${byId.get(r.truth!)?.path.slice(-50)}`),
  }, null, 1));
} else {
  const hi = res.filter((r) => r.guven === "yuksek" && r.pick);
  console.log(JSON.stringify({ kategori: res.length, yuksek: hi.length, yuksekStokluIlan: hi.reduce((s, r) => s + (r.stocked ?? 0), 0), digerleri: res.length - hi.length }));
  if (apply && hi.length) {
    const rows = hi.map((r) => ({ marketplace: MP, xml_category: r.category, category_id: r.pick, category_name: byId.get(r.pick!)!.name }));
    let n = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const { error, count } = await db.from("category_map").upsert(rows.slice(i, i + 200), { onConflict: "marketplace,xml_category", ignoreDuplicates: true, count: "exact" });
      if (error) { console.error(error.message); break; } n += count ?? 0;
    }
    await db.from("audit_log").insert({ actor: "claude ai-catmap (K 12.11)", action: "insert", entity: "category_map", entity_id: MP, before: null, after: { eklenen: n, kategoriler: hi.length } });
    console.log(JSON.stringify({ eslemeyeYazildi: n }));
  }
}
