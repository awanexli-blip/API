# Ana plan (yol haritası)

Durum: `[ ]` bekliyor · `[~]` devam · `[x]` bitti · `(K)` kullanıcı işi/onayı gerekir.
Kural: her oturumda önce `docs/PROGRESS.md`, sonra bu dosya okunur; iş bittikçe burada işaretlenir, ayrıntı PROGRESS'e yazılır.
Son güncelleme: 28.10.2026.

## Şu an

> **28.10 (PROGRESS 41):** 1000 satır sınırı (kopyaların 3.538'i satışta kalmıştı), HB kalıcı kapanma, Gemini 404, Trendyol yeniden deneme, yedek, eski veritabanı kurtarma aracı yazıldı.
> **28.10 (PROGRESS 45):** VPS kuruldu, senkron tetikleyici sunucudan. Taşıma kiti `ops/vps/db/` (`docs/VPS_TASIMA.md`), 7 gün deneme.
> **Bekleyen (K):** [ ] migration 071 (`suppliers.runner`) · [ ] Trendyol kargo firmaları (panel: Aras+Sürat+Kolay Gelsin, zamanında kapalı) · [ ] yedek secret'ları `SUPABASE_DB_URL2` + `BACKUP_PASSPHRASE` · [ ] Supabase Auth: kayıt kapalı, sızdırılmış parola koruması açık · [x] migration 068, 069, 070 · [ ] migration 068 (`supabase/migrations/068_listing_content_sent.sql`, SQL Editor) · [ ] sunucu `/etc/trentakip/env` içine `SUPABASE_DB_URL` (taşıma kopyası) · [ ] 2 CPU / 4 GB yükseltmesinin yansıması · [x] migration 067 (açıklamalar) · [x] `ops/fix-toptancim-mapping.sql` · [x] VPS IP + GitHub token · [ ] yeni tedarikçilerin API dokümanları (`docs/TEDARIKCI_API.md`) · [x] migration 066'yı SQL Editor'de çalıştır → sonra kod gönderilir · [ ] `SUPABASE_DB_URL2` + `BACKUP_PASSPHRASE` secret → Actions → Veritabanı yedeği (daily, sonra full) · [ ] eski veritabanı açılınca "Eski veritabanından kurtarma" check → apply · [ ] S0.4 Auth ayarları (K: şimdilik bekliyor) · [ ] S0.5 depo açık/özel kararı.
> **Sıradaki (Claude):** gönderim sonrası ilk senkronda `duplicateClosed` (TY ~4.576), HB kapalı sayısı, `pushErrors`, Gemini taslakları; S3.1 ikinci tur denetim; VPS gelince taşıma.
> Eski kutu (23.10):

> **Önce: güvenlik ve hata düzeltmeleri** (`docs/DENETIM_GOREVLERI.md`). 22.10: S0 (S0.4/S0.5 K hariç) ve S1 tamam, S2 büyük ölçüde tamam. **Sıradaki:** K kararları (S0.4 Auth ayarları, S0.5 depo özel mi); Claude: S3.1 ikinci tur, sonra Faz 6 F0.
> **Sonra aktif aşama: F (Faz 6 — operasyon merkezi).** Plan: `docs/FAZ6_PLAN.md`. Çalışma kuralları: `docs/CALISMA_KURALLARI.md`.
> **F (23.10):** siparişler + elle tedarikçi siparişi + Telegram canlı. Yeni: **Satış raporu** (F9), iadeler (F8), gerçek komisyon, HB siparişleri (F11, doğrulanıyor), takip kodu bildirme (F5), stok rezervasyonu (F6). Sıradaki: HB sipariş uçlarının canlı teşhisi, Trendyol v2 sipariş alanları doğrulama, 2 hafta veriyle kâr kalibrasyonu.
> HB (22.10): kargo baremi ve gönderim hazırlığı tamam (PROGRESS 23). Sıradaki: K `hb-tool categories`/`listings` (canlı katalog yetkisi), sonra 20 ürünle deneme (K onayı).
> Not: Trendyol satışı açık. Siparişler panelde görünür (Siparişler); tedarikçiye iletme henüz elle.
> Bu kutuyu her dilim bitince güncelle (aşama + sıradaki madde).

## Çizelge

| Sıra | Aşama | İçerik | Tahmini süre | Durum |
|---|---|---|---|---|
| 0 | Temel | Trendyol V2 senkronu, panel v1, Faz 1 (ürün DB), Faz 2 (CSV/XML içe aktarma, feed), tedarikçiler, markalar, akıllı kâr | — | [x] |
| A | **Panel v2** | Yeniden tasarım: gece/gündüz, telefon uyumlu, yeni menü, gösterge paneli, ürünler v2 | 2-3 oturum | [x] 17.10 |
| B | **Uçtan uca denetim** | Her ekran ve düğme, her API, güvenlik, performans, güncel sürümler; hata raporu ve düzeltmeler | 1 oturum | [x] 17.10 (canlı akışlar (K) bekliyor) |
| C | Faz 3 | İş kuyruğu + pazaryeri ilan tablosu (`marketplace_listings`), adaptörler DB'den beslenir | 1-2 oturum | [x] 17.10 |
| D | Faz 4 | Trendyol tüm tedarikçilerin ürünlerini DB'den alır; ürün formunda "Pazaryerine gönder" | 2 oturum | [x] 17.10 (canlı ilk gönderim (K)) |
| E ← sıradaki | Faz 5 | Hepsiburada canlı (HB testi sonrası), N11, ÇiçekSepeti, Amazon TR | pazaryeri başına 1-2 oturum | [ ] |
| F ← aktif | Faz 6 | Siparişler, tedarikçiye iletme, takip, müşteri soruları (yapay zeka taslağı), iade, stok rezervasyonu, bildirimler, gerçek kâr raporları (ayrıntı: `FAZ6_PLAN.md`) | 8-12 oturum | [ ] |

## Bitenler (özet; ayrıntı PROGRESS.md)

- [x] Trendyol Product V2 geçişi, 15 dk otomatik senkron, canlı komisyon, KDV'li fiyat formülü, fiyat politikaları (floor/smart/...)
- [x] Panel v1: pazaryeri sekmeleri, Özet, Fiyat ayarları, Kategoriler (öneri + toplu onay), Ürün istisnaları, sistem durumu
- [x] Yeni ürün açma (Trendyol): kategori tahmini, zorunlu özellik doldurma, ret takibi (49 ürün denendi)
- [x] Hepsiburada adaptörü + test aracı (SIT), komisyon/kargo tarifesi
- [x] Faz 1: ürün DB (transaction + denetim), roller, CRUD, zod/GTIN, ürün formu (otomatik SKU/barkod, görsel yükleme, pazaryeri hazırlık listesi)
- [x] Faz 2: CSV/Excel içe aktarma (satır bazlı hata), tedarikçi XML içe aktarma, XML feed, içe aktarma geçmişi
- [x] Çoklu tedarikçi: XML inceleme, alan eşleme, önizleme, gece içe aktarma
- [x] Markalar: yeni ürün markası + geri al, marka dağılımı, Trendyol marka listesi ve formda marka arama
- [x] Akıllı kâr: kural motoru (maliyet/tedarikçi/kategori/marka/stok → hedef kâr, en az net kâr TL), simülasyon

## A — Panel v2 (yeniden tasarım)

- [x] A1 Tasarım sistemi: renk değişkenleri (gece/gündüz otomatik + elle seçim, kalıcı), tipografi, aralıklar; ortak bileşenler: düğme, kart, rozet, sekme, tablo (telefonda kart listesine dönüşür), çekmece/modal, bildirim (toast), boş durum, yükleniyor iskeleti, ikonlar (satır içi SVG, ek paket yok)
- [x] A2 Yeni yerleşim: masaüstünde sol menü, telefonda alt menü + açılır menü. Bölümler: Gösterge paneli · Ürünler · Tedarikçiler · Pazaryerleri (Trendyol, Hepsiburada, ...: Özet, Fiyat, Akıllı kâr, Markalar, Kategoriler, İstisnalar) · İçe/Dışa aktarma · Ayarlar
- [x] A3 Adres çubuğu ile gezinme (yenileyince aynı ekran, geri tuşu çalışır, bağlantı paylaşılabilir)
- [x] A4 Gösterge paneli: ürün/stok/tedarikçi/ilan sayıları, son senkron ve içe aktarma durumu, uyarılar (token, reddedilen ürün, marka sorunu, XML hatası), hızlı işlemler
- [x] A5 Ürünler v2: filtreler (tedarikçi, kategori, stok, durum, maliyet), toplu işlemler (arşivle, durum, marka), ürün detayında pazaryeri fiyat önizlemesi (akıllı kâr ile)
- [x] A6 Ayarlar: kullanıcılar ve roller ekranı, genel ayarlar (kur, varsayılanlar), sistem durumu
- [x] A7 Telefon (390 px) ve masaüstü, gece/gündüz: otomatik tarayıcı testi (Playwright, sahte API), konsol hatası ve yatay taşma yok. [ ] Gerçek telefonda kullanıcı denemesi (K)

## B — Uçtan uca denetim

- [x] B1 Ekran ekran her düğme: beklenen istek gidiyor mu, hata ve boş durum mesajı anlaşılır mı
- [x] B2 Her API: yetki (viewer/editor/admin), doğrulama, hata kodları
- [~] B3 Canlı akışlar (senkron canlıda hatasız; XML içe aktarma, marka listesi, feed ilk çalıştırma (K) bekliyor): önizleme, güncelleme, ürün açma, XML içe aktarma, marka listesi, feed, görsel yükleme
- [x] B4 Güvenlik: RLS, service_role yalnızca sunucuda, SSRF korumaları, feed token, Supabase advisors
- [x] B5 Performans (yinelenen indeks `products_status_updated_idx` silinmesi onay bekliyor (K)): indeksler (products.source/status/updated_at, import_rows), büyük listeler, Supabase performance advisors
- [x] B6 Denetim raporu (PROGRESS 17.10 (8))
- [x] B7 Güncel sürümler: Next 16.4, React 19.3, zod 4, fast-xml-parser 5, supabase-js 2.118, TypeScript 7, Actions v7, Node 24 (bulunanlar, düzeltilenler, kalanlar)

## C — Faz 3: iş kuyruğu ve ilan tablosu

- [x] `jobs` (idempotent anahtar, kilit `job_claim` SKIP LOCKED, artan beklemeli yeniden deneme `job_finish`, 30 dk kilit kurtarma), `worker/jobs.ts` (sync.yml'de Trendyol senkronundan sonra), panelde Ayarlar → İş kuyruğu (yeniden dene/iptal). [ ] Pazaryeri hız sınırı Faz 4 gönderim işlerinde
- [x] `marketplace_listings`: her senkronda pazaryerinden okunan durum (live/pending_approval/closed/gone), fiyat, stok, komisyon, kategori; `listings_link` BayilikXML varyantlarına bağlar (ÖS13-/OS13- + SKU). Ürün detayında "Pazaryerlerinde", gösterge panelinde sayılar
- [ ] Adaptör arayüzü DB'den beslenir (`worker/marketplaces/*`) → Faz 4 ile birlikte

## D — Faz 4: Trendyol veritabanından

- [x] Veritabanından gönderilen ilanlar (tüm tedarikçiler) her senkronda stok/fiyatını `products`tan alır (`worker/core/db-products.ts` `dbInventory`); XML'den kalkmış sayılıp sıfırlanmaz. BayilikXML ilanları XML akışında kalır (ÖS13-/OS13-)
- [x] Kategori: Kategoriler sekmesi eşleşmesi > yüksek güvenli tahmin; zorunlu özellikler adaptörde (benzer ilan / nötr değer). [ ] Ürün başına kategori seçimi (formda)
- [x] "Trendyol'a gönder" (ürün detayı + toplu), `/api/listings/send` → `jobs` `send_products:trendyol` → senkronda `processSendJobs` (marka Trendyol'da varsa ürün markası, yoksa varsayılan; aynı başlık koruması; akıllı kâr fiyatı). İlan durumu: sırada → gönderildi → onay bekliyor/yayında/reddedildi (+ neden). Yönetici "hemen" seçerse senkron başlatılır

## E — Faz 5: diğer pazaryerleri

- [ ] (K) Hepsiburada test görüşmesi → canlı (HB_ENV=prod), `docs/HEPSIBURADA_TEST.md`
- [ ] N11, ÇiçekSepeti (hesap + API anahtarı (K))
- [x] Amazon TR adaptörü (SP-API, 17.10): giriş, ilan raporu, stok/fiyat feed'i, var olan ASIN'e teklif, ASIN eşleştirme ekranı, test aracı; sahte servis testleri 12/12. [x] SP-API kaydı + Secrets, `ping` canlıda başarılı (18.10). [x] Toplu eşleştirme ekranı. [ ] (K) Panelde Amazon'u aç → aday bul → onayla → gönder. [ ] Product Fees API ile gerçek komisyon. [ ] (K) GTIN muafiyeti / Marka Kaydı → yeni ürün açma (ürün tipi şeması). [ ] Varyant gruplama (parent/child)

## F — Faz 6: operasyon (ayrıntı, kabul ölçütleri ve veri modeli: `docs/FAZ6_PLAN.md`)

- [ ] F0 Önkoşullar: Trendyol sipariş yetkisi/test siparişi (K), tedarikçi sipariş yöntemleri `docs/TEDARIKCILER.md` (K), Trendyol servis doğrulamaları (D), KVKK kararı (K)
- [~] F1 Veri modeli: orders/order_lines/order_events + order_upsert tamam (migration 037, DB testi); `supplier_orders`/`suppliers` genişletme F4 ile
- [~] F2 Trendyol sipariş çekme: fetchOrders + order-status + test tamam, canlıda 33 sipariş (23.10); webhook ucu kaldı
- [~] F3 Siparişler ekranı: liste, filtre, detay, zaman çizelgesi, kâr özeti, dikkat tamam; tarayıcı tıklama denemesi kaldı
- [ ] F4 Tedarikçi sipariş motoru: manual (tek tık) → email → semi (hazırla + onay) → api; ön kontroller; idempotent; tam otomatik en son ve varsayılan kapalı
- [~] F5 Takip kodu ve kargo: tedarikçi takip no ayrı kolonda, pazaryeri kargo kodu tedarikçi metninde, Trendyol'a bildirme kuyruğu (onaylı, pending->sending->done/failed), kargo süresi geçince dikkat (23.10); canlı bildirim denemesi (K) kaldı
- [~] F6 Stok rezervasyonu: tedarikçiye verilmemiş açık siparişlerin adedi (48 saat) tüm pazaryerlerinde stoktan düşülür (order_reservations, 23.10); canlıda gözlem kaldı
- [~] F7 Müşteri soruları: gelen kutusu + Claude taslağı + insan onayı (panel/Telegram) kodu tamam; K: ANTHROPIC_API_KEY; QnA uçları canlıda doğrulanmadı; yorum servisi (D)
- [~] F8 İadeler: Trendyol claims çekme + neden + siparişe bağlama, iade kaybı (gidiş-dönüş kargo) kâra yansır (migration 042, 23.10); HB claims ucu doğrulanmadı; tedarikçi alacağı ve return_rate kalibrasyonu kaldı
- [~] F9 Satış raporu (23.10): dönem seçimi (bugün/dün/7/30/bu ay/geçen ay/3 ay/1 yıl/özel), önceki dönemle karşılaştırma, kâr dökümü (gelir, komisyon, kargo, sabit gider, maliyet, KDV, iade, stopaj), grafik + tablo, pazaryeri/ürün/iade nedeni/zarar eden sipariş, CSV; gerçek komisyon (Trendyol hakediş) tahminin yerine geçer. Kalan: 2 hafta veriyle doğrulama
- [~] F10 Bildirimler: Telegram (yeni sipariş, soru + onay düğmesi) kodu tamam, K: bot + TELEGRAM_* secret'ları; hata merkezi kaldı
- [~] F11 Diğer pazaryerlerinin siparişleri: Hepsiburada OMS kodu (uçlar açık kaynaktan, her biri ayrı denenir ve teşhis yazılır, 23.10) — canlı doğrulama kaldı; Amazon TR, N11, ÇiçekSepeti bekliyor
- [ ] F12 Sertleştirme: uçtan uca test, mobil denetim, güvenlik, runbook, güncel sürüm denetimi

## Öneriler (henüz plana alınmadı, karar (K))

- Tedarikçi karşılaştırma: aynı barkodlu ürün birden çok tedarikçide → stoklu ve en ucuz olandan sat (otomatik tedarikçi seçimi)
- Rakip fiyat takibi (Trendyol buybox) → akıllı kâra "rakibin X TL altı, ama en az net kâr Y" kuralı
- İçerik koruması: yasaklı kelime / tescilli marka filtresi (marka ihlali ve orijinallik uyarılarını azaltır)
- Denetim kaydından geri yükleme (yanlış toplu değişikliği geri al)
- GitHub Actions dakika kotası: 15 dk senkron + içe aktarma, repo herkese açık değilse aylık 2.000 dk yetmez

## Bekleyen kullanıcı işleri (K)

- [ ] Vercel `GH_TOKEN`: Actions Read and write (önizleme çalıştığına göre tamam görünüyor)
- [ ] Actions → "Marka listesi" ilk çalıştırma
- [ ] Tedarikçiler → BayilikXML → İçe aktar (ürün veritabanı şu an boş)
- [ ] Supabase > Auth > leaked password protection
- [ ] Trendyol: yeni açılan 49 ürünün onay sonucu, kapalı ~420 ürün kararı

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
