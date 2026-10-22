// Fiyat formülü ve mevcut ilan politikası birim testleri.
// node --experimental-strip-types worker/test/pricing.test.ts
import { calcPrice, defaultConfig as cfg, existingPrice, breakdown, shippingAt, bandsFrom } from "../pricing.ts";

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

// Kargo basamakları (Hepsiburada barem): her siparişte satıcı öder, KDV hariç tutarlar
{
  const hb = { ...cfg, commissionRate: 0.15, commissionPlusVat: true, shippingVatIncluded: false, shippingCost: 81.99, fixedCost: 13.19,
    shippingBands: bandsFrom([{ below: 400, cost: 75.99 }, { below: 200, cost: 43.99 }]) };
  check("bant: sıralı", hb.shippingBands![0].below === 200, hb.shippingBands);
  check("bant: geçersiz satır atılır", bandsFrom([{ below: 0, cost: 5 }, { below: 200, cost: 10 }])!.length === 1);
  check("bant: null -> null", bandsFrom(null) === null);
  check("bant: 150 TL -> 43,99", shippingAt(150, hb) === 43.99);
  check("bant: 199,90 -> 43,99", shippingAt(199.9, hb) === 43.99);
  check("bant: 200 -> 75,99", shippingAt(200, hb) === 75.99);
  check("bant: 400 -> desi", shippingAt(400, hb) === 81.99);
  for (const c of [20, 50, 90, 130, 180, 260, 600]) {
    const r = calcPrice(c, hb, 0.15);
    const b = breakdown(r.price, c, hb, 0.15);
    const want = r.price < 200 ? 43.99 : r.price < 400 ? 75.99 : 81.99;
    check(`bant: ${c} TL maliyet -> ${r.price} kargo basamağı doğru, kâr > 0`, r.ok && Math.abs(b.shipping - want * 1.2) < 0.02 && b.net > 0, [r, b]);
    check(`bant: ${c} TL hedef kâr ya da sıkıştırma`, r.profitRate >= 0.15 || (r.note ?? "").includes("sabitlendi"), r);
  }
  // Fiyat bir basamağa sığmıyorsa sınırın hemen altına (199,90 / 399,90) sıkıştırma denenir
  const sq = [...Array(400).keys()].map((i) => calcPrice(40 + i * 0.5, { ...hb, squeezeMinNet: 1 }, 0.15)).filter((r) => r.ok && (r.price === 199.9 || r.price === 399.9));
  check("bant: 199,90 / 399,90 sıkıştırması oluşur", sq.length > 0 && sq.every((r) => (r.note ?? "").includes("sabitlendi") || r.profitRate >= 0.15), sq.length);
  // Basamaksız yapılandırma eskisi gibi
  check("bant yok: eski davranış", calcPrice(200, { ...cfg, shippingBands: null }, 0.18).price === 299.9);
}

// Net kâr TL aralığı (40-60): yüzde hedefi ve 1,3x taban yok
{
  const hb = { ...cfg, commissionRate: 0.15, commissionPlusVat: true, shippingVatIncluded: false, shippingCost: 81.99, fixedCost: 13.19, returnRate: 0.05, returnCost: 180,
    squeezeMinNet: 40, shippingBands: bandsFrom([{ below: 200, cost: 43.99 }, { below: 400, cost: 75.99 }]), netProfitMin: 40, netProfitMax: 60 };
  for (const c of [20, 60, 142, 300, 800, 2500]) {
    const r = calcPrice(c, hb, 0.1);
    check(`net aralık: ${c} TL maliyet -> ${r.price} net ${r.netProfit}`, r.ok && r.netProfit >= 39.99 && r.netProfit <= 60, r);
  }
  const ty = { ...cfg, netProfitMin: 40, netProfitMax: 60, multiUnitMinNet: null };
  for (const c of [30, 150, 1000]) { const r = calcPrice(c, ty, 0.18); check(`net aralık (Trendyol): ${c} -> ${r.price} net ${r.netProfit}`, r.ok && r.netProfit >= 39.99 && r.netProfit <= 60, r); }
  check("net aralık: oran modundan ucuz", calcPrice(800, hb, 0.1).price < calcPrice(800, { ...hb, netProfitMin: null }, 0.1).price);
}

console.log(fails ? `\n${fails} birim testi başarısız` : "\nBirim testleri geçti");
process.exit(fails ? 1 : 0);
