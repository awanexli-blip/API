"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Api } from "./shared";

// Ürün formu: pazaryeri kategorisi + kategorinin özellikleri (Trendyol ve Hepsiburada; /api/mp-catalog, lib/mp-catalog.ts).
// Kategori ve değerler ürün özelliklerine yazılır: "Trendyol kategori" / "Trendyol kategori adı", "Hepsiburada kategori" / "... adı",
// özellik adıyla değer ("Cinsiyet": "Erkek"); diğer pazaryerinin listesinde olmayan değer için "Cinsiyet@hepsiburada" (worker db-products productAttrs).
// Varyant özellikleri (Beden/Numara, Renk) varyant satırlarından gelir (worker attr-infer defaultFor eş anlamlıları).

type MpAttr = { id: string; name: string; required: boolean; variant: boolean; slicer: boolean; custom: boolean; values: string[] };
type Cat = { id: string; name: string; path: string };
const MPS = [{ id: "trendyol", label: "Trendyol" }, { id: "hepsiburada", label: "Hepsiburada" }] as const;
type MpId = (typeof MPS)[number]["id"];

const lo = (s: string) => s.replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr");
const key = (s: string) => lo(s).replace(/[^0-9a-zçğıöşü]+/g, " ").trim();
const sq = (s: string) => lo(s).replace(/[\s,]+/g, "").replace(/numara$/, "");
// worker/core/attr-infer.ts ATTR_GROUPS ile aynı
export const attrGroup = (name: string) => (/beden|numara|size|ölçü|olcu/.test(lo(name)) ? "beden" : /renk|colou?r/.test(lo(name)) ? "renk" : null);
const inList = (vals: string[], v: string) => vals.some((x) => lo(x) === lo(v) || sq(x) === sq(v));
const NEUTRAL = ["belirtilmemiş", "standart", "tek ebat", "diğer"];

export type MpStatus = { missing: Record<MpId, string[]>; ready: Record<MpId, boolean>; loading: boolean };

