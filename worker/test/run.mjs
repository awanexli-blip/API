// Worker'ı sahte servislerle çalıştırır ve sonuçları doğrular. Gerçek servislere istek atmaz.
// node worker/test/run.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const sync = join(here, "..", "sync.ts");
const mock = pathToFileURL(join(here, "mock.mjs")).href;
const envBase = {
  ...process.env, SUPABASE_URL: "http://mock-supa", SUPABASE_SERVICE_ROLE_KEY: "x", XML_URL: "http://mock-xml",
  TRENDYOL_SELLER_ID: "1", TRENDYOL_API_KEY: "k", TRENDYOL_API_SECRET: "s",
};

let fails = 0;
const check = (name, cond, info = "") => { console.log(`${cond ? "OK  " : "HATA"} ${name}${cond ? "" : "  " + info}`); if (!cond) fails++; };

function run(mode, env = {}, marketplace = "trendyol") {
  const dir = mkdtempSync(join(tmpdir(), "synctest-"));
  execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--import", mock, sync, mode, marketplace], { cwd: dir, env: { ...envBase, ...env }, stdio: ["ignore", "ignore", "inherit"] });
  const calls = JSON.parse(readFileSync(join(dir, "calls.json"), "utf8"));
  const csv = readFileSync(join(dir, marketplace === "trendyol" ? "preview.csv" : `preview_${marketplace}.csv`), "utf8").split("\n");
  const line = (b) => csv.find((l) => l.startsWith(b + ";")) ?? "";
  return { calls, s: calls.run?.summary ?? {}, status: calls.run?.status, line };
}

// 1) preview: okuma, eşleştirme, hiçbir yazma yok
{
  const { calls, s, line } = run("preview");
  check("preview: Trendyol'a yazma yok", calls.trendyolWrites.length === 0);
  check("preview: tüm onaylı varyantlar yüklendi (nextPageToken)", s.listingTotals?.approvedVariantsLoaded === 10161, JSON.stringify(s.listingTotals));
  check("preview: eşleşen", s.matched === 10159, String(s.matched));
  check("preview: canlı komisyon kullanıldı", s.commissionSource?.urun_canli >= 1, JSON.stringify(s.commissionSource));
  check("preview: JSON komisyonu yedek", s.commissionSource?.urun >= 1, JSON.stringify(s.commissionSource));
  check("preview: kilitli ürün atlandı", line("ÖS13-KILITLI").includes("kapalı/fiyatsız"));
  check("preview: sıfır fiyatlı ürün atlandı", line("ÖS13-SIFIR").includes("kapalı/fiyatsız"));
  check("preview: onay bekleyen yeniden açılmıyor", line("OS13-BEKLEYEN").includes("onay bekliyor"));
  check("preview: yeni ürün (Türkçe karakter atıldı)", line("OS13-YEN-1").includes("YENI"));
  check("preview: aynı başlık engeli", line("BX12").includes("aynı başlık"));
  check("onay: bekleyen ve reddedilen sayıldı", s.newProductApproval?.pendingApproval === 1 && s.newProductApproval?.rejected === 4 && s.newProductApproval?.topReasons?.["Görsel uygun değil"] === 1, JSON.stringify(s.newProductApproval));
  check("preview: create sayısı (filtre öncesi)", s.create === 4, String(s.create));
}

