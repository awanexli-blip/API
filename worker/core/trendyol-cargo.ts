// Trendyol kargo maliyeti (satıcının ödediği, KDV DAHİL): firma + zamanında kargolama (barem Tablo 1/2) + desi.
// Sipariş < 350 TL ve paket <= 10 desi: barem (200 altı / 200-349,99); aksi halde desi tarifesi. Fiyat formülü bunu kargo basamakları
// (shippingBands) olarak alır: son basamağın üstü shippingCost (desi). 10 desi üstü pakette barem yok: tek basamak = her fiyatta desi ücreti.
import { TY_BAREM, TY_BAREM_MAX_DESI, TY_CARRIERS, TY_DESI } from "../data/trendyol/cargo.ts";

const fold = (s: string) => s.toLocaleLowerCase("tr").replace(/ı/g, "i").replace(/ü/g, "u").replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ş/g, "s").replace(/ö/g, "o");
// "Sürat Kargo", "TEX", "Trendyol Express", "YK", "Yurtiçi Kargo" ... -> sütun; bilinmiyorsa -1
export function tyCarrierIndex(name: unknown): number {
  const n = fold(String(name ?? "").trim());
  if (!n) return -1;
  if (/trendyol express|^tex\b/.test(n)) return TY_CARRIERS.indexOf("TEX");
  if (/^yk$|yurtici/.test(n)) return TY_CARRIERS.indexOf("Yurtiçi");
  if (/^dhl/.test(n)) return TY_CARRIERS.indexOf("DHL eCommerce");
  return TY_CARRIERS.findIndex((c) => n.startsWith(fold(c)));
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const desiOf = (d: unknown, def = 2) => { const x = Number(d); return Number.isFinite(x) && x > 0.05 ? Math.ceil(x) : def; };

// Desi tarifesi (KDV dahil). 50 desi üstü doğrusal devam
export function tyDesiCost(desi: number, ci: number, vat = 0.2): number {
  const d = Math.max(0, Math.ceil(desi));
  const last = TY_DESI.length - 1;
  const net = d <= last ? TY_DESI[d][ci] : TY_DESI[last][ci] + (d - last) * (TY_DESI[last][ci] - TY_DESI[last - 1][ci]);
  return r2(net * (1 + vat));
}

export function tyBands(ci: number, fast: boolean, vat = 0.2): { below: number; cost: number }[] {
  const t = fast ? TY_BAREM.fast : TY_BAREM.slow;
  return [{ below: 200, cost: r2(t[200][ci] * (1 + vat)) }, { below: 350, cost: r2(t[350][ci] * (1 + vat)) }];
}

// Ürün başına fiyat yapılandırması parçası: { shippingCost, shippingBands } (KDV dahil). null = firma tanımsız (ayardaki sabit değerler kalır)
export function tyShipCfg(desi: unknown, carrier: unknown, fast: boolean, defaultDesi = 2, vat = 0.2) {
  const ci = tyCarrierIndex(carrier);
  if (ci < 0) return null;
  const d = desiOf(desi, defaultDesi);
  const cost = tyDesiCost(d, ci, vat);
  return { shippingCost: cost, shippingBands: d > TY_BAREM_MAX_DESI ? [{ below: 1e9, cost }] : tyBands(ci, fast, vat), shippingVatIncluded: true };
}
