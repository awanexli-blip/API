// Ürünün her pazaryerine gönderilmeye hazır olup olmadığı (panelde kontrol listesi).
// Kurallar docs/TODO.md "pazaryeri zorunlu alanları" bölümünden; canlı API ile doğrulanınca güncellenir.
// Gönderim Faz 4-5'te; burada yalnızca eksikler önceden gösterilir.
// "2" ile başlayan EAN-13 = otomatik (mağaza içi) barkod. validation/product.ts ile aynı; Node testleri uzantısız import çözemediği için burada.
const isInternalEan = (b: string | null | undefined) => !!b && /^2\d{12}$/.test(b);

export type ReadyInput = {
  title: string; description: string; brand: string; category: string; desi: number | null; cost_price: number | null;
  images: string[]; variants: { barcode: string | null; stock: number; cost_price: number | null }[];
};
export type Check = { ok: boolean; text: string; warn?: boolean };
export type Readiness = { id: string; label: string; checks: Check[]; ready: boolean };

const MARKETS: { id: string; label: string; titleMax: number; titleMin?: number; imagesMax: number; realGtin?: boolean; ownCategory?: boolean }[] = [
  { id: "trendyol", label: "Trendyol", titleMax: 100, imagesMax: 8 },
  { id: "hepsiburada", label: "Hepsiburada", titleMax: 200, imagesMax: 10 },
  { id: "n11", label: "N11", titleMax: 65, titleMin: 15, imagesMax: 8 },
  { id: "ciceksepeti", label: "ÇiçekSepeti", titleMax: 255, imagesMax: 8 },
  { id: "amazon", label: "Amazon TR", titleMax: 200, imagesMax: 9, realGtin: true },
];

// mapped: bu iç kategorinin eşleştiği pazaryerleri (Kategoriler sekmesi)
export function readiness(p: ReadyInput, mapped: string[]): Readiness[] {
  const t = p.title.trim().length;
  const hasCost = p.cost_price != null || p.variants.every((v) => v.cost_price != null);
  const allBarcode = p.variants.every((v) => !!v.barcode);
  return MARKETS.map((m) => {
    const checks: Check[] = [
      { ok: t >= (m.titleMin ?? 2) && t <= m.titleMax, text: `Başlık ${m.titleMin ?? 2}-${m.titleMax} karakter (şu an ${t})` },
      { ok: p.description.trim().length >= 30, text: "Açıklama (en az 30 karakter)" },
      { ok: !!p.brand.trim(), text: "Marka" },
      { ok: mapped.includes(m.id), text: mapped.includes(m.id) ? "Kategori eşleşmiş" : `Kategori ${m.label} kategorisine eşleşmemiş (Kategoriler sekmesi)` },
      { ok: p.images.length >= 1 && p.images.length <= m.imagesMax, text: `Görsel 1-${m.imagesMax} adet (şu an ${p.images.length})` },
      { ok: allBarcode, text: "Her varyantta barkod" },
      { ok: p.desi != null && p.desi > 0, text: "Desi" },
      { ok: hasCost, text: "Maliyet (fiyat hesabı için)" },
      { ok: p.variants.some((v) => v.stock > 0), text: "Stok", warn: true },
    ];
    if (m.realGtin) checks.push({ ok: allBarcode && !p.variants.some((v) => isInternalEan(v.barcode)), text: "Gerçek GTIN/EAN barkod (otomatik barkod Amazon'da geçmez; GTIN muafiyeti gerekir)" });
    // Stok 0 göndermeye engel değil (uyarı)
    return { id: m.id, label: m.label, checks, ready: checks.every((c) => c.ok || c.warn) };
  });
}
