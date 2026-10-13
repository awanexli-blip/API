// Fiyat hesaplama: kargo eşiği (300 TL) mantığı dahil.
// Tüm tutarlar KDV dahil TL.

export interface PricingConfig {
  commissionRate: number;        // 0.18
  targetProfitRate: number;      // 0.15 (satış fiyatı üzerinden net kâr)
  shippingCost: number;          // 90
  freeShippingThreshold: number; // 300 -> fiyat >= 300 ise kargoyu SEN ödersin
  minMarkup: number;             // 1.3 -> fiyat en az maliyet x 1.3
  fixedCost: number;             // paketleme vb. ürün başı sabit gider
  minAcceptableProfitRate: number; // 300 TL altına sıkıştırma durumunda kabul edilen en düşük kâr oranı
  maxPrice: number;              // bunun üstündeki ürünler atlanır
}

export const defaultConfig: PricingConfig = {
  commissionRate: 0.18,
  targetProfitRate: 0.15,
  shippingCost: 90,
  freeShippingThreshold: 300,
  minMarkup: 1.3,
  fixedCost: 0,
  minAcceptableProfitRate: 0.08,
  maxPrice: 10000,
};

export interface PriceResult {
  ok: boolean;
  reason?: string;
  price: number;
  sellerPaysShipping: boolean;
  shipping: number;
  netProfit: number;
  profitRate: number;
  note?: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// 214 -> 219.90, 219.90 -> 219.90, 220 -> 229.90
export function roundUpPsych(x: number): number {
  return r2(Math.ceil((x + 0.1) / 10) * 10 - 0.1);
}

function profitOf(price: number, cost: number, cfg: PricingConfig, commission: number) {
  const shipping = price >= cfg.freeShippingThreshold ? cfg.shippingCost : 0;
  const net = price * (1 - commission) - cost - cfg.fixedCost - shipping;
  return { shipping, net: r2(net), rate: price > 0 ? net / price : 0 };
}

export function calcPrice(
  cost: number,
  cfg: PricingConfig = defaultConfig,
  commissionRate: number = cfg.commissionRate
): PriceResult {
  const fail = (reason: string): PriceResult => ({
    ok: false, reason, price: 0, sellerPaysShipping: false, shipping: 0, netProfit: 0, profitRate: 0,
  });
  if (!(cost > 0)) return fail("maliyet yok");

  const den = 1 - commissionRate - cfg.targetProfitRate;
  if (den <= 0) return fail("komisyon + kâr %100 üstü");

  const floor = cost * cfg.minMarkup;
  const T = cfg.freeShippingThreshold;

  // 1) Kargo ödemiyormuşuz gibi hesapla (fiyat < 300 senaryosu)
  let price = roundUpPsych(Math.max((cost + cfg.fixedCost) / den, floor));
  let note: string | undefined;

  if (price >= T) {
    // 2) 300 TL ve üstü: kargo (90 TL) senin. Önce 299.90'a sıkıştırmayı dene.
    const squeezed = roundUpPsych(T - 0.2); // 299.90
    const sq = profitOf(squeezed, cost, cfg, commissionRate);
    if (squeezed < T && squeezed >= floor && sq.rate >= cfg.minAcceptableProfitRate) {
      price = squeezed;
      note = "299,90'a sabitlendi (kargo alıcıda, kâr hedefin biraz altında)";
    } else {
      // 3) Kargoyu maliyete ekleyerek yeniden hesapla
      price = roundUpPsych(Math.max((cost + cfg.fixedCost + cfg.shippingCost) / den, floor));
    }
  }

  if (price > cfg.maxPrice) return fail("fiyat üst sınırı aştı");

  const p = profitOf(price, cost, cfg, commissionRate);
  if (p.net <= 0) return fail("zarar");

  return {
    ok: true,
    price,
    sellerPaysShipping: p.shipping > 0,
    shipping: p.shipping,
    netProfit: p.net,
    profitRate: Math.round(p.rate * 1000) / 1000,
    note,
  };
}
