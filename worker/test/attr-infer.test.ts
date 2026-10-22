// Zorunlu özelliği metinden çıkarma: Trendyol'un gerçek değer listeleriyle (22.10 kategori uç noktası)
// node --experimental-strip-types worker/test/attr-infer.test.ts
import { inferAttribute, type AttrValue } from "../core/attr-infer.ts";
let fails = 0;
const check = (n: string, got: AttrValue | null, want: string | null) => { const ok = (got?.name ?? null) === want; console.log(`${ok ? "OK  " : "HATA"} ${n}${ok ? "" : `  beklenen ${want}, gelen ${got?.name ?? null}`}`); if (!ok) fails++; };
const V = (...names: string[]) => names.map((name, id) => ({ id, name }));

const varYok = V("Yok", "Var"), evetHayir = V("Hayır", "Evet");
check("mikrofon var", inferAttribute("Mikrofon", varYok, "Kablosuz Kulaklık Mikrofonlu Bluetooth 5.3"), "Var");
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
check("yaş metinden", inferAttribute("Yaş", V("2 Yaş", "3 Yaş", "Tüm Yaşlar"), "Parti Seti 3+ Yaş"), "3 Yaş");
check("yaş yoksa tüm yaşlar", inferAttribute("Yaş", V("2 Yaş", "3 Yaş", "Tüm Yaşlar"), "Parti Balonu"), "Tüm Yaşlar");
check("frekans 50 Hz", inferAttribute("Frekans", V("50 Hz", "60 Hz", "60 Hz / 50 Hz"), "Hava Nemlendirici"), "50 Hz");
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

if (fails) { console.log(`\n${fails} özellik çıkarma testi başarısız`); process.exit(1); }
console.log("\nÖzellik çıkarma testleri geçti");
