"use client";

import { useEffect, useState } from "react";
import { breakdown, calcPrice, defaultConfig } from "@/worker/pricing";
import { tl, type Props, type Row } from "./shared";

type Field = { key: string; label: string; kind: "pct" | "num" | "int"; hint?: string; advanced?: boolean };
const FIELDS: Field[] = [
  { key: "target_profit_rate", label: "Hedef net kâr (%)", kind: "pct", hint: "Satış fiyatının yüzdesi" },
  { key: "commission_rate", label: "Varsayılan komisyon (%)", kind: "pct", hint: "Kategoriye özel oranı Kategoriler sekmesinde girebilirsin" },
  { key: "shipping_cost", label: "Kargo ücreti (TL)", kind: "num" },
  { key: "free_shipping_threshold", label: "Kargo eşiği (TL)", kind: "num", hint: "Bu fiyat ve üstünde kargoyu sen ödersin" },
  { key: "min_markup", label: "En düşük çarpan", kind: "num", hint: "Fiyat en az maliyet × bu değer olur", advanced: true },
  { key: "fixed_cost", label: "Ürün başı sabit gider (TL)", kind: "num", hint: "Paketleme vb." },
  { key: "min_acceptable_profit_rate", label: "Eşik altına çekmede en düşük kâr (%)", kind: "pct", hint: "Fiyat 299,90'a sabitlenirse kabul edilen en düşük kâr" },
  { key: "max_price", label: "En yüksek satış fiyatı (TL)", kind: "num", hint: "Bunun üstündeki ürünler atlanır" },
  { key: "min_stock", label: "Minimum stok", kind: "int", hint: "Bunun altındaysa Trendyol'a 0 gönderilir" },
  { key: "vat_rate", label: "Varsayılan KDV (%)", kind: "num", hint: "Yeni ürün açarken", advanced: true },
  { key: "fx_usd", label: "USD kuru (TL)", kind: "num", hint: "XML'de döviz USD ise gerekli", advanced: true },
  { key: "fx_eur", label: "EUR kuru (TL)", kind: "num", hint: "XML'de döviz EUR ise gerekli", advanced: true },
];
const BOOLS: [string, string][] = [
  ["auto_create", "Yeni ürünleri de otomatik aç (kapalıysa sadece mevcutlar güncellenir)"],
  ["zero_missing", "XML'den kalkan ürünlerin stoğunu sıfırla"],
];