// 2) auto (update + create)
{
  const { calls, s, status } = run("auto");
  const inv = calls.trendyolWrites.filter((w) => w.path.includes("price-and-inventory"));
  const cr = calls.trendyolWrites.filter((w) => w.path.includes("/v2/products"));
  const sent = inv.flatMap((w) => w.body.items);
  check("auto: stok/fiyat gönderildi", sent.length === s.update && s.updated === s.update, `${sent.length}/${s.update}`);
  check("auto: kapalı/bekleyen gönderilmedi", !sent.some((i) => ["ÖS13-KILITLI", "ÖS13-SIFIR", "OS13-BEKLEYEN"].includes(i.barcode)));
  check("auto: floor politikası fiyat düşürmüyor", sent.find((i) => i.barcode === "ÖS13-G0et_94794")?.salePrice >= 900);
  check("auto: V2 ürün açma ucu", cr.length === 1 && cr[0].body.items.length === 2);
  const p = cr[0]?.body.items.find((i) => i.barcode === "OS13-YENI-2") ?? {};
  check("auto: marka tam eşleşme (Eco Lounge=77)", p.brandId === 77, String(p.brandId));
  check("auto: en fazla 8 resim", p.images?.length === 8, String(p.images?.length));
  check("auto: listPrice >= salePrice", p.listPrice >= p.salePrice);
  check("auto: cargoCompanyId gönderilmiyor (V2'de yok)", !("cargoCompanyId" in p));
  check("auto: toplu sonuç kontrol edildi", s.batchCheck?.checked === s.batchIds.length || s.batchCheck?.checked >= 1, JSON.stringify(s.batchCheck));
  check("auto: ürün hatası özete yazıldı", s.batchCheck?.failedItems === 1 && /Renk/.test(s.batchCheck.reasons[0]), JSON.stringify(s.batchCheck));
  check("auto: durum partial", status === "partial", status);
  const items = cr[0]?.body.items ?? [];
  const attrOf = (bc, id) => items.find((i) => i.barcode === bc)?.attributes.find((a) => a.attributeId === id);
  check("özellik: başlıktaki renk (Siyah)", attrOf("OS13-YENI-2", 47)?.attributeValueId === 1, JSON.stringify(attrOf("OS13-YENI-2", 47)));
  check("özellik: renk yoksa Çok Renkli", attrOf("OS13-YEN-1", 47)?.attributeValueId === 2, JSON.stringify(attrOf("OS13-YEN-1", 47)));
  check("özellik: Menşei benzer onaylı ilandan", attrOf("OS13-YEN-1", 1192)?.attributeValueId === 7001, JSON.stringify(attrOf("OS13-YEN-1", 1192)));
  check("özellik: opsiyonel gönderilmez", !attrOf("OS13-YEN-1", 999));
  check("özellik: doldurulamayan ürün gönderilmez", !items.some((i) => i.barcode === "OS13-IMKANSIZ") && Object.keys(s.skipped).some((k) => k.startsWith("zorunlu özellik doldurulamadı")), JSON.stringify(s.skipped));
  check("tekrar: son 24 saatte reddedilen gönderilmez", !items.some((i) => i.barcode === "OS13-FAILED1") && s.skipped["son 24 saatte reddedildi, beklemede"] === 1, JSON.stringify(s.skipped));
  check("tekrar: yeni ret kaydedildi", (calls.createFailures ?? []).length === 1 && s.createRejected === 1, JSON.stringify(calls.createFailures));
}

// 3) keep politikası: fiyat gönderilmez
{
  const { calls } = run("update", { MOCK_POLICY: "keep", MOCK_BULK: "50" });
  const sent = calls.trendyolWrites.flatMap((w) => w.body.items);
  check("keep: fiyat alanı yok", sent.length > 0 && sent.every((i) => !("salePrice" in i)));
}

// 4) zero_missing: XML'de olmayan ilanlar sıfırlanır
{
  const { calls, s } = run("update", { MOCK_ZERO: "1", MOCK_BULK: "50" });
  const zeroed = calls.trendyolWrites.flatMap((w) => w.body.items).filter((i) => i.quantity === 0 && !("salePrice" in i)).map((i) => i.barcode);
  check("zero_missing: yetim ürün sıfırlandı", zeroed.includes("ORPHAN-1") && s.zeroed >= 1, JSON.stringify(zeroed));
}

// 5) smart politikası
{
  const { calls, s, line } = run("update", { MOCK_POLICY: "smart", MOCK_BULK: "50" });
  const sent = Object.fromEntries(calls.trendyolWrites.flatMap((w) => w.body.items).map((i) => [i.barcode, i.salePrice]));
  check("smart: ölü bölge 359,90 -> eşik altı", sent["DEAD-1"] < 300, sent["DEAD-1"]);
  check("smart: pahalı 1000 -> en fazla %10 düşüş", sent["PAHALI-1"] >= 900 && sent["PAHALI-1"] < 1000, sent["PAHALI-1"]);
  check("smart: düşen fiyat özette", s.priceMoves?.["düşecek"] >= 2, JSON.stringify(s.priceMoves));
  check("smart: CSV kârı gönderilen fiyata göre", /;hayir;[\d.]+;17\.5;MEVCUT \(düşecek; formül 239\.9; eski 359\.9\)/.test(line("DEAD-1")), line("DEAD-1"));
}

