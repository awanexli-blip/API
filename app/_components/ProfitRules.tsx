"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { calcPrice, defaultConfig, type PricingConfig } from "@/worker/pricing";
import { applyRules, describeCond, rulesFor, type PricingRule } from "@/worker/pricing-rules";
import { tl, type Props, type Row } from "./shared";

type Draft = { id?: string; marketplace: string; name: string; position: number; enabled: boolean; cost_min: string; cost_max: string; supplier: string; category: string; brand: string; stock_max: string; target: string; minNet: string; add: string };
const s = (v: unknown) => (v == null ? "" : String(v));
const pctIn = (v: unknown) => (v == null || v === "" ? "" : String(Math.round(Number(v) * 1000) / 10));
const toDraft = (r: Row, mp: string): Draft => ({
  id: r.id, marketplace: r.marketplace ?? mp, name: r.name ?? "", position: r.position ?? 100, enabled: r.enabled !== false,
  cost_min: s(r.cond?.cost_min), cost_max: s(r.cond?.cost_max), supplier: s(r.cond?.supplier), category: s(r.cond?.category), brand: s(r.cond?.brand), stock_max: s(r.cond?.stock_max),
  target: pctIn(r.target_profit_rate), minNet: s(r.min_net_profit), add: pctIn(r.add_profit_rate),
});
const SAMPLE_COSTS = [15, 30, 50, 80, 120, 180, 250, 400, 700, 1200, 2500];
const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

