"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon";
import { tl, when, type Props, type Row } from "./shared";

const ST: Record<string, string> = { queued: "Sırada", sent: "Gönderildi (inceleniyor)", live: "Yayında", error: "Gönderilemedi", rejected: "Reddedildi", closed: "Kapalı", gone: "Mağazadan kalktı", pending_approval: "Onay bekliyor" };
const GR: Record<string, string> = { kategori: "Kategori eşleşmedi", ozellik: "Zorunlu özellik eksik", gorsel: "Görsel sorunu", marka: "Marka riski", kopya: "Kopya ürün", pazaryeri: "Pazaryeri reddi", diger: "Diğer" };
const ORDER = ["live", "sent", "queued", "error", "rejected", "closed", "gone", "pending_approval"];
const tone = (s: string) => (s === "live" ? "ok" : s === "error" || s === "rejected" ? "partial" : "info");

// Pazaryerine gönderilen her ilanın durumu: yayında / incelemede / hatalı / reddedilen, neden grupları ve toplu yeniden gönderim
export default function ListingStatus({ api, notify, marketplace }: Props) {
  const [d, setD] = useState<Row | null>(null);
  const [f, setF] = useState({ status: "error", group: "", mpst: "", q: "", page: 0 });
  const [qText, setQText] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    const p = new URLSearchParams({ mp: marketplace, status: f.status, group: f.group, mpst: f.mpst, q: f.q, page: String(f.page) });
    return api(`/api/listing-status?${p}`).then((x) => { setD(x); setSel(new Set()); }).catch((e) => notify("err", e.message));
  }, [api, notify, marketplace, f]);
  useEffect(() => { load(); }, [load]);
  const set = (x: Partial<typeof f>) => setF((o) => ({ ...o, page: 0, ...x }));

  async function requeue(body: Row, label: string) {
    if (!confirm(`${label} yeniden gönderim sırasına alınsın mı? Sistem bir sonraki senkronda (en geç 15 dk) gönderir.`)) return;
    setBusy(true);
    try {
      const r = await api(`/api/listing-status?mp=${marketplace}`, { method: "POST", body: JSON.stringify(body) });
      notify("good", `${r.queued} ilan sıraya alındı (${r.jobs} iş).`);
      load();
    } catch (e: any) { notify("err", e.message); } finally { setBusy(false); }
  }

  if (!d) return <p className="muted">Yükleniyor...</p>;
  const s = d.summary ?? {}, st: Row = s.status ?? {}, groups: Row = s.groups ?? {}, mps: Row = s.mp_status ?? {};
  const canRetry = f.status === "error" || f.status === "rejected";
  const pages = Math.ceil(d.total / 50);

  return (
    <>
      <div className="card">
        <h2>Gönderim durumu</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Pazaryerine giden her ürünün son durumu. <b>Gönderildi</b>: pazaryeri inceliyor (Hepsiburada'da saatler sürebilir, sonuç her senkronda yeniden sorulur).
          <b> Gönderilemedi</b>: sistem göndermedi (kategori/özellik/görsel). <b>Reddedildi</b>: pazaryeri kabul etmedi; neden aşağıda.
        </p>
        <div className="kpis" style={{ marginBottom: 0 }}>
          {ORDER.filter((k) => st[k]).map((k) => (
            <button key={k} className="kpi" style={{ textAlign: "left", cursor: "pointer", outline: f.status === k ? "2px solid var(--accent)" : undefined }} onClick={() => set({ status: k, group: "", mpst: "" })}>
              <div className="label">{ST[k] ?? k}</div><div className="value">{Number(st[k]).toLocaleString("tr-TR")}</div>
            </button>
          ))}
        </div>
        {Object.keys(mps).length > 0 && (
          <div style={{ marginTop: 12, fontSize: 13 }}>
            <span className="muted">Pazaryerinin inceleme durumu: </span>
            {Object.entries(mps).sort((a: any, b: any) => b[1] - a[1]).map(([k, n]) => (
              <button key={k} className="btn ghost" style={{ padding: "2px 8px", fontSize: 13 }} aria-pressed={f.mpst === k} onClick={() => set({ status: "", group: "", mpst: f.mpst === k ? "" : k })}>{k}: {String(n)}</button>
            ))}
          </div>
        )}
      </div>

      {(f.status === "error" || f.status === "rejected") && Object.keys(groups).length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Neden grupları</h3>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <button className="btn ghost" aria-pressed={!f.group} onClick={() => set({ group: "" })}>Tümü</button>
            {Object.entries(groups).sort((a: any, b: any) => b[1] - a[1]).map(([k, n]) => <button key={k} className="btn ghost" aria-pressed={f.group === k} onClick={() => set({ group: k })}>{GR[k] ?? k} ({String(n)})</button>)}
          </div>
          {f.group === "ozellik" && (s.attrs ?? []).length > 0 && (
            <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>En çok eksik kalan özellikler: {(s.attrs as Row[]).map((a) => `${a.name} (${a.n})`).join(", ")}. Ürünü açıp değeri girersen kaydedilir ve diğer pazaryerlerinde de kullanılır.</p>
          )}
          {f.group === "kategori" && <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Bu ürünlerin XML kategorisi için pazaryeri kategorisi bulunamadı: Kategoriler sekmesinden eşleştir, sonra yeniden gönder.</p>}
        </div>
      )}

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <select value={f.status} onChange={(e) => set({ status: e.target.value, group: "" })}>
              <option value="">Tüm durumlar</option>
              {ORDER.map((k) => <option key={k} value={k}>{ST[k]}</option>)}
            </select>
            <form onSubmit={(e) => { e.preventDefault(); set({ q: qText.trim() }); }} className="row" style={{ gap: 6 }}>
              <input type="search" placeholder="Başlık veya stok kodu" value={qText} onChange={(e) => setQText(e.target.value)} />
              <button className="btn ghost" type="submit"><Icon name="search" size={16} />Ara</button>
            </form>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {canRetry && sel.size > 0 && <button className="btn primary" disabled={busy} onClick={() => requeue({ keys: [...sel] }, `Seçilen ${sel.size} ilan`)}>Seçilenleri yeniden gönder</button>}
            {canRetry && d.total > 0 && <button className="btn" disabled={busy} onClick={() => requeue({ status: f.status, group: f.group }, `Bu listedeki ${Math.min(d.total, 5000)} ilan`)}>Listenin tamamını yeniden gönder</button>}
            <button className="btn ghost" onClick={load}><Icon name="refresh" size={16} />Yenile</button>
          </div>
        </div>

        {d.items.length === 0 ? <div className="empty"><Icon name="check" size={28} /><p>Bu filtrede ilan yok.</p></div> : d.items.map((it: Row) => (
          <div key={it.listing_key} className="row" style={{ borderTop: "1px solid var(--line)", padding: "10px 0", alignItems: "flex-start", flexWrap: "nowrap", gap: 10 }}>
            {canRetry && <input type="checkbox" aria-label="Seç" checked={sel.has(it.listing_key)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(it.listing_key); else n.delete(it.listing_key); setSel(n); }} style={{ marginTop: 4 }} />}
            {it.image ? <img src={it.image} alt="" width={48} height={48} style={{ objectFit: "cover", borderRadius: 8, flex: "none" }} /> : <div style={{ width: 48, height: 48, borderRadius: 8, background: "var(--panel-2)", flex: "none" }} title="Görsel yok" />}
            <div style={{ minWidth: 0, flex: 1 }}>
              <b style={{ overflowWrap: "anywhere" }}>{it.title ?? it.listing_key}</b>
              <div className="muted" style={{ fontSize: 12 }}>
                {it.listing_key} · <span className={`pill ${tone(it.status)}`}>{ST[it.status] ?? it.status}</span>
                {it.mp_status ? <> · pazaryeri: <b>{it.mp_status}</b></> : null}
                {it.price != null ? <> · {tl(Number(it.price))}</> : null}{it.calc_net != null ? <> · net {tl(Number(it.calc_net))}</> : null} · {when(it.updated_at)}
              </div>
              {(it.last_error || it.mp_reasons) && <div style={{ fontSize: 13, color: it.status === "live" ? undefined : "var(--bad)", marginTop: 4, overflowWrap: "anywhere" }}>{it.err_group ? <b>{GR[it.err_group]}: </b> : null}{String(it.last_error ?? it.mp_reasons).slice(0, 300)}</div>}
            </div>
          </div>
        ))}
        {pages > 1 && (
          <div className="row" style={{ justifyContent: "center", gap: 8, marginTop: 10 }}>
            <button className="btn ghost" disabled={f.page === 0} onClick={() => setF({ ...f, page: f.page - 1 })}>Önceki</button>
            <span className="muted" style={{ fontSize: 13 }}>{f.page + 1} / {pages} · {d.total.toLocaleString("tr-TR")} ilan</span>
            <button className="btn ghost" disabled={f.page + 1 >= pages} onClick={() => setF({ ...f, page: f.page + 1 })}>Sonraki</button>
          </div>
        )}
      </div>
    </>
  );
}
