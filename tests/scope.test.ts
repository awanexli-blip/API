// Faaliyet kapsamı (lib/scope.ts): yalnızca ev aleti / dış giyim / ayakkabı. npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { inScope } from "../lib/scope.ts";

const ok = (cat: string, title = "") => inScope({ cat, title }).ok;

test("izinli: elektrikli küçük ev aleti, dış giyim, ayakkabı/terlik", () => {
  for (const c of ["Tıraş Makinesi", "Saç Düzleştirici", "Saç Maşası", "Saç Kurutma Makinesi", "Epilatör", "Hava Nemlendirici", "Vantilatör", "Araç İçi Süpürge", "Halı Yıkama Makinesi",
    "Blender Seti", "Kişisel Blender", "Mikser & Mikser Seti", "Doğrayıcı & Rondo", "Su Isıtıcı & Kettle", "Fritöz", "Çay Makinesi", "Tüy Toplayıcı", "Mont", "Pantolon", "Şort", "Sandalet", "Terlik", "Bot"])
    assert.ok(ok(c), c);
  assert.ok(ok("", "Yeni Nesil Turbo Saç Kurutma Makinesi 2200W"), "kategori yoksa başlık");
  assert.equal(inScope({ cat: "Blender Seti" }).group, "ev_aleti");
  assert.equal(inScope({ cat: "Mont" }).group, "dis_giyim");
});

test("kapsam dışı: oyuncak, bijuteri, elektronik, spor ayakkabı, düzenleyici, belirsizler", () => {
  for (const c of ["Eğitici Oyuncak", "Bijuteri Kolye", "Akıllı Saat", "Kulak içi TWS Bluetooth Kulaklık", "Bluetooth Hoparlör", "Parti Kostümü", "Led Işık", "Sneaker", "Spor Ayakkabı",
    "Buzdolabı Düzenleyici", "Ayakkabı Düzenleyici", "Ocak Çakmağı", "Temizlik Fırçası ve Süpürge", "Ev Terliği", "Nostaljik Radyo", "Akıllı Kamera", "Masaj Cihazı", "Tartı", "Yüz Temizleme Cihazı", "Evcilik ve Mutfak Setleri"])
    assert.ok(!ok(c), c);
  assert.ok(!ok("", "Oyuncak Mikser Seti Çocuk"), "oyuncak mikser");
  assert.ok(!ok("", "Blender Yedek Bıçağı"), "yedek parça");
  assert.ok(!ok("Blender", "Ergonomik El Blenderı Paslanmaz Çelik Metal Blender Ayağı"), "blender ayağı");
  assert.ok(!ok("Tüy Toplayıcı", "Evcil Hayvan Tüyü ve Tiftik Temizleyici Top"), "elektriksiz tüy topu");
  assert.ok(!ok("Bluetooth Hoparlör", "Saç Kurutma Makinesi Görünümlü Hoparlör"), "dışlama önce gelir değil: kategori hoparlör");
  for (const [c, t] of [["Çamaşır Makinesi Dolabı", "Çamaşır Makinesi Rafı Metal"], ["Kahve & Baharat Öğütücü", "Tuz ve Karabiber Değirmeni"], ["Kemer", "12 Parça Kamp ve Hayatta Kalma Seti"], ["Tost Makinesi", "Granit Tost Makinesi İç/Dış 25"]])
    assert.ok(!ok(c, t), t);
  assert.ok(!ok("", ""), "boş");
});
