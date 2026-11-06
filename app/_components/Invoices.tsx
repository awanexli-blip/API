"use client";

import { useCallback, useEffect, useState } from "react";
import { tl, when, type Api, type Notify, type Row } from "./shared";

// Faturalar (GİB e-Arşiv portalı, /api/invoices): sistem taslak oluşturur, K portalda toplu seçip tek SMS ile imzalar,
// "İmzalananları kontrol et" durumu okur. Sistem fatura imzalamaz.
const IST: Record<string, [string, string]> = { none: ["Kesilmedi", ""], creating: ["Oluşturuluyor", "info"], draft: ["Taslak: portalda imzala", "info"], signed: ["Kesildi", "ok"], uploaded: ["Trendyol'a yüklendi", "ok"], error: ["Hata", "error"], deleted: ["Taslak silinmiş", "partial"] };

export default function Invoices({ api, notify }: { api: Api; notify: Notify }) {
  const [d, setD] = useState<Row | null>(null);
  const [open, setOpen] = useState(true);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState<"todo" | "warn" | "all" | "hb">("todo");
  const load = useCallback(() => api("/api/invoices").then(setD).catch((e) => notify("err", e.message)), [api, notify]);
  useEffect(() => { if (open) load(); }, [open, load]);

  const rows: Row[] = (d?.rows ?? []).filter((r: Row) => filter === "all" || (filter === "warn" ? !!r.invoice?.error : filter === "hb" ? r.marketplace === "hepsiburada" && ["signed", "uploaded"].includes(r.invoice?.status) : !r.invoice || ["error", "deleted", "draft", "creating"].includes(r.invoice.status)));
  const selectable = (r: Row) => r.has_customer && (!r.invoice || ["error", "deleted"].includes(r.invoice.status));
  const c = d?.counts ?? {};
  const dupRows: Row[] = (d?.rows ?? []).filter((r: Row) => /^MÜKERRER/.test(r.invoice?.error ?? "") && ["signed", "uploaded"].includes(r.invoice?.status));
  const daysAgo = (t?: string) => (t ? Math.floor((Date.now() - Date.parse(t)) / 86400000) : 0);

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
  async function audit() {
    setBusy("Denetim başlatılıyor...");
    try { await api("/api/invoices", { method: "POST", body: JSON.stringify({ action: "upload", mode: "audit" }) }); notify("good", "Mükerrer fatura denetimi başladı (salt okunur, 2-4 dk). Bu sırada e-Arşiv portalından çıkış yap. Bitince \"Raporu yenile\"."); }
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
  // İmzalı faturayı yeni pencerede aç ve yazdır (PDF olarak kaydet); pencere başlığı = dosya adı (alıcı adı, ör. "kamil kilic")
  async function openPdf(id: string) {
    const w = window.open("", "_blank"); // tıklama anında açılmalı (açılır pencere engeli)
    if (!w) return notify("err", "Tarayıcı yeni pencereyi engelledi: bu site için açılır pencereye izin ver");
    w.document.write("<p style='font-family:sans-serif'>Fatura GİB'den alınıyor...</p>");
    try {
      const r = await api("/api/invoices", { method: "POST", body: JSON.stringify({ action: "html", order_id: id }), timeoutMs: 60000 } as any);
      const title = `<title>${String(r.name).replace(/[<>&]/g, "")}</title>`;
      const html = /<title>[\s\S]*?<\/title>/i.test(r.html) ? r.html.replace(/<title>[\s\S]*?<\/title>/i, title) : /<head[^>]*>/i.test(r.html) ? r.html.replace(/<head[^>]*>/i, (m: string) => m + title) : title + r.html;
      w.document.open(); w.document.write(html); w.document.close();
      w.document.title = r.name;
      setTimeout(() => { try { w.focus(); w.print(); } catch { /* elle Ctrl+P */ } }, 600);
    } catch (e: any) { w.close(); notify("err", e.message); }
  }
  async function clearReport(report: "audit" | "upload") {
    if (!confirm("Bu rapor ekrandan kaldırılacak. Faturalara, GİB portalına ve Trendyol'a dokunulmaz. Devam?")) return;
    try { await api("/api/invoices", { method: "POST", body: JSON.stringify({ action: "clear_report", report }) }); load(); } catch (e: any) { notify("err", e.message); }
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
        {!d.configured && <p style={{ color: "var(--bad)", fontSize: 13 }}>Bu panelde GİB kullanıcı kodu / şifresi tanımlı değil (GIB_PORTAL_USER, GIB_PORTAL_PASS). Tanımlanana kadar taslak oluşturma ve kontrol kapalı; listeyi görebilirsin.</p>}
        <div className="row" style={{ gap: 8, flexWrap: "wrap", margin: "8px 0" }}>
          <span className="muted">Kesilmedi: {c.none ?? 0} · İmza bekleyen taslak: {c.draft ?? 0} · Kesildi: {(c.signed ?? 0) + (c.uploaded ?? 0)} (Trendyol'a yüklenen {c.uploaded ?? 0}) · Hata: {c.error ?? 0}</span>
          {busy && <span className="muted">{busy}</span>}
        </div>

        {dupRows.length > 0 && <div style={{ border: "1px solid var(--bad)", borderRadius: 8, padding: 10, margin: "8px 0", fontSize: 13 }}>
          <b style={{ color: "var(--bad)" }}>⚠️ {dupRows.length} siparişte çift fatura uyarısı</b>
          <div className="muted" style={{ margin: "4px 0" }}>Bu notlar en son denetimden geliyor{d.audit ? ` (${daysAgo(d.audit.at)} gün önce)` : ""}. Portalda iptal ettiysen <b>Mükerrer fatura kontrolü</b>ne bas: artık çift olmayanların uyarısı kendiliğinden kalkar. Gerçekten çift olan kalır ve Trendyol'a yüklenmez.</div>
          <div>{dupRows.map((r) => `${r.order_no} (${r.invoice?.belge_no ?? "-"})`).join(" · ")}</div>
        </div>}

        <div style={{ borderTop: "1px solid var(--line)", padding: "8px 0", margin: "8px 0" }}>
          <b>1. Taslak oluştur</b>
          <p className="muted" style={{ fontSize: 13, margin: "4px 0" }}>Aşağıdaki listeden siparişleri seç. Sistem portalda yalnızca <b>taslak</b> açar (alıcı TC 11111111111, tutar = satış geliri, KDV ürünün oranı). Alıcı adı/adresi 30 günden eski siparişler seçilemez.</p>
          <button className="btn" disabled={!!busy || !sel.size || !d.configured} onClick={draft}>Seçilenlere taslak oluştur ({sel.size})</button>
        </div>
        <div style={{ borderTop: "1px solid var(--line)", padding: "8px 0", margin: "8px 0" }}>
          <b>2. Portalda imzala, sonra kontrol et</b>
          <p className="muted" style={{ fontSize: 13, margin: "4px 0" }}><b>İmza sende:</b> e-Arşiv portalı → Düzenlenen Belgeler → taslakları seç → İmzala (tek SMS). Sonra buraya dönüp kontrol et.</p>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn" disabled={!!busy || !d.configured} onClick={sync}>İmzalananları kontrol et</button>
            {(d.rows ?? []).some((r: Row) => r.invoice?.status === "draft" && /^MÜKERRER/.test(r.invoice?.error ?? "")) && <button className="btn" disabled={!!busy} onClick={delDup}>Mükerrer taslakları sil</button>}
            <button className="btn ghost" disabled={!!busy || !d.configured} onClick={logoutGib} title="Portal aynı anda tek oturuma izin veriyor: 'birden fazla kişi giriş yapamaz' diyorsa bas">e-Arşiv oturumunu kapat</button>
          </div>
        </div>
        <div style={{ borderTop: "1px solid var(--line)", padding: "8px 0", margin: "8px 0" }}>
          <b>3. Trendyol'a yükle</b>
          <p className="muted" style={{ fontSize: 13, margin: "4px 0" }}>
            Önce <b>deneme</b>: GİB belgesindeki ETTN, belge no, sipariş no, alıcı adı ve tutar sistemle ve Trendyol'daki paketle karşılaştırılır, hiçbir şey yüklenmez. <b>Yükle</b> yalnızca denemede uygun çıkanları gönderir. Çalışırken portalda oturum açık olmasın. Hepsiburada faturaları burada yüklenmez.
          </p>
          {!d.uploadReady && <p style={{ color: "var(--bad)", fontSize: 13, margin: "4px 0" }}>Bu panelde GH_TOKEN tanımlı değil: deneme, yükleme ve mükerrer kontrolü başlatılamaz.</p>}
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn ghost" disabled={!!busy || !c.signed || !d.uploadReady} onClick={() => upload("dry")}>Deneme (yüklemeden kontrol)</button>
            <button className="btn" disabled={!!busy || !d.uploadReady || !(d.upload?.mode === "dry" && d.upload?.ok && Date.now() - Date.parse(d.upload.at) < 24 * 3600000)} onClick={() => upload("apply")}>Uygun olanları yükle ({d.upload?.mode === "dry" && Date.now() - Date.parse(d.upload.at) < 24 * 3600000 ? d.upload.ok : 0})</button>
            <button className="btn ghost" disabled={!!busy || !d.configured || !d.uploadReady} onClick={audit} title="Portalda elle kestiğin faturalarla sistemin faturalarını karşılaştırır; GİB'de ve Trendyol'da hiçbir şey değiştirmez, eskiyen uyarıları kaldırır">Mükerrer fatura kontrolü</button>
            <button className="btn ghost" disabled={!!busy} onClick={load}>Yenile</button>
          </div>
          {d.upload && <details style={{ fontSize: 13, marginTop: 6 }}>
            <summary className="muted">Son {d.upload.mode === "dry" ? "deneme" : "yükleme"} raporu: {when(d.upload.at)}{daysAgo(d.upload.at) >= 1 ? ` (${daysAgo(d.upload.at)} gün önce, eski)` : ""} · uygun {d.upload.ok} · atlanan {d.upload.failed}</summary>
            <div className="muted">Toplam {d.upload.total}{d.upload.mode === "apply" ? ` · yüklendi ${d.upload.uploaded} · zaten vardı ${d.upload.already}` : ""}</div>
            {(d.upload.rows ?? []).filter((x: Row) => !x.ok).length > 0 && <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
              {(d.upload.rows ?? []).filter((x: Row) => !x.ok).map((x: Row) => <li key={x.belge_no}>{x.belge_no} / {x.order_no}: <span style={{ color: "var(--bad)" }}>{x.reason}</span></li>)}
            </ul>}
            <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => clearReport("upload")}>Raporu kaldır</button>
          </details>}
          {d.audit && <details style={{ fontSize: 13, marginTop: 6 }}>
            <summary className="muted">Mükerrer kontrol raporu: {when(d.audit.at)}{daysAgo(d.audit.at) >= 1 ? ` (${daysAgo(d.audit.at)} gün önce, eski)` : ""} · çift fatura {d.audit.duplicateSigned ?? 0}</summary>
            <div className="muted">Portalda {d.audit.portalDocs} belge (sistemin {d.audit.ourDocs}, elle {d.audit.foreign}, elle imzalı {d.audit.foreignSigned}){d.audit.notes ? ` · kalkan uyarı ${d.audit.notes.cleared} · yeni uyarı ${d.audit.notes.flagged} · iptal ${d.audit.notes.cancelled}${d.audit.notes.portalOk ? "" : " · portal listesi eksikti, uyarılar değiştirilmedi"}` : ""}</div>
            {(d.audit.rows ?? []).filter((x: Row) => x.kind !== "siparişle eşleşmedi").length > 0 && <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
              {(d.audit.rows ?? []).filter((x: Row) => x.kind !== "siparişle eşleşmedi").map((x: Row, i: number) => <li key={i}>Elle: {x.belge_no} ({x.onay}) · sipariş {x.order_no} · sistem: {x.our_belge_no ?? "-"} ({x.our_status ?? "yok"}) · <b style={{ color: /^MÜKERRER/.test(x.kind) ? "var(--bad)" : undefined }}>{x.kind}</b></li>)}
            </ul>}
            {(d.audit.rows ?? []).some((x: Row) => x.kind === "siparişle eşleşmedi") && <div className="muted">Siparişle eşleşmeyen elle belgeler: {(d.audit.rows ?? []).filter((x: Row) => x.kind === "siparişle eşleşmedi").map((x: Row) => x.belge_no).join(", ")}</div>}
            <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => clearReport("audit")}>Raporu kaldır</button>
          </details>}
        </div>
        <div className="row" style={{ gap: 8, margin: "8px 0" }}>
          <select value={filter} onChange={(e) => setFilter(e.target.value as any)}><option value="todo">Bekleyenler</option><option value="warn">Uyarılı olanlar</option><option value="all">Tümü (60 gün)</option><option value="hb">Hepsiburada faturaları</option></select>
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
                  {["signed", "uploaded"].includes(r.invoice?.status) && <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => openPdf(r.id)} title="Yazdır penceresinde 'PDF olarak kaydet' seç">Faturayı aç / PDF</button>}
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
