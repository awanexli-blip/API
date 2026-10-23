import { NextRequest, NextResponse } from "next/server";
import { admin, guard, unauthorized, bad, mpOf } from "@/lib/server";

export const dynamic = "force-dynamic";

const DEFAULT_BRAND = "Eco Lounge"; // worker/marketplaces/trendyol.ts ile aynı (TRENDYOL_BRAND_NAME yoksa)
type Hist = { brand: string; at: string; by: string };

// Markalar sekmesi: yeni ürün markası, geçmiş, mağazadaki marka dağılımı, son markayla ilgili hatalar
export async function GET(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const mp = mpOf(req);
  if (!mp) return bad("Geçersiz pazaryeri");
  const db = admin();
  const [ms, runs, cnt] = await Promise.all([
    db.from("marketplace_settings").select("brand_name, brand_history").eq("marketplace", mp).maybeSingle(),
    db.from("sync_runs").select("id, mode, started_at, summary").eq("marketplace", mp).eq("status", "ok").order("id", { ascending: false }).limit(30),
    db.from("marketplace_brands").select("brand_id", { count: "planned", head: true }).eq("marketplace", mp),
  ]);
  if (ms.error) return bad(ms.error.message);
  const list = runs.data ?? [];
  const withBrands = list.find((r: any) => r.summary?.brands);
  // Son çalışmalarda marka kaynaklı atlananlar ve ret nedenleri
  const issues: string[] = [];
  for (const r of list.slice(0, 10) as any[]) {
    for (const [k, v] of Object.entries(r.summary?.skipped ?? {})) if (/marka/i.test(k)) issues.push(`${new Date(r.started_at).toLocaleString("tr-TR")}: ${k} (${v} ürün)`);
    for (const [k, v] of Object.entries(r.summary?.newProductApproval?.topReasons ?? {})) if (/marka|brand|belge/i.test(k)) issues.push(`Trendyol reddi: ${k} (${v} ürün)`);
  }
  return NextResponse.json({
    current: ms.data?.brand_name || null, default: DEFAULT_BRAND,
    history: (ms.data?.brand_history ?? []) as Hist[],
    stats: withBrands ? { at: withBrands.started_at, brands: withBrands.summary.brands } : null,
    issues: [...new Set(issues)].slice(0, 10),
    brandListCount: cnt.count ?? 0,
  });
}

// { brand } -> yeni marka (önceki geçmişe yazılır) · { revert: true } -> bir önceki markaya dön · { brand: "" } -> varsayılana dön
export async function PUT(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const mp = mpOf(req);
  if (!mp) return bad("Geçersiz pazaryeri");
  const body = await req.json().catch(() => ({}));
  const db = admin();
  const { data: cur, error } = await db.from("marketplace_settings").select("brand_name, brand_history").eq("marketplace", mp).maybeSingle();
  if (error) return bad(error.message);
  const history: Hist[] = cur?.brand_history ?? [];
  const old = cur?.brand_name || null;

  let next: string | null;
  if (body.revert) {
    if (!history.length) return bad("Geri alınacak önceki marka yok");
    next = history[0].brand || null;
    history.shift();
  } else {
    const b = String(body.brand ?? "").trim();
    if (b.length > 100) return bad("Marka en fazla 100 karakter");
    next = b || null;
    if (next === old) return bad("Marka zaten bu");
    history.unshift({ brand: old ?? "", at: new Date().toISOString(), by: "panel" });
  }
  const row = { marketplace: mp, brand_name: next, brand_history: history.slice(0, 20) };
  const { error: e2 } = await db.from("marketplace_settings").upsert(row, { onConflict: "marketplace" });
  if (e2) return bad(e2.message);
  return NextResponse.json({ ok: true, current: next });
}
