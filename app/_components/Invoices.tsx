"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { tl, when, type Api, type Notify, type Row } from "./shared";
import { confirmDialog } from "./confirm-dialog";

// Faturalar (GİB e-Arşiv portalı, /api/invoices): sistem taslak oluşturur, K portalda toplu seçip tek SMS ile imzalar,
// "İmzalananları kontrol et" durumu okur, imzalılar denemeden sonra Trendyol'a yüklenir. Sistem fatura imzalamaz.
// Ekran (K, 06.11 "daha kullanışlı"): üstte tek "sıradaki adım", yapılacak sayıları, işe göre sekmeler; seyrek araçlar "Diğer araçlar"da.
const PORTAL_URL = "https://earsivportal.efatura.gov.tr/intragiris.html";
const IST: Record<string, [string, string]> = { none: ["Kesilmedi", ""], creating: ["Oluşturuluyor", "info"], draft: ["İmza bekliyor", "info"], signed: ["Kesildi", "ok"], uploaded: ["Trendyol'a yüklendi", "ok"], error: ["Hata", "error"], deleted: ["Taslak silinmiş", "partial"] };
type Tab = "todo" | "sign" | "upload" | "warn" | "all" | "hb" | "ret";
const DOC: Record<string, string> = { iptal: "Portalda iptal edildi", gider_pusulasi: "Gider pusulası kesildi", gerekmiyor: "Belge gerekmiyor", musteri_iade: "Müşterinin iade faturası alındı" };
// Portal iptal süresi: kaynaklar 7-8 gün diyor, güvenli taraf 7 (K, 06.11). Kesin karar portalın kendisi: süre dolmuşsa kabul etmez.
const CANCEL_DAYS = 7;
const isDone = (st: string) => /accepted|refunded|kabul|iade edildi/i.test(st);
const isDropped = (st: string) => /cancelled|iptal edildi|reject/i.test(st);
const dup = (r: Row) => /^MÜKERRER/.test(r.invoice?.error ?? "");
const inTab: Record<Tab, (r: Row) => boolean> = {
  todo: (r) => !r.invoice || ["error", "deleted", "creating"].includes(r.invoice.status),
  sign: (r) => r.invoice?.status === "draft",
  upload: (r) => r.invoice?.status === "signed" && r.marketplace === "trendyol" && !dup(r),
  warn: (r) => !!r.invoice?.error,
  all: () => true,
  hb: (r) => r.marketplace === "hepsiburada" && ["signed", "uploaded"].includes(r.invoice?.status),
  ret: () => false,
};
const EMPTY: Record<Tab, string> = { todo: "Fatura kesilecek sipariş yok.", sign: "İmza bekleyen taslak yok.", upload: "Trendyol'a yüklenecek fatura yok.", warn: "Uyarı yok.", all: "Son 60 günde sipariş yok.", hb: "Hepsiburada faturası yok.", ret: "İade yok." };
const daysAgo = (t?: string) => (t ? Math.floor((Date.now() - Date.parse(t)) / 86400000) : 0);
const oldTag = (t?: string) => (daysAgo(t) >= 1 ? ` (${daysAgo(t)} gün önce, eski)` : "");