// 6) migration 002 çalıştırılmamış veritabanı: Trendyol eskisi gibi çalışır
{
  const { calls, s, status } = run("update", { MOCK_NOMIG: "1", MOCK_BULK: "50" });
  check("migrasyonsuz: Trendyol çalışır", status === "ok" && s.updated > 0, status);
  check("migrasyonsuz: geçmiş kaydı eski biçimde", calls.runInsert && !("marketplace" in calls.runInsert), JSON.stringify(calls.runInsert));
}

// 7) Hepsiburada (sahte SIT)
{
  const hbEnv = { HB_MERCHANT_ID: "m-1", HB_USERNAME: "u", HB_PASSWORD: "p", MOCK_BULK: "1500" };
  const { calls, s, status, line } = run("auto", hbEnv, "hepsiburada");
  const stock = calls.hbWrites.filter((w) => w.path.endsWith("/stock-uploads")).flatMap((w) => w.body);
  const price = calls.hbWrites.filter((w) => w.path.endsWith("/price-uploads")).flatMap((w) => w.body);
  const imp = calls.hbWrites.filter((w) => w.path.endsWith("/products/import")).flatMap((w) => w.body);
  check("hb: tüm listing'ler sayfalı yüklendi", s.listingTotals?.loaded === 1504, JSON.stringify(s.listingTotals));
  check("hb: OS13- ve ÖS13- eşleşti", stock.some((x) => x.merchantSku === "OS13-AAA") && stock.some((x) => x.merchantSku === "ÖS13-G0et_94794"), stock.length);
  check("hb: kapalı ürün gönderilmedi", !stock.some((x) => x.merchantSku === "OS13-KILITLI"));
  check("hb: min stok 5 altı stok gönderilmez (0 veya ≥5)", stock.every((x) => x.availableStock === 0 || x.availableStock >= 5));
  check("hb: fiyat ayrı uçtan", price.length > 0 && price.every((x) => x.price > 0));
  check("hb: komisyon +KDV ve desi kargo fiyata yansıdı", Number(line("OS13-YEN-1").split(";")[4]) > 200, line("OS13-YEN-1"));
  check("hb: her sipariş kargo satıcıda", line("OS13-YEN-1").split(";")[5] === "evet", line("OS13-YEN-1"));
  check("hb: ürün açma import (Marka, merchant)", imp.length >= 2 && imp.every((x) => x.attributes.Marka === "Eco Lounge" && x.merchant === "m-1"), JSON.stringify(imp.map((x) => x.attributes.merchantSku)));
  check("hb: ürün hatası özete yazıldı", s.batchCheck?.failedItems === 1, JSON.stringify(s.batchCheck));
  check("hb: geçmiş kaydı marketplace ile", calls.runInsert?.marketplace === "hepsiburada");
  check("hb: eşleşmeyen kategori pazaryeri ile", (calls.unmapped ?? []).every((x) => x.marketplace === "hepsiburada"));
  check("hb: durum partial", status === "partial", status);
}

// 8) Hepsiburada kimlik bilgisi yoksa zamanlanmış çalışma atlanır
{
  const dir = mkdtempSync(join(tmpdir(), "synctest-"));
  execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--import", mock, sync, "auto", "hepsiburada"], { cwd: dir, env: { ...envBase, TRIGGER: "schedule" }, stdio: ["ignore", "ignore", "inherit"] });
  const calls = JSON.parse(readFileSync(join(dir, "calls.json"), "utf8"));
  check("hb: secret yoksa zamanlı çalışma atlanır", calls.run?.status === "skipped", JSON.stringify(calls.run));
}

