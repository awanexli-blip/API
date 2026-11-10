// Zorunlu özelliği metinden çıkarma: Trendyol'un gerçek değer listeleriyle (22.10 kategori uç noktası)
// node --experimental-strip-types worker/test/attr-infer.test.ts
import { defaultFor, inferAttribute, type AttrValue } from "../core/attr-infer.ts";
import { acceptValues } from "../core/ai-attrs.ts";
import { salePriceOf } from "../core/sale-price.ts";
let fails = 0;
const check = (n: string, got: AttrValue | null, want: string | null) => { const ok = (got?.name ?? null) === want; console.log(`${ok ? "OK  " : "HATA"} ${n}${ok ? "" : `  beklenen ${want}, gelen ${got?.name ?? null}`}`); if (!ok) fails++; };
const V = (...names: string[]) => names.map((name, id) => ({ id, name }));

const varYok = V("Yok", "Var"), evetHayir = V("Hayır", "Evet");
check("mikrofon var", inferAttribute("Mikrofon", varYok, "Kablosuz Kulaklık Mikrofonlu Bluetooth 5.3"), "Var");
// Hepsiburada cinsiyet listesi (Unisex yok): açıkça geçmiyorsa boş kalır
const cins = ["Erkek", "Erkek Çocuk", "Kadın", "Kız Çocuk"].map((name, id) => ({ id, name }));
check("cinsiyet: kızlar -> Kız Çocuk", inferAttribute("Cinsiyet", cins, "Pembe Kızlar İçin Çanta"), "Kız Çocuk");
check("cinsiyet: kızartma kız değil", inferAttribute("Cinsiyet", cins, "Kızartma Tavası 28 Cm"), null);
check("cinsiyet: cinsiyetsiz ürün keyfi seçilmez", inferAttribute("Cinsiyet", cins, "Çocuk Bisikleti 16 Jant"), null);
check("mikrofon yok", inferAttribute("Mikrofon", varYok, "Kablosuz Kulaklık Bluetooth 5.3"), "Yok");
check("ANC açıklamada", inferAttribute("Aktif Gürültü Önleme (ANC)", varYok, "TWS Kulaklık", "Aktif gürültü önleme özelliği"), "Var");
check("suya dayanıklı ipx7", inferAttribute("Suya/Tere Dayanıklılık", varYok, "Hoparlör IPX7 Su Geçirmez"), "Var");
check("pil ile çalışır hayır", inferAttribute("Pil ile mi çalışır?", evetHayir, "Sevimli Peluş Ayı 30 cm"), "Hayır");
check("pil ile çalışır evet", inferAttribute("Pil ile mi çalışır?", evetHayir, "Sesli Peluş Köpek Pilli"), "Evet");

const calisma = V("Mum", "Solar", "Adaptörlü", "Şarjlı", "Pilli", "Elektrikli");
check("çalışma tipi şarjlı", inferAttribute("Çalışma Tipi", calisma, "USB Şarjlı Masa Lambası"), "Şarjlı");
check("çalışma tipi solar", inferAttribute("Çalışma Tipi", calisma, "Güneş Enerjili Bahçe Lambası"), "Solar");
check("çalışma tipi bilinmiyor", inferAttribute("Çalışma Tipi", calisma, "Dekoratif Lamba"), null);
check("model kablosuz şarj", inferAttribute("Model", V("Kablosuz-Pilli", "Kablosuz -Şarj Edilebilir", "Kablolu"), "Şarjlı Gece Lambası"), "Kablosuz -Şarj Edilebilir");

