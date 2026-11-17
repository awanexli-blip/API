// Ürün seçimi yıldızı ve yıldıza göre gönderim (migration 076; K, 01.11). Trendyol'da 50 bin ürün sınırı: en iyiler önce.
//   node --experimental-strip-types worker/stars.ts rate [pazaryeri]                 -> yıldız ver (opportunity.ts puanlarından)
//   node --experimental-strip-types worker/stars.ts send <yıldız> [pazaryeri] [--source xml:<tedarikçi>] [--apply] -> o yıldızdaki, pazaryerinde olmayan ürünleri kuyruğa al
//   node --experimental-strip-types worker/stars.ts ids <dosya> [pazaryeri] [--apply]  -> dosyadaki ürün kimlikleri (sırayla)
//   node --experimental-strip-types worker/stars.ts new xml:<tedarikçi> <gün> [pazaryeri] [--apply] -> o tedarikçinin son N günde eklenen stoklu ürünleri
// rate: uygun ürünler (excluded boş) puana göre sıralanır, 10 eşit dilim -> 10 (en iyi) .. 1. Aynı ürün başka adla tekrar ediyorsa (aynı ilk
// görsel ya da aynı başlık + maliyet) yalnızca en yüksek puanlı yıldız alır, diğerleri "kopya" elenir (Trendyol "çoklanan ürün" uyarısı).
// send: --apply yoksa yalnızca sayar (deneme). Pazaryerinde ilanı olan / kuyrukta bekleyen ürün atlanır. Trendyol üst sınırı LISTING_CAP (48.000).
// Kuyruktaki işi senkronun gönderim adımı işler (faaliyet kapsamı, marka riski, fiyat formülü, kargo orada yeniden uygulanır).
import { createClient } from "@supabase/supabase-js";
import { env, chunk, readAll, normFull, loadExclusions } from "./core/util.ts";

const [cmd, a1, a2] = process.argv.slice(2);
const apply = process.argv.includes("--apply");
// Bağlantı yalnızca komutla (test assignStars'ı ortam değişkeni olmadan içe aktarır)
let db: any;

// Saf: yıldız dağıtımı (test edilir). Girdi puan sırasına göre değil; çıktı ürün -> yıldız, kopya -> null
export function assignStars(rows: { id: string; score: number; dupKeys: string[] }[]) {
  const sorted = [...rows].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const seen = new Set<string>(), keep: typeof rows = [], dup = new Set<string>();
  for (const r of sorted) {
    if (r.dupKeys.some((k) => seen.has(k))) { dup.add(r.id); continue; }
    r.dupKeys.forEach((k) => seen.add(k)); keep.push(r);
  }
  const stars = new Map<string, number>();
  keep.forEach((r, i) => stars.set(r.id, 10 - Math.floor((i * 10) / keep.length)));
  return { stars, dup };
}

async function rate(mp: string) {
  const r = await readAll<any>((a, b) => db.from("product_opportunity").select("product_id, score, products(title, cost_price, product_images(url, position))")
    .eq("marketplace", mp).is("excluded", null).order("product_id").range(a, b));
  if (r.error) throw new Error(r.error.message);
  const rows = r.data.map((o: any) => {
    const img = [...(o.products?.product_images ?? [])].sort((x: any, y: any) => x.position - y.position)[0]?.url ?? "";
    return { id: o.product_id, score: Number(o.score), dupKeys: [img ? `img:${img}` : "", `t:${normFull(o.products?.title ?? "")}|${o.products?.cost_price}`].filter(Boolean) };
  });
  const { stars, dup } = assignStars(rows);
  // 0 yıldız = sıfırla (eski yıldızlar), sonra yaz
  const byStar = new Map<number, string[]>();
  for (const [id, s] of stars) (byStar.get(s) ?? byStar.set(s, []).get(s)!).push(id);
  for (const [s, ids] of byStar) for (const part of chunk(ids, 500)) {
    const { error } = await db.from("product_opportunity").update({ stars: s }).eq("marketplace", mp).in("product_id", part);
    if (error) throw new Error(error.message);
  }
  for (const part of chunk([...dup], 500)) await db.from("product_opportunity").update({ stars: null, excluded: "kopya (aynı ürün başka adla, en iyisi seçildi)" }).eq("marketplace", mp).in("product_id", part);
  console.log(`${mp}: ${stars.size} ürün yıldızlandı, ${dup.size} kopya elendi · ${[...byStar].sort((a, b) => b[0] - a[0]).map(([s, i]) => `${s}★ ${i.length}`).join(", ")}`);
}

