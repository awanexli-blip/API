"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { when, type Api, type Notify, type Row } from "./shared";
import { confirmDialog } from "./confirm-dialog";

const TABS: [string, string][] = [["ready", "Onay bekleyen"], ["approved", "Onaylanan"], ["skipped", "Yazılamayan"], ["rejected", "Reddedilen"]];

// Yapay zekâ açıklamaları: taslak yalnızca tedarikçi metnindeki bilgiyle yazılır, kurallı kontrol ve ikinci doğrulamadan geçer.
// Onaylanan açıklama Trendyol'daki ilana bir sonraki senkronda gider (içerik güncellemesi) ve yeni gönderimlerde kullanılır.
// İçerik düzeltme (K 19.11, worker/content-fix.ts): çelişen cümle çıkarma / görsel ölçüsü (iki model) + başka satıcılardan uzlaşmalı özellik;
// her değişiklik nedeni ve kaynağıyla gösterilir. Onaylanan özellikler sunucuda `content-fix.ts apply --yes` ile ürüne ve ilana yazılır.
const ACT: Record<string, string> = { remove: "Çıkarıldı", replace: "Değiştirildi", drop_body: "Gövde atıldı", note: "Not" };
const KIND: Record<string, string> = { malzeme: "Malzeme çelişkisi", urun_tipi: "Ürün tipi çelişkisi", olcu: "Ölçü" };
const BY: Record<string, string> = { kural: "kural", "yapay_zeka+kural": "yapay zekâ önerisi + kural", iki_model: "iki görsel modeli" };
function ContentFixInfo({ it }: { it: Row }) {
  const ch: Row[] = it.checks?.changes ?? [];
  const ap: Row[] = it.attr_proposals ?? [];
  if (it.kind !== "content-fix" || (!ch.length && !ap.length)) return null;
  return (
    <div style={{ fontSize: 13, marginTop: 6 }}>
      {ch.length > 0 && <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
        {ch.map((c, i) => <li key={i}><b>{KIND[c.kind] ?? c.kind} · {ACT[c.action] ?? c.action}</b>: {c.reason}
          {c.sentence && <div className="muted">Cümle: “{c.sentence}”{c.replacement ? <> → “{c.replacement}”</> : null}</div>}
          <div className="muted">Dayanak ({BY[c.by] ?? c.by}): {c.evidence}</div></li>)}
      </ul>}
      {ap.length > 0 && <div style={{ marginTop: 4 }}><small className="muted">Önerilen özellikler (en az iki bağımsız doğrulanmış kaynak / barkod + tedarikçi metni)</small>
        <ul style={{ margin: "4px 0", paddingLeft: 18 }}>{ap.map((a, i) => <li key={i}><b>{a.name}</b> = {a.value} <span className="muted">({a.mp}{a.supplierAgrees ? ", tedarikçi metni de aynı" : ""})</span>
          <ul style={{ paddingLeft: 16 }}>{(a.sources ?? []).map((s: Row, j: number) => <li key={j} className="muted"><a href={s.url} target="_blank" rel="noreferrer noopener">{s.host}</a>{s.seller ? ` · ${s.seller}` : ""} · {s.matchKind === "barcode" ? "barkod eşleşti" : "model kodu + fotoğraf eşleşti"} · “{s.quote}”</li>)}</ul></li>)}</ul>
        {it.applied?.attrs && <small className="muted">Uygulandı {when(it.applied.attrs.at)}</small>}</div>}
    </div>
  );
}
export default function Descriptions({ api, notify, isAdmin }: { api: Api; notify: Notify; isAdmin: boolean }) {
  const [tab, setTab] = useState("ready");
  const [page, setPage] = useState(0);
  const [d, setD] = useState<Row | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  // Sekme hızlı değişirse geç gelen eski yanıt yeni sekmenin üstüne yazılmasın
  const seq = useRef(0);
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    const n = ++seq.current;
    setLoading(true);
    return api(`/api/descriptions?status=${tab}&page=${page}`)
      .then((x) => { if (n !== seq.current) return; setD(x); setSel(new Set()); setLoadErr(""); })
      .catch((e) => { if (n !== seq.current) return; setLoadErr(e.message); notify("err", e.message); })
      .finally(() => { if (n === seq.current) setLoading(false); });
  }, [api, notify, tab, page]);
  useEffect(() => { load(); }, [load]);

  async function act(body: Row, msg: string) {
    setBusy(true);
    try { const r = await api("/api/descriptions", { method: "PUT", body: JSON.stringify(body) }); notify("good", `${msg}${r.changed != null ? ` (${r.changed})` : ""}`); load(); }
    catch (e: any) { notify("err", e.message); } finally { setBusy(false); }
  }

  if (!d) return loadErr
    ? <div className="card"><h2 style={{ marginTop: 0 }}>Açıklamalar</h2><p role="alert">Liste yüklenemedi: {loadErr}</p><button className="btn primary" onClick={() => { setLoadErr(""); load(); }}>Yeniden dene</button></div>
    : <p className="muted">Yükleniyor...</p>;
  if (d.missing) return <div className="card"><h2>Açıklamalar</h2><p>Veritabanında tablo yok: <code>supabase/migrations/067_product_descriptions.sql</code> SQL Editor'de çalıştırılmalı.</p></div>;
  const c = d.counts ?? {};
  const items: Row[] = d.items ?? [];
  const cf = d.contentFix ?? {};
  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Açıklamalar</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Ürün açıklamaları tedarikçiden geldiği gibi kullanılır. İçerik düzeltme yalnızca çelişkiyi giderir (bilgi uydurmaz): başlıkla çelişen malzeme / ürün tipi cümlesi çıkar, görseldeki ölçü iki model aynı okursa yazılır, özellik en az iki bağımsız doğrulanmış kaynak aynı derse önerilir. Onaylamadan pazaryerine gitmez.</p>
        {!cf.missing && <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 13, marginBottom: 8 }}>
          <span>İçerik düzeltme: <b style={{ color: cf.enabled ? "var(--ok)" : "var(--warn)" }}>{cf.enabled ? "sürekli çalışıyor" : "durdu"}</b>{cf.at ? ` (${when(cf.at)}${cf.by ? `, ${cf.by}` : ""})` : ""}</span>
          <span>Onay bekleyen düzeltme: <b>{cf.ready ?? 0}</b></span>
          {cf.progress && <span className="muted">Son çalışma: {cf.progress.processed ?? 0} ürün, {cf.progress.degisiklik ?? 0} değişiklik{cf.progress.stop ? ` · ${cf.progress.stop}` : ""}</span>}
          {isAdmin && <button className={`btn ${cf.enabled ? "" : "primary"}`} disabled={busy} onClick={async () => {
            const on = !cf.enabled;
            if (on && !(await confirmDialog("İçerik düzeltme sürekli çalışsın mı? Sunucu her 30 dakikada bir sonraki ürünleri dener; sonuçlar yine bu listede onay bekler, pazaryerine onaysız bir şey gitmez."))) return;
            act({ action: "content_fix_toggle", enabled: on }, on ? "İçerik düzeltme açıldı" : "İçerik düzeltme durduruldu");
          }}>{cf.enabled ? "Durdur" : "Sürekli çalıştır"}</button>}
        </div>}
        <div className="row" style={{ gap: 16, flexWrap: "wrap", fontSize: 14 }}>
          <span>Uygun ürün: <b>{c.eligible == null ? "hesaplanıyor" : Number(c.eligible).toLocaleString("tr-TR")}</b></span>
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
            <button className="btn primary" disabled={busy || !c.ready} onClick={async () => { if (await confirmDialog(`${c.ready} açıklamanın hepsi onaylansın mı? Trendyol'daki ilanlara senkronla gidecek.`)) act({ action: "approve_all_ready", expect: c.ready }, "Hepsi onaylandı"); }}>Hepsini onayla ({c.ready ?? 0})</button>
          </div>}
          {isAdmin && (tab === "approved" || tab === "rejected") && <button className="btn" disabled={busy || !sel.size} onClick={() => act({ action: "reopen", ids: [...sel] }, "Onaya geri alındı")}>Seçilenleri onaya geri al</button>}
        </div>
        {loading ? <p className="muted">Yükleniyor...</p> : !items.length && <p className="muted">Bu listede ürün yok.</p>}
        {!loading && items.map((it) => {
          const p = Array.isArray(it.products) ? it.products[0] : it.products;
          const editing = edit[it.product_id] != null;
          return (
            <div key={it.product_id} style={{ borderTop: "1px solid var(--line)", padding: "12px 0" }}>
              <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                {isAdmin && tab !== "skipped" && <input type="checkbox" aria-label="Seç" checked={sel.has(it.product_id)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(it.product_id); else n.delete(it.product_id); return n; })} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{p?.title ?? it.product_id}</b> <span className="muted" style={{ fontSize: 12 }}>{p?.sku} · {when(it.updated_at)}{it.decided_by ? ` · ${it.decided_by}` : ""}{it.pushed?.trendyol ? ` · Trendyol'a gitti ${when(it.pushed.trendyol.at)}` : ""}</span>
                  {it.reason && <p style={{ fontSize: 13, color: "var(--warn)", margin: "4px 0" }}>{it.reason}</p>}
                  <ContentFixInfo it={it} />
                  <div className="grid" style={{ marginTop: 6 }}>
                    <div><small className="muted">Tedarikçi metni</small><div style={{ fontSize: 13, whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto" }}>{it.original}</div></div>
                    {!it.draft && it.kind === "content-fix" && <div><small className="muted">Açıklama değişmiyor (yalnızca özellik önerisi)</small></div>}
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
