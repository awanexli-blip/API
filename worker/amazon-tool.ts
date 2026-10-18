// Amazon TR test aracı. GitHub Actions > "Amazon test aracı" ile çalışır. Kılavuz: docs/AMAZON_KURULUM.md
// node --experimental-strip-types worker/amazon-tool.ts <komut> [argümanlar]
//   ping                          giriş (LWA) + satıcının pazaryerleri (Türkiye görünmeli)
//   search <EAN | kelimeler>      katalogda ara (EAN 8/12/13/14 hane ise barkodla, değilse kelimeyle)
//   listings                      mağazadaki ilanlar (rapor; ilk 20 satır + toplam)
//   offer <SKU> <ASIN> <fiyat> <adet>   tek ürün teklif aç (var olan ASIN'e, yeni durumda)
//   validate <SKU> <ASIN> <fiyat> <adet> teklifi Amazon'a göndermeden doğrula (VALIDATION_PREVIEW: alan bazında hatalar)
//   item <SKU>                    ilanın Amazon'daki durumu ve sorunları
//   delete <SKU> [SKU...]         ilanı Amazon'dan sil (gizli/eksik kalan SKU'ları temizlemek için)
//   stock <SKU> <adet>            stok güncelle
//   price <SKU> <fiyat>           fiyat güncelle (KDV dahil TL)
//   feed <feedId>                 feed durumu ve sonuç raporu
// Ortam: AMAZON_LWA_CLIENT_ID, AMAZON_LWA_CLIENT_SECRET, AMAZON_REFRESH_TOKEN, AMAZON_SELLER_ID
import { writeFileSync } from "node:fs";
import { amazonClient, createAmazon, issuesText, offerBody } from "./marketplaces/amazon.ts";

const [cmd = "ping", ...args] = process.argv.slice(2);
const out: any = { command: cmd, args, at: new Date().toISOString() };
const log = (title: string, data?: unknown) => {
  console.log(`\n=== ${title}`);
  if (data !== undefined) console.log(typeof data === "string" ? data : JSON.stringify(data, null, 1).slice(0, 8000));
  (out.steps ??= []).push({ title, data });
};
const need = (n: number, usage: string) => { if (args.length < n) throw new Error(`kullanım: ${cmd} ${usage}`); };

try {
  const c = amazonClient();
  const mp = createAmazon();
  if (cmd === "ping") {
    await c.accessToken();
    log("Giriş (LWA) başarılı");
    const r = await c.sp("/sellers/v1/marketplaceParticipations");
    const list = (r.payload ?? []).map((x: any) => ({ id: x.marketplace?.id, ülke: x.marketplace?.countryCode, ad: x.marketplace?.name, satışta: x.participation?.isParticipating }));
    log("Satıcının pazaryerleri", list);
    log(list.some((x: any) => x.id === c.MKT) ? "✓ Amazon Türkiye hesabı bağlı" : "✗ Türkiye pazaryeri listede yok: Seller Central hesabını kontrol et");
  } else if (cmd === "search") {
    need(1, "<EAN | kelimeler>");
    const q = args.join(" ");
    const r = /^\d{8}$|^\d{12,14}$/.test(q) ? await c.searchCatalog({ ean: q }) : await c.searchCatalog({ title: q });
    log(`Katalog sonuçları (${r.length})`, r);
  } else if (cmd === "listings") {
    const l = await mp.loadListings();
    log(`Mağazadaki ilanlar: ${l.length}`, l.slice(0, 20));
  } else if (cmd === "offer") {
    need(4, "<SKU> <ASIN> <fiyat> <adet>");
    const [sku, asin, price, qty] = args;
    const r = await mp.createProducts([{ id: sku, asin, price: Number(price), qty: Number(qty), name: sku, detail: "", brand: "", productCode: sku, desi: 1, images: [], cat: {} }], { vatRate: 20, skip: (w) => log("Atlandı", w) });
    log(r.ok ? "✓ Teklif kabul edildi (Amazon işliyor; birkaç dakika sonra 'item' ile bak)" : "✗ Teklif reddedildi", r.failedItems?.length ? r.failedItems : r);
  } else if (cmd === "validate") {
    need(4, "<SKU> <ASIN> <fiyat> <adet>");
    const [sku, asin, price, qty] = args;
    const r = await c.sp(`/listings/2021-08-01/items/${encodeURIComponent(c.SELLER)}/${encodeURIComponent(sku)}?marketplaceIds=${c.MKT}&issueLocale=tr_TR&mode=VALIDATION_PREVIEW`, { method: "PUT", body: JSON.stringify(offerBody(c.MKT, { asin, price: Number(price), qty: Number(qty) })) });
    log(`Doğrulama: ${r.status}`, r.issues?.length ? r.issues : "sorun yok");
    if (r.status !== "VALID" && r.status !== "ACCEPTED") log("Özet", issuesText(r.issues));
  } else if (cmd === "delete") {
    need(1, "<SKU> [SKU...]");
    for (const sku of args) {
      try { const r = await c.sp(`/listings/2021-08-01/items/${encodeURIComponent(c.SELLER)}/${encodeURIComponent(sku)}?marketplaceIds=${c.MKT}`, { method: "DELETE" }); log(`${sku}: ${r.status ?? "silindi"}`, r.issues?.length ? r.issues : undefined); }
      catch (e: any) { log(`${sku}: hata`, String(e?.message ?? e)); }
    }
  } else if (cmd === "item") {
    need(1, "<SKU>");
    const r = await c.sp(`/listings/2021-08-01/items/${encodeURIComponent(c.SELLER)}/${encodeURIComponent(args[0])}?marketplaceIds=${c.MKT}&issueLocale=tr_TR&includedData=summaries,issues,offers,fulfillmentAvailability`);
    log("İlan", r);
  } else if (cmd === "stock") {
    need(2, "<SKU> <adet>");
    const r = await mp.pushInventory([{ id: args[0], quantity: Number(args[1]), price: null }]); // price: null = fiyata dokunma
    log("Feed gönderildi", r);
    if (r.batchIds[0]) log("Sonuç", await mp.checkBatches!(r.batchIds));
  } else if (cmd === "price") {
    need(2, "<SKU> <fiyat>");
    // Yalnızca fiyat (stoğa dokunmaz)
    const id = await c.submitFeed([{ messageId: 1, sku: args[0], operationType: "PATCH", productType: "PRODUCT", patches: [{ op: "replace", path: "/attributes/purchasable_offer", value: [{ marketplace_id: c.MKT, currency: "TRY", our_price: [{ schedule: [{ value_with_tax: Number(args[1]) }] }] }] }] }]);
    log("Feed gönderildi", { feedId: id });
    log("Sonuç", await mp.checkBatches!([id]));
  } else if (cmd === "feed") {
    need(1, "<feedId>");
    const f = await c.sp(`/feeds/2021-06-30/feeds/${args[0]}`);
    log("Feed", f);
    if (f.resultFeedDocumentId) log("Sonuç raporu", JSON.parse(await c.download(await c.sp(`/feeds/2021-06-30/documents/${f.resultFeedDocumentId}`))));
  } else throw new Error(`bilinmeyen komut: ${cmd}`);
  out.ok = true;
} catch (e: any) {
  out.ok = false;
  log("HATA", String(e?.message ?? e));
  process.exitCode = 1;
}
writeFileSync("amazon_tool_output.json", JSON.stringify(out, null, 1));
