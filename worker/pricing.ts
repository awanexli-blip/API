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
  minNetProfit?: number;         // sipariş başı en az net kâr (TL). Ucuz üründe oran tek başına yetmez (kâr kuralları)
  // Net kâr TL aralığı (K, 22.10: "net kâr 40-60 TL olsun, yüzde hedefi çok pahalı yapıyor"). Doluysa yüzde hedefi, kâr kuralları ve
  // 1,3x taban kullanılmaz: fiyat, en az netProfitMin bırakan en ucuz x9,90 fiyattır (yuvarlama payıyla netProfitMax'ı geçmez).
  netProfitMin?: number | null;
  netProfitMax?: number | null;
  // En az kâr marjı (K, 25.10: "marj %10-20, ama cebime en az 40 TL"): net kâr TL modunda fiyat hem en az netProfitMin TL hem en az bu oran
  // (KDV hariç satışa göre net) bırakan en ucuz fiyat. Boş = yalnızca TL alt sınırı.
  netMarginMin?: number | null;
  squeezeMinNet?: number | null; // 300 TL eşiğinin altına (299,90) çekerken kabul edilen en az net kâr (TL). Doluysa yüzde eşiği ve kural TL şartı yerine geçer
  returnRate?: number;           // iade oranı (0.05 = siparişlerin %5'i iade)
  returnCost?: number;           // iade başına maliyet (KDV dahil TL: iade kargosu, gidiş kargosu, paketleme/hasar payı)
  // Kargo basamakları (Hepsiburada barem, 21.09.2026): kargoyu HER siparişte satıcı öder; fiyat < below ise o basamağın sabit ücreti,
  // son basamağın üstünde desi tarifesi (shippingCost). Doluysa ücretsiz kargo eşiği ve çoklu adet koruması kullanılmaz. Tutarlar shippingVatIncluded'a göre.
  shippingBands?: { below: number; cost: number }[] | null;
  multiUnitMinNet?: number | null; // çoklu adet koruması: 300 TL altı üründen eşiği geçecek kadar (2-3 adet) alınınca kargo sonrası en az net kâr (TL). Boş = kapalı
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
// Sipariş başı beklenen iade gideri: iade oranı × iade başına maliyet (kargo faturası gibi KDV'li hizmet sayılır)
export const returnsOf = (cfg: PricingConfig) => r2((cfg.returnRate ?? 0) * (cfg.returnCost ?? 0));
const fixedOf = (cfg: PricingConfig) => cfg.fixedCost + returnsOf(cfg);
// Ayar satırındaki shipping_bands (jsonb) -> geçerli basamaklar ya da null
export const bandsFrom = (v: unknown): PricingConfig["shippingBands"] =>
  Array.isArray(v) ? v.map((b: any) => ({ below: Number(b?.below), cost: Number(b?.cost) })).filter((b) => b.below > 0 && b.cost >= 0).sort((a, b) => a.below - b.below) : null;
const bandsOf = (cfg: PricingConfig) => (cfg.shippingBands ?? []).filter((b) => b && b.below > 0 && b.cost >= 0).sort((a, b) => a.below - b.below);
// Bu fiyattaki siparişte satıcının ödediği kargo (girildiği gibi, KDV düzeltmesi yapılmadan)
export function shippingAt(price: number, cfg: PricingConfig): number {
  const bands = bandsOf(cfg);
  if (bands.length) return (bands.find((b) => price < b.below)?.cost) ?? cfg.shippingCost;
  return price >= cfg.freeShippingThreshold ? cfg.shippingCost : 0;
}
const shipIncl = (raw: number, cfg: PricingConfig) => raw * (cfg.shippingVatIncluded === false ? 1 + svatOf(cfg) : 1);
const svatOf = (cfg: PricingConfig) => cfg.serviceVatRate ?? 0.2;

export interface Breakdown {
  price: number; commission: number; shipping: number; fixed: number;
  returns: number;  // beklenen iade gideri (oran × iade maliyeti)
  vatDue: number;   // devlete ödenecek KDV farkı (satış KDV'si - indirilecek KDV)
  net: number; rate: number;
}

