import { NextRequest, NextResponse } from "next/server";
import { admin, guard, unauthorized, bad } from "@/lib/server";
import { EarsivClient, isDeleted, isSigned } from "@/lib/earsiv";
import { buildInvoice, trDateTime } from "@/lib/invoice-build";
import { matchManualInvoices, docName, docTime } from "@/lib/invoice-match";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Sipariş faturaları (GİB e-Arşiv portalı, migration 072). Sistem yalnızca TASLAK oluşturur ve durum okur; imza K'da (portalda toplu, tek SMS).
// GET: faturası kesilmemiş siparişler (son 60 gün, iptal/iade hariç) + fatura durumları.
// POST { action: "draft", order_ids } (en fazla 25, sırayla): taslak oluştur. POST { action: "sync" }: imzalananları işaretle.
// POST { action: "upload", mode: "dry" | "apply", count }: Trendyol'a fatura yükleme işini (Actions) başlat; rapor GET.upload'da.
// POST { action: "reset", order_id }: hatalı / silinmiş kaydı yeniden denenebilir yap. Alıcı bilgisi loglanmaz.
const OPEN = ["new", "ready", "sent_to_supplier", "shipped", "delivered", "problem"];

export async function GET(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const db = admin();
  const since = new Date(Date.now() - 60 * 86400000).toISOString();
  const [{ data: orders, error }, inv, rep] = await Promise.all([
    db.from("orders").select("id, marketplace, order_no, status, total, ordered_at, customer_name, order_lines(title, qty)").in("status", OPEN).gte("ordered_at", since).order("ordered_at", { ascending: true }).limit(1000),
    db.from("order_invoices").select("order_id, status, ettn, belge_no, amount, error, updated_at"),
    db.from("app_state").select("value").eq("key", "invoice_upload_report").maybeSingle().then((r: any) => r, () => ({ data: null })),
  ]);
  if (error) return bad(error.message);
  if (inv.error) return bad(/order_invoices/.test(inv.error.message) ? "Supabase migration 072 çalıştırılmamış (SQL Editor)" : inv.error.message);
  const byOrder = new Map((inv.data ?? []).map((r: any) => [r.order_id, r]));
  const rows = (orders ?? []).map((o: any) => {
    const i: any = byOrder.get(o.id);
    return { id: o.id, marketplace: o.marketplace, order_no: o.order_no, status: o.status, total: o.total, ordered_at: o.ordered_at,
      has_customer: !!o.customer_name, items: (o.order_lines ?? []).map((l: any) => `${l.qty} × ${l.title}`).join(", ").slice(0, 200),
      invoice: i ? { status: i.status, ettn: i.ettn, belge_no: i.belge_no, amount: i.amount, error: i.error, updated_at: i.updated_at } : null };
  });
  const counts = rows.reduce((c: Record<string, number>, r) => { const k = r.invoice?.status ?? "none"; c[k] = (c[k] ?? 0) + 1; return c; }, {});
  let upload: any = null;
  try { upload = rep?.data?.value ? JSON.parse(rep.data.value) : null; } catch { /* bozuk rapor yok sayılır */ }
  return NextResponse.json({ rows, counts, upload, configured: !!(process.env.GIB_PORTAL_USER && process.env.GIB_PORTAL_PASS) });
}

