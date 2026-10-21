"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon";
import { when, type Props, type Row } from "./shared";

const FILTERS: [string, string][] = [["ozellik", "Eksik özellik"], ["kategori", "Kategori yok"], ["diger", "Diğer"], ["", "Tümü"]];

// Pazaryerine gönderilemeyen ürünler: eksik zorunlu özellik / kategori elle girilir, "Kaydet ve gönder" ürünü yeniden sıraya alıp senkronu başlatır
export default function Unsent({ api, notify, marketplace }: Props) {
  const [d, setD] = useState<Row | null>(null);
  const [filter, setFilter] = useState("ozellik");
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<Row>({});
  const [busy, setBusy] = useState("");
  const load = useCallback(() => api(`/api/unsent?mp=${marketplace}&reason=${filter}`).then(setD).catch((e) => notify("err", e.message)), [api, notify, marketplace, filter]);
  useEffect(() => { load(); }, [load]);

  const edit = (it: Row) => {
    if (open === it.listing_key) return setOpen(null);
    const attrs: Row = {};
    for (const m of it.missing) attrs[m] = String(it.attributes?.[m] ?? "");
    setForm({ attrs, category_id: String(it.attributes?.["Trendyol kategori"] ?? it.suggestion?.id ?? "") });
    setOpen(it.listing_key);
  };
  async function send(it: Row) {
    const empty = Object.entries(form.attrs ?? {}).filter(([, v]) => !String(v).trim()).map(([k]) => k);
    if (empty.length) { notify("err", `Boş alan var: ${empty.join(", ")}`); return; }
    if (it.needsCategory && !form.category_id) { notify("err", "Kategori seç"); return; }
    setBusy(it.listing_key);
    try {
      const r = await api(`/api/unsent?mp=${marketplace}`, { method: "PUT", body: JSON.stringify({ product_id: it.product_id, attributes: form.attrs, category_id: form.category_id || undefined, now: true }) });
      notify("good", r.started ? "Kaydedildi ve gönderim başlatıldı; birkaç dakika içinde pazaryerine gider." : "Kaydedildi; bir sonraki senkronda (en geç 15 dk) gönderilecek.");
      setOpen(null); load();
    } catch (e: any) { notify("err", e.message); } finally { setBusy(""); }
  }

  if (!d) return <p className="muted">Yükleniyor...</p>;
  const c = d.counts ?? {};
  return (
    <>
      <div className="card">
        <h2>Gönderilemeyen ürünler</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Sistemin otomatik gönderemediği ürünler. Pazaryerinin istediği zorunlu bilgiyi (ör. Tip, Güç, Kapasite) ya da kategoriyi gir, <b>Kaydet ve gönder</b>'e bas: ürün hemen yeniden gönderilir.
          Girdiğin bilgi ürüne kaydedilir; tedarikçi güncellemelerinde silinmez. Değeri pazaryerinin listesindeki adıyla yazarsan (ör. "Plastik", "220 V") onay şansı artar.
        </p>
        <div className="kpis" style={{ marginBottom: 0 }}>
          <div className="kpi"><div className="label">Eksik özellik</div><div className="value" style={{ color: c.ozellik ? "var(--warn)" : undefined }}>{c.ozellik ?? 0}</div></div>
          <div className="kpi"><div className="label">Kategori yok</div><div className="value">{c.kategori ?? 0}</div></div>
          <div className="kpi"><div className="label">Diğer nedenler</div><div className="value">{c.diger ?? 0}</div><div className="hint">marka riski, kopya, görsel...</div></div>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="seg">{FILTERS.map(([k, label]) => <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>)}</div>
          <button className="btn ghost" onClick={load}><Icon name="refresh" size={16} />Yenile</button>
        </div>
        {d.items.length === 0 ? <div className="empty"><Icon name="check" size={28} /><p>Bu grupta gönderilemeyen ürün yok.</p></div> : d.items.map((it: Row) => (
          <div key={it.listing_key} style={{ borderTop: "1px solid var(--line)", padding: "12px 0" }}>
            <div className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
              {it.image ? <img src={it.image} alt="" width={56} height={56} style={{ objectFit: "cover", borderRadius: 8, flex: "none" }} /> : null}
              <div style={{ minWidth: 0, flex: 1 }}>
                <b>{it.title}</b>
                <div className="muted" style={{ fontSize: 12 }}>{it.listing_key} · {it.category || "kategorisiz"} · {when(it.updated_at)}</div>
                <div style={{ fontSize: 13, color: "var(--bad)", marginTop: 4 }}>{String(it.error).slice(0, 300)}</div>
              </div>
              {(it.missing.length > 0 || it.needsCategory) && <button className="btn primary" style={{ flex: "none" }} onClick={() => edit(it)}>{open === it.listing_key ? "Kapat" : "Tamamla"}</button>}
            </div>
            {open === it.listing_key && (
              <div className="card" style={{ marginTop: 10, marginBottom: 0, background: "var(--panel-2)" }}>
                {it.needsCategory && (
                  <label className="f">Trendyol kategorisi
                    <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                      <option value="">— seç —</option>
                      {it.suggestion && !d.categories.some((x: Row) => String(x.category_id) === it.suggestion.id) && <option value={it.suggestion.id}>Öneri: {it.suggestion.name}</option>}
                      {d.categories.map((x: Row) => <option key={x.category_id} value={x.category_id}>{x.category_name || x.category_id} ({x.n} ürün)</option>)}
                    </select>
                    <small>{it.suggestion ? <>Sistemin tahmini: <b>{it.suggestion.name}</b> (önceden seçildi; doğruysa doğrudan gönder)</> : "Mağazanda kullanılan kategoriler"}</small>
                  </label>
                )}
                <div className="grid" style={{ marginTop: it.needsCategory ? 10 : 0 }}>
                  {Object.keys(form.attrs ?? {}).map((k) => (
                    <label key={k} className="f">{k}<input type="text" value={form.attrs[k]} onChange={(e) => setForm({ ...form, attrs: { ...form.attrs, [k]: e.target.value } })} /></label>
                  ))}
                </div>
                <div className="row" style={{ marginTop: 12 }}>
                  <button className="btn primary" disabled={busy === it.listing_key} onClick={() => send(it)}>{busy === it.listing_key ? "Gönderiliyor..." : "Kaydet ve gönder"}</button>
                </div>
              </div>
            )}
          </div>
        ))}
        {d.total > d.items.length && <p className="muted" style={{ fontSize: 13 }}>İlk {d.items.length} ürün gösteriliyor (toplam {d.total}). Tamamladıkça liste yenilenir.</p>}
      </div>
    </>
  );
}