check("dil", inferAttribute("Dil", V("Arapça", "Almanca", "İngilizce", "Türkçe"), "Eğitici Oyuncak"), "Türkçe");
check("yaş grubu çocuk", inferAttribute("Yaş Grubu", V("Çocuk", "Bebek"), "Eğitici Ahşap Puzzle"), "Çocuk");
check("yaş grubu bebek", inferAttribute("Yaş Grubu", V("Çocuk", "Bebek"), "Bebekler İçin Çıngırak"), "Bebek");
check("kadın elbisesi çocuk değil", inferAttribute("Yaş Grubu", V("Çocuk", "Bebek", "Yetişkin"), "Kadın Şık Elbise Krep Kumaş", "çocuklarınızla gezerken", "Giyim Ürünleri > Kadın > Elbise"), "Yetişkin");
check("küpe yetişkin", inferAttribute("Yaş Grubu", V("Çocuk", "Yetişkin"), "316L Çelik Gold Renk Küpe", "", "Takı & Aksesuar > Küpe"), "Yetişkin");
check("oyuncak bebek çocuk", inferAttribute("Yaş Grubu", V("Çocuk", "Bebek", "Yetişkin"), "Hayvan Kostümlü Bebek 40 cm", "", "Oyuncak > Oyuncak Bebekler"), "Çocuk");
check("bebek banyo bebek", inferAttribute("Yaş Grubu", V("Çocuk", "Bebek", "Yetişkin"), "Bebek Banyo Süngeri", "", "Anne Bebek > Banyo"), "Bebek");
check("cinsiyet açıklamadan okunmaz", inferAttribute("Cinsiyet", V("Kadın / Kız", "Erkek", "Unisex"), "Kadın Siyah Dekolte Elbise", "erkekleri etkileyen tasarım"), "Kadın / Kız");
check("bay bayan unisex", inferAttribute("Cinsiyet", V("Kadın / Kız", "Erkek", "Unisex"), "Bay Bayan Masaj Yağı"), "Unisex");
check("ipucu yoksa unisex", inferAttribute("Cinsiyet", V("Kadın / Kız", "Erkek", "Unisex"), "316L Çelik Küpe"), "Unisex");
import { wantedAudience } from "../core/attr-infer.ts";
const wa = (t: string, c: string, a: Record<string, string>) => JSON.stringify(wantedAudience(t, c, a));
const eq = (name: string, got: string, want: string) => check(name, { name: got } as any, want);
eq("onarım: kadın elbise çocuk", wa("Kadın Şık Elbise", "Giyim > Kadın > Elbise", { "Yaş Grubu": "Çocuk", "Cinsiyet": "Kadın / Kız" }), JSON.stringify({ "Yaş Grubu": "Yetişkin" }));
eq("onarım: Kadın değeri korunur", wa("Kadın Yüzük", "Takı", { "Cinsiyet": "Kadın" }), "{}");
eq("onarım: unisex korunur", wa("Çelik Küpe", "KADIN > Küpe", { "Cinsiyet": "Unisex" }), "{}");
eq("onarım: kadın ürünü erkek", wa("Kadın Deri Cüzdan", "Cüzdan", { "Cinsiyet": "Erkek" }), JSON.stringify({ "Cinsiyet": "Kadın / Kız" }));
eq("onarım: oyuncak çocuk kalır", wa("Peluş Ayı", "Oyuncak > Peluş", { "Yaş Grubu": "Çocuk" }), "{}");
eq("onarım: hobi blok seti çocuk kalır", wa("Mini Poşet Araba Blok Seti 1 Adet", "Hobi", { "Yaş Grubu": "Çocuk" }), "{}");
eq("onarım: bayan patates kafa oyuncak", wa("Hasbro Bayan Patates Kafa", "Oyuncak > Eğitici", { "Yaş Grubu": "Çocuk" }), "{}");
eq("onarım: kostüm korunur", wa("Sarı Etekli Kedi Kostüm Seti", "Kostüm Aksesuarları", { "Yaş Grubu": "Çocuk" }), "{}");
eq("onarım: okul çantası çocuk kalır", wa("Okul Çantası", "Çanta", { "Yaş Grubu": "Çocuk" }), "{}");
check("uçucu yağa voltaj yazılmaz", inferAttribute("Voltaj", V("220 - 240 V", "12 V"), "Ferahlık Verici 6'lı Aromatik Uçucu Yağ Seti Oda Difüzörü", "6 farklı esansiyel yağ", "Parfüm Esansı"), null);
check("uçucu yağa frekans yazılmaz", inferAttribute("Frekans", V("50 Hz"), "Aromatik Uçucu Yağ Seti", ""), null);
check("uçucu yağa garanti yazılmaz", inferAttribute("Garanti Süresi", V("2 Yıl"), "Aromatik Uçucu Yağ Seti", ""), null);
check("saç maşasına voltaj yazılır", inferAttribute("Voltaj", V("220 - 240 V", "220 V"), "Seramik Saç Maşası 25 mm", ""), "220 V");
check("şarjlı üründe garanti", inferAttribute("Garanti Süresi", V("2 Yıl"), "Şarjlı El Feneri", ""), "2 Yıl");
import { phoneModelOf, inferCustom as ic } from "../core/attr-infer.ts";
const eqs = (n: string, got: string | null, want: string | null) => check(n, (got == null ? null : { id: 0, name: got }) as any, want);
eqs("model: iphone", phoneModelOf("Joko Apple iPhone 17 Pro Uyumlu Remim Lensli Kapak"), "iPhone 17 Pro");
eqs("model: pro max", phoneModelOf("Baseus Glitter iPhone 13 Pro Max 6.7inç Kılıf"), "iPhone 13 Pro Max");
eqs("model: seri adı girmez", phoneModelOf("Dux Ducis iPhone 12 Pro Aimo Series Mag Safe"), "iPhone 12 Pro");
eqs("model: redmi", phoneModelOf("Xiaomi Redmi 13 4G Uyumlu Kılıf Zuma"), "Xiaomi Redmi 13 4G");
eqs("model: general mobile", phoneModelOf("General Mobile GM 23 Kılıf First Silikon"), "General Mobile GM 23");
eqs("model: yoksa boş", phoneModelOf("Şeffaf Silikon Telefon Kılıfı Siyah"), null);
eqs("model: sayısız marka boş", phoneModelOf("Samsung Uyumlu Kılıf"), null);
eqs("custom telefon modeli", ic("Telefon Modeli", "Apple iPhone 16E Uyumlu Kapak"), "iPhone 16E");
const YA = V("3+ Yaş", "+6 Yaş", "3 - 6 Yaş", "0 - 24 Ay");
check("yaş aralığı başlıktan", inferAttribute("Yaş Aralığı", YA, "Eğitici Puzzle 3+ Yaş"), "3+ Yaş");
check("yaş aralığı aralık", inferAttribute("Yaş Aralığı", YA, "Set 3-6 Yaş"), "3 - 6 Yaş");
check("yaş yazmayan oyuncak 3+", inferAttribute("Yaş Aralığı", YA, "Uzay Mekiği Seti", "", "Oyuncak > Eğitici Oyuncak"), "3+ Yaş");
check("yazılı yaş öncelikli", inferAttribute("Yaş Aralığı", YA, "Set 6+ Yaş", "", "Oyuncak"), "+6 Yaş");
check("bebek oyuncağına 3+ yazılmaz", inferAttribute("Yaş Aralığı", YA, "Çıngırak", "", "Oyuncak > Bebek & Okul Öncesi Oyuncaklar"), null);
check("yaş aralığı yoksa boş", inferAttribute("Yaş Aralığı", YA, "Uzay Mekiği Puzzle 100 Parça"), null);
check("araç: kamyon", inferAttribute("Oyuncak Araç Türü", V("Oyuncak Kamyon ve İş Makinesi", "Oyuncak Araba"), "Oyuncak Eğitici Bultak Kamyon"), "Oyuncak Kamyon ve İş Makinesi");
check("araç: belirsiz boş", inferAttribute("Oyuncak Araç Türü", V("Oyuncak Araba"), "Supra Veilside Combat V-ıı Black 1 Adet"), null);
check("peluş tipi", inferAttribute("Peluş Tipi", V("Hediyelik Peluşlar", "Oyuncak Peluşlar"), "Sevimli Köpek"), "Oyuncak Peluşlar");
check("yaş metinden", inferAttribute("Yaş", V("2 Yaş", "3 Yaş", "Tüm Yaşlar"), "Parti Seti 3+ Yaş"), "3 Yaş");
check("yaş yoksa tüm yaşlar", inferAttribute("Yaş", V("2 Yaş", "3 Yaş", "Tüm Yaşlar"), "Parti Balonu"), "Tüm Yaşlar");
check("frekans 50 Hz", inferAttribute("Frekans", V("50 Hz", "60 Hz", "60 Hz / 50 Hz"), "Elektrikli Hava Nemlendirici"), "50 Hz");
check("kutu yok", inferAttribute("Kutu Durumu", V("Kutu yok", "Kutulu"), "Çelik Bileklik"), "Kutu yok");
check("kutulu", inferAttribute("Kutu Durumu", V("Kutu yok", "Kutulu"), "Hediye Kutulu Bileklik"), "Kutulu");
check("garanti tipi (K kararı)", inferAttribute("Garanti Tipi", V("Goldmaster Garantili", "Resmi Distribütör Garantili", "İthalatçı Garantili"), "Hoparlör"), "İthalatçı Garantili");
check("garanti süresi 2 yıl", inferAttribute("Garanti Süresi", V("5 Yıl", "2 Yıl", "1 Yıl"), "Kulaklık"), "2 Yıl");

