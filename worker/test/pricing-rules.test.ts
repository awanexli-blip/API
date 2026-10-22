// Akıllı kâr kuralları ve en az net kâr birim testleri.
// node --experimental-strip-types worker/test/pricing-rules.test.ts
import { calcPrice, breakdown, defaultConfig as cfg, returnsOf, existingPriceSafe } from "../pricing.ts";
import { applyRules, rulesFor, matches, SUGGESTED_RULES, describeCond, type PricingRule } from "../pricing-rules.ts";

let fails = 0;
const check = (name: string, cond: boolean, info: unknown = "") => { console.log(`${cond ? "OK  " : "HATA"} ${name}${cond ? "" : "  " + JSON.stringify(info)}`); if (!cond) fails++; };

// En az net kâr: ucuz üründe oran yetmez, TL tabanı devreye girer
{
  const plain = calcPrice(20, cfg, 0.18);
  const withMin = calcPrice(20, { ...cfg, minNetProfit: 20 }, 0.18);
  check("minNet: ucuz üründe fiyat yükselir", withMin.price > plain.price, { plain, withMin });
  check("minNet: net kâr ≥ 20 TL", withMin.netProfit >= 20, withMin);
  check("minNet: x9,90 yuvarlama korunur", Math.round(withMin.price * 100) % 1000 === 990, withMin.price);
  const hi = calcPrice(400, { ...cfg, minNetProfit: 30 }, 0.18);
  check("minNet: pahalıda oran zaten yeterli, fiyat değişmez", hi.price === calcPrice(400, cfg, 0.18).price, hi);
  const sq = calcPrice(200, { ...cfg, minNetProfit: 60 }, 0.18);
  check("minNet: 299,90 sıkıştırma net kârı tutmuyorsa yapılmaz", sq.price !== 299.9 && sq.netProfit >= 60, sq);
  check("minNet: kargo dahil senaryoda da tutar", breakdown(sq.price, 200, cfg, 0.18).net >= 60, sq);
}

// Kural eşleşmesi ve uygulama sırası
{
  const ctx = { cost: 80, supplier: "bayilik", category: "Ev & Yaşam >>> Mutfak", brand: "Eco Lounge", stock: 2 };
  check("eşleşme: maliyet aralığı", matches({ cost_min: 50, cost_max: 150 }, ctx) && !matches({ cost_min: 150 }, ctx));
  check("eşleşme: kategori içeren (duyarsız)", matches({ category: "mutfak" }, ctx) && !matches({ category: "bahçe" }, ctx));
  check("eşleşme: tedarikçi, marka, stok", matches({ supplier: "BAYILIK", brand: "eco lounge", stock_max: 3 }, ctx) && !matches({ stock_max: 1 }, ctx));
  const rules: PricingRule[] = SUGGESTED_RULES.map((r) => ({ ...r, marketplace: "all" }));
  rules.push({ name: "Mutfak özel", enabled: true, position: 35, marketplace: "trendyol", cond: { category: "Mutfak" }, target_profit_rate: 0.18 });
  rules.push({ name: "HB", enabled: true, position: 1, marketplace: "hepsiburada", cond: {}, target_profit_rate: 0.5 });
  const tr = rulesFor(rules, "trendyol");
  check("rulesFor: başka pazaryeri ve kapalı kural yok", !tr.some((r) => r.name === "HB" || !r.enabled));
  const a = applyRules(cfg, tr, ctx);
  check("uygula: kademe + sonra gelen özel kural ezer", a.cfg.targetProfitRate === 0.18 && a.cfg.minNetProfit === 25, a);
  check("uygula: uygulanan kural adları", a.applied.join("|") === "Ucuz (50-150 TL)|Mutfak özel", a.applied);
  const stock = applyRules(cfg, [...tr, { name: "Az stok", enabled: true, position: 99, marketplace: "all", cond: { stock_max: 3 }, add_profit_rate: 0.05 }], ctx);
  check("uygula: kâra ekleme en sonda toplanır", Math.abs(stock.cfg.targetProfitRate - 0.23) < 1e-9, stock.cfg.targetProfitRate);
  check("uygula: eşleşme yoksa ayar aynen", applyRules(cfg, tr, { cost: 80, category: "Bahçe" }).cfg.targetProfitRate === 0.22);
  check("uygula: üst sınır %60", applyRules(cfg, [{ name: "x", enabled: true, position: 1, marketplace: "all", cond: {}, target_profit_rate: 0.6, add_profit_rate: 0.3 }], ctx).cfg.targetProfitRate === 0.6);
  check("özet metni", describeCond({ cost_min: 50, cost_max: 150, category: "Mutfak" }) === 'maliyet 50-150 TL · kategori: "Mutfak" içeren');
}

