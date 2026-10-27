// Duruma göre kâr marjı (K, 27.10, seçenek c): en az net kâr TL (net_profit_min, 40 TL) her zaman korunur; marj oranı ilana göre:
//  - Rekabet verisi olan ilan (Trendyol buybox, listing_buybox): başka satıcı varsa "competition" (%10), tek satıcı bizsek "alone" (%20)
//  - Verisi olmayan ilan (yeni ürün, Hepsiburada): satış fiyatına göre basamak (500 TL altı %20, 500-1.500 %15, üstü %10)
// Ayar: settings / marketplace_settings.dynamic_margin (jsonb), dynamic_margin_active. Kapalıyken yalnızca önizlemede karşılaştırma yapılır.
// Saf fonksiyonlar, test edilir (attr-infer.test.ts).
export type DynMargin = { competition: number; alone: number; bands: [number | null, number][] };
export const DEFAULT_DYN: DynMargin = { competition: 0.1, alone: 0.2, bands: [[500, 0.2], [1500, 0.15], [null, 0.1]] };

const rate = (x: unknown) => { const n = Number(x); return Number.isFinite(n) && n >= 0 && n <= 0.5 ? n : null; };

export function parseDyn(v: unknown): DynMargin | null {
  if (!v || typeof v !== "object") return null;
  const o = v as any;
  const competition = rate(o.competition), alone = rate(o.alone);
  const bands = Array.isArray(o.bands) ? o.bands.map((b: any) => [b?.[0] == null ? null : Number(b[0]), rate(b?.[1])] as [number | null, number | null]).filter((b: any) => b[1] != null && (b[0] == null || b[0] > 0)) as [number | null, number][] : [];
  if (competition == null || alone == null || !bands.length) return null;
  bands.sort((a, b) => (a[0] ?? Infinity) - (b[0] ?? Infinity));
  return { competition, alone, bands };
}

// competition: true = başka satıcı var, false = tek satıcı biz, null/undefined = veri yok (fiyat basamağı)
export function marginFor(dm: DynMargin, o: { competition?: boolean | null; price: number }): number {
  if (o.competition === true) return dm.competition;
  if (o.competition === false) return dm.alone;
  for (const [upTo, m] of dm.bands) if (upTo == null || o.price < upTo) return m;
  return dm.bands[dm.bands.length - 1][1];
}
