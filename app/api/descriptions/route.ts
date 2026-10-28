import { NextRequest, NextResponse } from "next/server";
import { admin, requireRole, forbidden, bad } from "@/lib/server";
import { checkDescription } from "@/worker/core/desc-check";

export const dynamic = "force-dynamic";

// Yapay zekâ açıklamaları (migration 067): liste + sayılar, onayla / reddet / yeniden aç / düzenle.
// Onaylanan açıklama yeni gönderimlerde kullanılır ve canlı Trendyol ilanına senkronla gider (pazaryerine yazdığı için yönetici).
const STATUSES = ["ready", "approved", "rejected", "skipped"];
const missing = (m: string) => /product_descriptions|desc_counts/.test(m);

export async function GET(req: NextRequest) {
  if (!(await requireRole(req, "editor"))) return forbidden("editor");
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") ?? "ready";
  if (!STATUSES.includes(status)) return bad("Geçersiz filtre");
  const page = Math.max(0, Math.min(500, Number(sp.get("page") ?? 0) || 0));
  const db = admin();
  const [cnt, ls] = await Promise.all([
    db.rpc("desc_counts"),
    db.from("product_descriptions").select("product_id, status, draft, original, reason, checks, model, pushed, updated_at, decided_by, products(title, sku, source)")
      .eq("status", status).order("updated_at", { ascending: false }).range(page * 25, page * 25 + 24),
  ]);
  if (cnt.error) return missing(cnt.error.message) ? NextResponse.json({ missing: true }) : bad(cnt.error.message);
  if (ls.error) return bad(ls.error.message);
  return NextResponse.json({ counts: cnt.data ?? {}, items: ls.data ?? [], page });
}

// { action: "approve" | "reject" | "reopen", ids } · { action: "approve_all_ready", expect } · { action: "edit", id, draft }
export async function PUT(req: NextRequest) {
  const a = await requireRole(req, "admin");
  if (!a) return forbidden("admin");
  const b = await req.json().catch(() => ({}));
  const db = admin();
  const now = new Date().toISOString();
  const ids: string[] = Array.isArray(b.ids) ? b.ids.filter((x: unknown) => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 500) : [];
  if (b.action === "approve" || b.action === "reject" || b.action === "reopen") {
    if (!ids.length) return bad("Seçili ürün yok");
    const to = b.action === "approve" ? "approved" : b.action === "reject" ? "rejected" : "ready";
    const from = b.action === "reopen" ? ["approved", "rejected"] : ["ready", ...(b.action === "reject" ? ["approved"] : [])];
    // Yeniden açılan / reddedilen onaylı açıklama: pazaryerine gönderildiyse ilanda kalır (eski metni geri göndermek ayrı iş)
    const { data, error } = await db.from("product_descriptions").update({ status: to, decided_by: a.email, decided_at: now, updated_at: now, ...(to === "approved" ? { pushed: {} } : {}) })
      .in("product_id", ids).in("status", from).not("draft", "is", null).select("product_id");
    if (error) return bad(error.message);
    return NextResponse.json({ ok: true, changed: data?.length ?? 0 });
  }
  if (b.action === "approve_all_ready") {
    // Ekrandaki sayıyla karşılaştırılır: arada yeni taslak geldiyse kullanıcı görmeden onaylanmasın
    const { count } = await db.from("product_descriptions").select("product_id", { count: "exact", head: true }).eq("status", "ready");
    if (Number(b.expect) !== count) return bad(`Bekleyen taslak sayısı değişti (${count}); listeyi yenileyip tekrar dene`);
    const { data, error } = await db.from("product_descriptions").update({ status: "approved", decided_by: a.email, decided_at: now, updated_at: now, pushed: {} }).eq("status", "ready").not("draft", "is", null).select("product_id");
    if (error) return bad(error.message);
    return NextResponse.json({ ok: true, changed: data?.length ?? 0 });
  }
  if (b.action === "edit") {
    const id = String(b.id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return bad("Geçersiz ürün");
    const draft = String(b.draft ?? "").trim().slice(0, 20000);
    const { data: row } = await db.from("product_descriptions").select("original, status, products(title, attributes, brand)").eq("product_id", id).maybeSingle();
    if (!row) return bad("Taslak bulunamadı");
    // Elle düzenleme de aynı kurallardan geçer (kaynakta olmayan sayı / iddia / iletişim / izinsiz HTML yazılamaz)
    const p: any = Array.isArray(row.products) ? row.products[0] : row.products;
    const chk = checkDescription(draft, { title: p?.title ?? "", description: row.original ?? "", attributes: p?.attributes ?? null, brand: p?.brand ?? null });
    if (!chk.ok) return bad(`Kaydedilmedi: ${chk.reasons.join("; ")}`);
    const { error } = await db.from("product_descriptions").update({ draft: chk.html, status: "ready", reason: null, decided_by: a.email, updated_at: now, pushed: {} }).eq("product_id", id);
    return error ? bad(error.message) : NextResponse.json({ ok: true });
  }
  return bad("Geçersiz işlem");
}
