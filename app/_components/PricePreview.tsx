"use client";

import { useEffect, useState } from "react";
import { breakdown, calcPrice, defaultConfig, type PricingConfig } from "@/worker/pricing";
import { applyRules, rulesFor, type PricingRule } from "@/worker/pricing-rules";
import { tl, type Api, type Row } from "./shared";

const MARKETS = [["trendyol", "Trendyol"], ["hepsiburada", "Hepsiburada"]] as const;

// Ürün detayında: her pazaryerinin fiyat ayarları + akıllı kâr kurallarıyla tahmini satış fiyatı ve net kâr
// (varsayılan komisyonla; canlıda ilanın kendi komisyonu kullanılır)
export default function PricePreview({ api, cost, currency, vat, category, brand, source, stock }: {
  api: Api; cost: number | null; currency: string; vat: number; category: string; brand: string; source: string; stock: number;
}) {
  const [data, setData] = useState<Record<string, { s: Row; rules: PricingRule[] }> | null>(null);
  useEffect(() => {
    Promise.all(MARKETS.map(([m]) => Promise.all([api(`/api/settings?mp=${m}`), api(`/api/pricing-rules?mp=${m}`)]).then(([s, rules]) => [m, { s, rules }] as const).catch(() => null)))
      .then((r) => setData(Object.fromEntries(r.filter(Boolean) as any)));
  }, [api]);
  if (!data) return null;

  return (
    <div className="card">
      <h2>Pazaryeri fiyatı (tahmini)</h2>
      {!(cost && cost > 0) ? <p className="muted" style={{ margin: 0 }}>Alış fiyatı girilince her pazaryeri için satış fiyatı ve net kâr burada hesaplanır.</p> : (
        <div className="scroll"><table className="cards">
          <thead><tr><th>Pazaryeri</th><th className="n">Satış fiyatı</th><th className="n">Komisyon</th><th className="n">Kargo</th><th className="n">Net kâr</th><th>Kural</th></tr></thead>
          <tbody>{MARKETS.filter(([m]) => data[m]).map(([m, label]) => {
            const { s, rules } = data[m];
            if (s.enabled === false) return <tr key={m}><td data-label="Pazaryeri">{label}</td><td colSpan={5} className="muted">kapalı</td></tr>;
            const fx: Record<string, number> = { TRY: 1, USD: Number(s.fx_usd) || 0, EUR: Number(s.fx_eur) || 0 };
            const tlCost = cost * (fx[currency] ?? 0);
            const cfg: PricingConfig = {
              ...defaultConfig, commissionRate: Number(s.commission_rate), targetProfitRate: Number(s.target_profit_rate), shippingCost: Number(s.shipping_cost),
              freeShippingThreshold: Number(s.free_shipping_threshold), minMarkup: Number(s.min_markup ?? 1.3), fixedCost: Number(s.fixed_cost),
              returnRate: Number(s.return_rate ?? 0), returnCost: Number(s.return_cost ?? 0), 
              minAcceptableProfitRate: Number(s.min_acceptable_profit_rate), maxPrice: Number(s.max_price), commissionPlusVat: s.commission_plus_vat === true,
              shippingVatIncluded: s.shipping_vat_included !== false, vatRate: vat / 100,
            };
            const { cfg: rc, applied } = applyRules(cfg, rulesFor(rules, m), { cost: tlCost, supplier: source.replace(/^xml:/, ""), category, brand, stock });
            const r = calcPrice(tlCost, rc, cfg.commissionRate);
            const b = r.ok ? breakdown(r.price, tlCost, rc, cfg.commissionRate) : null;
            return (
              <tr key={m}>
                <td data-label="Pazaryeri"><b>{label}</b>{currency !== "TRY" && <><br /><span className="muted" style={{ fontSize: 12 }}>maliyet {tl(tlCost)}</span></>}</td>
                <td data-label="Satış fiyatı" className="n" style={{ fontWeight: 700 }}>{r.ok ? tl(r.price) : <span style={{ color: "var(--bad)" }}>{r.reason}</span>}</td>
                <td data-label="Komisyon" className="n">{b ? tl(b.commission) : "-"}</td>
                <td data-label="Kargo" className="n">{b ? (b.shipping ? tl(b.shipping) : "alıcı öder") : "-"}</td>
                <td data-label="Net kâr" className="n" style={{ color: r.ok ? "var(--ok)" : undefined }}>{r.ok ? `${tl(r.netProfit)} (%${Math.round(r.profitRate * 100)})` : "-"}</td>
                <td data-label="Kural" className="muted" style={{ fontSize: 12 }}>{applied.join(", ") || "genel ayar"}{r.note ? ` · ${r.note}` : ""}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>Varsayılan komisyonla hesaplanır; canlıda ilanın kendi komisyon oranı kullanılır. KDV, kargo eşiği ve x9,90 yuvarlama dahil.</p>
    </div>
  );
}
