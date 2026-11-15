import { NextRequest, NextResponse } from "next/server";
import { orderDb, guard, unauthorized, bad } from "@/lib/server";
import { EarsivClient, isDeleted, isSigned } from "@/lib/earsiv";
import { buildInvoice, buildReturnInvoice, trDateTime } from "@/lib/invoice-build";
import { matchManualInvoices, docName, docTime } from "@/lib/invoice-match";
import { dispatchWorkflow } from "@/lib/github";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Sipariş faturaları (GİB e-Arşiv portalı, migration 072). Sistem yalnızca TASLAK oluşturur ve durum okur; imza K'da (portalda toplu, tek SMS).
// GET: faturası kesilmemiş siparişler (son 60 gün, iptal/iade hariç) + fatura durumları.
// POST { action: "draft", order_ids } (en fazla 25, sırayla): taslak oluştur. POST { action: "sync" }: imzalananları işaretle.
// POST { action: "html", order_id }: imzalı faturanın görünümü (PDF olarak kaydetmek için).
// POST { action: "upload", mode: "dry" | "apply", count }: Trendyol'a fatura yükleme işini (Actions) başlat; rapor GET.upload'da.
// POST { action: "reset", order_id }: hatalı / silinmiş kaydı yeniden denenebilir yap. Alıcı bilgisi loglanmaz.
const OPEN = ["new", "ready", "sent_to_supplier", "shipped", "delivered", "problem"];

export async function GET(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const db = orderDb();
  const since = new Date(Date.now() - 60 * 86400000).toISOString();
  const [{ data: orders, error }, inv, rep, aud] = await Promise.all([
    db.from("orders").select("id, marketplace, order_no, status, total, ordered_at, customer_name, buyer_type, order_lines(title, qty)").in("status", OPEN).gte("ordered_at", since).order("ordered_at", { ascending: true }).limit(1000),
    db.from("order_invoices").select("order_id, status, ettn, belge_no, amount, error, updated_at"),
    db.from("app_state").select("value").eq("key", "invoice_upload_report").maybeSingle().then((r: any) => r, () => ({ data: null })),
    db.from("app_state").select("value").eq("key", "invoice_audit_report").maybeSingle().then((r: any) => r, () => ({ data: null })),
  ]);
  if (error) return bad(error.message);
  if (inv.error) return bad(/order_invoices/.test(inv.error.message) ? "Supabase migration 072 çalıştırılmamış (SQL Editor)" : inv.error.message);
  const byOrder = new Map((inv.data ?? []).map((r: any) => [r.order_id, r]));
  const rows = (orders ?? []).map((o: any) => {
    const i: any = byOrder.get(o.id);
    return { id: o.id, marketplace: o.marketplace, order_no: o.order_no, status: o.status, total: o.total, ordered_at: o.ordered_at,
      has_customer: !!o.customer_name, buyer_type: o.buyer_type ?? "bireysel", items: (o.order_lines ?? []).map((l: any) => `${l.qty} × ${l.title}`).join(", ").slice(0, 200),
      invoice: i ? { status: i.status, ettn: i.ettn, belge_no: i.belge_no, amount: i.amount, error: i.error, updated_at: i.updated_at } : null };
  });
  const counts = rows.reduce((c: Record<string, number>, r) => { const k = r.invoice?.status ?? "none"; c[k] = (c[k] ?? 0) + 1; return c; }, {});
  let upload: any = null, audit: any = null;
  try { upload = rep?.data?.value ? JSON.parse(rep.data.value) : null; } catch { /* bozuk rapor yok sayılır */ }
  try { audit = aud?.data?.value ? JSON.parse(aud.data.value) : null; } catch { /* bozuk rapor yok sayılır */ }
  // İadeler (K 15.11): Trendyol + Hepsiburada talepleri satır satır (rapor ham talep yazar: orderNo + lines), bağlı satış faturası, iade faturası,
  // iptal edilmiş ama faturası kesilmiş siparişler (müşteriye ulaşmadan iptal: fatura portalda iptal edilir), K'nın işaretleri
  const { rows: flat, at: retAt, marks } = await loadReturns(db);
  const nos = [...new Set(flat.map((c) => c.order_no).filter(Boolean))] as string[];
  const invByNo = new Map<string, any>(), buyerByNo = new Map<string, string>();
  if (nos.length) { const { data } = await db.from("orders").select("order_no, marketplace, buyer_type, order_invoices(status, belge_no, amount, signed_at, created_at)").in("order_no", nos); for (const o of data ?? []) { const k = `${o.marketplace}|${o.order_no}`; if (o.buyer_type) buyerByNo.set(k, o.buyer_type); const i: any = Array.isArray(o.order_invoices) ? o.order_invoices[0] : o.order_invoices; if (i) invByNo.set(k, i); } }
  const retInv = new Map<string, any>();
  if (flat.length) { const { data } = await db.from("order_return_invoices").select("return_key, status, belge_no, ettn, amount, error, created_at, signed_at").in("return_key", flat.map((r) => r.id)); for (const x of data ?? []) retInv.set(x.return_key, x); }
  const { data: cancelledRows } = await db.from("orders").select("id, order_no, marketplace, total, ordered_at, order_invoices!inner(status, belge_no, amount, signed_at, created_at)").eq("status", "cancelled").in("order_invoices.status", ["signed", "uploaded"]);
  const returns = { at: retAt, marks,
    rows: flat.map((c) => ({ ...c, buyer_type: buyerByNo.get(`${c.marketplace}|${c.order_no}`) ?? "bireysel", invoice: invByNo.get(`${c.marketplace}|${c.order_no}`) ?? null, return_invoice: retInv.get(c.id) ?? null })),
    cancelled: (cancelledRows ?? []).map((o: any) => ({ id: `iptal:${o.order_no}`, order_no: o.order_no, marketplace: o.marketplace, at: o.ordered_at, title: "Sipariş iptal, fatura kesilmiş", price: Number(o.total), status: "İptal", reason: "", invoice: Array.isArray(o.order_invoices) ? o.order_invoices[0] : o.order_invoices })) };
  return NextResponse.json({ rows, counts, upload, audit, returns, configured: !!(process.env.GIB_PORTAL_USER && process.env.GIB_PORTAL_PASS), uploadReady: !!(process.env.GH_TOKEN && process.env.GH_REPO) });
}

