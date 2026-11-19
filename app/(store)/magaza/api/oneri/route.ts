// Vitrin arama önerileri (K 19.11): yazarken ilk 6 ürün + eşleşen kategoriler. Herkese açık, salt okunur, yalnızca vitrin kataloğu.
// Vitrin alan adında /api/oneri olarak açılır (proxy /magaza altına yazar); panelde /magaza/api/oneri.
import { searchTerm } from "@/lib/store";
import { list } from "@/lib/store-data";

export async function GET(req: Request) {
  const q = searchTerm(new URL(req.url).searchParams.get("q"));
  if (!q) return Response.json({ items: [], cats: [], total: 0 });
  try {
    const r = await list({ q, sort: "onerilen", page: 1, size: 6 });
    return Response.json(
      { items: r.items.map((i) => ({ slug: i.slug, title: i.title, price: i.price, image: i.image })), cats: (r.facets?.cats ?? []).slice(0, 4), total: r.total, fuzzy: r.fuzzy },
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  } catch (e) {
    console.error("vitrin öneri:", e instanceof Error ? e.message : e);
    return Response.json({ error: "Öneriler şu an alınamadı" }, { status: 503 });
  }
}