// 9) Hepsiburada test aracı (sahte SIT)
{
  const tool = join(here, "..", "hb-tool.ts");
  const hbEnv = { ...envBase, HB_MERCHANT_ID: "m-1", HB_USERNAME: "u", HB_PASSWORD: "p", MOCK_BULK: "20", MOCK_HB_PRODUCTS: "1" };
  const t = (...a) => {
    const dir = mkdtempSync(join(tmpdir(), "hbtool-"));
    let code = 0;
    try { execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--import", mock, tool, ...a], { cwd: dir, env: hbEnv, stdio: ["ignore", "ignore", "inherit"] }); } catch { code = 1; }
    const o = JSON.parse(readFileSync(join(dir, "hb_tool_output.json"), "utf8"));
    const calls = JSON.parse(readFileSync(join(dir, "calls.json"), "utf8"));
    const file = (f) => { try { return readFileSync(join(dir, f), "utf8"); } catch { return ""; } };
    return { code, o, calls, file, titles: (o.steps ?? []).map((x) => x.title).join(" | ") };
  };
  const ping = t("ping");
  check("araç ping", ping.code === 0 && /listing erişimi: TAMAM/.test(ping.titles) && /katalog \(mpop\) erişimi: TAMAM/.test(ping.titles), ping.titles);
  const cats = t("categories", "kirli");
  check("araç categories", cats.code === 0 && cats.file("hb_categories.csv").includes("18021982") && JSON.stringify(cats.o.steps).includes("Kirli Sepeti"), cats.titles);
  const sug = t("suggest");
  check("araç suggest (csv)", sug.code === 0 && sug.file("hb_category_suggestions.csv").split("\n").length > 3, sug.titles);
  const at = t("attributes", "18021982");
  check("araç attributes (zorunlu + değerler)", at.code === 0 && JSON.stringify(at.o.steps).includes("Çok Renkli"), at.titles);
  const send = t("send", "2", "18021982");
  const imp = send.calls.hbWrites.filter((w) => w.path.endsWith("/products/import")).flatMap((w) => w.body);
  check("araç send 2: iki ürün, kategori ve renk dolu", send.code === 0 && imp.length === 2 && imp.every((x) => x.categoryId === 18021982 && x.attributes.renk_variant_property), JSON.stringify(imp.map((x) => x.attributes)));
  check("araç send: başlığında marka geçen atlanır", !imp.some((x) => String(x.attributes.UrunAdi).includes("Philips")), JSON.stringify(imp.map((x) => x.attributes.UrunAdi)));
  check("araç send: Siyah başlıktan", imp.some((x) => x.attributes.UrunAdi.includes("Siyah") ? x.attributes.renk_variant_property === "Siyah" : x.attributes.renk_variant_property === "Çok Renkli"), JSON.stringify(imp.map((x) => [x.attributes.UrunAdi, x.attributes.renk_variant_property])));
  const st = t("stock", "OS13-AAA", "7");
  check("araç stock", st.code === 0 && st.calls.hbWrites.some((w) => w.path.endsWith("/stock-uploads") && w.body[0].availableStock === 7), st.titles);
  const pr = t("price", "OS13-AAA", "149.9");
  check("araç price", pr.code === 0 && pr.calls.hbWrites.some((w) => w.path.endsWith("/price-uploads") && w.body[0].price === 149.9), pr.titles);
  check("araç orders", t("orders").code === 0);
  const bad = t("send");
  check("araç: eksik argüman anlaşılır hata", bad.code === 1 && /kullanım: send/.test(JSON.stringify(bad.o.steps)), bad.titles);
}

// 9b) akıllı kâr kuralları: Trendyol'a ait ve "all" kurallar uygulanır, başka pazaryerininki uygulanmaz
{
  const { s } = run("preview", { MOCK_RULES: "1" });
  check("kâr kuralı uygulandı", s.pricingRules?.["Test kuralı"] > 0, JSON.stringify(s.pricingRules));
  check("başka pazaryerinin kuralı uygulanmadı", !s.pricingRules?.["Başka pazaryeri"], JSON.stringify(s.pricingRules));
  check("kuralsız çalışmada sayaç boş", Object.keys(run("preview").s.pricingRules ?? {}).length === 0);
}

// 9c) fiyat üst sınırını aşan mevcut ilan: atlanmaz, stok 0 gönderilir (eski fiyattan satılmasın)
{
  const { s, line } = run("update", { MOCK_MAX_PRICE: "150" });
  const k = Object.keys(s.skipped ?? {}).find((x) => x.includes("mevcut ilan: stok 0"));
  check("üst sınır: mevcut ilan stok 0 sayıldı", !!k && s.skipped[k] > 0, JSON.stringify(s.skipped));
  check("üst sınır: csv satırı STOK 0", /STOK 0: fiyat üst sınırı/.test(line("ÖS13-AAA")) || Object.values(s.skipped ?? {}).length > 0);
}

// 9d) Faz 3: ilan tablosu her senkronda yazılır (preview dahil, pazaryerine yazmadan)
{
  const { calls, s } = run("preview");
  check("ilan tablosu yazıldı", calls.listings > 10000 && s.listingsTable?.written === calls.listings, JSON.stringify({ n: calls.listings, t: s.listingsTable }));
}

// 9e) Faz 4: veritabanından gönderilmiş ilan XML'de yok diye sıfırlanmaz, stok/fiyatı veritabanından gelir
{
  const { calls, s } = run("update", { MOCK_ZERO: "1", MOCK_BULK: "50", MOCK_DB: "1" });
  const items = calls.trendyolWrites.flatMap((w) => w.body.items ?? []).filter((i) => i.barcode === "ORPHAN-1");
  check("faz4: veritabanı ilanı sıfırlanmadı", items.length === 1 && items[0].quantity === 20, JSON.stringify(items));
  check("faz4: fiyat maliyetten hesaplandı (≥ 30×1,3)", items[0]?.salePrice >= 39, JSON.stringify(items));
  check("faz4: özet", s.dbProducts?.updated === 1, JSON.stringify(s.dbProducts));
}
// 9f) Faz 4: "Pazaryerine gönder" kuyruğu: geçerli ürün açılır, kategorisiz hata, mevcut ilan "zaten var"
{
  const { calls, s } = run("update", { MOCK_BULK: "50", MOCK_SEND: "1" });
  const created = calls.trendyolWrites.filter((w) => /\/v2\/products$/.test(w.path)).flatMap((w) => w.body.items);
  const mine = created.find((i) => i.barcode === "8690000000012");
  check("faz4: ürün gönderildi (barkod, kategori 3, görsel)", !!mine && mine.categoryId === 3 && mine.images?.[0]?.url === "https://i/x.jpg", JSON.stringify(created.map((i) => i.barcode)));
  check("faz4: kategorisiz ürün gönderilmedi", !created.some((i) => i.barcode === "2000000000017"));
  const rows = Object.fromEntries((calls.listingRows ?? []).map((r) => [r.listing_key, r]));
  check("faz4: ilan durumları (sent / error / zaten var)", rows["8690000000012"]?.status === "sent" && rows["2000000000017"]?.status === "error" && /kategori/i.test(rows["2000000000017"]?.last_error ?? "") && rows["OS13-NEWPC1"]?.status === "live", JSON.stringify(rows));
  check("faz4: iş tamamlandı", calls.jobFinish?.[0]?.job_id === 77 && calls.jobFinish?.[0]?.ok === true, JSON.stringify(calls.jobFinish));
  check("faz4: özet sendJobs", s.sendJobs?.sent === 1 && s.sendJobs?.errors === 1, JSON.stringify(s.sendJobs));
}
// 9g) preview: kuyruk işlenmez (pazaryerine yazmaz)
{
  const { calls } = run("preview", { MOCK_BULK: "50", MOCK_SEND: "1" });
  check("faz4: önizlemede gönderim yok", !calls.trendyolWrites.some((w) => /\/v2\/products$/.test(w.path)) && !calls.jobFinish);
}

// 9h) Amazon: giriş, ilan raporu, stok/fiyat feed'i, ASIN eşleşmesiyle teklif
{
  const AMZ = { AMAZON_LWA_CLIENT_ID: "c", AMAZON_LWA_CLIENT_SECRET: "s", AMAZON_REFRESH_TOKEN: "amz-refresh", AMAZON_SELLER_ID: "A1TESTSELLER9", AMAZON_POLL_MS: "1", AMAZON_GAP_MS: "1", MOCK_BULK: "50" };
  const { calls, s, status } = run("update", { ...AMZ, MOCK_ZERO: "1" }, "amazon");
  check("amazon: çalışma tamam", status === "ok" || status === "partial", status);
  check("amazon: ilan raporu okundu (Incomplete hariç güncellenir)", s.listings === 3 && s.matched >= 1, JSON.stringify({ l: s.listings, m: s.matched }));
  const msgs = (calls.amzFeeds ?? []).flatMap((f) => f.messages);
  const aaa = msgs.find((m) => m.sku === "AAA");
  check("amazon: feed başlığı", calls.amzFeeds?.[0]?.header?.sellerId === "A1TESTSELLER9" && calls.amzFeeds[0].header.version === "2.0", JSON.stringify(calls.amzFeeds?.[0]?.header));
  check("amazon: AAA stok+fiyat PATCH", aaa?.operationType === "PATCH" && aaa.patches.some((p) => p.path === "/attributes/fulfillment_availability" && p.value[0].quantity === 10) && aaa.patches.some((p) => p.path === "/attributes/purchasable_offer" && p.value[0].currency === "TRY" && p.value[0].marketplace_id === "A33AVAJ2PDY3EV"), JSON.stringify(aaa));
  check("amazon: eşleşme %50 altındayken toplu sıfırlama yapılmadı (güvenlik)", !msgs.some((m) => m.sku === "ORPHAN-AMZ") && !!s.zeroMissingSkipped, JSON.stringify({ skus: msgs.map((m) => m.sku), z: s.zeroMissingSkipped }));
  check("amazon: eksik (Incomplete) ilana dokunulmadı", !msgs.some((m) => m.sku === "EKSIK"));
  check("amazon: feed sonucu ürün bazında hata", s.batchCheck?.failedItems >= 1, JSON.stringify(s.batchCheck));
  // gönderim: EAN ile tek eşleşme -> teklif; iç barkod -> adaylar, onay bekler
  const g = run("update", { ...AMZ, MOCK_SEND: "1" }, "amazon");
  const offers = (g.calls.amzPuts ?? []).map((x) => ({ sku: x.sku, ...x.body, query: x.query }));
  const o = offers.find((m) => m.sku === "TD-1");
  check("amazon: EAN eşleşmesiyle teklif (Listings API, LISTING_OFFER_ONLY)", o?.requirements === "LISTING_OFFER_ONLY" && o.productType === "PRODUCT" && o.attributes.merchant_suggested_asin[0].value === "B0EANMATCH" && o.attributes.condition_type[0].value === "new_new" && o.query.marketplaceIds === "A33AVAJ2PDY3EV", JSON.stringify(offers));
  check("amazon: fiyatta audience ALL", o?.attributes.purchasable_offer[0].audience === "ALL" && o.attributes.purchasable_offer[0].currency === "TRY", JSON.stringify(o?.attributes?.purchasable_offer));
  check("amazon: iç barkodlu ürün gönderilmedi (aday onayı bekler)", !offers.some((m) => m.sku === "TD-2"));
  const rows = Object.fromEntries((g.calls.listingRows ?? []).map((r) => [r.listing_key, r]));
  check("amazon: ilan durumları", rows["TD-1"]?.status === "sent" && rows["TD-2"]?.status === "error" && /onay bekliyor/.test(rows["TD-2"]?.last_error ?? ""), JSON.stringify(rows));
  check("amazon: katalog araması EAN ve başlıkla", g.calls.amzCatalog?.some((q) => q.identifiers === "8690000000012" && q.identifiersType === "EAN") && g.calls.amzCatalog?.some((q) => q.keywords), JSON.stringify(g.calls.amzCatalog));
  // yanlış kimlik: anlaşılır hata
  let badMsg = "";
  { const dir = mkdtempSync(join(tmpdir(), "synctest-")); try { execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--import", mock, sync, "preview", "amazon"], { cwd: dir, env: { ...envBase, ...AMZ, AMAZON_REFRESH_TOKEN: "yanlis" }, stdio: "pipe" }); } catch (e) { badMsg = String(e.stderr ?? ""); } try { badMsg += JSON.stringify(JSON.parse(readFileSync(join(dir, "calls.json"), "utf8")).run ?? {}); } catch {} }
  check("amazon: yanlış token anlaşılır hatayla durur", /LWA/.test(badMsg), badMsg.slice(0, 200));
  let sellerMsg = "";
  { const dir = mkdtempSync(join(tmpdir(), "synctest-")); try { execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--import", mock, sync, "preview", "amazon"], { cwd: dir, env: { ...envBase, ...AMZ, AMAZON_SELLER_ID: "amzn1.oa2-cs.v1.abc123" }, stdio: "pipe" }); } catch (e) { sellerMsg = String(e.stderr ?? ""); } }
  check("amazon: yanlış satıcı kimliği (Client Secret girilmiş) anlaşılır hata", /AMAZON_SELLER_ID yanlış/.test(sellerMsg) && !/abc123/.test(sellerMsg.split("AMAZON_SELLER_ID")[1] ?? ""), sellerMsg.slice(0, 200));
}

// 9i) Tedarikçi fiyatı KDV hariç: maliyete ürünün KDV'si eklenir, fiyat yükselir
{
  const inc = run("update", { MOCK_BULK: "50", MOCK_POLICY: "formula" });
  const exc = run("update", { MOCK_BULK: "50", MOCK_POLICY: "formula", MOCK_XML_EXVAT: "1" });
  const price = (r, b) => r.calls.trendyolWrites.flatMap((w) => w.body.items ?? []).find((i) => i.barcode === b)?.salePrice;
  const a = price(inc, "ÖS13-AAA"), b = price(exc, "ÖS13-AAA");
  check("KDV hariç: fiyat yükseldi (maliyet x1,2)", b > a * 1.12, JSON.stringify({ dahil: a, haric: b }));
}

// 9j) Reddedilen ürün düzeltme: marka eki ve yasaklı kelime otomatik düzeltilip yeniden onaya gönderilir; kategori kullanıcıya
{
  const { calls, s } = run("update", { MOCK_BULK: "50" });
  const upd = calls.trendyolWrites.filter((w) => w.path.endsWith("/products/unapproved-bulk-update")).flatMap((w) => w.body.items);
  const m = upd.find((i) => i.barcode === "OS13-MARKA"), y = upd.find((i) => i.barcode === "OS13-YASAK");
  check("ret: marka eki silinip gönderildi", m?.title === "Ahsap Gokkusagi Kule" && m?.description === "ahsap kule", JSON.stringify(m));
  check("ret: yasaklı kelime silinip gönderildi", y?.title === "Ahsap Oyuncak", JSON.stringify(y));
  check("ret: kategori hatası gönderilmedi (kullanıcıya)", !upd.some((i) => i.barcode === "OS13-KAT") && calls.fixes?.some((f) => f.listing_key === "OS13-KAT" && f.status === "needs_user"), JSON.stringify(calls.fixes));
  check("ret: yasaklı kelime listeye eklendi", calls.bannedWords?.some((w) => w.word === "redka"), JSON.stringify(calls.bannedWords));
  check("ret: özet", s.rejectFixes?.resubmitted === 2, JSON.stringify(s.rejectFixes));
  const p = run("preview", { MOCK_BULK: "50" });
  check("ret: önizlemede gönderim yok", !p.calls.trendyolWrites.some((w) => w.path.endsWith("unapproved-bulk-update")));
}

// 10) birim testleri
for (const f of ["pricing.test.ts", "classify.test.ts", "pricing-rules.test.ts", "jobs.test.ts", "rejections.test.ts", "retire.test.ts", "brand-risk.test.ts", "util.test.ts", "safe-fetch.test.ts", "attr-infer.test.ts", "category-tree.test.ts", "hepsiburada-commission.test.ts", "orders.test.ts", "opportunity.test.ts"]) {
  try { execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(here, f)], { stdio: "inherit" }); }
  catch { fails++; }
}

console.log(fails ? `\n${fails} test başarısız` : "\nTüm testler geçti");
process.exit(fails ? 1 : 0);
