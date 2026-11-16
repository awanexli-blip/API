// Trendyol'daki kendi ürünlerini Hepsiburada'da aç (K 16.11: Racıng ayakkabılar, fiyat 999 TL, beden başına stok 20).
// Girdi: worker/ty-pick.ts çıktısı (JSON). Varsayılan DENEME: HB'ye hiçbir şey gitmez, gidecek olan yazılır. --send ile gerçek gönderim.
//   node --experimental-strip-types worker/ty-to-hb.ts <ty-pick.json> --category 204249 --price 999 --stock 20 [--brand Racing] [--only 1400089482,...] [--send]
// Kendi ürünü: ürün veritabanına eklenmez, senkron fiyat/stoğa dokunmaz (isOwnListing: başlıkta marka). Barkod = Trendyol barkodu.
import { readFileSync } from "node:fs";
import { getMarketplace } from "./marketplaces/index.ts";
import type { NewProduct } from "./marketplaces/types.ts";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const file = process.argv[2];
const cat = arg("--category"), price = Number(arg("--price")), stock = Number(arg("--stock"));
if (!file || !cat || !(price > 0) || !(stock >= 0)) throw new Error("kullanım: ty-to-hb.ts <json> --category ID --price TL --stock N [--brand AD] [--only barkodlar] [--send]");
const only = new Set((arg("--only") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const SEND = process.argv.includes("--send");
if (!SEND) process.env.SEND_DRY = "1";

const picked: any[] = JSON.parse(readFileSync(file, "utf8"));
const brandName = arg("--brand") ?? picked[0]?.brand;
const val = (list: any[], re: RegExp) => list.find((a) => re.test(String(a.name ?? "")))?.value as string | undefined;
const items: NewProduct[] = [];
for (const c of picked) {
  const color = val(c.attributes, /^renk$/i);
  // Başlık: marka + Trendyol başlığı (+ renk, başlıkta yoksa). Marka başlıkta: senkron bunu kendi ürünü sayar, dokunmaz
  let name = `${c.brand} ${c.title}`.replace(/\s+/g, " ").trim();
  if (color && !name.toLocaleLowerCase("tr").includes(color.toLocaleLowerCase("tr"))) name += ` ${color}`;
  const defaults: Record<string, string> = {};
  for (const a of c.attributes) if (a.name && a.value != null && !(a.name in defaults)) defaults[a.name] = String(a.value);
  for (const v of c.variants) {
    if (v.closed || (only.size && !only.has(String(v.barcode)))) continue;
    const size = val(v.attributes, /beden|numara/i) ?? v.attributes[0]?.value;
    items.push({ id: String(v.barcode), name, detail: c.description || name, brand: c.brand, productCode: String(v.barcode), desi: 2, images: c.images,
      cat: { category_id: cat, vat_rate: Number(v.vatRate ?? 20) }, defaults: { ...defaults, ...(size ? { Beden: String(size), Numara: String(size) } : {}) },
      catName: "Sneakers", xmlCategory: `Ayakkabı > ${c.category ?? ""}`, groupId: `RCG${c.contentId}`.slice(0, 40), price, qty: stock });
  }
}
console.log(`${SEND ? "GÖNDERİM" : "DENEME"}: ${items.length} beden, ${new Set(items.map((i) => i.groupId)).size} ürün, marka ${brandName}, kategori ${cat}, ${price} TL, stok ${stock}`);
const hb = getMarketplace("hepsiburada");
const skips: string[] = [];
const r = await hb.createProducts(items, { vatRate: 20, skip: (w) => skips.push(w), brandName });
const fails = (r.failedItems ?? []).filter((f) => !/^DENEME/.test(f.reason));
console.log(JSON.stringify({ gonderilen: r.ok, basarisizIstek: r.failed, batch: r.batchIds, hatali: fails.length }));
for (const f of fails) console.log(`HATA ${f.id}: ${f.reason}`);
if (SEND && r.batchIds.length && hb.checkBatches) {
  const c = await hb.checkBatches(r.batchIds);
  console.log(JSON.stringify({ kontrol: c.checked, bekleyen: c.pending, hataliUrun: c.failedItems, durumlar: (c as any).statuses ?? {}, nedenler: c.reasons.slice(0, 10) }));
}
