import { NextRequest, NextResponse } from "next/server";
import { admin, guard, unauthorized, bad } from "@/lib/server";
import { EarsivClient, isDeleted, isSigned } from "@/lib/earsiv";
import { buildInvoice, trDateTime } from "@/lib/invoice-build";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Sipariş faturaları (GİB e-Arşiv portalı, migration 072). Sistem yalnızca TASLAK oluşturur ve durum okur; imza K'da (portalda toplu, tek SMS).
// GET: faturası kesilmemiş siparişler (son 60 gün, iptal/iade hariç) + fatura durumları.
// POST { action: "draft", order_ids } (en fazla 25, sırayla): taslak oluştur. POST { action: "sync" }: imzalananları işaretle.
// POST { action: "reset", order_id }: hatalı / silinmiş kaydı yeniden denenebilir yap. Alıcı bilgisi loglanmaz.
const OPEN = ["new", "ready", "sent_to_supplier", "shipped", "delivered", "problem"];

export async function GET(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const db = admin();
  const since = new Date(Date.now() - 60 * 86400000).toISOString();
  const [{ data: orders, error }, inv] = await Promise.all([
    db.from("orders").select("id, marketplace, order_no, status, total, ordered_at, customer_name, order_lines(title, qty)").in("status", OPEN).gte("ordered_at", since).order("ordered_at", { ascending: true }).limit(1000),
    db.from("order_invoices").select("order_id, status, ettn, belge_no, amount, error, updated_at"),
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
  return NextResponse.json({ rows, counts, configured: !!(process.env.GIB_PORTAL_USER && process.env.GIB_PORTAL_PASS) });
}

export async function POST(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const b = await req.json().catch(() => ({}));
  const db = admin();
  const now = new Date().toISOString();

  if (b.action === "reset") {
    if (typeof b.order_id !== "string") return bad("order_id gerekli");
    const { error } = await db.from("order_invoices").delete().eq("order_id", b.order_id).in("status", ["error", "deleted"]);
    return error ? bad(error.message) : NextResponse.json({ ok: true });
  }

  const gib = new EarsivClient(process.env.GIB_PORTAL_USER ?? "", process.env.GIB_PORTAL_PASS ?? "", process.env.GIB_PORTAL_ENV === "TEST" ? "TEST" : "PROD");

  // Sistemin portal oturumunu kapat (portal tek oturuma izin veriyor; K giriş yapamıyorsa): giriş + hemen çıkış
  if (b.action === "logout") {
    try {
      await gib.login();
      await gib.logout();
      return NextResponse.json({ ok: true, message: "Sistem e-Arşiv portalından çıkış yaptı. Şimdi portala giriş yapabilirsin." });
    } catch (e: any) {
      const m = String(e?.message ?? e);
      return NextResponse.json({ ok: false, message: /birden|fazla|oturum|aktif/i.test(m)
        ? `Portal açık bir oturum var diyor (${m.slice(0, 120)}). Eski oturum GİB tarafında birkaç dakika içinde kendiliğinden kapanır; 10-15 dk sonra tekrar dene.`
        : `Çıkış yapılamadı: ${m.slice(0, 200)}` });
    }
  }

  if (b.action === "sync") {
    const { data: drafts, error } = await db.from("order_invoices").select("order_id, ettn, created_at").eq("status", "draft").not("ettn", "is", null);
    if (error) return bad(error.message);
    if (!drafts?.length) return NextResponse.json({ signed: 0, deleted: 0, waiting: 0 });
    const from = trDateTime(new Date(Math.min(...drafts.map((d: any) => Date.parse(d.created_at))) - 86400000)).date, to = trDateTime(new Date()).date;
    try {
      await gib.login();
      const docs = new Map((await gib.list(from, to)).map((d) => [d.ettn, d]));
      let signed = 0, deleted = 0, waiting = 0;
      for (const d of drafts as any[]) {
        const doc = docs.get(d.ettn);
        if (doc && isSigned(doc)) { signed++; await db.from("order_invoices").update({ status: "signed", belge_no: doc.belgeNumarasi ?? null, signed_at: now, updated_at: now }).eq("order_id", d.order_id); }
        else if (!doc || isDeleted(doc)) { deleted++; await db.from("order_invoices").update({ status: "deleted", error: doc ? "Taslak portalda silinmiş" : "Taslak portalda bulunamadı", updated_at: now }).eq("order_id", d.order_id); }
        else waiting++;
      }
      return NextResponse.json({ signed, deleted, waiting });
    } catch (e: any) { return bad(String(e?.message ?? e).slice(0, 300)); }
    finally { await gib.logout(); }
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
    await gib.login();
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
  } finally { await gib.logout(); }
  return NextResponse.json({ created: results.filter((r) => r.ok).length, results });
}