// Bir satıştaki tüm kalemler (TL)
export function breakdown(price: number, cost: number, cfg: PricingConfig, commission: number = cfg.commissionRate): Breakdown {
  const v = vatOf(cfg), sv = svatOf(cfg);
  // Tüm hizmet kalemleri KDV dahil tutara çevrilir (cebinden çıkan para)
  const shipping = r2(shipIncl(shippingAt(price, cfg), cfg));
  const comm = price * commission * (cfg.commissionPlusVat ? 1 + sv : 1);
  const services = comm + shipping + fixedOf(cfg);
  const vatDue = (price - cost) * v / (1 + v) - services * sv / (1 + sv);
  const net = price - cost - services - vatDue;
  const exVat = price / (1 + v);
  return { price, commission: r2(comm), shipping, fixed: cfg.fixedCost, returns: returnsOf(cfg), vatDue: r2(vatDue), net: r2(net), rate: exVat > 0 ? net / exVat : 0 };
}

export function profitOf(price: number, cost: number, cfg: PricingConfig, commission: number) {
  const b = breakdown(price, cost, cfg, commission);
  return { shipping: b.shipping, net: b.net, rate: b.rate };
}

// Hedef kârı veren fiyat (yuvarlamadan önce). ship: satıcının ödediği kargo (girildiği gibi; 0 = alıcı öder)
function targetPrice(cost: number, cfg: PricingConfig, commission: number, ship: number): number {
  const sv = svatOf(cfg);
  const a = 1 / (1 + vatOf(cfg)), b = 1 / (1 + sv);
  const c = commission * (cfg.commissionPlusVat ? 1 + sv : 1);                                   // KDV dahil komisyon oranı
  const shipV = shipIncl(ship, cfg); // KDV dahil kargo
  // net = a(P - cost) - b(cP + kargo + sabit) = t·a·P  =>  P = (a·cost + b(kargo + sabit)) / (a(1 - t) - b·c)
  const den = a * (1 - cfg.targetProfitRate) - b * c;
  return den > 0 ? (a * cost + b * (shipV + fixedOf(cfg))) / den : Infinity;
}

// Net kârı tam N TL yapan fiyat: net = a(P - maliyet) - b(cP + kargo + sabit)  =>  P = (N + a·maliyet + b(kargo + sabit)) / (a - b·c)
function priceForNet(cost: number, cfg: PricingConfig, commission: number, ship: number, n: number): number {
  if (!(n > 0)) return 0;
  const sv = svatOf(cfg);
  const a = 1 / (1 + vatOf(cfg)), b = 1 / (1 + sv);
  const c = commission * (cfg.commissionPlusVat ? 1 + sv : 1);
  const den = a - b * c;
  return den > 0 ? (n + a * cost + b * (shipIncl(ship, cfg) + fixedOf(cfg))) / den : Infinity;
}

