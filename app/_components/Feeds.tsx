"use client";

import { useCallback, useEffect, useState } from "react";
import { when, type Api, type Notify, type Row } from "./shared";

const PRICE_TR: Record<string, string> = { none: "Fiyat yok", cost: "Alış fiyatı", formula: "Satış fiyatı (formül)" };
const SOURCE_TR: Record<string, string> = { "": "Tüm ürünler", manual: "Elle eklenenler", csv: "Dosyadan gelenler", "xml:bayilik": "BayilikXML ürünleri" };

// XML feed: ürünleri başka sistemlere (pazaryeri entegratörü, kendi siten) XML olarak veren gizli adresler
export default function Feeds({ api, notify }: { api: Api; notify: Notify }) {
  const [list, setList] = useState<Row[]>([]);
  const [d, setD] = useState({ name: "", price_mode: "formula", only_in_stock: true, source_filter: "" });
  const load = useCallback(() => api("/api/feeds").then(setList).catch((e) => notify("err", e.message)), [api, notify]);
  useEffect(() => { load(); }, [load]);
  const url = (t: string) => `${window.location.origin}/api/feed/${t}`;

  async function create() {
    try { await api("/api/feeds", { method: "POST", body: JSON.stringify(d) }); setD({ ...d, name: "" }); notify("good", "Feed oluşturuldu. Adresi kopyalayıp kullanacağın sisteme ver."); load(); }
    catch (e: any) { notify("err", e.message); }
  }
  async function rotate(f: Row) {
    if (!confirm(`"${f.name}" için yeni adres oluşturulsun mu? Eski adres hemen çalışmaz hale gelir.`)) return;
    try { await api("/api/feeds", { method: "PUT", body: JSON.stringify({ id: f.id, rotate: true }) }); notify("good", "Yeni adres oluşturuldu."); load(); } catch (e: any) { notify("err", e.message); }
  }
  async function remove(f: Row) {
    if (!confirm(`"${f.name}" feed'i silinsin mi? Adresi kullanan sistemler ürün alamaz.`)) return;
    try { await api(`/api/feeds?id=${f.id}`, { method: "DELETE" }); load(); } catch (e: any) { notify("err", e.message); }
  }
  const copy = (t: string) => navigator.clipboard.writeText(url(t)).then(() => notify("good", "Adres kopyalandı."), () => notify("err", "Kopyalanamadı, adresi elle seç."));

  return (
    <>
      <div className="card">
        <h2>Yeni XML feed</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Ürün veritabanındaki aktif ürünleri XML olarak veren gizli bir adres oluşturur (ör. bir entegratöre veya kendi sitene vermek için). Adresi bilen herkes okuyabilir;
          sızdığını düşünürsen "Yeni adres" ile değiştir. Satış fiyatı, Trendyol fiyat ayarlarındaki formülle (varsayılan komisyon) hesaplanır.
        </p>
        <div className="grid">
          <label className="f">Ad<input type="text" value={d.name} placeholder="ör. Kendi sitem" onChange={(e) => setD({ ...d, name: e.target.value })} /></label>
          <label className="f">Fiyat
            <select value={d.price_mode} onChange={(e) => setD({ ...d, price_mode: e.target.value })}>{Object.entries(PRICE_TR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            {d.price_mode === "cost" && <small style={{ color: "var(--warn)" }}>Dikkat: alış fiyatın, feed adresini bilen herkese açık olur. Yalnızca güvendiğin bir yere ver.</small>}
          </label>
          <label className="f">Ürünler
            <select value={d.source_filter} onChange={(e) => setD({ ...d, source_filter: e.target.value })}>{Object.entries(SOURCE_TR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          <label className="check" style={{ alignSelf: "end" }}><input type="checkbox" checked={d.only_in_stock} onChange={(e) => setD({ ...d, only_in_stock: e.target.checked })} />Sadece stokta olanlar</label>
        </div>
        <button className="btn primary" style={{ marginTop: 12 }} disabled={!d.name.trim()} onClick={create}>Feed oluştur</button>
      </div>

      <div className="card">
        <h2>Feed'ler ({list.length})</h2>
        {list.length === 0 ? <p className="muted">Henüz feed yok.</p> : <div className="scroll"><table>
          <thead><tr><th>Ad</th><th>İçerik</th><th>Adres</th><th>Son okunma</th><th /></tr></thead>
          <tbody>{list.map((f) => (
            <tr key={f.id}>
              <td>{f.name}</td>
              <td style={{ fontSize: 13 }}>{SOURCE_TR[f.source_filter ?? ""]} · {PRICE_TR[f.price_mode]}{f.only_in_stock ? " · stoktakiler" : ""}</td>
              <td style={{ fontSize: 12, wordBreak: "break-all", maxWidth: 260 }}><a href={url(f.token)} target="_blank" rel="noreferrer">…/api/feed/{f.token.slice(0, 8)}…</a></td>
              <td className="muted" style={{ fontSize: 13 }}>{f.last_access_at ? `${when(f.last_access_at)} (${f.access_count})` : "hiç"}</td>
              <td className="n"><div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                <button className="btn" onClick={() => copy(f.token)}>Kopyala</button>
                <button className="btn" onClick={() => rotate(f)}>Yeni adres</button>
                <button className="btn danger" onClick={() => remove(f)}>Sil</button>
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>}
      </div>
    </>
  );
}
