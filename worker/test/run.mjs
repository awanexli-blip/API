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
  check("preview: tüm onaylı varyantlar yüklendi (nextPageToken)", s.listingTotals?.approvedVariantsLoaded === 10160, JSON.stringify(s.listingTotals));
  check("preview: eşleşen", s.matched === 10159, String(s.matched));
  check("preview: canlı komisyon kullanıldı", s.commissionSource?.urun_canli >= 1, JSON.stringify(s.commissionSource));
  check("preview: JSON komisyonu yedek", s.commissionSource?.urun >= 1, JSON.stringify(s.commissionSource));
  check("preview: kilitli ürün atlandı", line("ÖS13-KILITLI").includes("kapalı/fiyatsız"));
  check("preview: sıfır fiyatlı ürün atlandı", line("ÖS13-SIFIR").includes("kapalı/fiyatsız"));
  check("preview: onay bekleyen yeniden açılmıyor", line("OS13-BEKLEYEN").includes("onay bekliyor"));
  check("preview: yeni ürün (Türkçe karakter atıldı)", line("OS13-YEN-1").includes("YENI"));
  check("preview: aynı başlık engeli", line("BX12").includes("aynı başlık"));
  check("preview: create sayısı", s.create === 2, String(s.create));
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

// 9) birim testleri
try { execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(here, "pricing.test.ts")], { stdio: "inherit" }); }
catch { fails++; }

console.log(fails ? `\n${fails} test başarısız` : "\nTüm testler geçti");
process.exit(fails ? 1 : 0);
