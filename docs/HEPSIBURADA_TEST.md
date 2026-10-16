# Hepsiburada entegrasyon testi — kontrol listesi

Hepsiburada aradığında açık olsun. Tüm komutlar: **GitHub → Actions → "Hepsiburada test aracı" → Run workflow** (komut + argüman + ortam seç). Sonuç adımın loglarında ve "hb-tool-…" artifact'ında (`hb_tool_output.json`).

## 1. Aramadan önce (5 dk)

GitHub → repo → Settings → Secrets and variables → Actions:

| Ad | Tür | Değer |
|---|---|---|
| `HB_MERCHANT_ID` | Secret | Mağaza ID: `cac692e1-ad3f-4dcf-aaa0-6fc77c3d21e3` (test ortamı farklı ID verirlerse onu yaz) |
| `HB_USERNAME` | Secret | Hepsiburada'nın verdiği API / entegratör kullanıcı adı |
| `HB_PASSWORD` | Secret | Şifresi |
| `HB_USER_AGENT` | Variable (isteğe bağlı) | Hepsiburada belirli bir User-Agent isterse (örn. `kullaniciadi - uygulama`). Boşsa kullanıcı adı gönderilir |

Şifreyi sohbete, koda veya ekran paylaşımına yazma.

## 2. Arama sırasında — test senaryoları

Ortam: **sit** (test). Canlıya en son geçilir.

| # | Ne isteyebilirler | Komut | Argüman |
|---|---|---|---|
| 1 | Bağlantı kontrolü | `ping` | — |
| 2 | Kategori listesi | `categories` | aranacak kelime, örn. `kirli sepeti` |
| 3 | Kategori özellikleri | `attributes` | kategori ID, örn. `18021982` |
| 4 | **1 ürün gönder** | `send` | `1 <kategoriId>` (isteğe bağlı XML kategori filtresi: `1 18021982 banyo`) |
| 5 | Gönderim sonucu | `status` | takip numarası (4. adımın çıktısında) |
| 6 | **2 ürün gönder** | `send` | `2 <kategoriId>` |
| 7 | **10 ürün gönder** | `send` | `10 <kategoriId>` |
| 8 | Mağazadaki ürünler (listing) | `listings` | `20` |
| 9 | Stok güncelle | `stock` | `<merchantSku> <adet>`, örn. `OS13-ABC123 5` |
| 10 | Fiyat güncelle | `price` | `<merchantSku> <fiyat>`, örn. `OS13-ABC123 249.90` |
| 11 | Siparişler | `orders` | — |
| — | Yeni bir uç/alan denemek | `raw` | `GET mpop /product/api/...` · `POST listing /listings/merchantid/{merchantId}/... '[{...}]'` |

İpucu: test için zorunlu özelliği az olan basit bir kategori seç (`attributes` ile bak). `send` komutu stokta olan, görseli olan ve fiyatı hesaplanabilen ürünleri seçer. Fiyat, panelde Hepsiburada için tanımlı formülle hesaplanır (komisyon +KDV, desi kargo). Her ürünün merchantSku'su `OS13-` + ürün kodu.

## 3. Hepsiburada'ya sorulacaklar

1. **Test (SIT) bilgileri:** Kullanıcı adı, şifre ve test mağaza ID'si canlıdakinden farklı mı? Canlı bilgiler testten sonra mı verilecek?
2. **User-Agent:** Zorunlu bir biçim var mı?
3. **Uç adresleri:** Ürün gönderme `mpop…/product/api/products/import`, durum `…/products/status/{id}`, stok `listing-external…/stock-uploads`, fiyat `…/price-uploads` doğru mu? Güncel doküman linki?
4. **Sipariş entegrasyonu zorunlu mu?** Testte sipariş çekme, paketleme, kargo bilgisi, fatura linki adımları da isteniyor mu? (Bizim sistem şu an ürün, stok ve fiyatı yönetiyor; siparişler panelden yönetiliyor. Zorunluysa sipariş modülü eklenir.)
5. **Barkod / GTIN:** Ürünlerde gerçek EAN barkod zorunlu mu? (Bizde barkod = stok kodu, `OS13-…`.)
6. **Marka:** "Eco Lounge" markasıyla ürün açabilir miyiz? Marka kaydı / yetki belgesi gerekiyor mu?
7. **Kargo:** Kargo her siparişte satıcıdan mı kesiliyor? Müşterinin ödediği bir eşik var mı? Hangi kargo firmasıyla çalışacağız? (Ayarda hepsiJET desi tarifesi var.)
8. **Hız sınırı:** Dakikada / saniyede kaç istek? Toplu stok/fiyat güncellemede paket başına kaç ürün?
9. **Ürün onayı:** Gönderilen ürünler ne kadar sürede onaylanır? Ret nedenleri nereden okunur?
10. **Katalog eşleşmesi:** Aynı ürün Hepsiburada kataloğunda varsa yeni ürün yerine mevcut ürüne listing mi açmalıyız?

## 4. Testten sonra — canlıya geçiş

1. Canlı bilgileri Secrets'a yaz (test bilgilerinin üzerine).
2. GitHub → Variables → `HB_ENV` = `prod`.
3. Araçta ortam `prod` ile `ping`.
4. Kategori eşleşmeleri: `suggest` çıktısındaki (`hb_category_suggestions.csv`) önerileri panel → Hepsiburada → Kategoriler'e gir.
5. Panel → Hepsiburada → Fiyat ayarları: komisyon, kargo firması, minimum stok kontrolü.
6. Önizleme → 10 ürünle `create` → sonuç temizse otomatik senkronu aç.

## Bilinen belirsizlikler

Hepsiburada'nın resmi dokümanı bot korumalı, uç adresleri ve alan adları açık kaynak koddan ve ikincil kaynaklardan alındı. Testte bir uç hata verirse `raw` komutuyla doğru adres denenir, kod aynı gün düzeltilir. Araç her yanıtı ham haliyle yazdığı için alan adı farkları hemen görünür.
