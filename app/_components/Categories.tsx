"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { type Props, type Row } from "./shared";

const emptyDraft = { xml_category: "", category_id: "", category_name: "", commission_rate: "", vat_rate: "", attributes: "" };
const STRONG = 0.6; // benzer ürünlerin en az %60'ı aynı kategorideyse öneri "güçlü"
const pct = (v: unknown) => `%${Math.round(Number(v) * 1000) / 10}`;

export default function Categories({ api, notify, marketplace }: Props) {
  const [mapped, setMapped] = useState<Row[]>([]);
  const [unmapped, setUnmapped] = useState<Row[]>([]);
  const [d, setD] = useState<Row | null>(null); // düzenlenen kayıt (null: form kapalı)
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const label = marketplace === "hepsiburada" ? "Hepsiburada" : "Trendyol";

  const load = useCallback(async () => {
    try { const r = await api(`/api/categories?mp=${marketplace}`); setMapped(r.mapped); setUnmapped(r.unmapped); } catch (e: any) { notify("err", e.message); }
  }, [api, notify, marketplace]);
  useEffect(() => { load(); }, [load]);

  const waiting = unmapped.reduce((s, u) => s + Number(u.product_count || 0), 0);
  const strong = unmapped.filter((u) => u.suggested_category_id && Number(u.suggested_share) >= STRONG);
  const shown = useMemo(() => {
    const t = q.trim().toLocaleLowerCase("tr");
    return t ? mapped.filter((c) => `${c.xml_category} ${c.category_name ?? ""} ${c.category_id}`.toLocaleLowerCase("tr").includes(t)) : mapped;
  }, [mapped, q]);

  const fromSuggestion = (u: Row) => ({ xml_category: u.xml_category, category_id: u.suggested_category_id, category_name: u.suggested_category_name, commission_rate: u.suggested_commission ?? null });

  async function put(body: unknown, ok: string) {
    setBusy(true);
    try { await api(`/api/categories?mp=${marketplace}`, { method: "PUT", body: JSON.stringify(body) }); notify("good", ok); setD(null); await load(); }
    catch (e: any) { notify("err", e.message); }
    finally { setBusy(false); }
  }

  const approve = (u: Row) => put(fromSuggestion(u), `"${u.xml_category}" → ${u.suggested_category_name} eşleşti.`);
  const approveAll = () => {
    if (!confirm(`${strong.length} kategorideki güçlü öneriler onaylansın mı? Sonradan tek tek düzenleyebilir veya silebilirsin.`)) return;
    put({ items: strong.map(fromSuggestion) }, `${strong.length} kategori eşleşti. Ürünler bir sonraki "Yeni ürünleri aç" çalışmasında açılabilir.`);
  };

  function saveDraft() {
    if (!d) return;
    put({
      ...d,
      commission_rate: d.commission_rate === "" ? "" : Number(String(d.commission_rate).replace(",", ".")) / 100,
    }, "Kategori eşleşmesi kaydedildi.");
  }

  async function remove(c: Row) {
    if (!confirm(`"${c.xml_category}" eşleşmesi silinsin mi? Bu kategorideki yeni ürünler artık açılmaz.`)) return;
    try { await api(`/api/categories?mp=${marketplace}&xml_category=${encodeURIComponent(c.xml_category)}`, { method: "DELETE" }); load(); } catch (e: any) { notify("err", e.message); }
  }

  const edit = (c: Row) => {
    setD({
      xml_category: c.xml_category, category_id: c.category_id ? String(c.category_id) : "", category_name: c.category_name ?? "",
      commission_rate: c.commission_rate == null ? "" : String(Math.round(Number(c.commission_rate) * 10000) / 100),
      vat_rate: c.vat_rate == null ? "" : String(c.vat_rate),
      attributes: c.attributes?.length ? JSON.stringify(c.attributes) : "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <>
      <div className="card">
        <h2>Kategoriler ne işe yarar?</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Yeni ürün açarken {label} her ürün için kendi kategorisini ister. BayilikXML'in kategori adları ({'"'}Pratik Ev Aletleri{'"'} gibi) {label}'da yok.
          Bu sayfada XML kategorisini {label} kategorisine bağlarsın. <b>Mevcut ürünlerin stok ve fiyat güncellemesi bu sayfadan etkilenmez</b>, yalnızca yeni ürün açmayı etkiler.
        </p>
        <div className="row" style={{ gap: 24, marginTop: 8 }}>
          <div><div style={{ fontSize: 22, fontWeight: 600 }}>{mapped.length}</div><div className="muted">eşleşmiş kategori</div></div>
          <div><div style={{ fontSize: 22, fontWeight: 600 }}>{unmapped.length}</div><div className="muted">bekleyen kategori</div></div>
          <div><div style={{ fontSize: 22, fontWeight: 600 }}>{waiting}</div><div className="muted">yeni ürün kategori bekliyor</div></div>
        </div>
      </div>

      {d && (
        <div className="card" style={{ borderColor: "var(--accent)" }}>
          <h2>{d.xml_category ? `Eşleştir: ${d.xml_category}` : "Elle eşleşme ekle"}</h2>
          <div className="grid">
            <label className="f">XML kategori adı<input type="text" value={d.xml_category} onChange={(e) => setD({ ...d, xml_category: e.target.value })} /></label>
            <label className="f">{label} kategori ID<input type="text" inputMode="numeric" value={d.category_id} onChange={(e) => setD({ ...d, category_id: e.target.value })} /><small>{label} satıcı panelindeki kategori numarası</small></label>
            <label className="f">Kategori adı (isteğe bağlı)<input type="text" value={d.category_name} onChange={(e) => setD({ ...d, category_name: e.target.value })} /><small>Sadece listede görünmesi için</small></label>
            <label className="f">Komisyon (%)<input type="text" inputMode="decimal" value={d.commission_rate} onChange={(e) => setD({ ...d, commission_rate: e.target.value })} /><small>Boşsa ürünün kendi oranı veya varsayılan kullanılır</small></label>
          </div>
          <details style={{ marginTop: 12 }}>
            <summary>Gelişmiş: KDV ve zorunlu özellikler</summary>
            <div className="grid" style={{ marginTop: 8 }}>
              <label className="f">KDV (%)<input type="text" inputMode="decimal" value={d.vat_rate} onChange={(e) => setD({ ...d, vat_rate: e.target.value })} /><small>Boşsa varsayılan KDV</small></label>
            </div>
            <label className="f" style={{ marginTop: 8 }}>Zorunlu özellikler (JSON)
              <textarea value={d.attributes} placeholder={marketplace === "hepsiburada" ? '[{"name": "renk_variant_property", "value": "Siyah"}]' : '[{"attributeId": 47, "attributeValueId": 1234}]'} onChange={(e) => setD({ ...d, attributes: e.target.value })} />
              <small>Çoğu zaman gerekmez: sistem renk gibi zorunlu özellikleri kendisi doldurmaya çalışır.</small>
            </label>
          </details>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={saveDraft} disabled={busy}>Kaydet</button>
            <button className="btn" onClick={() => setD(null)}>Vazgeç</button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Bekleyen kategoriler ({unmapped.length})</h2>
          {strong.length > 0 && <button className="btn primary" onClick={approveAll} disabled={busy}>Güçlü önerilerin hepsini onayla ({strong.length})</button>}
        </div>
        <p className="muted">
          Sistem, mağazandaki benzer isimli ürünlere bakarak kategori önerir. <span className="pill ok">güçlü</span> öneriyi onaylaman genelde yeterli.
          {" "}<span className="pill partial">zayıf</span> öneride ürünler farklı kategorilere dağılmış; onaylamadan önce kontrol et. Liste her önizleme veya senkronizasyondan sonra yenilenir.
        </p>
        {unmapped.length === 0 ? <p className="muted">Bekleyen kategori yok.</p> : (
          <div className="scroll"><table>
            <thead><tr><th>XML kategorisi</th><th className="n">Ürün</th><th>Önerilen {label} kategorisi</th><th /></tr></thead>
            <tbody>{unmapped.map((u) => {
              const s = Number(u.suggested_share);
              return (
                <tr key={u.xml_category}>
                  <td>{u.xml_category}</td>
                  <td className="n">{u.product_count}</td>
                  <td>{u.suggested_category_id ? <>
                    {u.suggested_category_name} <span className={`pill ${s >= STRONG ? "ok" : "partial"}`}>{s >= STRONG ? "güçlü" : "zayıf"}</span>
                    <div className="muted" style={{ fontSize: 12 }}>benzer ürünlerin %{Math.round(s * 100)}'i bu kategoride{u.suggested_commission ? ` · komisyon ${pct(u.suggested_commission)}` : ""}</div>
                  </> : <span className="muted">Öneri yok, elle eşleştir</span>}</td>
                  <td className="n"><div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                    {u.suggested_category_id && <button className="btn primary" onClick={() => approve(u)} disabled={busy}>Onayla</button>}
                    <button className="btn" onClick={() => edit(u.suggested_category_id ? fromSuggestion(u) : { xml_category: u.xml_category })}>{u.suggested_category_id ? "Değiştir" : "Eşleştir"}</button>
                  </div></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Eşleşmiş kategoriler ({mapped.length})</h2>
          <button className="btn" onClick={() => edit({ xml_category: "" })}>+ Elle ekle</button>
        </div>
        <input type="text" placeholder="Ara: kategori adı veya ID" value={q} onChange={(e) => setQ(e.target.value)} style={{ margin: "12px 0" }} />
        {mapped.length === 0 ? <p className="muted">Henüz eşleşme yok.</p> : (
          <div className="scroll"><table>
            <thead><tr><th>XML kategorisi</th><th>{label} kategorisi</th><th className="n">Komisyon</th><th /></tr></thead>
            <tbody>{shown.slice(0, 200).map((c) => (
              <tr key={c.xml_category}>
                <td>{c.xml_category}</td>
                <td>{c.category_name || <span className="muted">ad yok</span>} <span className="muted">#{c.category_id}</span></td>
                <td className="n">{c.commission_rate == null ? <span className="muted">otomatik</span> : pct(c.commission_rate)}</td>
                <td className="n"><div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                  <button className="btn" onClick={() => edit(c)}>Düzenle</button>
                  <button className="btn danger" onClick={() => remove(c)}>Sil</button>
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {shown.length > 200 && <p className="muted">İlk 200 gösteriliyor ({shown.length} sonuç). Aramayla daralt.</p>}
      </div>
    </>
  );
}
