import { NextRequest, NextResponse } from "next/server";
import { admin, requireRole, forbidden, bad, mpOf } from "@/lib/server";

export const dynamic = "force-dynamic";

// Rekabet / buybox (migration 046): GET ?mp=&filter=lost|winnable|won|alone|all&q=&page= -> özet + liste
// POST { listing_key, price } -> elle fiyat (product_overrides; worker zarar ettiren fiyatı uygulamaz) · DELETE { listing_key } -> elle fiyatı kaldır
const FILTERS = ["lost", "winnable", "won", "alone", "all"];

export async function GET(req: NextRequest) {
  if (!(await requireRole(req, "editor"))) return forbidden("editor");
  const mp = mpOf(req);
  if (mp !== "trendyol") return bad("Rekabet takibi şimdilik yalnızca Trendyol'da");
  const sp = req.nextUrl.searchParams;
  const filter = sp.get("filter") ?? "lost";
  if (!FILTERS.includes(filter)) return bad("Geçersiz filtre");
  const page = Math.max(0, Math.min(400, Number(sp.get("page")) || 0));
  const q = (sp.get("q") ?? "").trim().replace(/[%_\\]/g, "").slice(0, 60);
  const { data, error } = await admin().rpc("buybox_report", { p_mp: mp, p_filter: filter, p_q: q, p_limit: 50, p_offset: page * 50 });
  if (error) return bad(error.message);
  return NextResponse.json({ ...data, page });
}

export async function POST(req: NextRequest) {
  const a = await requireRole(req, "editor");
  if (!a) return forbidden("editor");
  const mp = mpOf(req);
  if (mp !== "trendyol") return bad("Rekabet takibi şimdilik yalnızca Trendyol'da");
  const b = await req.json().catch(() => ({}));
  const key = String(b.listing_key ?? "").trim(), price = Number(b.price);
  if (!/^[A-Za-z0-9ÇĞİÖŞÜçğıöşü._-]{1,40}$/.test(key)) return bad("Geçersiz ilan");
  if (!(price > 0 && price < 100000)) return bad("Geçersiz fiyat");
  const db = admin();
  const { data: bb } = await db.from("listing_buybox").select("cost, our_price, target_price, net_at_target").eq("marketplace", mp).eq("listing_key", key).maybeSingle();
  if (!bb) return bad("Bu ilanın rekabet bilgisi yok");
  if (bb.cost != null && price < Number(bb.cost)) return bad("Fiyat maliyetin altında");
  const { error } = await db.from("product_overrides").upsert({ marketplace: mp, barcode: key, price_override: Math.round(price * 100) / 100, note: `rekabet: ${a.email} ${new Date().toISOString().slice(0, 10)}` }, { onConflict: "marketplace,barcode" });
  if (error) return bad(error.message);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!(await requireRole(req, "editor"))) return forbidden("editor");
  const mp = mpOf(req);
  const b = await req.json().catch(() => ({}));
  const key = String(b.listing_key ?? "").trim();
  if (mp !== "trendyol" || !key) return bad("Geçersiz istek");
  // Satır silinmez: elle fiyat boşaltılır (formül fiyatına dönülür)
  const { error } = await admin().from("product_overrides").update({ price_override: null }).eq("marketplace", mp).eq("barcode", key);
  if (error) return bad(error.message);
  return NextResponse.json({ ok: true });
}