// Çoklu adet koruması. Eşik sepet toplamına bakar: 300 TL altı üründen n adet (n·fiyat >= eşik) alınınca kargo satıcıya geçer.
// n adetlik siparişin net kârı = n·(tek adet net) - kargo (KDV'si indirilir). Bunun en az multiUnitMinNet olması istenir.
const shipNetOf = (cfg: PricingConfig) => cfg.shippingCost * (cfg.shippingVatIncluded === false ? 1 + svatOf(cfg) : 1) / (1 + svatOf(cfg));
const unitsToThreshold = (price: number, cfg: PricingConfig) => Math.max(2, Math.ceil(cfg.freeShippingThreshold / price - 1e-9));
export function multiUnitOk(price: number, net: number, cfg: PricingConfig): boolean {
  const m = cfg.multiUnitMinNet;
  if (m == null || !(m >= 0) || price >= cfg.freeShippingThreshold || !(price > 0)) return true;
  return unitsToThreshold(price, cfg) * net - shipNetOf(cfg) >= m;
}
// Koruma için gereken en düşük fiyat (eşiğe ulaşırsa eşik üstü hesaba bırakılır)
function multiUnitFloor(price: number, cost: number, cfg: PricingConfig, commission: number): number {
  for (let i = 0; i < 6 && price < cfg.freeShippingThreshold; i++) {
    const net = profitOf(price, cost, cfg, commission).net;
    if (multiUnitOk(price, net, cfg)) break;
    const need = (shipNetOf(cfg) + (cfg.multiUnitMinNet ?? 0)) / unitsToThreshold(price, cfg);
    const next = roundUpPsych(priceForNet(cost, cfg, commission, 0, need));
    price = next > price ? next : roundUpPsych(price + 0.2);
  }
  return price;
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
  if (cfg.netProfitMin != null && cfg.netProfitMin >= 0 && !(cfg as any)._band) {
    const lo = cfg.netProfitMin, hi = Math.max(lo, cfg.netProfitMax ?? Infinity);
    const r = calcPrice(cost, { ...cfg, targetProfitRate: Math.max(0, Math.min(0.5, cfg.netMarginMin ?? 0)), minMarkup: 0, minNetProfit: lo, _band: true } as PricingConfig, commissionRate);
    if (r.ok && r.netProfit > hi + 0.01) r.note = [r.note, `net kâr aralığın üstünde (${r.netProfit.toFixed(0)} TL)`].filter(Boolean).join(" · ");
    return r;
  }
  if (!Number.isFinite(targetPrice(cost, cfg, commissionRate, 0))) return fail("komisyon + kâr %100 üstü");
  if (bandsOf(cfg).length) return finish(cost, cfg, commissionRate, banded(cost, cfg, commissionRate), fail);

  const floor = cost * cfg.minMarkup;
  const T = cfg.freeShippingThreshold;

  // 1) Kargo ödemiyormuşuz gibi hesapla (fiyat < 300 senaryosu)
  const minNet = cfg.minNetProfit ?? 0;
  let price = roundUpPsych(Math.max(targetPrice(cost, cfg, commissionRate, 0), priceForNet(cost, cfg, commissionRate, 0, minNet), floor));
  let note: string | undefined;
  const single = price;
  price = multiUnitFloor(price, cost, cfg, commissionRate);
  if (price > single) note = "çoklu adet koruması (2-3 adette kargo sana geçse de kârlı)";

  if (price >= T) {
    // 2) 300 TL ve üstü: kargo (90 TL) senin. Önce 299.90'a sıkıştırmayı dene.
    const squeezed = roundUpPsych(T - 0.2); // 299.90
    const sq = profitOf(squeezed, cost, cfg, commissionRate);
    // Kabul: net kâr "299,90 için en az TL" ayarını karşılıyorsa (doluysa); değilse eski kural (yüzde eşiği + kural TL şartı)
    const squeezeOk = (cfg.squeezeMinNet != null && cfg.squeezeMinNet >= 0 ? sq.net >= cfg.squeezeMinNet && sq.net > 0 : sq.rate >= cfg.minAcceptableProfitRate && sq.net >= minNet)
      && multiUnitOk(squeezed, sq.net, cfg);
    if (squeezed < T && squeezed >= floor && squeezeOk) {
      price = squeezed;
      note = "299,90'a sabitlendi (kargo alıcıda, kâr hedefin biraz altında)";
    } else {
      // 3) Kargoyu maliyete ekleyerek yeniden hesapla
      price = roundUpPsych(Math.max(targetPrice(cost, cfg, commissionRate, cfg.shippingCost), priceForNet(cost, cfg, commissionRate, cfg.shippingCost, minNet), floor));
      note = undefined;
    }
  }

  return finish(cost, cfg, commissionRate, { price, note }, fail);
}

function finish(cost: number, cfg: PricingConfig, commissionRate: number, r: { price: number; note?: string }, fail: (reason: string) => PriceResult): PriceResult {
  if (r.price > cfg.maxPrice) return fail("fiyat üst sınırı aştı");
  const p = profitOf(r.price, cost, cfg, commissionRate);
  if (p.net <= 0) return fail("zarar");
  return {
    ok: true,
    price: r.price,
    sellerPaysShipping: p.shipping > 0,
    shipping: p.shipping,
    netProfit: p.net,
    profitRate: Math.round(p.rate * 1000) / 1000,
    note: r.note,
  };
}

