// Eksik zorunlu özellikleri TEDARİKÇİ METNİNDEN okuma (K 12.11 gece: "hataları tespit et, düzelt, tekrar gönder").
// 06.11'de serbest yapay zekâ doldurması K tarafından kapatıldı (uyduruyordu). Bu araç farklı: değer YALNIZCA başlık/açıklamada açıkça
// yazıyorsa alınır; model her değer için metindeki kaynak ifadeyi aynen vermek zorunda (metinde yoksa reddedilir) ve değer pazaryerinin
// izinli listesinde birebir olmalı. Ebat (NNxNN) başlıktan kuralla okunur. Varsayılan DENEME: rapor yazar, ürüne dokunmaz.
//   node --experimental-strip-types worker/ai-attrs.ts <trendyol|hepsiburada> --match "Hav Yüksekliği" [--limit N] [--apply]
//   --apply: yalnızca TÜM eksikleri bulunan ürünlere "<Özellik>@<pazaryeri>" yazar (boş anahtarlar) ve gönderim kuyruğuna alır.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { env, readAll } from "./core/util.ts";
import { llmJson } from "./core/llm.ts";
import { getAttrs } from "../lib/mp-catalog.ts";
import { defaultFor } from "./core/attr-infer.ts";

const MP = process.argv[2];
const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const MATCH = arg("--match") ?? "", LIMIT = Number(arg("--limit") ?? 0), APPLY = process.argv.includes("--apply"), CAT = arg("--category");
// --fixed "Ad=Değer;Ad2=Değer2": K'nın kararıyla sabit değer (13.11: halıların hepsine "Üretim Şekli=Makine Halısı"); değer izinli listede olmalı
const FIXED = Object.fromEntries(String(arg("--fixed") ?? "").split(";").map((x) => x.split("=").map((y) => y.trim())).filter((x) => x.length === 2 && x[0] && x[1]));
// Kaynak ifadede olması gereken kelime: "Taban" için iplik/yüzey bilgisi (polyester iplik) taban sayılmaz (K 13.11: olmayan özellik eklenmez)
const MUST: [RegExp, RegExp][] = [[/^taban$/i, /taban|zemin/i], [/hav/i, /hav/i], [/saçak/i, /saçak|kenar|overlok|kesim/i]];
if (!["trendyol", "hepsiburada"].includes(MP) || !MATCH) { console.log('kullanım: ai-attrs.ts <trendyol|hepsiburada> --match "Özellik" [--limit N] [--apply]'); process.exit(1); }
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const OUT = process.env.AI_ATTRS_FILE || `/var/log/trentakip/ai-attrs-${MP}-${MATCH.replace(/[^a-zA-Z0-9]+/g, "_")}.json`;
const log = (m: string) => console.error(`${new Date().toISOString().slice(11, 19)} ${m}`);
const fold = (s: string) => s.toLocaleLowerCase("tr").replace(/<[^>]+>/g, " ").replace(/[^a-zçğıöşü0-9%.,x×]+/g, " ").replace(/\s+/g, " ").trim();

const rows = await readAll<any>((a, b) => db.from("marketplace_listings").select("listing_key, category_id, last_error, product_id, products(id, title, description, attributes, product_variants(stock, attributes))")
  .eq("marketplace", MP).eq("status", "error").ilike("last_error", `%zorunlu özellik doldurulamadı%${MATCH}%`).match(CAT ? { category_id: CAT } : {}).order("listing_key").range(a, b));
