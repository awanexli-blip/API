import { NextRequest, NextResponse } from "next/server";
import { admin, requireRole, forbidden, bad, mpOf } from "@/lib/server";

export const dynamic = "force-dynamic";

// Rekabet / buybox (migration 046, 062): GET ?mp=&filter=suggest|winnable|raise|reset|lost|won|alone|overridden|all&q=&page= -> özet + liste
// POST { items: [{ listing_key, kind, price }] } -> onaylanan öneriler (K, 27.10: güncel veriyle karşılaştır, sonra onayla): her biri onay anında
//   listing_buybox'taki güncel öneriyle aynı olmalı (rakip fiyatı değiştiyse uygulanmaz, "veri değişti" döner). lower/raise = elle fiyat, reset = formüle dön.
// POST { listing_key, price } -> tek ilan elle fiyat · DELETE { listing_key } -> elle fiyatı kaldır. Zarar ettiren fiyatı worker uygulamaz.
const FILTERS = ["suggest", "winnable", "raise", "reset", "lost", "won", "alone", "overridden", "all"];

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
  if (Array.isArray(b.items)) return approveMany(mp, b.items.slice(0, 500), a.email);
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

const KEY_RE = /^[A-Za-z0-9ÇĞİÖŞÜçğıöşü._-]{1,40}$/;
async function approveMany(mp: string, items: any[], email: string) {
  const db = admin();
  const keys = items.map((x) => String(x?.listing_key ?? "").trim()).filter((k) => KEY_RE.test(k));
  if (!keys.length) return bad("Öneri seçilmedi");
  const { data: rows, error } = await db.from("listing_buybox").select("listing_key, suggestion, target_price, cost").eq("marketplace", mp).in("listing_key", keys);
  if (error) return bad(error.message);
  const cur = new Map((rows ?? []).map((r: any) => [r.listing_key, r]));
  const set: any[] = [], reset: string[] = [], stale: string[] = [];
  const note = `rekabet onayı: ${email} ${new Date().toISOString().slice(0, 16)}`;
  for (const it of items) {
    const k = String(it?.listing_key ?? "").trim(), r: any = cur.get(k);
    // Onay anındaki öneri, listede gösterilenle aynı mı (rakip fiyatı arada değiştiyse yeniden karşılaştırılmalı)
    if (!r || r.suggestion !== it.kind || (it.kind !== "reset" && Math.abs(Number(r.target_price) - Number(it.price)) > 0.009)) { stale.push(k); continue; }
    if (it.kind === "reset") reset.push(k);
    else if (Number(r.target_price) > 0 && (r.cost == null || Number(r.target_price) >= Number(r.cost))) set.push({ marketplace: mp, barcode: k, price_override: Number(r.target_price), note });
    else stale.push(k);
  }
  if (set.length) { const { error: e } = await db.from("product_overrides").upsert(set, { onConflict: "marketplace,barcode" }); if (e) return bad(e.message); }
  if (reset.length) { const { error: e } = await db.from("product_overrides").update({ price_override: null, note }).eq("marketplace", mp).in("barcode", reset); if (e) return bad(e.message); }
  return NextResponse.json({ ok: true, priced: set.length, reset: reset.length, stale });
}
