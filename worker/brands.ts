// Pazaryeri marka listelerini Supabase'e (marketplace_brands) yazar. Panelde marka önerisi ve "var mı" kontrolü için.
// node --experimental-strip-types worker/brands.ts [trendyol]
// Trendyol: GET /product/brands?page=&size=1000 (https://developers.trendyol.com/v3.0/docs/5-trendyol-brand-list-1)
// Hepsiburada marka listesi API'si yok (marka serbest metin, HB eşler); N11/Amazon/ÇiçekSepeti bağlanınca eklenecek.
import { createClient } from "@supabase/supabase-js";
import { env, sleep, chunk } from "./core/util.ts";

const normBrand = (s: string) => s.toLocaleLowerCase("tr").replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u").replace(/\s+/g, " ").trim();

async function trendyolBrands(): Promise<{ id: number; name: string }[]> {
  const sellerId = env("TRENDYOL_SELLER_ID");
  const headers: Record<string, string> = {
    Authorization: "Basic " + Buffer.from(`${env("TRENDYOL_API_KEY")}:${env("TRENDYOL_API_SECRET")}`).toString("base64"),
    "User-Agent": `${sellerId} - SelfIntegration`,
  };
  if (process.env.TRENDYOL_STOREFRONT) headers.storeFrontCode = process.env.TRENDYOL_STOREFRONT;
  const out: { id: number; name: string }[] = [];
  for (let page = 0; page < 2000; page++) {
    let r: Response | null = null;
    for (let t = 0; t < 4; t++) { // 429 / geçici hata: bekle, tekrar dene
      r = await fetch(`https://apigw.trendyol.com/integration/product/brands?page=${page}&size=1000`, { headers });
      if (r.ok) break;
      await sleep(3000 * (t + 1));
    }
    if (!r?.ok) throw new Error(`Trendyol marka listesi ${r?.status}: ${(await r?.text())?.slice(0, 300)}`);
    const list: any[] = (await r.json()).brands ?? [];
    for (const b of list) if (b?.id != null && b?.name) out.push({ id: Number(b.id), name: String(b.name).trim() });
    if (list.length < 1000) break;
    if (page % 50 === 0) console.log(`sayfa ${page}: ${out.length} marka`);
    await sleep(300);
  }
  return out;
}

const SOURCES: Record<string, () => Promise<{ id: number; name: string }[]>> = { trendyol: trendyolBrands };

{
  const mp = process.argv[2] ?? "trendyol";
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const brands = await SOURCES[mp]();
  if (brands.length < 100) throw new Error(`${mp}: yalnızca ${brands.length} marka geldi, tablo güncellenmedi`);
  const now = new Date().toISOString();
  for (const part of chunk(brands, 1000)) {
    const { error } = await db.from("marketplace_brands").upsert(part.map((b) => ({ marketplace: mp, brand_id: b.id, name: b.name, name_norm: normBrand(b.name), updated_at: now })));
    if (error) throw new Error(error.message);
  }
  // Listeden kalkan markaları sil (bu çalışmada güncellenmeyenler)
  await db.from("marketplace_brands").delete().eq("marketplace", mp).lt("updated_at", now);
  console.log(`${mp}: ${brands.length} marka yazıldı`);
}
