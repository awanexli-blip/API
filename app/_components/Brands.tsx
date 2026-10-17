"use client";

import { useCallback, useEffect, useState } from "react";
import { when, type Props, type Row } from "./shared";
import BrandInput from "./BrandInput";

export default function Brands({ api, notify, marketplace }: Props) {
  const [d, setD] = useState<Row | null>(null);
  const [brand, setBrand] = useState("");
  const [busy, setBusy] = useState(false);
  const label = marketplace === "hepsiburada" ? "Hepsiburada" : "Trendyol";

  const load = useCallback(async () => {
    try { const r = await api(`/api/brands?mp=${marketplace}`); setD(r); setBrand(r.current ?? ""); } catch (e: any) { notify("err", e.message); }
  }, [api, notify, marketplace]);
  useEffect(() => { load(); }, [load]);

  async function put(body: unknown, ok: string) {
    setBusy(true);
    try { await api(`/api/brands?mp=${marketplace}`, { method: "PUT", body: JSON.stringify(body) }); notify("good", ok); await load(); }
    catch (e: any) { notify("err", e.message); }
    finally { setBusy(false); }
  }

  if (!d) return <p className="muted">Yükleniyor...</p>;
  const active = d.current || d.default;
  const prev = d.history?.[0];
  const stats = d.stats ? Object.entries(d.stats.brands as Record<string, { n: number; closed: number }>) : [];
  const total = stats.reduce((t, [, v]) => t + v.n, 0);

  return (
    <>
      <div className="card">
        <h2>Yeni ürünlerin markası</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Sistem {label}'da yeni ürün açarken bu markayı kullanır. <b>Zaten açık ürünlerin markası değişmez</b>: Trendyol onaylı üründe marka değişikliğine izin vermiyor.
          Yeni marka hata verirse (marka bulunamadı, belge istendi) aşağıdan tek tıkla eski markaya dön.
        </p>
        <div style={{ fontSize: 15, margin: "8px 0 12px" }}>Şu an: <b>{active}</b>{!d.current && <span className="muted"> (varsayılan)</span>}</div>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 280px" }}><BrandInput api={api} value={brand} onChange={setBrand} placeholder={d.default} /></div>
          <button className="btn primary" disabled={busy || brand.trim() === (d.current ?? "")} onClick={() => put({ brand }, `Yeni ürün markası: ${brand.trim() || d.default}`)}>Kaydet</button>
          {prev && <button className="btn" disabled={busy} onClick={() => put({ revert: true }, `Eski markaya dönüldü: ${prev.brand || d.default}`)}>↶ Geri al ({prev.brand || d.default})</button>}
          {d.current && <button className="btn" disabled={busy} onClick={() => put({ brand: "" }, `Varsayılan markaya dönüldü: ${d.default}`)}>Varsayılana dön</button>}
        </div>
        {d.brandListCount === 0 && <p className="muted" style={{ fontSize: 13 }}>{label} marka listesi henüz çekilmedi; öneriler boş görünebilir. GitHub → Actions → "Marka listesi" → Run workflow ile çalıştır (haftada bir kendiliğinden çalışır).</p>}
        {d.issues?.length > 0 && <div className="msg err" style={{ marginTop: 12 }}>
          <b>Markayla ilgili sorunlar</b>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{d.issues.map((x: string) => <li key={x}>{x}</li>)}</ul>
          {prev && <div style={{ marginTop: 6 }}>Eski markaya dönmek için yukarıdaki "Geri al" düğmesini kullan.</div>}
        </div>}
        {d.history?.length > 0 && <details style={{ marginTop: 12 }}>
          <summary>Değişiklik geçmişi ({d.history.length})</summary>
          <table style={{ marginTop: 6 }}><tbody>{d.history.map((h: Row, i: number) => <tr key={i}><td className="muted" style={{ width: 180 }}>{when(h.at)}</td><td>önceki marka: {h.brand || `${d.default} (varsayılan)`}</td></tr>)}</tbody></table>
        </details>}
      </div>

      <div className="card">
        <h2>Mağazadaki markalar</h2>
        {!stats.length ? <p className="muted">Henüz veri yok. Bir sonraki senkronizasyondan sonra (en geç 15 dakika) burada görünür.</p> : <>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>{when(d.stats.at)} itibarıyla, onaylı {total.toLocaleString("tr-TR")} ürün. "Kapatılan" = Trendyol'un kilitlediği / kara listeye aldığı.</p>
          <div className="scroll"><table>
            <thead><tr><th>Marka</th><th className="n">Ürün</th><th className="n">Pay</th><th className="n">Kapatılan</th></tr></thead>
            <tbody>{stats.map(([name, v]) => (
              <tr key={name}>
                <td>{name}{name === active && <span className="pill ok" style={{ marginLeft: 6 }}>yeni ürünlerde</span>}</td>
                <td className="n">{v.n.toLocaleString("tr-TR")}</td>
                <td className="n">%{Math.round((v.n / total) * 1000) / 10}</td>
                <td className="n" style={{ color: v.closed ? "var(--bad)" : undefined }}>{v.closed || "-"}{v.closed ? ` (%${Math.round((v.closed / v.n) * 100)})` : ""}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </>}
      </div>
    </>
  );
}
