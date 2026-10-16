import { NextRequest, NextResponse } from "next/server";
import { admin, guard, unauthorized, bad } from "@/lib/server";

export const dynamic = "force-dynamic";

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
};
const BOOL = ["auto_sync", "auto_create", "update_prices", "zero_missing"];
const POLICIES = ["keep", "floor", "formula", "smart"];

export async function GET(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const { data, error } = await admin().from("settings").select("*").eq("id", 1).single();
  if (error) return bad(error.message);
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const body = await req.json();
  const patch: Record<string, number | boolean | string> = {};
  for (const [k, [min, max, int]] of Object.entries(NUM)) {
    if (!(k in body)) continue;
    const v = Number(body[k]);
    if (!Number.isFinite(v) || v < min || v > max || (int && !Number.isInteger(v))) return bad(`Geçersiz değer: ${k}`);
    patch[k] = v;
  }
  for (const k of BOOL) if (k in body) patch[k] = !!body[k];
  if ("existing_price_policy" in body) {
    if (!POLICIES.includes(body.existing_price_policy)) return bad("Geçersiz fiyat politikası");
    patch.existing_price_policy = body.existing_price_policy;
  }

  // komisyon + hedef kâr %100'ü geçerse fiyat formülü çalışmaz
  const { data: cur } = await admin().from("settings").select("commission_rate,target_profit_rate").eq("id", 1).single();
  const c = Number(patch.commission_rate ?? cur?.commission_rate);
  const t = Number(patch.target_profit_rate ?? cur?.target_profit_rate);
  if (c + t >= 1) return bad("Komisyon ve hedef kâr toplamı %100'den küçük olmalı");

  patch.updated_at = new Date().toISOString();
  const { data, error } = await admin().from("settings").update(patch).eq("id", 1).select("*").single();
  if (error) return bad(error.message);
  return NextResponse.json(data);
}
