"use client";

import { useCallback, useEffect, useState } from "react";
import { tl, type Props, type Row } from "./shared";

export default function Overrides({ api, notify }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [d, setD] = useState<Row>({ barcode: "", price_override: "", hidden: false, note: "" });

  const load = useCallback(async () => {
    try { setRows(await api("/api/overrides")); } catch (e: any) { notify("err", e.message); }
  }, [api, notify]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    try {
      await api("/api/overrides", { method: "PUT", body: JSON.stringify({ ...d, price_override: String(d.price_override).replace(",", ".") }) });
      notify("good", "Kaydedildi."); setD({ barcode: "", price_override: "", hidden: false, note: "" }); load();
    } catch (e: any) { notify("err", e.message); }
  }
  async function remove(barcode: string) {
    try { await api(`/api/overrides?barcode=${encodeURIComponent(barcode)}`, { method: "DELETE" }); load(); } catch (e: any) { notify("err", e.message); }
  }

  return (
    <>
      <div className="card">
        <h2>Ürün istisnası ekle</h2>
        <p className="muted">Belirli bir barkod için sabit fiyat yaz veya ürünü satıştan kaldır (stok 0 gönderilir).</p>
        <div className="grid">
          <label className="f">Barkod<input type="text" value={d.barcode} onChange={(e) => setD({ ...d, barcode: e.target.value })} /></label>
          <label className="f">Sabit satış fiyatı (TL)<input type="text" inputMode="decimal" value={d.price_override} onChange={(e) => setD({ ...d, price_override: e.target.value })} /><small>Boşsa formül kullanılır</small></label>
          <label className="f">Not<input type="text" value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} /></label>
        </div>
        <label className="check" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={d.hidden} onChange={(e) => setD({ ...d, hidden: e.target.checked })} />Bu ürünü satıştan kaldır (stok 0)
        </label>
        <div className="row" style={{ marginTop: 12 }}><button className="btn primary" onClick={save}>Kaydet</button></div>
      </div>

      <div className="card">
        <h2>İstisnalar ({rows.length})</h2>
        {rows.length === 0 ? <p className="muted">İstisna yok. Tüm ürünler formülle fiyatlanır.</p> : (
          <div className="scroll"><table>
            <thead><tr><th>Barkod</th><th className="n">Sabit fiyat</th><th>Durum</th><th>Not</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.barcode}>
                <td>{r.barcode}</td>
                <td className="n">{r.price_override == null ? "-" : tl(Number(r.price_override))}</td>
                <td>{r.hidden ? "Satıştan kaldırıldı" : "Aktif"}</td>
                <td>{r.note ?? ""}</td>
                <td className="n"><button className="btn danger" onClick={() => remove(r.barcode)}>Sil</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