export default function Invoices({ api, notify }: { api: Api; notify: Notify }) {
  const [d, setD] = useState<Row | null>(null);
  const [failed, setFailed] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [tab, setTab] = useState<Tab | null>(null);
  const [waiting, setWaiting] = useState("");
  const [q, setQ] = useState(""); // arama: sipariş no, ürün, belge no, uyarı metni
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const load = useCallback(() => api("/api/invoices").then((x: Row) => { setD(x); setFailed(""); }).catch((e: any) => { setFailed(e.message); notify("err", e.message); }), [api, notify]);
  useEffect(() => { load(); return () => { if (timer.current) clearInterval(timer.current); }; }, [load]);

  const all: Row[] = d?.rows ?? [];
  const ret = d?.returns;
  const retAll: Row[] = [...(ret?.cancelled ?? []), ...(ret?.rows ?? [])];
  // Açık iş: iade (kabul edilmiş, imzalı iade faturası yok, işaret yok) ya da iptal edilmiş siparişin faturası (portalda iptal edilmedi)
  const retDone = (r: Row) => !!ret?.marks?.[r.id] || isDropped(String(r.status)) || r.return_invoice?.status === "signed";
  const retOpen = retAll.filter((r) => !retDone(r));
  // İade faturası taslağı açılabilir mi (sunucu aynı kuralları yeniden denetler)
  const retWhyNot = (r: Row): string | null => String(r.id).startsWith("iptal:") || r.undelivered ? "iptal" : isDropped(String(r.status)) ? "Talep iptal" : !isDone(String(r.status)) ? "İade kabul edilince"
    : !r.invoice || !["signed", "uploaded"].includes(r.invoice.status) ? "Önce satış faturası" : r.buyer_type && r.buyer_type !== "bireysel" ? "Kurumsal: iade faturasını müşteri keser"
    : r.return_invoice && !["error", "deleted"].includes(r.return_invoice.status) ? "var" : ret?.marks?.[r.id] ? "işaretli" : null;
  const [rsel, setRsel] = useState<Set<string>>(new Set());
  const n = (t: Tab) => (t === "ret" ? retOpen.length : all.filter(inTab[t]).length);
  // e-Fatura mükellefi kurumsal alıcıya e-Arşiv kesilmez (Trendyol kurumsal fatura rehberi): seçilemez, GİB e-Fatura portalından elle
  const selectable = (r: Row) => r.has_customer && r.buyer_type !== "kurumsal_efatura" && (!r.invoice || ["error", "deleted"].includes(r.invoice.status));
  // Kullanıcı sekme seçmediyse yapılacak iş olan ilk sekme
  const cur: Tab = tab ?? (n("todo") ? "todo" : n("sign") ? "sign" : n("upload") ? "upload" : "todo");
  const qn = q.trim().toLocaleLowerCase("tr");
  const hit = (r: Row) => !qn || [r.order_no, r.items, r.invoice?.belge_no, r.invoice?.error, r.marketplace].some((x) => String(x ?? "").toLocaleLowerCase("tr").includes(qn));
  const rows = all.filter(inTab[cur]).filter(hit);
  // Kaldırılabilir uyarı: hata durumundaki (yeniden denenecek) kayıt hariç, notu olan fatura
  const canDismiss = (r: Row) => !!r.invoice?.error && !["error", "creating"].includes(r.invoice.status);
  const c = d?.counts ?? {};
  const dupSigned = all.filter((r) => dup(r) && ["signed", "uploaded"].includes(r.invoice?.status));
  const selectedRows = all.filter((r) => sel.has(r.id));
  const selectedTotal = selectedRows.reduce((t, r) => t + Number(r.total ?? 0), 0);
  const selectableNow = rows.filter(selectable);
  const dryFresh = d?.upload?.mode === "dry" && Date.now() - Date.parse(d.upload.at) < 24 * 3600000;
  const canGib = !!d?.configured, canGh = !!d?.uploadReady;

  // Arka plandaki iş (GitHub Actions, 2-5 dk) bitene kadar raporu kendisi yeniler; en fazla 8 dk
  function watch(label: string) {
    setWaiting(label);
    if (timer.current) clearInterval(timer.current);
    let k = 0;
    timer.current = setInterval(() => { k++; load(); if (k >= 16) { clearInterval(timer.current!); timer.current = null; setWaiting(""); } }, 30000);
  }

  async function post(body: Row, timeoutMs?: number) { return api("/api/invoices", { method: "POST", body: JSON.stringify(body), ...(timeoutMs ? { timeoutMs } : {}) } as any); }

  async function draft() {
    const ids = [...sel];
    if (!ids.length) return;
    if (!(await confirmDialog(`${ids.length} sipariş için GİB e-Arşiv portalında TASLAK fatura oluşturulacak (toplam ${tl(selectedTotal)}). İmzalanmaz: imzayı portalda sen atarsın. Devam?`))) return;
    let ok = 0; const errs: string[] = [];
    // Hatalı / silinmiş kaydı olan sipariş önce açılır (yoksa "zaten taslak var" der); sunucu yalnızca bu durumları siler
    for (const r of selectedRows) if (r.invoice && ["error", "deleted"].includes(r.invoice.status)) { try { await post({ action: "reset", order_id: r.id }); } catch (e: any) { errs.push(`${r.order_no}: ${e.message}`); } }
    // 5'erli: her taslak portalda 3 istek; 30.10'da 25'lik istek panelin 25 sn bekleme süresini aştı (sunucu arka planda bitirdi)
    for (let i = 0; i < ids.length; i += 5) {
      setBusy(`Taslaklar oluşturuluyor (${Math.min(i + 5, ids.length)}/${ids.length})...`);
      try {
        const r = await post({ action: "draft", order_ids: ids.slice(i, i + 5) }, 120000);
        ok += r.created; for (const x of r.results ?? []) if (!x.ok) errs.push(`${x.order_no ?? ""}: ${x.error}`);
      } catch (e: any) { errs.push(e.message); break; }
    }
    setBusy(""); setSel(new Set()); await load();
    if (ok) setTab("sign");
    notify(errs.length ? "err" : "good", `${ok} taslak oluşturuldu.${ok ? " Şimdi portalda imzala, sonra \"İmzalananları kontrol et\"e bas." : ""}${errs.length ? ` Hata (${errs.length}): ${errs.slice(0, 3).join(" · ")}` : ""}`);
  }
  async function sync() {
    setBusy("Portal okunuyor...");
    try {
      const r = await post({ action: "sync" }, 120000);
      notify(r.duplicate ? "err" : "good", `${r.duplicate ? `⚠️ ${r.duplicate} taslak MÜKERRER (o siparişler için portalda elle kesilmiş/oluşturulmuş belge var): ikisini birden imzalama. ` : ""}İmzalanan: ${r.signed}${r.returnSigned ? ` (+${r.returnSigned} iade faturası)` : ""}, bekleyen taslak: ${r.waiting}${r.deleted ? `, portalda silinmiş: ${r.deleted}` : ""}${r.missing ? `, portal listesinde görünmeyen (dokunulmadı): ${r.missing}` : ""}. Portalda elle kesilip siparişe bağlanan: ${r.manual ?? 0}${r.manualAmbiguous ? `, aynı adla birden fazla sipariş olduğu için bağlanamayan: ${r.manualAmbiguous}` : ""}${r.manualUnmatched ? `, eşleşen sipariş bulunamayan: ${r.manualUnmatched}` : ""}`);
      await load();
    } catch (e: any) { notify("err", e.message); } finally { setBusy(""); }
  }
  async function delDup() {
    const m = all.filter((r) => dup(r) && r.invoice?.status === "draft").length;
    if (!m || !(await confirmDialog(`${m} mükerrer TASLAK portaldan silinecek (yalnızca imzalanmamış taslaklar; kestiğin faturalara dokunulmaz). Devam?`, { danger: true }))) return;
    setBusy("Mükerrer taslaklar siliniyor...");
    try { const r = await post({ action: "delete_duplicates" }, 120000); notify("good", `${r.deleted} mükerrer taslak silindi. Şimdi "İmzalananları kontrol et" ile elle kestiklerin siparişlere bağlanır.`); await load(); }
    catch (e: any) { notify("err", e.message); } finally { setBusy(""); }
  }
  async function dismiss(list: Row[]) {
    const ids = list.filter(canDismiss).map((r) => r.id);
    if (!ids.length) return;
    // Mükerrer: hangisi iptal edildi? (K 15.11) Yanlış seçim iptal edilmiş belgeyi Trendyol'a yükletirdi.
    const dups = list.filter((r) => canDismiss(r) && dup(r));
    if (dups.length) {
      const manual = await confirmDialog(`${dups.length} siparişte iki imzalı fatura var. Hangisini portalda iptal ettin?

• Sistemin faturasını iptal ettiysen (elle kestiğin geçerli ve Trendyol'da): sipariş "elle kesildi, yüklendi" olarak işaretlenir.
• Elle kestiğini iptal ettiysen: sistemin faturası Trendyol'a yüklenecekler listesine geçer.`, { ok: "Sistemin faturasını iptal ettim", cancel: "Elle kestiğimi iptal ettim" });
      const keep = manual ? "manual" : "system";
      if (!manual && !(await confirmDialog(`Elle kestiğin ${dups.length} fatura iptal, sistemin faturaları Trendyol'a yüklenecekler listesine geçecek. Emin misin?`, { ok: "Evet, sistemin faturası geçerli", cancel: "Vazgeç" }))) return;
      setBusy("Mükerrer faturalar düzeltiliyor...");
      try { const r = await post({ action: "resolve_duplicate", order_ids: dups.map((x) => x.id), keep }); notify("good", keep === "manual" ? `${r.resolved} sipariş "elle kesildi, Trendyol'a yüklendi" olarak işaretlendi.` : `${r.resolved} faturanın uyarısı kalktı; Yüklenecek listesinde.`); }
      catch (e: any) { notify("err", e.message); setBusy(""); return; }
      setBusy("");
      const rest = list.filter((r) => canDismiss(r) && !dup(r));
      if (!rest.length) { await load(); return; }
      list = rest;
    }
    {
      const ids2 = list.filter(canDismiss).map((r) => r.id);
      if (!ids2.length) { await load(); return; }
      if (!(await confirmDialog(`${ids2.length} faturanın uyarısı kaldırılacak. Fatura kaydı, GİB portalı ve Trendyol değişmez. Devam?`))) { await load(); return; }
      setBusy("Uyarılar kaldırılıyor...");
      try { const r = await post({ action: "dismiss_warning", order_ids: ids2 }); notify("good", `${r.cleared} uyarı kaldırıldı.`); await load(); }
      catch (e: any) { notify("err", e.message); } finally { setBusy(""); }
      return;
    }
  }
  async function logoutGib() {
    setBusy("e-Arşiv oturumu kapatılıyor...");
    try { const r = await post({ action: "logout" }, 60000); notify(r.ok ? "good" : "err", r.message); }
    catch (e: any) { notify("err", e.message); } finally { setBusy(""); }
  }
  async function audit() {
    setBusy("Denetim başlatılıyor...");
    try { await post({ action: "upload", mode: "audit" }); notify("good", "Mükerrer fatura kontrolü başladı. Portalda oturum açık olmasın. Rapor gelince ekran kendisi güncellenir."); watch("Mükerrer kontrolü çalışıyor (2-4 dk)"); }
    catch (e: any) { notify("err", e.message); } finally { setBusy(""); }
  }
  async function upload(mode: "dry" | "apply") {
    const u = d?.upload;
    // İlk gerçek yükleme tek fatura: K Trendyol panelinde doğru pakette doğru PDF'i görünce kalanlar gider
    const first = mode === "apply" && !(c.uploaded ?? 0);
    const count = first ? 1 : 200;
    if (mode === "apply" && !(await confirmDialog(first ? "İLK yükleme: yalnızca 1 fatura Trendyol'a yüklenecek. Trendyol panelinde o siparişte faturanın doğru göründüğünü kontrol et, sonra kalanları yükle. Devam?"
      : `Son denemede uygun çıkan ${u?.ok ?? 0} fatura Trendyol'a yüklenecek (kontroller yeniden yapılır, tutmayan atlanır). Trendyol aynı pakete ikinci faturayı kabul etmez. Devam?`))) return;
    setBusy(mode === "dry" ? "Deneme başlatılıyor..." : "Yükleme başlatılıyor...");
    try {
      await post({ action: "upload", mode, count });
      notify("good", `${mode === "dry" ? "Deneme" : "Yükleme"} başladı. Portalda oturum açık olmasın. Bitince ekran kendisi güncellenir.`);
      watch(mode === "dry" ? "Deneme çalışıyor (2-5 dk)" : "Yükleme çalışıyor (2-5 dk)");
    } catch (e: any) { notify("err", e.message); } finally { setBusy(""); }
  }
  // İmzalı faturayı yeni pencerede aç ve yazdır (PDF olarak kaydet); pencere başlığı = dosya adı (alıcı adı)
  async function openPdf(id: string) {
    const w = window.open("", "_blank"); // tıklama anında açılmalı (açılır pencere engeli)
    if (!w) return notify("err", "Tarayıcı yeni pencereyi engelledi: bu site için açılır pencereye izin ver");
    w.document.write("<p style='font-family:sans-serif'>Fatura GİB'den alınıyor...</p>");
    try {
      const r = await post({ action: "html", order_id: id }, 60000);
      const title = `<title>${String(r.name).replace(/[<>&]/g, "")}</title>`;
      const html = /<title>[\s\S]*?<\/title>/i.test(r.html) ? r.html.replace(/<title>[\s\S]*?<\/title>/i, title) : /<head[^>]*>/i.test(r.html) ? r.html.replace(/<head[^>]*>/i, (m: string) => m + title) : title + r.html;
      w.document.open(); w.document.write(html); w.document.close();
      w.document.title = r.name;
      setTimeout(() => { try { w.focus(); w.print(); } catch { /* elle Ctrl+P */ } }, 600);
    } catch (e: any) { w.close(); notify("err", e.message); }
  }
  async function clearReport(report: "audit" | "upload") {
    if (!(await confirmDialog("Bu rapor ekrandan kaldırılacak. Faturalara, GİB portalına ve Trendyol'a dokunulmaz. Devam?", { danger: true }))) return;
    try { await post({ action: "clear_report", report }); await load(); } catch (e: any) { notify("err", e.message); }
  }
  async function returnDraft() {
    const ids = [...rsel];
    if (!ids.length) return;
    if (!(await confirmDialog(`${ids.length} iade için GİB e-Arşiv portalında İADE FATURASI TASLAĞI oluşturulacak (orijinal satış faturasına bağlı, yalnızca iade edilen ürün ve adet). İmzayı portalda sen atarsın. Devam?`))) return;
    let ok = 0; const errs: string[] = [];
    for (const id of ids) { const r = retAll.find((x) => x.id === id); if (r?.return_invoice && ["error", "deleted"].includes(r.return_invoice.status)) { try { await post({ action: "return_reset", id }); } catch (e: any) { errs.push(e.message); } } }
    for (let i = 0; i < ids.length; i += 5) {
      setBusy(`İade faturası taslakları oluşturuluyor (${Math.min(i + 5, ids.length)}/${ids.length})...`);
      try { const r = await post({ action: "return_draft", ids: ids.slice(i, i + 5) }, 120000); ok += r.created; for (const x of r.results ?? []) if (!x.ok) errs.push(`${retAll.find((y) => y.id === x.id)?.order_no ?? ""}: ${x.error}`); }
      catch (e: any) { errs.push(e.message); break; }
    }
    setBusy(""); setRsel(new Set()); await load();
    notify(errs.length ? "err" : "good", `${ok} iade faturası taslağı oluşturuldu.${ok ? " Portalda imzala, sonra İmzalananları kontrol et." : ""}${errs.length ? ` Hata (${errs.length}): ${errs.slice(0, 3).join(" · ")}` : ""}`);
  }
  async function openReturnPdf(id: string) {
    const w = window.open("", "_blank");
    if (!w) return notify("err", "Tarayıcı yeni pencereyi engelledi: bu site için açılır pencereye izin ver");
    w.document.write("<p style='font-family:sans-serif'>İade faturası GİB'den alınıyor...</p>");
    try { const r = await post({ action: "return_html", id }, 60000); w.document.open(); w.document.write(`<title>${String(r.name).replace(/[<>&]/g, "")}</title>` + r.html); w.document.close(); }
    catch (e: any) { w.close(); notify("err", e.message); }
  }
  async function cancelReturnDraft(r: Row) {
    if (!(await confirmDialog(`${r.order_no}: satış faturası 8 günü geçtiği için portalda iptal edilemiyor. Siparişin tamamı için GİB'de İADE FATURASI TASLAĞI oluşturulacak (orijinal faturaya bağlı, aynı tutar ve KDV). İmzayı portalda sen atarsın. Devam?`))) return;
    setBusy("İade faturası taslağı oluşturuluyor...");
    try {
      if (r.return_invoice && ["error", "deleted", "creating"].includes(r.return_invoice.status)) await post({ action: "return_reset", id: r.id });
      const x = await post({ action: "cancel_return_draft", id: r.id }, 120000);
      notify("good", `İade faturası taslağı oluşturuldu (${tl(Number(x.amount))}). Portalda imzala, sonra İmzalananları kontrol et.`);
    } catch (e: any) { notify("err", e.message); }
    setBusy(""); await load();
  }
  async function markReturn(id: string, doc: string | null) {
    if (doc && !(await confirmDialog(`"${DOC[doc]}" olarak işaretlenecek. Bu yalnızca panel kaydıdır; GİB'de ve Trendyol'da işlem yapmaz. Devam?`))) return;
    try { await post({ action: "mark_return", id, doc }); await load(); } catch (e: any) { notify("err", e.message); }
  }
  async function reset(id: string) {
    try { await post({ action: "reset", order_id: id }); await load(); } catch (e: any) { notify("err", e.message); }
  }

  if (!d) return <div className="card">{failed ? <><p style={{ color: "var(--bad)" }}>Faturalar yüklenemedi: {failed}</p><button className="btn" onClick={load}>Yeniden dene</button></> : <p className="muted">Yükleniyor...</p>}</div>;

  const stat = (t: Tab, label: string, hint: string, tone?: string) => (
    <button key={t} onClick={() => setTab(t)} aria-pressed={cur === t} style={{ textAlign: "left", font: "inherit", cursor: "pointer", background: "var(--panel)", color: "var(--ink)", border: `1px solid ${cur === t ? "var(--accent)" : "var(--line)"}`, borderRadius: "var(--radius)", padding: "12px 14px" }}>
      <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1, color: tone && n(t) ? tone : undefined }}>{n(t)}</div>
      <div style={{ fontWeight: 600, fontSize: 14, marginTop: 4 }}>{label}</div>
      <div className="muted" style={{ fontSize: 12 }}>{hint}</div>
    </button>
  );
  // Sıradaki adım: duruma göre tek öneri
  const next: { text: string; tone?: string; act: ReactNode } = !canGib ? { text: "Önce bu panele GİB kullanıcı kodu ve şifresi tanımlanmalı (GIB_PORTAL_USER, GIB_PORTAL_PASS). O zamana kadar taslak ve kontrol kapalı.", tone: "var(--bad)", act: null }
    : dupSigned.length ? { text: `${dupSigned.length} siparişte çift fatura uyarısı var${d.audit ? ` (son kontrol ${daysAgo(d.audit.at)} gün önce)` : ""}. Portalda fazlalığı iptal ettiysen "Düzelttim" ile uyarıyı kaldır ya da kontrol başlat (çift olmayanların uyarısı kendiliğinden kalkar). Uyarısı duran fatura Trendyol'a yüklenmez.`, tone: "var(--bad)", act: <><button className="btn" disabled={!!busy} onClick={() => dismiss(dupSigned)}>Düzelttim, uyarıları kaldır ({dupSigned.length})</button><button className="btn primary" disabled={!!busy || !canGh} onClick={audit}>Mükerrer fatura kontrolü</button></> }
    : n("sign") ? { text: `${n("sign")} taslak imzanı bekliyor. Portalda Düzenlenen Belgeler'den seçip imzala (tek SMS), sonra buraya dönüp kontrol et.`, act: <><a className="btn" href={PORTAL_URL} target="_blank" rel="noreferrer">e-Arşiv portalını aç</a><button className="btn primary" disabled={!!busy} onClick={sync}>İmzalananları kontrol et</button></> }
    : n("upload") ? { text: dryFresh && d.upload?.ok ? `Son denemede ${d.upload.ok} fatura uygun çıktı, yükleyebilirsin.` : `${n("upload")} kesilmiş fatura Trendyol'a yüklenmeyi bekliyor. Önce deneme: hiçbir şey yüklenmez, her fatura tek tek karşılaştırılır.`,
        act: dryFresh && d.upload?.ok ? <button className="btn primary" disabled={!!busy || !canGh} onClick={() => upload("apply")}>Uygun olanları yükle ({d.upload.ok})</button> : <button className="btn primary" disabled={!!busy || !canGh} onClick={() => upload("dry")}>Deneme başlat</button> }
    : n("todo") ? { text: `${n("todo")} siparişin faturası kesilmedi. Aşağıdan seç, taslak oluştur.`, act: null }
    : retOpen.length ? { text: `${retOpen.length} iade / iptal için belge durumu bekliyor. İadeler sekmesinden bak.`, act: <button className="btn primary" onClick={() => setTab("ret")}>İadeleri aç</button> }
    : { text: "Her şey tamam, bekleyen fatura işi yok.", tone: "var(--ok)", act: null };

  return (
    <>
      <div className="card">
        <div style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 280px" }}>
            <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>SIRADAKİ ADIM</div>
            <div style={{ color: next.tone, fontWeight: 500 }}>{next.text}</div>
          </div>
          {next.act && <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>{next.act}</div>}
        </div>
        {!canGh && canGib && <p style={{ color: "var(--bad)", fontSize: 13, margin: "8px 0 0" }}>Bu panelde GH_TOKEN tanımlı değil: deneme, yükleme ve mükerrer kontrolü başlatılamaz.</p>}
        {(busy || waiting) && <p className="muted" style={{ fontSize: 13, margin: "8px 0 0" }} role="status">{busy || `${waiting}. Ekran 30 saniyede bir yenilenir.`}</p>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 14 }}>
        {stat("todo", "Kesilecek", "Taslak oluştur")}
        {stat("sign", "İmza bekliyor", "Portalda imzala")}
        {stat("upload", "Yüklenecek", "Trendyol'a gönder")}
        {stat("warn", "Uyarı", "Kontrol gerekiyor", "var(--bad)")}
        {stat("ret", "İade / iptal", "Belgesi bekleyen", "var(--warn)")}
      </div>

      <div className="card">
        <div className="row" style={{ gap: 8, marginBottom: 8 }}>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ara: sipariş no, ürün, belge no, uyarı" aria-label="Faturalarda ara" style={{ flex: "1 1 260px", maxWidth: 420 }} />
          {q && <span className="muted" style={{ fontSize: 12 }}>{rows.length} sonuç</span>}
        </div>
        <div className="tabs" role="tablist">
          {([["todo", "Kesilecek"], ["sign", "İmza bekliyor"], ["upload", "Yüklenecek"], ["warn", "Uyarı"], ["ret", "İadeler"], ["hb", "Hepsiburada"], ["all", "Tümü (60 gün)"]] as [Tab, string][]).map(([t, label]) => (
            <button key={t} role="tab" aria-selected={cur === t} className="tab" onClick={() => setTab(t)}>{label} ({n(t)})</button>
          ))}
        </div>

        {cur === "todo" && <div className="row" style={{ gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <button className="btn primary" disabled={!!busy || !sel.size || !canGib} onClick={draft}>{sel.size ? `${sel.size} sipariş için taslak oluştur (${tl(selectedTotal)})` : "Taslak için sipariş seç"}</button>
          {selectableNow.length > 0 && <button className="btn ghost" onClick={() => setSel(selectableNow.every((r) => sel.has(r.id)) ? new Set() : new Set(selectableNow.map((r) => r.id)))}>{selectableNow.every((r) => sel.has(r.id)) ? "Seçimi kaldır" : `Tümünü seç (${selectableNow.length})`}</button>}
          <span className="muted" style={{ fontSize: 12 }}>Alıcı TC 11111111111, tutar satış geliri, KDV ürünün oranı. 30 günden eski siparişin alıcı bilgisi silinir, onlar seçilemez.</span>
        </div>}
        {cur === "sign" && <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <a className="btn" href={PORTAL_URL} target="_blank" rel="noreferrer">e-Arşiv portalını aç</a>
          <button className="btn primary" disabled={!!busy || !canGib} onClick={sync}>İmzalananları kontrol et</button>
          {all.some((r) => dup(r) && r.invoice?.status === "draft") && <button className="btn danger" disabled={!!busy} onClick={delDup}>Mükerrer taslakları sil</button>}
        </div>}
        {cur === "upload" && <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <button className={dryFresh && d.upload?.ok ? "btn" : "btn primary"} disabled={!!busy || !n("upload") || !canGh} onClick={() => upload("dry")}>Deneme (yüklemeden kontrol)</button>
          <button className={dryFresh && d.upload?.ok ? "btn primary" : "btn"} disabled={!!busy || !canGh || !(dryFresh && d.upload?.ok)} onClick={() => upload("apply")}>Uygun olanları yükle ({dryFresh ? d.upload?.ok ?? 0 : 0})</button>
          {!dryFresh && <span className="muted" style={{ fontSize: 12 }}>Yükleme için son 24 saatte deneme gerekir.</span>}
        </div>}
        {cur === "warn" && rows.some(canDismiss) && <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <button className="btn" disabled={!!busy} onClick={() => dismiss(rows)}>Hepsini düzelttim ({rows.filter(canDismiss).length})</button>
          {dupSigned.length > 0 && <button className="btn primary" disabled={!!busy || !canGib || !canGh} onClick={audit}>Mükerrer fatura kontrolü</button>}
          <span className="muted" style={{ fontSize: 12 }}>GİB'de ve Trendyol'da hiçbir şey değiştirmez; yalnızca buradaki rapor ve uyarıları günceller.</span>
        </div>}
        {cur === "hb" && <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Hepsiburada faturaları buradan yüklenmez: PDF'i açıp Hepsiburada paneline elle yükle.</p>}

        {cur === "ret" && (() => {
          const list = retAll.filter((r) => !qn || [r.order_no, r.title, r.barcode, r.reason, r.invoice?.belge_no, r.return_invoice?.belge_no].some((x) => String(x ?? "").toLocaleLowerCase("tr").includes(qn)));
          const eligible = list.filter((r) => !retWhyNot(r));
          const RI: Record<string, [string, string]> = { creating: ["Oluşturuluyor", "partial"], draft: ["Taslak: portalda imzala", "partial"], signed: ["İade faturası kesildi", "ok"], error: ["Hata", "error"], deleted: ["Taslak silinmiş", "error"] };
          return <>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Trendyol ve Hepsiburada iadeleri{ret?.at ? ` (son okuma ${when(ret.at)})` : ""}. Kabul edilen her bireysel iade için <b>iade faturası</b> kesilir. Kurumsal müşteride iade faturasını müşteri keser, sistem dokunmaz; gelince &quot;Müşterinin iade faturası geldi&quot; ile işaretle. Sistem taslağı oluşturur, imzayı portalda sen atarsın, sonra &quot;İmzalananları kontrol et&quot;. Sipariş müşteriye ulaşmadan iptal edildiyse satış faturası portalda iptal edilir.
          </p>
          <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <button className="btn primary" disabled={!!busy || !rsel.size || !canGib} onClick={returnDraft}>{rsel.size ? `${rsel.size} iade için iade faturası taslağı` : "İade faturası için iade seç"}</button>
            {eligible.length > 0 && <button className="btn ghost" onClick={() => setRsel(eligible.every((r) => rsel.has(r.id)) ? new Set() : new Set(eligible.map((r) => r.id)))}>{eligible.every((r) => rsel.has(r.id)) ? "Seçimi kaldır" : `Kesilecekleri seç (${eligible.length})`}</button>}
            <button className="btn" disabled={!!busy || !canGib} onClick={sync}>İmzalananları kontrol et</button>
            <a className="btn" href={PORTAL_URL} target="_blank" rel="noreferrer">e-Arşiv portalını aç</a>
          </div>
          {list.length === 0 ? <p className="muted" style={{ padding: "16px 0" }}>{qn ? "Aramayla eşleşen iade yok." : ret?.at ? EMPTY.ret : "İade listesi henüz gelmedi: bir sonraki senkrondan sonra görünür."}</p> : <div className="scroll"><table className="cards">
            <thead><tr><th aria-label="Seç"></th><th>Sipariş</th><th>Talep</th><th>Ürün</th><th className="n">Tutar</th><th>Satış faturası</th><th>İade faturası / işlem</th></tr></thead>
            <tbody>{list.map((r) => {
              const inv = r.invoice, ri = r.return_invoice, mark = ret?.marks?.[r.id];
              const cancelled = String(r.id).startsWith("iptal:") || !!r.undelivered; // iptal ya da teslim edilemedi: faturası portalda iptal edilir
              const dropped = isDropped(String(r.status)), done = isDone(String(r.status));
              const why = retWhyNot(r);
              const days = inv ? daysAgo(inv.signed_at ?? inv.created_at) : null;
              return (
                <tr key={r.id} style={dropped ? { opacity: 0.55 } : undefined}>
                  <td>{!cancelled && <input type="checkbox" aria-label={`${r.order_no} iade seç`} disabled={!!why} title={why ?? ""} checked={rsel.has(r.id)} onChange={(e) => { const x = new Set(rsel); if (e.target.checked) x.add(r.id); else x.delete(r.id); setRsel(x); }} />}</td>
                  <td data-label="Sipariş">{r.order_no ?? "-"}<br /><span className="muted" style={{ fontSize: 12 }}>{r.marketplace}{r.barcode ? ` · ${r.barcode}` : ""}</span></td>
                  <td data-label="Talep">{when(r.at)}<br /><span className="muted" style={{ fontSize: 12 }}>{r.reason}</span>
                    {r.buyer_type && r.buyer_type !== "bireysel" && <div style={{ color: "var(--warn)", fontSize: 12 }}>Kurumsal: iade faturasını müşteri keser; gelmeden iade işlemine başlama</div>}</td>
                  <td data-label="Ürün" style={{ fontSize: 13 }}>{r.title || "-"}{r.qty > 1 ? ` (${r.qty} adet)` : ""}<div><span className={`pill ${dropped ? "" : done || cancelled ? "ok" : "partial"}`}>{dropped ? "Talep iptal" : r.undelivered ? "Teslim edilemedi" : cancelled ? "Sipariş iptal" : done ? "İade kabul" : "Pazaryeri kararı bekleniyor"}</span></div></td>
                  <td data-label="Tutar" className="n" style={{ whiteSpace: "nowrap" }}>{tl(Number(r.price))}</td>
                  <td data-label="Satış faturası">{inv ? <>{inv.belge_no ?? "-"}<br /><span className="muted" style={{ fontSize: 12 }}>{IST[inv.status]?.[0] ?? inv.status}{days != null ? ` · ${days} gün önce` : ""}</span></> : <span className="muted">Satış faturası yok</span>}</td>
                  <td data-label="İade faturası / işlem">
                    {cancelled ? (mark ? <><span className="pill ok">Fatura iptal edildi</span><div><button className="btn ghost" style={{ fontSize: 12 }} onClick={() => markReturn(r.id, null)}>Geri al</button></div></>
                        : ri && !["error", "deleted", "creating"].includes(ri.status) ? <><span className={`pill ${RI[ri.status]?.[1] ?? ""}`}>{RI[ri.status]?.[0] ?? ri.status}</span>
                          {ri.belge_no && <div className="muted" style={{ fontSize: 12 }}>{ri.belge_no}{ri.amount != null ? ` · ${tl(Number(ri.amount))}` : ""}</div>}
                          <div className="row" style={{ gap: 4, flexWrap: "wrap", marginTop: 4 }}><button className="btn ghost" style={{ fontSize: 12 }} onClick={() => openReturnPdf(r.id)}>İade faturasını aç / PDF</button></div></>
                        : <><div style={{ fontSize: 12, color: "var(--warn)" }}>{r.undelivered ? "Müşteriye ulaşmadı" : "Müşteriye ulaşmadan iptal"}: {days != null && days >= 8 ? `satış faturası ${days} gün önce kesildi, portalda iptal süresi (8 gün) doldu: iade faturası kes` : `satış faturasını portalda iptal et${days != null ? ` (${days} gün önce kesildi, ${8 - days} gün kaldı)` : ""}`}</div>
                          {ri?.error && <div style={{ color: "var(--bad)", fontSize: 12 }}>{ri.error}</div>}
                          <div className="row" style={{ gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                            {days != null && days >= 8 && inv?.belge_no && <button className="btn ghost" style={{ fontSize: 12 }} disabled={!!busy || !canGib} onClick={() => cancelReturnDraft(r)}>İade faturası taslağı oluştur</button>}
                            <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => markReturn(r.id, "iptal")}>İptal ettim</button></div></>)
                    : ri ? <><span className={`pill ${RI[ri.status]?.[1] ?? ""}`}>{RI[ri.status]?.[0] ?? ri.status}</span>
                        {ri.belge_no && <div className="muted" style={{ fontSize: 12 }}>{ri.belge_no}{ri.amount != null ? ` · ${tl(Number(ri.amount))}` : ""}</div>}
                        {ri.error && <div style={{ color: "var(--bad)", fontSize: 12 }}>{ri.error}</div>}
                        <div className="row" style={{ gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                          {["draft", "signed"].includes(ri.status) && <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => openReturnPdf(r.id)}>İade faturasını aç / PDF</button>}
                          {["error", "deleted", "creating"].includes(ri.status) && <button className="btn ghost" style={{ fontSize: 12 }} onClick={async () => { try { await post({ action: "return_reset", id: r.id }); await load(); } catch (e: any) { notify("err", e.message); } }}>Sıfırla, yeniden kes</button>}
                        </div></>
                    : mark ? <><span className="pill ok">{DOC[mark.doc] ?? mark.doc}</span><div><button className="btn ghost" style={{ fontSize: 12 }} onClick={() => markReturn(r.id, null)}>Geri al</button></div></>
                    : <><span className="muted" style={{ fontSize: 12 }}>{dropped ? "Gerekmiyor" : why === null ? "İade faturası kesilecek" : why}</span>
                        {done && !dropped && <div className="row" style={{ gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                          {r.buyer_type && r.buyer_type !== "bireysel" && <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => markReturn(r.id, "musteri_iade")}>Müşterinin iade faturası geldi</button>}
                          <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => markReturn(r.id, "gerekmiyor")}>Belge gerekmiyor</button></div>}</>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>}
        </>; })()}

        {cur === "ret" ? null : rows.length === 0 ? <p className="muted" style={{ padding: "16px 0" }}>{qn ? "Aramayla eşleşen fatura yok." : EMPTY[cur]}</p> : <div className="scroll"><table className="cards">
          <thead><tr>
            {cur === "todo" && <th aria-label="Seç"></th>}
            <th>Sipariş</th><th>Tarih</th><th>Ürünler</th><th className="n">Tutar</th><th>Fatura</th>
          </tr></thead>
          <tbody>{rows.map((r) => {
            const st = IST[r.invoice?.status ?? "none"] ?? [r.invoice?.status, ""];
            return (
              <tr key={r.id}>
                {cur === "todo" && <td><input type="checkbox" aria-label={`${r.order_no} seç`} disabled={!selectable(r)} checked={sel.has(r.id)} onChange={(e) => { const s = new Set(sel); if (e.target.checked) s.add(r.id); else s.delete(r.id); setSel(s); }} /></td>}
                <td data-label="Sipariş">{r.order_no}<br /><span className="muted" style={{ fontSize: 12 }}>{r.marketplace}</span>
                  {r.buyer_type && r.buyer_type !== "bireysel" && <div><span className="pill info" title="Şirket ünvanı, VKN ve vergi dairesiyle kesilir; tutar müşterinin ödediği (pazaryeri indirimi ayrıca yansıtma faturasıyla)">Kurumsal fatura</span></div>}
                  {r.buyer_type === "kurumsal_efatura" && !r.invoice && <div className="muted" style={{ fontSize: 12 }}>Alıcı e-Fatura mükellefi: e-Arşiv değil, GİB e-Fatura portalından e-Fatura kes</div>}</td>
                <td data-label="Tarih">{when(r.ordered_at)}</td>
                <td data-label="Ürünler" style={{ fontSize: 13 }}>{r.items}</td>
                <td data-label="Tutar" className="n" style={{ whiteSpace: "nowrap" }}>{tl(Number(r.invoice?.amount ?? r.total))}</td>
                <td data-label="Fatura"><span className={`pill ${st[1]}`}>{st[0]}</span>
                  {r.invoice?.belge_no && <div className="muted" style={{ fontSize: 12 }}>{r.invoice.belge_no}</div>}
                  {!r.has_customer && !r.invoice && <div className="muted" style={{ fontSize: 12 }}>Alıcı bilgisi silinmiş: portalda elle kes</div>}
                  {r.invoice?.error && <div style={{ color: "var(--bad)", fontSize: 12, display: "flex", gap: 6, alignItems: "flex-start" }}><span style={{ flex: 1 }}>{r.invoice.error}</span>
                    {canDismiss(r) && <button className="btn ghost" style={{ fontSize: 12, padding: "2px 8px", color: "var(--ink)" }} disabled={!!busy} onClick={() => dismiss([r])} title="Uyarıyı kaldır (fatura kaydı, portal ve Trendyol değişmez)" aria-label={`${r.order_no} uyarısını kaldır`}>✓ Düzelttim</button>}</div>}
                  {["signed", "uploaded"].includes(r.invoice?.status) && (r.invoice?.ettn ? <div><button className="btn ghost" style={{ fontSize: 12 }} onClick={() => openPdf(r.id)} title="Yazdır penceresinde 'PDF olarak kaydet' seç">Faturayı aç / PDF</button></div> : <div className="muted" style={{ fontSize: 12 }}>Portalda elle kesildi (PDF portalda)</div>)}
                  {r.invoice?.status === "creating" && <div><button className="btn ghost" style={{ fontSize: 12 }} onClick={() => reset(r.id)}>Takıldı, yeniden dene</button></div>}
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>}
      </div>

      <details className="card">
        <summary>Diğer araçlar ve raporlar</summary>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", margin: "10px 0" }}>
          <button className="btn" disabled={!!busy || !canGib || !canGh} onClick={audit} title="Portalda elle kestiğin faturalarla sistemin faturalarını karşılaştırır">Mükerrer fatura kontrolü</button>
          <button className="btn" disabled={!!busy || !canGib} onClick={sync}>İmzalananları kontrol et</button>
          <button className="btn" disabled={!!busy || !canGib} onClick={logoutGib} title="Portal aynı anda tek oturuma izin veriyor: 'birden fazla kişi giriş yapamaz' diyorsa bas">e-Arşiv oturumunu kapat</button>
          <button className="btn ghost" disabled={!!busy} onClick={load}>Yenile</button>
        </div>
        {d.upload && <div style={{ fontSize: 13, marginTop: 10 }}>
          <b>Son {d.upload.mode === "dry" ? "deneme" : "yükleme"}:</b> <span className="muted">{when(d.upload.at)}{oldTag(d.upload.at)} · toplam {d.upload.total} · uygun {d.upload.ok}{d.upload.mode === "apply" ? ` · yüklendi ${d.upload.uploaded} · zaten vardı ${d.upload.already}` : ""} · atlanan {d.upload.failed}</span>
          {(d.upload.rows ?? []).filter((x: Row) => !x.ok).length > 0 && <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
            {(d.upload.rows ?? []).filter((x: Row) => !x.ok).map((x: Row) => <li key={x.belge_no}>{x.belge_no} / {x.order_no}: <span style={{ color: "var(--bad)" }}>{x.reason}</span></li>)}
          </ul>}
          <div><button className="btn ghost" style={{ fontSize: 12 }} onClick={() => clearReport("upload")}>Raporu kaldır</button></div>
        </div>}
        {d.audit && <div style={{ fontSize: 13, marginTop: 10 }}>
          <b>Mükerrer kontrolü:</b> <span className="muted">{when(d.audit.at)}{oldTag(d.audit.at)} · portalda {d.audit.portalDocs} belge (sistemin {d.audit.ourDocs}, elle {d.audit.foreign}, elle imzalı {d.audit.foreignSigned}) · çift fatura {d.audit.duplicateSigned ?? 0}{d.audit.notes ? ` · kalkan uyarı ${d.audit.notes.cleared} · yeni uyarı ${d.audit.notes.flagged} · iptal ${d.audit.notes.cancelled}${d.audit.notes.portalOk ? "" : " · portal listesi eksikti, uyarılar değiştirilmedi"}` : ""}</span>
          {(d.audit.rows ?? []).filter((x: Row) => x.kind !== "siparişle eşleşmedi").length > 0 && <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
            {(d.audit.rows ?? []).filter((x: Row) => x.kind !== "siparişle eşleşmedi").map((x: Row, i: number) => <li key={i}>Elle: {x.belge_no} ({x.onay}) · sipariş {x.order_no} · sistem: {x.our_belge_no ?? "-"} ({x.our_status ?? "yok"}) · <b style={{ color: /^MÜKERRER/.test(x.kind) ? "var(--bad)" : undefined }}>{x.kind}</b></li>)}
          </ul>}
          {(d.audit.rows ?? []).some((x: Row) => x.kind === "siparişle eşleşmedi") && <div className="muted">Siparişle eşleşmeyen elle belgeler: {(d.audit.rows ?? []).filter((x: Row) => x.kind === "siparişle eşleşmedi").map((x: Row) => x.belge_no).join(", ")}</div>}
          <div><button className="btn ghost" style={{ fontSize: 12 }} onClick={() => clearReport("audit")}>Raporu kaldır</button></div>
        </div>}
        {!d.upload && !d.audit && <p className="muted" style={{ fontSize: 13 }}>Kayıtlı rapor yok.</p>}
      </details>
    </>
  );
}
