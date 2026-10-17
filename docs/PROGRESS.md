# Gelişme günlüğü

En yeni üstte. Her oturum sonunda: ne yapıldı, ne doğrulandı, ne açık kaldı, sıradaki adım.

## 2026-10-17 (5) — Markalar, Faz 2
- Özet: iş başlatılınca liste 4 dk boyunca 8 sn'de bir yenilenir (önizleme çalışmıştı ama liste tek seferlik 15 sn yenilemeyle kaçırıyordu).
- Trendyol dokümanı: onaylı üründe `brandId` değiştirilemez (content-bulk-update). Mevcut ürünlerin markası değişmez.
- Markalar sekmesi: yeni ürün markası `marketplace_settings.brand_name` + `brand_history` (geri al / varsayılana dön; migration 006), worker `ctx.brandName` kullanır; mağazadaki marka dağılımı (özet `brands`, kapatılan sayısı); marka kaynaklı atlama/ret uyarıları.
- Marka arama: `marketplace_brands` (migration 007, pg_trgm `extensions` şemasında), `worker/brands.ts` + `brands.yml` (haftalık, elle). Ürün formunda yazdıkça öneri ve "Trendyol'da var/yok". **İlk doldurma için Actions → "Marka listesi" elle çalıştırılmalı** (K).
- Kategori toplu onayda boş XML kategorisi satırı atlanır.
- **Faz 2** (docs/ARCHITECTURE.md): CSV/Excel içe aktarma (kontrol et → içe aktar, satır bazlı hata, kısmi güncelleme, şablon), BayilikXML → ürünler (`worker/import-xml.ts`, `import.yml` elle; gece çalışması kapalı), XML feed (`/api/feed/<token>`), içe aktarma geçmişi. Migration 008 uygulandı. Testler 15/15 + worker; DB fonksiyon testi 8/8 (geri alındı). `xlsx` SheetJS resmi paketi (npm sürümünde bilinen açık var).
- Sırada (K onayı): ilk XML içe aktarmayı panelden çalıştır, sonucu kontrol et, sonra gece çalışmasını aç. Faz 3: iş kuyruğu + adaptörlerin veritabanından beslenmesi.

## 2026-10-17 (4) — Panel düzeltmeleri
- Ayarlar: kaydet düğmesi hep kapalıydı (boolean alanlar `Number.isFinite` kontrolüne giriyordu). Düzeltildi, hatalı alan adı gösterilir.
- Önizleme düğmesi GitHub 403: `GH_TOKEN`'da "Actions: Read and write" yok (kullanıcı "Workflows" seçmişti). Hata mesajı açıklayıcı yapıldı; kullanıcı yeni token girecek.
- Kategoriler sekmesi yeniden: açıklama, özet sayılar, güçlü (≥%60) önerileri tek tıkla/toplu onay, aranabilir liste, elle ekleme ayrı. `category_map.category_name` (migration 004, uygulandı); worker boş adları ilanlardan doldurur. API `PUT` toplu `{items:[...]}` kabul eder.
- Vercel deploy'ları artık READY (BLOCKED sorunu geçti).
- Kategori toplu onay hatası: XML'de kategorisi boş ürünler ("" adlı satır) tüm isteği düşürüyordu; geçersiz satırlar atlanır.
- Ürün formu (Faz 1 kolaylaştırma): otomatik SKU ve barkod (`generateEan13`: "2" ile başlayan iç EAN-13; Amazon'da geçmez), marka/kategori öneri listesi (`/api/products/options`, kategoriler `category_map`'ten → pazaryeri eşleşmesi görünür), renk×beden ile varyant üretme, görsel yükleme/sürükle/yapıştır ve linkten kendi depoya kopyalama (`/api/products/images`, Supabase Storage `product-images` herkese açık, migration 005), pazaryeri hazırlık listesi (`lib/marketplace-readiness.ts`), "Kaydet ve yeni ekle", "Kopyasını oluştur". Testler 10/10.
- **Karar (K):** marka değiştirilmeyecek (belge isteme / hata riski). Yeni ürünler Eco Lounge ile açılmaya devam.

