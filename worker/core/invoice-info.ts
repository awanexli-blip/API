// Kurumsal fatura bilgisi siparişten (K 13.11; Trendyol "Kurumsal Faturalı Siparişler" rehberi: ünvan, VKN/TCKN, vergi dairesi eksiksiz olmalı).
// Kişisel/ticari veri: loglanmaz, adresle birlikte 30 gün sonra silinir (orders_purge_pii).
import type { BuyerType, OrderInvoiceInfo } from "../marketplaces/types.ts";

const s = (x: unknown) => String(x ?? "").replace(/\s+/g, " ").trim();
const digits = (x: unknown) => String(x ?? "").replace(/\D/g, "");

// Geçerli: ünvan dolu + VKN (10 hane) ya da TCKN (11 hane, şahıs şirketi); 11111111111 bireysel sayılır
export function invoiceInfo(company: unknown, taxNumber: unknown, taxOffice: unknown, eInvoice: boolean | null, a: Record<string, unknown> = {}): OrderInvoiceInfo | null {
  const c = s(company), t = digits(taxNumber);
  if (!c || !(t.length === 10 || t.length === 11) || t === "11111111111") return null;
  return { company: c.slice(0, 200), taxNumber: t, taxOffice: s(taxOffice).slice(0, 100), eInvoice,
    fullAddress: s(a.fullAddress) || undefined, district: s(a.district) || undefined, city: s(a.city) || undefined, postalCode: s(a.postalCode) || undefined };
}

// Trendyol: commercial=true siparişte invoiceAddress.company / taxNumber / taxOffice / isEInvoiceAvailable (canlı alan adları 13.11)
export function tyInvoiceInfo(o: any): OrderInvoiceInfo | null {
  const ia = o?.invoiceAddress;
  if (!ia || !(o?.commercial || ia.taxNumber)) return null;
  const e = ia.isEInvoiceAvailable;
  return invoiceInfo(ia.company, ia.taxNumber ?? o?.taxNumber, ia.taxOffice, typeof e === "boolean" ? e : null,
    { fullAddress: ia.fullAddress ?? [ia.address1, ia.address2].filter(Boolean).join(" "), district: ia.district, city: ia.city, postalCode: ia.postalCode });
}

// Hepsiburada: companyName / taxNumber / taxOffice / billingAddress (e-Fatura durumu bildirilmez -> null)
export function hbInvoiceInfo(x: any): OrderInvoiceInfo | null {
  if (!x) return null;
  return invoiceInfo(x.companyName, x.taxNumber, x.taxOffice, null,
    { fullAddress: x.billingAddress, district: x.billingDistrict ?? x.billingTown, city: x.billingCity, postalCode: x.billingPostalCode });
}

export const buyerTypeOf = (inv: OrderInvoiceInfo | null | undefined): BuyerType => (!inv ? "bireysel" : inv.eInvoice ? "kurumsal_efatura" : "kurumsal");
