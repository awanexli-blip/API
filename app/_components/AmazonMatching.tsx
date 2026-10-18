"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon";
import { type Props, type Row } from "./shared";

// Amazon toplu eşleştirme: aday bul (kuyruk) -> adayları onayla -> onaylananları gönder
export default function AmazonMatching({ api, notify }: Props) {
  const [d, setD] = useState<Row | null>(null);
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(100);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api(`/api/matches/queue?mp=amazon&page=${page}`).then(setD).catch((e) => notify("err", e.message)), [api, notify, page]);
  useEffect(() => { load(); }, [load]);

  async function queue(now: boolean) {
    setBusy(true);
    try {
      const r = await api("/api/matches/queue", { method: "POST", body: JSON.stringify({ mp: "amazon", limit, now }) });
      notify("good", `${r.products} ürün için Amazon'da aday aranacak. ${r.started ? "Arama başlatıldı; birkaç dakika sonra 'Yenile'ye bas." : "Bir sonraki Amazon senkronunda aranacak."}`);
      load();
    } catch (e: any) { notify("err", e.message); } finally { setBusy(false); }
  }
  async function decide(id: number, status: "confirmed" | "rejected") {
    try { await api("/api/matches", { method: "PUT", body: JSON.stringify({ id, status }) }); load(); } catch (e: any) { notify("err", e.message); }
  }
  async function rejectAll(variant: Row) {
    try { for (const c of variant.candidates) await api("/api/matches", { method: "PUT", body: JSON.stringify({ id: c.id, status: "rejected" }) }); load(); } catch (e: any) { notify("err", e.message); }
  }
  async function sendConfirmed() {
    if (!confirm("Onaylı eşleşmesi olan ürünler Amazon'a teklif olarak gönderilsin mi? (Var olan Amazon ürününe, yeni durumda, akıllı kâr fiyatıyla)")) return;
    setBusy(true);
    try {
      const r = await api("/api/matches/queue", { method: "POST", body: JSON.stringify({ mp: "amazon", send: true, now: true }) });
      notify("good", `${r.products} ürün Amazon'a gönderilmek üzere sıraya alındı${r.started ? ", senkron başlatıldı" : ""}.${r.problems?.length ? ` Atlananlar: ${r.problems.slice(0, 3).join("; ")}` : ""}`);
      load();
    } catch (e: any) { notify("err", e.message); } finally { setBusy(false); }
  }

  const s = d?.stats ?? {};
  return (
    <>
      <div className="card">
        <h2>Amazon eşleştirme</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Amazon'da yeni ürün açmak için gerçek barkod (GTIN) veya muafiyet gerekir. O zamana kadar ürünlerin Amazon'da zaten satılan <b>birebir aynısına</b> teklif verilir.
          1) Aday bul: sistem Amazon kataloğunda barkod veya başlıkla arar (Amazon'a hiçbir şey yazmaz). 2) Doğru ürünü onayla. 3) Onaylananları gönder.
          Farklı bir ürüne teklif hesabına uyarı getirebilir; emin olmadığını "Hiçbiri" ile geç.
        </p>
        <div className="kpis" style={{ marginBottom: 0 }}>
          <div className="kpi"><div className="label">Onaylı eşleşme</div><div className="value">{s.confirmed ?? 0}</div></div>
          <div className="kpi"><div className="label">Onay bekleyen</div><div className="value">{s.suggested ?? 0}</div></div>
          <div className="kpi"><div className="label">Amazon'da ilan</div><div className="value">{s.listed ?? 0}</div><div className="hint">gönderilen / onay / yayında</div></div>
          <div className="kpi"><div className="label">Aramada</div><div className="value">{s.queued_jobs ?? 0}</div><div className="hint">kuyruktaki arama işi</div></div>
        </div>
      </div>

      <div className="card">
        <h2>1. Aday bul</h2>
        <div className="row">
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} style={{ maxWidth: 220 }}>
            {[25, 50, 100, 200, 300].map((n) => <option key={n} value={n}>{n} stoklu ürün</option>)}
          </select>
          <button className="btn primary" disabled={busy} onClick={() => queue(true)}><Icon name="search" size={16} />Şimdi ara</button>
          <button className="btn" disabled={busy} onClick={() => queue(false)}>Sıraya al</button>
          <button className="btn ghost" onClick={load}><Icon name="refresh" size={16} />Yenile</button>
        </div>
        <small className="muted">Daha önce aranmamış, aktif ve stoklu ürünlerden seçilir. Amazon katalog araması saniyede birkaç istekle sınırlı; 100 ürün birkaç dakika sürer.</small>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>2. Adayları onayla</h2>
          <button className="btn primary" disabled={busy || !s.confirmed} onClick={sendConfirmed}><Icon name="store" size={16} />3. Onaylananları Amazon'a gönder</button>
        </div>
        {!d ? <p className="muted">Yükleniyor...</p> : !d.items.length ? (
          <div className="empty"><Icon name="search" size={30} /><p>Onay bekleyen aday yok. "Aday bul" ile başla.</p></div>
        ) : d.items.map((v: Row) => (
          <div key={v.variant_id} style={{ borderTop: "1px solid var(--line)", padding: "12px 0" }}>
            <div className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
              {v.image ? <img src={v.image} alt="" width={64} height={64} style={{ objectFit: "cover", borderRadius: 8, flex: "none" }} /> : null}
              <div style={{ minWidth: 0 }}>
                <b>{v.title}</b>
                <div className="muted" style={{ fontSize: 12 }}>Bizim ürün · {v.sku}{v.barcode ? ` · barkod ${v.barcode}` : ""}{Object.keys(v.attributes).length ? ` · ${Object.entries(v.attributes).map(([k, x]) => `${k}: ${x}`).join(", ")}` : ""}</div>
              </div>
            </div>
            <div className="grid" style={{ marginTop: 8 }}>
              {v.candidates.map((c: Row) => (
                <div key={c.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, display: "flex", gap: 10 }}>
                  {c.image ? <img src={c.image} alt="" width={64} height={64} style={{ objectFit: "contain", borderRadius: 6, background: "#fff", flex: "none" }} /> : <div style={{ width: 64, height: 64, borderRadius: 6, background: "var(--panel-2)", flex: "none" }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{c.title || c.asin}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{c.asin}{c.brand ? ` · ${c.brand}` : ""} · <a href={`https://www.amazon.com.tr/dp/${c.asin}`} target="_blank" rel="noreferrer">Amazon'da gör</a></div>
                    <div className="row" style={{ marginTop: 6 }}>
                      <button className="btn primary" style={{ minHeight: 30, padding: "2px 10px" }} onClick={() => decide(c.id, "confirmed")}>Bu ürün</button>
                      <button className="btn" style={{ minHeight: 30, padding: "2px 10px" }} onClick={() => decide(c.id, "rejected")}>Değil</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button className="btn ghost" style={{ marginTop: 6 }} onClick={() => rejectAll(v)}>Hiçbiri değil (geç)</button>
          </div>
        ))}
        {d && (page > 0 || d.more) && <div className="row" style={{ justifyContent: "center", marginTop: 8 }}>
          <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>Önceki</button>
          <button className="btn" disabled={!d.more} onClick={() => setPage(page + 1)}>Sonraki</button>
        </div>}
      </div>
    </>
  );
}