check("kasa çapı mm", inferAttribute("Kasa Çapı", V("44 mm", "45 mm", "46-50 mm", "41-45 mm"), "Akıllı Saat 44mm Siyah"), "44 mm");
check("kasa çapı aralık", inferAttribute("Kasa Çapı", V("44 mm", "46-50 mm"), "Akıllı Saat 47 mm"), "46-50 mm");
check("mAh aralık", inferAttribute("Pil Gücü (mAh)", V("20000 ve üzeri", "11500 - 20000", "7900 - 11500", "3000 - 7900"), "Powerbank 10000 mAh Hızlı Şarj"), "7900 - 11500");
check("mAh üzeri", inferAttribute("Pil Gücü (mAh)", V("20000 ve üzeri", "11500 - 20000"), "Powerbank 30000mAh"), "20000 ve üzeri");
check("hacim ml -> L", inferAttribute("Hacim", V("0,5 L", "0,4 L", "1 L"), "Oto Şampuanı 500 ml"), "0,5 L");
check("paket tekli", inferAttribute("Paket İçeriği", V("25'li", "Tekli", "4'lü"), "Mobilya Tekerleği 1 Adet"), "Tekli");
check("paket 4'lü", inferAttribute("Paket İçeriği", V("25'li", "Tekli", "4'lü"), "Mobilya Tekerleği 4 Adet"), "4'lü");
check("tip metinde", inferAttribute("Tip", V("Duvar Tipi", "El Vantilatörü", "Masaüstü", "Ayaklı"), "Şarjlı Masaüstü Fan"), "Masaüstü");
check("enerji sınıfı tek harf eşleşmez", inferAttribute("Enerji Sınıfı", V("A", "B (Yeni Enerji Sınıfı)"), "A Kalite Fan"), null);