export default function Settings({ api, notify }: Props) {
  const [f, setF] = useState<Row | null>(null); // ekranda gösterilen değerler (yüzde alanları ×100)
  const [simVat, setSimVat] = useState(20);

  const toForm = (d: Row) => {
    const o: Row = { ...d };
    for (const x of FIELDS) if (x.kind === "pct") o[x.key] = String(Math.round(Number(d[x.key]) * 10000) / 100);
    for (const x of FIELDS) if (x.kind !== "pct") o[x.key] = String(d[x.key]);
    if (d.update_prices === false) o.existing_price_policy = "keep";
    return o;
  };

  useEffect(() => { api("/api/settings").then((d) => setF(toForm(d))).catch((e) => notify("err", e.message)); /* eslint-disable-next-line */ }, [api]);
  if (!f) return <p className="muted">Yükleniyor...</p>;

  const num = (k: string) => Number(String(f[k]).replace(",", "."));
  const cfg = {
    ...defaultConfig,
    commissionRate: num("commission_rate") / 100, targetProfitRate: num("target_profit_rate") / 100,
    shippingCost: num("shipping_cost"), freeShippingThreshold: num("free_shipping_threshold"),
    minMarkup: num("min_markup"), fixedCost: num("fixed_cost"),
    minAcceptableProfitRate: num("min_acceptable_profit_rate") / 100, maxPrice: num("max_price"),
    vatRate: simVat / 100,
  };
  const valid = Object.values(cfg).every((v) => Number.isFinite(v)) && cfg.commissionRate + cfg.targetProfitRate < 1;

  async function save() {
    const body: Row = {};
    for (const x of FIELDS) {
      const v = Number(String(f![x.key]).replace(",", "."));
      body[x.key] = x.kind === "pct" ? v / 100 : v;
    }
    for (const [k] of BOOLS) body[k] = f![k];
    body.update_prices = true; // fiyat davranışı yalnızca politika seçimiyle belirlenir ("Fiyata dokunma" = keep)
    body.existing_price_policy = f!.existing_price_policy;
    try { setF(toForm(await api("/api/settings", { method: "PUT", body: JSON.stringify(body) }))); notify("good", "Ayarlar kaydedildi. Bir sonraki senkronizasyonda geçerli olur."); }
    catch (e: any) { notify("err", e.message); }
  }

  return (
    <>
      <div className="card">
        <h2>Fiyat ve stok ayarları</h2>
        <div className="grid">
          {FIELDS.filter((x) => !x.advanced).map((x) => (
            <label className="f" key={x.key}>{x.label}
              <input type="text" inputMode="decimal" value={f[x.key]} onChange={(e) => setF({ ...f, [x.key]: e.target.value })} />
              {x.hint && <small>{x.hint}</small>}
            </label>
          ))}
        </div>
        <details style={{ marginTop: 12 }}>
          <summary>Gelişmiş (çarpan, KDV, döviz kurları)</summary>
          <div className="grid" style={{ marginTop: 10 }}>
            {FIELDS.filter((x) => x.advanced).map((x) => (
              <label className="f" key={x.key}>{x.label}
                <input type="text" inputMode="decimal" value={f[x.key]} onChange={(e) => setF({ ...f, [x.key]: e.target.value })} />
                {x.hint && <small>{x.hint}</small>}
              </label>
            ))}
          </div>
        </details>
        <h3>Mevcut ürünlerin fiyatı</h3>
        <label className="f" style={{ maxWidth: 520 }}>Trendyol'da zaten olan ürünlerde fiyat nasıl güncellensin?
          <select value={f.existing_price_policy ?? "smart"} onChange={(e) => setF({ ...f, existing_price_policy: e.target.value })}>
            <option value="smart">Akıllı: zararı yükselt, pahalıyı her çalışmada en fazla %10 düşür, 300 TL eşiğinde 299,90'a in (önerilen)</option>
            <option value="floor">Sadece formülün altındaysa yükselt, mevcut fiyatı asla düşürme</option>
            <option value="keep">Fiyata dokunma, sadece stok güncelle</option>
            <option value="formula">Her ürünü formül fiyatına eşitle (fiyatlar düşebilir)</option>
          </select>
        </label>
        <h3>Davranış</h3>
        <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
          {BOOLS.map(([k, label]) => (
            <label className="check" key={k}>
              <input type="checkbox" checked={!!f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />{label}
            </label>
          ))}
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn primary" onClick={save} disabled={!valid}>Ayarları kaydet</button>
          {!valid && <span className="muted">Değerleri kontrol et. Komisyon ve kâr toplamı %100'den küçük olmalı.</span>}
        </div>
      </div>

      <div className="card">
        <h2>Fiyat simülasyonu</h2>
        <p className="muted">Kaydetmeden denemek için yukarıdaki değerleri değiştir. Tutarlar KDV dahil girilir. Alış, komisyon ve kargo faturalarındaki KDV indirilir. <strong>Net kâr cebe kalan tutardır</strong> (KDV ödendikten sonra), kâr oranı KDV hariç satışa göredir. Gerçek senkronda her ürünün kendi komisyonu ve KDV oranı kullanılır.</p>
        <label className="f" style={{ maxWidth: 220, marginBottom: 12 }}>Ürün KDV oranı
          <select value={simVat} onChange={(e) => setSimVat(Number(e.target.value))}>
            <option value={20}>%20</option><option value={10}>%10</option><option value={1}>%1</option>
          </select>
        </label>
        {valid ? (
          <div className="scroll">
            <table className="sim">
              <thead><tr><th className="n">Maliyet</th><th className="n">Satış fiyatı</th><th className="n">Komisyon</th><th className="n">Kargo</th><th className="n">Ödenecek KDV</th><th className="n">Net kâr</th><th className="n">Kâr oranı</th></tr></thead>
              <tbody>
                {[30, 60, 100, 150, 200, 250, 300, 400, 600, 1000, 2500].map((c) => {
                  const r = calcPrice(c, cfg as any);
                  if (!r.ok) return <tr key={c}><td className="n">{tl(c)}</td><td colSpan={6} className="warn">Atlanır: {r.reason}</td></tr>;
                  const b = breakdown(r.price, c, cfg as any);
                  return (
                    <tr key={c} title={r.note ?? ""}>
                      <td className="n">{tl(c)}</td>
                      <td className="n"><strong>{tl(r.price)}</strong></td>
                      <td className="n">−{tl(b.commission)}</td>
                      <td className="n">{b.shipping ? "−" + tl(b.shipping) : <span className="muted">alıcı öder</span>}</td>
                      <td className="n">{b.vatDue >= 0 ? "−" + tl(b.vatDue) : "+" + tl(-b.vatDue)}</td>
                      <td className="n"><strong>{tl(b.net)}</strong></td>
                      <td className="n">%{(b.rate * 100).toFixed(1)}{r.note ? " *" : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>* 299,90 TL'ye sabitlendi: kargo alıcıda kalsın diye kâr hedefin biraz altında. Ödenecek KDV eksi çıkarsa (+) devreden KDV'dir.</p>
          </div>
        ) : <p className="muted">Geçerli değerler girince tablo görünür.</p>}
      </div>
    </>
  );
}

