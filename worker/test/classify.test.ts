// Kategori tahmini birim testi. node --experimental-strip-types worker/test/classify.test.ts
import { buildClassifier, type Example } from "../core/classify.ts";

let fails = 0;
const check = (name: string, cond: boolean, info: unknown = "") => { console.log(`${cond ? "OK  " : "HATA"} ${name}${cond ? "" : "  " + JSON.stringify(info)}`); if (!cond) fails++; };

const ex: Example[] = [];
const add = (titles: string[], xmlCategory: string, categoryId: string, categoryName: string, commission: number) =>
  titles.forEach((title) => ex.push({ title, xmlCategory, categoryId, categoryName, commission }));
add(["Bambu Kirli Sepeti Kapaklı", "Katlanabilir Kirli Çamaşır Sepeti", "Hasır Kirli Sepeti Büyük Boy", "Plastik Kirli Sepeti Gri"], "Ev & Yaşam >>> Banyo >>> Kirli Sepeti", "1", "Kirli Sepeti", 0.2034);
add(["Metal Benzinli Çakmak Siyah", "Rüzgar Geçirmez Benzinli Çakmak", "Zippo Tipi Benzinli Çakmak Gümüş"], "Hobi >>> Çakmak", "2", "Benzinli Çakmak", 0.164);
add(["Ahşap Eğitici Puzzle 24 Parça", "Çocuk Eğitici Ahşap Yapboz Hayvanlar", "Eğitici Puzzle Harfler"], "Oyuncak >>> Eğitici Oyuncak", "3", "Yapboz", 0.155);
add(["Silikon Mutfak Spatulası", "Çelik Mutfak Kepçesi", "Tahta Mutfak Kaşığı Seti"], "Ev & Yaşam >>> Mutfak", "4", "Mutfak Gereçleri", 0.1932);
for (let i = 0; i < 40; i++) ex.push({ title: `Rastgele Ürün ${i} Model ${i * 7}`, xmlCategory: "Diğer", categoryId: "9", categoryName: "Diğer", commission: 0.18 });

const predict = buildClassifier(ex);
const p1 = predict("Bambu Kirli Sepeti Yuvarlak", "Ev & Yaşam >>> Banyo >>> Kirli Sepeti")!;
check("kirli sepeti doğru kategori", p1?.categoryId === "1", p1);
check("kirli sepeti yüksek güven", p1?.level === "yuksek", p1);
check("komisyon komşulardan (max)", p1?.commission === 0.2034, p1);
const p2 = predict("Gümüş Benzinli Çakmak Kutulu", "Hobi >>> Çakmak")!;
check("çakmak doğru kategori", p2?.categoryId === "2", p2);
const p3 = predict("Ahşap Yapboz Eğitici 48 Parça", "Oyuncak >>> Eğitici Oyuncak")!;
check("yapboz doğru kategori", p3?.categoryId === "3", p3);
const p4 = predict("Xyzqw Bilinmeyen", "Yok")!;
check("benzeri olmayan ürün: tahmin yok veya düşük güven", p4 == null || p4.level === "dusuk", p4);

console.log(fails ? `\n${fails} sınıflandırma testi başarısız` : "\nSınıflandırma testleri geçti");
process.exit(fails ? 1 : 0);
