// Trendyol reddedilen ilanları düzeltip yeniden onaya gönderme (K, 06.11). Sunucu veritabanına karşı çalışır (trentakip-vps).
//   node --experimental-strip-types worker/reject-fix.ts                       deneme: ne yapılacağını sayar, Trendyol'a yazmaz
//   node --experimental-strip-types worker/reject-fix.ts --apply [--limit N] [--key BARKOD]
// Kural: düzeltilebilen (yasaklı kelime, link/iletişim, açılmayan görsel) gönderilir; düzeltilemeyen (fotoğraf içeriği, satış kuralı, kategori, görseldeki marka)
// gönderilmez, panele düşer (listing_fixes needs_user). Düzeltme yapılmadan hiçbir ilan yeniden gönderilmez. Başarısız olanlar en fazla 2 kez denenir (core/rejections.ts).
import { createClient } from "@supabase/supabase-js";
import { planFix, type FixRow } from "./core/rejections.ts";
import { aliveImages, jpgUrl } from "./core/img-proxy.ts";
import { env, readAll, chunk } from "./core/util.ts";
import { getMarketplace } from "./marketplaces/index.ts";

const apply = process.argv.includes("--apply");
const argOf = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const limit = Number(argOf("--limit") ?? 0), onlyKey = argOf("--key");
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const mp = getMarketplace("trendyol");

const listings = await mp.loadListings();
const rejected = listings.filter((l) => l.reject && (!onlyKey || l.id === onlyKey));
const bw = await readAll<any>((a, b) => db.from("banned_words").select("word").eq("marketplace", "trendyol").order("word").range(a, b));
if (bw.error) throw new Error(bw.error.message);
const banned = bw.data.map((r: any) => String(r.word));

const fixes = new Map<string, FixRow>();
for (const part of chunk(rejected.map((l) => l.id), 200)) {
  const { data, error } = await db.from("listing_fixes").select("*").eq("marketplace", "trendyol").in("listing_key", part);
  if (error) throw new Error(error.message);
  for (const r of data ?? []) fixes.set((r as any).listing_key, r as any);
}

// Kendi görsellerimiz (ürün / varyant kaydı); yoksa Trendyol'un sakladığı adresler
const dbImages = new Map<string, string[]>();
for (const part of chunk(rejected.map((l) => l.id), 200)) {
  const { data, error } = await db.from("marketplace_listings").select("listing_key, products(product_images(url, position)), product_variants(images)").eq("marketplace", "trendyol").in("listing_key", part);
  if (error) throw new Error(error.message);
  for (const r of (data ?? []) as any[]) {
    const v = Array.isArray(r.product_variants?.images) ? r.product_variants.images : [];
    const p = [...(r.products?.product_images ?? [])].sort((a: any, b: any) => a.position - b.position).map((x: any) => String(x.url));
    if (v.length || p.length) dbImages.set(r.listing_key, v.length ? v : p);
  }
}
// Yalnızca görsel hatası olanlar için açılıyor mu denetlenir
const IMG = /görsel linki|erişilemiyor|erişilememektedir|boyutuyla|linkin/i;
const candImages = (l: any): string[] => (dbImages.get(l.id) ?? l.reject.images ?? []).slice(0, 8);
const toCheck = [...new Set(rejected.filter((l: any) => IMG.test(l.reject.details.join(" "))).flatMap(candImages))];
const alive = await aliveImages(toCheck, (u) => jpgUrl(u, undefined, "p"));
console.log(JSON.stringify({ reddedilen: rejected.length, gorselDenetlenen: toCheck.length, acilan: alive.size }));

const stat: Record<string, number> = {}, notes = new Map<string, number>(), samples: string[] = [];
const updates: any[] = [], upserts: any[] = [], newWords = new Set<string>();
const now = new Date().toISOString();
for (const l of rejected as any[]) {
  const row = fixes.get(l.id);
  const images = candImages(l).filter((u: string) => alive.has(u));
  const plan = planFix(l, row, { banned, images });
  stat[plan.action] = (stat[plan.action] ?? 0) + 1;
  const key = plan.note.replace(/\(.*?\)|".*?"/g, "").trim().slice(0, 90);
  notes.set(`${plan.action}: ${key}`, (notes.get(`${plan.action}: ${key}`) ?? 0) + 1);
  if ("banned" in plan) for (const w of plan.banned) newWords.add(w);
  const base = { marketplace: "trendyol", listing_key: l.id, types: l.reject.types, details: l.reject.details.join(" | ").slice(0, 2000), updated_at: now };
  if (plan.action === "resubmit") {
    if (limit && updates.length >= limit) continue;
    updates.push(plan.update);
    upserts.push({ ...base, status: "resubmitted", attempts: (row?.attempts ?? 0) + (plan.fromUser ? 0 : 1), note: plan.note, last_attempt_at: now, proposed: row?.proposed ?? {} });
    if (samples.length < 30) samples.push(`${l.id} | ${plan.note} | ${plan.update.title ? `"${String(l.reject.title).slice(0, 50)}" -> "${String(plan.update.title).slice(0, 50)}"` : plan.update.images ? `${plan.update.images.length} görsel` : "açıklama"}`);
  } else if (plan.action === "needs_user") {
    upserts.push({ ...base, status: "needs_user", attempts: row?.attempts ?? 0, note: plan.note, last_attempt_at: row?.last_attempt_at ?? null, proposed: row?.proposed ?? {} });
  }
}
console.log(JSON.stringify({ deneme: !apply, sayim: stat, gonderilecek: updates.length, yeniYasakli: [...newWords].slice(0, 40) }));
for (const [k, n] of [...notes].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(n, k);
for (const s of samples) console.log(s);
if (apply) {
  if (newWords.size) await db.from("banned_words").upsert([...newWords].map((word) => ({ marketplace: "trendyol", word, source: "ret" })), { onConflict: "marketplace,word", ignoreDuplicates: true });
  const r = updates.length ? await mp.updateRejected!(updates) : { ok: 0, failed: 0, batchIds: [] as string[] };
  for (const part of chunk(upserts, 500)) { const { error } = await db.from("listing_fixes").upsert(part, { onConflict: "marketplace,listing_key" }); if (error) console.error(error.message); }
  console.log(JSON.stringify({ gonderilen: r.ok, basarisizParti: r.failed, partiler: r.batchIds.length }));
  if (r.batchIds.length && mp.checkBatches) {
    await new Promise((res) => setTimeout(res, 45000));
    const c = await mp.checkBatches(r.batchIds);
    console.log(JSON.stringify({ hatali: c?.failed?.length ?? 0, nedenler: [...new Set((c?.failed ?? []).map((f: any) => String(f.reason).slice(0, 220)))].slice(0, 8) }));
  }
}
