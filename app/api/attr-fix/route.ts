import { NextRequest, NextResponse } from "next/server";
import { admin, requireRole, forbidden, bad, mpOf } from "@/lib/server";

export const dynamic = "force-dynamic";

// Toplu özellik tamamlama (migration 041): GET ?mp= -> eksik özellik grupları (kategori + özellik)
// GET ?mp=&cat=&name= -> grubun ürünleri + pazaryerinin değer listesi · POST { cat, name, value, product_ids } -> ürünlere yaz + eksiği kalmayanı sıraya al.
// Trendyol değer listesi herkese açık uçtan (product-categories/{id}/attributes, günlük önbellek); Hepsiburada'da worker'ın kaydettiği attr_options.
async function trendyolCategory(cid: string): Promise<{ name: string; attrs: Map<string, { values: string[]; custom: boolean }> } | null> {
  if (!/^\d{1,10}$/.test(cid)) return null;
  const r = await fetch(`https://apigw.trendyol.com/integration/product/product-categories/${cid}/attributes`, { headers: { "User-Agent": "urun-paneli" }, next: { revalidate: 86400 }, signal: AbortSignal.timeout(10000) }).catch(() => null);
  if (!r?.ok) return null;
  const j: any = await r.json().catch(() => null);
  if (!j) return null;
  const attrs = new Map<string, { values: string[]; custom: boolean }>();
  for (const a of j.categoryAttributes ?? []) attrs.set(String(a.attribute?.name ?? ""), { values: (a.attributeValues ?? []).map((v: any) => String(v.name)).filter(Boolean), custom: !!a.allowCustom });
  return { name: String(j.displayName ?? j.name ?? ""), attrs };
}

export async function GET(req: NextRequest) {
  if (!(await requireRole(req, "editor"))) return forbidden("editor");
  const mp = mpOf(req);
  if (!mp || mp === "amazon") return bad("Geçersiz pazaryeri");
  const sp = req.nextUrl.searchParams;
  const db = admin();
  const cat = sp.get("cat"), name = sp.get("name");
  if (cat && name) {
    const [items, opt] = await Promise.all([
      db.rpc("attr_fix_items", { p_mp: mp, p_cat: cat, p_name: name, p_limit: 500 }),
      db.from("attr_options").select("values, allow_custom, category_name").eq("marketplace", mp).eq("category_id", cat).eq("name", name).maybeSingle(),
    ]);
    if (items.error) return bad(items.error.message);
    let values: string[] = opt.data?.values ?? [], custom = opt.data?.allow_custom ?? values.length === 0, catName = opt.data?.category_name ?? null;
    if (mp === "trendyol") {
      const t = await trendyolCategory(cat);
      const a = t?.attrs.get(name);
      if (a) { values = a.values; custom = a.custom; }
      catName = t?.name || catName;
    }
    return NextResponse.json({ items: items.data ?? [], values, custom, categoryName: catName });
  }
  const g = await db.rpc("attr_fix_groups", { p_mp: mp });
  if (g.error) return bad(g.error.message);
  const groups = (g.data ?? []) as any[];
  // Trendyol kategori adları (en büyük 40 grubun kategorisi)
  if (mp === "trendyol") {
    const cats = [...new Set(groups.slice(0, 40).filter((x) => !x.category_name).map((x) => x.category_id))];
    const names = new Map<string, string>();
    await Promise.all(cats.map(async (c) => { const t = await trendyolCategory(c); if (t?.name) names.set(c, t.name); }));
    for (const x of groups) x.category_name ??= names.get(x.category_id) ?? null;
  }
  return NextResponse.json({ groups, total: groups.reduce((t, x) => t + Number(x.n), 0) });
}

export async function POST(req: NextRequest) {
  const a = await requireRole(req, "editor");
  if (!a) return forbidden("editor");
  const mp = mpOf(req);
  if (!mp || mp === "amazon") return bad("Geçersiz pazaryeri");
  const b = await req.json().catch(() => ({}));
  const name = String(b.name ?? "").trim().slice(0, 60), value = String(b.value ?? "").trim().slice(0, 100);
  const ids = (Array.isArray(b.product_ids) ? b.product_ids : []).map(String).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 1000);
  if (!name || !value) return bad("Özellik ve değer gerekli");
  if (!ids.length) return bad("En az bir ürün seç");
  const { data, error } = await admin().rpc("attr_fix_apply", { p_mp: mp, p_name: name, p_value: value, p_ids: ids, p_by: a.email });
  if (error) return bad(error.message);
  if (data?.error) return bad(data.error);
  return NextResponse.json({ ok: true, ...data });
}
