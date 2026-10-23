"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Icon from "./Icon";
import { tl, when, type Api, type Notify, type Row } from "./shared";

// Satış raporu (Faz 6 F9): dönem seçimi, önceki eşit dönemle karşılaştırma, kâr dökümü (gelir -> komisyon -> kargo -> sabit gider ->
// maliyet -> KDV -> iade -> net), zaman grafiği, pazaryeri / ürün / iade tabloları, CSV. Veri: /api/sales-report (sales_report RPC).
const PERIODS: [string, string][] = [["today", "Bugün"], ["yesterday", "Dün"], ["7", "7 gün"], ["30", "30 gün"], ["month", "Bu ay"], ["lastmonth", "Geçen ay"], ["90", "3 ay"], ["365", "1 yıl"], ["custom", "Özel"]];
const MP: Record<string, string> = { trendyol: "Trendyol", hepsiburada: "Hepsiburada", amazon: "Amazon" };
const ST: Record<string, string> = { new: "Yeni", ready: "Hazırlanıyor", sent_to_supplier: "Tedarikçide", shipped: "Kargoda", delivered: "Teslim", cancelled: "İptal", returned: "İade", problem: "Sorunlu" };
const n = (v: unknown) => Number(v ?? 0) || 0;
const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);
const fmtPct = (v: number | null, d = 1) => (v == null ? "—" : `%${v.toLocaleString("tr-TR", { maximumFractionDigits: d, minimumFractionDigits: d })}`);
const tl0 = (v: number) => v.toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " TL";
const iso = (d: Date) => d.toISOString().slice(0, 10);

// Önceki döneme göre değişim (artış iyi mi kötü mü: iade/iptal için ters)
function Delta({ cur, prev, invert = false }: { cur: number; prev: number; invert?: boolean }) {
  if (!(prev > 0)) return <span className="muted">önceki dönem verisi yok</span>;
  const d = ((cur - prev) / Math.abs(prev)) * 100;
  if (Math.abs(d) < 0.5) return <span className="muted">önceki döneme göre aynı</span>;
  const good = invert ? d < 0 : d > 0;
  return <span style={{ color: good ? "var(--ok)" : "var(--bad)" }}>{d > 0 ? "▲" : "▼"} {fmtPct(Math.abs(d), 0)} <span className="muted">önceki döneme göre</span></span>;
}

function Kpi({ label, value, sub, delta, tone }: { label: string; value: string; sub?: React.ReactNode; delta?: React.ReactNode; tone?: string }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value" style={{ color: tone }}>{value}</div>
      {sub && <div className="hint">{sub}</div>}
      {delta && <div className="hint" style={{ marginTop: 2 }}>{delta}</div>}
    </div>
  );
}

