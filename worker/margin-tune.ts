// Marj ölçeği denemesi (K 17.11: "ortalama net kâr 50-60 TL olsun, pahalı ürünlerde de oran orantı düşsün"). SALT OKUNUR.
//   node --experimental-strip-types worker/margin-tune.ts [--days 60] [--scales 1,0.8,0.6,0.5]
// Son N günün tedarikçi siparişleri (gerçek maliyet + komisyon + rakip durumu) bugünkü ayarla, marj oranları ölçeklenerek yeniden fiyatlanır;
// beklenen net kâr (kupon payı dahil) ortalaması ve fiyat basamağına göre dağılımı yazılır.
import { createClient } from "@supabase/supabase-js";
import { calcPrice, breakdown, cfgFromSettings } from "./pricing.ts";
import { readAll, isOwnListing } from "./core/util.ts";
import { parseDyn, marginFor, DEFAULT_DYN } from "./core/dynamic-margin.ts";

const days = Number(process.argv[process.argv.indexOf("--days") + 1]) || 60;
const scales = String(process.argv[process.argv.indexOf("--scales") + 1] ?? "").split(",").map(Number).filter((x) => x > 0);
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data: s } = await db.from("settings").select("*").eq("id", 1).single();
const cfg = cfgFromSettings(s);
const dyn = parseDyn(s.dynamic_margin) ?? DEFAULT_DYN;
const o = await readAll<any>((a, b) => db.from("orders").select("order_no, status, fin, order_lines(listing_key, title, qty, cost_snapshot, commission_rate)").eq("marketplace", "trendyol")
  .gte("ordered_at", new Date(Date.now() - days * 864e5).toISOString()).order("id").range(a, b));
const bb = await readAll<any>((a, b) => db.from("listing_buybox").select("listing_key, multiple").eq("marketplace", "trendyol").order("listing_key").range(a, b));
const comp = new Map((bb.data ?? []).map((x: any) => [x.listing_key, x.multiple === true]));
type Line = { cost: number; comm: number; comp: boolean | undefined; qty: number };
const lines: Line[] = [];
for (const x of o.data as any[]) {
  if (["cancelled", "returned"].includes(x.status)) continue;
  for (const l of x.order_lines ?? []) {
    if (isOwnListing(l.listing_key, l.title) || !(Number(l.cost_snapshot) > 0)) continue;
    lines.push({ cost: Number(l.cost_snapshot), comm: Number(l.commission_rate) || cfg.commissionRate, comp: comp.get(l.listing_key), qty: 1 });
  }
}
const r2 = (n: number) => Math.round(n * 100) / 100;
const run = (k: number) => {
  const nets: { price: number; net: number }[] = [];
  for (const l of lines) {
    const base = { ...cfg, netMarginMin: cfg.netMarginMin != null ? cfg.netMarginMin * k : null };
    const r = calcPrice(l.cost, base, l.comm);
    if (!r.ok) continue;
    const m = marginFor({ ...dyn, competition: dyn.competition * k, alone: dyn.alone * k, bands: dyn.bands.map(([u, v]) => [u, v * k] as [number | null, number]) }, { competition: l.comp, price: r.price });
    const r2_ = calcPrice(l.cost, { ...base, netMarginMin: m }, l.comm);
    const p = r2_.ok ? r2_.price : r.price;
    nets.push({ price: p, net: breakdown(p, l.cost, cfg, l.comm).net });
  }
  const band = (lo: number, hi: number) => { const xs = nets.filter((x) => x.price >= lo && x.price < hi); return xs.length ? { n: xs.length, ortNet: r2(xs.reduce((t, x) => t + x.net, 0) / xs.length) } : null; };
  const sorted = nets.map((x) => x.net).sort((a, b) => a - b);
  return { olcek: k, satir: nets.length, ortNet: r2(nets.reduce((t, x) => t + x.net, 0) / nets.length), medyan: r2(sorted[Math.floor(sorted.length / 2)]),
    "<500": band(0, 500), "500-1500": band(500, 1500), "1500-3000": band(1500, 3000), "3000+": band(3000, 1e9) };
};
console.log(JSON.stringify({ satir: lines.length, rakipli: lines.filter((l) => l.comp === true).length, tek: lines.filter((l) => l.comp === false).length, dyn, netMarginMin: cfg.netMarginMin, sonuc: (scales.length ? scales : [1, 0.8, 0.65, 0.5, 0.4]).map(run) }, null, 1));
