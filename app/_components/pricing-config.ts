import { defaultConfig, type PricingConfig } from "@/worker/pricing";
import type { Row } from "./shared";

// Panel ayar satırından (/api/settings) fiyat formülü yapılandırması; PricePreview ve Ürünler vitrini aynı hesabı kullanır
export function cfgFromSettings(s: Row, vatPct: number): PricingConfig {
  return {
    ...defaultConfig, commissionRate: Number(s.commission_rate), targetProfitRate: Number(s.target_profit_rate), shippingCost: Number(s.shipping_cost),
    freeShippingThreshold: Number(s.free_shipping_threshold), minMarkup: Number(s.min_markup ?? 1.3), fixedCost: Number(s.fixed_cost),
    returnRate: Number(s.return_rate ?? 0), returnCost: Number(s.return_cost ?? 0), squeezeMinNet: s.squeeze_min_net != null ? Number(s.squeeze_min_net) : null, multiUnitMinNet: s.multi_unit_min_net != null ? Number(s.multi_unit_min_net) : null,
    minAcceptableProfitRate: Number(s.min_acceptable_profit_rate), maxPrice: Number(s.max_price), commissionPlusVat: s.commission_plus_vat === true,
    shippingVatIncluded: s.shipping_vat_included !== false, vatRate: vatPct / 100,
  };
}