// Ciro ve net kâr (aynı birim, tek eksen), gruplu çubuk; üzerine gelince değerler. Tablo görünümü aşağıda.
function Chart({ series, bucket }: { series: Row[]; bucket: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!series.length) return <div className="empty"><Icon name="activity" size={28} /><p>Bu dönemde satış yok.</p></div>;
  const W = 720, H = 220, L = 56, B = 26, T = 10;
  const max = Math.max(1, ...series.map((s) => n(s.gross)));
  const min = Math.min(0, ...series.map((s) => n(s.net)));
  const step = niceStep((max - min) / 4);
  const top = Math.ceil(max / step) * step, bot = Math.floor(min / step) * step;
  const y = (v: number) => T + (H - T - B) * (1 - (v - bot) / (top - bot || 1));
  const bw = (W - L) / series.length;
  const bar = Math.max(2, Math.min(18, bw / 2 - 3));
  const lab = (k: string) => { const d = new Date(k + "T00:00:00Z"); return bucket === "month" ? d.toLocaleDateString("tr-TR", { month: "short", year: "2-digit", timeZone: "UTC" }) : d.toLocaleDateString("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" }); };
  const every = Math.ceil(series.length / 8);
  const ticks: number[] = []; for (let v = bot; v <= top + 1e-9; v += step) ticks.push(v);
  const h = hover != null ? series[hover] : null;
  return (
    <div style={{ position: "relative" }}>
      <div className="row" style={{ gap: 14, fontSize: 12, marginBottom: 6 }} aria-hidden>
        <span className="row" style={{ gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--line-strong)" }} />Ciro</span>
        <span className="row" style={{ gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--accent)" }} />Net kâr</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Ciro ve net kâr grafiği" style={{ display: "block", overflow: "visible" }} onMouseLeave={() => setHover(null)}>
        {ticks.map((v) => <g key={v}><line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray={v === 0 ? undefined : "2 4"} /><text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}b` : v}</text></g>)}
        {series.map((s, i) => {
          const x = L + i * bw + bw / 2;
          const g = n(s.gross), nt = n(s.net);
          return (
            <g key={s.k} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
              <rect x={L + i * bw} y={T} width={bw} height={H - T - B} fill="transparent" />
              {hover === i && <rect x={L + i * bw + 1} y={T} width={bw - 2} height={H - T - B} fill="var(--panel-2)" />}
              <rect x={x - bar - 1} y={y(g)} width={bar} height={Math.max(0, y(0) - y(g))} rx={Math.min(4, bar / 2)} fill="var(--line-strong)" />
              <rect x={x + 1} y={nt >= 0 ? y(nt) : y(0)} width={bar} height={Math.abs(y(nt) - y(0))} rx={Math.min(4, bar / 2)} fill={nt >= 0 ? "var(--accent)" : "var(--bad)"} />
              {i % every === 0 && <text x={x} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">{lab(s.k)}</text>}
            </g>
          );
        })}
      </svg>
      {h && (
        <div style={{ position: "absolute", top: 24, left: `min(calc(${((L + hover! * bw + bw / 2) / W) * 100}% + 10px), calc(100% - 190px))`, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontSize: 12, boxShadow: "var(--shadow-lg)", pointerEvents: "none", minWidth: 170 }}>
          <b>{bucket === "day" ? lab(h.k) : bucket === "week" ? `${lab(h.k)} haftası` : lab(h.k)}</b>
          <div className="row" style={{ justifyContent: "space-between", gap: 10 }}><span>Ciro</span><b>{tl(n(h.gross))}</b></div>
          <div className="row" style={{ justifyContent: "space-between", gap: 10 }}><span>Net kâr</span><b style={{ color: n(h.net) < 0 ? "var(--bad)" : undefined }}>{tl(n(h.net))}</b></div>
          <div className="muted">{h.orders} sipariş{h.returned ? ` · ${h.returned} iade` : ""}{h.cancelled ? ` · ${h.cancelled} iptal` : ""}</div>
        </div>
      )}
    </div>
  );
}
function niceStep(raw: number) {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

export default function SalesReport({ api, notify, go }: { api: Api; notify: Notify; go?: (p: string) => void }) {
  const [period, setPeriod] = useState("30");
  const [mp, setMp] = useState("");
  const [custom, setCustom] = useState(() => { const t = new Date(); return { from: iso(new Date(t.getTime() - 29 * 86400000)), to: iso(t) }; });
  const [d, setD] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const qs = useMemo(() => new URLSearchParams({ period, mp, ...(period === "custom" ? custom : {}) }).toString(), [period, mp, custom]);
  const load = useCallback(() => { setBusy(true); return api(`/api/sales-report?${qs}`).then(setD).catch((e) => notify("err", e.message)).finally(() => setBusy(false)); }, [api, notify, qs]);
  useEffect(() => { load(); }, [load]);

  async function csv() {
    try {
      const r = await api(`/api/sales-report?${qs}&format=csv`);
      const url = URL.createObjectURL(new Blob([r.csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a"); a.href = url; a.download = r.filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      notify("good", `${r.rows} sipariş indirildi.`);
    } catch (e: any) { notify("err", e.message); }
  }

  const k = d?.kpi ?? {}, p = d?.prev ?? {};
  const salesProfit = n(k.net_sales) - n(k.commission) - n(k.shipping) - n(k.service) - n(k.cost) - n(k.vat_due);
  const margin = pct(n(k.net), n(k.net_sales) / 1.2);
  const avg = n(k.orders) ? n(k.gross) / n(k.orders) : 0, pavg = n(p.orders) ? n(p.gross) / n(p.orders) : 0;
  const retRate = pct(n(k.returned), n(k.orders)), cancelRate = pct(n(k.cancelled), n(k.orders) + n(k.cancelled));
  const rows: [string, number, string?][] = [
    ["Satış geliri (KDV dahil)", n(k.net_sales), "müşterinin ödediği + pazaryerinin karşıladığı indirim"],
    ["− Komisyon", -n(k.commission), n(k.settled) ? `${k.settled} siparişte pazaryerinin gerçek kesintisi` : "tahmini (ürün komisyon oranı)"],
    ["− Kargo", -n(k.shipping), "satıcının ödediği gönderim"],
    ["− Sabit gider", -n(k.service), "tedarikçi kargo / hizmet bedeli (ayarlar)"],
    ["− Ürün maliyeti", -n(k.cost), "sipariş anındaki tedarikçi fiyatı + KDV"],
    ["− Ödenecek KDV", -n(k.vat_due), "satış KDV'si − alış/komisyon/kargo KDV'si"],
  ];

  return (
    <>
      <div className="card">
        <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "space-between" }}>
          <div className="seg" role="group" aria-label="Dönem">{PERIODS.map(([key, l]) => <button key={key} aria-pressed={period === key} onClick={() => setPeriod(key)}>{l}</button>)}</div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <select value={mp} onChange={(e) => setMp(e.target.value)} aria-label="Pazaryeri"><option value="">Tüm pazaryerleri</option>{Object.entries(MP).map(([key, v]) => <option key={key} value={key}>{v}</option>)}</select>
            <button className="btn ghost" onClick={csv} title="Dönemin siparişleri ve kâr kalemleri (Excel'de açılır)"><Icon name="upload" size={16} />Excel (CSV)</button>
            <button className="btn ghost" onClick={load} disabled={busy}><Icon name="refresh" size={16} />{busy ? "..." : "Yenile"}</button>
          </div>
        </div>
        {period === "custom" && (
          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <label className="f">Başlangıç<input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></label>
            <label className="f">Bitiş<input type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></label>
          </div>
        )}
        {d && <p className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>{new Date(d.from).toLocaleDateString("tr-TR")} – {new Date(d.to).toLocaleDateString("tr-TR")} ({d.days} gün, Türkiye saati) · karşılaştırma: önceki {d.days} gün</p>}
      </div>

      {!d ? <p className="muted">Yükleniyor...</p> : (
        <>
          <div className="kpis">
            <Kpi label="Ciro" value={tl(n(k.gross))} sub={`${k.orders} sipariş · ${k.units} ürün`} delta={<Delta cur={n(k.gross)} prev={n(p.gross)} />} />
            <Kpi label="Net kâr" value={tl(n(k.net))} tone={n(k.net) < 0 ? "var(--bad)" : "var(--ok)"} sub={`kâr marjı ${fmtPct(margin)} (KDV hariç satışa)`} delta={<Delta cur={n(k.net)} prev={n(p.net)} />} />
            <Kpi label="Ortalama sepet" value={tl(avg)} sub={n(k.orders) ? `sipariş başı net ${tl(n(k.net) / Math.max(1, n(k.net_known)))}` : undefined} delta={<Delta cur={avg} prev={pavg} />} />
            <Kpi label="İade" value={`${k.returned} · ${tl0(n(k.returned_amount))}`} tone={n(k.returned) ? "var(--warn)" : undefined} sub={`iade oranı ${fmtPct(retRate)}${d.claims_open ? ` · ${d.claims_open} açık talep` : ""}`} delta={<Delta cur={n(k.returned)} prev={n(p.returned)} invert />} />
            <Kpi label="İptal" value={`${k.cancelled} · ${tl0(n(k.cancelled_amount))}`} sub={`iptal oranı ${fmtPct(cancelRate)}`} delta={<Delta cur={n(k.cancelled)} prev={n(p.cancelled)} invert />} />
            <Kpi label="Stopaj (%1)" value={tl(n(k.stopaj))} sub="pazaryeri keser; yıl sonu gelir vergisinden düşülür, kârdan düşülmez" />
          </div>

          <div className="card">
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <h3 style={{ margin: 0 }}>Ciro ve net kâr</h3>
              <button className="btn ghost" onClick={() => setShowTable(!showTable)} aria-pressed={showTable}><Icon name="list" size={16} />{showTable ? "Grafik" : "Tablo"}</button>
            </div>
            {showTable ? (
              <div style={{ overflowX: "auto", marginTop: 8 }}>
                <table className="cards">
                  <thead><tr><th>{d.bucket === "day" ? "Gün" : d.bucket === "week" ? "Hafta" : "Ay"}</th><th className="n">Sipariş</th><th className="n">Ciro</th><th className="n">Net kâr</th><th className="n">İade</th><th className="n">İptal</th></tr></thead>
                  <tbody>{d.series.map((s: Row) => <tr key={s.k}><td data-label="Dönem">{new Date(s.k).toLocaleDateString("tr-TR")}</td><td className="n" data-label="Sipariş">{s.orders}</td><td className="n" data-label="Ciro">{tl(n(s.gross))}</td><td className="n" data-label="Net kâr" style={{ color: n(s.net) < 0 ? "var(--bad)" : undefined }}>{tl(n(s.net))}</td><td className="n" data-label="İade">{s.returned}</td><td className="n" data-label="İptal">{s.cancelled}</td></tr>)}</tbody>
                </table>
              </div>
            ) : <div style={{ marginTop: 8 }}><Chart series={d.series} bucket={d.bucket} /></div>}
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Kâr dökümü</h3>
            <table>
              <tbody>
                {rows.map(([l, v, hint]) => (
                  <tr key={l}><td>{l}<div className="muted" style={{ fontSize: 12 }}>{hint}</div></td><td className="n" style={{ whiteSpace: "nowrap" }}>{tl(v)}</td><td className="n muted" style={{ width: 70 }}>{fmtPct(pct(Math.abs(v), n(k.net_sales)))}</td></tr>
                ))}
                <tr style={{ fontWeight: 600 }}><td>= Satış kârı</td><td className="n">{tl(salesProfit)}</td><td className="n muted">{fmtPct(pct(salesProfit, n(k.net_sales)))}</td></tr>
                <tr><td>− İade masrafları<div className="muted" style={{ fontSize: 12 }}>{k.returned} iade × gidiş-dönüş kargo ve paketleme (ayarlardaki iade maliyeti)</div></td><td className="n">{tl(-n(k.return_loss))}</td><td /></tr>
                <tr style={{ fontWeight: 700, fontSize: 16 }}><td>= Net kâr</td><td className="n" style={{ color: n(k.net) < 0 ? "var(--bad)" : "var(--ok)" }}>{tl(n(k.net))}</td><td className="n muted">{fmtPct(margin)}</td></tr>
              </tbody>
            </table>
            {n(k.unknown_cost) > 0 && <p style={{ fontSize: 13, color: "var(--warn)", margin: "8px 0 0" }}>⚠ {k.unknown_cost} siparişte ürün maliyeti bilinmiyor (tedarikçi XML'inde yok); kâra katılmadı. Siparişler sayfasında "dikkat" olarak listelenir.</p>}
            {n(k.settled) > 0 && (
              <p style={{ fontSize: 13, margin: "8px 0 0" }}>
                Gerçek komisyon ({k.settled} sipariş, pazaryeri hakediş kaydı): <b>{tl(n(k.commission_act))}</b> · tahminimiz {tl(n(k.commission_est))} ·{" "}
                <span style={{ color: Math.abs(n(k.commission_act) - n(k.commission_est)) > 1 ? "var(--warn)" : "var(--ok)" }}>fark {tl(n(k.commission_act) - n(k.commission_est))}</span>
              </p>
            )}
            <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>Tutarlar KDV dahil, cebinden çıkan para. İptal edilen siparişler ciroya katılmaz. Teslim edilmemiş siparişlerde kâr tahminidir; pazaryeri hakedişi geldikçe gerçek komisyonla güncellenir.</p>
          </div>

          {d.by_mp.length > 1 && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Pazaryerleri</h3>
              <table className="cards">
                <thead><tr><th>Pazaryeri</th><th className="n">Sipariş</th><th className="n">Ciro</th><th className="n">Net kâr</th><th className="n">İade</th><th className="n">Pay</th></tr></thead>
                <tbody>{d.by_mp.map((m: Row) => <tr key={m.marketplace}><td data-label="Pazaryeri">{MP[m.marketplace] ?? m.marketplace}</td><td className="n" data-label="Sipariş">{m.orders}</td><td className="n" data-label="Ciro">{tl(n(m.gross))}</td><td className="n" data-label="Net kâr">{tl(n(m.net))}</td><td className="n" data-label="İade">{m.returned}</td><td className="n" data-label="Pay">{fmtPct(pct(n(m.gross), n(k.gross)))}</td></tr>)}</tbody>
              </table>
            </div>
          )}

          <div className="card">
            <h3 style={{ marginTop: 0 }}>En çok satanlar</h3>
            {d.top_products.length === 0 ? <p className="muted">Satış yok.</p> : (
              <table className="cards">
                <thead><tr><th>Ürün</th><th className="n">Adet</th><th className="n">Ciro</th><th className="n">Brüt marj</th><th className="n">İade</th></tr></thead>
                <tbody>{d.top_products.map((t: Row, i: number) => <tr key={i}><td data-label="Ürün" style={{ overflowWrap: "anywhere" }}>{t.title || t.listing_key}</td><td className="n" data-label="Adet">{t.units}</td><td className="n" data-label="Ciro">{tl(n(t.gross))}</td><td className="n" data-label="Brüt marj" title="satış − ürün maliyeti (komisyon/kargo öncesi)">{t.margin != null ? tl(n(t.margin)) : "—"}</td><td className="n" data-label="İade">{t.returned || ""}</td></tr>)}</tbody>
              </table>
            )}
          </div>

          <div className="grid2" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
            <div className="card" style={{ marginBottom: 0 }}>
              <h3 style={{ marginTop: 0 }}>İade nedenleri</h3>
              {d.return_reasons.length === 0 ? <p className="muted" style={{ fontSize: 13 }}>Bu dönemde iade talebi yok.</p> : d.return_reasons.map((r: Row) => (
                <div key={r.reason} className="row" style={{ justifyContent: "space-between", borderTop: "1px solid var(--line)", padding: "6px 0", gap: 8 }}><span>{r.reason}</span><span className="muted">{r.n} · {tl0(n(r.amount))}</span></div>
              ))}
              {d.returned_products.length > 0 && <>
                <h4 style={{ margin: "12px 0 4px" }}>En çok iade edilen ürünler</h4>
                {d.returned_products.map((r: Row, i: number) => <div key={i} className="row" style={{ justifyContent: "space-between", borderTop: "1px solid var(--line)", padding: "6px 0", gap: 8, fontSize: 13 }}><span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{r.title || r.listing_key}</span><span className="muted">{r.returned}</span></div>)}
              </>}
            </div>
            <div className="card" style={{ marginBottom: 0 }}>
              <h3 style={{ marginTop: 0 }}>Zarar eden siparişler</h3>
              {d.losers.length === 0 ? <p className="muted" style={{ fontSize: 13 }}>Bu dönemde zarar eden sipariş yok.</p> : d.losers.map((o: Row) => (
                <button key={o.id} className="row" onClick={() => go?.("siparisler")} style={{ width: "100%", background: "none", border: 0, borderTop: "1px solid var(--line)", padding: "6px 0", color: "inherit", cursor: "pointer", justifyContent: "space-between", gap: 8, textAlign: "left" }}>
                  <span style={{ fontSize: 13 }}>{MP[o.marketplace] ?? o.marketplace} · {o.order_no} <span className="muted">· {ST[o.status] ?? o.status} · {when(o.ordered_at)}</span></span>
                  <b style={{ color: "var(--bad)", whiteSpace: "nowrap" }}>{tl(n(o.net))}</b>
                </button>
              ))}
              <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>İadeler (gidiş-dönüş kargo) ve indirimli satışlar burada görünür.</p>
            </div>
          </div>
        </>
      )}
    </>
  );
}
