"use client";

import { useCallback, useEffect, useState } from "react";
import { when, type Api, type Notify, type Row } from "./shared";

const TABS: [string, string][] = [["ready", "Onay bekleyen"], ["approved", "Onaylanan"], ["skipped", "Yazılamayan"], ["rejected", "Reddedilen"]];

// Yapay zekâ açıklamaları: taslak yalnızca tedarikçi metnindeki bilgiyle yazılır, kurallı kontrol ve ikinci doğrulamadan geçer.
// Onaylanan açıklama Trendyol'daki ilana bir sonraki senkronda gider (içerik güncellemesi) ve yeni gönderimlerde kullanılır.
export default function Descriptions({ api, notify, isAdmin }: { api: Api; notify: Notify; isAdmin: boolean }) {
  const [tab, setTab] = useState("ready");
  const [page, setPage] = useState(0);
  const [d, setD] = useState<Row | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api(`/api/descriptions?status=${tab}&page=${page}`).then((x) => { setD(x); setSel(new Set()); }).catch((e) => notify("err", e.message)), [api, notify, tab, page]);
  useEffect(() => { load(); }, [load]);

  async function act(body: Row, msg: string) {
    setBusy(true);
    try { const r = await api("/api/descriptions", { method: "PUT", body: JSON.stringify(body) }); notify("good", `${msg}${r.changed != null ? ` (${r.changed})` : ""}`); load(); }
    catch (e: any) { notify("err", e.message); } finally { setBusy(false); }
  }

  if (!d) return <p className="muted">Yükleniyor...</p>;
  if (d.missing) return <div className="card"><h2>Açıklamalar</h2><p>Veritabanında tablo yok: <code>supabase/migrations/067_product_descriptions.sql</code> SQL Editor'de çalıştırılmalı.</p></div>;
  const c = d.counts ?? {};
  const items: Row[] = d.items ?? [];
  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Açıklamalar (yapay zekâ)</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Yapay zekâ tedarikçinin açıklamasını yalnızca metindeki bilgilerle düzeltir: yazım, düzen, madde listesi; tedarikçi kodu, iletişim, fiyat/kargo sözleri çıkar.
          Kaynakta olmayan sayı, model kodu, iddia (orijinal, garanti, su geçirmez...) ya da marka geçerse, ya da ikinci doğrulama dayanaksız tek bir ifade bulursa taslak yazılmaz.
          Onaylanan açıklama Trendyol'daki ilana bir sonraki senkronda gider (ilk turlarda en fazla 20 ilan) ve yeni gönderimlerde kullanılır. Tedarikçi metni değişmez.
        </p>
        <div className="row" style={{ gap: 16, flexWrap: "wrap", fontSize: 14 }}>
          <span>Uygun ürün: <b>{Number(c.eligible ?? 0).toLocaleString("tr-TR")}</b></span>
          <span>Onay bekleyen: <b>{c.ready ?? 0}</b></span>
          <span>Onaylanan: <b>{c.approved ?? 0}</b> (Trendyol'a giden {c.pushed ?? 0})</span>
          <span>Yazılamayan: <b>{c.skipped ?? 0}</b></span>
          {Number(c.title_only ?? 0) > 0 && <span style={{ color: "var(--warn)" }}>Açıklaması başlığın kopyası: <b>{Number(c.title_only).toLocaleString("tr-TR")}</b> (tedarikçi eşlemesinde açıklama alanı: <code>ops/fix-toptancim-mapping.sql</code>)</span>}
        </div>
      </div>
      <div className="card">
        <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "space-between" }}>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {TABS.map(([k, l]) => <button key={k} className={`btn ${tab === k ? "primary" : ""}`} onClick={() => { setTab(k); setPage(0); }}>{l}</button>)}
          </div>
          {isAdmin && tab === "ready" && <div className="row" style={{ gap: 6 }}>
            <button className="btn" disabled={busy || !sel.size} onClick={() => act({ action: "approve", ids: [...sel] }, "Onaylandı")}>Seçilenleri onayla ({sel.size})</button>
            <button className="btn" disabled={busy || !sel.size} onClick={() => act({ action: "reject", ids: [...sel] }, "Reddedildi")}>Seçilenleri reddet</button>
            <button className="btn primary" disabled={busy || !c.ready} onClick={() => confirm(`${c.ready} açıklamanın hepsi onaylansın mı? Trendyol'daki ilanlara senkronla gidecek.`) && act({ action: "approve_all_ready", expect: c.ready }, "Hepsi onaylandı")}>Hepsini onayla ({c.ready ?? 0})</button>
          </div>}
          {isAdmin && (tab === "approved" || tab === "rejected") && <button className="btn" disabled={busy || !sel.size} onClick={() => act({ action: "reopen", ids: [...sel] }, "Onaya geri alındı")}>Seçilenleri onaya geri al</button>}
        </div>
        {!items.length && <p className="muted">Bu listede ürün yok.{tab === "ready" ? " Taslaklar saatte bir yazılır (Actions → Açıklama taslakları)." : ""}</p>}
        {items.map((it) => {
          const p = Array.isArray(it.products) ? it.products[0] : it.products;
          const editing = edit[it.product_id] != null;
          return (
            <div key={it.product_id} style={{ borderTop: "1px solid var(--line)", padding: "12px 0" }}>
              <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                {isAdmin && tab !== "skipped" && <input type="checkbox" checked={sel.has(it.product_id)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(it.product_id); else n.delete(it.product_id); return n; })} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{p?.title ?? it.product_id}</b> <span className="muted" style={{ fontSize: 12 }}>{p?.sku} · {when(it.updated_at)}{it.decided_by ? ` · ${it.decided_by}` : ""}{it.pushed?.trendyol ? ` · Trendyol'a gitti ${when(it.pushed.trendyol.at)}` : ""}</span>
                  {it.reason && <p style={{ fontSize: 13, color: "var(--warn)", margin: "4px 0" }}>{it.reason}</p>}
                  <div className="grid" style={{ marginTop: 6 }}>
                    <div><small className="muted">Tedarikçi metni</small><div style={{ fontSize: 13, whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto" }}>{it.original}</div></div>
                    {it.draft && <div><small className="muted">Düzeltilmiş</small>
                      {editing
                        ? <textarea rows={10} style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }} value={edit[it.product_id]} onChange={(e) => setEdit((x) => ({ ...x, [it.product_id]: e.target.value }))} />
                        : <div style={{ fontSize: 13, maxHeight: 220, overflow: "auto" }} dangerouslySetInnerHTML={{ __html: it.draft }} />}
                    </div>}
                  </div>
                  {isAdmin && it.draft && tab !== "skipped" && <div className="row" style={{ gap: 6, marginTop: 6 }}>
                    {!editing && <button className="btn" onClick={() => setEdit((x) => ({ ...x, [it.product_id]: it.draft }))}>Düzenle</button>}
                    {editing && <>
                      <button className="btn primary" disabled={busy} onClick={() => act({ action: "edit", id: it.product_id, draft: edit[it.product_id] }, "Kaydedildi, onay bekliyor").then(() => setEdit((x) => { const n = { ...x }; delete n[it.product_id]; return n; }))}>Kaydet (kontrol edilir)</button>
                      <button className="btn" onClick={() => setEdit((x) => { const n = { ...x }; delete n[it.product_id]; return n; })}>Vazgeç</button>
                    </>}
                  </div>}
                </div>
              </div>
            </div>
          );
        })}
        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          <button className="btn" disabled={page === 0} onClick={() => setPage((x) => x - 1)}>← Önceki</button>
          <span className="muted">Sayfa {page + 1}</span>
          <button className="btn" disabled={items.length < 25} onClick={() => setPage((x) => x + 1)}>Sonraki →</button>
        </div>
      </div>
    </>
  );
}
