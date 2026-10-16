"use client";

import { useCallback, useEffect, useState } from "react";
import { type Props, type Row } from "./shared";

const emptyDraft = { xml_category: "", category_id: "", commission_rate: "", vat_rate: "", attributes: "" };

export default function Categories({ api, notify }: Props) {
  const [mapped, setMapped] = useState<Row[]>([]);
  const [unmapped, setUnmapped] = useState<Row[]>([]);
  const [d, setD] = useState<Row>(emptyDraft);

  const load = useCallback(async () => {
    try { const r = await api("/api/categories"); setMapped(r.mapped); setUnmapped(r.unmapped); } catch (e: any) { notify("err", e.message); }
  }, [api, notify]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    try {
      await api("/api/categories", {
        method: "PUT",
        body: JSON.stringify({
          xml_category: d.xml_category, category_id: d.category_id,
          commission_rate: d.commission_rate === "" ? "" : Number(String(d.commission_rate).replace(",", ".")) / 100,
          vat_rate: d.vat_rate, attributes: d.attributes,
        }),
      });
      notify("good", "Kategori eşleşmesi kaydedildi."); setD(emptyDraft); load();
    } catch (e: any) { notify("err", e.message); }
  }

  async function remove(name: string) {
    if (!confirm(`"${name}" eşleşmesi silinsin mi?`)) return;
    try { await api(`/api/categories?xml_category=${encodeURIComponent(name)}`, { method: "DELETE" }); load(); } catch (e: any) { notify("err", e.message); }
  }

  const edit = (c: Row) => {
    setD({
      xml_category: c.xml_category, category_id: String(c.category_id),
      commission_rate: c.commission_rate == null ? "" : String(Math.round(Number(c.commission_rate) * 10000) / 100),
      vat_rate: c.vat_rate == null ? "" : String(c.vat_rate),
      attributes: c.attributes?.length ? JSON.stringify(c.attributes) : "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <>
      <div className="card">
        <h2>Kategori eşleştir</h2>
        <p className="muted">XML'deki kategori adını Trendyol kategori ID'si ile eşleştir. Eşleşmeyen kategorideki yeni ürünler açılmaz.</p>
        <div className="grid">
          <label className="f">XML kategori adı<input type="text" value={d.xml_category} onChange={(e) => setD({ ...d, xml_category: e.target.value })} /></label>
          <label className="f">Trendyol kategori ID<input type="text" inputMode="numeric" value={d.category_id} onChange={(e) => setD({ ...d, category_id: e.target.value })} /></label>
          <label className="f">Komisyon (%)<input type="text" inputMode="decimal" value={d.commission_rate} onChange={(e) => setD({ ...d, commission_rate: e.target.value })} /><small>Boşsa varsayılan komisyon kullanılır</small></label>
          <label className="f">KDV (%)<input type="text" inputMode="decimal" value={d.vat_rate} onChange={(e) => setD({ ...d, vat_rate: e.target.value })} /><small>Boşsa varsayılan KDV</small></label>
        </div>
        <label className="f" style={{ marginTop: 12 }}>Zorunlu özellikler (JSON, isteğe bağlı)
          <textarea value={d.attributes} placeholder='[{"attributeId": 47, "attributeValueId": 1234}]' onChange={(e) => setD({ ...d, attributes: e.target.value })} />
          <small>Trendyol bazı kategorilerde renk, beden gibi özellikleri zorunlu tutar.</small>
        </label>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={save}>Eşleşmeyi kaydet</button>
          <button className="btn" onClick={() => setD(emptyDraft)}>Temizle</button>
        </div>
      </div>

      <div className="card">
        <h2>Eşleşmeyen kategoriler ({unmapped.length})</h2>
        {unmapped.length === 0 ? <p className="muted">Eşleşmeyen kategori yok. Liste her önizleme veya senkronizasyondan sonra güncellenir.</p> : (
          <div className="scroll"><table>
            <thead><tr><th>XML kategorisi</th><th className="n">Yeni ürün</th><th /></tr></thead>
            <tbody>{unmapped.map((u) => (
              <tr key={u.xml_category}><td>{u.xml_category}</td><td className="n">{u.product_count}</td>
                <td className="n"><button className="btn" onClick={() => edit({ xml_category: u.xml_category, category_id: "", attributes: [] })}>Eşleştir</button></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="card">
        <h2>Eşleşenler ({mapped.length})</h2>
        {mapped.length === 0 ? <p className="muted">Henüz eşleşme yok.</p> : (
          <div className="scroll"><table>
            <thead><tr><th>XML kategorisi</th><th className="n">Trendyol ID</th><th className="n">Komisyon</th><th className="n">KDV</th><th /></tr></thead>
            <tbody>{mapped.map((c) => (
              <tr key={c.xml_category}>
                <td>{c.xml_category}</td><td className="n">{c.category_id}</td>
                <td className="n">{c.commission_rate == null ? "-" : `%${Math.round(Number(c.commission_rate) * 10000) / 100}`}</td>
                <td className="n">{c.vat_rate == null ? "-" : `%${c.vat_rate}`}</td>
                <td className="n"><div className="row" style={{ justifyContent: "flex-end" }}>
                  <button className="btn" onClick={() => edit(c)}>Düzenle</button>
                  <button className="btn danger" onClick={() => remove(c.xml_category)}>Sil</button>
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

