// Fiyat formülü ve mevcut ilan politikası birim testleri.
// node --experimental-strip-types worker/test/pricing.test.ts
import { calcPrice, defaultConfig as cfg, existingPrice, breakdown } from "../pricing.ts";

let fails = 0;
const check = (name: string, cond: boolean, info: unknown = "") => { console.log(`${cond ? "OK  " : "HATA"} ${name}${cond ? "" : "  " + JSON.stringify(info)}`); if (!cond) fails++; };
const netOf = (p: number, cost: number, k: number) => breakdown(p, cost, cfg, k).net;

// calcPrice: hedef kâr, kargo eşiği, zarar yok
{
  const r = calcPrice(100, cfg, 0.18);
  check("calc: 300 altı, kargo alıcıda", r.ok && r.price < 300 && !r.sellerPaysShipping, r);
  check("calc: kâr ≥ %15", r.profitRate >= 0.15, r);
  const sq = calcPrice(200, cfg, 0.18);
  check("calc: eşiğe sıkıştırma 299,90", sq.price === 299.9, sq);
  const hi = calcPrice(400, cfg, 0.18);
  check("calc: 300 üstü kargo dahil kâr ≥ %15", hi.price >= 300 && hi.sellerPaysShipping && hi.profitRate >= 0.15, hi);
  check("calc: maliyetsiz atlanır", !calcPrice(0, cfg).ok);
}

// KDV
{
  // %20 KDV'de fiyat eski "KDV dahil" formülle aynı: (maliyet [+kargo]) / (1 - komisyon - kâr), x9,90 yukarı
  const old = (c: number, ship = 0) => Math.ceil(((c + ship) / (1 - 0.18 - 0.15) + 0.1) / 10) * 10 - 0.1;
  for (const c of [30, 60, 100, 150]) check(`kdv20: ${c} TL eski formülle aynı`, Math.abs(calcPrice(c, cfg).price - old(c)) < 0.01, [calcPrice(c, cfg).price, old(c)]);
  check("kdv20: 400 TL (kargo dahil) eski formülle aynı", Math.abs(calcPrice(400, cfg).price - old(400, 90)) < 0.01, [calcPrice(400, cfg).price, old(400, 90)]);
  // Net kâr KDV sonrası: 30 TL maliyet, 49,90 satış -> eski gösterim 10,92 TL, gerçek 10,92/1,2
  const b = breakdown(49.9, 30, cfg, 0.18);
  check("kdv: net = (satış - maliyet - komisyon) / 1,2", Math.abs(b.net - (49.9 - 30 - 49.9 * 0.18) / 1.2) < 0.01, b);
  check("kdv: kalemler toplamı satışa eşit", Math.abs(b.commission + b.shipping + b.fixed + b.vatDue + b.net + 30 - 49.9) < 0.02, b);
  check("kdv: oran KDV hariç satışa göre ~%15+", b.rate >= 0.15, b.rate);
  // %10 KDV'li üründe komisyon/kargo KDV'si (%20) daha çok indirilir -> fiyat daha düşük ama kâr hedefi tutar
  const r10 = calcPrice(300, { ...cfg, vatRate: 0.1 }), r20 = calcPrice(300, cfg);
  check("kdv10: fiyat %20'den düşük", r10.price < r20.price, [r10.price, r20.price]);
  check("kdv10: kâr ≥ %15", r10.profitRate >= 0.15, r10);
  const r1 = calcPrice(100, { ...cfg, vatRate: 0.01 });
  check("kdv1: kâr ≥ %15", r1.ok && r1.profitRate >= 0.15, r1);
}

// Komisyon +KDV ve KDV hariç kargo (Hepsiburada)
{
  const hb = { ...cfg, commissionPlusVat: true, shippingVatIncluded: false, freeShippingThreshold: 0, shippingCost: 80 };
  const r = calcPrice(200, hb, 0.18);
  const b = breakdown(r.price, 200, hb, 0.18);
  check("hb: komisyon KDV'li", Math.abs(b.commission - r.price * 0.18 * 1.2) < 0.01, b);
  check("hb: kargo KDV'li (80 -> 96)", b.shipping === 96, b);
  check("hb: kâr ≥ %15", r.ok && r.profitRate >= 0.15, r);
  check("hb: kalemler toplamı", Math.abs(b.commission + b.shipping + b.vatDue + b.net + 200 - r.price) < 0.02, b);
  check("hb: +KDV komisyonla fiyat daha yüksek", r.price > calcPrice(200, { ...hb, commissionPlusVat: false }, 0.18).price);
}

// existingPrice
{
  check("keep: dokunma", existingPrice("keep", 500, 400, cfg, 0.18) === null);
  check("floor: düşürmez", existingPrice("floor", 500, 400, cfg, 0.18) === 500);
  check("floor: yükseltir", existingPrice("floor", 300, 400, cfg, 0.18) === 400);
  check("formula: eşitler", existingPrice("formula", 500, 400, cfg, 0.18) === 400);
  check("smart: zarardakini formüle yükseltir", existingPrice("smart", 300, 459.9, cfg, 0.18) === 459.9);
  const step = existingPrice("smart", 1000, 500, cfg, 0.18)!;
  check("smart: en fazla %10 düşer", step < 1000 && step >= 900 && step === 909.9, step);
  check("smart: formülün altına inmez", existingPrice("smart", 520, 499.9, cfg, 0.18) === 499.9);
  // 300-410 ölü bölge: 299,90 hem ucuz hem kârlı -> doğrudan iner
  const cost = 200, k = 0.18;
  const dz = existingPrice("smart", 359.9, 299.9, cfg, k)!;
  check("smart: ölü bölgeden 299,90'a iner", dz === 299.9, dz);
  check("smart: 299,90 daha kârlı", netOf(299.9, cost, k) > netOf(359.9, cost, k));
  // 600'den 299,90'a tek seferde inmez (kâr düşer), kademeli iner
  const big = existingPrice("smart", 600, 299.9, cfg, k)!;
  check("smart: yüksek fiyattan kademeli", big === 549.9 || (big > 500 && big < 600), big);
  // 330 -> %10 adım 299,90 (eşiğin altı, hem ucuz hem kârlı), formüle sonraki çalışmalarda iner
  const s2 = existingPrice("smart", 330, 249.9, cfg, k)!;
  check("smart: eşik altına kademeli geçiş", s2 === 299.9 && netOf(299.9, 100, k) > netOf(330, 100, k), s2);
  check("smart: bilinmeyen fiyat -> formül", existingPrice("smart", NaN, 400, cfg, k) === 400);
}

console.log(fails ? `\n${fails} birim testi başarısız` : "\nBirim testleri geçti");
process.exit(fails ? 1 : 0);
