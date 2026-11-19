import { NextRequest, NextResponse } from "next/server";
import { admin, requireRole, forbidden, bad } from "@/lib/server";
import { checkDescription } from "@/worker/core/desc-check";

export const dynamic = "force-dynamic";

// Yapay zekâ açıklamaları (migration 067): liste + sayılar, onayla / reddet / yeniden aç / düzenle.
// Onaylanan açıklama yeni gönderimlerde kullanılır ve canlı Trendyol ilanına senkronla gider (pazaryerine yazdığı için yönetici).
const STATUSES = ["ready", "approved", "rejected", "skipped"];
const missing = (m: string) => /product_descriptions|desc_counts/.test(m);

// desc_counts 128 bin ürünü tarar (5-11 sn). Durum sayıları ayrı ve hızlı alınır; yavaş iki sayı (uygun ürün, başlık kopyası) arka planda hesaplanıp 10 dk saklanır, ekranı bekletmez.
let slow: { at: number; v: Record<string, number> } | null = null;
let slowRun: Promise<void> | null = null;
async function slowCounts(db: ReturnType<typeof admin>) {
  if (slow && Date.now() - slow.at < 600_000) return slow.v;
  slowRun ??= Promise.resolve(db.rpc("desc_counts"))
    .then(({ data, error }: any) => { if (!error && data) slow = { at: Date.now(), v: { eligible: data.eligible, title_only: data.title_only } }; })
    .catch(() => {})
    .finally(() => { slowRun = null; });
  await Promise.race([slowRun, new Promise((r) => setTimeout(r, 300))]);
  return slow?.v ?? {};
}

export async function GET(req: NextRequest) {
  if (!(await requireRole(req, "editor"))) return forbidden("editor");
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") ?? "ready";
  if (!STATUSES.includes(status)) return bad("Geçersiz filtre");
  const page = Math.max(0, Math.min(500, Number(sp.get("page") ?? 0) || 0));
  const db = admin();
  const n = (s: string) => db.from("product_descriptions").select("product_id", { count: "exact", head: true }).eq("status", s);
  const [ls, ready, approved, rejected, skipped, pushed, big, cf] = await Promise.all([
    db.from("product_descriptions").select("product_id, status, kind, draft, original, reason, checks, model, pushed, applied, attr_proposals, updated_at, decided_by, products(title, sku, source)")
      .eq("status", status).order("updated_at", { ascending: false }).range(page * 25, page * 25 + 24),
    n("ready"), n("approved"), n("rejected"), n("skipped"), n("approved").not("pushed->trendyol", "is", null),
    slowCounts(db),
    contentFixState(db),
  ]);
  // Listenin hata metni dolu gelir; head:true sayım hatalarında gövde olmaz
  if (ls.error) return missing(ls.error.message) ? NextResponse.json({ missing: true }) : bad(ls.error.message);
  if ([ready, approved, rejected, skipped, pushed].some((x) => x.error)) return bad("Açıklama sayıları alınamadı, yeniden dene");
  return NextResponse.json({ contentFix: cf, counts: { ...big, ready: ready.count ?? 0, approved: approved.count ?? 0, rejected: rejected.count ?? 0, skipped: skipped.count ?? 0, pushed: pushed.count ?? 0 }, items: ls.data ?? [], page });
}

// İçerik düzeltme (worker/content-fix.ts, migration 095): kapatma anahtarı + son çalışma özeti + onay bekleyen sayısı
async function contentFixState(db: ReturnType<typeof admin>) {
  const [st, pr, rd] = await Promise.all([
    db.from("app_state").select("value, updated_at").eq("key", "content_fix").maybeSingle(),
    db.from("app_state").select("value").eq("key", "content_fix_progress").maybeSingle(),
    db.from("product_descriptions").select("product_id", { count: "exact", head: true }).eq("status", "ready").eq("kind", "content-fix"),
  ]);
  const parse = (v: any) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
  if (st.error && /kind|attr_proposals/.test(String(rd.error?.message ?? ""))) return { missing: true };
  return { enabled: parse(st.data?.value)?.enabled === true, by: parse(st.data?.value)?.by ?? null, at: st.data?.updated_at ?? null, progress: parse(pr.data?.value), ready: rd.count ?? 0, missing: !!rd.error };
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
      .in("product_id", ids).in("status", from).or("draft.not.is.null,kind.eq.content-fix").select("product_id");
    if (error) return bad(error.message);
    return NextResponse.json({ ok: true, changed: data?.length ?? 0 });
  }
  if (b.action === "approve_all_ready") {
    // Ekrandaki sayıyla karşılaştırılır: arada yeni taslak geldiyse kullanıcı görmeden onaylanmasın
    const { count } = await db.from("product_descriptions").select("product_id", { count: "exact", head: true }).eq("status", "ready");
    if (Number(b.expect) !== count) return bad(`Bekleyen taslak sayısı değişti (${count}); listeyi yenileyip tekrar dene`);
    const { data, error } = await db.from("product_descriptions").update({ status: "approved", decided_by: a.email, decided_at: now, updated_at: now, pushed: {} }).eq("status", "ready").or("draft.not.is.null,kind.eq.content-fix").select("product_id");
    if (error) return bad(error.message);
    return NextResponse.json({ ok: true, changed: data?.length ?? 0 });
  }
  if (b.action === "content_fix_toggle") {
    // Tek kapatma anahtarı: sürekli içerik düzeltme (sunucu zamanlayıcısı worker/content-fix.ts run) yalnızca açıkken çalışır
    const on = b.enabled === true;
    const { error } = await db.from("app_state").upsert({ key: "content_fix", value: JSON.stringify({ enabled: on, by: a.email, at: now }), updated_at: now }, { onConflict: "key" });
    if (error) return bad(error.message);
    await db.from("audit_log").insert({ actor: a.email, action: "update", entity: "app_state", entity_id: "content_fix", before: null, after: { enabled: on } });
    return NextResponse.json({ ok: true, enabled: on });
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
