// Hepsiburada EK.4 kategori komisyonları (data/hepsiburada/commissions.json, sözleşme PDF'i): ürün grubundan orana.
// Satır metni "Ana Kategori Kategori Ürün1, Ürün2, ..." biçiminde; baştaki ana kategori ve kategori adı ayrılır, kalan her ürün grubu
// (virgülle ayrılmış) bir aday ad olur ve kategori ağacı eşleştiricisiyle (core/category-tree.ts: adın tüm kelimeleri metinde) aranır.
// Önce HB kategori adı, sonra ürün başlığı. Eşleşme yoksa null (adaptör varsayılan oranı kullanır). Test: hepsiburada-commission.test.ts
import { readFileSync } from "node:fs";
import { buildLeafMatcher } from "../core/category-tree.ts";

const MAINS = ["Altın", "Aksesuar", "Çanta", "Ayakkabı", "Giyim", "Parfüm", "Outdoor- Deniz", "Spor & Outdoor", "Spor Branşları", "Taraftar Ürünleri",
  "Cep Telefonu aksesuarları", "Cep Telefonu", "Bilgisayar", "Foto-Kamera", "Oto Aksesuar", "SDA", "MDA- Beyaz Eşya", "TV", "Anne Bebek Ürünleri",
  "Cilt Bakımı", "Saç Bakım", "Makyaj", "Petshop", "Sağlık Kişisel Bakım Ürünleri", "Ev Bakım ve Temizlik", "Temel Tüketim ve Gıda", "Bahçe",
  "Yapı Market", "Ev Tekstili", "Mobilya", "Züccaciye", "Oyuncak", "Kırtasiye ve Ofis", "Film", "Kitap", "Müzik", "Dijital Ürünler", "Oyun Konsol",
  "NonTV", "Hobi-Oyun"];
const CATS = ["Altın Yatırım", "Altın / Takı / Mücevher", "Saat/Gözlük", "Aksesuar, Yedek Parça", "Aksesuar", "Valiz Bavul", "Çanta", "Ayakkabı", "Bebek Giyim", "Giyim & Ayakkabı", "Giyim",
  "Parfümler", "Outdoor-Deniz Ekipmanları", "Spor Aletleri", "Fitness ve Kondisyon Ekipmanları", "Bisikletler ve Paten", "Spor Branşları", "Taraftar Ürünleri",
  "Cep Telefonu Aksesuarları 1", "Cep Telefonu Aksesuarları 2", "Cep Telefonu Aksesuarları 3", "Cep Telefonu Aksesuarları 4", "Cep Telefonu Aksesuarları 5", "Cep Telefonu",
  "Tablet", "Taşınabilir Bilgisayar", "Bilgisayar Bileşenleri & Çevre Birimleri", "Bilgisayar Bileşenleri", "Projeksiyon & Aksesuarları", "Yazıcılar ve Aksesuarları",
  "Ağ/Modem, Akıllı Ev", "Çevre Birimleri", "Yazılım", "Aynasız SLR Fotoğraf Makineleri", "Fotoğraf ve Kamera Aksesuarları", "Drone & Drone Aksesuarları", "Drone Aksesuarları",
  "Fotoğraf Makineleri & Video Kameralar", "Oto Aksesuarları & Ses ve Navigasyon Sistemleri", "Araç İçi Ekipman & Aksesuarlar",
  "Araç Dış Aksesuarlar & Temizlik Ürünleri & Oto Aksesuar", "Araç Dış Aksesuarlar & Temizlik Ürünleri", "Motosiklet Lastik", "Oto Lastik", "Oto Yedek parça", "Oto Aksesuar Akü",
  "Oto Aksesuar", "Motosiklet Aksesuarları", "Yakıt ve Yağ Katkıları", "Traktör Lastikleri", "Süpürge & Ütüler", "Süpürgeler", "Mutfak Gereçleri & Pişirme-Hazırlama",
  "Elektrikli Kişisel Bakım Aletleri", "Bulaşık, Çamaşır, Kurutma Makinesi ve Buzdolabı", "Ev Isıtma & Soğutma Sistemleri", "Ankastre & Pişirme Grubu",
  "Beyaz Eşya Yedek Parça & Aksesuar", "LCD Televizyon", "Anne / Bebek Bakım", "Anne / Bebek Beslenme", "Anne / Bebek", "Cilt Bakım / Saç Bakım", "Cilt Bakım", "Saç Bakım",
  "Makyaj Ürünleri", "Petshop Beslenme", "Petshop Aksesuar", "Ağız Bakım Ürünleri", "Sağlık / Kişisel Bakım Ürünleri", "Güzellik Salonu & Kuaför Ürünleri",
  "Deterjanlar, Temizlik Malzemeleri, Kağıt Ürünleri ve Mutfak Sarf Malzemeleri", "İçecek ve Gıda Ürünleri", "Bungalov Ev", "Bahçe Dekorasyon ve Bakım", "Bahçe Mobilyası",
  "Mangal / Barbekü", "Bahçe Makineleri", "Banyo & Ev Gereçleri", "Hırdavat", "Aydınlatma Ürünleri", "Elektrik ve Aydınlatma ürünleri", "Jeneratör", "Yatak Odası Tekstili",
  "Halı & Kilim", "Banyo Tekstili", "Mutfak Tekstil", "Dekorasyon", "Ofis Dekorasyon", "Ev Mobilya", "Yatak Odası Takımları", "Sofra & Mutfak Gereçleri", "Oyuncak",
  "Ofis Makineleri", "Fotokopi Kağıtları", "Piller ve Şarj Cihazları", "Kırtasiye ve Ofis Ürünleri ve Sanatsal Malzeme", "Film", "Kitap", "Müzik Alet ve Ekipmanları",
  "Dijital Ürünler 1", "Dijital Ürünler 2", "Telsiz Masaüstü Telefonlar", "Akıllı Saat-Bileklik & Bluetooth Kulaklıklar", "Oyun Konsolu", "Konsol Oyunları",
  "Konsol Aksesuarları", "Oyun Ödeme Kartları", "Televizyon ve Elektronik Aksesuarları", "Dijital ve Güvence Paketleri", "Ev Güvenlik Ürünleri", "Ev Sinema ve Ses Sistemleri",
  "Hobi, Oyun Eğlence Ürünleri"];
