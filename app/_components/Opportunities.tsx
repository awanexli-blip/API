"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon";
import { tl, when, type Props, type Row } from "./shared";

const PART: Record<string, string> = { kar: "Kâr", marj: "Marj", stok: "Stok", satis: "Satış hızı", fiyat: "Fiyat bandı", icerik: "Görsel/açıklama", kategori: "Kategori tahmini", marka: "Marka", varyant: "Varyant" };

// Ürün seçimi (fırsat listesi): tedarikçi ürünleri pazaryeri için puanlanır (worker/opportunity.ts, her gün 07:15). Hiçbir şey kendiliğinden
// gönderilmez: seçilip onaylanan ürünler gönderim kuyruğuna girer (pazaryeri ürün sınırı kontrol edilir).
export default function Opportunities({ api, notify, marketplace }: Props) {
  const [d, setD] = useState<Row | null>(null);
  const [f, setF] = useState({ source: "royal", q: "", brand: "", min_net: "", min_stock: "", own: false, page: 0 });
  const [qText, setQText] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [top, setTop] = useState("500");
  const [busy, setBusy] = useState(false);
  const qs = new URLSearchParams({ mp: marketplace, source: f.source, q: f.q, brand: f.brand, min_net: f.min_net, min_stock: f.min_stock, own: f.own ? "1" : "", page: String(f.page) }).toString();
  const load = useCallback(() => api(`/api/opportunity?${qs}`).then(setD).catch((e) => notify("err", e.message)), [api, notify, qs]);
  useEffect(() => { load(); }, [load]);
  const set = (x: Partial<typeof f>) => { setF((o) => ({ ...o, page: 0, ...x })); setSel(new Set()); };

  async function send(body: Row, n: number) {
    if (!confirm(`${n.toLocaleString("tr-TR")} ürün ${marketplace === "trendyol" ? "Trendyol" : marketplace}'a gönderim sırasına alınacak (senkron başına ~2.500). Onaylıyor musun?`)) return;
    setBusy(true);
    try { const r = await api(`/api/opportunity?mp=${marketplace}`, { method: "POST", body: JSON.stringify(body) }); notify("good", `${r.products.toLocaleString("tr-TR")} ürün sıraya alındı (${r.jobs} iş).`); setSel(new Set()); load(); }
    catch (e: any) { notify("err", e.message); } finally { setBusy(false); }
  }

  if (!d) return <p className="muted">Yükleniyor...</p>;
  const s = d.summary ?? {}, cap = d.capacity ?? {};
  const pages = Math.ceil(Number(d.total ?? 0) / 50);
  const items: Row[] = d.items ?? [];
  return (
    <>
      <div className="card">
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Tedarikçi ürünleri bu pazaryeri için puanlanır: net kâr (fiyat kuralların ve tahmini kategori komisyonuyla), stok, <b>satış hızı</b> (tedarikçinin stoğu düştükçe diğer bayilerde satıldığı anlaşılır; veri her saat birikir, birkaç günde anlamlı olur),
          fiyat bandı, görsel/açıklama, kategori tahmini ve marka. Mağazada zaten olan, stoğu 10'dan az, marka riski taşıyan ürünler elenir. Hiçbir şey kendiliğinden gönderilmez. Son puanlama: {when(s.last)}.
        </p>
        <div className="kpis" style={{ marginBottom: 0 }}>
          <div className="kpi"><div className="label">Aday</div><div className="value">{Number(s.candidates ?? 0).toLocaleString("tr-TR")}</div><div className="hint">{Number(s.total ?? 0).toLocaleString("tr-TR")} ürün puanlandı</div></div>
          <div className="kpi"><div className="label">Elenen</div><div className="value">{Number(s.excluded ?? 0).toLocaleString("tr-TR")}</div><div className="hint">{Object.entries(s.reasons ?? {}).sort((a: any, b: any) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div></div>
          {cap.limit && <div className="kpi"><div className="label">Ürün sınırı</div><div className="value" style={{ color: cap.free < 1000 ? "var(--warn)" : undefined }}>{Number(cap.free).toLocaleString("tr-TR")}</div><div className="hint">boş yer ({Number(cap.used).toLocaleString("tr-TR")} / {Number(cap.limit).toLocaleString("tr-TR")} kullanılıyor)</div></div>}
          <div className="kpi"><div className="label">Gönderilen</div><div className="value">{Number(s.sent ?? 0).toLocaleString("tr-TR")}</div><div className="hint">bu listeden pazaryerinde</div></div>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); set({ q: qText.trim() }); }}>
            <input type="search" placeholder="Ürün / kategori ara" value={qText} onChange={(e) => setQText(e.target.value)} />
            <button className="btn ghost" type="submit"><Icon name="search" size={16} />Ara</button>
          </form>
          <select value={f.brand} onChange={(e) => set({ brand: e.target.value })} aria-label="Marka"><option value="">Tüm markalar</option>{(d.brands ?? []).map((b: Row) => <option key={b.brand} value={b.brand}>{b.brand} ({b.n}){b.ok ? "" : " ⚠"}</option>)}</select>
          <label className="f" style={{ width: 110 }}>En az net (TL)<input inputMode="decimal" value={f.min_net} onChange={(e) => set({ min_net: e.target.value.replace(/[^0-9.]/g, "") })} /></label>
          <label className="f" style={{ width: 110 }}>En az stok<input inputMode="numeric" value={f.min_stock} onChange={(e) => set({ min_stock: e.target.value.replace(/\D/g, "") })} /></label>
          <label className="check"><input type="checkbox" checked={f.own} onChange={(e) => set({ own: e.target.checked })} />Yalnızca tedarikçinin kendi markası</label>
          <button className="btn ghost" onClick={load}><Icon name="refresh" size={16} />Yenile</button>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button className="btn primary" disabled={busy || !sel.size} onClick={() => send({ product_ids: [...sel] }, sel.size)}>Seçilen {sel.size} ürünü gönder</button>
          <span className="muted" style={{ fontSize: 13 }}>ya da bu filtreyle en yüksek puanlı</span>
          <input style={{ width: 90 }} inputMode="numeric" value={top} onChange={(e) => setTop(e.target.value.replace(/\D/g, ""))} aria-label="Adet" />
          <button className="btn" disabled={busy || !(Number(top) > 0) || !d.total} onClick={() => send({ top: Math.min(Number(top), Number(d.total)), filters: f }, Math.min(Number(top), Number(d.total)))}>ürünü gönder</button>
          <span className="muted" style={{ fontSize: 13 }}>{Number(d.total).toLocaleString("tr-TR")} aday bu filtrede</span>
        </div>

        {!items.length ? <div className="empty"><Icon name="box" size={28} /><p>{s.total ? "Bu filtrede aday yok." : "Henüz puanlama yapılmadı (her gün 07:15 ya da ilk çalıştırma birkaç dakika içinde)."}</p></div> : (
          <table className="cards" style={{ marginTop: 10 }}>
            <thead><tr><th><input type="checkbox" aria-label="Sayfadakileri seç" checked={items.every((i) => sel.has(i.product_id))} onChange={(e) => { const n = new Set(sel); for (const i of items) e.target.checked ? n.add(i.product_id) : n.delete(i.product_id); setSel(n); }} /></th><th>Ürün</th><th className="n">Puan</th><th className="n">Satış fiyatı</th><th className="n">Net kâr</th><th className="n">Stok</th><th className="n">7 gün satış</th></tr></thead>
            <tbody>{items.map((it) => (
              <tr key={it.product_id}>
                <td data-label=""><input type="checkbox" checked={sel.has(it.product_id)} onChange={(e) => { const n = new Set(sel); e.target.checked ? n.add(it.product_id) : n.delete(it.product_id); setSel(n); }} /></td>
                <td data-label="Ürün" style={{ overflowWrap: "anywhere" }}>
                  <div className="row" style={{ gap: 8, flexWrap: "nowrap", alignItems: "flex-start" }}>
                    {it.image ? <img src={it.image} alt="" width={44} height={44} style={{ objectFit: "cover", borderRadius: 6, flex: "none" }} /> : null}
                    <span>{it.title}<div className="muted" style={{ fontSize: 12 }}>{it.brand}{it.brand_ok ? "" : " ⚠ marka yetkisi gerekebilir"} · {it.category_name ?? "kategori tahmini yok"}{it.confidence != null ? ` (%${Math.round(Number(it.confidence) * 100)})` : ""}{it.variants > 1 ? ` · ${it.variants} varyant` : ""}</div></span>
                  </div>
                </td>
                <td className="n" data-label="Puan" title={Object.entries(it.reasons ?? {}).map(([k, v]) => `${PART[k] ?? k}: ${v}`).join("\n")}><b>{Number(it.score).toFixed(0)}</b></td>
                <td className="n" data-label="Satış fiyatı">{tl(Number(it.price))}</td>
                <td className="n" data-label="Net kâr">{tl(Number(it.net))}<div className="muted" style={{ fontSize: 12 }}>%{(Number(it.margin) * 100).toFixed(0)} · kom. %{(Number(it.commission) * 100).toFixed(1)}</div></td>
                <td className="n" data-label="Stok">{Number(it.stock).toLocaleString("tr-TR")}</td>
                <td className="n" data-label="7 gün satış">{it.sold7 || "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {pages > 1 && (
          <div className="row" style={{ justifyContent: "center", gap: 8, marginTop: 10 }}>
            <button className="btn ghost" disabled={f.page === 0} onClick={() => setF({ ...f, page: f.page - 1 })}>Önceki</button>
            <span className="muted" style={{ fontSize: 13 }}>{f.page + 1} / {pages}</span>
            <button className="btn ghost" disabled={f.page + 1 >= pages} onClick={() => setF({ ...f, page: f.page + 1 })}>Sonraki</button>
          </div>
        )}
      </div>
    </>
  );
}
