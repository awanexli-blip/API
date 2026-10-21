import { NextRequest, NextResponse } from "next/server";
import { admin, guard, unauthorized, bad, mpOf } from "@/lib/server";

export const dynamic = "force-dynamic";

// Gönderilemeyen ürünler (pazaryeri ilanı "error"): eksik zorunlu özellik / kategori elle tamamlanır, "Gönder" ile yeniden sıraya alınır.
// Ürüne yazılan özellikler products.attributes'ta durur (tedarikçi içe aktarması bu alana dokunmaz); "Trendyol kategori" anahtarı kategori numarasıdır.
const CATEGORY_KEY = "Trendyol kategori";

const missingOf = (err: string) => {
  const m = /zorunlu özellik doldurulamadı:\s*(.+)$/i.exec(err ?? "");
  return m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
};

export async function GET(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const mp = mpOf(req);
  if (!mp) return bad("Geçersiz pazaryeri");
  const db = admin();
  const reason = req.nextUrl.searchParams.get("reason") ?? "";
  let q: any = db.from("marketplace_listings").select("listing_key, title, last_error, product_id, updated_at, products(id, title, category, attributes, product_images(url, position))", { count: "exact" })
    .eq("marketplace", mp).eq("status", "error").not("product_id", "is", null).order("updated_at", { ascending: false }).limit(200);
  if (reason === "ozellik") q = q.ilike("last_error", "%zorunlu özellik%");
  else if (reason === "kategori") q = q.ilike("last_error", "%kategorisi yok%");
  else if (reason === "diger") q = q.not("last_error", "ilike", "%zorunlu özellik%").not("last_error", "ilike", "%kategorisi yok%");
  const [ls, cats, all] = await Promise.all([
    q,
    db.rpc("store_categories", { mp }),
    db.from("marketplace_listings").select("last_error").eq("marketplace", mp).eq("status", "error").not("product_id", "is", null).limit(20000),
  ]);
  if (ls.error) return bad(ls.error.message);
  const counts = { ozellik: 0, kategori: 0, diger: 0 };
  for (const r of all.data ?? []) {
    const e = String(r.last_error ?? "");
    if (/zorunlu özellik/i.test(e)) counts.ozellik++; else if (/kategorisi yok/i.test(e)) counts.kategori++; else counts.diger++;
  }
  const items = (ls.data ?? []).map((l: any) => {
    const p = l.products ?? {};
    const img = [...(p.product_images ?? [])].sort((a: any, b: any) => a.position - b.position)[0]?.url ?? null;
    return { listing_key: l.listing_key, product_id: l.product_id, title: p.title ?? l.title, category: p.category ?? "", image: img, error: l.last_error ?? "", missing: missingOf(l.last_error), needsCategory: /kategorisi yok/i.test(l.last_error ?? ""), attributes: p.attributes ?? {}, updated_at: l.updated_at };
  });
  return NextResponse.json({ items, total: ls.count ?? items.length, counts, categories: cats.data ?? [] });
}

// { product_id, attributes?: {ad: değer}, category_id?, category_name? } -> ürüne yaz, ilanı sıraya al, istenirse senkronu hemen başlat
export async function PUT(req: NextRequest) {
  if (!(await guard(req))) return unauthorized();
  const mp = mpOf(req);
  if (!mp) return bad("Geçersiz pazaryeri");
  const b = await req.json().catch(() => ({}));
  const id = String(b.product_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return bad("product_id gerekli");
  const db = admin();
  const { data: p, error } = await db.from("products").select("id, attributes").eq("id", id).maybeSingle();
  if (error || !p) return bad(error?.message ?? "Ürün yok");
  const attrs: Record<string, string> = { ...(p.attributes ?? {}) };
  for (const [k, v] of Object.entries(b.attributes && typeof b.attributes === "object" ? b.attributes : {})) {
    const key = String(k).trim().slice(0, 60), val = String(v ?? "").trim().slice(0, 100);
    if (!key) continue;
    if (val) attrs[key] = val; else delete attrs[key];
  }
  if (b.category_id != null) {
    const cid = String(b.category_id).trim();
    if (cid && !/^\d{1,12}$/.test(cid)) return bad("Kategori numarası geçersiz");
    if (cid) attrs[CATEGORY_KEY] = cid; else delete attrs[CATEGORY_KEY];
  }
  const now = new Date().toISOString();
  const up = await db.from("products").update({ attributes: attrs, updated_at: now }).eq("id", id);
  if (up.error) return bad(up.error.message);
  const ls = await db.from("marketplace_listings").update({ status: "queued", last_error: null, updated_at: now }).eq("marketplace", mp).eq("product_id", id).eq("status", "error").select("listing_key");
  if (ls.error) return bad(ls.error.message);
  const { error: je } = await db.from("jobs").insert({ type: `send_products:${mp}`, marketplace: mp, payload: { product_ids: [id] }, idempotency_key: `send:${mp}:elle:${id}:${now.slice(0, 16)}`, created_by: "panel (gönderilemeyenler)" });
  if (je && je.code !== "23505") return bad(je.message);
  let started = false;
  if (b.now && process.env.GH_TOKEN && process.env.GH_REPO) {
    const r = await fetch(`https://api.github.com/repos/${process.env.GH_REPO}/actions/workflows/sync.yml/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      body: JSON.stringify({ ref: "main", inputs: { mode: "update", marketplace: mp } }),
    });
    started = r.status === 204;
  }
  return NextResponse.json({ ok: true, queued: ls.data?.length ?? 0, started });
}
