// Ürün seçimi yıldızı ve yıldıza göre gönderim (migration 076; K, 01.11). Trendyol'da 50 bin ürün sınırı: en iyiler önce.
//   node --experimental-strip-types worker/stars.ts rate [pazaryeri]                 -> yıldız ver (opportunity.ts puanlarından)
//   node --experimental-strip-types worker/stars.ts send <yıldız> [pazaryeri] [--apply] -> o yıldızdaki, pazaryerinde olmayan ürünleri kuyruğa al
// rate: uygun ürünler (excluded boş) puana göre sıralanır, 10 eşit dilim -> 10 (en iyi) .. 1. Aynı ürün başka adla tekrar ediyorsa (aynı ilk
// görsel ya da aynı başlık + maliyet) yalnızca en yüksek puanlı yıldız alır, diğerleri "kopya" elenir (Trendyol "çoklanan ürün" uyarısı).
// send: --apply yoksa yalnızca sayar (deneme). Pazaryerinde ilanı olan / kuyrukta bekleyen ürün atlanır. Trendyol üst sınırı LISTING_CAP (48.000).
// Kuyruktaki işi senkronun gönderim adımı işler (faaliyet kapsamı, marka riski, fiyat formülü, kargo orada yeniden uygulanır).
import { createClient } from "@supabase/supabase-js";
import { env, chunk, readAll, normFull } from "./core/util.ts";

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
  const o = await readAll<any>((a, b) => db.from("product_opportunity").select("product_id, source").eq("marketplace", mp).eq("stars", star).is("excluded", null).order("product_id").range(a, b));
  if (o.error) throw new Error(o.error.message);
  // Pazaryerinde ilanı olan (hata/kaldırılmış hariç) ya da kuyrukta bekleyen ürün atlanır
  const has = new Set<string>();
  const ls = await readAll<any>((a, b) => db.from("marketplace_listings").select("product_id, status").eq("marketplace", mp).not("product_id", "is", null).order("listing_key").range(a, b));
  for (const l of ls.data ?? []) if (!["error", "gone"].includes(l.status)) has.add(l.product_id);
  const { data: q } = await db.from("jobs").select("payload").eq("type", `send_products:${mp}`).in("status", ["queued", "running"]);
  for (const j of q ?? []) for (const id of j.payload?.product_ids ?? []) has.add(id);
  let ids = o.data.map((x: any) => x.product_id).filter((id: string) => !has.has(id));
  // Trendyol ürün sınırı: mevcut ilan + kuyruk + yeni <= LISTING_CAP
  const cap = Number(process.env.LISTING_CAP ?? (mp === "trendyol" ? 48000 : 0));
  if (cap) {
    const live = (ls.data ?? []).filter((l: any) => !["error", "gone"].includes(l.status)).length;
    const room = Math.max(0, cap - live - (q ?? []).reduce((t: number, j: any) => t + (j.payload?.product_ids?.length ?? 0), 0));
    if (ids.length > room) { console.log(`sınır: ${cap} ilan; yer ${room}, ${ids.length - room} ürün dışarıda kaldı`); ids = ids.slice(0, room); }
  }
  console.log(`${mp} ${star}★: ${o.data.length} ürün, ${o.data.length - ids.length} zaten var/kuyrukta, ${ids.length} kuyruğa ${apply ? "alınıyor" : "alınacak (deneme; --apply ile)"}`);
  if (!apply || !ids.length) return;
  const day = new Date().toISOString().slice(0, 16);
  let n = 0;
  for (const [i, part] of chunk(ids, 200).entries()) {
    const { error } = await db.from("jobs").insert({ type: `send_products:${mp}`, marketplace: mp, payload: { product_ids: part }, idempotency_key: `stars:${mp}:${star}:${day}:${i}`, created_by: process.env.ACTOR || "yildiz" });
    if (error) console.error(error.message); else n += part.length;
  }
  console.log(`kuyruğa alındı: ${n}`);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("worker/stars.ts")) {
  db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  if (cmd === "rate") await rate(a1 || "trendyol");
  else if (cmd === "send") await send(Number(a1), a2 && !a2.startsWith("--") ? a2 : "trendyol");
  else console.log("kullanım: stars.ts rate [pazaryeri] | stars.ts send <yıldız> [pazaryeri] [--apply]");
}