// Önerilen kademeler: her maliyette zarar yok, ucuzda TL kâr anlamlı
{
  const tr = rulesFor(SUGGESTED_RULES.map((r) => ({ ...r, marketplace: "all" })), "trendyol");
  for (const cost of [10, 30, 49, 80, 149, 220, 480, 900, 2500]) {
    const r = calcPrice(cost, applyRules(cfg, tr, { cost }).cfg, 0.18);
    check(`kademe ${cost} TL: kârlı ve net ≥ 20 TL`, r.ok && r.netProfit >= 20, r);
  }
}

// İade gideri: oran × maliyet her siparişe eklenir, hedef kâr korunur, KDV indirimi dahil
{
  const ret = { ...cfg, returnRate: 0.05, returnCost: 180 };
  check("iade: sipariş başı pay 9 TL", returnsOf(ret) === 9, returnsOf(ret));
  const a = calcPrice(100, cfg, 0.18), b = calcPrice(100, ret, 0.18);
  check("iade: fiyat yükselir", b.price > a.price, { a: a.price, b: b.price });
  check("iade: hedef kâr korunur", b.profitRate >= 0.15, b);
  const bd = breakdown(b.price, 100, ret, 0.18);
  check("iade: kırılımda iade payı", bd.returns === 9, bd);
  // net = satış - alış - hizmetler - KDV farkı; iade payı hizmetlere girer
  const v = 0.2, services = bd.commission + bd.shipping + bd.fixed + bd.returns;
  const vat = (b.price - 100) * v / (1 + v) - services * v / (1 + v);
  check("iade: net kâr formülü (KDV indirimi dahil)", Math.abs(bd.net - (b.price - 100 - services - vat)) < 0.02, { bd, vat });
  check("iade: oran 0 iken fiyat değişmez", calcPrice(100, { ...cfg, returnRate: 0, returnCost: 180 }, 0.18).price === a.price);
}

// 299,90 sıkıştırması: TL tabanı (yüzde eşiği ve kural TL şartı yerine)
{
  const live = { ...cfg, minAcceptableProfitRate: 0.12, returnRate: 0.05, returnCost: 180 };
  const tiers = rulesFor(SUGGESTED_RULES.map((r) => ({ ...r, marketplace: "all" })), "trendyol");
  const at = (cost: number, sq: number | null) => calcPrice(cost, { ...applyRules(live, tiers, { cost }).cfg, squeezeMinNet: sq }, 0.18);
  const old = at(210, null), neu = at(210, 15); // 210 TL: 299,90 net ~22 TL (%9) — yüzde eşiği (%12) reddederdi
  check("sıkıştırma: TL tabanı yokken 210 TL maliyet kargolu fiyata fırlar", old.price > 400, old);
  check("sıkıştırma: en az 15 TL ile 299,90'a döner", neu.price === 299.9 && neu.netProfit >= 15, neu);
  check("sıkıştırma: 15 TL'yi tutmuyorsa yapılmaz", at(260, 15).price > 300, at(260, 15));
  check("sıkıştırma: ucuz üründe etkisi yok", at(80, 15).price === at(80, null).price);
}

