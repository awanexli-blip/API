// Fiyat hesaplama: kargo eşiği (300 TL) ve KDV dahil.
// Girdi tutarları (maliyet, kargo, sabit gider, satış fiyatı) KDV DAHİL TL.
// KDV mükellefi + faturalı alım: alış, komisyon ve kargo faturasındaki KDV indirilir.
// Net kâr = KDV hariç satış - KDV hariç maliyet - KDV hariç (komisyon + kargo + sabit gider).
// Kâr oranı = net kâr / KDV hariç satış.
// Ürün ve hizmet KDV'si eşitse (%20) sonuç, eski "KDV dahil" formülle aynı fiyatı verir; farkı %10 / %1 KDV'li ürünler görür.

export interface PricingConfig {
  commissionRate: number;        // 0.18 (KDV dahil satış fiyatı üzerinden)
  targetProfitRate: number;      // 0.15 (KDV hariç satış üzerinden net kâr)
  shippingCost: number;          // 90 (KDV dahil)
  freeShippingThreshold: number; // 300 -> fiyat >= 300 ise kargoyu SEN ödersin
  minMarkup: number;             // 1.3 -> fiyat en az maliyet x 1.3
  fixedCost: number;             // paketleme vb. ürün başı sabit gider (KDV dahil)
  minAcceptableProfitRate: number; // 300 TL altına sıkıştırma durumunda kabul edilen en düşük kâr oranı
  maxPrice: number;              // bunun üstündeki ürünler atlanır
  vatRate?: number;              // ürünün KDV oranı (satış ve alış), varsayılan 0.20
  serviceVatRate?: number;       // komisyon/kargo faturası KDV'si, varsayılan 0.20
  commissionPlusVat?: boolean;   // komisyon oranı "+KDV" mi (fatura = oran x satış + KDV). Hepsiburada: evet
  shippingVatIncluded?: boolean; // kargo ücreti KDV dahil mi girildi (varsayılan evet). Hepsiburada tarifesi: hayır
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
  vatRate: 0.2,
  serviceVatRate: 0.2,
};

export interface PriceResult {
  ok: boolean;
  reason?: string;
  price: number;
  sellerPaysShipping: boolean;
  shipping: number;
  netProfit: number;   // KDV sonrası, cebe kalan
  profitRate: number;  // net / KDV hariç satış
  note?: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// 214 -> 219.90, 219.90 -> 219.90, 220 -> 229.90
export function roundUpPsych(x: number): number {
  return r2(Math.ceil((x + 0.1) / 10) * 10 - 0.1);
}

const vatOf = (cfg: PricingConfig) => cfg.vatRate ?? 0.2;
const svatOf = (cfg: PricingConfig) => cfg.serviceVatRate ?? 0.2;

export interface Breakdown {
  price: number; commission: number; shipping: number; fixed: number;
  vatDue: number;   // devlete ödenecek KDV farkı (satış KDV'si - indirilecek KDV)
  net: number; rate: number;
}

// Bir satıştaki tüm kalemler (TL)
export function breakdown(price: number, cost: number, cfg: PricingConfig, commission: number = cfg.commissionRate): Breakdown {
  const v = vatOf(cfg), sv = svatOf(cfg);
  // Tüm hizmet kalemleri KDV dahil tutara çevrilir (cebinden çıkan para)
  const shipping = r2((price >= cfg.freeShippingThreshold ? cfg.shippingCost : 0) * (cfg.shippingVatIncluded === false ? 1 + sv : 1));
  const comm = price * commission * (cfg.commissionPlusVat ? 1 + sv : 1);
  const services = comm + shipping + cfg.fixedCost;
  const vatDue = (price - cost) * v / (1 + v) - services * sv / (1 + sv);
  const net = price - cost - services - vatDue;
  const exVat = price / (1 + v);
  return { price, commission: r2(comm), shipping, fixed: cfg.fixedCost, vatDue: r2(vatDue), net: r2(net), rate: exVat > 0 ? net / exVat : 0 };
}

export function profitOf(price: number, cost: number, cfg: PricingConfig, commission: number) {
  const b = breakdown(price, cost, cfg, commission);
  return { shipping: b.shipping, net: b.net, rate: b.rate };
}

// Hedef kârı veren fiyat (yuvarlamadan önce). withShipping: kargo satıcıda
function targetPrice(cost: number, cfg: PricingConfig, commission: number, withShipping: boolean): number {
  const sv = svatOf(cfg);
  const a = 1 / (1 + vatOf(cfg)), b = 1 / (1 + sv);
  const c = commission * (cfg.commissionPlusVat ? 1 + sv : 1);                                   // KDV dahil komisyon oranı
  const ship = withShipping ? cfg.shippingCost * (cfg.shippingVatIncluded === false ? 1 + sv : 1) : 0; // KDV dahil kargo
  // net = a(P - cost) - b(cP + kargo + sabit) = t·a·P  =>  P = (a·cost + b(kargo + sabit)) / (a(1 - t) - b·c)
  const den = a * (1 - cfg.targetProfitRate) - b * c;
  return den > 0 ? (a * cost + b * (ship + cfg.fixedCost)) / den : Infinity;
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
  if (!Number.isFinite(targetPrice(cost, cfg, commissionRate, false))) return fail("komisyon + kâr %100 üstü");

  const floor = cost * cfg.minMarkup;
  const T = cfg.freeShippingThreshold;

  // 1) Kargo ödemiyormuşuz gibi hesapla (fiyat < 300 senaryosu)
  let price = roundUpPsych(Math.max(targetPrice(cost, cfg, commissionRate, false), floor));
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
      price = roundUpPsych(Math.max(targetPrice(cost, cfg, commissionRate, true), floor));
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

// Mevcut ilanda gönderilecek fiyat. null = fiyata dokunma.
//  keep    : fiyata dokunma
//  floor   : sadece formülün altındaysa yükselt, asla düşürme
//  formula : formül fiyatına eşitle (tek seferde düşebilir)
//  smart   : formülün altındaysa yükselt; üstündeyse her çalışmada en fazla maxDrop kadar düşürerek formüle yaklaştır.
//            Kargo eşiği istisnası: eşiğin altına (299,90) inmek hem daha ucuz hem daha kârlıysa doğrudan iner.
export const SMART_MAX_DROP = 0.10;

export function existingPrice(
  policy: string,
  current: number,
  formula: number,
  cfg: PricingConfig,
  commissionRate: number,
  maxDrop: number = SMART_MAX_DROP
): number | null {
  const known = Number.isFinite(current) && current > 0;
  if (policy === "keep") return null;
  if (policy === "floor") return known ? Math.max(current, formula) : null;
  if (policy !== "smart" || !known || formula >= current) return formula;

  const step = roundUpPsych(current * (1 - maxDrop));
  const candidate = step < current ? Math.max(formula, step) : current;
  const T = cfg.freeShippingThreshold;
  if (candidate >= T && formula < T) {
    const net = (p: number) => profitOf(p, 0, cfg, commissionRate).net; // maliyet iki tarafta da aynı, karşılaştırmada düşer
    if (net(formula) >= net(candidate)) return formula;
  }
  return candidate;
}
