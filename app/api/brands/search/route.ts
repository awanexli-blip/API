import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/server";
import { authorize, dbError } from "@/lib/products";

export const dynamic = "force-dynamic";

// Marka listesi önbelleği olan pazaryerleri (worker/brands.ts). Diğerleri "bilinmiyor" döner.
const KNOWN = ["trendyol"];
const norm = (s: string) => s.toLocaleLowerCase("tr").replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u").replace(/\s+/g, " ").trim();

// Marka listesi (807 bin satır, ~200 MB) ücretsiz veritabanına sığmadığı için indirilmiyor (K, 25.10). Liste boşken arama canlı
// Trendyol marka ucundan yapılır (herkese açık, kimlik istemez, ada göre önek araması). Sonuçlar marketplace_brands'e YAZILMAZ:
// tablo dolu görünürse worker listede olmayan markaları "yok" sayar (db-products brandOk). Kısa süreli bellek önbelleği.
const live = new Map<string, { at: number; list: { id: number; name: string }[] }>();
async function trendyolByName(q: string): Promise<{ id: number; name: string }[]> {
  const hit = live.get(q);
  if (hit && Date.now() - hit.at < 3600_000) return hit.list;
  const r = await fetch(`https://apigw.trendyol.com/integration/product/brands/by-name?name=${encodeURIComponent(q)}`, {
    headers: { "User-Agent": "urun-paneli", Accept: "application/json" }, signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`Trendyol marka araması ${r.status}`);
  const j: any = await r.json();
  const list = (Array.isArray(j) ? j : j?.brands ?? []).filter((b: any) => b?.id != null && b?.name).map((b: any) => ({ id: Number(b.id), name: String(b.name).trim() }));
  if (live.size > 500) live.clear();
  live.set(q, { at: Date.now(), list });
  return list;
}

// ?q=  -> { results: [{ name, markets: { trendyol: id } }], exact: { trendyol: true|false|null }, loaded, source }
export async function GET(req: NextRequest) {
  const a = await authorize(req, "viewer");
  if (a instanceof NextResponse) return a;
  const raw = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  const q = norm(raw).replace(/[%_\\]/g, "");
  if (q.length < 2) return NextResponse.json({ results: [], exact: {} });
  const db = admin();

  const counts = await db.from("marketplace_brands").select("marketplace", { count: "planned", head: true }); // yalnızca "liste çekildi mi": tahmini sayı yeter
  if (counts.error) return dbError(counts.error);
  const loaded = (counts.count ?? 0) > 0;
  const byName = new Map<string, { name: string; norm: string; markets: Record<string, number> }>();
  let source = "liste";
  if (loaded) {
    const [starts, contains] = await Promise.all([
      db.from("marketplace_brands").select("marketplace, brand_id, name, name_norm").like("name_norm", `${q}%`).order("name_norm").limit(15),
      db.from("marketplace_brands").select("marketplace, brand_id, name, name_norm").like("name_norm", `%${q}%`).limit(15),
    ]);
    if (starts.error) return dbError(starts.error);
    for (const r of [...(starts.data ?? []), ...(contains.data ?? [])]) {
      const e = byName.get(r.name_norm) ?? { name: r.name, norm: r.name_norm, markets: {} as Record<string, number> };
      e.markets[r.marketplace] = r.brand_id;
      byName.set(r.name_norm, e);
    }
  } else {
    source = "canli";
    try {
      for (const b of await trendyolByName(raw)) {
        const n = norm(b.name);
        const e = byName.get(n) ?? { name: b.name, norm: n, markets: {} as Record<string, number> };
        e.markets.trendyol = b.id;
        byName.set(n, e);
      }
    } catch (e: any) {
      // Canlı arama olmazsa "bilinmiyor" (kullanıcı markayı yine yazabilir; gönderimde Trendyol doğrular)
      return NextResponse.json({ results: [], exact: { trendyol: null }, loaded: false, source: "yok", error: String(e?.message ?? e).slice(0, 120) });
    }
  }
  const results = [...byName.values()].sort((x, y) => Number(y.norm === q) - Number(x.norm === q) || Number(y.norm.startsWith(q)) - Number(x.norm.startsWith(q)) || x.norm.length - y.norm.length).slice(0, 12);
  // "Var" = gönderimde kabul edilecek ad: worker (trendyol.ts brandId) birebir adı Türkçe küçük harfle karşılaştırır ("Cicek" ≠ "Çiçek")
  const exactName = raw.toLocaleLowerCase("tr");
  const exact: Record<string, boolean | null> = {};
  for (const m of KNOWN) exact[m] = results.some((r) => r.name.toLocaleLowerCase("tr") === exactName && r.markets[m] != null);
  return NextResponse.json({ results: results.map(({ name, markets }) => ({ name, markets })), exact, loaded, source });
}