// Yapay zekâ cevabı doğrulama: yalnızca listedeki değer (listedeki yazımla), serbest metin yalnızca izinli ve listesiz özellikte
const ask = [{ name: "Malzeme", opt: { values: ["Peluş", "Plastik"], custom: false } }, { name: "Renk", opt: { values: [], custom: true } }, { name: "Yaş", opt: { values: ["Çocuk"], custom: false } }];
const acc = acceptValues(ask, { values: [{ name: "malzeme", value: "PELUŞ", basis: "baslik" }, { name: "Renk", value: "Pembe", basis: "baslik" }, { name: "Yaş", value: "Yetişkin", basis: "cikarim" }] });
const okAcc = acc.Malzeme === "Peluş" && acc.Renk === "Pembe" && !("Yaş" in acc);
console.log(`${okAcc ? "OK  " : "HATA"} yapay zekâ değeri listeyle doğrulanır`); if (!okAcc) fails++;
// Güven eşiği (K, 01.11 "%80 doğruluk"): 0,8 altı yazılmaz; güven verilmemişse (eski yanıt) eşik uygulanmaz
const conf = acceptValues(ask, { values: [{ name: "Malzeme", value: "Plastik", basis: "fotograf", confidence: 0.6 }, { name: "Renk", value: "Siyah", basis: "fotograf", confidence: 0.9 }] });
const okConf = !("Malzeme" in conf) && conf.Renk === "Siyah";
console.log(`${okConf ? "OK  " : "HATA"} güveni 0,8 altı değer yazılmaz`); if (!okConf) fails++;

// Varyant değeri eş anlamlı özellik adına (panelde "Beden: 42" -> Trendyol/HB "Numara")
const dv = { Beden: "42", Renk: "Siyah", "Menşei": "TR" };
for (const [name, want] of [["Numara", "42"], ["Ayakkabı Numarası", "42"], ["numara_variant_property", "42"], ["Web Color", "Siyah"], ["Menşei", "TR"], ["Materyal", undefined]] as const) {
  const got = defaultFor(dv, name);
  console.log(`${got === want ? "OK  " : "HATA"} eş anlamlı özellik: ${name} -> ${got}`); if (got !== want) fails++;
}

// Formda girilen satış fiyatı (TR biçimi; pazaryerine özel değer önce)
for (const [a, mp, want] of [[{ "Satış fiyatı": "1.299,90" }, "trendyol", 1299.9], [{ "Satış fiyatı": "849.5" }, "trendyol", 849.5], [{ "Satış fiyatı": "500", "Satış fiyatı@hepsiburada": "529,90" }, "hepsiburada", 529.9], [{}, "trendyol", 0], [{ "Satış fiyatı": "abc" }, "trendyol", 0]] as [Record<string, string>, string, number][]) {
  const got = salePriceOf(a, mp);
  console.log(`${got === want ? "OK  " : "HATA"} satış fiyatı ${JSON.stringify(a)} ${mp} -> ${got}`); if (got !== want) fails++;
}

