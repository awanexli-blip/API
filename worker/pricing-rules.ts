// Akıllı kâr kuralları: ürünün maliyetine, tedarikçisine, kategorisine, markasına ve stoğuna göre hedef kâr / en az net kâr.
// Kurallar sırayla uygulanır; eşleşen her kural yalnızca doldurduğu alanları ezer (sonraki kazanır, CSS gibi).
// Eşleşen kural yoksa pazaryerinin fiyat ayarları geçerlidir. Worker (canlı fiyat) ve panel (simülasyon) aynı kodu kullanır.
import type { PricingConfig } from "./pricing.ts";

export type RuleCond = {
  cost_min?: number | null;      // maliyet (KDV dahil TL) >=
  cost_max?: number | null;      // maliyet <
  supplier?: string | null;      // tedarikçi kodu (ör. "bayilik")
  category?: string | null;      // kategori adında geçen metin (büyük/küçük harf duyarsız)
  brand?: string | null;         // marka (tam eşleşme, duyarsız)
  stock_max?: number | null;     // stok <= (az kalan ürün)
};
export type PricingRule = {
  id?: string; name: string; enabled: boolean; position: number; marketplace: string; // "all" veya pazaryeri kodu
  cond: RuleCond;
  target_profit_rate?: number | null; // 0.15
  min_net_profit?: number | null;     // TL
  add_profit_rate?: number | null;    // hedef kâra eklenir (ör. az stokta +0.05); diğer kurallardan sonra toplanır
};
export type RuleCtx = { cost: number; supplier?: string; category?: string; brand?: string; stock?: number };

// Türkçe küçük harf + ı/i farkı yok sayılır ("BAYILIK" = "bayilik", "MUTFAK" = "mutfak")
const low = (s: unknown) => String(s ?? "").toLocaleLowerCase("tr").replace(/ı/g, "i").trim();
const has = (v: unknown) => v !== null && v !== undefined && v !== "";

export function matches(c: RuleCond, x: RuleCtx): boolean {
  if (has(c.cost_min) && !(x.cost >= Number(c.cost_min))) return false;
  if (has(c.cost_max) && !(x.cost < Number(c.cost_max))) return false;
  if (has(c.supplier) && low(c.supplier) !== low(x.supplier)) return false;
  if (has(c.category) && !low(x.category).includes(low(c.category))) return false;
  if (has(c.brand) && low(c.brand) !== low(x.brand)) return false;
  if (has(c.stock_max) && !(Number(x.stock ?? Infinity) <= Number(c.stock_max))) return false;
  return true;
}

// Pazaryerine ait (ve "all") etkin kurallar sırayla
export function rulesFor(rules: PricingRule[], marketplace: string): PricingRule[] {
  return rules.filter((r) => r.enabled && (r.marketplace === "all" || r.marketplace === marketplace)).sort((a, b) => a.position - b.position);
}

export function applyRules(cfg: PricingConfig, rules: PricingRule[], ctx: RuleCtx): { cfg: PricingConfig; applied: string[] } {
  const out = { ...cfg };
  const applied: string[] = [];
  let add = 0;
  for (const r of rules) {
    if (!matches(r.cond ?? {}, ctx)) continue;
    let used = false;
    if (has(r.target_profit_rate)) { out.targetProfitRate = Number(r.target_profit_rate); used = true; }
    if (has(r.min_net_profit)) { out.minNetProfit = Number(r.min_net_profit); used = true; }
    if (has(r.add_profit_rate)) { add += Number(r.add_profit_rate); used = true; }
    if (used) applied.push(r.name);
  }
  // Komisyon + kâr %100'e yaklaşmasın (formül sonsuza gider)
  out.targetProfitRate = Math.min(0.6, Math.max(0, out.targetProfitRate + add));
  return { cfg: out, applied };
}

// Önerilen kademeli kâr: ucuz üründe paketleme, iade ve uğraş payı yüzdece daha büyük; pahalıda yüzde düşer, TL kâr yine yüksek kalır.
// En az net kâr: 30 TL'lik üründe %15 = 5 TL; bir iade bile bunu siler.
export const SUGGESTED_RULES: Omit<PricingRule, "marketplace">[] = [
  { name: "Çok ucuz (0-50 TL)", enabled: true, position: 10, cond: { cost_max: 50 }, target_profit_rate: 0.30, min_net_profit: 20 },
  { name: "Ucuz (50-150 TL)", enabled: true, position: 20, cond: { cost_min: 50, cost_max: 150 }, target_profit_rate: 0.22, min_net_profit: 25 },
  { name: "Orta (150-500 TL)", enabled: true, position: 30, cond: { cost_min: 150, cost_max: 500 }, target_profit_rate: 0.16, min_net_profit: 35 },
  { name: "Pahalı (500-1500 TL)", enabled: true, position: 40, cond: { cost_min: 500, cost_max: 1500 }, target_profit_rate: 0.12, min_net_profit: 60 },
  { name: "Çok pahalı (1500+ TL)", enabled: true, position: 50, cond: { cost_min: 1500 }, target_profit_rate: 0.10, min_net_profit: 120 },
  { name: "Az stok (≤ 3): kâra +%5", enabled: false, position: 60, cond: { stock_max: 3 }, add_profit_rate: 0.05 },
];

// Kuralın okunur özeti: "maliyet 50-150 TL · kategori: Mutfak"
export function describeCond(c: RuleCond): string {
  const p: string[] = [];
  if (has(c.cost_min) || has(c.cost_max)) p.push(`maliyet ${has(c.cost_min) ? c.cost_min : 0}${has(c.cost_max) ? `-${c.cost_max}` : "+"} TL`);
  if (has(c.supplier)) p.push(`tedarikçi: ${c.supplier}`);
  if (has(c.category)) p.push(`kategori: "${c.category}" içeren`);
  if (has(c.brand)) p.push(`marka: ${c.brand}`);
  if (has(c.stock_max)) p.push(`stok ≤ ${c.stock_max}`);
  return p.join(" · ") || "tüm ürünler";
}
