"use client";

import { useCallback, useEffect, useState } from "react";
import { tl, when, type Api, type Notify, type Row } from "./shared";

// Faturalar (GİB e-Arşiv portalı, /api/invoices): sistem taslak oluşturur, K portalda toplu seçip tek SMS ile imzalar,
// "İmzalananları kontrol et" durumu okur. Sistem fatura imzalamaz.
const IST: Record<string, [string, string]> = { none: ["Kesilmedi", ""], creating: ["Oluşturuluyor", "info"], draft: ["Taslak: portalda imzala", "info"], signed: ["Kesildi", "ok"], uploaded: ["Trendyol'a yüklendi", "ok"], error: ["Hata", "error"], deleted: ["Taslak silinmiş", "partial"] };

export default function Invoices({ api, notify }: { api: Api; notify: Notify }) {
  const [d, setD] = useState<Row | null>(null);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState<"todo" | "all">("todo");
  const load = useCallback(() => api("/api/invoices").then(setD).catch((e) => notify("err", e.message)), [api, notify]);
  useEffect(() => { if (open) load(); }, [open, load]);

  const rows: Row[] = (d?.rows ?? []).filter((r: Row) => filter === "all" || !r.invoice || ["error", "deleted", "draft", "creating"].includes(r.invoice.status));
  const selectable = (r: Row) => r.has_customer && (!r.invoice || ["error", "deleted"].includes(r.invoice.status));
  const c = d?.counts ?? {};

  async function draft() {
    const ids = [...sel];
    if (!ids.length) return;
    if (!confirm(`${ids.length} sipariş için GİB e-Arşiv portalında TASLAK fatura oluşturulacak (imzalanmaz). Sonra portalda taslakları kontrol edip toplu imzalayacaksın. Devam?`)) return;
    let ok = 0; const errs: string[] = [];
    // 5'erli: her taslak portalda 3 istek; 30.10'da 25'lik istek panelin 25 sn bekleme süresini aştı (sunucu arka planda bitirdi)
    for (let i = 0; i < ids.length; i += 5) {
      setBusy(`Taslaklar oluşturuluyor (${Math.min(i + 5, ids.length)}/${ids.length})...`);
      try {
        const r = await api("/api/invoices", { method: "POST", body: JSON.stringify({ action: "draft", order_ids: ids.slice(i, i + 5) }), timeoutMs: 120000 } as any);
        ok += r.created; for (const x of r.results ?? []) if (!x.ok) errs.push(`${x.order_no ?? ""}: ${x.error}`);
      } catch (e: any) { errs.push(e.message); break; }
    }
    setBusy(""); setSel(new Set()); load();
    notify(errs.length ? "err" : "good", `${ok} taslak oluşturuldu.${ok ? " Şimdi e-Arşiv portalında Düzenlenen Belgeler'den taslakları seçip toplu imzala (tek SMS), sonra \"İmzalananları kontrol et\"." : ""}${errs.length ? ` Hata (${errs.length}): ${errs.slice(0, 3).join(" · ")}` : ""}`);
  }
  async function sync() {
    setBusy("Portal okunuyor...");
    try { const r = await api("/api/invoices", { method: "POST", body: JSON.stringify({ action: "sync" }), timeoutMs: 120000 } as any); notify(r.duplicate ? "err" : "good", `${r.duplicate ? `⚠️ ${r.duplicate} taslak MÜKERRER (o siparişler için portalda elle kesilmiş/oluşturulmuş belge var): ikisini birden imzalama. ` : ""}İmzalanan: ${r.signed}, bekleyen taslak: ${r.waiting}${r.deleted ? `, portalda silinmiş: ${r.deleted}` : ""}${r.missing ? `, portal listesinde görünmeyen (dokunulmadı): ${r.missing}` : ""}. Portalda elle kesilip siparişe bağlanan: ${r.manual ?? 0}${r.manualAmbiguous ? `, aynı adla birden fazla sipariş olduğu için bağlanamayan: ${r.manualAmbiguous}` : ""}${r.manualUnmatched ? `, eşleşen sipariş bulunamayan: ${r.manualUnmatched}` : ""}`); load(); }
    catch (e: any) { notify("err", e.message); } finally { setBusy(""); }
  }
  async function delDup() {
    const n = (d?.rows ?? []).filter((r: Row) => /^MÜKERRER/.test(r.invoice?.error ?? "")).length;
    if (!n || !confirm(`${n} mükerrer TASLAK portaldan silinecek (yalnızca imzalanmamış taslaklar; senin kestiğin faturalara dokunulmaz). Devam?`)) return;
    setBusy("Mükerrer taslaklar siliniyor...");
    try { const r = await api("/api/invoices", { method: "POST", body: JSON.stringify({ action: "delete_duplicates" }), timeoutMs: 120000 } as any); notify("good", `${r.deleted} mükerrer taslak silindi. Şimdi "İmzalananları kontrol et" ile elle kestiklerin siparişlere bağlanır.`); load(); }
    catch (e: any) { notify("err", e.message); } finally { setBusy(""); }
  }
  async function logoutGib() {
    setBusy("e-Arşiv oturumu kapatılıyor...");
    try { const r = await api("/api/invoices", { method: "POST", body: JSON.stringify({ action: "logout" }), timeoutMs: 60000 } as any); notify(r.ok ? "good" : "err", r.message); }
    catch (e: any) { notify("err", e.message); } finally { setBusy(""); }
  }
  async function upload(mode: "dry" | "apply") {
    const u = d?.upload;
    // İlk gerçek yükleme tek fatura: K Trendyol panelinde doğru pakette doğru PDF'i görünce kalanlar gider
    const first = mode === "apply" && !(c.uploaded ?? 0);
    const count = first ? 1 : 200;
    if (mode === "apply" && !confirm(first ? "İLK yükleme: yalnızca 1 fatura Trendyol'a yüklenecek. Trendyol panelinde o siparişte faturanın doğru göründüğünü kontrol et, sonra bu düğmeyle kalanları yükle. Devam?"
      : `Son denemede uygun çıkan ${u?.ok ?? 0} fatura Trendyol'a yüklenecek (kontroller yeniden yapılır, tutmayan atlanır). Trendyol aynı pakete ikinci faturayı kabul etmez. Devam?`)) return;
    setBusy(mode === "dry" ? "Deneme başlatılıyor..." : "Yükleme başlatılıyor...");
    try {
      await api("/api/invoices", { method: "POST", body: JSON.stringify({ action: "upload", mode, count }) });
      notify("good", `${mode === "dry" ? "Deneme" : "Yükleme"} başladı (GitHub Actions, 2-5 dk). Bu sırada e-Arşiv portalından çıkış yap (tek oturum). Bitince "Raporu yenile".`);
    } catch (e: any) { notify("err", e.message); } finally { setBusy(""); }
  }
  async function reset(id: string) {
    try { await api("/api/invoices", { method: "POST", body: JSON.stringify({ action: "reset", order_id: id }) }); load(); } catch (e: any) { notify("err", e.message); }
  }

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Faturalar (e-Arşiv)</h3>
        <button className="btn ghost" onClick={() => setOpen(!open)}>{open ? "Gizle" : "Aç"}</button>
      </div>
      {open && !d && <p className="muted">Yükleniyor...</p>}
      {open && d && <>
        {!d.configured && <p style={{ color: "var(--bad)", fontSize: 13 }}>GİB portal kullanıcı kodu / şifresi Vercel'de tanımlı değil (GIB_PORTAL_USER, GIB_PORTAL_PASS).</p>}
        <p className="muted" style={{ fontSize: 13 }}>
          Sistem seçtiğin siparişler için portalda <b>taslak</b> açar (alıcı TC 11111111111, tutar = satış geliri, KDV ürünün oranı). <b>İmza sende:</b> portal → Düzenlenen Belgeler → taslakları seç → İmzala (tek SMS).
          Alıcı adı/adresi 30 günden eski siparişlerde silinmiş olur, onlar seçilemez.
        </p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", margin: "8px 0" }}>
          <span className="muted">Kesilmedi: {c.none ?? 0} · Taslak: {c.draft ?? 0} · Kesildi: {(c.signed ?? 0) + (c.uploaded ?? 0)} (Trendyol'a yüklenen {c.uploaded ?? 0}) · Hata: {c.error ?? 0}</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value as any)}><option value="todo">Bekleyenler</option><option value="all">Tümü (60 gün)</option></select>
          <button className="btn" disabled={!!busy || !sel.size || !d.configured} onClick={draft}>Seçilenlere taslak oluştur ({sel.size})</button>
          <button className="btn ghost" disabled={!!busy || !d.configured} onClick={sync}>İmzalananları kontrol et</button>
          {(d.rows ?? []).some((r: Row) => /^MÜKERRER/.test(r.invoice?.error ?? "")) && <button className="btn" disabled={!!busy} onClick={delDup}>Mükerrer taslakları sil</button>}
          <button className="btn ghost" disabled={!!busy || !d.configured} onClick={logoutGib} title="Portal aynı anda tek oturuma izin veriyor: 'birden fazla kişi giriş yapamaz' diyorsa bas">e-Arşiv oturumunu kapat</button>
          {busy && <span className="muted">{busy}</span>}
        </div>
        <div style={{ borderTop: "1px solid var(--line)", padding: "8px 0", margin: "8px 0" }}>
          <b>Trendyol'a yükle</b>
          <p className="muted" style={{ fontSize: 13, margin: "4px 0" }}>
            Önce <b>deneme</b>: her imzalı faturada GİB belgesindeki ETTN, belge no, sipariş no, alıcı adı ve tutar sistemle; Trendyol'daki paket, durum ve tutar canlı olarak karşılaştırılır. Hiçbir şey yüklenmez.
            Sonra <b>yükle</b> yalnızca denemede uygun çıkanları gönderir. Çalışırken e-Arşiv portalında oturum açık olmasın. Hepsiburada faturaları burada yüklenmez.
          </p>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn ghost" disabled={!!busy || !c.signed} onClick={() => upload("dry")}>Deneme (yüklemeden kontrol)</button>
            <button className="btn" disabled={!!busy || !(d.upload?.mode === "dry" && d.upload?.ok && Date.now() - Date.parse(d.upload.at) < 24 * 3600000)} onClick={() => upload("apply")}>Uygun olanları yükle ({d.upload?.mode === "dry" ? d.upload.ok : 0})</button>
            <button className="btn ghost" disabled={!!busy} onClick={load}>Raporu yenile</button>
          </div>
          {d.upload && <div style={{ fontSize: 13, marginTop: 6 }}>
            <span className="muted">Son {d.upload.mode === "dry" ? "deneme" : "yükleme"}: {when(d.upload.at)} · toplam {d.upload.total} · uygun {d.upload.ok}{d.upload.mode === "apply" ? ` · yüklendi ${d.upload.uploaded} · zaten vardı ${d.upload.already}` : ""} · atlanan {d.upload.failed}</span>
            {(d.upload.rows ?? []).filter((x: Row) => !x.ok).length > 0 && <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
              {(d.upload.rows ?? []).filter((x: Row) => !x.ok).map((x: Row) => <li key={x.belge_no}>{x.belge_no} / {x.order_no}: <span style={{ color: "var(--bad)" }}>{x.reason}</span></li>)}
            </ul>}
          </div>}
        </div>
        <div className="scroll"><table className="cards">
          <thead><tr>
            <th><input type="checkbox" aria-label="Seçilebilenlerin hepsi" checked={rows.some(selectable) && rows.filter(selectable).every((r) => sel.has(r.id))} onChange={(e) => setSel(e.target.checked ? new Set(rows.filter(selectable).map((r) => r.id)) : new Set())} /></th>
            <th>Sipariş</th><th>Tarih</th><th>Ürünler</th><th className="n">Tutar</th><th>Fatura</th>
          </tr></thead>
          <tbody>{rows.map((r) => {
            const st = IST[r.invoice?.status ?? "none"] ?? [r.invoice?.status, ""];
            return (
              <tr key={r.id}>
                <td><input type="checkbox" disabled={!selectable(r)} checked={sel.has(r.id)} onChange={(e) => { const s = new Set(sel); if (e.target.checked) s.add(r.id); else s.delete(r.id); setSel(s); }} /></td>
                <td data-label="Sipariş">{r.order_no}<br /><span className="muted" style={{ fontSize: 12 }}>{r.marketplace}</span></td>
                <td data-label="Tarih">{when(r.ordered_at)}</td>
                <td data-label="Ürünler" style={{ fontSize: 13 }}>{r.items}</td>
                <td data-label="Tutar" className="n">{tl(Number(r.invoice?.amount ?? r.total))}</td>
                <td data-label="Fatura"><span className={`pill ${st[1]}`}>{st[0]}</span>
                  {!r.has_customer && !r.invoice && <div className="muted" style={{ fontSize: 12 }}>alıcı bilgisi yok: elle kes</div>}
                  {r.invoice?.error && <div style={{ color: "var(--bad)", fontSize: 12 }}>{r.invoice.error}</div>}
                  {["error", "deleted", "creating"].includes(r.invoice?.status) && <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => reset(r.id)}>Yeniden dene</button>}
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </>}
    </div>
  );
}
