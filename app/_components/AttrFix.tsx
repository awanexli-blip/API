"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Icon from "./Icon";
import { type Props, type Row } from "./shared";

const lo = (s: string) => s.toLocaleLowerCase("tr");
// Başlıkta geçen değer (kelime sınırıyla, en uzunu): "44 mm", "Kadın", "Plastik"...
function guess(title: string, values: string[]) {
  const t = " " + lo(title).replace(/[^0-9a-zçğıöşü,.]+/g, " ") + " ";
  return values.filter((v) => v.length >= 2 && t.includes(" " + lo(v).replace(/[^0-9a-zçğıöşü,.]+/g, " ").trim() + " ")).sort((a, b) => b.length - a.length)[0] ?? null;
}

// Toplu özellik tamamlama: eksik zorunlu özelliği aynı olan ürünler gruplanır, değer seçilir, seçili ürünlere yazılır;
// eksiği kalmayan ürün hemen yeniden gönderim sırasına girer. Yazılan değer ürün kaydında kalır (diğer pazaryerleri de kullanır).
export default function AttrFix({ api, notify, marketplace }: Props) {
  const [d, setD] = useState<Row | null>(null);
  const [g, setG] = useState<Row | null>(null);   // seçili grup
  const [det, setDet] = useState<Row | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [value, setValue] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api(`/api/attr-fix?mp=${marketplace}`).then(setD).catch((e) => notify("err", e.message)), [api, notify, marketplace]);
  useEffect(() => { load(); }, [load]);

  async function open(x: Row) {
    setG(x); setDet(null); setValue(""); setQ("");
    try {
      const r = await api(`/api/attr-fix?mp=${marketplace}&cat=${encodeURIComponent(x.category_id)}&name=${encodeURIComponent(x.name)}`);
      setDet(r); setSel(new Set(r.items.map((i: Row) => i.product_id)));
    } catch (e: any) { notify("err", e.message); setG(null); }
  }
  const sugg = useMemo(() => {
    const m = new Map<string, string>();
    if (det) for (const it of det.items) { const v = guess(it.title, det.values ?? []); if (v) m.set(it.product_id, v); }
    return m;
  }, [det]);

  async function apply(groups: [string, string[]][]) {
    setBusy(true);
    try {
      let upd = 0, rq = 0;
      for (const [val, ids] of groups) {
        const r = await api(`/api/attr-fix?mp=${marketplace}`, { method: "POST", body: JSON.stringify({ name: g!.name, value: val, product_ids: ids }) });
        upd += r.updated ?? 0; rq += r.requeued ?? 0;
      }
      notify("good", `${upd} ürüne yazıldı; ${rq} ürünün eksiği kalmadı, gönderim sırasına alındı.`);
      await open(g!); load();
    } catch (e: any) { notify("err", e.message); } finally { setBusy(false); }
  }

  if (!d) return <p className="muted">Yükleniyor...</p>;
  const groups: Row[] = d.groups ?? [];
  const vals: string[] = det?.values ?? [];
  const shown = vals.filter((v) => !q || lo(v).includes(lo(q))).slice(0, 60);
  const bySugg = new Map<string, string[]>();
  for (const [pid, v] of sugg) bySugg.set(v, [...(bySugg.get(v) ?? []), pid]);

  return (
    <>
      <div className="card">
        <h2>Özellik tamamla</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Pazaryerinin zorunlu tuttuğu ama sistemin bulamadığı özellikler. Bir gruba tıkla, değeri seç, <b>Uygula</b>: seçili ürünlere yazılır, eksiği kalmayan ürün hemen yeniden gönderilir.
          Değer ürün kaydında kalır; diğer pazaryerleri de kullanır. Toplam {Number(d.total).toLocaleString("tr-TR")} eksik özellik, {groups.length} grup.
        </p>
      </div>

      {g && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <b>{g.name}</b> <span className="muted">· {det?.categoryName || g.category_name || `kategori ${g.category_id}`} · {det ? det.items.length : g.n} ürün</span>
            </div>
            <button className="btn ghost" onClick={() => setG(null)}>Gruplara dön</button>
          </div>
          {!det ? <p className="muted">Yükleniyor...</p> : (
            <>
              {bySugg.size > 0 && (
                <div style={{ margin: "10px 0", padding: 10, borderRadius: 8, background: "var(--panel-2)" }}>
                  <div style={{ fontSize: 13 }}>Başlıktan bulunan değerler ({sugg.size} ürün): {[...bySugg].map(([v, ids]) => `${v} (${ids.length})`).join(", ")}</div>
                  <button className="btn primary" style={{ marginTop: 6 }} disabled={busy} onClick={() => apply([...bySugg])}>Önerilenleri uygula</button>
                </div>
              )}
              <div style={{ marginTop: 10 }}>
                {vals.length > 12 && <input type="search" placeholder="Değer ara" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 6 }} />}
                <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                  {shown.map((v) => <button key={v} className="btn ghost" aria-pressed={value === v} style={{ padding: "4px 10px", fontSize: 13 }} onClick={() => setValue(v)}>{v}</button>)}
                  {vals.length > shown.length && <span className="muted" style={{ fontSize: 12 }}>+{vals.length - shown.length} değer daha (ara)</span>}
                </div>
                {(det.custom || !vals.length) && (
                  <label className="f" style={{ marginTop: 8 }}>{vals.length ? "ya da kendin yaz" : "Değer (pazaryeri serbest metin kabul ediyor)"}
                    <input value={vals.includes(value) ? "" : value} onChange={(e) => setValue(e.target.value)} maxLength={100} placeholder="ör. 44 mm" />
                  </label>
                )}
                {!vals.length && !det.custom && <p className="muted" style={{ fontSize: 12 }}>Değer listesi henüz alınmadı (bir sonraki gönderimde kaydedilir); pazaryerindeki adıyla yaz.</p>}
              </div>
              <div className="row" style={{ gap: 8, margin: "10px 0", flexWrap: "wrap" }}>
                <button className="btn primary" disabled={busy || !value.trim() || !sel.size} onClick={() => apply([[value.trim(), [...sel]]])}>{busy ? "..." : `Seçili ${sel.size} ürüne "${value || "…"}" uygula`}</button>
                <button className="btn ghost" onClick={() => setSel(new Set(det.items.map((i: Row) => i.product_id)))}>Tümünü seç</button>
                <button className="btn ghost" onClick={() => setSel(new Set())}>Seçimi kaldır</button>
              </div>
              {det.items.map((it: Row) => (
                <label key={it.product_id} className="row" style={{ borderTop: "1px solid var(--line)", padding: "6px 0", gap: 8, flexWrap: "nowrap", alignItems: "center", cursor: "pointer" }}>
                  <input type="checkbox" checked={sel.has(it.product_id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(it.product_id); else n.delete(it.product_id); setSel(n); }} />
                  {it.image ? <img src={it.image} alt="" width={40} height={40} style={{ objectFit: "cover", borderRadius: 6, flex: "none" }} /> : null}
                  <span style={{ minWidth: 0, flex: 1, fontSize: 13, overflowWrap: "anywhere" }}>{it.title}
                    {(it.missing ?? []).length > 1 && <span className="muted"> · eksik: {(it.missing as string[]).join(", ")}</span>}
                    {sugg.get(it.product_id) && <span className="pill info" style={{ marginLeft: 6 }}>{sugg.get(it.product_id)}</span>}
                  </span>
                </label>
              ))}
            </>
          )}
        </div>
      )}

      {!g && (
        <div className="card">
          <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn ghost" onClick={load}><Icon name="refresh" size={16} />Yenile</button></div>
          {groups.length === 0 ? <div className="empty"><Icon name="check" size={28} /><p>Eksik özellik yok.</p></div> : groups.map((x) => (
            <button key={x.category_id + x.name} onClick={() => open(x)} className="row" style={{ width: "100%", background: "none", border: 0, borderTop: "1px solid var(--line)", padding: "10px 0", color: "inherit", textAlign: "left", cursor: "pointer", justifyContent: "space-between", gap: 8, flexWrap: "nowrap" }}>
              <span style={{ minWidth: 0 }}>
                <b>{x.name}</b> <span className="muted">· {x.category_name || `kategori ${x.category_id}`}</span>
                <div className="muted" style={{ fontSize: 12, overflowWrap: "anywhere" }}>ör. {x.sample}</div>
              </span>
              <span className="pill partial" style={{ flex: "none" }}>{x.n} ürün</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
