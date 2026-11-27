// Satış kısıtı (lib/scope.ts): yalnızca gıda yasak (K, 16.11). npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { inScope, inScopeAny, inScopeForSend } from "../lib/scope.ts";

const ok = (cat: string, title = "") => inScope({ cat, title }).ok;

test("satılabilir: gıda dışı her şey", () => {
  for (const c of ["Eğitici Oyuncak", "Bijuteri Kolye", "Akıllı Saat", "Tıraş Makinesi", "Bluetooth Hoparlör", "Parti Kostümü", "Sneaker", "Mont", "Medikal Korse",
    "Kahve & Baharat Öğütücü", "Çay Makinesi", "Türk Kahvesi Makinesi", "Kedi ve Köpek Mama Su Kabı", "Kahve Fincanı", "Çay Süzgeci", "Akü Takviye Kablosu", "Saklama Kabı",
    "Mutfak > Gıda Saklama Kabı", "Suluk & Matara", "Termos", "Kargaburun", "Ev & Yaşam > Mutfak > Su Sebili",
    "Süpermarket, Pet Shop >>> Sağlık >>> Masaj Aleti >>> Masaj Cihazı", "Süpermarket, Pet Shop >>> Ev Bakım ve Temizlik >>> Haşere Öldürücü",
    "Elektronik >>> Elektrikli Ev Aletleri >>> Yiyecek & İçecek Hazırlama >>> İçecek Hazırlama >>> Su Isıtıcı & Kettle", "Süpermarket, Pet Shop >>> Anne ve Bebek Bakım >>> Bebek Beslenme ve Emzirme"])
    assert.ok(ok(c), c);
  assert.ok(ok("", "Çikolata Kalıbı Silikon"), "kategori yoksa başlıkta gıda kelimesi elemez");
  assert.ok(ok("", "Atletik Spor Ayakkabı"), "atletik");
  assert.ok(ok("", "Çoraplık Düzenleyici"), "çoraplık");
});

test("yasak: gıda", () => {
  for (const c of ["Su", "Kola", "Makarna", "Pirinç", "Zeytinyağı", "Çikolata", "Sağlıklı Atıştırmalık", "Bebek Bisküvisi", "Kavanoz Maması", "Şeker Hamuru", "Kahve", "Bal",
    "Süpermarket > Temel Gıda > Bakliyat", "Gıda > Kahvaltılık", "Süpermarket, Pet Shop >>> Gıda >>> Kahve"])
    assert.ok(!ok(c), c);
});

test("iç giyim artık satılabilir (K, 16.11)", () => {
  for (const c of ["Külot", "Boxer", "Sütyen", "Çorap", "Pijama Takımı", "Giyim > İç Giyim > Fanila", "Fantazi İç Giyim >>> Fantazi Külot"]) assert.ok(ok(c), c);
  assert.ok(ok("", "Erkek Pamuklu Boxer 3'lü"));
});

test("birden çok kategori: biri yasaksa yasak; gönderim aynı kural", () => {
  assert.ok(!inScopeAny(["Ev & Yaşam", "Kahve"], "Türk Kahvesi 250 g").ok);
  assert.ok(inScopeAny(["Ayakkabı > Bot", "Fermuar"], "Erkek Kışlık Bot").ok);
  assert.ok(inScopeAny([null, ""], "Saç Kurutma Makinesi").ok);
  assert.ok(!inScopeForSend("Süpermarket > İçecekler", "Kola", "Kola 1 L").ok);
  assert.ok(inScopeForSend("Oyuncak", "Eğitici Oyuncak", "Ahşap Yapboz").ok);
});

import { vatSuspect } from "../lib/scope.ts";
test("Türkçe karaktersiz gıda kategorileri (Bezos) ve şüpheli KDV", () => {
  for (const c of ["Ev & Yaşam Ürünleri > Gıda ve İçecek Ürünleri > Icecekler", "Ev & Yaşam Ürünleri > Gıda ve İçecek Ürünleri > Temel Gida", "Süpermarket > Gida Urunleri"])
    assert.ok(!ok(c), c);
  assert.ok(ok("Ev & Yaşam Ürünleri > Mobilya > Salon & Oturma Odası > Sehpa > Zigon Sehpa"), "zigon");
  assert.ok(vatSuspect(1) && vatSuspect(0) && !vatSuspect(10) && !vatSuspect(20) && !vatSuspect(null));
});

