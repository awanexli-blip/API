// Ayar değişikliğinin fiyat etkisi (salt okunur). K 17.11: kupon payı + net kâr tabanı 50 TL.
//   node --experimental-strip-types worker/price-preview.ts [trendyol] --set coupon_rate=0.02,net_profit_min=50
// Canlı ilanların formül fiyatı bugünkü ayarla ve yeni ayarla hesaplanır (kâr kuralları/duruma göre marj/elle fiyat hariç, yaklaşık).
import { createClient } from "@supabase/supabase-js";
import { calcPrice, cfgFromSettings } from "./pricing.ts";
import { readAll, isOwnListing } from "./core/util.ts";

const mp = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "trendyol";
const set = Object.fromEntries(String(process.argv[process.argv.indexOf("--set") + 1] ?? "").split(",").filter((x) => x.includes("=")).map((x) => { const [k, v] = x.split("="); return [k.trim(), v.trim() === "" ? null : Number(v)]; }));
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data: s } = await db.from("settings").select("*").eq("id", 1).single();
const { data: ms } = await db.from("marketplace_settings").select("*").eq("marketplace", mp).maybeSingle();
const base = { ...s, ...Object.fromEntries(Object.entries(ms ?? {}).filter(([, v]) => v != null)) };
const cur = cfgFromSettings(base), nxt = cfgFromSettings({ ...base, ...set });
const ls = await readAll<any>((a, b) => db.from("marketplace_listings").select("listing_key, title, price, commission, product_variants(cost_price), products(cost_price, currency, source)")
  .eq("marketplace", mp).eq("status", "live").gt("price", 0).not("product_id", "is", null).order("listing_key").range(a, b));
if (ls.error) throw new Error(ls.error.message);
const d: number[] = []; let up = 0, down = 0, same = 0, fail = 0, upBig = 0; const bands: Record<string, { n: number; d: number }> = {};
for (const l of ls.data as any[]) {
  if (isOwnListing(l.listing_key, l.title) || l.products?.source === "manual" || (l.products?.currency ?? "TRY") !== "TRY") continue;
  const cost = Number(l.product_variants?.cost_price) || Number(l.products?.cost_price);
  if (!(cost > 0)) continue;
  const k = Number(l.commission) > 0 ? Number(l.commission) : cur.commissionRate;
  const a = calcPrice(cost, cur, k), b = calcPrice(cost, nxt, k);
  if (!a.ok || !b.ok) { fail++; continue; }
  const x = b.price - a.price; d.push(x);
  if (Math.abs(x) < 0.01) same++; else if (x > 0) { up++; if (x / a.price > 0.05) upBig++; } else down++;
  const g = a.price < 200 ? "<200" : a.price < 350 ? "200-350" : a.price < 1000 ? "350-1000" : a.price < 3000 ? "1000-3000" : "3000+";
  bands[g] ??= { n: 0, d: 0 }; bands[g].n++; bands[g].d += x;
}
const r2 = (n: number) => Math.round(n * 100) / 100;
console.log(JSON.stringify({ pazaryeri: mp, degisiklik: set, ilan: d.length, artan: up, azalan: down, ayni: same, yuzde5ustuArtan: upBig, hesaplanamayan: fail,
  ortalamaFark: r2(d.reduce((t, x) => t + x, 0) / (d.length || 1)), fiyatBandi: Object.fromEntries(Object.entries(bands).map(([k, v]) => [k, { ilan: v.n, ortFark: r2(v.d / v.n) }])) }, null, 1));