export async function POST(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const b = await req.json().catch(() => ({}));
  const db = admin();
  const now = new Date().toISOString();

  if (b.action === "reset") {
    if (typeof b.order_id !== "string") return bad("order_id gerekli");
    const { error } = await db.from("order_invoices").delete().eq("order_id", b.order_id).in("status", ["error", "deleted", "creating"]);
    return error ? bad(error.message) : NextResponse.json({ ok: true });
  }

  // Trendyol'a fatura yükleme: GitHub Actions (invoice-upload.yml; PDF için tarayıcı gerekir). dry = deneme, apply = son denemede uygun çıkanlar
  if (b.action === "upload") {
    const mode = b.mode === "apply" ? "apply" : "dry";
    const count = String(Math.max(1, Math.min(200, Number(b.count) || 200)));
    if (mode === "apply") {
      const { data: st } = await db.from("app_state").select("value").eq("key", "invoice_upload_report").maybeSingle();
      const prev = st?.value ? JSON.parse(st.value) : null;
      if (!prev || prev.mode !== "dry" || Date.now() - Date.parse(prev.at) > 24 * 3600000) return bad("Önce deneme çalıştır (son 24 saatte deneme yok)");
      if (!prev.ok) return bad("Son denemede yüklemeye uygun fatura yok");
    }
    if (!process.env.GH_TOKEN || !process.env.GH_REPO) return bad("GH_TOKEN veya GH_REPO ayarlı değil");
    const res = await fetch(`https://api.github.com/repos/${process.env.GH_REPO}/actions/workflows/invoice-upload.yml/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      body: JSON.stringify({ ref: "main", inputs: { mode, count } }),
    });
    if (res.status !== 204) return bad(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return NextResponse.json({ ok: true, mode });
  }

  const gib = new EarsivClient(process.env.GIB_PORTAL_USER ?? "", process.env.GIB_PORTAL_PASS ?? "", process.env.GIB_PORTAL_ENV === "TEST" ? "TEST" : "PROD");
  // Oturum anahtarı app_state'e (migration 073; yoksa sessizce atlanır): giriş sonrası yazılır, çıkış sonrası silinir
  const saveToken = (t: string | null) => db.from("app_state").upsert({ key: "gib_token", value: t, updated_at: new Date().toISOString() }).then(() => null, () => null);
  const login = async () => { await gib.login(); await saveToken(gib.sessionToken); };
  const logout = async () => { await gib.logout(); await saveToken(null); };

  // Sistemin portal oturumunu kapat (portal tek oturuma izin veriyor; K giriş yapamıyorsa): giriş + hemen çıkış
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
    try {
      await login();
      const list = await listDays(drafts.map((d: any) => d.created_at));
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
      const ours = new Set((all ?? []).map((d: any) => d.ettn).filter(Boolean));
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
      return NextResponse.json({ signed, deleted, waiting, missing, duplicate, manual: m.links.length, manualAmbiguous: m.ambiguous, manualUnmatched: m.unmatched });
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
  const { data: orders, error } = await db.from("orders").select("id, order_no, status, ordered_at, customer_name, address, city, order_lines(title, qty, unit_price, ty_discount, product_id)").in("id", ids);
  if (error) return bad(error.message);
  const pids = [...new Set((orders ?? []).flatMap((o: any) => (o.order_lines ?? []).map((l: any) => l.product_id)).filter(Boolean))];
  const vat = new Map<string, number>();
  if (pids.length) { const { data } = await db.from("products").select("id, vat_rate").in("id", pids); for (const p of data ?? []) vat.set(p.id, Number(p.vat_rate ?? 20)); }

  const results: { order_id: string; order_no: string | null; ok: boolean; error?: string; amount?: number }[] = [];
  try {
    await login();
    for (const o of (orders ?? []) as any[]) {
      if (!OPEN.includes(o.status)) { results.push({ order_id: o.id, order_no: o.order_no, ok: false, error: "Sipariş iptal/iade: fatura kesilmez" }); continue; }
      if (!o.customer_name) { results.push({ order_id: o.id, order_no: o.order_no, ok: false, error: "Alıcı bilgisi yok (30 gün sonra silinir): portalda elle kes" }); continue; }
      // Kilit: aynı sipariş için ikinci taslak açılmasın (birincil anahtar). Hatalı/silinmiş kayıt "reset" ile açılır.
      const claim = await db.from("order_invoices").insert({ order_id: o.id, status: "creating", created_by: "panel", updated_at: now });
      if (claim.error) { results.push({ order_id: o.id, order_no: o.order_no, ok: false, error: claim.error.code === "23505" ? "Bu sipariş için zaten taslak/fatura var" : claim.error.message }); continue; }
      try {
        const inv = buildInvoice({ ...o, lines: (o.order_lines ?? []).map((l: any) => ({ ...l, vat_rate: vat.get(l.product_id) ?? 20 })) });
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
