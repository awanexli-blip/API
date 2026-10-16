import type { Marketplace } from "./types.ts";
import { createTrendyol } from "./trendyol.ts";
import { createHepsiburada } from "./hepsiburada.ts";

// Yeni pazaryeri: adaptörü yaz, buraya ekle. Kimlik bilgileri yalnızca seçilen pazaryeri için okunur.
const registry: Record<string, () => Marketplace> = {
  trendyol: createTrendyol,
  hepsiburada: createHepsiburada,
};

export const marketplaceIds = Object.keys(registry);

export function getMarketplace(id: string): Marketplace {
  const make = registry[id];
  if (!make) throw new Error(`Bilinmeyen pazaryeri: ${id}. Geçerli olanlar: ${marketplaceIds.join(", ")}`);
  return make();
}
