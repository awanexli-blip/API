import { NextRequest, NextResponse } from "next/server";
import { admin, requireRole, forbidden, bad, MARKETPLACES } from "@/lib/server";

export const dynamic = "force-dynamic";

// Siparişler (Faz 6 F3, salt okunur): liste + özet, ?id= ile detay (satırlar, zaman çizelgesi).
// Müşteri kişisel verisi tabloda tutulmuyor (yalnızca il); F4'te açılınca bu uç rol kontrolünü korur (editor+).
const STATUSES = ["", "new", "ready", "sent_to_supplier", "shipped", "delivered", "cancelled", "returned", "problem"];
const COLS = "id, marketplace, order_no, status, marketplace_status, total, currency, ordered_at, ship_deadline, cargo_provider, tracking_no, city, est_cost, est_net, needs_attention, attention_reason, updated_at";

export async function GET(req: NextRequest) {
  if (!(await requireRole(req, "editor"))) return forbidden("editor");
  const sp = req.nextUrl.searchParams;
  const db = admin();
  const id = sp.get("id");
  if (id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return bad("Geçersiz sipariş");
    const [o, l, e] = await Promise.all([
      db.from("orders").select(COLS).eq("id", id).maybeSingle(),
      db.from("order_lines").select("line_no, listing_key, product_id, title, qty, unit_price, commission_rate, cost_snapshot").eq("order_id", id).order("line_no"),
      db.from("order_events").select("at, kind, actor, detail").eq("order_id", id).order("at"),
    ]);
    if (o.error || !o.data) return bad(o.error?.message ?? "Sipariş yok");
    return NextResponse.json({ order: o.data, lines: l.data ?? [], events: e.data ?? [] });
  }
  const mp = sp.get("mp") ?? "", status = sp.get("status") ?? "";
  if ((mp && !MARKETPLACES.includes(mp)) || !STATUSES.includes(status)) return bad("Geçersiz filtre");
  const q = (sp.get("q") ?? "").trim().replace(/[%_,()\\]/g, "").slice(0, 40);
  const page = Math.max(0, Math.min(500, Number(sp.get("page")) || 0));
  const days = Math.max(1, Math.min(365, Number(sp.get("days")) || 30));
  const since = new Date(Date.now() - days * 86400000).toISOString();
  let list: any = db.from("orders").select(COLS, { count: "exact" }).gte("ordered_at", since).order("needs_attention", { ascending: false }).order("ordered_at", { ascending: false }).range(page * 50, page * 50 + 49);
  if (mp) list = list.eq("marketplace", mp);
  if (status) list = list.eq("status", status);
  if (sp.get("attention") === "1") list = list.eq("needs_attention", true);
  if (q) list = list.or(`order_no.ilike.%${q}%,tracking_no.ilike.%${q}%`);
  let all: any = db.from("orders").select("status, total, est_net, needs_attention").gte("ordered_at", since).limit(20000);
  if (mp) all = all.eq("marketplace", mp);
  const [ls, sm] = await Promise.all([list, all]);
  if (ls.error) return bad(ls.error.message);
  const s = { orders: 0, revenue: 0, net: 0, netKnown: 0, attention: 0, byStatus: {} as Record<string, number> };
  for (const r of sm.data ?? []) {
    s.byStatus[r.status] = (s.byStatus[r.status] ?? 0) + 1;
    if (r.needs_attention) s.attention++;
    if (r.status === "cancelled" || r.status === "returned") continue;
    s.orders++; s.revenue += Number(r.total ?? 0);
    if (r.est_net != null) { s.net += Number(r.est_net); s.netKnown++; }
  }
  return NextResponse.json({ items: ls.data ?? [], total: ls.count ?? 0, page, summary: s });
}
