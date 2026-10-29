// Kargo modeli değişikliğinin etkisi (salt okunur; pazaryerine ve veritabanına yazmaz). Senaryolar: ops/price-impact.json
// Her senaryo için: bugünkü canlı fiyatla gerçek kargo modelinde zararda / az kârda kalan ilan sayısı ve yeni formülün fiyat değişimi.
// Yaklaşık: kâr kuralları (pricing_rules), duruma göre marj ve elle fiyatlar hesaba katılmaz; ilanın kendi komisyonu kullanılır.
// node --experimental-strip-types worker/price-impact.ts [trendyol]
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { breakdown, calcPrice, cfgFromSettings, existingPriceSafe, type PricingConfig } from "./pricing.ts";
import { readAll } from "./core/util.ts";

type Scenario = { name: string; shipping_cost: number; bands: { below: number; cost: number }[] | null };
const mp = process.argv[2] ?? "trendyol";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const scenarios: Scenario[] = JSON.parse(readFileSync(new URL("../ops/price-impact.json", import.meta.url), "utf8")).scenarios;

const { data: s, error } = mp === "trendyol" ? await db.from("settings").select("*").eq("id", 1).single() : await db.from("marketplace_settings").select("*").eq("marketplace", mp).single();
if (error || !s) { console.error("ayar okunamadı:", error?.message); process.exit(1); }
const ls = await readAll<any>((a, b) => db.from("marketplace_listings").select("listing_key, price, commission, product_id, variant_id")
  .eq("marketplace", mp).eq("status", "live").gt("price", 0).not("product_id", "is", null).order("listing_key").range(a, b));
if (ls.error) { console.error("ilanlar okunamadı:", ls.error.message); process.exit(1); }
// Maliyet ürün kaydından (varyant > ürün; worker/core/db-products.ts priceFor ile aynı), yalnızca TL
const cost = new Map<string, number>();
const pids = [...new Set(ls.data.map((r: any) => r.product_id))], vids = [...new Set(ls.data.map((r: any) => r.variant_id).filter(Boolean))];
for (let i = 0; i < pids.length; i += 300) {
  const { data } = await db.from("products").select("id, cost_price, currency").in("id", pids.slice(i, i + 300));
  for (const p of data ?? []) if ((p.currency ?? "TRY") === "TRY" && Number(p.cost_price) > 0) cost.set(`p:${p.id}`, Number(p.cost_price));
}
for (let i = 0; i < vids.length; i += 300) {
  const { data } = await db.from("product_variants").select("id, cost_price").in("id", vids.slice(i, i + 300));
  for (const v of data ?? []) if (Number(v.cost_price) > 0) cost.set(`v:${v.id}`, Number(v.cost_price));
}
const rows = ls.data.map((r: any) => ({ ...r, xml_cost: cost.get(`v:${r.variant_id}`) ?? cost.get(`p:${r.product_id}`) ?? 0 })).filter((r: any) => r.xml_cost > 0);
const base = cfgFromSettings(s, Number(s.vat_rate ?? 20));
const pct = (x: number, n: number) => (n ? `%${((100 * x) / n).toFixed(0)}` : "-");
const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
const note = (title: string, msg: string) => console.log(`::notice title=${title}::${msg.replace(/\n/g, " ")}`);

note("Girdi", `${mp}: ${rows.length} yayındaki ilan (maliyet ve fiyatı bilinen). Bugünkü ayar: kargo ${base.shippingCost} TL, eşik ${base.freeShippingThreshold} TL, basamak ${JSON.stringify(s.shipping_bands ?? null)}, politika ${s.existing_price_policy}`);
for (const sc of scenarios) {
  const cfg: PricingConfig = { ...base, shippingCost: sc.shipping_cost, shippingBands: sc.bands?.length ? sc.bands : null };
  let loss = 0, thin = 0, up = 0, down = 0, same = 0, up20 = 0, fail = 0, lossAfter = 0, lossSum = 0;
  const ups: number[] = [];
  for (const r of rows) {
    const cost = Number(r.xml_cost), cur = Number(r.price), comm = Number(r.commission) > 0 ? Number(r.commission) : base.commissionRate;
    const now = breakdown(cur, cost, cfg, comm).net;
    if (now < 0) { loss++; lossSum += now; } else if (now < 20) thin++;
    const f = calcPrice(cost, cfg, comm);
    if (!f.ok) { fail++; continue; }
    const send = existingPriceSafe(String(s.existing_price_policy ?? "smart"), cur, f.price, cost, cfg, comm) ?? cur;
    if (breakdown(send, cost, cfg, comm).net < 0) lossAfter++;
    const d = (send - cur) / cur;
    if (Math.abs(d) < 0.005) same++; else if (d > 0) { up++; ups.push(d); if (d > 0.2) up20++; } else down++;
  }
  const n = rows.length;
  note(sc.name, `Bugünkü fiyatla gerçek kargoda ZARARDA: ${loss} ilan (${pct(loss, n)}, toplam ${lossSum.toFixed(0)} TL/sipariş), 20 TL altı kâr: ${thin} · `
    + `Yeni formülle: artacak ${up} (medyan +%${(100 * med(ups)).toFixed(0)}, %20 üstü ${up20}), düşecek ${down}, aynı ${same}, hesaplanamayan (stok 0) ${fail} · sonrasında zararda kalan ${lossAfter}`);
}