import { toyMismatch } from "../lib/scope.ts";
test("oyuncak uyumsuzluğu: tedarikçide oyuncak, pazaryerinde gerçek ürün kategorisi", () => {
  assert.ok(toyMismatch("Anne, Bebek, Çocuk >>> Oyuncak >>> Oyun Setleri", "Araç İçi Süpürge"));
  assert.ok(toyMismatch("Anne, Bebek, Çocuk >>> Oyuncak >>> Oyun Setleri", "Kulak içi TWS Bluetooth Kulaklık"));
  assert.ok(!toyMismatch("Anne, Bebek, Çocuk >>> Oyuncak >>> Oyuncak Araçlar", "Oyuncak Araba"));
  assert.ok(!toyMismatch("Oyuncak >>> Bahçe", "Kaykay"));
  assert.ok(!toyMismatch("Elektronik > Süpürge", "Araç İçi Süpürge"), "tedarikçi oyuncak değil");
  assert.ok(!toyMismatch("Oyuncak", null), "kategori yok");
});

import { trendyolRuleBlock } from "../lib/scope.ts";
test("Trendyol satış kuralı: çakmak, küllük, nargile, silah", () => {
  for (const t of ["Elektrikli Çakmak El Feneri", "Tek Kullanımlık Jel Küllük", "RGB LED Nargile Altı Işık", "ER-109 Oyuncak Tüfek", "Sünger Mermi Atan"]) assert.ok(trendyolRuleBlock(t), t);
  for (const t of ["Çakmaklı Değil Kalem", "Sigaralık", "Silahşör Figürü", "Saç Kurutma Makinesi"]) assert.ok(!trendyolRuleBlock(t), t);
});

import { adultMismatch } from "../lib/scope.ts";
test("+18 ürün bebek/çocuk/oyuncak kategorisinde satılmaz", () => {
  assert.ok(adultMismatch("Ev & Yaşam Ürünleri > +18 Ürünler > Cinsel Sağlık", "Diğer Bebek Sağlık Ürünleri"));
  assert.ok(adultMismatch("Fantezi Giyim", "Eğitici Oyuncak"));
  assert.ok(!adultMismatch("+18 Ürünler > Masaj Yağı", "Masaj Yağı"));
  assert.ok(!adultMismatch("Anne Bebek > Bebek Bakım", "Diğer Bebek Sağlık Ürünleri"), "gerçek bebek ürünü");
  assert.ok(!adultMismatch("+18 Ürünler", null), "kategori yok");
});

test("Colezium Gıda Market: gıda adımları yasak, aynı başlıktaki parfüm/temizlik ve pet ürünleri serbest", () => {
  for (const c of ["Gıda Market > Bitkisel Doğal Ürünler > Mutfak Baharatları > Baharat Çeşitleri", "Gıda Market > Bitkisel Doğal Ürünler > Pekmez Ekşi Sos Sirke", "Gıda Market > Tuz, Kaya Tuzu Ürünleri > Tuz Çeşitleri", "Gıda Market > Aktariye Ürünleri > Gıda Boyası"])
    assert.ok(!ok(c), c);
  for (const c of ["Gıda Market > Esans Kolonya Parfüm > Parfümler > Erkek Parfüm", "Gıda Market > Süpermarket > Deterjan ve Temizlik Ürünleri > Fırça Çeşitleri", "Gıda Market > Kozmetik Kişisel Bakım > Sabun Şampuan Jel"])
    assert.ok(ok(c), c);
});

test("mama yasak (K 28.11): evcil hayvan + bebek maması, kategori ve başlık", () => {
  assert.equal(inScope({ cat: "Pet Shop > Kedi Mamaları & Ödülleri" }).ok, false);
  assert.equal(inScope({ cat: "Evcil > Kuru Mamalar" }).ok, false);
  assert.equal(inScope({ cat: "Anne Bebek > Bebek Mamalari" }).ok, false);
  assert.equal(inScope({ cat: "Market > Konserve Salca ve Hazir Yemek" }).ok, false);
  assert.equal(inScope({ cat: "Pet Shop > Köpek Ödülleri" }).ok, false);
  assert.equal(inScope({ cat: "Pet Shop", title: "Tavuklu Yavru Kedi Maması 1,5 Kg" }).ok, false);
  assert.equal(inScope({ cat: "Pet Shop", title: "Dentastix Köpek Ödülü 180 Gr" }).ok, false);
  // gıda değil: kap, sandalye, aksesuar, oyuncak
  assert.equal(inScope({ cat: "Pet Shop > Köpek Mama ve Su Kapları" }).ok, true);
  assert.equal(inScope({ cat: "Anne Bebek > Anakucağı, Mama Sandalyeleri ve Pusetler" }).ok, true);
  assert.equal(inScope({ cat: "Pet Shop", title: "Paslanmaz Çelik Kedi Mama Kabı" }).ok, true);
  assert.equal(inScope({ cat: "Pet Shop", title: "Peluş Civciv Kedi Oyuncağı" }).ok, true);
  assert.equal(inScope({ cat: "Pet Shop", title: "Konfor Dokuma Köpek Boyun Tasması" }).ok, true);
});