if (rows.error) throw new Error(rows.error.message);
type Item = { pid: string; cid: string; title: string; text: string; missing: string[]; known: Record<string, string>; vattrs: Record<string, string>[] };
const items = new Map<string, Item>();
for (const r of rows.data as any[]) {
  const p = r.products; if (!p || !r.category_id || items.has(p.id)) continue;
  if (!(p.product_variants ?? []).some((v: any) => Number(v.stock) > 0)) continue;
  const missing = String(r.last_error).split(":").slice(1).join(":").split(",").map((s: string) => s.replace(/s*(.*$/, "").trim()).filter(Boolean); // "Boyut/Ebat (\"80X80\" listede yok)" -> ad
  items.set(p.id, { pid: p.id, cid: String(r.category_id), title: String(p.title ?? ""), text: `${p.title ?? ""}\n${String(p.description ?? "").replace(/<[^>]+>/g, " ")}`.slice(0, 4000), missing, known: p.attributes ?? {}, vattrs: (p.product_variants ?? []).filter((v: any) => Number(v.stock) > 0).map((v: any) => v.attributes ?? {}) });
}
let list = [...items.values()];
if (LIMIT) list = list.slice(0, LIMIT);
log(`${MP} "${MATCH}": ${list.length} stoklu ürün`);

const done: Record<string, any> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const save = () => writeFileSync(OUT, JSON.stringify(done, null, 1));
const cache = new Map<string, Record<string, { value: string; kaynak: string }>>(); // aynı metin (bedenleri ayrı ürün) tek çağrı
const attrDefs = new Map<string, Awaited<ReturnType<typeof getAttrs>>>();
const SYSTEM = `Sen bir e-ticaret veri çıkarıcısısın. Sana bir ürünün başlığı ve tedarikçi açıklaması, ve doldurulması gereken özellikler (izinli değer listesiyle) verilecek.
KURALLAR:
- Bir özelliğin değerini YALNIZCA metinde açıkça yazıyorsa ver. Tahmin etme, genel bilgiyle doldurma, "genellikle böyledir" deme.
- Değer, o özelliğin izinli listesinden BİREBİR biri olmalı (yazımı aynen kopyala).
- Her değer için "kaynak": metinden o bilgiyi gösteren ifadeyi KELİMESİ KELİMESİNE kopyala (en fazla 12 kelime).
- Metinde yoksa o özelliği null ver.
Yalnızca JSON: {"<özellik adı>": {"value": "<listeden değer>", "kaynak": "<metinden aynen>"} | null, ...}`;

let n = 0;
for (const it of list) {
  if (done[it.pid]) continue;
  if (!attrDefs.has(it.cid)) attrDefs.set(it.cid, await getAttrs(db, MP, it.cid).catch(() => []));
  const defs = attrDefs.get(it.cid)!;
  const want = it.missing.map((m) => defs.find((d) => d.name === m)).filter(Boolean) as typeof defs;
  const found: Record<string, { value: string; kaynak: string; by: string }> = {};
  // Seçenek özelliği (Boyut/Ebat, Beden) her stoklu varyantta kayıtlıysa gönderimde varyanttan gelir (ürüne yazılmaz)
  for (const d of want) if (d.variant && it.vattrs.length && it.vattrs.every((va) => defaultFor(va, d.name))) found[d.name] = { value: "(varyanttan)", kaynak: "", by: "varyant" };
  for (const d of want) if (!found[d.name] && FIXED[d.name] && d.values.includes(FIXED[d.name])) found[d.name] = { value: FIXED[d.name], kaynak: "K kararı", by: "sabit" };
  // Ebat: başlık/metindeki NN x NN (izinli listede birebir varsa)
  for (const d of want.filter((d) => /boyut|ebat/i.test(d.name) && !found[d.name])) {
    const m = it.text.match(/(\d{2,3})\s*[x×*]\s*(\d{2,4})\s*(cm)?/i);
    if (m) { const v = `${m[1]} x ${m[2]}`; if (d.values.includes(v)) found[d.name] = { value: v, kaynak: m[0], by: "kural" }; }
  }
  const ask = want.filter((d) => !found[d.name] && d.values.length > 0 && d.values.length <= 300);
  if (ask.length) {
    const h = createHash("sha1").update(it.cid + "|" + fold(it.text.replace(/\d{2,3}\s*[x×*]\s*\d{2,4}/g, ""))).digest("hex");
    let res = cache.get(h);
    if (!res) {
      const user = `BAŞLIK: ${it.title}\nAÇIKLAMA: ${it.text.slice(it.title.length).trim().slice(0, 3500)}\n\nÖZELLİKLER:\n${ask.map((d) => `- ${d.name}: ${d.values.join(" | ")}`).join("\n")}`;
      const { data } = await llmJson<Record<string, { value: string; kaynak: string } | null>>(SYSTEM, user, { log });
      res = {};
      for (const d of ask) { const x = data?.[d.name]; if (x?.value) res[d.name] = { value: String(x.value).trim(), kaynak: String(x.kaynak ?? "").trim() }; }
      cache.set(h, res); n++;
      await new Promise((r) => setTimeout(r, 1200));
    }
    const ft = fold(it.text);
    for (const d of ask) {
      const x = res[d.name]; if (!x) continue;
      if (!d.values.includes(x.value)) continue;                       // listede birebir değil
      const k = fold(x.kaynak); if (k.length < 3 || !ft.includes(k)) continue; // kaynak metinde aynen yok -> uydurma sayılır
      const must = MUST.find(([n]) => n.test(d.name)); if (must && !must[1].test(x.kaynak)) continue; // kaynak o özelliği anlatmıyor
      found[d.name] = { ...x, by: "metin" };
    }
  }
  const remaining = it.missing.filter((m) => !found[m]);
  done[it.pid] = { title: it.title.slice(0, 100), cid: it.cid, found, remaining, complete: remaining.length === 0 };
  save();
  log(`${it.title.slice(0, 50)} | bulunan ${Object.keys(found).length}/${it.missing.length}${remaining.length ? ` | eksik: ${remaining.join(", ")}` : " | TAMAM"}`);
}

const res = list.map((i) => done[i.pid]).filter(Boolean);
const byAttr: Record<string, number> = {};
for (const r of res) for (const k of Object.keys(r.found)) byAttr[k] = (byAttr[k] ?? 0) + 1;
console.log(JSON.stringify({ urun: res.length, tamamlanan: res.filter((r) => r.complete).length, modelCagrisi: n, ozellikBulunan: byAttr,
  ornekTamam: res.filter((r) => r.complete).slice(0, 3).map((r) => ({ urun: r.title, ...Object.fromEntries(Object.entries(r.found).map(([k, v]: any) => [k, `${v.value}  ← "${v.kaynak}"`])) })) }, null, 1));

if (APPLY) {
  let w = 0; const ids: string[] = [];
  for (const it of list) {
    const r = done[it.pid]; if (!r?.complete) continue;
    const add: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.found) as any) if (v.by !== "varyant" && it.known[`${k}@${MP}`] == null && it.known[k] == null) add[`${k}@${MP}`] = v.value;
    if (!Object.keys(add).length) continue;
    const { error } = await db.from("products").update({ attributes: { ...it.known, ...add }, updated_at: new Date().toISOString() }).eq("id", it.pid);
    if (!error) { w++; ids.push(it.pid); }
  }
  for (let i = 0; i < ids.length; i += 100) {
    await db.from("jobs").insert({ type: `send_products:${MP}`, marketplace: MP, payload: { product_ids: ids.slice(i, i + 100) }, idempotency_key: `ai-attrs:${MP}:${new Date().toISOString().slice(0, 13)}:${i / 100}`, created_by: "metinden özellik (K onaylı)" });
  }
  await db.from("audit_log").insert({ actor: "claude ai-attrs", action: "update", entity: "products", entity_id: MP, before: null, after: { eslesme: MATCH, yazilan: w } });
  console.log(JSON.stringify({ yazilan: w, kuyruga: ids.length }));
}
