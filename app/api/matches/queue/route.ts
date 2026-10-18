import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/server";
import { authorize, dbError } from "@/lib/products";

export const dynamic = "force-dynamic";

// Toplu eşleştirme (Amazon)
// GET  ?mp=amazon&page=0  -> sayılar + onay bekleyen adaylar (ürün bazında)
// POST { mp, limit, now? } -> eşleşmesi aranmamış stoklu ürünlerden "limit" kadarını aday aramaya kuyruğa al
//      { mp, send: true }   -> onaylı eşleşmesi olan, ilanı olmayan ürünleri pazaryerine gönder (kuyruk)
export async function GET(req: NextRequest) {
  const a = await authorize(req, "viewer");
  if (a instanceof NextResponse) return a;
  const mp = req.nextUrl.searchParams.get("mp") ?? "amazon";
  const page = Math.max(0, Number(req.nextUrl.searchParams.get("page") ?? 0));
  const db = admin();
  const { data: stats } = await db.rpc("match_stats", { mp });
  // Onaylı eşleşmesi olmayan varyantların adayları (20 varyant / sayfa)
  const { data: rows, error } = await db.from("marketplace_matches")
    .select("id, variant_id, product_id, external_id, title, brand, image, matched_by, status, products(title, sku, product_images(url, position)), product_variants(sku, barcode, attributes)")
    .eq("marketplace", mp).eq("status", "suggested").order("product_id").order("id").range(page * 100, page * 100 + 99);
  if (error) return dbError(error);
  const byVariant = new Map<string, any>();
  for (const r of rows ?? []) {
    const g = byVariant.get(r.variant_id) ?? {
      variant_id: r.variant_id, product_id: r.product_id, title: (r as any).products?.title, sku: (r as any).product_variants?.sku, barcode: (r as any).product_variants?.barcode,
      attributes: (r as any).product_variants?.attributes ?? {}, image: [...((r as any).products?.product_images ?? [])].sort((x: any, y: any) => x.position - y.position)[0]?.url ?? null, candidates: [],
    };
    g.candidates.push({ id: r.id, asin: r.external_id, title: r.title, brand: r.brand, image: r.image, by: r.matched_by });
    byVariant.set(r.variant_id, g);
  }
  return NextResponse.json({ stats: stats ?? {}, items: [...byVariant.values()].slice(0, 20), more: (rows?.length ?? 0) === 100 });
}

export async function POST(req: NextRequest) {
  const a = await authorize(req, "editor");
  if (a instanceof NextResponse) return a;
  const b = await req.json().catch(() => ({}));
  const mp = String(b.mp ?? "amazon");
  if (mp !== "amazon") return NextResponse.json({ error: "Toplu eşleştirme şimdilik yalnızca Amazon için" }, { status: 400 });
  const db = admin();
  const now = new Date().toISOString();

  if (b.send) {
    const { data: ids, error } = await db.rpc("products_confirmed_unlisted", { mp, lim: 200 });
    if (error) return dbError(error);
    const list = (ids ?? []) as string[];
    if (!list.length) return NextResponse.json({ error: "Gönderilecek onaylı ürün yok" }, { status: 400 });
    // Gönderim API'siyle aynı yol (doğrulama, ilan satırları, kuyruk)
    const r = await fetch(new URL("/api/listings/send", req.nextUrl.origin), { method: "POST", headers: { "Content-Type": "application/json", authorization: req.headers.get("authorization") ?? "" }, body: JSON.stringify({ product_ids: list, marketplace: mp, now: !!b.now }) });
    return NextResponse.json(await r.json(), { status: r.status });
  }

  const limit = Math.max(1, Math.min(300, Number(b.limit) || 100));
  const { data: ids, error } = await db.rpc("products_unmatched", { mp, lim: limit });
  if (error) return dbError(error);
  const list = (ids ?? []) as string[];
  if (!list.length) return NextResponse.json({ error: "Aday aranacak ürün yok (stoklu, aktif ve henüz aranmamış ürün kalmadı)" }, { status: 400 });
  const { data: job, error: je } = await db.from("jobs").insert({ type: `match_products:${mp}`, marketplace: mp, payload: { product_ids: list }, idempotency_key: `match:${mp}:${now.slice(0, 16)}:${list.length}`, created_by: a.email }).select("id").single();
  if (je && je.code !== "23505") return dbError(je);

  let started = false;
  if (b.now && a.role === "admin" && process.env.GH_TOKEN && process.env.GH_REPO) {
    // Önizleme modunda çalışır: Amazon'a yazmaz, yalnızca katalog araması + ilan raporu
    const r = await fetch(`https://api.github.com/repos/${process.env.GH_REPO}/actions/workflows/sync.yml/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      body: JSON.stringify({ ref: "main", inputs: { mode: "preview", marketplace: mp } }),
    });
    started = r.status === 204;
  }
  return NextResponse.json({ ok: true, job_id: job?.id ?? null, products: list.length, started });
}
