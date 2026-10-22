"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon";
import { tl, when, type Api, type Notify, type Row } from "./shared";

const ST: Record<string, [string, string]> = {
  new: ["Yeni", "info"], ready: ["Hazırlanıyor", "info"], sent_to_supplier: ["Tedarikçiye iletildi", "info"], shipped: ["Kargoda", "ok"],
  delivered: ["Teslim edildi", "ok"], cancelled: ["İptal", ""], returned: ["İade", "partial"], problem: ["Sorunlu", "error"],
};
const MP: Record<string, string> = { trendyol: "Trendyol", hepsiburada: "Hepsiburada", amazon: "Amazon" };
const EV: Record<string, string> = { created: "Sipariş geldi", status: "Durum değişti", tracking: "Takip numarası geldi", note: "Not" };

// Siparişler (Faz 6 F3, salt okunur): pazaryerlerinden 15 dakikada bir çekilir. Müşteri adı/adresi şimdilik saklanmıyor.
export default function Orders({ api, notify }: { api: Api; notify: Notify }) {
  const [d, setD] = useState<Row | null>(null);
  const [f, setF] = useState({ mp: "", status: "", attention: false, days: 30, q: "", page: 0 });
  const [qText, setQText] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [det, setDet] = useState<Row | null>(null);
  const load = useCallback(() => {
    const p = new URLSearchParams({ mp: f.mp, status: f.status, attention: f.attention ? "1" : "", days: String(f.days), q: f.q, page: String(f.page) });
    return api(`/api/orders?${p}`).then(setD).catch((e) => notify("err", e.message));
  }, [api, notify, f]);
  useEffect(() => { load(); }, [load]);
  const set = (x: Partial<typeof f>) => setF((o) => ({ ...o, page: 0, ...x }));
  async function show(id: string) {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setDet(null);
    try { setDet(await api(`/api/orders?id=${id}`)); } catch (e: any) { notify("err", e.message); setOpen(null); }
  }

  if (!d) return <p className="muted">Yükleniyor...</p>;
  const s = d.summary;
  const pages = Math.ceil(d.total / 50);
  return (
    <>
      <div className="card">
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Pazaryerlerinden 15 dakikada bir çekilir (salt okunur, pazaryerine bir şey yazılmaz). <b>Tahmini net kâr</b> sipariş anındaki maliyet, komisyon (+KDV), kargo ve KDV farkıyla fiyat motorunun formülüyle hesaplanır; iade payı dahil değildir.
          Müşteri adı ve adresi şimdilik saklanmıyor (tedarikçiye iletme adımında açılacak).
        </p>
        <div className="kpis" style={{ marginBottom: 0 }}>
          <div className="kpi"><div className="label">Sipariş ({f.days} gün)</div><div className="value">{s.orders}</div><div className="hint">iptal/iade hariç</div></div>
          <div className="kpi"><div className="label">Ciro</div><div className="value">{tl(s.revenue)}</div></div>
          <div className="kpi"><div className="label">Tahmini net kâr</div><div className="value" style={{ color: s.net < 0 ? "var(--bad)" : undefined }}>{tl(s.net)}</div><div className="hint">{s.netKnown} siparişte maliyet biliniyor</div></div>
          <button className="kpi" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => set({ attention: !f.attention })} aria-pressed={f.attention}>
            <div className="label">Dikkat gerektiren</div><div className="value" style={{ color: s.attention ? "var(--warn)" : undefined }}>{s.attention}</div><div className="hint">{f.attention ? "filtre açık" : "listele"}</div>
          </button>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "space-between" }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <select value={f.mp} onChange={(e) => set({ mp: e.target.value })} aria-label="Pazaryeri"><option value="">Tüm pazaryerleri</option>{Object.entries(MP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select value={f.status} onChange={(e) => set({ status: e.target.value })} aria-label="Durum"><option value="">Tüm durumlar</option>{Object.entries(ST).map(([k, [v]]) => <option key={k} value={k}>{v}{s.byStatus[k] ? ` (${s.byStatus[k]})` : ""}</option>)}</select>
            <select value={f.days} onChange={(e) => set({ days: Number(e.target.value) })} aria-label="Dönem">{[1, 7, 14, 30, 90].map((n) => <option key={n} value={n}>Son {n} gün</option>)}</select>
            <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); set({ q: qText.trim() }); }}>
              <input type="search" placeholder="Sipariş / takip no" value={qText} onChange={(e) => setQText(e.target.value)} />
              <button className="btn ghost" type="submit"><Icon name="search" size={16} />Ara</button>
            </form>
          </div>
          <button className="btn ghost" onClick={load}><Icon name="refresh" size={16} />Yenile</button>
        </div>

        {d.items.length === 0 ? <div className="empty"><Icon name="box" size={28} /><p>Bu filtrede sipariş yok. Siparişler ilk senkrondan sonra gelir.</p></div> : d.items.map((o: Row) => {
          const [label, tone] = ST[o.status] ?? [o.status, ""];
          const late = o.ship_deadline && !["shipped", "delivered", "cancelled", "returned"].includes(o.status) && Date.parse(o.ship_deadline) < Date.now() + 24 * 3600 * 1000;
          return (
            <div key={o.id} style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}>
              <button className="row" onClick={() => show(o.id)} style={{ width: "100%", background: "none", border: 0, padding: 0, color: "inherit", textAlign: "left", cursor: "pointer", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }} aria-expanded={open === o.id}>
                <div style={{ minWidth: 0 }}>
                  <b>{MP[o.marketplace] ?? o.marketplace} · {o.order_no || "—"}</b> <span className={`pill ${tone}`}>{label}</span>
                  {o.needs_attention && <span className="pill partial" style={{ marginLeft: 4 }}>dikkat</span>}
                  {late && <span className="pill error" style={{ marginLeft: 4 }}>kargo süresi yaklaşıyor</span>}
                  <div className="muted" style={{ fontSize: 12 }}>{when(o.ordered_at)}{o.city ? ` · ${o.city}` : ""}{o.marketplace_status ? ` · ${o.marketplace_status}` : ""}{o.tracking_no ? ` · ${o.cargo_provider ?? "kargo"} ${o.tracking_no}` : ""}</div>
                  {o.attention_reason && <div style={{ fontSize: 12, color: "var(--warn)" }}>{o.attention_reason}</div>}
                </div>
                <div style={{ textAlign: "right" }}>
                  <b>{tl(Number(o.total ?? 0))}</b>
                  <div className="muted" style={{ fontSize: 12 }}>{o.est_net != null ? <>net ~<span style={{ color: o.est_net < 0 ? "var(--bad)" : undefined }}>{tl(Number(o.est_net))}</span></> : "kâr hesaplanamadı"}</div>
                </div>
              </button>
              {open === o.id && (
                <div className="card" style={{ marginTop: 8, marginBottom: 0, background: "var(--panel-2)" }}>
                  {!det ? <p className="muted">Yükleniyor...</p> : (
                    <>
                      {det.lines.map((l: Row) => (
                        <div key={l.line_no} className="row" style={{ justifyContent: "space-between", fontSize: 13, padding: "4px 0", flexWrap: "wrap", gap: 6 }}>
                          <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{l.qty} × {l.title} <span className="muted">({l.listing_key})</span></span>
                          <span className="muted">{tl(Number(l.unit_price ?? 0))}{l.cost_snapshot != null ? ` · maliyet ${tl(Number(l.cost_snapshot))}` : " · maliyet yok"}{l.commission_rate != null ? ` · komisyon %${(Number(l.commission_rate) * 100).toFixed(1)}` : ""}</span>
                        </div>
                      ))}
                      {o.ship_deadline && <p style={{ fontSize: 13, margin: "8px 0 0" }}>Kargoya son teslim: <b>{when(o.ship_deadline)}</b></p>}
                      <h4 style={{ margin: "12px 0 4px" }}>Zaman çizelgesi</h4>
                      {det.events.map((e: Row, i: number) => (
                        <div key={i} style={{ fontSize: 13 }} className="muted">{when(e.at)} · {EV[e.kind] ?? e.kind}{e.detail?.to ? `: ${e.detail.from ?? "—"} → ${e.detail.to}` : ""}{e.detail?.cargo ? ` (${e.detail.cargo})` : ""}</div>
                      ))}
                      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>Tedarikçiye iletme ve takip numarası girme sonraki adımda eklenecek (Faz 6 F4-F5).</p>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
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
