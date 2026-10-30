"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon";
import Holds from "./Holds";
import { statusTr, when, type Api, type Notify, type Row } from "./shared";

const MP: Record<string, string> = { trendyol: "Trendyol", hepsiburada: "Hepsiburada", amazon: "Amazon TR" };
const MODE: Record<string, string> = { preview: "Önizleme", update: "Güncelleme", create: "Ürün açma", auto: "Otomatik" };
const ago = (s?: string) => {
  if (!s) return "-";
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  return m < 1 ? "az önce" : m < 60 ? `${m} dk önce` : m < 1440 ? `${Math.round(m / 60)} sa önce` : `${Math.round(m / 1440)} gün önce`;
};
const pill = (st?: string) => <span className={`pill ${st === "ok" ? "ok" : st === "error" ? "error" : st === "skipped" ? "" : "partial"}`}>{statusTr[st ?? ""] ?? st ?? "-"}</span>;
const n = (v: unknown) => (v == null ? "-" : Number(v).toLocaleString("tr-TR"));

// Fiyat değişikliği (net kâr 40-60 TL, K 22.10.2026): öncesi ve sonrası günlük ortalama karşılaştırılır
const PRICE_CHANGE = "2026-10-22";
const tl = (v: number) => v.toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " TL";
const csvCell = (v: unknown) => { const t = String(v ?? ""); return /^[=+\-@\t\r]/.test(t) ? "'" + t : /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

function SalesCard({ rows, api, notify }: { rows: Row[]; api: Api; notify: Notify }) {
  const ty = rows.filter((r) => r.marketplace === "trendyol");
  const avg = (list: Row[]) => {
    const days = Math.max(1, list.length);
    const sum = (k: string) => list.reduce((t, r) => t + Number(r[k] ?? 0), 0);
    const orders = sum("orders"), ret = sum("returns");
    return { days: list.length, orders: orders / days, revenue: sum("revenue") / days, returnRate: orders ? ret / orders : 0 };
  };
  // Değişiklik günü ölçüme girmez (yarım gün)
  const before = avg(ty.filter((r) => r.day < PRICE_CHANGE).slice(-14)), after = avg(ty.filter((r) => r.day > PRICE_CHANGE));
  async function campaign() {
    try {
      const list: Row[] = await api("/api/dashboard?campaign=1");
      if (!list.length) { notify("err","Uygun ürün yok (Trendyol'da satışta, alışı 150 TL altı, stoğu 20+)."); return; }
      const rowsCsv = [["Barkod", "Ürün", "Satış fiyatı", "Alış", "Stok"], ...list.map((r) => [r.barcode, r.title, r.price, r.cost, r.stock])];
      const blob = new Blob(["﻿" + rowsCsv.map((r) => r.map(csvCell).join(";")).join("\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "kampanya-adaylari.csv"; a.click(); URL.revokeObjectURL(a.href);
      notify("good", `${list.length} ürün indirildi. Trendyol satıcı paneli → Promosyonlar'da barkodlarla kampanya açabilirsin.`);
    } catch (e: any) { notify("err", e.message); }
  }
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}><h2 style={{ margin: 0 }}>Satışlar (Trendyol)</h2>
        <button className="btn ghost" onClick={campaign} title="Trendyol'da satışta, alışı 150 TL altı, stoğu 20+ ürünler: 3 al 2 öde / 2. ürüne indirim için">Kampanya adayları (CSV)</button></div>
      {!ty.length ? <p className="muted" style={{ fontSize: 13 }}>Henüz satış verisi yok: Trendyol senkronu saatte bir son 35 günü okur.</p> : <>
        <div className="kpis" style={{ marginTop: 10 }}>
          {[["Önce (günlük)", before], ["Sonra (günlük)", after]].map(([label, x]: any) => (
            <div key={label} className="kpi"><div className="label">{label} · {x.days} gün</div>
              <div className="value" style={{ fontSize: 20 }}>{x.orders.toFixed(1)} sipariş</div>
              <div className="hint">{tl(x.revenue)} ciro · iade %{(x.returnRate * 100).toFixed(1)}</div></div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12 }}>Fiyat değişikliği {PRICE_CHANGE.split("-").reverse().join(".")} (net kâr 40-60 TL). "Önce" son 14 gün; değişiklik günü sayılmaz. İade %5'i geçerse en az net kârı yükselt.</p>
        <table className="cards" style={{ marginTop: 6 }}><thead><tr><th>Gün</th><th>Sipariş</th><th>Adet</th><th>Ciro</th><th>İptal</th><th>İade</th></tr></thead>
          <tbody>{ty.slice(-10).reverse().map((r) => <tr key={r.day} style={r.day === PRICE_CHANGE ? { fontWeight: 600 } : undefined}>
            <td>{r.day.split("-").reverse().join(".")}</td><td>{r.orders}</td><td>{r.units}</td><td>{tl(Number(r.revenue))}</td><td>{r.cancelled}</td><td>{r.returns ?? "-"}</td></tr>)}</tbody></table>
      </>}
    </div>
  );
}

export default function Dashboard({ api, notify, role, go }: { api: Api; notify: Notify; role: string; go: (p: string) => void }) {
  const [d, setD] = useState<Row | null>(null);
  const load = useCallback(() => api("/api/dashboard").then(setD).catch((e) => notify("err", e.message)), [api, notify]);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  const isAdmin = role === "admin";
  const hour = new Date().getHours();
  const hello = hour < 6 ? "İyi geceler" : hour < 12 ? "Günaydın" : hour < 18 ? "İyi günler" : "İyi akşamlar";

  if (!d) return (
    <>
      <div className="page-head"><div><h1>{hello}</h1><div className="sub">Yükleniyor...</div></div></div>
      <div className="kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="kpi"><div className="skeleton" style={{ width: "50%" }} /><div className="skeleton" style={{ width: "70%", height: 24, marginTop: 10 }} /></div>)}</div>
    </>
  );
  const ty = d.markets?.find((m: Row) => m.id === "trendyol");
  const stockPct = d.products.variants ? Math.round((d.products.inStockVariants / d.products.variants) * 100) : 0;

  return (
    <>
      <div className="page-head">
        <div><h1>{hello}</h1><div className="sub">Mağazalarının ve ürünlerinin genel durumu</div></div>
        <button className="btn" onClick={load}><Icon name="refresh" size={16} />Yenile</button>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="label"><Icon name="box" size={14} />Ürün veritabanı</div>
          <div className="value">{n(d.products.total)}</div>
          <div className="hint">{n(d.products.active)} aktif · {n(d.products.variants)} varyant</div>
        </div>
        <div className="kpi">
          <div className="label"><Icon name="layers" size={14} />Stokta</div>
          <div className="value">%{stockPct}</div>
          <div className="bar" style={{ marginTop: 6 }}><span style={{ width: `${stockPct}%` }} /></div>
          <div className="hint">{n(d.products.inStockVariants)} varyantın stoğu var</div>
        </div>
        {isAdmin && ty && <div className="kpi" style={{ cursor: "pointer" }} onClick={() => go("pazaryeri/trendyol/ozet")}>
          <div className="label"><Icon name="store" size={14} />Trendyol ilanları</div>
          <div className="value">{n(ty.listings)}</div>
          <div className="hint">{d.listings?.live ? `${n(d.listings.live)} yayında · ${n(d.listings.pending)} onay bekliyor · ${n(d.listings.closed)} kapalı` : `${n(ty.matched)} XML ile eşleşik`} · son {ago(ty.last?.started_at)}</div>
        </div>}
        {isAdmin && <div className="kpi" style={{ cursor: "pointer" }} onClick={() => go("tedarikciler")}>
          <div className="label"><Icon name="truck" size={14} />Tedarikçiler</div>
          <div className="value">{n(d.suppliers?.filter((s: Row) => s.active).length)}</div>
          <div className="hint">{d.suppliers?.filter((s: Row) => s.nightly).length ?? 0} gece güncelleniyor</div>
        </div>}
        {isAdmin && d.settings && <div className="kpi" style={{ cursor: "pointer" }} onClick={() => go("pazaryeri/trendyol/ozet")}>
          <div className="label"><Icon name="activity" size={14} />Otomatik senkron</div>
          <div className="value" style={{ color: d.settings.auto_sync ? "var(--ok)" : "var(--warn)", fontSize: 20, marginTop: 8 }}>{d.settings.auto_sync ? "Açık" : "Duraklatıldı"}</div>
          <div className="hint">15 dakikada bir · {d.pricingRules ? `${d.pricingRules} kâr kuralı` : "kâr kuralı yok"}</div>
        </div>}
      </div>

      <div className="split">
        <div>
          <div className="card">
            <h2>Uyarılar ve öneriler</h2>
            <div className="alert-list">
              {d.alerts.map((a: Row, i: number) => (
                <div key={i} className={`alert ${a.level}`}>
                  <span className="ico"><Icon name={a.level === "ok" ? "check" : a.level === "info" ? "info" : "alert"} /></span>
                  <span style={{ flex: 1 }}>{a.text}</span>
                  {a.go && <button className="btn ghost" style={{ minHeight: 28, padding: "2px 8px" }} onClick={() => go(a.go)}>Git <Icon name="chevron" size={14} /></button>}
                </div>
              ))}
            </div>
          </div>

          {isAdmin && <Holds api={api} notify={notify} />}

          {isAdmin && <SalesCard rows={d.sales ?? []} api={api} notify={notify} />}

          {isAdmin && d.timeline?.length > 0 && <div className="card">
            <div className="row" style={{ justifyContent: "space-between" }}><h2 style={{ margin: 0 }}>Son senkronlar</h2><button className="btn ghost" onClick={() => go("pazaryeri/trendyol/ozet")}>Tümü <Icon name="chevron" size={14} /></button></div>
            <div className="timeline" style={{ marginTop: 8 }}>
              {d.timeline.map((r: Row) => (
                <div key={r.id} className="item">
                  <span style={{ width: 92, flex: "none" }} className="muted">{ago(r.started_at)}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>{MP[r.marketplace] ?? r.marketplace} · {MODE[r.mode] ?? r.mode}
                    <span className="muted" style={{ fontSize: 13 }}>{r.skippedRun ? ` — ${r.skippedRun}` : r.updated != null ? ` — ${n(r.updated)} güncellendi${r.created ? `, ${n(r.created)} açıldı` : ""}` : ""}</span>
                  </span>
                  {pill(r.status)}
                </div>
              ))}
            </div>
          </div>}
        </div>

        <div>
          {isAdmin && <div className="card">
            <h2>Pazaryerleri</h2>
            {d.markets?.map((m: Row) => (
              <button key={m.id} className="nav-item" style={{ padding: "10px 6px", borderBottom: "1px solid var(--line)", borderRadius: 0 }} onClick={() => go(`pazaryeri/${m.id}/ozet`)}>
                <Icon name="store" />
                <span style={{ flex: 1 }}>{MP[m.id] ?? m.id}<br /><span className="muted" style={{ fontSize: 12 }}>{m.skippedRun ? m.skippedRun : m.last ? `${MODE[m.last.mode] ?? m.last.mode} · ${ago(m.last.started_at)}` : "henüz çalışmadı"}</span></span>
                {m.last ? pill(m.last.status) : <span className="pill">-</span>}
              </button>
            ))}
          </div>}

          <div className="card">
            <div className="row" style={{ justifyContent: "space-between" }}><h2 style={{ margin: 0 }}>Son içe aktarmalar</h2>{role !== "viewer" && <button className="btn ghost" onClick={() => go("ice-aktar")}>Tümü <Icon name="chevron" size={14} /></button>}</div>
            {d.imports.length === 0 ? <div className="empty"><Icon name="upload" size={28} /><div>Henüz içe aktarma yok</div></div> : (
              <div className="timeline" style={{ marginTop: 8 }}>
                {d.imports.map((j: Row) => (
                  <div key={j.id} className="item">
                    <span style={{ flex: 1, minWidth: 0 }}>{j.kind === "xml" ? `XML: ${j.supplier ?? String(j.source).replace(/^xml:/, "")}` : j.source || "Dosya"}<br />
                      <span className="muted" style={{ fontSize: 12 }}>{when(j.started_at)} · +{n(j.created)} yeni, {n(j.updated)} güncel, {n(j.stock_only)} stok{j.failed ? `, ${n(j.failed)} hata` : ""}</span>
                    </span>
                    {pill(j.status)}
                  </div>
                ))}
              </div>
            )}
          </div>

          {isAdmin && <div className="card">
            <h2>Hızlı işlemler</h2>
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <button className="btn" onClick={() => go("urunler")}><Icon name="box" size={16} />Ürün ekle</button>
              <button className="btn" onClick={() => go("ice-aktar")}><Icon name="upload" size={16} />Dosya yükle</button>
              <button className="btn" onClick={() => go("tedarikciler")}><Icon name="truck" size={16} />Tedarikçi</button>
              <button className="btn" onClick={() => go("pazaryeri/trendyol/kar")}><Icon name="percent" size={16} />Akıllı kâr</button>
            </div>
          </div>}
        </div>
      </div>
    </>
  );
}
