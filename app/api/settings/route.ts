import { NextRequest, NextResponse } from "next/server";
import { admin, guard, unauthorized, bad, mpOf } from "@/lib/server";

export const dynamic = "force-dynamic";

// Trendyol: "settings" tablosu (ortak ayarlar). Diğer pazaryerleri: "settings" + "marketplace_settings" (dolu alanlar ezer).

// alan -> [min, max, tamsayı mı]
const NUM: Record<string, [number, number, boolean]> = {
  commission_rate: [0, 0.6, false],
  target_profit_rate: [0, 0.9, false],
  shipping_cost: [0, 1000, false],
  free_shipping_threshold: [0, 100000, false],
  min_markup: [1, 10, false],
  fixed_cost: [0, 1000, false],
  min_acceptable_profit_rate: [0, 0.9, false],
  max_price: [1, 1000000, false],
  min_stock: [0, 1000, true],
  vat_rate: [0, 100, false],
  fx_usd: [0, 1000, false],
  fx_eur: [0, 1000, false],
  default_desi: [0, 1000, false],
  return_rate: [0, 0.5, false],
  return_cost: [0, 2000, false],
  squeeze_min_net: [0, 1000, false],
  multi_unit_min_net: [0, 1000, false],
};
// Boş bırakılabilen (null) sayısal alanlar
const OPTIONAL = ["squeeze_min_net", "multi_unit_min_net"];
const BOOL = ["sales_paused", "xml_price_includes_vat", "auto_sync", "auto_create", "update_prices", "zero_missing", "commission_plus_vat", "shipping_vat_included", "enabled"];
const POLICIES = ["keep", "floor", "formula", "smart"];
// Yalnızca ortak (settings) tablosunda olanlar
const BASE_ONLY = ["xml_price_includes_vat", "min_markup", "vat_rate", "fx_usd", "fx_eur", "update_prices"];
// Yalnızca marketplace_settings tablosunda olanlar
const MP_ONLY = ["shipping_mode", "cargo_carrier", "default_desi", "shipping_vat_included", "enabled"];

async function read(mp: string) {
  const db = admin();
  const { data: base, error } = await db.from("settings").select("*").eq("id", 1).single();
  if (error) return { error: error.message };
  if (mp === "trendyol") return { data: base };
  const { data: own, error: e2 } = await db.from("marketplace_settings").select("*").eq("marketplace", mp).maybeSingle();
  if (e2) return { error: `Supabase migration 002 çalıştırılmamış (${e2.message})` };
  const merged: Record<string, unknown> = { ...base, enabled: false, ...Object.fromEntries(Object.entries(own ?? {}).filter(([, v]) => v != null)) };
  return { data: { ...merged, marketplace: mp } };
}

export async function GET(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const mp = mpOf(req);
  if (!mp) return bad("Geçersiz pazaryeri");
  const r = await read(mp);
  if (r.error) return bad(r.error);
  return NextResponse.json(r.data);
}

export async function PUT(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const mp = mpOf(req);
  if (!mp) return bad("Geçersiz pazaryeri");
  const body = await req.json();
  const patch: Record<string, number | boolean | string> = {};
  for (const [k, [min, max, int]] of Object.entries(NUM)) {
    if (!(k in body)) continue;
    if (body[k] === null && OPTIONAL.includes(k)) { (patch as any)[k] = null; continue; }
    const v = Number(body[k]);
    if (!Number.isFinite(v) || v < min || v > max || (int && !Number.isInteger(v))) return bad(`Geçersiz değer: ${k}`);
    patch[k] = v;
  }
  for (const k of BOOL) if (k in body) patch[k] = !!body[k];
  if ("existing_price_policy" in body) {
    if (!POLICIES.includes(body.existing_price_policy)) return bad("Geçersiz fiyat politikası");
    patch.existing_price_policy = body.existing_price_policy;
  }
  if ("shipping_mode" in body) {
    if (!["fixed", "desi"].includes(body.shipping_mode)) return bad("Geçersiz kargo hesabı");
    patch.shipping_mode = body.shipping_mode;
  }
  if ("cargo_carrier" in body) patch.cargo_carrier = String(body.cargo_carrier).slice(0, 50);

  // komisyon + hedef kâr %100'ü geçerse fiyat formülü çalışmaz
  const cur = await read(mp);
  if (cur.error) return bad(cur.error);
  const c = Number(patch.commission_rate ?? (cur.data as any).commission_rate);
  const t = Number(patch.target_profit_rate ?? (cur.data as any).target_profit_rate);
  if (c + t >= 1) return bad("Komisyon ve hedef kâr toplamı %100'den küçük olmalı");

  const db = admin();
  const now = new Date().toISOString();
  if (mp === "trendyol") {
    for (const k of MP_ONLY) delete patch[k];
    const { error } = await db.from("settings").update({ ...patch, updated_at: now }).eq("id", 1);
    if (error) return bad(error.message.includes("commission_plus_vat") ? "Komisyon +KDV ayarı için Supabase migration 002 çalıştırılmalı" : error.message);
  } else {
    for (const k of BASE_ONLY) delete patch[k];
    const { error } = await db.from("marketplace_settings").upsert({ marketplace: mp, ...patch, updated_at: now });
    if (error) return bad(error.message);
  }
  // Tedarikçi KDV durumu ürün veritabanı içe aktarmasında da aynı olsun (BayilikXML tedarikçi kaydı)
  if ("xml_price_includes_vat" in patch) await db.from("suppliers").update({ price_includes_vat: !!patch.xml_price_includes_vat }).eq("code", "bayilik");
  const r = await read(mp);
  if (r.error) return bad(r.error);
  return NextResponse.json(r.data);
}
