// Trendyol kargo: Ekim 2026 kesinti dökümündeki tutarlar tablolarla kuruşu kuruşuna (KDV dahil) + fiyat formülüyle birlikte davranış
// node --experimental-strip-types worker/test/trendyol-cargo.test.ts
import { tyBands, tyCarrierIndex, tyDesiCost, tyShipCfg } from "../core/trendyol-cargo.ts";
import { calcPrice, defaultConfig, shippingAt } from "../pricing.ts";

let fails = 0;
const check = (n: string, c: boolean, i: unknown = "") => { console.log(`${c ? "OK  " : "HATA"} ${n}${c ? "" : "  " + JSON.stringify(i)}`); if (!c) fails++; };
const near = (a: number, b: number) => Math.abs(a - b) <= 0.02;
const ci = (n: string) => tyCarrierIndex(n);

// Ekim kesintileri (Sipariş Kayıtları, Gönderi Kargo Bedeli)
check("57,99 = Aras zamanında 200 altı", near(tyBands(ci("Aras"), true)[0].cost, 57.99), tyBands(ci("Aras"), true));
check("65,49 = Sürat zamanında 200 altı", near(tyBands(ci("Sürat"), true)[0].cost, 65.49));
check("102,49 = Sürat zamanında 200-350", near(tyBands(ci("Sürat"), true)[1].cost, 102.49));
check("104,49 = Sürat geç 200 altı", near(tyBands(ci("Sürat"), false)[0].cost, 104.49));
check("110,99 = Sürat geç 200-350", near(tyBands(ci("Sürat Kargo"), false)[1].cost, 110.99));
check("112,49 = Kolay Gelsin geç 200-350", near(tyBands(ci("Kolay Gelsin"), false)[1].cost, 112.49));
check("106,76 = Aras 0-2 desi", near(tyDesiCost(1, ci("Aras")), 106.75));
check("114,66 = Sürat 0-2 desi", near(tyDesiCost(2, ci("Sürat")), 114.65));
check("213,52 = 2 paket Aras 0-2 desi", near(2 * tyDesiCost(1, ci("Aras")), 213.5));

check("firma adları: TEX / Trendyol Express / YK / bilinmeyen", ci("Trendyol Express") === ci("TEX") && ci("YK") === ci("Yurtiçi Kargo") && ci("Horoz") === -1 && ci("") === -1);
check("desi yuvarlama ve 50 üstü doğrusal", tyDesiCost(2.3, ci("TEX")) === tyDesiCost(3, ci("TEX")) && tyDesiCost(52, ci("TEX")) > tyDesiCost(50, ci("TEX")));

const s = tyShipCfg(1, "Sürat", false)!;
check("ürün yapılandırması: basamaklar + desi ücreti", near(s.shippingCost, 114.65) && s.shippingBands.length === 2 && s.shippingBands[1].below === 350);
check("desi yoksa / 0,01 ise varsayılan", tyShipCfg(0.01, "TEX", true, 2)!.shippingCost === tyDesiCost(2, ci("TEX")) && tyShipCfg(null, "TEX", true, 2)!.shippingCost === tyDesiCost(2, ci("TEX")));
const heavy = tyShipCfg(15, "Aras", true)!;
check("10 desi üstü: barem yok, her fiyatta desi ücreti", heavy.shippingBands.length === 1 && shippingAt(150, { ...defaultConfig, ...heavy }) === heavy.shippingCost);
check("firma tanımsız: null (sabit ayar kalır)", tyShipCfg(1, "", true) === null);

// Fiyat formülüyle: aynı maliyette TEX + zamanında, Sürat + geçten daha ucuz fiyat verir; kargo her fiyatta satıcıda
const base = { ...defaultConfig, fixedCost: 14.19, returnRate: 0.05, returnCost: 180, netProfitMin: 40, netMarginMin: 0.1, maxPrice: 50000 };
const pSlow = calcPrice(80, { ...base, ...tyShipCfg(1, "Sürat", false)! }, 0.15), pFast = calcPrice(80, { ...base, ...tyShipCfg(1, "TEX", true)! }, 0.15);
check("TEX zamanında < Sürat geç", pFast.ok && pSlow.ok && pFast.price < pSlow.price, { fast: pFast.price, slow: pSlow.price });
check("200 altı fiyatta da kargo satıcıda", pFast.price < 200 ? pFast.shipping > 0 : true, pFast);

// Birden fazla firma: her kalemde en pahalısı
const multi = tyShipCfg(1, "Aras, Sürat, Kolay Gelsin", false)!;
check("çoklu firma: 200 altı en pahalı (Kolay Gelsin 88,33+KDV)", near(multi.shippingBands[0].cost, 106.0), multi);
check("çoklu firma: 200-350 en pahalı (Kolay Gelsin 93,74+KDV)", near(multi.shippingBands[1].cost, 112.49), multi);
check("çoklu firma: 0-2 desi en pahalı (Kolay Gelsin 96,59+KDV)", near(multi.shippingCost, 115.91), multi);
check("çoklu firma: tanınmayan ad atlanır, hiç yoksa null", tyShipCfg(1, "Aras, Horoz", false)!.shippingCost === tyDesiCost(1, ci("Aras")) && tyShipCfg(1, "Horoz", false) === null);

if (fails) { console.log(`\n${fails} Trendyol kargo testi başarısız`); process.exit(1); }
console.log("\nTrendyol kargo testleri geçti");