// Çoklu adet koruması: eşiği geçecek kadar adet alınınca (kargo satıcıda) sipariş yine en az N TL net
{
  const live = { ...cfg, minAcceptableProfitRate: 0.12, returnRate: 0.05, returnCost: 180, squeezeMinNet: 15 };
  const order = (price: number, cost: number, c: typeof live, comm: number, n: number) => {
    const one = breakdown(price, cost, c, comm).net;
    return n * one - (n * price >= c.freeShippingThreshold ? c.shippingCost / 1.2 : 0);
  };
  // Dizlik: maliyet 153, komisyon %15,6 -> tek adet 249,90; 2 adette kargo sende, net ~6 TL
  const off = calcPrice(153, live, 0.156), on = calcPrice(153, { ...live, multiUnitMinNet: 15 }, 0.156);
  check("çoklu adet: kapalıyken 2 adet kârı 15 TL altında", order(off.price, 153, live, 0.156, 2) < 15, off);
  check("çoklu adet: açıkken fiyat yükselir", on.price > off.price && on.price < 300, on);
  check("çoklu adet: 2 adet siparişte en az 15 TL net", order(on.price, 153, live, 0.156, 2) >= 15, { p: on.price, net2: order(on.price, 153, live, 0.156, 2) });
  // 100-150 TL bandı: 3 adet senaryosu
  const c3 = calcPrice(70, { ...live, multiUnitMinNet: 15 }, 0.18), n3 = Math.ceil(300 / c3.price);
  check("çoklu adet: ucuz üründe eşik adedinde de kârlı", c3.price >= 300 || order(c3.price, 70, live, 0.18, n3) >= 15, { c3, n3 });
  // 299,90 sıkıştırması da korumayı geçmeli (2 adet = kargo sende)
  const sq = calcPrice(210, { ...live, multiUnitMinNet: 15 }, 0.18);
  check("çoklu adet: 299,90 yalnızca 2 adette de kârlıysa", sq.price !== 299.9 || order(299.9, 210, live, 0.18, 2) >= 15, sq);
  check("çoklu adet: 300 üstü ürünlerde etkisi yok", calcPrice(400, { ...live, multiUnitMinNet: 15 }, 0.18).price === calcPrice(400, live, 0.18).price);
  // smart adımı korumayı bozmamalı
  const lc = { ...live, multiUnitMinNet: 15 };
  const f = calcPrice(60, lc, 0.18).price, s = existingPriceSafe("smart", 199.9, f, 60, lc, 0.18)!;
  check("çoklu adet: smart adımı korumalı", s >= 300 || order(s, 60, lc, 0.18, Math.ceil(300 / s)) >= 15 - 0.01, { f, s });
}

// Kademeli net kâr aralığı (K, 22.10): maliyet 1500+ 100-150, 3000+ 150-250, 4000+ 300-350, altı ayarlardaki 40-60
{
  const base = { ...cfg, netProfitMin: 40, netProfitMax: 60, multiUnitMinNet: null };
  const tiers: PricingRule[] = [
    { name: "1500-3000", enabled: true, position: 70, marketplace: "all", cond: { cost_min: 1500, cost_max: 3000 }, net_profit_min: 100, net_profit_max: 150 },
    { name: "3000-4000", enabled: true, position: 80, marketplace: "all", cond: { cost_min: 3000, cost_max: 4000 }, net_profit_min: 150, net_profit_max: 250 },
    { name: "4000+", enabled: true, position: 90, marketplace: "all", cond: { cost_min: 4000 }, net_profit_min: 300, net_profit_max: 350 },
  ];
  for (const [c, lo, hi] of [[1000, 40, 60], [1500, 100, 150], [3500, 150, 250], [6000, 300, 350]] as const) {
    const r = calcPrice(c, applyRules(base, tiers, { cost: c }).cfg, 0.18);
    check(`kademe: ${c} TL maliyet net ${lo}-${hi} (${r.netProfit})`, r.ok && r.netProfit >= lo - 0.01 && r.netProfit <= hi, r);
  }
}

if (fails) { console.log(`\n${fails} kural testi başarısız`); process.exit(1); }
console.log("\nKâr kuralı testleri geçti");