export default function ProfitRules({ api, notify, marketplace }: Props) {
  const [rules, setRules] = useState<Row[]>([]);
  const [settings, setSettings] = useState<Row | null>(null);
  const [sample, setSample] = useState<Row[] | null>(null);
  const [d, setD] = useState<Draft | null>(null);
  const label = marketplace === "hepsiburada" ? "Hepsiburada" : "Trendyol";

  const load = useCallback(async () => {
    try {
      const [r, st] = await Promise.all([api(`/api/pricing-rules?mp=${marketplace}`), api(`/api/settings?mp=${marketplace}`)]);
      setRules(r); setSettings(st);
    } catch (e: any) { notify("err", e.message); }
  }, [api, notify, marketplace]);
  useEffect(() => { load(); api(`/api/pricing-rules?mp=${marketplace}&sample=1`).then(setSample).catch(() => setSample([])); }, [load, api, marketplace]);

  async function save() {
    if (!d) return;
    const pct = (v: string) => (num(v) == null ? null : Number(num(v)) / 100);
    try {
      await api("/api/pricing-rules", { method: "PUT", body: JSON.stringify({
        id: d.id, marketplace: d.marketplace, name: d.name, position: d.position, enabled: d.enabled,
        cond: { cost_min: num(d.cost_min), cost_max: num(d.cost_max), supplier: d.supplier, category: d.category, brand: d.brand, stock_max: num(d.stock_max) },
        target_profit_rate: pct(d.target), min_net_profit: num(d.minNet), add_profit_rate: pct(d.add),
      }) });
      notify("good", "Kural kaydedildi. Bir sonraki senkronizasyonda fiyatlara yansır."); setD(null); load();
    } catch (e: any) { notify("err", e.message); }
  }
  async function patch(r: Row, p: Partial<Row>) {
    try { await api("/api/pricing-rules", { method: "PUT", body: JSON.stringify({ ...r, ...p }) }); load(); } catch (e: any) { notify("err", e.message); }
  }
  async function remove(r: Row) {
    if (!confirm(`"${r.name}" kuralı silinsin mi?`)) return;
    try { await api(`/api/pricing-rules?id=${r.id}`, { method: "DELETE" }); load(); } catch (e: any) { notify("err", e.message); }
  }
  async function seed() {
    if (!confirm(`Önerilen kademeli kâr kuralları ${label} için eklensin mi? Eklenen kurallar açık gelir; önce aşağıdaki simülasyona bak, istemediğini kapat.`)) return;
    try { await api("/api/pricing-rules", { method: "PUT", body: JSON.stringify({ seed: marketplace }) }); notify("good", "Önerilen kurallar eklendi."); load(); } catch (e: any) { notify("err", e.message); }
  }
  const move = (i: number, dir: -1 | 1) => {
    const a = rules[i], b = rules[i + dir];
    if (!a || !b) return;
    Promise.all([patch(a, { position: b.position }), patch(b, { position: a.position === b.position ? a.position + dir : a.position })]);
  };

  // Simülasyon: ayarlardaki varsayılan komisyonla, kurallı ve kuralsız fiyat
  const sim = useMemo(() => {
    if (!settings) return null;
    const cfg: PricingConfig = {
      ...defaultConfig, commissionRate: Number(settings.commission_rate), targetProfitRate: Number(settings.target_profit_rate), shippingCost: Number(settings.shipping_cost),
      freeShippingThreshold: Number(settings.free_shipping_threshold), minMarkup: Number(settings.min_markup ?? 1.3), fixedCost: Number(settings.fixed_cost),
      minAcceptableProfitRate: Number(settings.min_acceptable_profit_rate), maxPrice: Number(settings.max_price), commissionPlusVat: settings.commission_plus_vat === true,
      shippingVatIncluded: settings.shipping_vat_included !== false,
    };
    const fx: Record<string, number> = { TRY: 1, USD: Number(settings.fx_usd) || 0, EUR: Number(settings.fx_eur) || 0 };
    const active = rulesFor(rules as PricingRule[], marketplace);
    const items = sample && sample.length ? sample.map((p) => ({ ...p, cost: p.cost * (fx[p.currency] ?? 0) })).filter((p) => p.cost > 0) : SAMPLE_COSTS.map((cost) => ({ sku: "", title: `Örnek ürün`, cost, vat: 20, stock: 10 }));
    const rows = items.map((p: Row) => {
      const base = { ...cfg, vatRate: (p.vat ?? 20) / 100 };
      const before = calcPrice(p.cost, base, cfg.commissionRate);
      const { cfg: rc, applied } = applyRules(base, active, { cost: p.cost, supplier: p.supplier, category: p.category, brand: p.brand, stock: p.stock });
      const after = calcPrice(p.cost, rc, cfg.commissionRate);
      return { ...p, before, after, applied };
    });
    const ok = rows.filter((r) => r.before.ok && r.after.ok);
    const avg = (f: (r: any) => number) => (ok.length ? ok.reduce((t, r) => t + f(r), 0) / ok.length : 0);
    return {
      fromDb: !!(sample && sample.length), rows, total: rows.length,
      changed: ok.filter((r) => r.after.price !== r.before.price).length,
      up: ok.filter((r) => r.after.price > r.before.price).length, down: ok.filter((r) => r.after.price < r.before.price).length,
      netBefore: avg((r) => r.before.netProfit), netAfter: avg((r) => r.after.netProfit),
      priceBefore: avg((r) => r.before.price), priceAfter: avg((r) => r.after.price),
      lowProfit: ok.filter((r) => r.after.netProfit < 15).length,
    };
  }, [settings, rules, sample, marketplace]);

  const shown = sim ? (sim.fromDb ? [...sim.rows].sort((a, b) => Math.abs(b.after.price - b.before.price) - Math.abs(a.after.price - a.before.price)).slice(0, 25) : sim.rows) : [];

  return (
    <>
      <div className="card">
        <h2>Akıllı kâr</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Tek bir kâr oranı her ürüne uymaz: 30 TL'lik üründe %15 kâr 4 TL eder, bir iade bunu siler; 2.000 TL'lik üründe %15 ise rakibin çok üstüne çıkarır.
          Kurallarla maliyete, tedarikçiye, kategoriye, markaya ve stoğa göre <b>hedef kâr</b> ve <b>sipariş başı en az net kâr (TL)</b> belirlersin.
          Kurallar yukarıdan aşağı uygulanır; alttaki kural üsttekinin değerini ezer. Eşleşmeyen ürünlerde "Fiyat ayarları"ndaki oran geçerli.
          Komisyon, KDV, kargo (300 TL eşiği, 299,90 sıkıştırma) ve x9,90 yuvarlama her zaman hesaba katılır.
        </p>
        <div className="row">
          <button className="btn primary" onClick={() => setD(toDraft({ position: (rules.at(-1)?.position ?? 0) + 10 }, marketplace))}>+ Kural ekle</button>
          {rules.length === 0 && <button className="btn" onClick={seed}>Önerilen kademeli kuralları ekle</button>}
        </div>
      </div>

      {d && <div className="card" style={{ borderColor: "var(--accent)" }}>
        <h2>{d.id ? "Kuralı düzenle" : "Yeni kural"}</h2>
        <div className="grid">
          <label className="f">Kural adı<input type="text" value={d.name} placeholder="ör. Mutfak ürünleri" onChange={(e) => setD({ ...d, name: e.target.value })} /></label>
          <label className="f">Geçerli olduğu yer
            <select value={d.marketplace} onChange={(e) => setD({ ...d, marketplace: e.target.value })}><option value={marketplace}>Sadece {label}</option><option value="all">Tüm pazaryerleri</option></select>
          </label>
        </div>
        <h3 style={{ fontSize: 14, margin: "14px 0 6px" }}>Hangi ürünlere? <span className="muted" style={{ fontWeight: 400 }}>(boş bırakılan koşul aranmaz)</span></h3>
        <div className="grid">
          <label className="f">Maliyet en az (TL)<input type="text" inputMode="decimal" value={d.cost_min} onChange={(e) => setD({ ...d, cost_min: e.target.value })} /></label>
          <label className="f">Maliyet en çok (TL, hariç)<input type="text" inputMode="decimal" value={d.cost_max} onChange={(e) => setD({ ...d, cost_max: e.target.value })} /></label>
          <label className="f">Kategori adında geçen<input type="text" value={d.category} placeholder="ör. Mutfak" onChange={(e) => setD({ ...d, category: e.target.value })} /></label>
          <label className="f">Tedarikçi kodu<input type="text" value={d.supplier} placeholder="ör. bayilik" onChange={(e) => setD({ ...d, supplier: e.target.value })} /></label>
          <label className="f">Marka<input type="text" value={d.brand} onChange={(e) => setD({ ...d, brand: e.target.value })} /></label>
          <label className="f">Stok en çok<input type="text" inputMode="numeric" value={d.stock_max} placeholder="ör. 3" onChange={(e) => setD({ ...d, stock_max: e.target.value })} /></label>
        </div>
        <h3 style={{ fontSize: 14, margin: "14px 0 6px" }}>Ne yapsın?</h3>
        <div className="grid">
          <label className="f">Hedef net kâr (%)<input type="text" inputMode="decimal" value={d.target} placeholder="ör. 22" onChange={(e) => setD({ ...d, target: e.target.value })} /><small>Satışın yüzdesi (KDV hariç)</small></label>
          <label className="f">En az net kâr (TL)<input type="text" inputMode="decimal" value={d.minNet} placeholder="ör. 25" onChange={(e) => setD({ ...d, minNet: e.target.value })} /><small>Sipariş başı cebe kalan</small></label>
          <label className="f">Kâra ekle (± puan)<input type="text" inputMode="decimal" value={d.add} placeholder="ör. 5" onChange={(e) => setD({ ...d, add: e.target.value })} /><small>Diğer kurallardan sonra eklenir</small></label>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={save}>Kaydet</button>
          <button className="btn" onClick={() => setD(null)}>Vazgeç</button>
        </div>
      </div>}

      <div className="card">
        <h2>Kurallar ({rules.length})</h2>
        {rules.length === 0 ? <p className="muted">Kural yok: tüm ürünlerde Fiyat ayarlarındaki hedef kâr (%{Math.round(Number(settings?.target_profit_rate ?? 0.15) * 100)}) geçerli.</p> : <div className="scroll"><table>
          <thead><tr><th>Sıra</th><th>Kural</th><th>Koşul</th><th>Etki</th><th>Açık</th><th /></tr></thead>
          <tbody>{rules.map((r, i) => (
            <tr key={r.id} style={{ opacity: r.enabled ? 1 : 0.55 }}>
              <td style={{ whiteSpace: "nowrap" }}><button className="btn" style={{ padding: "2px 7px" }} disabled={i === 0} onClick={() => move(i, -1)}>↑</button> <button className="btn" style={{ padding: "2px 7px" }} disabled={i === rules.length - 1} onClick={() => move(i, 1)}>↓</button></td>
              <td>{r.name}{r.marketplace === "all" && <span className="pill" style={{ marginLeft: 6 }}>tüm pazaryerleri</span>}</td>
              <td style={{ fontSize: 13 }}>{describeCond(r.cond ?? {})}</td>
              <td style={{ fontSize: 13 }}>{[r.target_profit_rate != null && `kâr %${pctIn(r.target_profit_rate)}`, r.min_net_profit != null && `en az ${r.min_net_profit} TL`, r.add_profit_rate != null && `${Number(r.add_profit_rate) >= 0 ? "+" : ""}${pctIn(r.add_profit_rate)} puan`].filter(Boolean).join(" · ")}</td>
              <td><input type="checkbox" checked={r.enabled} onChange={() => patch(r, { enabled: !r.enabled })} /></td>
              <td className="n"><div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                <button className="btn" onClick={() => setD(toDraft(r, marketplace))}>Düzenle</button>
                <button className="btn danger" onClick={() => remove(r)}>Sil</button>
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>}
      </div>

      {sim && <div className="card">
        <h2>Simülasyon</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          {sim.fromDb ? `Ürün veritabanındaki ${sim.total.toLocaleString("tr-TR")} ürün` : "Örnek maliyetler (ürün veritabanı boş; tedarikçi içe aktarılınca gerçek ürünlerle hesaplanır)"} ·
          varsayılan komisyon %{Math.round(Number(settings?.commission_rate) * 1000) / 10} (canlıda her ürünün kendi komisyonu kullanılır).
        </p>
        <div className="row" style={{ gap: 24, margin: "6px 0 12px" }}>
          <div><div style={{ fontSize: 20, fontWeight: 600 }}>{tl(sim.netBefore)} → {tl(sim.netAfter)}</div><div className="muted">ortalama net kâr / sipariş</div></div>
          <div><div style={{ fontSize: 20, fontWeight: 600 }}>{tl(sim.priceBefore)} → {tl(sim.priceAfter)}</div><div className="muted">ortalama satış fiyatı</div></div>
          <div><div style={{ fontSize: 20, fontWeight: 600 }}>{sim.up} ↑ · {sim.down} ↓</div><div className="muted">fiyatı değişen ürün</div></div>
          <div><div style={{ fontSize: 20, fontWeight: 600, color: sim.lowProfit ? "var(--warn)" : undefined }}>{sim.lowProfit}</div><div className="muted">15 TL altı net kâr</div></div>
        </div>
        <div className="scroll"><table>
          <thead><tr><th>Ürün</th><th className="n">Maliyet</th><th className="n">Kuralsız</th><th className="n">Kurallı</th><th className="n">Net kâr</th><th>Uygulanan</th></tr></thead>
          <tbody>{shown.map((r: Row, i: number) => (
            <tr key={i}>
              <td style={{ fontSize: 13 }}>{r.title}{r.category ? <><br /><span className="muted" style={{ fontSize: 12 }}>{String(r.category).slice(0, 60)}</span></> : null}</td>
              <td className="n">{tl(r.cost)}</td>
              <td className="n">{r.before.ok ? tl(r.before.price) : <span className="muted">{r.before.reason}</span>}</td>
              <td className="n" style={{ fontWeight: r.after.price !== r.before.price ? 600 : undefined }}>{r.after.ok ? tl(r.after.price) : <span style={{ color: "var(--bad)" }}>{r.after.reason}</span>}</td>
              <td className="n">{r.after.ok ? `${tl(r.after.netProfit)} (%${Math.round(r.after.profitRate * 100)})` : "-"}</td>
              <td className="muted" style={{ fontSize: 12 }}>{r.applied.join(", ") || "-"}</td>
            </tr>
          ))}</tbody>
        </table></div>
        {sim.fromDb && <p className="muted" style={{ fontSize: 12 }}>Fiyatı en çok değişen 25 ürün gösteriliyor. Mevcut ilanlarda fiyat politikası (ör. "sadece yükselt") ayrıca uygulanır.</p>}
      </div>}
    </>
  );
}
