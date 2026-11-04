// Satış kısıtı (lib/scope.ts): yalnızca gıda ve iç giyim yasak (K, 01.11). npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { inScope, inScopeAny, inScopeForSend } from "../lib/scope.ts";

const ok = (cat: string, title = "") => inScope({ cat, title }).ok;

test("satılabilir: gıda ve iç giyim dışı her şey", () => {
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

test("yasak: iç giyim", () => {
  for (const c of ["Külot", "Boxer", "Sütyen", "Atlet", "Çorap", "Emzirme Sütyeni", "Emzirme Atleti", "Bebek Body & Zıbın", "Pijama Takımı", "Giyim > İç Giyim > Fanila"])
    assert.ok(!ok(c), c);
  assert.ok(!ok("", "Erkek Pamuklu Boxer 3'lü"), "kategori yoksa başlık");
  assert.ok(!ok("", "Kadın Dantelli Sütyen"));
});

test("birden çok kategori: biri yasaksa yasak; gönderim aynı kural", () => {
  assert.ok(!inScopeAny(["Ev & Yaşam", "Çorap"], "Kışlık Çorap").ok);
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
