// Pazaryeri kategori ağacı ve kategori özellikleri (ürün formu: kategori seçimi + zorunlu özellikler). Yalnızca sunucuda; içe aktarma yok
// (panel API ve worker/catalog.ts birlikte kullanır). Trendyol: herkese açık uçlar. Hepsiburada: HB_* ortam değişkenleri (GitHub Secrets'ta var;
// Vercel'de yoksa panel isteği iş kuyruğuna yazar, worker/catalog.ts GitHub Actions'ta çeker).
// Sonuçlar Supabase'de önbellekte (mp_categories, mp_category_attrs; migration 055), 7 günde bir yenilenir.

export type MpAttr = { id: string; name: string; required: boolean; variant: boolean; slicer: boolean; custom: boolean; values: string[] };
export type MpCategory = { id: string; name: string; path: string };

const TTL_MS = 7 * 24 * 3600 * 1000;
const TY = "https://apigw.trendyol.com/integration/product";
const lo = (s: string) => s.replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr");
// Arama biçimi: küçük harf, Türkçe harfler sadeleştirilmiş, noktalama boşluk
export const normPath = (s: string) => lo(s).replace(/[çğıöşü]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" })[c]!).replace(/[^a-z0-9]+/g, " ").trim();

async function getJson(url: string, headers: Record<string, string> = {}, timeout = 30000) {
  const r = await fetch(url, { headers: { "User-Agent": "urun-paneli", Accept: "application/json", ...headers }, signal: AbortSignal.timeout(timeout) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${url.replace(/^https:\/\/[^/]+/, "").slice(0, 80)}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

// ---- Hepsiburada istemcisi (worker/marketplaces/hepsiburada.ts ile aynı uçlar) ----
export const hbConfigured = () => !!(process.env.HB_MERCHANT_ID && process.env.HB_USERNAME && process.env.HB_PASSWORD);
function hbGet(path: string) {
  const prod = process.env.HB_ENV === "prod";
  const auth = "Basic " + Buffer.from(`${process.env.HB_USERNAME}:${process.env.HB_PASSWORD}`).toString("base64");
  return getJson(`https://mpop${prod ? "" : "-sit"}.hepsiburada.com${path}`, { Authorization: auth, "User-Agent": process.env.HB_USER_AGENT || process.env.HB_USERNAME! });
}
function firstArray(r: any): any[] {
  if (Array.isArray(r)) return r;
  for (const k of ["data", "content", "items", "categories", "attributes", "values"]) if (Array.isArray(r?.[k])) return r[k];
  if (r?.data && typeof r.data === "object") return firstArray(r.data);
  return [];
}
// HB'nin pazaryeri alanlarından doldurduğu temel özellikler formda ayrıca sorulmaz (ad, açıklama, marka, fiyat, stok, görseller, KDV...)
const HB_BASE = new Set(["merchantsku", "varyantgroupid", "barcode", "urunadi", "urunaciklamasi", "marka", "garantisuresi", "kg", "tax_vat_rate", "price", "stock", "video1"]);
const isImageAttr = (s: string) => /^(görsel|gorsel|image)\s*\d+$/i.test(lo(s).trim());

// ---- Kategori ağacı (yapraklar) ----
async function fetchLeaves(mp: string): Promise<MpCategory[]> {
  if (mp === "trendyol") {
    const out: MpCategory[] = [];
    const walk = (n: any, path: string[]) => {
      const p = [...path, String(n.name)];
      if (!n.subCategories?.length) out.push({ id: String(n.id), name: String(n.name), path: p.join(" > ") });
      for (const c of n.subCategories ?? []) walk(c, p);
    };
    for (const c of (await getJson(`${TY}/product-categories`, {}, 60000)).categories ?? []) walk(c, []);
    return out;
  }
  if (mp === "hepsiburada") {
    if (!hbConfigured()) throw new Error("HB_NOT_CONFIGURED");
    const out: MpCategory[] = [];
    for (let page = 0; page < 30; page++) {
      const r = await hbGet(`/product/api/categories/get-all-categories?leaf=true&status=ACTIVE&available=true&version=1&page=${page}&size=1000`);
      const list = firstArray(r);
      for (const x of list) {
        const name = String(x.name ?? x.displayName ?? "");
        const path: string[] = Array.isArray(x.paths) ? x.paths.map(String) : typeof x.paths === "string" ? x.paths.split(">").map((s: string) => s.trim()) : [];
        if (name) out.push({ id: String(x.categoryId ?? x.id), name, path: (path[path.length - 1] === name ? path : [...path, name]).join(" > ") });
      }
      if (list.length < 1000 || (r?.totalPages && page + 1 >= r.totalPages)) break;
    }
    return out;
  }
  throw new Error("Bu pazaryeri için kategori ağacı yok");
}

// Ağaç önbellekte yoksa ya da 7 günden eskiyse yenilenir
export async function ensureCategories(db: any, mp: string) {
  const { data } = await db.from("mp_categories").select("updated_at").eq("marketplace", mp).order("updated_at", { ascending: true }).limit(1);
  const fresh = data?.[0] && Date.now() - new Date(data[0].updated_at).getTime() < TTL_MS;
  if (fresh) return;
  const leaves = await fetchLeaves(mp);
  if (!leaves.length) throw new Error("Pazaryeri kategori ağacı boş döndü");
  const now = new Date().toISOString();
  for (let i = 0; i < leaves.length; i += 1000) {
    const { error } = await db.from("mp_categories").upsert(leaves.slice(i, i + 1000).map((c) => ({ marketplace: mp, ...c, path_norm: normPath(c.path), updated_at: now })), { onConflict: "marketplace,id" });
    if (error) throw new Error(error.message);
  }
}

// ---- Kategori özellikleri ----
async function fetchAttrs(mp: string, cid: string): Promise<MpAttr[]> {
  if (mp === "trendyol") {
    const r = await getJson(`${TY}/product-categories/${encodeURIComponent(cid)}/attributes`);
    return (r.categoryAttributes ?? []).map((a: any) => ({
      id: String(a.attribute?.id), name: String(a.attribute?.name ?? a.attribute?.id), required: !!a.required, variant: !!a.varianter, slicer: !!a.slicer,
      custom: !!a.allowCustom, values: (a.attributeValues ?? []).map((v: any) => String(v.name)),
    }));
  }
  if (mp === "hepsiburada") {
    if (!hbConfigured()) throw new Error("HB_NOT_CONFIGURED");
    const r = await hbGet(`/product/api/categories/${encodeURIComponent(cid)}/attributes`);
    const d = r?.data ?? r;
    const groups: [string, any[]][] = [["base", d?.baseAttributes ?? []], ["category", d?.attributes ?? []], ["variant", d?.variantAttributes ?? []]];
    if (!groups.some(([, l]) => l.length)) groups.push(["category", firstArray(d)]);
    const list = groups.flatMap(([g, l]) => l.map((a: any) => ({ g, id: String(a.id ?? a.attributeId ?? a.name), name: String(a.name ?? a.displayName ?? a.id), mandatory: !!(a.mandatory ?? a.required), type: String(a.type ?? "") })))
      .filter((a) => !HB_BASE.has(lo(a.id)) && !isImageAttr(a.name) && !isImageAttr(a.id));
    // Değer listeleri (enum): 4'erli paralel
    const out: MpAttr[] = [];
    for (let i = 0; i < list.length; i += 4) {
      out.push(...await Promise.all(list.slice(i, i + 4).map(async (a) => {
        let values: string[] = [];
        if (!/string|text|number|integer|decimal/i.test(a.type) || /enum/i.test(a.type)) {
          // Sayfalı (renk listesi binlerce değer): 1000'erli, en çok 10 sayfa
          try {
            for (let page = 0; page < 10; page++) {
              const list = firstArray(await hbGet(`/product/api/categories/${encodeURIComponent(cid)}/attribute/${encodeURIComponent(a.id)}/values?version=4&page=${page}&size=1000`));
              values.push(...list.map((v: any) => String(v.value ?? v.name ?? v)));
              if (list.length < 1000) break;
            }
            values = [...new Set(values)];
          } catch { /* serbest metin */ }
        }
        return { id: a.id, name: a.name, required: a.mandatory, variant: a.g === "variant", slicer: false, custom: values.length === 0, values };
      })));
    }
    return out;
  }
  throw new Error("Bu pazaryeri için özellik listesi yok");
}

// Önbellekteki özellikler (yoksa null); stale = 7 günden eski
export async function cachedAttrs(db: any, mp: string, cid: string): Promise<{ attrs: MpAttr[]; stale: boolean } | null> {
  const { data } = await db.from("mp_category_attrs").select("attrs, fetched_at").eq("marketplace", mp).eq("category_id", cid).maybeSingle();
  return data ? { attrs: data.attrs as MpAttr[], stale: Date.now() - new Date(data.fetched_at).getTime() >= TTL_MS } : null;
}
export async function hasCategories(db: any, mp: string) {
  const { count } = await db.from("mp_categories").select("id", { count: "exact", head: true }).eq("marketplace", mp);
  return (count ?? 0) > 0;
}

export async function getAttrs(db: any, mp: string, cid: string, refresh = false): Promise<MpAttr[]> {
  if (!refresh) {
    const c = await cachedAttrs(db, mp, cid);
    if (c && !c.stale) return c.attrs;
  }
  const attrs = await fetchAttrs(mp, cid);
  await db.from("mp_category_attrs").upsert({ marketplace: mp, category_id: cid, attrs, fetched_at: new Date().toISOString() }, { onConflict: "marketplace,category_id" });
  return attrs;
}
