// Büyük XML parça parça ayrıştırma (K 20.11): sonuç tüm belgeyle aynı olmalı; model tekrarı varsa parça modu vazgeçer (null)
import { buildItems, buildItemsChunked, parseXml } from "../import-xml.ts";
let fails = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? "OK  " : "FAIL"} ${name}`); if (!ok) { fails++; console.log(info); } };
const sup: any = { code: "t", name: "T", item_path: "urunler.urun", mapping: { stok_kodu: "model", isim: "title", stok: "stock", alis_fiyat: "cost_price", barkod: "barcode", "varyasyonlar.varyasyon.kod": "variant_sku", "varyasyonlar.varyasyon.stok": "stock" }, defaults: {} };
const urun = (i: number, extra = "") => `<urun${extra}><stok_kodu>M${i}</stok_kodu><isim>Ürün ${i} &amp; test</isim><stok>${i % 7}</stok><alis_fiyat>${10 + i}</alis_fiyat><barkod>869000000${String(i).padStart(4, "0")}</barkod></urun>`;
const xml = `<?xml version="1.0"?><urunler>${Array.from({ length: 25 }, (_, i) => urun(i, i % 5 === 0 ? ' id="x"' : "")).join("\n")}</urunler>`;
const whole = buildItems(parseXml(xml), sup), ch = buildItemsChunked(xml, sup, new Set(), new Set(), 4);
check("parça modu sonuç verir", !!ch, ch);
check("ürün sayısı aynı", ch?.items.length === whole.items.length && ch?.total === whole.total, { ch: ch?.items.length, whole: whole.items.length });
check("içerik özeti aynı", JSON.stringify(ch?.items.map((i) => [i.payload.sku, i.hash])) === JSON.stringify(whole.items.map((i) => [i.payload.sku, i.hash])));
check("<urunler> açılışı ürün sanılmaz", !ch?.items.some((i) => /urunler/i.test(i.payload.sku)));
const dup = `<urunler>${urun(1)}${urun(2)}${urun(3)}${urun(1)}</urunler>`;
check("parçalar arası model tekrarı -> vazgeç (null)", buildItemsChunked(dup, sup, new Set(), new Set(), 2) === null);
check("item_path yoksa vazgeç", buildItemsChunked(xml, { ...sup, item_path: "" }) === null);
// Buffer kaynağı (akışla, dilim sınırında yarım öğe) ve değişmeyen ürünün hafif tutulması
{
  const big = Buffer.from(xml, "utf8");
  const chB = buildItemsChunked(big, sup, new Set(), new Set(), 3);
  check("Buffer kaynağı: sonuç metinle aynı", JSON.stringify(chB?.items.map((i) => [i.payload.sku, i.hash])) === JSON.stringify(whole.items.map((i) => [i.payload.sku, i.hash])));
  const known = new Map(whole.items.slice(0, 5).map((i) => [i.payload.sku, i.hash]));
  const slim = buildItemsChunked(big, sup, new Set(), new Set(), 4, known);
  const first = slim?.items.find((i) => i.payload.sku === whole.items[0].payload.sku);
  check("değişmeyen ürün hafif (başlık yok, varyant stokları var)", !!first && first.payload.title === undefined && Array.isArray(first.payload.variants), first);
  check("değişen ürün tam kalır", slim?.items.find((i) => i.payload.sku === whole.items[10].payload.sku)?.payload.title != null);
}
process.exit(fails ? 1 : 0);
