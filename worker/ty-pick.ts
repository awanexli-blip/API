// Trendyol'daki onaylı ilanlardan seçim (K 16.11: "trendyoldan seçtiğim ürünleri hepsiburadaya ekle", ör. Racing ayakkabılar). SALT OKUNUR.
//   node --experimental-strip-types worker/ty-pick.ts [--brand REGEX] [--title REGEX] [--barcodes A,B,...] [--out dosya.json]
// Çıktı: içerik başına tam kayıt (başlık, marka, kategori, açıklama, görseller, özellikler, varyantlar: barkod, stok kodu, fiyat, stok, özellik).
import { writeFileSync } from "node:fs";
import { env, sleep } from "./core/util.ts";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const brandRe = arg("--brand") ? new RegExp(arg("--brand")!, "iu") : null;
const titleRe = arg("--title") ? new RegExp(arg("--title")!, "iu") : null;
const barcodes = new Set((arg("--barcodes") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
if (!brandRe && !titleRe && !barcodes.size) throw new Error("--brand, --title ya da --barcodes gerekli");
const OUT = arg("--out") ?? "/var/lib/trentakip/claude-home/ty-pick.json";

const SELLER_ID = env("TRENDYOL_SELLER_ID");
const H: Record<string, string> = { Authorization: "Basic " + Buffer.from(`${env("TRENDYOL_API_KEY")}:${env("TRENDYOL_API_SECRET")}`).toString("base64"), "User-Agent": `${SELLER_ID} - SelfIntegration` };
async function get(path: string) {
  for (let i = 0; ; i++) {
    const r = await fetch(`https://apigw.trendyol.com/integration${path}`, { headers: H, signal: AbortSignal.timeout(60000) }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }) as any);
    if (r.ok) return r.json();
    if (i >= 3 || (r.status && r.status < 500 && r.status !== 429)) throw new Error(`Trendyol ${r.status}: ${(await r.text()).slice(0, 200)}`);
    await sleep(3000 * (i + 1));
  }
}
const attrs = (l: any[]) => (l ?? []).map((a: any) => ({ id: a.attributeId, name: a.attributeName, value: a.attributeValue ?? a.customAttributeValue, valueId: a.attributeValueId ?? null }));
const picked: any[] = [];
let page = 0, token = "", seen = 0;
for (;;) {
  const q = token ? `size=100&nextPageToken=${encodeURIComponent(token)}` : `page=${page}&size=100`;
  const r = await get(`/product/sellers/${SELLER_ID}/products/approved?${q}`);
  const content: any[] = r.content ?? [];
  for (const c of content) {
    seen++;
    const vs = c.variants ?? [];
    const hit = (brandRe && brandRe.test(String(c.brand?.name ?? ""))) || (titleRe && titleRe.test(String(c.title ?? ""))) || vs.some((v: any) => barcodes.has(String(v.barcode)));
    if (!hit) continue;
    picked.push({ contentId: c.contentId, productMainId: c.productMainId, title: c.title, brand: c.brand?.name, brandId: c.brand?.id, category: c.category?.name, categoryId: c.category?.id,
      description: c.description, images: (c.images ?? []).map((i: any) => String(i?.url ?? i)), attributes: attrs(c.attributes),
      variants: vs.map((v: any) => ({ barcode: v.barcode, stockCode: v.stockCode, price: Number(v.price?.salePrice), listPrice: Number(v.price?.listPrice), stock: Number(v.stock?.quantity), vatRate: v.vatRate,
        closed: !!(v.locked || v.archived || v.blacklisted), onSale: v.onSale, attributes: attrs(v.attributes) })) });
  }
  await sleep(300);
  if (!content.length) break;
  if (token) { token = r.nextPageToken ?? ""; if (!token) break; continue; }
  page++;
  if (page >= (r.totalPages ?? 0)) break;
  if (page * 100 >= 10000) { token = r.nextPageToken ?? ""; if (!token) break; }
  if (page % 50 === 0) console.error(`${seen} içerik tarandı, seçilen ${picked.length}`);
}
writeFileSync(OUT, JSON.stringify(picked, null, 1));
console.log(JSON.stringify({ taranan: seen, secilen: picked.length, varyant: picked.reduce((t, p) => t + p.variants.length, 0), cikti: OUT }));
for (const p of picked) console.log(`${p.brand} | ${String(p.title).slice(0, 70)} | ${p.category} | ${p.variants.map((v: any) => `${v.price}TL/${v.stock}`).join(", ")}`);