const sp = (s: string) => s.replace(/\s+/g, " ").trim();
const byLen = (l: string[]) => [...l].map(sp).sort((a, b) => b.length - a.length);
const mains = byLen(MAINS), cats = byLen(CATS);
// PDF'ten kopyalanan metinde satır sonları boşluksuz birleşmiş olabilir ("Outdoor-DenizEkipmanları"): boşluklar yok sayılarak karşılaştırılır
const ns = (s: string) => s.replace(/\s+/g, "").toLocaleLowerCase("tr");
function cut(s: string, list: string[]) {
  const t = ns(s);
  const hit = list.find((x) => t.startsWith(ns(x)) && t.length > ns(x).length);
  if (!hit) return { hit: "", rest: s };
  let n = ns(hit).length, i = 0;
  while (n > 0 && i < s.length) { if (!/\s/.test(s[i])) n--; i++; }
  return { hit, rest: s.slice(i).trim() };
}
// Çoğul eki atılır ("Telefon Kılıflar" -> "Telefon Kılıf" ki "Telefon Kılıfı" eşleşsin)
const singular = (n: string) => n.split(/\s+/).map((w) => (w.length > 6 ? w.replace(/(ları|leri|lar|ler)$/i, "") : w)).join(" ");

type Row = { text: string; rate: number };
export function splitRow(text: string) {
  const m = cut(sp(text), mains);
  const c = cut(m.rest, cats);
  return { main: m.hit, category: c.hit, items: c.rest.split(",").map(sp).filter(Boolean) };
}

export function buildCommissionMatcher(rows: Row[]) {
  const leaves: { id: string; name: string; path: string[] }[] = [];
  // Birden çok satırda farklı oranla geçen kategori adı aday olmaz (ör. "Bilgisayar Bileşenleri" %7-17)
  const catRates = new Map<string, Set<number>>();
  const parsed = rows.map((r) => ({ ...splitRow(r.text), rate: r.rate }));
  for (const p of parsed) if (p.category) catRates.set(p.category, (catRates.get(p.category) ?? new Set()).add(p.rate));
  parsed.forEach((p, i) => {
    const names = [...p.items, ...(p.category && catRates.get(p.category)!.size === 1 ? [p.category.replace(/\s\d$/, "")] : [])];
    for (const n of new Set(names)) {
      const name = singular(n.replace(/[()]/g, " ").replace(/\s+/g, " ").trim());
      if (name && !/^(diğer|ve)$/i.test(name)) leaves.push({ id: String(i), name, path: [p.main, p.category, name] });
    }
  });
  const match = buildLeafMatcher(leaves);
  return (category: string, title = "", supplierCategory = ""): { rate: number; group: string } | null => {
    // Kategori adıyla eşleşme; olmazsa başlıkla, yalnızca güçlü eşleşme (tek kısa kelime "Mobil" -> "Mobilya" gibi yanlışlar olmasın)
    const c = singular(category), t = singular(title);
    const byTitle = t ? match(t, `${category} ${supplierCategory}`) : null;
    // İkisi de bulunursa yüksek oran (ör. "Kablolar" %16,67 ama başlık "Data Şarj Kablosu" %20): düşük komisyonla fiyat düşük kalıp zarar edilmesin
    const hits = [c ? match(c, t) : null, byTitle && byTitle.score >= 8 ? byTitle : null].filter((h): h is NonNullable<typeof h> => !!h)
      .map((h) => ({ rate: parsed[Number(h.categoryId)].rate, group: h.categoryName }));
    return hits.sort((a, b) => b.rate - a.rate)[0] ?? null;
  };
}

let cached: ReturnType<typeof buildCommissionMatcher> | null = null;
export function hbCommissionMatcher() {
  if (!cached) {
    let rows: Row[] = [];
    try { rows = JSON.parse(readFileSync(new URL("../data/hepsiburada/commissions.json", import.meta.url), "utf8")).rows ?? []; } catch { /* dosya yoksa varsayılan oran */ }
    cached = buildCommissionMatcher(rows.filter((r) => r && typeof r.rate === "number" && r.text));
  }
  return cached;
}
