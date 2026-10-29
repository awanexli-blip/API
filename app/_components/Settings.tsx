"use client";

import { useEffect, useState } from "react";
import { bandsFrom, breakdown, calcPrice, defaultConfig } from "@/worker/pricing";
import { tl, type Props, type Row } from "./shared";
import cargo from "@/worker/data/hepsiburada/cargo.json";

const tariff = cargo as { carriers: string[]; byDesi: Record<string, number[]> };
// Kargo basamakları metni: "200=43,99; 400=75,99" (sipariş tutarı bu değerin altındaysa satıcının ödediği kargo)
const bandsText = (v: unknown) => (Array.isArray(v) ? v.map((b: any) => `${b.below}=${String(b.cost).replace(".", ",")}`).join("; ") : "");
function parseBands(t: string): { below: number; cost: number }[] | null | false {
  const parts = t.split(/[;\n]/).map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return null;
  const out = parts.map((p) => { const [a, b] = p.split("=").map((x) => Number(String(x ?? "").replace(",", ".").trim())); return { below: a, cost: b }; });
  return out.every((b) => Number.isFinite(b.below) && b.below > 0 && Number.isFinite(b.cost) && b.cost >= 0) ? out.sort((a, b) => a.below - b.below) : false;
}
const cargoPrice = (desi: number, carrier: string) => tariff.byDesi[String(Math.min(60, Math.max(0, Math.ceil(desi))))]?.[Math.max(0, tariff.carriers.indexOf(carrier))] ?? NaN;

type Field = { key: string; label: string; kind: "pct" | "num" | "int"; hint?: string; advanced?: boolean; optional?: boolean };
const FIELDS: Field[] = [
  { key: "target_profit_rate", label: "Hedef net kâr (%)", kind: "pct", hint: "Satış fiyatının yüzdesi" },
  { key: "commission_rate", label: "Varsayılan komisyon (%)", kind: "pct", hint: "Kategoriye özel oranı Kategoriler sekmesinde girebilirsin" },
  { key: "shipping_cost", label: "Kargo ücreti (TL)", kind: "num" },
  { key: "free_shipping_threshold", label: "Kargo eşiği (TL)", kind: "num", hint: "Bu fiyat ve üstünde kargoyu sen ödersin" },
  { key: "min_markup", label: "En düşük çarpan", kind: "num", hint: "Fiyat en az maliyet × bu değer olur", advanced: true },
  { key: "fixed_cost", label: "Ürün başı sabit gider (TL)", kind: "num", hint: "Paketleme vb." },
  { key: "return_rate", label: "İade oranı (%)", kind: "pct", hint: "Siparişlerin yüzde kaçı iade geliyor (ör. 5)" },
  { key: "return_cost", label: "İade başına maliyet (TL)", kind: "num", hint: "İade kargosu + gidiş kargosu + hasar payı, KDV dahil (ör. 180)" },
  { key: "net_profit_min", label: "Net kâr aralığı: en az (TL)", kind: "num", optional: true, hint: "Doluysa fiyat yüzde hedefine göre değil, en az bu kadar net kâr bırakan en ucuz fiyata göre hesaplanır (kâr kuralları ve 1,3x taban kullanılmaz). Boş = yüzde hedefi" },
  { key: "net_margin_min", label: "Net kâr aralığı: en az marj (%)", kind: "pct", optional: true, hint: "Net kâr TL modunda fiyat hem en az TL tutarını hem satış fiyatının (KDV hariç) en az bu yüzdesini bırakır (ör. 10 = %10, en az 40 TL). Boş = yalnızca TL" },
  { key: "net_profit_max", label: "Net kâr aralığı: en çok (TL)", kind: "num", optional: true, hint: "Bilgi amaçlı üst sınır: yuvarlama veya kargo basamağı yüzünden bunu geçen ürünler not alır" },
  { key: "multi_unit_min_net", label: "Çoklu adet koruması: en az net kâr (TL)", kind: "num", optional: true, hint: "300 TL altı üründen 2-3 adet alınıp sepet 300'ü geçince kargo sana kalır. Doluysa fiyat, o durumda bile bu kadar net kalacak şekilde ayarlanır. Boş = kapalı" },
  { key: "squeeze_min_net", label: "299,90'a çekerken en az net kâr (TL)", kind: "num", optional: true, hint: "Doluysa: kargo alıcıda kalsın diye 299,90'a çekmede yalnızca bu tutara bakılır (yüzde eşiği ve kural şartı yerine). Boş = yüzde eşiği" },
  { key: "min_acceptable_profit_rate", label: "Eşik altına çekmede en düşük kâr (%)", kind: "pct", hint: "299,90 için TL tutarı boşsa kullanılır" },
  { key: "max_price", label: "En yüksek satış fiyatı (TL)", kind: "num", hint: "Bunun üstündeki ürünler atlanır" },
  { key: "min_stock", label: "Minimum stok", kind: "int", hint: "Bunun altındaysa Trendyol'a 0 gönderilir" },
  { key: "vat_rate", label: "Varsayılan KDV (%)", kind: "num", hint: "Yeni ürün açarken", advanced: true },
  { key: "fx_usd", label: "USD kuru (TL)", kind: "num", hint: "XML'de döviz USD ise gerekli", advanced: true },
  { key: "fx_eur", label: "EUR kuru (TL)", kind: "num", hint: "XML'de döviz EUR ise gerekli", advanced: true },
];
const BOOLS: [string, string][] = [
  ["xml_price_includes_vat", "Tedarikçi (BayilikXML) fiyatları KDV dahil (kapalıysa fiyata %20/%10 KDV eklenerek maliyet hesaplanır)"],
  ["auto_create", "Yeni ürünleri de otomatik aç (kapalıysa sadece mevcutlar güncellenir)"],
  ["zero_missing", "XML'den kalkan ürünlerin stoğunu sıfırla"],
];

