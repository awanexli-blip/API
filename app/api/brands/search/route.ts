import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/server";
import { authorize, dbError } from "@/lib/products";

export const dynamic = "force-dynamic";

// Marka listesi önbelleği olan pazaryerleri (worker/brands.ts). Diğerleri "bilinmiyor" döner.
const KNOWN = ["trendyol"];
const norm = (s: string) => s.toLocaleLowerCase("tr").replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u").replace(/\s+/g, " ").trim();

// ?q=  -> { results: [{ name, markets: { trendyol: id } }], exact: { trendyol: true|false|null } }
export async function GET(req: NextRequest) {
  const a = await authorize(req, "viewer");
  if (a instanceof NextResponse) return a;
  const q = norm(req.nextUrl.searchParams.get("q") ?? "").replace(/[%_\\]/g, "").slice(0, 60);
  if (q.length < 2) return NextResponse.json({ results: [], exact: {} });
  const db = admin();

  const [starts, contains, counts] = await Promise.all([
    db.from("marketplace_brands").select("marketplace, brand_id, name, name_norm").like("name_norm", `${q}%`).order("name_norm").limit(15),
    db.from("marketplace_brands").select("marketplace, brand_id, name, name_norm").like("name_norm", `%${q}%`).limit(15),
    db.from("marketplace_brands").select("marketplace", { count: "exact", head: true }),
  ]);
  if (starts.error) return dbError(starts.error);
  const rows = [...(starts.data ?? []), ...(contains.data ?? [])];
  const byName = new Map<string, { name: string; norm: string; markets: Record<string, number> }>();
  for (const r of rows) {
    const e = byName.get(r.name_norm) ?? { name: r.name, norm: r.name_norm, markets: {} as Record<string, number> };
    e.markets[r.marketplace] = r.brand_id;
    byName.set(r.name_norm, e);
  }
  const results = [...byName.values()].sort((x, y) => Number(y.norm === q) - Number(x.norm === q) || Number(y.norm.startsWith(q)) - Number(x.norm.startsWith(q)) || x.norm.length - y.norm.length).slice(0, 12);
  const loaded = (counts.count ?? 0) > 0;
  const exact: Record<string, boolean | null> = {};
  for (const m of KNOWN) exact[m] = loaded ? results.some((r) => r.norm === q && r.markets[m] != null) : null;
  return NextResponse.json({ results: results.map(({ name, markets }) => ({ name, markets })), exact, loaded });
}
