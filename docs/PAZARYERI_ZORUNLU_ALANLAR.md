# Pazaryerlerine ürün gönderirken zorunlu alanlar

Bu belge, panelden ürün eklerken Trendyol ve Hepsiburada'nın neleri istediğini ve sistemin bunları nasıl karşıladığını anlatır. Amazon kapsam dışıdır. N11, ÇiçekSepeti ve Pazarama'ya bağlantı (API) henüz kurulmadığı için onlara gönderim yoktur.

**Temel kural:** Herhangi bir pazaryerinin zorunlu tuttuğu alan, bizim formda da zorunludur. Örneğin Hepsiburada ayakkabıda Cinsiyet istiyorsa, formda Cinsiyet doldurulmadan Hepsiburada'ya gönderim yapılmaz. Formun "Gönderime hazırlık" kutusu, her pazaryeri için eksik olanları tek tek yazar.

## 1. Her üründe istenen temel alanlar

| Alan | Trendyol | Hepsiburada | Sistem ne yapıyor |
|---|---|---|---|
| Başlık | 5–100 karakter | 5–200 karakter | Trendyol'a ilk 100 karakter gider. Form, başlık 100'ü aşınca Trendyol için uyarır. |
| Açıklama | Zorunlu | Zorunlu | En az 30 karakter istenir. Boşsa başlık açıklama olarak gider ama zayıf kalır. |
| Marka | Trendyol'da kayıtlı marka (birebir aynı ad) | Marka adı | Elle girilen üründe ürünün markası gider. Trendyol'da yoksa ilan "marka bulunamadı" hatası alır; o zaman marka yetkisi alınır ya da mağaza markası yazılır. |
| Kategori | Trendyol kategori numarası (yaprak kategori) | HB kategori numarası | Formda her pazaryeri için ayrı aranıp seçilir. "Başlıktan öner" düğmesi var. |
| Barkod | Her varyantta farklı, en çok 40 karakter | Her varyantta farklı | Boşsa kaydederken otomatik üretilir (2 ile başlayan iç barkod). |
| Görsel | En az 1, en çok 8 | En az 1, en çok 5 | Fazlası gönderilmez. Trendyol WebP göstermediği için görseller 1200×1800 JPG'ye çevrilerek gider. |
| Desi | Zorunlu (dimensionalWeight) | Zorunlu (kg) | Kargo ücreti buna göre hesaplanır. |
| KDV | 0 / 1 / 10 / 20 | 0 / 1 / 10 / 20 | Formdaki KDV. |
| Fiyat | Satış fiyatı + liste fiyatı | Fiyat | Boşsa formülle (en az 40 TL ve satışın en az %10'u net). Formda "Satış fiyatı" yazılırsa o gider; zarar ettiriyorsa uygulanmaz. |
| Stok | En çok 20.000 | En çok 20.000 | Trendyol'da 3, HB'de 5 adetten azsa 0 gönderilir (iptal cezası riski). |
| Garanti süresi | Kategoriye göre özellik | Zorunlu (GarantiSuresi, ay) | HB'de başlıktan çıkarılır, yoksa 0. |
| Varyant grubu | productMainId | VaryantGroupID | Aynı ürünün numaraları/renkleri tek ilan sayfasında seçenek olarak çıkar (ürün kodu). |
| Sevkiyat / iade adresi | Hesaptaki adres | — | GitHub Secrets'taki adres numaraları. |

## 2. Kategoriye göre zorunlu özellikler

Bu liste kategoriye göre değişir ve pazaryerleri sık sık değiştirir. Bu yüzden sabit bir liste tutmuyoruz: kategori seçildiği anda pazaryerinin **kendi güncel listesi** çekilir. Panel önbelleği 7 günde bir yenilenir.

- **Trendyol:** Liste herkese açık servisten anında gelir.
- **Hepsiburada:** Anahtarlar GitHub'da olduğu için "Pazaryeri kataloğu" iş akışı getirir. Bir kategori ilk kez seçilince yaklaşık 1–2 dakika sürer, sonra anında açılır.

Formda her özellik tek satırdır. Yanında hangi pazaryerinin istediği yazar (örneğin "Trendyol zorunlu · HB zorunlu"). Değer pazaryerinin kendi listesinden seçilir. Seçilen değer diğer pazaryerinin listesinde yoksa, altında o pazaryeri için ayrı seçim çıkar.

### Örnek: erkek sneaker (27.10.2026'da pazaryerlerinden çekildi)

| Özellik | Trendyol (Sneaker, 975) | Hepsiburada (Erkek > Sneakers, 204249) | Formda |
|---|---|---|---|
| Cinsiyet | Zorunlu (Unisex / Kadın / Kız / Erkek) | Zorunlu (Erkek / Kadın / Unisex / Erkek Çocuk / Kız Çocuk) | Zorunlu, tek alan |
| Numara | Zorunlu, varyant ("Beden": 35, 37.5, 42...) | Zorunlu, varyant ("Ayakkabı Numarası") | Varyant satırlarından (Ayakkabı grubu 35–46) |
| Renk | Zorunlu (ilan sayfasını renge göre ayırır) | Zorunlu, varyant | Varyant satırlarından |
| Web Color | Zorunlu (Trendyol'un renk filtresi) | — | Zorunlu alan |
| Yaş Grubu | Zorunlu | — | Zorunlu alan |
| Topuk Boyu | Zorunlu | — | Zorunlu alan (düz ayakkabıda "Belirtilmemiş") |
| Menşei | Zorunlu (ülke kodu: TR, CN...) | — | Zorunlu alan |
| Materyal, Taban, Sezon... | İsteğe bağlı | İsteğe bağlı | "İsteğe bağlı özellikler" altında (doldurmak aramada bulunmayı artırır) |

"Boşları akıllı doldur" düğmesi, boş zorunlu alanlara önce başlıkta geçen değeri, yoksa nötr değeri ("Belirtilmemiş" vb.) yazar. Kontrol etmek senin elinde.

### Varyantlar (numara, beden, renk)

- Formda "Bu ürünün farklı renk veya bedenleri var" seçilir; Giyim, Ayakkabı (35–46), Çocuk ayakkabı (20–35) ya da serbest değer.
- Numara ve renk, pazaryerindeki "Beden / Numara / Ayakkabı Numarası / Renk" özelliğine kendiliğinden yazılır.
- Seçilen numara pazaryerinin listesinde yoksa (örneğin 47.5) form uyarır ve gönderim yapılmaz.

## 3. Gönderimden sonra

- Pazaryeri ürünü inceler; durum, ürün detayındaki "Pazaryerlerinde" bölümünde görünür: gönderildi → onay bekliyor → yayında, ya da ret nedeni.
- Ret nedenleri "Gönderilemeyenler / Reddedilenler" ekranlarında toplanır.
- Stok ve fiyat bundan sonra her senkronda otomatik güncellenir.

## 4. Tedarikçi ürünleri

XML'den gelen ürünlerde kategori ve özellikler otomatik bulunur: benzer ilanlardan tahmin, tedarikçi kategori yolu, başlıktan çıkarım ve yapay zekâ. Bulunamayanlar "Özellik tamamla" ekranına düşer. Toptancım'ın aynı ürünü farklı kodla (-1, -2...) tekrar yayınladığı kopyalardan yalnızca stokta olan en ucuzu gönderilir.
