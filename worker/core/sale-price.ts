// Ürün formunda girilen satış fiyatı (ürün özelliği "Satış fiyatı", KDV dahil). "Satış fiyatı@hepsiburada" o pazaryerinde ezer.
// Boşsa 0 (fiyat formülle hesaplanır). Saf fonksiyon, test edilir (attr-infer.test.ts).
export const SALE_PRICE = "Satış fiyatı";

// "1.299,90" / "1299,90" / "1299.90" -> 1299.9
export function salePriceOf(a: any, mp: string): number {
  const raw = String(a?.[`${SALE_PRICE}@${mp}`] ?? a?.[SALE_PRICE] ?? "").trim();
  if (!raw) return 0;
  const n = Number(/,\d{1,2}$/.test(raw) ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
