# Yapılacaklar

Durum: `[ ]` bekliyor · `[~]` devam · `[x]` bitti · `(K)` kullanıcı işi/onayı gerekir.
Gelişmeler ve kararlar: `docs/PROGRESS.md`.

## P0 — Acil: Trendyol V1 kapanışı (15 Ekim 2026) — bitti, canlıda doğrulandı (16.10)

Trendyol "Product V1 servisleri 15.10.2026'dan itibaren geçersiz" diyor. Worker V1 kullanıyor.

- [x] Ürün listeleme: `GET /product/sellers/{id}/products?size=1000` (V1) → `GET /product/sellers/{id}/products/approved` (V2). Sayfa boyutu en fazla **100**, `page*size` 10.000'i geçemez, sonrası `nextPageToken`. Barkod/fiyat/stok `content[].variants[]` içinde (`price.salePrice`, `stock.quantity`, `commission`, `locked`, `archived`). `category.id` / `brand.id` içerikte.
- [x] Her isteğe `storeFrontCode` başlığı → belgeye göre gönderilmezse TR. Sadece `TRENDYOL_STOREFRONT` variable ayarlıysa gönderiliyor.
- [x] Ürün açma: `POST /product/sellers/{id}/products` → `POST /product/sellers/{id}/v2/products`. `listPrice`, `description`, `images`, `attributes` zorunlu. Teslimat: `deliveryOption.deliveryDuration`.
- [x] Marka: `by-name` V2'de dizi döndürüyor, tam ad eşleşmesi seçiliyor.
- [x] Stok/fiyat ucu değişmedi (`/inventory/.../price-and-inventory`, 1000'e kadar ürün), sadece `storeFrontCode` eklenecek.
- [x] Toplu sonuç kontrolü: `GET /product/sellers/{id}/products/batch-requests/{batchRequestId}` → `failureReasons` panele yaz.
- [x] Kalıcı mock test (`worker/test/run.mjs`, workflow'da her çalışmadan önce).
- [x] (K) Canlı çalışma (auto, 17.026 güncellendi, hata 0): özette `listingTotals.approved` ≈ mağazadaki ürün sayısı, `matched` ≈ 19.700, hata yok.
- [x] Canlı komisyon: `variants[].commission` öncelikli, JSON yedek (`commissionSource.urun_canli`). Belgede yüzde mi oran mı net değil: >1 ise /100.
- [x] Onay bekleyen/reddedilen ürünler (`products/unapproved`) `existing`'e dahil, güncellenmez, yeniden açılmaz.
- [ ] Bonus: `category.id` → yeni ürün kategori önerisi.

## P1 — Trendyol canlıya alma

- [x] İlk `update` yapıldı (17.026, hata 0).
- [ ] (K) Trendyol panelinden 3-5 ürünü elle doğrula; `preview.csv` artifact'ı ile fiyat artışlarını analiz et → `auto_sync` aç.
- [ ] Yeni ürün (~7.380): kategori önerisi (aynı XML kategorisindeki mevcut ürünlerin `category.id`'si + başlık benzerliği), zorunlu özellikler, 50 ürünlük deneme (K), sonra tamamı. `auto_create` kapalı kalır.
- [ ] Kapalı ~420 ürün: (K) bırak/arşivle kararı; benzer başlıklı yeni ürünleri filtrele.

## P2 — Pazaryeri bazlı veri modeli (Supabase)

Geriye uyumlu migration (`add column if not exists`, varsayılan `'trendyol'`).

- [ ] `marketplace_settings(marketplace pk, enabled, auto_sync, auto_create, existing_price_policy, commission_rate, shipping_cost, free_shipping_threshold, min_markup, target_profit_rate, vat_rate, extra jsonb)` — `settings` satırı ortak varsayılan kalır, buradaki dolu alanlar onu ezer.
- [ ] `category_map` → `marketplace` kolonu, PK `(marketplace, xml_category)`. `attributes jsonb` = o kategorinin zorunlu özellikleri için sabit değerler.
- [ ] `product_overrides` → `marketplace` kolonu (fiyat/gizleme pazaryerine göre).
- [ ] `category_attributes_cache(marketplace, category_id, attributes jsonb, fetched_at)` — pazaryerinden çekilen zorunlu özellik şeması.
- [ ] `product_drafts(marketplace, xml_barcode, status, missing jsonb, payload jsonb, error)` — açılmayı bekleyen ürünler ve eksik alanları.
- [ ] `sync_runs.marketplace` kolonu.
- [ ] Worker: ayarları pazaryerine göre birleştir, `category_map`/`overrides` filtrele.

## P3 — Panel: pazaryeri sekmeleri (Vercel) — iskelet bitti (16.10): üst sekmeler, Trendyol alt sekmeleri, yakında sekmeleri, sistem durumu

Üst seviye sekmeler: **Trendyol · Hepsiburada · N11 · Amazon TR** (+ ortak "Genel": kur, XML, fiyat formülü varsayılanları). Her pazaryeri sekmesinde:

- [ ] Özet: çalıştır düğmeleri (preview/update/create), son çalışmalar, toplu sonuç hataları.
- [ ] Ayarlar: komisyon, kargo kuralı, fiyat politikası, auto_sync/auto_create.
- [ ] Kategori eşleme: XML kategorisi → pazaryeri kategorisi (ağaçtan arama). Seçilince o kategorinin **zorunlu özellikleri** pazaryeri API'sinden çekilir, form olarak gösterilir (liste değerli olanlar açılır menü, serbest olanlar metin). Kaydedilen değerler o kategorideki tüm ürünlere uygulanır.
- [ ] Yeni ürün kuyruğu: `product_drafts` tablosu, eksik zorunlu alanı olan ürünler kırmızı, satır içi düzenleme, seçilenleri aç.
- [ ] Ürün istisnaları (pazaryerine göre).
- [ ] API rotaları: `/api/[mp]/categories`, `/api/[mp]/category-attributes?id=` (pazaryeri API'sine sunucu tarafından vekil). Bunun için pazaryeri kimlik bilgileri **Vercel env**'e de girilecek (K).
- [ ] `app/page.tsx` tek dosya → sekme başına bileşenlere bölünür.

## P4 — Yeni pazaryeri adaptörleri

Her biri: hesap/API anahtarı (K) → adaptör (`worker/marketplaces/<ad>.ts`) → preview → stok/fiyat → yeni ürün. Önce mevcut ilanları eşleştirme, sonra açma.

- [ ] **Hepsiburada** (öneri: ilk)
- [ ] **N11**
- [ ] **Amazon TR** (en zor, GTIN engeli, aşağıya bak)
- [ ] Workflow: pazaryeri başına job/matris, ayrı secret seti, ayrı cron.

## Pazaryeri zorunlu alanları (araştırma, 16.10.2026)

Kategoriye bağlı zorunlu özellikler her pazaryerinde kategori-özellik servisinden **dinamik** çekilmeli. Sabit liste yazılmaz.

### Trendyol (V2)
- Ürün: `barcode` (≤40, sadece `. - _`), `title` (≤100), `productMainId` (≤40, varyant grubu), `brandId`, `categoryId`, `quantity`, `description` (HTML ≤30.000), `listPrice` ≥ `salePrice`, `salePrice`, `vatRate` (0/1/10/20), `images` (≤8, HTTPS, 1200x1800), `attributes`.
- Opsiyonel: `stockCode`, `dimensionalWeight` (desi), `origin`, `deliveryOption.deliveryDuration`, `shipmentAddressId`, `returningAddressId`.
- Özellikler: `GET /product/categories/{id}/attributes` → `required`, `allowCustom`, `slicer`/`varianter`. Değer: `attributeValueId` veya `customAttributeValue`. Onaydan sonra renk ve slicer/varianter değişmez.
- Ürün açıldıktan sonra **onay** sürecine girer, durumu `products/unapproved` ile izlenir.

### Hepsiburada (MPOP)
- Kimlik: Basic (API key:secret), `User-Agent: <merchantId> - <AppName>`.
- Ürün: `POST mpop.hepsiburada.com/product/api/products/import` (≤100/istek, `trackingId` döner, `GET .../import/{trackingId}` ile izlenir).
- Alanlar: `merchantSku`, `categoryId`, `productName` (UrunAdi), `brand` (Marka), `varyantGroupID`, `Barcode`, `price`, `availableStock`, `tax_vat_rate`, `kg`/desi, `Image1..5`, `GarantiSuresi`, `UrunAciklamasi` + kategori özellikleri. Ad, açıklama, resim, KDV, marka pratikte zorunlu.
- Kategori özellikleri: `GET /product/api/categories/{id}/attributes` (mandatory/opsiyonel).
- Stok/fiyat: `listing-external.hepsiburada.com` `/listings/merchantid/{id}/...` ve toplu `/listings/import`.
- Sık bloklayanlar: marka, renk, beden, kapasite, garanti süresi (elektronik), menşei (kozmetik/gıda).
- Doğrulanacak (K: hesap + resmi dokümana erişim): alanların kesin adları, barkod (GTIN) zorunluluğu, marka "Eco Lounge" kabulü.

### N11 (REST)
- Kimlik: başlıkta `appKey` + `appSecret`.
- Ürün: `POST api.n11.com/ms/product/tasks/product-create` (asenkron görev, sonuç görev sorgusuyla).
- Alanlar: `title` (**15–65 karakter**), `description`, `categoryId`, `productMainId` (varyantlar ortak), `stockCode`, `price`/`salePrice`, `currencyType`, `vatRate` (0/1/10/20), `quantity`, `images`, `shipmentTemplate` (teslimat şablonu, panelde tanımlı ad), `preparingDay`, `attributes` (marka dahil, üst seviyede).
- Kategori özellikleri: `mandatory=true` olanlar zorunlu, `customValue=false` ise `valueId` ile seçilir. `slicer=true` kategorilerde `mainId` zorunlu.
- Dikkat: 65 karakter sınırı Trendyol başlıklarının çoğunu keser, başlık kısaltma kuralı gerekir.
- Doğrulanacak (K: n11 mağaza API anahtarı): uç yolları ve alan adları.

### Amazon TR (SP-API)
- Kimlik: LWA OAuth (client id/secret + refresh token), geliştirici kaydı, marketplace `A33AVAJ2PDY3EV`.
- Ürün: `PUT /listings/2021-08-01/items/{sellerId}/{sku}` → `productType` + `attributes`. Zorunlu alanlar `GET /definitions/2020-09-01/productTypes/{type}?marketplaceIds=A33AVAJ2PDY3EV` JSON şemasından çekilir.
- Tipik zorunlular: `item_name`, `brand`, `externally_assigned_product_identifier` (EAN/GTIN) veya GTIN muafiyeti, `condition_type`, `purchasable_offer` (fiyat), `fulfillment_availability` (stok), `bullet_point`, `product_description`, `main_product_image_locator`, `country_of_origin`, kategoriye göre ek alanlar.
- **Engel:** XML barkodları (`BX5XM...`) gerçek GTIN değil. Amazon'da yeni ürün açmak için GTIN muafiyeti veya marka tescili (Brand Registry) gerekir (K). Mevcut ASIN'lere teklif (offer-only, `PRODUCT` tipi) daha kolay ama eşleşme gerekir.
- Öncelik: en son.

## Kaynaklar
- Trendyol V2 uç listesi: https://developers.trendyol.com/v3.0/docs/product-v2-api-endpoint.md
- Trendyol ürün açma V2: https://developers.trendyol.com/v3.0/docs/product-create-v2.md
- Trendyol onaylı ürün listeleme V2: https://developers.trendyol.com/v3.0/docs/product-filter-approved-product-v2.md
- Hepsiburada (ikincil kaynak): https://www.zunapro.com/turkey/en/blog/hepsiburada-integration-api-guide-seller-manual
- N11 API hata mesajları: https://magazadestek.n11.com/satis-surecleri/api-hata-mesajlari-ve-aciklamalari-10433
- Amazon Listings Items API: https://developer-docs.amazon.com/sp-api/docs/listings-items-api
