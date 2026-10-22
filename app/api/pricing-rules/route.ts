import { NextRequest, NextResponse } from "next/server";
import { admin, guard, unauthorized, bad, MARKETPLACES } from "@/lib/server";
import { SUGGESTED_RULES } from "@/worker/pricing-rules";

export const dynamic = "force-dynamic";

const SCOPES = ["all", ...MARKETPLACES];
const numOrNull = (v: unknown, min: number, max: number) => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};

// GET ?mp= : bu pazaryerine uygulanan kurallar ("all" + pazaryeri) · ?sample=1 ile simülasyon için ürün örneği
export async function GET(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const mp = req.nextUrl.searchParams.get("mp") ?? "trendyol";
  if (!MARKETPLACES.includes(mp)) return bad("Geçersiz pazaryeri");
  const db = admin();
  if (req.nextUrl.searchParams.get("sample")) {
    // Ürün veritabanından maliyetli ürünler (en fazla 3000): simülasyon tarayıcıda yapılır
    const { data, error } = await db.from("products").select("sku, title, category, brand, source, cost_price, currency, vat_rate, product_variants(stock)").eq("status", "active").not("cost_price", "is", null).limit(3000);
    if (error) return bad(error.message);
    return NextResponse.json((data ?? []).map((p: any) => ({
      sku: p.sku, title: p.title, category: p.category, brand: p.brand, supplier: String(p.source ?? "").replace(/^xml:/, ""),
      cost: Number(p.cost_price), currency: p.currency, vat: Number(p.vat_rate), stock: (p.product_variants ?? []).reduce((t: number, v: any) => t + v.stock, 0),
    })));
  }
  const { data, error } = await db.from("pricing_rules").select("*").in("marketplace", ["all", mp]).order("position");
  if (error) return bad(error.message);
  return NextResponse.json(data);
}

// Kaydet: { id?, marketplace, name, position, enabled, cond, target_profit_rate, min_net_profit, add_profit_rate } · { seed: mp } önerilenleri ekler
export async function PUT(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const b = await req.json().catch(() => ({}));
  const db = admin();
  if (b.seed) {
    if (!SCOPES.includes(b.seed)) return bad("Geçersiz kapsam");
    const { error } = await db.from("pricing_rules").insert(SUGGESTED_RULES.map((r) => ({ ...r, marketplace: b.seed })));
    if (error) return bad(error.message);
    return NextResponse.json({ ok: true });
  }
  const marketplace = SCOPES.includes(b.marketplace) ? b.marketplace : null;
  if (!marketplace) return bad("Geçersiz kapsam");
  const name = String(b.name ?? "").trim().slice(0, 80);
  if (!name) return bad("Kural adı gerekli");
  const c = b.cond ?? {};
  const cond: Record<string, unknown> = {};
  for (const k of ["cost_min", "cost_max", "stock_max"]) { const v = numOrNull(c[k], 0, 10_000_000); if (v === undefined) return bad(`Geçersiz değer: ${k}`); if (v != null) cond[k] = v; }
  for (const k of ["supplier", "category", "brand"]) { const v = String(c[k] ?? "").trim().slice(0, 100); if (v) cond[k] = v; }
  if (cond.cost_min != null && cond.cost_max != null && Number(cond.cost_min) >= Number(cond.cost_max)) return bad("Maliyet aralığında alt sınır üst sınırdan küçük olmalı");
  const t = numOrNull(b.target_profit_rate, 0, 0.6), m = numOrNull(b.min_net_profit, 0, 100000), add = numOrNull(b.add_profit_rate, -0.3, 0.3);
  if (t === undefined) return bad("Hedef kâr %0-60 arasında olmalı");
  if (m === undefined) return bad("En az net kâr 0-100.000 TL olmalı");
  if (add === undefined) return bad("Kâra ekleme -%30 ile +%30 arasında olmalı");
  const nMin = numOrNull(b.net_profit_min, 0, 100000), nMax = numOrNull(b.net_profit_max, 0, 100000);
  if (nMin === undefined || nMax === undefined) return bad("Net kâr aralığı 0-100.000 TL olmalı");
  if (nMin != null && nMax != null && nMax < nMin) return bad("Net kâr aralığında üst sınır alttan küçük olamaz");
  if (t == null && m == null && add == null && nMin == null && nMax == null) return bad("Kural en az bir şey değiştirmeli: hedef kâr, en az net kâr veya kâra ekleme");
  const row = { marketplace, name, position: Number(b.position) || 0, enabled: b.enabled !== false, cond, target_profit_rate: t, min_net_profit: m, add_profit_rate: add, net_profit_min: nMin, net_profit_max: nMax, updated_at: new Date().toISOString() };
  const q = b.id ? db.from("pricing_rules").update(row).eq("id", b.id) : db.from("pricing_rules").insert(row);
  const { data, error } = await q.select("*").single();
  if (error) return bad(error.message);
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return bad("id gerekli");
  const { error } = await admin().from("pricing_rules").delete().eq("id", id);
  if (error) return bad(error.message);
  return NextResponse.json({ ok: true });
}