export default function MarketplaceFields({ api, title, attrs, setAttr, variantGroups, variantValues, hasVariants, onStatus }: {
  api: Api; title: string; attrs: Record<string, string>; setAttr: (k: string, v: string | null) => void;
  variantGroups: Set<string>; variantValues: Record<string, string[]>; hasVariants: boolean; onStatus: (s: MpStatus) => void;
}) {
  const [lists, setLists] = useState<Record<string, MpAttr[] | null>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [waiting, setWaiting] = useState<Record<string, number>>({}); // pazaryeri -> bekleme başlangıcı (GitHub'dan getiriliyor)
  const [showOpt, setShowOpt] = useState(false);
  const retry = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const waitStart = useRef<Record<string, number>>({});
  useEffect(() => () => { for (const t of Object.values(retry.current)) clearTimeout(t); }, []);
  const cats: Record<MpId, Cat | null> = Object.fromEntries(MPS.map((m) => {
    const id = attrs[`${m.label} kategori`];
    return [m.id, id ? { id, name: (attrs[`${m.label} kategori adı`] ?? "").split(" > ").pop() ?? "", path: attrs[`${m.label} kategori adı`] ?? id } : null];
  })) as any;

  // Kategori seçilince özellikleri yükle
  // Hepsiburada özellikleri panelde yoksa GitHub'daki katalog iş akışı getirir (~1-2 dk): 8 sn'de bir tekrar sorulur, en çok 5 dk
  const loadAttrs = async (mp: MpId, cid: string, refresh = false) => {
    clearTimeout(retry.current[mp]);
    setLoading((l) => ({ ...l, [mp]: true })); setErrs((e) => ({ ...e, [mp]: "" }));
    try {
      const r = await api(`/api/mp-catalog?mp=${mp}&cat=${encodeURIComponent(cid)}${refresh ? "&refresh=1" : ""}`);
      if (r.pending) {
        const since = (waitStart.current[mp] ??= Date.now());
        if (Date.now() - since > 5 * 60 * 1000) throw new Error("Hepsiburada özellikleri 5 dakikada gelmedi (GitHub iş akışı gecikmiş olabilir). Biraz sonra \"Tekrar dene\".");
        if (r.started === false && r.error) throw new Error(`Hepsiburada özellikleri istenemedi: ${r.error}`);
        setWaiting((w) => ({ ...w, [mp]: since }));
        retry.current[mp] = setTimeout(() => loadAttrs(mp, cid), 8000);
        return;
      }
      delete waitStart.current[mp];
      setWaiting((w) => { const y = { ...w }; delete y[mp]; return y; });
      setLists((x) => ({ ...x, [mp]: r.attrs }));
    }
    catch (e: any) { delete waitStart.current[mp]; setWaiting((w) => { const y = { ...w }; delete y[mp]; return y; }); setLists((x) => ({ ...x, [mp]: null })); setErrs((x) => ({ ...x, [mp]: e.message })); }
    finally { setLoading((l) => ({ ...l, [mp]: false })); }
  };
  useEffect(() => { for (const m of MPS) { const c = cats[m.id]; if (c && lists[m.id] === undefined && !loading[m.id] && !waiting[m.id]) loadAttrs(m.id, c.id); } }); // eslint-disable-line react-hooks/exhaustive-deps

  // Birleşik özellik satırları (aynı ad iki pazaryerinde tek satır)
  const rows = useMemo(() => {
    const m = new Map<string, { name: string; ty?: MpAttr; hb?: MpAttr }>();
    for (const [mp, list] of [["ty", lists.trendyol], ["hb", lists.hepsiburada]] as const) for (const a of list ?? []) {
      const k = key(a.name);
      const r = m.get(k) ?? { name: a.name };
      (r as any)[mp] = a;
      m.set(k, r);
    }
    return [...m.values()].map((r) => {
      const fromVariant = hasVariants && ((r.ty && (r.ty.variant || r.ty.slicer)) || r.hb?.variant || (attrGroup(r.name) && variantGroups.has(attrGroup(r.name)!)));
      return { ...r, required: !!(r.ty?.required || r.hb?.required), fromVariant: !!fromVariant };
    }).sort((a, b) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name, "tr"));
  }, [lists, hasVariants, variantGroups]);

  // Eksik zorunlular (pazaryeri bazında)
  const status = useMemo<MpStatus>(() => {
    const missing = { trendyol: [] as string[], hepsiburada: [] as string[] };
    for (const m of MPS) {
      if (!cats[m.id]) { missing[m.id].push("kategori"); continue; }
      for (const r of rows) {
        const a = m.id === "trendyol" ? r.ty : r.hb;
        if (!a?.required) continue;
        // Varyanttan gelen (Beden/Numara, Renk): varyant satırlarında o grup girilmiş ve değerler pazaryerinin listesinde olmalı
        if (r.fromVariant) {
          const g = attrGroup(r.name);
          if (!g || !variantGroups.has(g)) { missing[m.id].push(`${r.name} (varyant satırlarında)`); continue; }
          const bad = a.values.length && !a.custom ? (variantValues[g] ?? []).filter((x) => !inList(a.values, x)) : [];
          if (bad.length) missing[m.id].push(`${r.name}: ${bad.slice(0, 5).join(", ")} ${m.label} listesinde yok`);
          continue;
        }
        const v = attrs[`${r.name}@${m.id}`] ?? attrs[r.name] ?? attrs[a.name];
        if (!v || (a.values.length && !a.custom && !inList(a.values, v))) missing[m.id].push(r.name);
      }
    }
    // Özellik listesi henüz gelmediyse (yükleniyor / GitHub'dan bekleniyor) hazır sayılmaz
    for (const m of MPS) if (cats[m.id] && !lists[m.id]) missing[m.id].push(errs[m.id] ? "özellik listesi alınamadı" : "özellik listesi bekleniyor");
    return { missing, ready: { trendyol: !missing.trendyol.length, hepsiburada: !missing.hepsiburada.length }, loading: Object.values(loading).some(Boolean) || Object.keys(waiting).length > 0 };
  }, [rows, attrs, cats.trendyol?.id, cats.hepsiburada?.id, hasVariants, variantGroups, variantValues, loading, waiting, lists, errs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onStatus(status); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Boş zorunluları doldur: başlıkta geçen değer > nötr değer (Belirtilmemiş, Standart...)
  function autoFill() {
    const t = " " + key(title) + " ";
    let n = 0;
    for (const r of rows) {
      if (!r.required || r.fromVariant || attrs[r.name]) continue;
      const vals = r.ty?.values.length ? r.ty.values : r.hb?.values ?? [];
      const hit = vals.filter((v) => v && t.includes(" " + key(v) + " ")).sort((a, b) => b.length - a.length)[0] ?? NEUTRAL.map((x) => vals.find((v) => lo(v) === x)).find(Boolean);
      if (hit) { setAttr(r.name, hit); n++; }
    }
    return n;
  }

  const req = rows.filter((r) => r.required);
  const opt = rows.filter((r) => !r.required && !r.fromVariant);
  return (
    <div className="card">
      <h2>Pazaryeri kategorisi ve özellikleri</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Her pazaryerinin kategorisini seç; o kategorinin <b>zorunlu</b> özellikleri aşağıda çıkar. Hepsi dolmadan "gönder" çalışmaz (pazaryeri reddeder).
      </p>
      <div className="grid">
        {MPS.map((m) => <CategoryPicker key={m.id} api={api} mp={m.id} label={m.label} title={title} value={cats[m.id]}
          hint={m.id === "hepsiburada" ? cats.trendyol?.name ?? "" : ""}
          onPick={(c) => {
            setAttr(`${m.label} kategori`, c ? c.id : null); setAttr(`${m.label} kategori adı`, c ? c.path : null);
            clearTimeout(retry.current[m.id]); delete waitStart.current[m.id];
            setWaiting((w) => { const y = { ...w }; delete y[m.id]; return y; });
            setLists((x) => { const y = { ...x }; delete y[m.id]; return y; });
          }} />)}
      </div>
      {MPS.map((m) => (errs[m.id] ? <p key={m.id} style={{ color: "var(--bad)", fontSize: 13 }}>{m.label}: {errs[m.id]}{cats[m.id] && <> · <button className="btn ghost" style={{ minHeight: 26, padding: "0 8px" }} onClick={() => loadAttrs(m.id, cats[m.id]!.id, true)}>Tekrar dene</button></>}</p> : null))}
      {Object.values(loading).some(Boolean) && !Object.keys(waiting).length && <p className="muted">Özellikler yükleniyor...</p>}
      {Object.keys(waiting).map((mp) => <p key={mp} className="muted">⏳ {mp === "hepsiburada" ? "Hepsiburada" : "Trendyol"} bu kategorinin özelliklerini ilk kez getiriyor (yaklaşık 1-2 dakika, sayfadan ayrılabilirsin; sonra anında açılır)...</p>)}

      {rows.length > 0 && <>
        <div className="row" style={{ marginTop: 14, justifyContent: "space-between" }}>
          <b>Zorunlu özellikler ({req.length})</b>
          <button className="btn ghost" onClick={() => { const n = autoFill(); if (!n) alert("Başlıktan ya da nötr değerle doldurulabilecek boş zorunlu alan yok."); }}>Boşları akıllı doldur</button>
        </div>
        <div className="grid" style={{ marginTop: 8 }}>{req.map((r) => <AttrField key={r.name} r={r} attrs={attrs} setAttr={setAttr} hasVariants={hasVariants} />)}</div>
        {opt.length > 0 && <details style={{ marginTop: 12 }} open={showOpt} onToggle={(e) => setShowOpt((e.target as HTMLDetailsElement).open)}>
          <summary className="muted">İsteğe bağlı özellikler ({opt.length}) — doldurmak ilanın aramada bulunmasını kolaylaştırır</summary>
          {showOpt && <div className="grid" style={{ marginTop: 8 }}>{opt.map((r) => <AttrField key={r.name} r={r} attrs={attrs} setAttr={setAttr} hasVariants={hasVariants} />)}</div>}
        </details>}
      </>}
      <div className="row" style={{ marginTop: 12, gap: 12 }}>
        {MPS.map((m) => (
          <span key={m.id} className={`pill ${status.ready[m.id] ? "ok" : "partial"}`} title={status.missing[m.id].join(", ")}>
            {m.label}: {status.ready[m.id] ? "hazır" : `eksik: ${status.missing[m.id].slice(0, 4).join(", ")}${status.missing[m.id].length > 4 ? "…" : ""}`}
          </span>
        ))}
      </div>
    </div>
  );
}

function AttrField({ r, attrs, setAttr, hasVariants }: { r: { name: string; ty?: MpAttr; hb?: MpAttr; required: boolean; fromVariant: boolean }; attrs: Record<string, string>; setAttr: (k: string, v: string | null) => void; hasVariants: boolean }) {
  const badges = [r.ty && `Trendyol${r.ty.required ? " zorunlu" : ""}`, r.hb && `HB${r.hb.required ? " zorunlu" : ""}`].filter(Boolean).join(" · ");
  if (r.fromVariant && hasVariants) {
    return <label className="f">{r.name}<input disabled value="Varyant satırlarından (renk/beden seçenekleri)" /><small>{badges}</small></label>;
  }
  const primary = r.ty?.values.length ? r.ty : r.hb?.values.length ? r.hb : r.ty ?? r.hb!;
  const other = primary === r.ty ? r.hb : r.ty;
  const otherMp = other === r.hb ? "hepsiburada" : "trendyol";
  const v = attrs[r.name] ?? "";
  const needOther = !!(v && other && other.values.length && !inList(other.values, v));
  return (
    <label className="f">{r.name}{r.required && <span style={{ color: "var(--bad)" }}> *</span>}
      <ValueInput a={primary} value={v} onChange={(x) => setAttr(r.name, x || null)} />
      {needOther && <>
        <small style={{ color: "var(--warn)" }}>{otherMp === "hepsiburada" ? "Hepsiburada" : "Trendyol"} listesinde bu değer yok, oradaki karşılığını seç:</small>
        <ValueInput a={other!} value={attrs[`${r.name}@${otherMp}`] ?? ""} onChange={(x) => setAttr(`${r.name}@${otherMp}`, x || null)} />
      </>}
      <small>{badges}</small>
    </label>
  );
}

function ValueInput({ a, value, onChange }: { a: MpAttr; value: string; onChange: (v: string) => void }) {
  const id = useRef(`dl-${Math.random().toString(36).slice(2)}`).current;
  if (a.values.length && !a.custom && a.values.length <= 60) {
    return <select value={inList(a.values, value) ? a.values.find((x) => lo(x) === lo(value) || sq(x) === sq(value)) : ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">Seç...</option>{a.values.map((x) => <option key={x} value={x}>{x}</option>)}
    </select>;
  }
  // Uzun liste ya da serbest metin: yazdıkça öneri
  return <>
    <input type="text" list={a.values.length ? id : undefined} value={value} placeholder={a.values.length ? "Yaz, listeden seç" : "Serbest metin"} onChange={(e) => onChange(e.target.value)} />
    {a.values.length > 0 && <datalist id={id}>{a.values.slice(0, 1000).map((x) => <option key={x} value={x} />)}</datalist>}
  </>;
}

function CategoryPicker({ api, mp, label, title, hint, value, onPick }: { api: Api; mp: MpId; label: string; title: string; hint: string; value: Cat | null; onPick: (c: Cat | null) => void }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Cat[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const search = async (text: string) => {
    if (text.trim().length < 2) { setItems([]); return; }
    setBusy(true); setErr("");
    try {
      const r = await api(`/api/mp-catalog?mp=${mp}&q=${encodeURIComponent(text)}`);
      setItems(r.items ?? []); setOpen(true);
      // Hepsiburada kategori listesi ilk kez hazırlanıyor (GitHub iş akışı): 15 sn sonra aynı aramayı tekrarla
      if (r.pending) { setErr(r.started === false && r.error ? `Kategori listesi istenemedi: ${r.error}` : "Hepsiburada kategori listesi ilk kez hazırlanıyor (1-2 dakika), arama kendiliğinden tekrarlanacak..."); if (r.started !== false) setTimeout(() => search(text), 15000); }
    }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };
  const onType = (t: string) => { setQ(t); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => search(t), 350); };
  return (
    <div className="f" style={{ position: "relative" }}>
      <span>{label} kategorisi <span style={{ color: "var(--bad)" }}>*</span></span>
      {value ? (
        <div className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
          <span style={{ flex: 1, fontSize: 13 }}><b>{value.name || value.id}</b><br /><span className="muted">{value.path}</span></span>
          <button className="btn ghost" onClick={() => { onPick(null); setQ(""); }}>Değiştir</button>
        </div>
      ) : <>
        <input type="text" value={q} placeholder="Ara: sneaker, erkek spor ayakkabı..." onChange={(e) => onType(e.target.value)} onFocus={() => items.length && setOpen(true)} />
        <div className="row" style={{ gap: 6, marginTop: 4 }}>
          {title.trim().length > 5 && <button className="btn ghost" style={{ minHeight: 28, padding: "0 8px" }} disabled={busy} onClick={() => search(title)}>Başlıktan öner</button>}
          {hint && <button className="btn ghost" style={{ minHeight: 28, padding: "0 8px" }} disabled={busy} onClick={() => search(hint)}>Trendyol'dakine benzer: {hint}</button>}
          {busy && <small className="muted">Aranıyor...</small>}
        </div>
        {err && <small style={{ color: "var(--bad)" }}>{err}</small>}
        {open && items.length > 0 && (
          <div style={{ position: "absolute", zIndex: 20, top: "100%", left: 0, right: 0, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 8, maxHeight: 280, overflowY: "auto", boxShadow: "0 6px 20px rgba(0,0,0,.15)" }}>
            {items.map((c) => (
              <button key={c.id} className="btn ghost" style={{ display: "block", width: "100%", textAlign: "left", borderRadius: 0, minHeight: 0, padding: "6px 10px" }} onClick={() => { onPick(c); setOpen(false); setItems([]); }}>
                <b>{c.name}</b> <span className="muted" style={{ fontSize: 12 }}>{c.path}</span>
              </button>
            ))}
          </div>
        )}
        {open && !busy && q.trim().length >= 2 && !items.length && !err && <small className="muted">Sonuç yok, başka kelime dene.</small>}
      </>}
    </div>
  );
}
