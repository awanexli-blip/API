# Amazon TR kurulumu

Sistem Amazon'a hazır; çalışması için Amazon'un geliştirici (SP-API) bilgileri gerekiyor. Aşağıdaki adımlar senin Seller Central hesabında yapılır. Bilgileri sohbete yazma, yalnızca GitHub Secrets'a gir.

## 1. SP-API geliştirici kaydı (bir kez)

1. **Seller Central**'a gir (sellercentral.amazon.com.tr).
2. Menü → **Uygulamalar ve Hizmetler → Uygulama Geliştir** (Apps & Services → Develop Apps).
3. "Geliştirici profili" formunu doldur. Tür olarak **Özel geliştirici (private developer): yalnızca kendi hesabım için** seç.
   - İstenen roller (en azından): **Ürün Listeleme (Product Listing)**, **Fiyatlandırma (Pricing)**, **Stok ve Sipariş Takibi (Inventory and Order Tracking)**.
   - Amazon başvuruyu genelde birkaç gün içinde onaylar.
4. Onay gelince aynı sayfada **Yeni uygulama istemcisi ekle** → ad: "Pazaryeri Paneli", API türü: **SP API**, rolleri seç → Kaydet.
5. Uygulamanın yanındaki **LWA kimlik bilgileri → Görüntüle**: **Client ID** ve **Client Secret**.
6. Uygulamanın menüsünden **Uygulamayı yetkilendir (Authorize app)** → **Refresh token** oluşur (bir kez gösterilir, kopyala).
7. **Satıcı kimliği (Merchant Token / Seller ID)**: Ayarlar → Hesap Bilgileri → **Satıcı Belirteci (Merchant Token)**.

## 2. GitHub'a gir

GitHub → repo → Settings → Secrets and variables → Actions → **New repository secret**:

| Ad | Değer |
|---|---|
| `AMAZON_LWA_CLIENT_ID` | 5. adımdaki Client ID (`amzn1.application-oa2-client...`) |
| `AMAZON_LWA_CLIENT_SECRET` | 5. adımdaki Client Secret |
| `AMAZON_REFRESH_TOKEN` | 6. adımdaki refresh token (`Atzr|...`) |
| `AMAZON_SELLER_ID` | 7. adımdaki satıcı belirteci |

## 3. Bağlantıyı test et

GitHub → Actions → **Amazon test aracı** → Run workflow:

1. `ping` → "✓ Amazon Türkiye hesabı bağlı" görmelisin.
2. `listings` → mağazadaki Amazon ilanların (yoksa 0).
3. `search` + bir ürünün gerçek barkodu (veya birkaç kelime) → Amazon'daki eşleşen ürünler (ASIN).

## 4. Panelde aç

1. Panel → **Pazaryerleri → Amazon TR → Fiyat ayarları**: "Bu pazaryeri aktif" kutusunu işaretle. Komisyon (Amazon satış ücreti, kategoriye göre ~%8-15; varsayılan %15) ve kargo (satıcı her siparişte öder) ayarlarını kontrol et, kaydet.
2. **Akıllı kâr** sekmesinde Amazon'a özel kural eklenebilir (Trendyol kuralları "Sadece Trendyol" ise Amazon'u etkilemez).
3. Zamanlı senkrona eklemek için GitHub → Settings → Variables → `SYNC_MARKETPLACES` = `["trendyol","hepsiburada","amazon"]`.

## 5. Ürün gönderme (ASIN eşleşmesi)

Amazon'da yeni ürün sayfası açmak için **gerçek barkod (GS1 lisanslı GTIN/EAN)** gerekir; tedarikçi barkodları (`BX5XM...`) ve sistemin ürettiği `2...` barkodları kabul edilmez. Bu yüzden şimdilik ürünün Amazon'da **zaten satılan aynısına teklif** verilir:

1. Ürün detayında **Amazon'a gönder**.
2. Ürünün gerçek barkodu varsa ve Amazon'da tek ürüne denk geliyorsa eşleşme otomatik onaylanır ve teklif gönderilir.
3. Yoksa sistem başlığa göre aday ürünler bulur → ürün detayındaki **Amazon eşleşmesi** kartında doğru olana **Bu ürün** de (veya ASIN'i elle yaz) → tekrar **Amazon'a gönder**.
4. Durum "Pazaryerlerinde" kartında: gönderildi → yayında / reddedildi (+ neden).

Dikkat: Teklif verdiğin ürün birebir aynı ürün olmalı (marka, model, içerik). Farklı ürüne teklif Amazon'da hesap uyarısına yol açar.

## 6. Kendi ürünlerini açmak (GTIN muafiyeti veya Marka Kaydı)

- **GTIN muafiyeti**: Seller Central → Katalog → Ürün ekle → "GTIN muafiyeti başvurusu" (Apply for GTIN exemption). Marka adı (Eco Lounge) ve kategori seçilir, ürün fotoğrafları (markanın ürün veya ambalaj üzerinde göründüğü) istenir.
- **Marka Kaydı (Brand Registry)**: TÜRKPATENT'te tescilli (veya başvurusu yapılmış) marka gerekir; brandservices.amazon.com.tr.
- Onay gelince haber ver: yeni ürün açma (ürün tipi şeması ve zorunlu alanlar) eklenecek.

## Teknik notlar

- Uçlar: `https://sellingpartnerapi-eu.amazon.com`, Türkiye pazaryeri kimliği `A33AVAJ2PDY3EV`, giriş LWA (`https://api.amazon.com/auth/o2/token`).
- İlanlar: `GET_MERCHANT_LISTINGS_ALL_DATA` raporu (SKU, ASIN, fiyat, stok). Stok/fiyat: `JSON_LISTINGS_FEED` PATCH (`fulfillment_availability`, `purchasable_offer`). Teklif: `UPDATE` + `requirements: LISTING_OFFER_ONLY` + `merchant_suggested_asin` + `condition_type: new_new`.
- Amazon'da SKU = ürün veritabanındaki varyant SKU'su (BayilikXML ürünlerinde ürün kodu).
- Kod: `worker/marketplaces/amazon.ts`, test aracı `worker/amazon-tool.ts`, sahte servis testleri `worker/test/run.mjs` (9h).