export default function Settings({ api, notify, marketplace }: Props) {
  const [f, setF] = useState<Row | null>(null); // ekranda gösterilen değerler (yüzde alanları ×100)
  const [simVat, setSimVat] = useState(20);
  const [simDesi, setSimDesi] = useState(2);

  const toForm = (d: Row) => {
    const o: Row = { ...d };
    for (const x of FIELDS) if (x.kind === "pct") o[x.key] = x.optional && d[x.key] == null ? "" : String(Math.round(Number(d[x.key]) * 10000) / 100);
    for (const x of FIELDS) if (x.kind !== "pct") o[x.key] = x.optional && d[x.key] == null ? "" : String(d[x.key]);
    if (d.update_prices === false) o.existing_price_policy = "keep";
    if ("shipping_bands" in d) o.shipping_bands_text = bandsText(d.shipping_bands);
    return o;
  };

  useEffect(() => { api(`/api/settings?mp=${marketplace}`).then((d) => setF(toForm(d))).catch((e) => notify("err", e.message)); /* eslint-disable-next-line */ }, [api, marketplace]);
  if (!f) return <p className="muted">Yükleniyor...</p>;

  const num = (k: string) => Number(String(f[k]).replace(",", "."));
  const cfg = {
    ...defaultConfig,
    commissionRate: num("commission_rate") / 100, targetProfitRate: num("target_profit_rate") / 100,
    shippingCost: num("shipping_cost"), freeShippingThreshold: num("free_shipping_threshold"),
    minMarkup: num("min_markup"), fixedCost: num("fixed_cost"),
    minAcceptableProfitRate: num("min_acceptable_profit_rate") / 100, maxPrice: num("max_price"),
    returnRate: num("return_rate") / 100, returnCost: num("return_cost"),
    squeezeMinNet: String(f.squeeze_min_net ?? "").trim() === "" ? null : num("squeeze_min_net"),
    multiUnitMinNet: String(f.multi_unit_min_net ?? "").trim() === "" ? null : num("multi_unit_min_net"),
    netProfitMin: String(f.net_profit_min ?? "").trim() === "" ? null : num("net_profit_min"),
    netProfitMax: String(f.net_profit_max ?? "").trim() === "" ? null : num("net_profit_max"),
    netMarginMin: String(f.net_margin_min ?? "").trim() === "" ? null : num("net_margin_min") / 100,
    vatRate: simVat / 100,
    commissionPlusVat: f.commission_plus_vat === true, shippingVatIncluded: f.shipping_vat_included !== false, shippingBands: bandsFrom(parseBands(String(f.shipping_bands_text ?? "")) || null),
  };
  const byDesi = f.shipping_mode === "desi";
  if (byDesi) cfg.shippingCost = cargoPrice(simDesi, f.cargo_carrier || "hepsiJET");
  const label = marketplace === "trendyol" ? "Trendyol" : marketplace === "hepsiburada" ? "Hepsiburada" : marketplace;
  // Yalnızca sayısal alanlar kontrol edilir (true/false ayarlar Number.isFinite'te hep geçersiz sayılıyordu)
  const badFields = FIELDS.filter((x) => !(x.optional && String(f[x.key] ?? "").trim() === "") && !Number.isFinite(num(x.key))).map((x) => x.label);
  if (byDesi && !Number.isFinite(cfg.shippingCost)) badFields.push("Desi kargo tarifesi");
  if ("shipping_bands_text" in f && parseBands(String(f.shipping_bands_text)) === false) badFields.push("Kargo basamakları");
  const sumOk = cfg.commissionRate + cfg.targetProfitRate < 1;
  const valid = badFields.length === 0 && sumOk;

  async function save() {
    const body: Row = {};
    for (const x of FIELDS) {
      if (x.optional && String(f![x.key] ?? "").trim() === "") { body[x.key] = null; continue; }
      const v = Number(String(f![x.key]).replace(",", "."));
      body[x.key] = x.kind === "pct" ? v / 100 : v;
    }
    for (const [k] of BOOLS) body[k] = f![k];
    // Pazaryerine özel alanlar (yalnızca sunucudan geldiyse gönderilir: migration öncesi kayıt bozulmasın)
    for (const k of ["commission_plus_vat", "shipping_vat_included", "enabled", "shipping_mode", "cargo_carrier"]) if (k in f!) body[k] = f![k];
    if ("shipping_bands_text" in f!) body.shipping_bands = parseBands(String(f!.shipping_bands_text)) || null;
    if ("default_desi" in f!) body.default_desi = Number(String(f!.default_desi).replace(",", "."));
    body.update_prices = true; // fiyat davranışı yalnızca politika seçimiyle belirlenir ("Fiyata dokunma" = keep)
    body.existing_price_policy = f!.existing_price_policy;
    try { setF(toForm(await api(`/api/settings?mp=${marketplace}`, { method: "PUT", body: JSON.stringify(body) }))); notify("good", "Ayarlar kaydedildi. Bir sonraki senkronizasyonda geçerli olur."); }
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
        <label className="f" style={{ maxWidth: 520 }}>{label}'da zaten olan ürünlerde fiyat nasıl güncellensin?
          <select value={f.existing_price_policy ?? "smart"} onChange={(e) => setF({ ...f, existing_price_policy: e.target.value })}>
            <option value="smart">Akıllı: zararı yükselt, pahalıyı her çalışmada en fazla %10 düşür, 300 TL eşiğinde 299,90'a in (önerilen)</option>
            <option value="floor">Sadece formülün altındaysa yükselt, mevcut fiyatı asla düşürme</option>
            <option value="keep">Fiyata dokunma, sadece stok güncelle</option>
            <option value="formula">Her ürünü formül fiyatına eşitle (fiyatlar düşebilir)</option>
          </select>
        </label>
        <h3>Komisyon ve kargo</h3>
        <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
          {"commission_plus_vat" in f ? (
            <label className="check"><input type="checkbox" checked={!!f.commission_plus_vat} onChange={(e) => setF({ ...f, commission_plus_vat: e.target.checked })} />
              Komisyon oranı +KDV (komisyon faturasına ayrıca KDV ekleniyor){marketplace === "hepsiburada" ? " — Hepsiburada sözleşmesine göre evet" : " — Trendyol'da komisyonlara KDV dahil: kapalı kalmalı"}</label>
          ) : <p className="muted" style={{ fontSize: 13 }}>Komisyon +KDV ayarı için Supabase migration 002 çalıştırılmalı.</p>}
          {"shipping_mode" in f && <>
            <label className="f" style={{ maxWidth: 520 }}>Kargo ücreti nasıl hesaplansın?
              <select value={f.shipping_mode} onChange={(e) => setF({ ...f, shipping_mode: e.target.value })}>
                <option value="desi">Desi tarifesine göre (ürünün desisi XML'den)</option>
                <option value="fixed">Sabit tutar (yukarıdaki kargo ücreti)</option>
              </select>
            </label>
            {f.shipping_mode === "desi" && <div className="grid">
              <label className="f">Kargo firması
                <select value={f.cargo_carrier || "hepsiJET"} onChange={(e) => setF({ ...f, cargo_carrier: e.target.value })}>
                  {tariff.carriers.map((c) => <option key={c} value={c}>{c} (2 desi: {tl(cargoPrice(2, c))})</option>)}
                </select>
              </label>
              <label className="f">Varsayılan desi<input type="text" inputMode="decimal" value={f.default_desi} onChange={(e) => setF({ ...f, default_desi: e.target.value })} /><small>XML'de desi yoksa</small></label>
            </div>}
            <label className="check"><input type="checkbox" checked={f.shipping_vat_included !== false} onChange={(e) => setF({ ...f, shipping_vat_included: e.target.checked })} />Kargo tutarları KDV dahil (Hepsiburada tarifesi KDV hariçtir: işareti kaldır)</label>
          </>}
            {"shipping_bands_text" in f && <label className="f" style={{ maxWidth: 520 }}>Kargo basamakları (barem)
              <input type="text" placeholder="200=43,99; 400=75,99" value={f.shipping_bands_text} onChange={(e) => setF({ ...f, shipping_bands_text: e.target.value })} />
              <small>Sipariş tutarı bu değerin altındaysa satıcının ödediği sabit kargo; son basamağın üstünde desi tarifesi. Doluysa ücretsiz kargo eşiği kullanılmaz. Boş = basamak yok.
                {marketplace === "hepsiburada" ? " Hepsiburada 21.09.2026: 0–199,99 TL 43,99 + KDV, 200–399,99 TL 75,99 + KDV (hepsiJET/Sürat, 0–1 gün kargolama)." : ""}
                {marketplace === "trendyol" ? " Trendyol: 300 TL altında da kargo satıcıdan kesiliyor (Ekim dökümü: 139–199 TL siparişte 58–65 TL ya da 104 TL, 200–300 TL'de 102–112 TL, üstünde 107–115 TL; KDV dahil). Son basamağın üstü: yukarıdaki kargo ücreti." : ""}</small>
            </label>}
        </div>
        <h3>Davranış</h3>
        <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
          {"enabled" in f && <label className="check"><input type="checkbox" checked={!!f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />Bu pazaryeri aktif (kapalıysa hiç çalışmaz)</label>}
          {BOOLS.map(([k, label]) => (
            <label className="check" key={k}>
              <input type="checkbox" checked={!!f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />{label}
            </label>
          ))}
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn primary" onClick={save} disabled={!valid}>Ayarları kaydet</button>
          {!valid && <span className="muted">{badFields.length ? `Geçersiz veya boş: ${badFields.join(", ")}` : "Komisyon ve kâr toplamı %100'den küçük olmalı."}</span>}
        </div>
      </div>

      <div className="card">
        <h2>Fiyat simülasyonu</h2>
        <p className="muted">Kaydetmeden denemek için yukarıdaki değerleri değiştir. Tutarlar KDV dahil girilir. Alış, komisyon ve kargo faturalarındaki KDV indirilir. <strong>Net kâr cebe kalan tutardır</strong> (KDV ödendikten sonra), kâr oranı KDV hariç satışa göredir. Gerçek senkronda her ürünün kendi komisyonu ve KDV oranı kullanılır.</p>
        <div className="row" style={{ marginBottom: 12, alignItems: "flex-end" }}>
          <label className="f" style={{ width: 160 }}>Ürün KDV oranı
            <select value={simVat} onChange={(e) => setSimVat(Number(e.target.value))}>
              <option value={20}>%20</option><option value={10}>%10</option><option value={1}>%1</option>
            </select>
          </label>
          {byDesi && <label className="f" style={{ width: 160 }}>Desi
            <select value={simDesi} onChange={(e) => setSimDesi(Number(e.target.value))}>
              {[1, 2, 3, 5, 10, 20, 30].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>}
        </div>
        {valid ? (
          <div className="scroll">
            <table className="sim">
              <thead><tr><th className="n">Maliyet</th><th className="n">Satış fiyatı</th><th className="n">Komisyon</th><th className="n">Kargo</th><th className="n">İade payı</th><th className="n">Ödenecek KDV</th><th className="n">Net kâr</th><th className="n">Kâr oranı</th></tr></thead>
              <tbody>
                {[30, 60, 100, 150, 200, 250, 300, 400, 600, 1000, 2500].map((c) => {
                  const r = calcPrice(c, cfg as any);
                  if (!r.ok) return <tr key={c}><td className="n">{tl(c)}</td><td colSpan={7} className="warn">Atlanır: {r.reason}</td></tr>;
                  const b = breakdown(r.price, c, cfg as any);
                  return (
                    <tr key={c} title={r.note ?? ""}>
                      <td className="n">{tl(c)}</td>
                      <td className="n"><strong>{tl(r.price)}</strong></td>
                      <td className="n">−{tl(b.commission)}</td>
                      <td className="n">{b.shipping ? "−" + tl(b.shipping) : <span className="muted">alıcı öder</span>}</td>
                      <td className="n">{b.returns ? "−" + tl(b.returns) : <span className="muted">-</span>}</td>
                      <td className="n">{b.vatDue >= 0 ? "−" + tl(b.vatDue) : "+" + tl(-b.vatDue)}</td>
                      <td className="n"><strong>{tl(b.net)}</strong></td>
                      <td className="n">%{(b.rate * 100).toFixed(1)}{r.note ? " *" : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>* 299,90 TL'ye sabitlendi: kargo alıcıda kalsın diye kâr hedefin biraz altında. Ödenecek KDV eksi çıkarsa (+) devreden KDV'dir.</p>
            <p className="muted" style={{ fontSize: 13 }}>
              <b>KDV nasıl hesaplanıyor?</b> Satış fiyatındaki KDV'den; alış faturasındaki, komisyon faturasındaki ve kargo faturasındaki KDV düşülür, kalan "Ödenecek KDV" devlete gider ve net kârdan çıkarılır.
              <b> İade payı</b> = iade oranı × iade başına maliyet; her siparişe beklenen gider olarak eklenir (iade kargosunun KDV'si de indirilir).
              Net kâr = satış − alış − komisyon − kargo − sabit gider − iade payı − ödenecek KDV.
            </p>
          </div>
        ) : <p className="muted">Geçerli değerler girince tablo görünür.</p>}
      </div>
    </>
  );
}

