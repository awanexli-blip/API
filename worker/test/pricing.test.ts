// Fiyat formülü ve mevcut ilan politikası birim testleri.
// node --experimental-strip-types worker/test/pricing.test.ts
import { calcPrice, defaultConfig as cfg, existingPrice } from "../pricing.ts";

let fails = 0;
const check = (name: string, cond: boolean, info: unknown = "") => { console.log(`${cond ? "OK  " : "HATA"} ${name}${cond ? "" : "  " + JSON.stringify(info)}`); if (!cond) fails++; };
const netOf = (p: number, cost: number, k: number) => p * (1 - k) - cost - (p >= cfg.freeShippingThreshold ? cfg.shippingCost : 0);

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
