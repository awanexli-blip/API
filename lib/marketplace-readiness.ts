// Ürünün Trendyol ve Hepsiburada'ya gönderilmeye hazır olup olmadığı: temel alanlar (ürün formu "Gönderime hazırlık").
// Kategoriye bağlı zorunlu özellikler MarketplaceFields'ta (pazaryerinin canlı listesinden) ayrıca denetlenir.
// Kurallar ve gerekçeleri: docs/PAZARYERI_ZORUNLU_ALANLAR.md. Gönderen kodla aynı tutulur (worker/marketplaces/trendyol.ts, hepsiburada.ts).
export type ReadyInput = {
  title: string; description: string; brand: string; desi: number | null; cost_price: number | null; vat: number | null;
  images: string[]; variants: { barcode: string | null; stock: number; cost_price: number | null }[];
  categories: string[]; // formda kategorisi seçilmiş pazaryerleri
};
export type Check = { ok: boolean; text: string; warn?: boolean };
export type Readiness = { id: "trendyol" | "hepsiburada"; label: string; checks: Check[]; ready: boolean };

// titleMax: pazaryerinin kabul ettiği; imagesSent: gönderen kodun gönderdiği en çok görsel (fazlası gitmez)
const MARKETS = [
  { id: "trendyol", label: "Trendyol", titleMax: 100, imagesSent: 8, descMax: 30000 },
  { id: "hepsiburada", label: "Hepsiburada", titleMax: 200, imagesSent: 5, descMax: 30000 },
] as const;
const BARCODE_RE = /^[A-Za-z0-9._-]{1,40}$/;

export function readiness(p: ReadyInput): Readiness[] {
  const t = p.title.trim().length, d = p.description.trim().length;
  const hasCost = p.cost_price != null || p.variants.every((v) => v.cost_price != null);
  const barcodes = p.variants.map((v) => (v.barcode ?? "").trim());
  const dupBarcode = new Set(barcodes.filter(Boolean)).size !== barcodes.filter(Boolean).length;
  return MARKETS.map((m) => {
    const checks: Check[] = [
      { ok: p.categories.includes(m.id), text: `${m.label} kategorisi seçili` },
      { ok: t >= 5 && t <= m.titleMax, text: `Başlık 5-${m.titleMax} karakter (şu an ${t})` },
      { ok: d >= 30 && d <= m.descMax, text: `Açıklama en az 30 karakter (şu an ${d})` },
      { ok: !!p.brand.trim(), text: "Marka" },
      { ok: p.images.length >= 1, text: `En az 1 görsel (şu an ${p.images.length})` },
      { ok: p.images.length <= m.imagesSent, warn: true, text: `En çok ${m.imagesSent} görsel gider (fazlası gönderilmez)` },
      { ok: p.images.every((u) => /^https:\/\//.test(u)), text: "Görsel adresleri https" },
      { ok: barcodes.every((b) => !b || BARCODE_RE.test(b)) && !dupBarcode, text: "Barkodlar geçerli ve her varyantta farklı (boşsa kaydederken üretilir)" },
      { ok: p.desi != null && p.desi > 0, text: "Desi (kargo ücreti için)" },
      { ok: p.vat != null && [0, 1, 10, 20].includes(p.vat), text: "KDV oranı" },
      { ok: hasCost, text: "Alış fiyatı (kâr hesabı ve zarar koruması için)" },
      { ok: p.variants.some((v) => v.stock > 0), text: "Stok (0 ise ilan açılır ama satışa kapalı kalır)", warn: true },
    ];
    return { id: m.id, label: m.label, checks, ready: checks.every((c) => c.ok || c.warn) };
  });
}
