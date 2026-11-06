// Yanlış Yaş Grubu / Cinsiyet onarımı (K, 06.11: kadın elbisesi "Yaş Grubu: Çocuk" yüzünden Trendyol'da Çocuk Elbise altında çıktı).
//   node --experimental-strip-types worker/attr-fix.ts plan                     yalnızca say (yazmaz)
//   node --experimental-strip-types worker/attr-fix.ts db --apply               ürün kayıtlarını düzelt (yeni gönderimler doğru gider)
//   node --experimental-strip-types worker/attr-fix.ts push [--key BARKOD] [--limit N] [--apply]   yayındaki Trendyol ilanlarını düzelt
// Yalnızca tedarikçi ürünleri (xml:*); K'nın elle girdiği ürünlere dokunulmaz. Değer yalnızca başlık + tedarikçi kategorisinden (core/attr-infer.ts).
// Çalıştığı veritabanı: ortamdaki SUPABASE_URL (sunucu için trentakip-vps ile). Müşteri verisi okumaz.
import { createClient } from "@supabase/supabase-js";
import { wantedAudience as wanted } from "./core/attr-infer.ts";
import { env, readAll, chunk } from "./core/util.ts";
import { getMarketplace } from "./marketplaces/index.ts";

const cmd = process.argv[2];
const apply = process.argv.includes("--apply");
const argOf = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

async function suppliers() {
  const out: any[] = [];
  let last = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const { data, error } = await db.from("products").select("id, title, category, source, attributes").gt("id", last).like("source", "xml:%").order("id").limit(1000);
    if (error) throw new Error(error.message);
    if (!data?.length) return out;
    last = (data[data.length - 1] as any).id;
    for (const p of data as any[]) if (p.attributes?.["Yaş Grubu"] || p.attributes?.["Cinsiyet"]) out.push(p);
  }
}

if (cmd === "plan" || cmd === "db") {
  const all = await suppliers();
  const fix = all.map((p) => ({ p, set: wanted(String(p.title ?? ""), String(p.category ?? ""), p.attributes) })).filter((x) => Object.keys(x.set).length);
  const pairs = new Map<string, { n: number; ex: string[] }>();
  for (const { p, set } of fix) for (const [k, v] of Object.entries(set)) { const key = `${k}: ${p.attributes[k]} -> ${v}`; const g = pairs.get(key) ?? { n: 0, ex: [] }; g.n++; if (g.ex.length < 3) g.ex.push(`${String(p.title).slice(0, 45)} <${String(p.category).split(">").pop()?.trim().slice(0, 25)}>`); pairs.set(key, g); }
  console.log(JSON.stringify({ tarananUrun: all.length, duzeltilecek: fix.length }));
  for (const [k, g] of [...pairs].sort((a, b) => b[1].n - a[1].n)) console.log(g.n, k, JSON.stringify(g.ex));
  if (cmd === "db" && apply) {
    let ok = 0, err = 0;
    for (const { p, set } of fix) {
      const { error } = await db.from("products").update({ attributes: { ...p.attributes, ...set } }).eq("id", p.id);
      if (error) { err++; if (err <= 3) console.error(error.message); } else ok++;
    }
    console.log(JSON.stringify({ yazilan: ok, hata: err }));
  }
} else if (cmd === "push") {
  const mp = getMarketplace("trendyol");
  const listings = (await mp.loadListings()).filter((l) => l.status === "active" && l.contentId && l.attributes);
  const key = argOf("--key");
  const live = key ? listings.filter((l) => l.id === key) : listings;
  const rows = await readAll<any>((a, b) => db.from("marketplace_listings").select("listing_key, product_id").eq("marketplace", "trendyol").not("product_id", "is", null).order("listing_key").range(a, b));
  if (rows.error) throw new Error(rows.error.message);
  const prodOf = new Map(rows.data.map((r: any) => [r.listing_key, r.product_id]));
  const ids = [...new Set(live.map((l) => prodOf.get(l.id)).filter(Boolean))] as string[];
  const prods = new Map<string, any>();
  for (const part of chunk(ids, 150)) {
    const { data, error } = await db.from("products").select("id, title, category, source").in("id", part).like("source", "xml:%");
    if (error) throw new Error(error.message);
    for (const p of data ?? []) prods.set((p as any).id, p);
  }
  const byContent = new Map<string, Record<string, string>>();
  for (const l of live) {
    const p = prods.get(prodOf.get(l.id) as string);
    if (!p || byContent.has(l.contentId!)) continue;
    const set = wanted(String(p.title ?? ""), String(p.category ?? ""), l.attributes as Record<string, any>);
    if (Object.keys(set).length) byContent.set(l.contentId!, set);
  }
  const limit = Number(argOf("--limit") ?? 0);
  const items = [...byContent].map(([contentId, set]) => ({ contentId, set })).slice(0, limit || undefined);
  console.log(JSON.stringify({ yayindaIlan: live.length, duzeltilecekIcerik: byContent.size, buCalisma: items.length, deneme: !apply }));
  if (!apply) process.env.SEND_DRY = "1";
  const r = await mp.updateAttributes!(items);
  const sayim: Record<string, number> = {};
  for (const s of r.sent) for (const [k, v] of Object.entries(s.changed)) sayim[`${k} -> ${v}`] = (sayim[`${k} -> ${v}`] ?? 0) + 1;
  const neden: Record<string, number> = {};
  for (const s of r.skipped) neden[s.reason] = (neden[s.reason] ?? 0) + 1;
  console.log(JSON.stringify({ gonderilen: apply ? r.ok : 0, hazirlanan: r.sent.length, basarisizParti: r.failed, atlanan: r.skipped.length, sayim, neden, ornek: r.sent.slice(0, 3) }));
  if (apply && r.batchIds.length && mp.checkBatches) {
    await new Promise((res) => setTimeout(res, 30000));
    const c = await mp.checkBatches(r.batchIds);
    console.log(JSON.stringify({ parti: r.batchIds.length, hatali: c?.failed?.length ?? 0, nedenler: [...new Set((c?.failed ?? []).map((f: any) => String(f.reason).slice(0, 200)))].slice(0, 5) }));
  }
} else console.log("kullanım: attr-fix.ts plan | db [--apply] | push [--key BARKOD] [--limit N] [--apply]");