async function send(star: number, mp: string) {
  if (!(star >= 1 && star <= 10)) throw new Error("yıldız 1-10 olmalı");
  // --source xml:<tedarikçi>: yalnızca o tedarikçi (K 17.11: Colezium'un uygunları Trendyol'a)
  const si = process.argv.indexOf("--source"), src = si > 0 ? process.argv[si + 1] ?? "" : "";
  if (src && !/^xml:[a-z0-9_-]+$/.test(src)) throw new Error("--source xml:<tedarikçi>");
  const o = await readAll<any>((a, b) => { let q = db.from("product_opportunity").select("product_id, source").eq("marketplace", mp).eq("stars", star).is("excluded", null); if (src) q = q.eq("source", src); return q.order("product_id").range(a, b); });
  if (o.error) throw new Error(o.error.message);
  await queueRows(o.data, mp, `${star}★${src ? " " + src : ""}`, `stars:${mp}:${star}${src ? ":" + src : ""}`);
}

// K 18.11 (pazar talebi adayları): dosyadaki ürün kimlikleri (satır başına bir uuid) sırayla; sınır dolarsa baştakiler alınır
async function sendIds(file: string, mp: string) {
  const { readFileSync } = await import("node:fs");
  const ids = [...new Set(readFileSync(file, "utf8").split(/\s+/).map((x) => x.trim()).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))];
  const rows: { product_id: string; source: string }[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from("products").select("id, source, status").in("id", ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    const by = new Map((data ?? []).filter((p: any) => p.status === "active").map((p: any) => [p.id, p.source]));
    for (const id of ids.slice(i, i + 200)) if (by.has(id)) rows.push({ product_id: id, source: by.get(id) as string });
  }
  const tag = file.replace(/^.*[\\/]/, "").replace(/[^A-Za-z0-9._-]/g, "");
  await queueRows(rows, mp, `dosya ${tag}`, `ids:${mp}:${tag}`);
}

// K 17.11 ("Bezos'a yeni ürünler eklendi, hepsini ekle"): bir tedarikçinin son N günde eklenen, aktif ve stoklu ürünleri (puanlama beklemeden)
async function sendNew(source: string, days: number, mp: string) {
  if (!/^xml:[a-z0-9_-]+$/.test(source) || !(days > 0 && days <= 60)) throw new Error("kullanım: stars.ts new xml:<tedarikçi> <gün> [pazaryeri] [--apply]");
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const p = await readAll<any>((a, b) => db.from("products").select("id, source, product_variants(stock, reserved)").eq("source", source).eq("status", "active").gte("created_at", since).order("id").range(a, b));
  if (p.error) throw new Error(p.error.message);
  const rows = p.data.filter((x: any) => (x.product_variants ?? []).some((v: any) => Number(v.stock ?? 0) - Number(v.reserved ?? 0) >= 3)).map((x: any) => ({ product_id: x.id, source: x.source }));
  await queueRows(rows, mp, `${source} son ${days} gün`, `new:${mp}:${source}`);
}

