import { NextRequest, NextResponse } from "next/server";
import { admin, guard, unauthorized, bad, mpOf, requireRole, forbidden } from "@/lib/server";

export const dynamic = "force-dynamic";

// Gönderim durumu: ilan sayıları, pazaryeri inceleme durumu (HB: Satışa Hazır / İncelenecek), hata grupları ve sayfalı liste
// (migration 035-036). Toplu "yeniden sıraya al" yalnızca hatalı / reddedilen ilanlarda.
const STATUSES = ["", "queued", "sent", "live", "error", "rejected", "closed", "gone", "pending_approval"];
const GROUPS = ["", "kategori", "ozellik", "gorsel", "marka", "kopya", "pazaryeri", "diger"];

export async function GET(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const mp = mpOf(req);
  if (!mp) return bad("Geçersiz pazaryeri");
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") ?? "", group = sp.get("group") ?? "";
  if (!STATUSES.includes(status) || !GROUPS.includes(group)) return bad("Geçersiz filtre");
  const q = (sp.get("q") ?? "").trim().slice(0, 80).replace(/[%_\\]/g, "");
  const page = Math.max(0, Math.min(1000, Number(sp.get("page")) || 0));
  const db = admin();
  const [sum, list] = await Promise.all([
    db.rpc("listing_status_summary", { p_mp: mp }),
    db.rpc("listing_status_list", { p_mp: mp, p_status: status, p_group: group, p_q: q, p_mp_status: (sp.get("mpst") ?? "").slice(0, 60), p_limit: 50, p_offset: page * 50 }),
  ]);
  if (sum.error) return bad(sum.error.message);
  if (list.error) return bad(list.error.message);
  const items = (list.data ?? []) as any[];
  return NextResponse.json({ summary: sum.data, items: items.map(({ total, ...r }) => r), total: Number(items[0]?.total ?? 0), page });
}

// { keys?: string[] } seçilenler ya da { status, group } filtrenin tamamı (en çok 5000) -> "queued" + gönderim işi
export async function POST(req: NextRequest) {
  const a = await requireRole(req, "admin");
  if (!a) return forbidden("admin");
  const mp = mpOf(req);
  if (!mp || mp === "amazon") return bad("Bu pazaryerinde toplu yeniden gönderim yok");
  const b = await req.json().catch(() => ({}));
  const db = admin();
  let rows: { listing_key: string; product_id: string | null }[] = [];
  if (Array.isArray(b.keys)) {
    const keys = b.keys.map(String).filter(Boolean).slice(0, 500);
    if (!keys.length) return bad("İlan seç");
    const r = await db.from("marketplace_listings").select("listing_key, product_id").eq("marketplace", mp).in("listing_key", keys).in("status", ["error", "rejected"]);
    if (r.error) return bad(r.error.message);
    rows = r.data ?? [];
  } else {
    const status = String(b.status ?? ""), group = String(b.group ?? "");
    if (!["error", "rejected"].includes(status) || !GROUPS.includes(group)) return bad("Yalnızca hatalı veya reddedilen ilanlar yeniden gönderilir");
    for (let off = 0; off < 5000; off += 200) {
      const r = await db.rpc("listing_status_list", { p_mp: mp, p_status: status, p_group: group, p_q: "", p_mp_status: "", p_limit: 200, p_offset: off });
      if (r.error) return bad(r.error.message);
      rows.push(...(r.data ?? []).map((x: any) => ({ listing_key: x.listing_key, product_id: x.product_id })));
      if ((r.data ?? []).length < 200) break;
    }
  }
  rows = rows.filter((r) => r.product_id);
  if (!rows.length) return bad("Yeniden gönderilecek ilan yok (yalnızca ürün veritabanına bağlı hatalı/reddedilen ilanlar)");
  const now = new Date().toISOString();
  const keys = rows.map((r) => r.listing_key);
  for (let i = 0; i < keys.length; i += 500) {
    const u = await db.from("marketplace_listings").update({ status: "queued", last_error: null, updated_at: now }).eq("marketplace", mp).in("listing_key", keys.slice(i, i + 500)).in("status", ["error", "rejected"]);
    if (u.error) return bad(u.error.message);
  }
  const ids = [...new Set(rows.map((r) => r.product_id as string))];
  let jobs = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await db.from("jobs").insert({ type: `send_products:${mp}`, marketplace: mp, payload: { product_ids: ids.slice(i, i + 100) }, idempotency_key: `panel-retry:${mp}:${now.slice(0, 16)}:${i / 100}`, created_by: a.email });
    if (error && error.code !== "23505") return bad(error.message);
    if (!error) jobs++;
  }
  return NextResponse.json({ ok: true, queued: keys.length, products: ids.length, jobs });
}