// Tedarikçi kod kopyaları: gövde ve seçim (stokta en ucuz; eşitse ana kod)
{
  const { codeStem, pickCodeWinner } = await import("../core/db-products.ts");
  const c = (n: string, w: any) => { console.log(`${n ? "OK  " : "HATA"} kod kopyası: ${w}`); if (!n) fails++; };
  c(codeStem("TCX-UCZZZQ8AKSYONKAMERA-4") === "TCX-UCZZZQ8AKSYONKAMERA" && codeStem("TCX-ABC") === "TCX-ABC" && codeStem("TCX-ABC-123") === "TCX-ABC-123", "gövde");
  const l = [{ id: "a", sku: "X", cost: 100, stock: 0 }, { id: "b", sku: "X-1", cost: 90, stock: 0 }, { id: "c", sku: "X-2", cost: 95, stock: 5 }, { id: "d", sku: "X-3", cost: 95, stock: 9 }];
  c(pickCodeWinner(l, 3)?.id === "c", "stokta en ucuz (stoksuz daha ucuz olan atlanır)");
  c(pickCodeWinner([{ id: "a", sku: "X", cost: 50, stock: 5 }, { id: "b", sku: "X-1", cost: 50, stock: 5 }])?.id === "a", "eşit fiyatta ana kod");
  c(pickCodeWinner([{ id: "a", sku: "X", cost: 50, stock: 0 }, { id: "b", sku: "X-1", cost: 40, stock: 0 }])?.id === "b", "hiç stok yoksa en ucuz");
}

// Duruma göre marj: rekabet > tek satıcı > fiyat basamağı; hatalı ayar kapalı sayılır
{
  const { parseDyn, marginFor, DEFAULT_DYN } = await import("../core/dynamic-margin.ts");
  const c = (ok: boolean, w: string) => { console.log(`${ok ? "OK  " : "HATA"} marj: ${w}`); if (!ok) fails++; };
  const dm = parseDyn(DEFAULT_DYN)!;
  c(marginFor(dm, { competition: true, price: 300 }) === 0.1, "rakip varsa %10");
  c(marginFor(dm, { competition: false, price: 3000 }) === 0.2, "tek satıcı %20");
  c(marginFor(dm, { price: 499 }) === 0.2 && marginFor(dm, { price: 800 }) === 0.15 && marginFor(dm, { price: 1500 }) === 0.1, "fiyat basamakları");
  c(parseDyn({ competition: 0.1 }) === null && parseDyn(null) === null && parseDyn({ competition: 2, alone: 0.2, bands: [[null, 0.1]] }) === null, "hatalı ayar kapalı");
}

// Rekabet önerisi: in (en az 40 TL net), artır (ikinci çok pahalı), formüle dön (rakip yok)
{
  const { suggestFor } = await import("../core/buybox.ts");
  const c = (ok: boolean, w: string) => { console.log(`${ok ? "OK  " : "HATA"} rekabet: ${w}`); if (!ok) fails++; };
  const netAt = (p: number) => p - 300; // basit: maliyet+giderler 300
  c(suggestFor({ order: 2, multiple: true, buybox: 400, second: 410, ours: 420, overridden: false, minNet: 40, netAt })?.kind === "lower", "1 TL altında 99 TL net -> in");
  c(suggestFor({ order: 2, multiple: true, buybox: 330, second: 340, ours: 360, overridden: false, minNet: 40, netAt }) === null, "net 29 TL < 40 -> öneri yok");
  const up = suggestFor({ order: 1, multiple: true, buybox: 400, second: 480, ours: 400, overridden: false, minNet: 40, netAt });
  c(up?.kind === "raise" && up.price === 479, "ikinci 480 -> 479'a artır");
  c(suggestFor({ order: 1, multiple: true, buybox: 400, second: 405, ours: 400, overridden: false, minNet: 40, netAt }) === null, "ikinci yakın -> dokunma");
  c(suggestFor({ order: 1, multiple: false, buybox: 400, second: null, ours: 400, overridden: true, minNet: 40, netAt })?.kind === "reset", "rakip kalmadı -> formüle dön");
}

if (fails) { console.log(`\n${fails} özellik çıkarma testi başarısız`); process.exit(1); }
console.log("\nÖzellik çıkarma testleri geçti");