export async function POST(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const b = await req.json().catch(() => ({}));
  const db = orderDb();
  const now = new Date().toISOString();

  // Eski raporu ekrandan kaldır (yalnızca rapor; fatura kaydına, portala, Trendyol'a dokunmaz)
  if (b.action === "clear_report") {
    const key = b.report === "audit" ? "invoice_audit_report" : b.report === "upload" ? "invoice_upload_report" : null;
    if (!key) return bad("Geçersiz rapor");
    const { error } = await db.from("app_state").delete().eq("key", key);
    return error ? bad(error.message) : NextResponse.json({ ok: true });
  }

  // İade / iptal için K'nın yaptığı işlem kaydı (yalnızca işaret; GİB'e ve Trendyol'a gitmez)
  if (b.action === "mark_return") {
    if (typeof b.id !== "string" || !b.id) return bad("id gerekli");
    const { data: st } = await db.from("app_state").select("value").eq("key", "returns_marks").maybeSingle();
    let m: Record<string, any> = {};
    try { m = st?.value ? JSON.parse(st.value) : {}; } catch { return bad("İşaret kaydı okunamadı"); }
    if (b.doc == null) delete m[b.id];
    else if (["iptal", "gider_pusulasi", "gerekmiyor", "musteri_iade"].includes(b.doc)) m[b.id] = { doc: b.doc, at: now };
    else return bad("Geçersiz işlem");
    const { error } = await db.from("app_state").upsert({ key: "returns_marks", value: JSON.stringify(m), updated_at: now });
    return error ? bad(error.message) : NextResponse.json({ ok: true });
  }

  // Uyarıyı kaldır (K 15.11: "düzelttim" düğmesi). Mükerrer/çift fatura vb. uyarı notu silinir; fatura kaydı, portal ve Trendyol değişmez.
  // Mükerrer işareti yüklemeyi engellediği için kaldırılınca fatura yeniden "Yüklenecek"e düşer. Hata durumundaki (yeniden denenecek) kayıtlar hariç.
  if (b.action === "dismiss_warning") {
    const ids: string[] = [...new Set<string>((Array.isArray(b.order_ids) ? b.order_ids : []).filter((x: unknown) => typeof x === "string"))].slice(0, 500);
    if (!ids.length) return bad("Sipariş seç");
    const { data: rows, error } = await db.from("order_invoices").select("order_id, status, error").in("order_id", ids).not("error", "is", null).not("status", "in", "(error,creating)");
    if (error) return bad(error.message);
    const keys = (rows ?? []).map((r: any) => r.order_id);
    if (!keys.length) return NextResponse.json({ cleared: 0 });
    const { error: ue } = await db.from("order_invoices").update({ error: null, updated_at: now }).in("order_id", keys);
    if (ue) return bad(ue.message);
    await db.from("audit_log").insert({ actor: "panel", action: "dismiss_warning", entity: "order_invoices", entity_id: String(keys.length), before: { rows: (rows ?? []).map((r: any) => ({ order_id: r.order_id, error: String(r.error).slice(0, 200) })) }, after: { error: null } }).then(() => {}, () => {});
    return NextResponse.json({ cleared: keys.length });
  }

  // Mükerrer çözümü (K 15.11): iki imzalı faturadan hangisi iptal edildi?
  //   keep=manual: sistemin faturası iptal, elle kesilen geçerli ve Trendyol'da -> "yüklendi (portal, elle)", belge no mükerrer raporundan, ETTN temizlenir
  //   keep=system: elle kesilen iptal -> uyarı kalkar, sistemin faturası "Yüklenecek"e düşer
  if (b.action === "resolve_duplicate") {
    const ids: string[] = [...new Set<string>((Array.isArray(b.order_ids) ? b.order_ids : []).filter((x: unknown) => typeof x === "string"))].slice(0, 200);
    if (!ids.length || !["manual", "system"].includes(b.keep)) return bad("Sipariş ve seçim gerekli");
    const { data: rows, error } = await db.from("order_invoices").select("order_id, status, belge_no, ettn, error, orders(order_no)").in("order_id", ids).like("error", "MÜKERRER%");
    if (error) return bad(error.message);
    if (!rows?.length) return NextResponse.json({ resolved: 0 });
    let manualOf = new Map<string, string>();
    if (b.keep === "manual") {
      const { data: st } = await db.from("app_state").select("value").eq("key", "invoice_audit_report").maybeSingle();
      let rep: any = null; try { rep = st?.value ? JSON.parse(st.value) : null; } catch { rep = null; }
      const by = new Map<string, Set<string>>();
      for (const x of rep?.rows ?? []) if (x?.order_no && x?.belge_no && /^MÜKERRER/.test(String(x.kind ?? ""))) (by.get(x.order_no) ?? by.set(x.order_no, new Set()).get(x.order_no)!).add(String(x.belge_no));
      manualOf = new Map([...by].map(([k, v]) => [k, [...v].sort().join(" / ")]));
    }
    let resolved = 0;
    for (const r of rows as any[]) {
      const orderNo = r.orders?.order_no ?? "";
      const upd = b.keep === "manual"
        ? { status: "uploaded", belge_no: manualOf.get(orderNo) ?? "elle (portal)", ettn: null, error: null, created_by: "portal (elle)", updated_at: now }
        : { error: null, updated_at: now };
      const { error: ue } = await db.from("order_invoices").update(upd).eq("order_id", r.order_id);
      if (ue) return bad(ue.message);
      await db.from("audit_log").insert({ actor: "panel", action: `resolve_duplicate:${b.keep}`, entity: "order_invoices", entity_id: orderNo, before: { status: r.status, belge_no: r.belge_no, ettn: r.ettn, error: String(r.error).slice(0, 200) }, after: upd }).then(() => {}, () => {});
      resolved++;
    }
    return NextResponse.json({ resolved });
  }

  if (b.action === "reset") {
    if (typeof b.order_id !== "string") return bad("order_id gerekli");
    const { error } = await db.from("order_invoices").delete().eq("order_id", b.order_id).in("status", ["error", "deleted", "creating"]);
    return error ? bad(error.message) : NextResponse.json({ ok: true });
  }

  // Trendyol'a fatura yükleme: GitHub Actions (invoice-upload.yml; PDF için tarayıcı gerekir). dry = deneme, apply = son denemede uygun çıkanlar
  if (b.action === "upload") {
    const mode = b.mode === "apply" ? "apply" : b.mode === "audit" ? "audit" : "dry"; // audit = mükerrer fatura denetimi (salt okunur)
    const count = String(Math.max(1, Math.min(200, Number(b.count) || 200)));
    if (mode === "apply") {
      const { data: st } = await db.from("app_state").select("value").eq("key", "invoice_upload_report").maybeSingle();
      const prev = st?.value ? JSON.parse(st.value) : null;
      if (!prev || prev.mode !== "dry" || Date.now() - Date.parse(prev.at) > 24 * 3600000) return bad("Önce deneme çalıştır (son 24 saatte deneme yok)");
      if (!prev.ok) return bad("Son denemede yüklemeye uygun fatura yok");
    }
    const r = await dispatchWorkflow("invoice-upload.yml", { mode, count });
    if (!r.ok) return bad(r.error ?? "Başlatılamadı");
    return NextResponse.json({ ok: true, mode });
  }

  const gib = new EarsivClient(process.env.GIB_PORTAL_USER ?? "", process.env.GIB_PORTAL_PASS ?? "", process.env.GIB_PORTAL_ENV === "TEST" ? "TEST" : "PROD");
  // Oturum anahtarı app_state'e (migration 073; yoksa sessizce atlanır): giriş sonrası yazılır, çıkış sonrası silinir
  const saveToken = (t: string | null) => db.from("app_state").upsert({ key: "gib_token", value: t, updated_at: new Date().toISOString() }).then(() => null, () => null);
  const login = async () => { await gib.login(); await saveToken(gib.sessionToken); };
  const logout = async () => { await gib.logout(); await saveToken(null); };

  // Sistemin portal oturumunu kapat (portal tek oturuma izin veriyor; K giriş yapamıyorsa): giriş + hemen çıkış
  // İmzalı faturanın GİB görünümü (panelde açılır, K tarayıcıdan PDF kaydeder; dosya adı = alıcı adı). Belge yalnızca isteyen admin'e döner, saklanmaz/loglanmaz.
  // İade faturası (K 15.11): kabul edilmiş iade satırları için e-Arşiv IADE taslağı (imza K'da). Veri istemciden değil rapordan yeniden okunur.
  if (b.action === "return_draft") {
    const ids: string[] = [...new Set<string>((Array.isArray(b.ids) ? b.ids : []).filter((x: unknown) => typeof x === "string"))].slice(0, 20);
    if (!ids.length) return bad("İade seç (en fazla 20)");
    const { rows: flat } = await loadReturns(db);
    const want = flat.filter((r) => ids.includes(r.id));
    const results: { id: string; ok: boolean; error?: string; amount?: number }[] = [];
    const DONE = /accepted|refunded|kabul|iade edildi/i;
    try {
      await login();
      for (const r of want) {
        const fail = async (why: string, mark = true) => { results.push({ id: r.id, ok: false, error: why }); if (mark) await db.from("order_return_invoices").update({ status: "error", error: why.slice(0, 300), updated_at: new Date().toISOString() }).eq("return_key", r.id); };
        if (r.undelivered) { results.push({ id: r.id, ok: false, error: "Müşteriye ulaşmadı (teslim edilemeyen gönderi): iade faturası değil, satış faturasını portalda iptal et" }); continue; }
        if (!DONE.test(r.status)) { results.push({ id: r.id, ok: false, error: "İade henüz kabul edilmedi (pazaryeri kararı bekleniyor)" }); continue; }
        const { data: o } = await db.from("orders").select("id, marketplace, order_no, ordered_at, customer_name, address, city, buyer_type, order_lines(title, qty, unit_price, ty_discount, product_id, listing_key, vat_rate), order_invoices(status, belge_no, signed_at, created_at)").eq("marketplace", r.marketplace).eq("order_no", r.order_no ?? "").maybeSingle();
        if (!o) { results.push({ id: r.id, ok: false, error: "Sipariş kaydı bulunamadı" }); continue; }
        const orig: any = Array.isArray(o.order_invoices) ? o.order_invoices[0] : o.order_invoices;
        if (!orig || !["signed", "uploaded"].includes(orig.status) || !orig.belge_no) { results.push({ id: r.id, ok: false, error: "Siparişin imzalı satış faturası yok: önce satış faturası" }); continue; }
        if (!o.customer_name) { results.push({ id: r.id, ok: false, error: "Alıcı bilgisi silinmiş (30 gün): iade faturasını portalda elle kes" }); continue; }
        // K 15.11: kurumsal müşteri iade faturasını kendisi keser; sistem dokunmaz
        if (o.buyer_type && o.buyer_type !== "bireysel") { results.push({ id: r.id, ok: false, error: "Kurumsal müşteri: iade faturasını müşteri keser, sistem kesmez" }); continue; }
        const ls: any[] = o.order_lines ?? [];
        const line = ls.find((l) => l.listing_key && l.listing_key === r.barcode) ?? (ls.length === 1 ? ls[0] : ls.find((l) => r.title && String(r.title).startsWith(String(l.title ?? "").slice(0, 25))));
        if (!line) { results.push({ id: r.id, ok: false, error: "İade edilen ürün siparişte bulunamadı" }); continue; }
        const lq = Math.max(1, Number(line.qty) || 1), q = Math.min(lq, Math.max(1, Number(r.qty) || 1));
        let vatRate = line.vat_rate != null ? Number(line.vat_rate) : null;
        if (vatRate == null && line.product_id) { const { data: pr } = await db.from("products").select("vat_rate").eq("id", line.product_id).maybeSingle(); vatRate = pr?.vat_rate != null ? Number(pr.vat_rate) : null; }
        const claim = await db.from("order_return_invoices").insert({ return_key: r.id, order_id: o.id, order_no: o.order_no, marketplace: o.marketplace, status: "creating", original_belge_no: orig.belge_no, created_by: "panel", updated_at: now });
        if (claim.error) { results.push({ id: r.id, ok: false, error: claim.error.code === "23505" ? "Bu iade için zaten iade faturası var" : claim.error.message }); continue; }
        try {
          const inv = buildReturnInvoice({ ...o, lines: [{ title: line.title, qty: q, unit_price: Number(line.unit_price), ty_discount: (Number(line.ty_discount) || 0) * q / lq, vat_rate: vatRate ?? 20 }] } as any,
            { belge_no: orig.belge_no, date: new Date(orig.signed_at ?? orig.created_at ?? o.ordered_at ?? Date.now()) });
          const { _ozet, _iade, ...payload } = inv as any;
          const doc = await gib.createDraft(payload);
          await db.from("order_return_invoices").update({ status: "draft", ettn: doc.ettn, belge_no: doc.belgeNumarasi ?? null, amount: _ozet.total, vat: _ozet.kdv, lines: [{ title: line.title, qty: q }], error: null, updated_at: new Date().toISOString() }).eq("return_key", r.id);
          results.push({ id: r.id, ok: true, amount: _ozet.total });
        } catch (e: any) { await fail(String(e?.message ?? e).slice(0, 300)); }
      }
    } catch (e: any) { return bad(String(e?.message ?? e).slice(0, 300)); }
    finally { await logout(); }
    return NextResponse.json({ created: results.filter((x) => x.ok).length, results });
  }
  if (b.action === "return_reset") {
    if (typeof b.id !== "string") return bad("id gerekli");
    const { error } = await db.from("order_return_invoices").delete().eq("return_key", b.id).in("status", ["error", "deleted", "creating"]);
    return error ? bad(error.message) : NextResponse.json({ ok: true });
  }
  if (b.action === "return_html") {
    if (typeof b.id !== "string") return bad("id gerekli");
    const { data: row } = await db.from("order_return_invoices").select("ettn, status, belge_no").eq("return_key", b.id).maybeSingle();
    if (!row?.ettn || !["draft", "signed"].includes(row.status)) return bad("Bu iadenin iade faturası yok");
    try { await login(); const html = await gib.invoiceHtml(row.ettn, row.status === "signed"); return NextResponse.json({ html, name: `iade ${row.belge_no ?? ""}`.trim(), belge_no: row.belge_no }); }
    catch (e: any) { return bad(String(e?.message ?? e).slice(0, 300)); }
    finally { await logout(); }
  }

  if (b.action === "html") {
    if (typeof b.order_id !== "string") return bad("order_id gerekli");
    const { data: row } = await db.from("order_invoices").select("ettn, status, belge_no, orders(customer_name, order_no)").eq("order_id", b.order_id).maybeSingle();
    if (!row?.ettn || !["signed", "uploaded"].includes(row.status)) return bad("Bu siparişin imzalı faturası yok");
    try {
      await login();
      const html = await gib.invoiceHtml(row.ettn, true);
      const o: any = row.orders;
      const name = String(o?.customer_name ?? row.belge_no ?? "fatura").normalize("NFC").replace(/[İIı]/g, "i").replace(/[Şş]/g, "s").replace(/[Ğğ]/g, "g").replace(/[Üü]/g, "u").replace(/[Öö]/g, "o").replace(/[Çç]/g, "c")
        .toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim() || String(row.belge_no ?? "fatura");
      return NextResponse.json({ html, name, belge_no: row.belge_no });
    } catch (e: any) { return bad(String(e?.message ?? e).slice(0, 300)); }
    finally { await logout(); }
  }

  if (b.action === "logout") {
    // Önce saklı oturum anahtarıyla çıkış (yarıda kalan oturum), sonra giriş + çıkış
    const { data: st } = await db.from("app_state").select("value").eq("key", "gib_token").maybeSingle().then((r: any) => r, () => ({ data: null }));
    if (st?.value) { gib.useToken(st.value); await logout(); }
    try {
      await login();
      await logout();
      return NextResponse.json({ ok: true, message: "Sistem e-Arşiv portalından çıkış yaptı. Şimdi portala giriş yapabilirsin." });
    } catch (e: any) {
      const m = String(e?.message ?? e);
      return NextResponse.json({ ok: false, message: /birden|fazla|oturum|aktif/i.test(m)
        ? `Portal açık bir oturum var diyor (${m.slice(0, 120)}). Eski oturum GİB tarafında birkaç dakika içinde kendiliğinden kapanır; 10-15 dk sonra tekrar dene.`
        : `Çıkış yapılamadı: ${m.slice(0, 200)}` });
    }
  }

  // Portal listesi GÜN GÜN (30.10: 60 günlük aralık boş döndü, 84 taslak yanlışlıkla "silindi" sayıldı). Günler: son 14 gün + kayıtların oluşturulduğu günler.
  const listDays = async (extra: (string | null | undefined)[]) => {
    const days = new Set<string>();
    for (let i = 0; i < 14; i++) days.add(trDateTime(new Date(Date.now() - i * 86400000)).date);
    for (const t of extra) if (t && Date.now() - Date.parse(t) < 60 * 86400000) days.add(trDateTime(new Date(t)).date);
    const out = new Map<string, any>();
    for (const day of days) for (const d of await gib.list(day, day)) if (d.ettn) out.set(d.ettn, d);
    return [...out.values()];
  };

  if (b.action === "sync") {
    // Sistemin taslakları + portalda elle kesilenler: elle kesilen imzalı belge, alıcı adıyla tek faturasız siparişe bağlanır
    const { data: all, error } = await db.from("order_invoices").select("order_id, ettn, status, created_at");
    if (error) return bad(error.message);
    const drafts = (all ?? []).filter((d: any) => d.status === "draft" && d.ettn);
    const { data: retAll } = await db.from("order_return_invoices").select("return_key, ettn, status, created_at");
    const retDrafts = (retAll ?? []).filter((d: any) => d.status === "draft" && d.ettn);
    try {
      await login();
      const list = await listDays([...drafts, ...retDrafts].map((d: any) => d.created_at));
      const docs = new Map(list.map((d) => [d.ettn, d]));
      let signed = 0, deleted = 0, waiting = 0, missing = 0;
      const gone = new Set<string>(); // taslağı silinen siparişler: elle kesilen fatura bunlara bağlanabilir
      for (const d of drafts as any[]) {
        const doc = docs.get(d.ettn);
        if (doc && isSigned(doc)) { signed++; await db.from("order_invoices").update({ status: "signed", belge_no: doc.belgeNumarasi ?? null, signed_at: now, updated_at: now }).eq("order_id", d.order_id); }
        // Yalnızca portal "silinmiş" derse silindi; listede yoksa dokunma (liste eksik dönebilir)
        else if (doc && isDeleted(doc)) { deleted++; gone.add(d.order_id); await db.from("order_invoices").update({ status: "deleted", error: "Taslak portalda silinmiş", updated_at: now }).eq("order_id", d.order_id); }
        else if (!doc) missing++;
        else waiting++;
      }
      // Mükerrer: bizim imzalanmamış taslağımızın siparişi için portalda (bizim olmayan) imzalı ya da elle oluşturulmuş taslak var (aynı alıcı, sipariş sonrası tarih)
      // İade faturaları (IADE) da bizim: imzalandıysa durum güncellenir; mükerrer aramasında "elle kesilmiş" sayılmaz
      let retSigned = 0;
      for (const d of retDrafts as any[]) {
        const doc = docs.get(d.ettn);
        if (doc && isSigned(doc)) { retSigned++; await db.from("order_return_invoices").update({ status: "signed", belge_no: doc.belgeNumarasi ?? null, signed_at: now, updated_at: now }).eq("return_key", d.return_key); }
        else if (doc && isDeleted(doc)) await db.from("order_return_invoices").update({ status: "deleted", error: "Taslak portalda silinmiş", updated_at: now }).eq("return_key", d.return_key);
      }
      const ours = new Set([...(all ?? []), ...(retAll ?? [])].map((d: any) => d.ettn).filter(Boolean));
      const manual = list.filter((d) => !ours.has(d.ettn) && !isDeleted(d));
      const waitingRows = (drafts as any[]).filter((d) => { const doc = docs.get(d.ettn); return doc && !isSigned(doc) && !isDeleted(doc); });
      let duplicate = 0;
      if (waitingRows.length && manual.length) {
        const { data: od } = await db.from("orders").select("id, customer_name, ordered_at").in("id", waitingRows.map((d) => d.order_id));
        const norm = (x: unknown) => String(x ?? "").toLocaleUpperCase("tr").replace(/[^A-ZÇĞİÖŞÜ]/g, "");
        for (const o of od ?? []) {
          const n = norm(o.customer_name);
          const hits = n.length >= 4 ? manual.filter((d) => norm(docName(d)) === n && (docTime(d) ?? Infinity) >= Date.parse(o.ordered_at ?? "") - 86400000) : [];
          const hit = hits.find(isSigned) ?? hits[0];
          if (hit) {
            duplicate++;
            const msg = isSigned(hit) ? `MÜKERRER: portalda bu sipariş için imzalı fatura var (${hit.belgeNumarasi ?? hit.ettn}); taslağı imzalama, sil`
              : `MÜKERRER: portalda bu sipariş için elle oluşturulmuş taslak var (${hit.belgeNumarasi ?? hit.ettn}); ikisinden yalnızca birini imzala`;
            await db.from("order_invoices").update({ error: msg, updated_at: now }).eq("order_id", o.id);
          }
        }
      }
      // Elle kesilenler: faturası olmayan açık siparişlerle ad + tarih eşleşmesi
      // Faturası olan siparişler (hatalı / silinmiş taslak sayılmaz: 30.10 K aynı siparişi elle kesip bizim taslağı sildi)
      const has = new Set((all ?? []).filter((d: any) => !["deleted", "error"].includes(d.status) && !gone.has(d.order_id)).map((d: any) => d.order_id));
      const { data: cand } = await db.from("orders").select("id, customer_name, ordered_at").in("status", OPEN).not("customer_name", "is", null)
        .gte("ordered_at", new Date(Date.now() - 60 * 86400000).toISOString());
      const m = matchManualInvoices(list, (cand ?? []).filter((o: any) => !has.has(o.id)), new Set((all ?? []).map((d: any) => d.ettn).filter(Boolean)));
      for (const l of m.links) await db.from("order_invoices").upsert({ order_id: l.order_id, status: "signed", ettn: l.ettn, belge_no: l.belge_no, error: null, created_by: "portal (elle)", signed_at: now, updated_at: now }, { onConflict: "order_id" });
      return NextResponse.json({ signed, deleted, waiting, missing, duplicate, returnSigned: retSigned, manual: m.links.length, manualAmbiguous: m.ambiguous, manualUnmatched: m.unmatched });
    } catch (e: any) { return bad(String(e?.message ?? e).slice(0, 300)); }
    finally { await logout(); }
  }

  // Mükerrer taslakları sil (yalnızca imzalanmamış ve "MÜKERRER" işaretli; K onayıyla). Sonraki kontrol elle kesileni siparişe bağlar.
  if (b.action === "delete_duplicates") {
    const { data: rows, error } = await db.from("order_invoices").select("order_id, ettn, created_at").eq("status", "draft").like("error", "MÜKERRER%");
    if (error) return bad(error.message);
    if (!rows?.length) return NextResponse.json({ deleted: 0 });
    try {
      await login();
      const docs = new Map((await listDays(rows.map((r: any) => r.created_at))).map((d) => [d.ettn, d]));
      let deleted = 0;
      for (const r of rows as any[]) {
        const doc = docs.get(r.ettn);
        if (!doc || isSigned(doc)) continue; // imzalanmış ya da yok: dokunma
        await gib.deleteDrafts([doc], "Mükerrer taslak (sipariş için fatura elle kesilmiş)");
        await db.from("order_invoices").update({ status: "deleted", error: "Mükerrer taslak silindi", updated_at: new Date().toISOString() }).eq("order_id", r.order_id);
        deleted++;
      }
      return NextResponse.json({ deleted });
    } catch (e: any) { return bad(String(e?.message ?? e).slice(0, 300)); }
    finally { await logout(); }
  }

  if (b.action !== "draft") return bad("Geçersiz işlem");
  const ids: string[] = [...new Set<string>((Array.isArray(b.order_ids) ? b.order_ids : []).filter((x: unknown) => typeof x === "string"))].slice(0, 25);
  if (!ids.length) return bad("Sipariş seç (en fazla 25)");
  // order_lines.vat_rate (migration 077) yoksa kolonsuz okunur (sunucu ürünlerinde KDV bilinmez -> o siparişler kesilmez)
  const ORDER_COLS = "id, marketplace, order_no, status, ordered_at, customer_name, address, city, buyer_type, order_lines(title, qty, unit_price, ty_discount, product_id, listing_key, supplier_sku";
  let r0: { data: any[] | null; error: any } = await db.from("orders").select(`${ORDER_COLS}, vat_rate)`).in("id", ids);
  if (r0.error && /vat_rate/.test(r0.error.message)) r0 = await db.from("orders").select(`${ORDER_COLS})`).in("id", ids);
  const { data: orders, error } = r0;
  if (error) return bad(error.message);
  const pids = [...new Set((orders ?? []).flatMap((o: any) => (o.order_lines ?? []).map((l: any) => l.product_id)).filter(Boolean))];
  const vat = new Map<string, number>();
  const ptitle = new Map<string, string>(), ltitle = new Map<string, string>();
  if (pids.length) { const { data } = await db.from("products").select("id, vat_rate, title").in("id", pids); for (const p of data ?? []) { vat.set(p.id, Number(p.vat_rate ?? 20)); if (p.title) ptitle.set(p.id, p.title); } }
  // Faturadaki ürün adı: kayıtlı ilan başlığı (Trendyol satır adındaki model kodu / beden eki atılır, invoiceItemName)
  const keys = [...new Set((orders ?? []).flatMap((o: any) => (o.order_lines ?? []).map((l: any) => l.listing_key)).filter(Boolean))];
  if (keys.length) { const { data } = await db.from("marketplace_listings").select("marketplace, listing_key, title").in("listing_key", keys); for (const x of data ?? []) if (x.title) ltitle.set(`${x.marketplace}|${x.listing_key}`, x.title); }

  const results: { order_id: string; order_no: string | null; ok: boolean; error?: string; amount?: number }[] = [];
  try {
    await login();
    for (const o of (orders ?? []) as any[]) {
      if (!OPEN.includes(o.status)) { results.push({ order_id: o.id, order_no: o.order_no, ok: false, error: "Sipariş iptal/iade: fatura kesilmez" }); continue; }
      if (!o.customer_name) { results.push({ order_id: o.id, order_no: o.order_no, ok: false, error: "Alıcı bilgisi yok (30 gün sonra silinir): portalda elle kes" }); continue; }
      // Kurumsal (Trendyol rehberi madde 3): alıcı e-Fatura mükellefiyse e-Arşiv geçersiz; durum bilinmiyorsa (HB) otomatik kesilmez
      const corp = o.address?.invoice;
      const corpWhy = o.buyer_type && o.buyer_type !== "bireysel" && !corp?.taxNumber ? "Kurumsal sipariş ama ünvan/VKN bilgisi yok: pazaryeri panelinden bakıp elle kes"
        : corp?.eInvoice === true ? `Alıcı e-Fatura mükellefi (${corp.company}): e-Arşiv geçersiz, GİB e-Fatura portalından e-Fatura kes`
        : corp && corp.eInvoice == null ? `Kurumsal alıcının e-Fatura durumu bilinmiyor (${corp.company}): GİB'den sorgulayıp elle kes` : null;
      if (corpWhy) { results.push({ order_id: o.id, order_no: o.order_no, ok: false, error: corpWhy }); continue; }
      // Kilit: aynı sipariş için ikinci taslak açılmasın (birincil anahtar). Hatalı/silinmiş kayıt "reset" ile açılır.
      const claim = await db.from("order_invoices").insert({ order_id: o.id, status: "creating", created_by: "panel", updated_at: now });
      if (claim.error) { results.push({ order_id: o.id, order_no: o.order_no, ok: false, error: claim.error.code === "23505" ? "Bu sipariş için zaten taslak/fatura var" : claim.error.message }); continue; }
      // KDV oranı: satırdaki (sunucu ürünleri, migration 077) > ürün kaydı > %20. Sunucu tedarikçisi ürününde oran bilinmiyorsa kesilmez (04.11: %10'luk ürün %20 kesilecekti)
      const lineVat = (l: any) => (l.vat_rate != null ? Number(l.vat_rate) : vat.get(l.product_id) ?? null);
      if ((o.order_lines ?? []).some((l: any) => lineVat(l) == null && /^(BZS|HBY)/.test(String(l.supplier_sku ?? "")))) {
        const why = "KDV oranı henüz bilinmiyor (Bezos/Hepsibayi ürünü): birkaç dakika sonra tekrar dene";
        await db.from("order_invoices").update({ status: "error", error: why, updated_at: new Date().toISOString() }).eq("order_id", o.id);
        results.push({ order_id: o.id, order_no: o.order_no, ok: false, error: why });
        continue;
      }
      try {
        const inv = buildInvoice({ ...o, lines: (o.order_lines ?? []).map((l: any) => ({ ...l, vat_rate: lineVat(l) ?? 20, known: [ltitle.get(`${o.marketplace}|${l.listing_key}`), ptitle.get(l.product_id)] })) });
        const { _ozet, ...payload } = inv;
        const doc = await gib.createDraft(payload);
        await db.from("order_invoices").update({ status: "draft", ettn: doc.ettn, belge_no: doc.belgeNumarasi ?? null, amount: _ozet.total, vat: _ozet.kdv, error: null, updated_at: new Date().toISOString() }).eq("order_id", o.id);
        results.push({ order_id: o.id, order_no: o.order_no, ok: true, amount: _ozet.total });
      } catch (e: any) {
        const msg = String(e?.message ?? e).slice(0, 300);
        await db.from("order_invoices").update({ status: "error", error: msg, updated_at: new Date().toISOString() }).eq("order_id", o.id);
        results.push({ order_id: o.id, order_no: o.order_no, ok: false, error: msg });
      }
    }
  } catch (e: any) {
    return bad(String(e?.message ?? e).slice(0, 300));
  } finally { await logout(); }
  return NextResponse.json({ created: results.filter((r) => r.ok).length, results });
}