## 2026-10-17 (3) — Merkezi ürün platformu, Faz 1

- Kullanıcı kendi ürün/XML sistemini istedi (spec: merkezi DB, CSV/XML içe-dışa aktarma, 5 pazaryeri adaptörü, fazlı). Yalnızca Faz 1 yapıldı. Mimari: `docs/ARCHITECTURE.md`.
- DB (`003_products.sql`, Supabase'e uygulandı): products, product_variants (stok, rezerve), product_images, user_roles, audit_log; `product_save`/`product_delete` tek transaction + denetim; fonksiyonlar anon/authenticated'a kapalı. SKU/barkod Türkçe harf kabul eder (mevcut ÖS13- kodları için).
- Yetki: `getActor`/`requireRole` (viewer/editor/admin, ADMIN_EMAIL=admin). Eski rotalar admin ister (davranış aynı).
- Doğrulama: zod + GTIN sağlama toplamı (`lib/validation/product.ts`), 8 birim testi; DB fonksiyon testleri 8/8 (rollback).
- API: `/api/products` (liste/oluştur), `/api/products/[id]` (oku/güncelle/arşiv/kalıcı sil SKU onaylı), `/api/me`. Panel: "Ürünler" sekmesi.
- Mevcut Trendyol/HB senkronu değişmedi. Supabase güvenlik uyarısı: Auth "leaked password protection" kapalı (K).
- **Sıradaki (onayla):** Faz 2 — CSV/Excel içe aktarma (satır hata raporu), BayilikXML -> products, XML feed dışa aktarma.

## 2026-10-17 (2) — Hepsiburada test hazırlığı

- Hepsiburada API bilgisi istendi; HB yarın arayıp test yapacak.
- `worker/hb-tool.ts` + workflow "Hepsiburada test aracı" (`hb-tool.yml`): ping, categories, suggest, attributes, send <adet> <kategoriId>, status, listings, stock, price, orders, raw. Argümanlar ortam değişkeniyle (kabuk enjeksiyonu yok). Sahte SIT ile 10 testi geçti.
- Adaptör: `hbClient()` ortak bağlantı, `hbFillAttributes` (zorunlu kategori özellikleri: başlıktaki değer / nötr değer, doldurulamazsa gönderilmez), önbellekli.
- Kontrol listesi: `docs/HEPSIBURADA_TEST.md` (secrets, test senaryoları 1/2/10 ürün, sorulacaklar, canlıya geçiş).
- Açık: sipariş entegrasyonu yok (HB testte isterse eklenecek), OMS uç adresleri tahmini.

## 2026-10-17 — Canlı teşhis (Supabase), zorunlu özellikler, 15 dk

- Supabase MCP bağlandı (proje `xovqsjiddoituaayyhae`). Migration 002 kullanıcı tarafından (öneri kolonları hariç) çalıştırılmıştı; öneri kolonları ve `create_failures` tablosu Claude tarafından eklendi.
- **Bulgu:** ayarlarda `auto_sync`, `auto_create`, `zero_missing` açıktı (politika `floor`, min stok 7). Saatlik çalışmalar "partial": her saat ~340 ürün açılmaya gönderilip ~350'si reddediliyordu (zorunlu özellik eksik: Renk, Web Color, Beden, Cinsiyet, Yaş Grubu, Menşei, Materyal, Taş Cinsi) ve aynı ürünler her saat yeniden deneniyordu. Ayrıca zero_missing kapalı ürünlere stok gönderiyordu ("Satışa kapatılan ürünlerin fiyat stoğu güncellenemez").
- **Müdahale:** `settings.auto_create=false` (Claude, Supabase). zero_missing artık yalnızca aktif ilanlara.
- **Zorunlu özellikler (trendyol.ts fillAttributes):** kategori özellikleri (`/product/categories/{id}/attributes`) + değerler (`.../values`) önbellekli; doldurma sırası: panel değeri > renk ise başlıktaki renk / "Çok Renkli" > aynı kategorideki benzer onaylı ilanın değeri > nötr değer (Tek Ebat, Standart, Unisex, Yetişkin...). Doldurulamazsa ürün gönderilmez (`zorunlu özellik doldurulamadı: X`).
- **Tekrar engeli:** `create_failures` tablosu; reddedilen ürün 24 saat tekrar gönderilmez (`createRejected`).
- Cron 15 dakika (:07/:22/:37/:52 UTC). Zamanlı ürün açma en fazla 100/çalışma. Repo herkese açık kalıyor (kullanıcı kararı, Actions dakikası sınırsız).
- İlk deneme (run 59, create limit 50): 49 gönderildi, batch doğrulamasında hata 0, ret 0; 1 ürün atlandı (süpürge: Vakum Emiş Gücü/Şarj Süresi/Güç zorunlu, doldurulamaz). Model kodu = stok kodu = barkod (tasarım gereği, her XML ürünü ayrı ürün).
- Onay takibi eklendi: `newProductApproval` (OS13- ürünlerin onaylı/bekleyen/reddedilen sayısı + ret nedenleri), panelde son çalıştırmalarda.
- **Sıradaki:** Trendyol onay sonucu (birkaç saat) -> ret yoksa `auto_create` aç (kullanıcı onayıyla, Supabase).

## 2026-10-16 (9) — Kategori tahmini, saatlik senkron

- Trendyol komisyon rehberi (kaynaklar/trendyol): oranlar KDV dahil, komisyon tutarına %20 KDV faturalanır. Formül doğru (commission_plus_vat=false).
- Kategori tahmini (`worker/core/classify.ts`): 18.027 ürünlük dışa aktarımda başlık+XML kategorisi -> Trendyol kategorisi, kNN (5 komşu, kelime ilk 5 harf, TF-IDF). İsabet: tümü %80, yüksek güven (%58) %95. Komisyon: komşuların max'ı, %93 gerçeğe eşit/üstü.
- 7.469 yeni üründe: yüksek 2.514, orta 1.829, düşük 3.126 (kaynaklar/analiz/yeni_urun_kategori_tahmini.csv). Mevcut ilanların bir kısmı yanlış kategoride (örn. kirli sepeti -> halı yıkama makinesi), orta/düşük güven elle onaylanmalı.
- Worker: yeni ürün komisyonu tahminden (orta+), kategori: panel eşleşmesi > yüksek güvenli tahmin. Eşleşmeyen XML kategorilerine öneri (en çok oy alan Trendyol kategorisi, oran, komisyon) -> panelde "Öneriyi kullan". Migration 002'ye öneri kolonları eklendi.
- `create` sınırı: workflow girdisi `limit` (varsayılan 50).
- Cron: her saat :07 (UTC). Repo özel yapılırsa Actions dakika kotası: saatlik ~5 dk x 24 x 30 = 3.600 dk/ay > 2.000 ücretsiz; o durumda 2 saate çıkar.
- Akıllı fiyat her çalışmada en fazla %10 düşürür; saatlik çalışmada yakınsama birkaç saatte olur.

## 2026-10-16 (8) — Hepsiburada hazırlığı

- Kullanıcı PDF'leri (git dışı `kaynaklar/`): HB komisyon (EK.4, +KDV, %6–25, medyan %15) -> `worker/data/hepsiburada/commissions.json` (156 satır); HB kargo tarifesi 05.10.2026 (desi x 11 firma, KDV hariç) -> `cargo.json` (0–60 desi); platform kılavuzu: stoksuzluk iptali cezası 10–2.000 TL, gecikme cezası, buybox kriterleri.
- `pricing.ts`: `commissionPlusVat`, `shippingVatIncluded` (HB: komisyon +KDV, kargo KDV hariç). Trendyol için `settings.commission_plus_vat` varsayılan false (K: komisyon faturasından doğrula; +KDV ise fiyatlar ~%4-5 artar).
- Migration `supabase/migrations/002_marketplaces.sql`: `marketplace_settings` (HB satırı: desi kargo, hepsiJET, eşik 0 = her siparişte kargo satıcıda, min stok 5), `marketplace` kolonları + PK. **(K) Supabase SQL Editor'de çalıştırılacak.** Çalıştırılmadan Trendyol eskisi gibi çalışır (test).
- `worker/marketplaces/hepsiburada.ts`: listing (offset/limit), stock-uploads + price-uploads (trackingId), products/import (multipart), status sorgusu, desi kargo. Varsayılan SIT, `HB_ENV=prod` canlı. Mock testleri.
- Workflow: zamanlı çalışma matris (trendyol, hepsiburada); HB secret yok/migration yok/kapalı -> atlanır.
- Panel: Hepsiburada sekmesi canlı (Özet/Fiyat ayarları/Kategoriler/İstisnalar, `?mp=`), ayarlarda kargo hesabı, firma, desi, KDV seçenekleri; simülasyon desiye göre.
- Repo herkese açık (GitHub API anonim 200). Sözleşme/ürün dosyaları commit edilmiyor.
- Supabase MCP bu oturumda görünmüyor (yeniden başlatma gerekebilir).

## 2026-10-16 (7) — KDV, Hepsiburada entegratör modeli

- Kullanıcı: XML fiyatı KDV dahil, aylık faturalı alım, KDV mükellefi, Trendyol sipariş başı hizmet bedeli yok.
- `pricing.ts`: net kâr KDV sonrası (alış/komisyon/kargo KDV'si indirilir), oran KDV hariç satışa göre, ürün KDV'si ilandan (`variants[].vatRate`) > kategori > ayar. %20 KDV'de fiyatlar aynı (test), %10/%1'de daha düşük. Simülasyon kalem kalem. Özet: `vatRates`.
- Hepsiburada satıcı panelinde "Entegratör bilgileri": Mağaza ID (merchantId, GUID) + "Entegratörlerim" (entegratör kullanıcı adı ekleme). Yani API erişimi entegratör hesabıyla: kendi entegratör hesabımızı açıp kullanıcı adını buraya eklemek gerekiyor (doğrulanacak).

## 2026-10-16 (6) — Vercel teşhisi, Hepsiburada planı

- Vercel projesi: `trentakip` (ekip `xml4`, hesap awanexli-5202). Bağlayıcı proje/env/deployment okuyabiliyor, runtime log 403 (ekip kapsamı yetkisi yok).
- **Kök neden:** Vercel'de `ADMIN_EMAIL`, `GH_TOKEN`, `GH_REPO` yoktu → tüm panel API'leri 401 → ayarlar yüklenmiyor → "Aç" pasif. `GH_REPO=awanexli-blip/API` Claude tarafından eklendi. `ADMIN_EMAIL` ve `GH_TOKEN` (K) eklenecek, sonra redeploy. 401 mesajı artık eksik değişkeni söylüyor.
- Hepsiburada sıradaki pazaryeri. Plan: TODO P3.5. Resmi doküman captcha arkasında.

## 2026-10-16 (5) — Akıllı fiyat, panel yeniden yapı

- Fiyat politikası `smart` (önerilen): formül altındakini yükselt, üstündekini her çalışmada en fazla %10 düşür, 300 TL eşiğinde 299,90'a in. Gerçek veride: 2.629 ürün (300,50–413 TL) 299,90'a inince hem ucuzluyor hem satış başına medyan +37 TL kâr. Tam yakınsamada 15.444 ürün ucuzlar (medyan -%7). Fonksiyon: `worker/pricing.ts existingPrice()`, birim testi `worker/test/pricing.test.ts`.
- CSV kâr sütunları artık gönderilen fiyata göre, durum sütununda `eski X` var. Özet: `priceMoves`.
- Panel: üstte pazaryeri sekmeleri (Trendyol + yakında: Hepsiburada/N11/Amazon TR, gerekenler ve zorunlu alanlar), Trendyol altında Özet/Fiyat ayarları/Kategoriler/İstisnalar. Bileşenler `app/_components/`. İstekler 25 sn zaman aşımı. `/api/health` sistem durumu (env var/yok, Supabase, GitHub). Ayarlar okunamazsa hata kutusu + sistem durumu otomatik. Kur/çarpan/KDV "Gelişmiş" altında, `update_prices` kutusu kaldırıldı (politika ile aynı iş).
- Otomatik senkron düğmesi pasif: ayarlar yüklenemiyor (muhtemelen istek askıda). Yeni panel nedeni ekranda gösterecek.
- (K) Vercel bağlayıcısı awanexli hesabına çevrilirse loglar okunabilir.

## 2026-10-16 (4) — Panel düzeltmesi, fiyat artış analizi

- Panel: `notify` her render'da yeni → alt sekmelerde `load()` hata verince sonsuz döngü (düğme pasif, sayfa sürekli üste kayıyor). `useCallback` ile düzeltildi. Otomatik senkron düğmesi onay + başarı/hata mesajı veriyor. Ayarlar ve geçmiş ayrı yükleniyor. 1 saatten eski `running` kaydı yenileme döngüsüne sokmuyor. `next build` temiz.
- Bağlı Vercel hesabı (ewanmirza) bu paneli içermiyor; panel başka hesapta (awanexli-blip?). Vercel loglarına erişim yok.
- Fiyat artışı (14.10 "Stok & Fiyat" ile karşılaştırma): 627 ürün arttı, medyan +27 TL (+%4,7), toplam +57.515 TL. %20-50 arası 16 ürün, %50 üstü yok. En büyük: 7 adet Eco Lounge havlu 1.720→2.310 (+%34, eski fiyatta zarardaydı). Artanların 7'si eski fiyatta zarar, 77'si %10 altı kârdaydı. Liste: `fiyat_artislari.csv` (yerel, git dışı).

## 2026-10-16 (3) — İlk canlı V2 çalışması

**Olan:** Kullanıcı Actions'ı elle `auto` ile tetikledi (preview yerine). Elle tetiklemede `auto_sync` kontrolü yok → **gerçek update** yapıldı.
- XML 25.334 · Trendyol 20.644 (onaylı içerik 17.892 / varyant 18.027, onaysız 2.617) · eşleşen 20.104.
- Gönderilen 17.026, `failedBatches` 0, `batchCheck` 35/35 kontrol, ürün hatası 0. Politika `floor` (fiyat düşmedi).
- Komisyon: canlı 17.627 · panel 2.808 · varsayılan 4.661.
- Atlanan: onay bekleyen/reddedilen 2.551 · kapalı 527 · kategori eşleşmemiş 4.764 · aynı başlık 133 · üst sınır 81 · tekrar kod 14 · barkodsuz 238.
- V2 doğrulandı: approved/unapproved listeleme, nextPageToken, `commission`, `category.id`/`brand.id`, batch sonucu, storeFrontCode göndermeden TR.
- >%20 artan 5 ürün önceden kontrol edilemedi.

**Düzeltme:** workflow elle tetiklemede varsayılan mod `preview`, mod açılır liste.

**Sıradaki:** (K) Trendyol panelinden birkaç ürünü kontrol et, artifact `preview.csv`'yi ver (fiyat artışı analizi) → `auto_sync` aç → P1 yeni ürünler.

## 2026-10-16 (2) — Trendyol V2 geçişi

**Yapıldı**
- `trendyol.ts` V2: listeleme `products/approved` (100/sayfa, 10.000 sonrası `nextPageToken`) + `products/unapproved`; açma `/v2/products`; marka `by-name` dizi yanıtı; `batch-requests` ile ürün bazlı hata (`summary.batchCheck`).
- İlan durumu: `closed` (kilitli/arşiv/kara liste veya fiyat 0) ve `pending` (onay bekliyor/reddedildi) güncellenmez; `pending` yeniden açılmaz.
- Canlı komisyon (`variants[].commission`) öncelikli.
- V2'de olmayan `cargoCompanyId` kaldırıldı, resim en fazla 8.
- Kalıcı test: `worker/test/{mock,run}.mjs` (24 kontrol). Workflow'da sync öncesi koşar.
- `yedek/` zip'leri ve boş `API` alt modül kaydı silindi (kullanıcı onayı).

**Doğrulanmadı (canlı):** V2 uç yolları, `commission` birimi (yüzde/oran), `stock.quantity` alanı (referansta yok), batch sonuç biçimi. İlk `preview` özetindeki `listingTotals` ve `batchCheck`'e bak.

**Sıradaki:** (K) Actions'tan `preview` çalıştır → sonuçlara göre düzelt → P1.

## 2026-10-16

**Yapıldı**
- Repo senkronu: yerel klasör git'e bağlandı (`origin` = `awanexli-blip/API`). GitHub'da eksik olan komisyon mantığı, `commissions_*.json`, `CLAUDE.md` gönderildi. `yedek/` zip'leri korundu. (commit `3b1a4dc`)
- Çoklu pazaryeri mimarisi: `worker/marketplaces/{types,index,trendyol}.ts`, `worker/core/{util,xml}.ts`. `sync.ts` pazaryerinden bağımsız. Workflow ve `/api/run` `marketplace` girdisi alıyor (varsayılan `trendyol`). (commit `2f24b07`)
- Yeni ürün markası `Eco Lounge` (`TRENDYOL_BRAND_NAME`). (commit `4bddd82`)
- Pazaryeri zorunlu alan araştırması ve plan: `docs/TODO.md`.

**Doğrulandı**
- Eski ve yeni `sync.ts` sahte XML/Supabase/Trendyol ile 5 senaryoda (auto/update/preview/create/zero_missing, floor/formula/keep) birebir aynı CSV, özet ve Trendyol istekleri üretti. `tsc` temiz.
- Test düzeneği oturumun scratchpad'inde kaldı (kalıcı değil). Gerekirse `worker/test/` altına kalıcı mock test eklenmeli.

**Bulgu (kritik)**
- Trendyol V1 ürün servisleri 15.10.2026'da kapandı. Worker'ın ürün listeleme ve ürün açma uçları V1. Sıradaki `preview`/cron hata verebilir → TODO P0.
- V2 listeleme yanıtı ürün bazlı `commission` ve `category.id` döndürüyor: komisyon JSON'una ve kategori tahminine gerek kalmayabilir.

**Açık / kullanıcıdan**
- `storeFrontCode` TR değeri belgede yok, canlıda denenmeli.
- Hepsiburada / N11 / Amazon hesap ve API anahtarları, resmi doküman erişimi.
- Vercel: panel pazaryeri API'lerine erişeceği zaman kimlik bilgileri Vercel env'e girilecek.

**Sıradaki adım:** P0 Trendyol V2 geçişi.

## Notlar
- Yerel ortam: `npm install --prefix worker` yapıldı. Kök `package-lock.json` ve `worker/package-lock.json` gitignore'da (Vercel bağımlılık çözümü değişmesin).
- Commit/push: Claude doğrudan `main`'e gönderiyor (kullanıcı izni var). `main`'e giden worker kodu bir sonraki cron'da canlı çalışır.