async function queueRows(rows: { product_id: string; source: string }[], mp: string, label: string, idem: string) {
  const o = { data: rows };
  // Pazaryerinde ilanı olan, reddedilen (K, 04.11: "düzeltmeden gönderme"; düzeltilen ürünü ai-attrs kendisi kuyruğa alır) ya da kuyrukta bekleyen
  // ürün atlanır. Yalnızca kaldırılmış (gone) ve deneme (SEND_DRY, "DENEME") işaretli ilan yeniden alınır.
  const has = new Set<string>();
  const ls = await readAll<any>((a, b) => db.from("marketplace_listings").select("product_id, status, last_error").eq("marketplace", mp).not("product_id", "is", null).order("listing_key").range(a, b));
  for (const l of ls.data ?? []) if (l.status !== "gone" && !(l.status === "error" && String(l.last_error ?? "").startsWith("DENEME"))) has.add(l.product_id);
  const { data: q } = await db.from("jobs").select("payload").eq("type", `send_products:${mp}`).in("status", ["queued", "running"]);
  for (const j of q ?? []) for (const id of j.payload?.product_ids ?? []) has.add(id);
  const excl = await loadExclusions(db, mp); // K 15.11: Trendyol'da toptancım kapalı / geri çekilen ürünler
  // K 16.11: başka tedarikçide daha ucuz birebir aynısı olan ürün (product_dupes cheapest=false) kuyruğa alınmaz
  const notCheapest = new Set<string>();
  { const d = await readAll<any>((a, b) => db.from("product_dupes").select("product_id").eq("cheapest", false).order("product_id").range(a, b)); for (const x of d.data ?? []) notCheapest.add(x.product_id); }
  let ids = o.data.filter((x: any) => !excl.excluded(x.source, x.product_id) && !notCheapest.has(x.product_id)).map((x: any) => x.product_id).filter((id: string) => !has.has(id));
  // Trendyol ürün sınırı: mevcut ilan + kuyruk + yeni <= LISTING_CAP
  const cap = Number(process.env.LISTING_CAP ?? (mp === "trendyol" ? 48000 : 0));
  if (cap) {
    const live = (ls.data ?? []).filter((l: any) => !["error", "gone"].includes(l.status)).length; // sınır: hatalı ilan pazaryerinde yer tutmaz
    const room = Math.max(0, cap - live - (q ?? []).reduce((t: number, j: any) => t + (j.payload?.product_ids?.length ?? 0), 0));
    if (ids.length > room) { console.log(`sınır: ${cap} ilan; yer ${room}, ${ids.length - room} ürün dışarıda kaldı`); ids = ids.slice(0, room); }
  }
  console.log(`${mp} ${label}: ${o.data.length} ürün, ${o.data.length - ids.length} zaten var/kuyrukta, ${ids.length} kuyruğa ${apply ? "alınıyor" : "alınacak (deneme; --apply ile)"}`);
  if (!apply || !ids.length) return;
  const day = new Date().toISOString().slice(0, 16);
  let n = 0;
  for (const [i, part] of chunk(ids, 200).entries()) {
    const { error } = await db.from("jobs").insert({ type: `send_products:${mp}`, marketplace: mp, payload: { product_ids: part }, idempotency_key: `${idem}:${day}:${i}`, created_by: process.env.ACTOR || "yildiz" });
    if (error) console.error(error.message); else n += part.length;
  }
  console.log(`kuyruğa alındı: ${n}`);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("worker/stars.ts")) {
  db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  if (cmd === "rate") await rate(a1 || "trendyol");
  else if (cmd === "send") await send(Number(a1), a2 && !a2.startsWith("--") ? a2 : "trendyol");
  else if (cmd === "ids") await sendIds(a1, a2 && !a2.startsWith("--") ? a2 : "trendyol");
  else if (cmd === "new") { const mp3 = process.argv[5]; await sendNew(a1, Number(a2), mp3 && !mp3.startsWith("--") ? mp3 : "trendyol"); }
  else console.log("kullanım: stars.ts rate [pazaryeri] | stars.ts send <yıldız> [pazaryeri] [--apply]");
}