// Kargo basamaklı pazaryeri (Hepsiburada): her basamakta o basamağın kargosuyla hedef fiyat hesaplanır, basamağa sığan ilk (en ucuz) fiyat seçilir.
// Sığmıyorsa basamak sınırının hemen altı (199,90 / 399,90) denenir: net kâr "299,90 için en az TL" (squeezeMinNet) ve kural TL şartını karşılıyorsa kabul.
function banded(cost: number, cfg: PricingConfig, comm: number): { price: number; note?: string } {
  const bands = bandsOf(cfg);
  const floor = cost * cfg.minMarkup, minNet = cfg.minNetProfit ?? 0;
  const regimes = [...bands.map((b, i) => ({ lo: i ? bands[i - 1].below : 0, hi: b.below, ship: b.cost })), { lo: bands[bands.length - 1].below, hi: Infinity, ship: cfg.shippingCost }];
  for (const r of regimes) {
    const p = roundUpPsych(Math.max(targetPrice(cost, cfg, comm, r.ship), priceForNet(cost, cfg, comm, r.ship, minNet), floor, r.lo));
    if (p < r.hi) return { price: p };
    const sq = roundUpPsych(r.hi - 0.2);
    if (sq < r.hi && sq >= floor && sq >= r.lo) {
      const x = profitOf(sq, cost, cfg, comm);
      const ok = cfg.squeezeMinNet != null && cfg.squeezeMinNet >= 0 ? x.net >= Math.max(cfg.squeezeMinNet, minNet) && x.net > 0 : x.rate >= cfg.minAcceptableProfitRate && x.net >= minNet;
      if (ok) return { price: sq, note: `${sq.toFixed(2).replace(".", ",")} TL'ye sabitlendi (kargo basamağı ucuz, kâr hedefin biraz altında)` };
    }
  }
  return { price: Infinity };
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

// smart adımı formül ile mevcut arasında kalır; adet eşiği değiştiği için (3 -> 2 adet) korumayı bozabilir: o zaman formüle in
export function existingPriceSafe(policy: string, current: number, formula: number, cost: number, cfg: PricingConfig, commissionRate: number, maxDrop: number = SMART_MAX_DROP): number | null {
  const p = existingPrice(policy, current, formula, cfg, commissionRate, maxDrop);
  if (p == null || p === formula || policy !== "smart") return p;
  return multiUnitOk(p, profitOf(p, cost, cfg, commissionRate).net, cfg) ? p : formula;
}

// Ayar satırından (settings / marketplace_settings) fiyat yapılandırması; panel (önizleme, vitrin) ve worker (fırsat puanı) aynı hesabı kullanır
export function cfgFromSettings(s: Record<string, any>, vatPct = 20): PricingConfig {
  return {
    ...defaultConfig, commissionRate: Number(s.commission_rate), targetProfitRate: Number(s.target_profit_rate), shippingCost: Number(s.shipping_cost),
    freeShippingThreshold: Number(s.free_shipping_threshold), minMarkup: Number(s.min_markup ?? 1.3), fixedCost: Number(s.fixed_cost),
    returnRate: Number(s.return_rate ?? 0), returnCost: Number(s.return_cost ?? 0), squeezeMinNet: s.squeeze_min_net != null ? Number(s.squeeze_min_net) : null, multiUnitMinNet: s.multi_unit_min_net != null ? Number(s.multi_unit_min_net) : null, netProfitMin: s.net_profit_min != null ? Number(s.net_profit_min) : null, netProfitMax: s.net_profit_max != null ? Number(s.net_profit_max) : null, netMarginMin: s.net_margin_min != null ? Number(s.net_margin_min) : null,
    minAcceptableProfitRate: Number(s.min_acceptable_profit_rate), maxPrice: Number(s.max_price), commissionPlusVat: s.commission_plus_vat === true,
    shippingVatIncluded: s.shipping_vat_included !== false, vatRate: vatPct / 100, shippingBands: bandsFrom(s.shipping_bands),
  };
}
