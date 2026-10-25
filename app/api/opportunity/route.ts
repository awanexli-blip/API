import { NextRequest, NextResponse } from "next/server";
import { admin, requireRole, forbidden, bad, mpOf } from "@/lib/server";

export const dynamic = "force-dynamic";

// Ürün seçimi / fırsat listesi (migration 051, worker/opportunity.ts): GET ?mp=&source=&q=&brand=&min_net=&min_stock=&own=1&page=
// POST { product_ids } | { top, filters } -> seçilenler için gönderim işi (kullanıcı onayı; pazaryeri ürün sınırı kontrolüyle)
const LIMIT: Record<string, number> = { trendyol: Number(process.env.TRENDYOL_PRODUCT_LIMIT ?? 50000) };
const clean = (s: string | null, n = 60) => (s ?? "").trim().replace(/[%_\\]/g, "").slice(0, n);

async function capacity(db: any, mp: string) {
  const { count } = await db.from("marketplace_listings").select("listing_key", { count: "planned", head: true }).eq("marketplace", mp).neq("status", "gone");
  const limit = LIMIT[mp] ?? null;
  return { used: count ?? 0, limit, free: limit ? Math.max(0, limit - (count ?? 0)) : null };
}

function filters(sp: URLSearchParams | Record<string, any>) {
  const g = (k: string) => (sp instanceof URLSearchParams ? sp.get(k) : sp[k] != null ? String(sp[k]) : null);
  return { p_source: clean(g("source"), 40) ? `xml:${clean(g("source"), 40)}` : "", p_q: clean(g("q")), p_brand: (g("brand") ?? "").trim().slice(0, 100), p_min_net: Math.max(0, Number(g("min_net")) || 0), p_min_stock: Math.max(0, Math.floor(Number(g("min_stock")) || 0)), p_only_ok_brand: g("own") === "1" };
}

export async function GET(req: NextRequest) {
  if (!(await requireRole(req, "editor"))) return forbidden("editor");
  const mp = mpOf(req);
  if (!mp) return bad("Geçersiz pazaryeri");
  const sp = req.nextUrl.searchParams;
  const page = Math.max(0, Math.min(1000, Number(sp.get("page")) || 0));
  const db = admin();
  const [{ data, error }, cap] = await Promise.all([db.rpc("opportunity_list", { p_mp: mp, ...filters(sp), p_limit: 50, p_offset: page * 50 }), capacity(db, mp)]);
  if (error) return bad(error.message);
  return NextResponse.json({ ...data, page, capacity: cap });
}

export async function POST(req: NextRequest) {
  const a = await requireRole(req, "editor");
  if (!a) return forbidden("editor");
  const mp = mpOf(req);
  if (!mp) return bad("Geçersiz pazaryeri");
  const b = await req.json().catch(() => ({}));
  const db = admin();
  let ids: string[] = [];
  if (Array.isArray(b.product_ids)) ids = b.product_ids.map(String).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 5000);
  else if (Number(b.top) > 0) {
    const top = Math.min(5000, Math.floor(Number(b.top)));
    for (let off = 0; ids.length < top; off += 500) {
      const { data, error } = await db.rpc("opportunity_list", { p_mp: mp, ...filters(b.filters ?? {}), p_limit: Math.min(500, top - ids.length), p_offset: off });
      if (error) return bad(error.message);
      const items = (data?.items ?? []) as any[];
      ids.push(...items.map((i) => i.product_id));
      if (items.length < 500) break;
    }
  }
  ids = [...new Set(ids)];
  if (!ids.length) return bad("Ürün seçilmedi");
  const cap = await capacity(db, mp);
  if (cap.free != null && ids.length > cap.free) return bad(`Pazaryeri ürün sınırı: ${cap.free.toLocaleString("tr-TR")} boş yer var, ${ids.length.toLocaleString("tr-TR")} ürün seçildi`);
  const now = new Date().toISOString();
  let jobs = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await db.from("jobs").insert({ type: `send_products:${mp}`, marketplace: mp, payload: { product_ids: ids.slice(i, i + 100) }, idempotency_key: `firsat:${mp}:${now}:${i / 100}`, created_by: a.email });
    if (error) return bad(`${jobs} iş kuruldu, sonra hata: ${error.message}`);
    jobs++;
  }
  return NextResponse.json({ ok: true, products: ids.length, jobs });
}
