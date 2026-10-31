// Uyumluluk ifadesi markasız (neutralizeCompat): yalnızca doğru dönüşümler; tek sistemli ifade kalır (marka listesiyle gönderilmez)
// node --experimental-strip-types worker/test/compat.test.ts
import { neutralizeCompat as n, brandMatcher } from "../core/brand-risk.ts";

let fails = 0;
const eq = (name: string, a: string, b: string) => { const ok = a === b; console.log(`${ok ? "OK  " : "HATA"} ${name}${ok ? "" : `  "${a}" ≠ "${b}"`}`); if (!ok) fails++; };
eq("Android ve İOS Uyumlu", n("Akıllı Saat Yeni Nesil Android ve İOS Uyumlu Titreşim Motoru"), "Akıllı Saat Yeni Nesil Akıllı Telefon Uyumlu Titreşim Motoru");
eq("iOS ve Android Uyumlu", n("Kablosuz Kulaklık iOS ve Android Uyumlu"), "Kablosuz Kulaklık Akıllı Telefon Uyumlu");
eq("İOS Android Uyumlu (ayraçsız)", n("Akıllı Saat Üç Kordonlu İOS Android Uyumlu"), "Akıllı Saat Üç Kordonlu Akıllı Telefon Uyumlu");
eq("Ios Ve Android Tüm Telefonlara Uyumlu", n("Akıllı Saat Ios Ve Android Tüm Telefonlara Uyumlu Çağrı"), "Akıllı Saat Akıllı Telefon Uyumlu Çağrı");
eq("iOS ve Android ile Uyumlu", n("Akıllı Saat iOS ve Android ile Uyumlu Şık"), "Akıllı Saat Akıllı Telefon Uyumlu Şık");
eq("iOS Android Windows Uyumlu", n("Tablet Kalemi iOS Android Windows Uyumlu Yedek Uçlu"), "Tablet Kalemi Akıllı Telefon Uyumlu Yedek Uçlu");
eq("İos-Android (ek yok)", n("Usb Led Lamba İos-Android"), "Usb Led Lamba Akıllı Telefon");
eq("Android ve iOS Destekli", n("Hoparlör Android ve iOS Destekli"), "Hoparlör Akıllı Telefon Destekli");
eq("Android TV", n("Mx Box Android Tv Media Sound 4K"), "Mx Box Akıllı Tv Media Sound 4K");
eq("Android TV Box", n("TV Box Android TV kutusu"), "TV Box Akıllı TV kutusu");
eq("tek başına Android Uyumlu: değişmez", n("Joystick Oyun Kolu Android Uyumlu Kablosuz"), "Joystick Oyun Kolu Android Uyumlu Kablosuz");
eq("Android 7.1: değişmez", n("Mx Box Android 7.1 TV kutusu"), "Mx Box Android 7.1 TV kutusu");
eq("iPhone: değişmez", n("iPhone 15 Uyumlu Kılıf"), "iPhone 15 Uyumlu Kılıf");
eq("Android, Windows (iOS yok): değişmez", n("Kalem Android, Windows Uyumlu"), "Kalem Android, Windows Uyumlu");
eq("kelime içinde (bios): değişmez", n("Anakart Bios Android"), "Anakart Bios Android");
eq("büyük harf başlık", n("KULAKLIK İOS VE ANDROİD UYUMLU"), "KULAKLIK AKILLI TELEFON UYUMLU");
eq("HTML açıklama", n("<p>Android ve iOS Uyumlu</p>"), "<p>Akıllı Telefon Uyumlu</p>");
const m = brandMatcher(["android", "ios"]);
console.log(`${!m(n("Akıllı Saat Android ve İOS Uyumlu")) && m(n("Oyun Kolu Android Uyumlu")) ? "OK  " : "HATA"} dönüşen gönderilir, tek sistemli engellenir`);
if (m(n("Akıllı Saat Android ve İOS Uyumlu")) || !m(n("Oyun Kolu Android Uyumlu"))) fails++;
if (fails) { console.log(`${fails} hata`); process.exit(1); }
console.log("Uyumluluk testleri geçti");
