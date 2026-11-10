// Kasım kampanyası indirim payı (salt okunur; pazaryerine ve veritabanına yazmaz).
// Bugünkü canlı fiyattan % indirim yapılınca gerçek kesintilerle (komisyon, kargo, KDV, iade payı, kâr kuralları) kaç ilanın kârda kaldığını sayar.
//   trentakip-vps worker/kampanya-plan.ts [trendyol|hepsiburada]
// Müşteri verisi okumaz. Pazaryerinin kendi kampanya komisyonu ve kampanya katılım koşulları bu hesapta yok.
import { createClient } from "@supabase/supabase-js";
import { breakdown, cfgFromSettings, type PricingConfig } from "./pricing.ts";
import { applyRules, rulesFor, type PricingRule } from "./pricing-rules.ts";
import { tyShipCfg } from "./core/trendyol-cargo.ts";
import { readAll } from "./core/util.ts";
import { getMarketplace } from "./marketplaces/index.ts";

const DISCOUNTS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3];
const FLOORS = [0, 20, 40];
// 219,90 gibi: indirimli fiyat aşağı yuvarlanır, ilan fiyatından yüksek çıkmaz
export const downPsych = (x: number) => Math.round((Math.floor((x + 0.1) / 10) * 10 - 0.1) * 100) / 100;
// Verilen indirim oranları içinde net kârı alt sınırın üstünde tutan en büyük oran (yoksa 0)
export function maxDiscount(cur: number, netAt: (p: number) => number, floor: number, steps = DISCOUNTS) {
  let best = 0;
  for (const d of steps) { const p = downPsych(cur * (1 - d)); if (p > 0 && netAt(p) >= floor) best = d; else break; }
  return best;
}

async function run(mpId: string) {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: base, error } = await db.from("settings").select("*").eq("id", 1).single();
  if (error || !base) throw new Error("ayar okunamadı: " + error?.message);
  let s: any = base;
  if (mpId !== "trendyol") { const { data: ms } = await db.from("marketplace_settings").select("*").eq("marketplace", mpId).maybeSingle(); s = { ...base }; for (const [k, v] of Object.entries(ms ?? {})) if (v != null) s[k] = v; }
  const mp = getMarketplace(mpId);
  const cfg = cfgFromSettings(s, Number(s.vat_rate ?? 20));
  const pr = await readAll<any>((a, b) => db.from("pricing_rules").select("*").order("id").range(a, b));
  const rules = rulesFor((pr.data ?? []) as PricingRule[], mpId);
  const cm = await readAll<any>((a, b) => db.from("category_map").select("xml_category, commission_rate").eq("marketplace", mpId).order("xml_category").range(a, b));
  const panelRate = new Map<string, number>((cm.data ?? []).filter((x: any) => x.commission_rate != null).map((x: any) => [x.xml_category, Number(x.commission_rate)]));
  const defaultDesi = Number(s.default_desi ?? 2);
  const byDesi = s.shipping_mode === "desi" && !!mp.shippingCost;
  const ls = await readAll<any>((a, b) => db.from("marketplace_listings")
    .select("listing_key, price, commission, stock, category_name, product_variants(cost_price), products(source, cost_price, currency, vat_rate, category, brand, desi, title, attributes)")
    .eq("marketplace", mpId).eq("status", "live").gt("stock", 0).gt("price", 0).order("listing_key").range(a, b));
  if (ls.error) throw new Error(ls.error.message);

  let noCost = 0, lossNow = 0, lowNow = 0; const nets: number[] = [], shares: number[] = [];
  const atDisc = DISCOUNTS.map(() => [0, 0, 0]);   // [d][floor] kaç ilan bu indirimde alt sınırı karşılıyor
  const max40: Record<string, number> = {}; const bySupplier: Record<string, { n: number; ok10: number; ok20: number }> = {};
  const fx: Record<string, number> = { TL: 1, TRY: 1, USD: Number(s.fx_usd), EUR: Number(s.fx_eur) };
  for (const r of ls.data) {
    const p = r.products, v = r.product_variants;
    if (!p) { noCost++; continue; }
    const cost = Number(v?.cost_price ?? p.cost_price) * (fx[p.currency ?? "TRY"] ?? 0);
    if (!(cost > 0)) { noCost++; continue; }
    const cur = Number(r.price);
    const panel = panelRate.get(p.category) ?? null;
    const comm = mpId === "trendyol" && Number(r.commission) > 0 ? Number(r.commission)
      : mp.commission(r.listing_key, p.category ?? "", panel, cfg.commissionRate, { category: r.category_name ?? "", title: p.title }).rate;
    const b: PricingConfig = { ...cfg, vatRate: Number(p.vat_rate ?? 20) / 100,
      ...(mpId === "trendyol" && s.cargo_carrier ? tyShipCfg(p.desi, s.cargo_carrier, s.cargo_fast === true, defaultDesi) ?? {} : byDesi ? { shippingCost: mp.shippingCost!(Math.max(1, Math.ceil(Number(p.desi) || defaultDesi)), s.cargo_carrier) } : {}) };
    const sup = String(p.source ?? "").replace(/^xml:/, "") || "?";
    const c = rules.length ? applyRules(b, rules, { cost, supplier: sup, category: p.category, brand: p.brand, stock: Number(r.stock) }).cfg : b;
    const netAt = (x: number) => breakdown(x, cost, c, comm).net;
    const now = netAt(cur);
    nets.push(now); shares.push(now / cur);
    if (now < 0) lossNow++; else if (now < 40) lowNow++;
    DISCOUNTS.forEach((d, i) => { const n = netAt(downPsych(cur * (1 - d))); FLOORS.forEach((f, j) => { if (n >= f) atDisc[i][j]++; }); });
    const m = maxDiscount(cur, netAt, 40);
    max40[String(Math.round(m * 100))] = (max40[String(Math.round(m * 100))] ?? 0) + 1;
    const g = (bySupplier[sup] ??= { n: 0, ok10: 0, ok20: 0 }); g.n++; if (m >= 0.1) g.ok10++; if (m >= 0.2) g.ok20++;
  }
  const n = nets.length, srt = [...nets].sort((a, b) => a - b), med = (a: number[]) => a[Math.floor(a.length / 2)] ?? 0;
  console.log(JSON.stringify({ pazaryeri: mpId, ilan: ls.data.length, hesaplanan: n, maliyetsiz: noCost, kargoFirma: s.cargo_carrier ?? null, kuralSayisi: rules.length,
    bugunMedyanNet: med(srt), bugunZararda: lossNow, bugun40TLAlti: lowNow,
    indirimdeKalan: DISCOUNTS.map((d, i) => ({ indirim: `%${Math.round(d * 100)}`, net0Ustu: atDisc[i][0], net20Ustu: atDisc[i][1], net40Ustu: atDisc[i][2], net40Oran: n ? `%${Math.round((100 * atDisc[i][2]) / n)}` : "-" })),
    net40IleVerilebilenEnFazlaIndirim: max40, tedarikci: bySupplier }, null, 0));
}

if (process.argv[1]?.endsWith("kampanya-plan.ts")) for (const m of process.argv[2] ? [process.argv[2]] : ["trendyol", "hepsiburada"]) await run(m);
