// Başlıktan kategori ağacı eşleşmesi (son çare). node --experimental-strip-types worker/test/category-tree.test.ts
import { buildLeafMatcher, buildPathMatcher, leavesOf, type TreeNode } from "../core/category-tree.ts";
let fails = 0;
const check = (n: string, got: string | null, want: string | null) => { const ok = got === want; console.log(`${ok ? "OK  " : "HATA"} ${n}${ok ? "" : `  beklenen ${want}, gelen ${got}`}`); if (!ok) fails++; };
const node = (id: number, name: string, subs: TreeNode[] = []): TreeNode => ({ id, name, subCategories: subs });
const tree = [
  node(1, "Elektronik", [node(10, "Bluetooth Hoparlör"), node(11, "Şarj Kablosu"), node(12, "Süpürgelik")]),
  node(2, "Oyuncak", [node(20, "Peluş Oyuncak"), node(21, "Köpek Oyuncağı"), node(22, "Diğer Oyuncaklar")]),
  node(3, "Oto", [node(30, "Oto Pompa"), node(31, "Kilit")]),
  node(4, "Ev", [node(40, "Lambader"), node(41, "Kamp Lambası")]),
];
const m = buildLeafMatcher(leavesOf(tree));
const id = (t: string) => m(t)?.categoryName ?? null;
check("iki kelimeli tam eşleşme", id("Ahşap Bluetooth Hoparlör 1800 Mah"), "Bluetooth Hoparlör");
check("ekli kelime (oyuncağı)", id("Yatmaz Kedi Köpek Oyuncağı"), "Köpek Oyuncağı");
check("lambası -> Kamp Lambası", id("Şarjlı Kamp Lambası 2000 mAh"), "Kamp Lambası");
check("kısa kelime tam olmalı (oto ≠ otomatik)", id("Otomatik Su Pompası"), null);
check("-siz eki eşleşmez (kilitsiz)", id("Kilitsiz Tekerlek 6 Cm"), null);
check("uzun ek eşleşmez (süpürgesi ≠ süpürgelik)", id("Mini El Süpürgesi"), null);
check("lambası ≠ lambader", id("Bahçe Duvar Lambası"), null);
check("eşleşme yoksa null", id("Tendon Bandı Diz Desteği"), null);
// Tedarikçi kategori yolu -> pazaryeri yaprağı
const hbTree = [node(5, "Anne, Bebek, Çocuk", [node(50, "Oyuncak", [node(500, "Eğitici Oyuncak"), node(501, "Oyuncak Araçlar", [node(5010, "Uzaktan Kumandalı Arabalar"), node(5011, "Diğer Oyuncak Araçlar")])])]),
  node(6, "Elektronik", [node(60, "Hava Nemlendirici")]), node(7, "Kitap", [node(70, "Eğitici Oyuncak Kitapları")])];
const pm = buildPathMatcher(leavesOf(hbTree));
const pid = (c: string, t: string) => pm(c, t)?.categoryId ?? null;
check("yol: son adım aynı adlı yaprak", pid("Anne, Bebek, Çocuk >>> Oyuncak >>> Eğitici Oyuncak", "Ahşap Yapboz 24 Parça"), "500");
check("yol: ara kategori -> başlıkla alt yaprak", pid("Anne, Bebek, Çocuk >>> Oyuncak >>> Oyuncak Araçlar", "Uzaktan Kumandalı Arabalar 1:24 Kırmızı"), "5010");
check("yol: ara kategori, başlık tutmazsa Diğer", pid("Anne, Bebek, Çocuk >>> Oyuncak >>> Oyuncak Araçlar", "Formula F1 24 Adet Set"), "5011");
check("yol: farklı ağaç yolu, ad aynı", pid("Elektronik >>> Akıllı Ev Aletleri >>> Hava Nemlendirici", "Ultrasonik Nemlendirici"), "60");
check("yol: eşleşme yoksa null", pid("Spor >>> Fitness", "Dambıl"), null);

// Tek kelimelik genel yaprak: başlıkta geçmesi yetmez
const gm = buildLeafMatcher(leavesOf([node(8, "Mobilya", [node(80, "Metal")]), node(9, "Mutfak", [node(90, "Buz Kalıbı")])]));
check("genel yaprak: 'metal' başlıkta geçiyor diye Metal seçilmez", gm("Şık Metal Masa Saati 13 Cm")?.categoryId ?? null, null);
check("genel yaprak: tedarikçi yolunda geçerse seçilir", gm("Metal Karyola 90x190", "Mobilya >>> Metal")?.categoryId ?? null, "80");

if (fails) { console.log(`\n${fails} kategori ağacı testi başarısız`); process.exit(1); }
console.log("\nKategori ağacı testleri geçti");