// İade raporlarını (worker/sync.ts ordersPart: app_state returns_report:<mp>, ham talep) satır satır düzleştirir. Satır kimliği: <mp>:<talep>:<satır sırası>
async function loadReturns(db: any): Promise<{ rows: any[]; at: string | null; marks: Record<string, any> }> {
  const keys = ["returns_report:trendyol", "returns_report:hepsiburada", "returns_marks"];
  const st = await db.from("app_state").select("key, value").in("key", keys).then((r: any) => r.data ?? [], () => []);
  const of = (k: string) => { try { const v = st.find((x: any) => x.key === k)?.value; return v ? JSON.parse(v) : null; } catch { return null; } };
  const rows: any[] = []; let at: string | null = null;
  for (const mp of ["trendyol", "hepsiburada"]) {
    const rep = of(`returns_report:${mp}`);
    if (rep?.at && (!at || rep.at > at)) at = rep.at;
    for (const c of rep?.rows ?? []) {
      const lines: any[] = Array.isArray(c.lines) && c.lines.length ? c.lines : [{ key: "", title: "", qty: 1, price: c.amount, status: c.status, reason: c.reason }];
      lines.forEach((l, i) => rows.push({ id: `${mp}:${c.id}:${i}`, marketplace: mp, order_no: c.orderNo ? String(c.orderNo) : null, at: c.claimedAt ? new Date(Number(c.claimedAt)).toISOString() : null,
        title: String(l.title ?? ""), qty: Math.max(1, Number(l.qty) || 1), price: Number(l.price) || 0, barcode: String(l.key ?? ""), status: String(l.status || c.status || ""), reason: String(l.reason ?? c.reason ?? ""),
        // Müşteriye hiç ulaşmadı (teslim edilemeyen gönderi): iade faturası değil, satış faturası iptal edilir (K 15.11)
        undelivered: /UNDELIVERED|teslim edilemey|ulaşmad/i.test(`${c.reasonCode ?? ""} ${l.reason ?? c.reason ?? ""}`) }));
    }
  }
  rows.sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
  return { rows, at, marks: of("returns_marks") ?? {} };
}
