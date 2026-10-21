# Gelişme günlüğü

En yeni üstte. Her oturum sonunda: ne yapıldı, ne doğrulandı, ne açık kaldı, sıradaki adım.

## 2026-10-22 (18) — Denetim, Faz 6 planı, çalışma kuralları (yalnızca doküman; kod ve canlı sistem değişmedi)
- Eklendi: `docs/DENETIM_2026-10-21.md` (bulgular), `docs/DENETIM_GOREVLERI.md` (Claude Code'un başlatacağı işaretli görev listesi), `docs/FAZ6_PLAN.md` (sipariş → tedarikçi → takip → soru/iade → kâr, F0-F12), `docs/CALISMA_KURALLARI.md` (oturum protokolü, çalışmayan buton ve unutma önleme kuralları, model/çaba tablosu). `CLAUDE.md` §0 ve `docs/TODO.md` "Şu an" bunlara bağlandı. Migration numaraları: güvenlik 025-026, Faz 6 027-028 (022-024 başka işlerde kullanımda: listing_retire, brand_blocklist, supplier_brand).
- Doğrulanan (salt okunur, denetim anında): `tmp_profit` SECURITY DEFINER ve `anon/authenticated`'a SELECT yetkisi var (maliyet, komisyon, net kâr sütunları); `tmp_xml_costs`, `tmp_xml_raw`, `price_audit_before` üzerinde de anon SELECT yetkisi (RLS açık, politikasız); advisors: duplicate index, unindexed FK, `price_audit_before` PK yok, leaked password kapalı. Worker `npm audit` 0 açık; worker testleri geçti. Panel `tsc/build` yapılamadı (xlsx CDN 403): görev S3.2.
- Not: denetim, BayilikXML bırakılmadan önceki kod durumunda yapıldı; sonraki commit'ler (retire, Toptancım) ikinci tura bırakıldı (S3.1).
- Açık / sıradaki: `docs/DENETIM_GOREVLERI.md` **S0.1** (anon anahtarla canlı kanıt), ardından S0.2 (CANLI, K onayı).

## 2026-10-21 (17) — Hepsiburada SIT, Toptancım fiyat ve marka filtresi
- HB SIT kimlik: Basic `merchantId:secretKey`, `User-Agent` = developer username (zorunlu). Listing + sipariş 200; stok/fiyat (tek ve 30'lu toplu) doğrulandı, 30/30 satılabilir. Katalog (mpop) 403: yetki HB'de. `sales_paused`/`retire_legacy` artık pazaryeri bazında (Trendyol ayarı HB'ye miras geçip test stoğunu sıfırlamıştı). hb-tool `send` ürün DB'sinden.
- Toptancım: 2 XML = 20.717 + 5.604 ürün (eksik okuma yok; 11 SKU çakışması). Fiyat doğrulaması 68–5.016 TL × 5 komisyon: en az 45 TL tek, 40 TL çok adet. KDV hariç ayarı K'ya teyit için soruldu (XML 158 → maliyet 189,60). SKU öneki alanına örnek kod girilmiş (açık).
- Marka riski: `brand_blocklist` (migration 023, 192 marka/karakter), `worker/core/brand-risk.ts`; başlık/açıklamada geçen ürün hiçbir pazaryerine gönderilmez (ilan "Marka riski"), panel → Markalar → Gönderilmeyen markalar. Toptancım'da başlıkta ~400 ürün. Tedarikçi XML markası (Trendyol'da başkasına kayıtlı "Tcx") artık kullanılmaz, mağaza markası.

## 2026-10-21 (16) — BayilikXML ilanlarını kaldırma, yeni tedarikçi Toptancım
- K: BayilikXML bırakıldı (panel tedarikçi kaydı silindi), yeni tedarikçi Toptancım (`toptacim`, 20.760 ürün DB'de; ayrıca `toptancim2` kaydı). K kararı: **arşivle + 1 gün sonra otomatik sil**.
- `retire_legacy` (settings, migration 022) + `listing_retire` tablosu + `worker/core/retire.ts`: ÖS13-/OS13- ilanları (20.744; 103 başka barkodlu ilana dokunulmaz) önce `archive-state` ile arşivlenir, onaysızlar doğrudan silinir, arşivde 25 saat dolunca `DELETE /products` ile silinir; hata alanlar 6 saatte bir yeniden denenir; sonuç `summary.retire`. Açıkken BayilikXML okunmaz; yeni ürün kategori tahmini ilan tablosundaki (silinenler dahil) başlık/kategorilerden öğrenilir. Satış durdurma (`sales_paused`) açıkken de çalışır. Testler: `retire.test.ts`.
- Açık: Toptancım ürünlerini Trendyol'a gönderme (panel "Trendyol'a gönder" → send_products kuyruğu), sonra `sales_paused` kapatılmalı.

## 2026-10-20 (15) — Satışı durdur
- K isteği: Trendyol satışı kapatılsın. `sales_paused` (settings + marketplace_settings, migration 021): açıkken senkron (otomatik senkron kapalı olsa da) satıştaki bütün ilanlara stok 0 gönderir, fiyat/ürün açma/gönderim yapmaz. Panel: Pazaryeri → Özet → "Satış durumu" (durdur/aç + hemen güncelleme başlatır). Trendyol'da açıldı (20.10).
- 19.10 analiz: XML veritabanına `http` eklentisiyle alındı (geçici `tmp_xml_raw`, `tmp_xml_costs`, görünüm `tmp_profit`; silme K tarafından reddedildi, duruyor). Yeni formül 25.377 ürün × 5 komisyonda en az 40 TL net (tek ve çok adet).

## 2026-10-19 (14) — Çoklu adet koruması, tedarikçi araştırması
- Sorun (K siparişleri): 300 TL eşiği sepet toplamına bakıyor. Dizlik (maliyet 153, 249,90) 2 adet alınınca kargo satıcıya geçti, net ~6 TL. BK012 (299,90) ise K'nın verdiği 255 TL maliyetle zarar; sistem XML'de ≤ ~235 TL görüyor olmalı → fark (sipariş başı ücret? `fixed_cost` 0) K'ya soruldu, yanıt bekleniyor.
- `multiUnitMinNet` / `settings.multi_unit_min_net` (migration 019, K onayı; 19.10 K isteğiyle 40 TL, `squeeze_min_net` de 40): 300 altı fiyatta eşiği geçen adet n=ceil(300/fiyat) için n·net − kargo(KDV indirimli) ≥ 15 TL. 299,90 sıkıştırması da bu şartı geçmeli. smart adımı korumayı bozarsa formüle iner (`existingPriceSafe`). Etki: 150–300 TL bandı çoğunlukla +10–20 TL; maliyeti ~200–218 TL olanlar 299,90'dan kargolu fiyata (~460) çıkar. Panel: Fiyat ayarları alanı. Testler eklendi.
- Kâr kademeleri (K onayı, Trendyol): 0–50 TL %30/en az 40 TL · 50–150 %22/45 · 150–500 %17/55 · 500–1500 %14/100 · 1500+ %10/150 (son ikisi açıldı). Amaç: her satış en az 40 TL net, pahalılar daha rekabetçi. 10.000 TL üstü 40 ilan stok 0 idi; K isteğiyle `max_price` 50.000 TL (stoklu olanlar satışa açılır).
- İlan tablosuna senkron hesabı (`xml_cost`, `calc_price`, `calc_net`, `calc_note`; migration 020): XML ile eşleşmeyen ilanlar işaretlenir (BK012 şüphesi).
- Tedarikçi araştırması (Şikayetvar): BayilikXML temiz (2 şikayet, çözüldü); Yenitoptancı (19) ve Hepsibayi (8) gecikme/fatura şikayetleri; Lisinya keyfi iade almıyor. Hepsibayi'ye XML istendi (keyfi iade yok, markalı elektronik riskli → nötr ürünler filtrelenecek).

## 2026-10-18 (13) — Amazon gönderim düzeltmeleri, Trendyol ret düzeltme
- Amazon: `AMAZON_SELLER_ID`'ye Client Secret girilmişti ("Invalid parameters" nedeni); düzeltildi, `validate` VALID. Satıcı belirteci biçim kontrolü, hata metinlerinde kimlik gizleme; sızan değer DB'den temizlendi, secret yenilemesi önerildi. Teklifler Listings Items API ile tek tek (alan bazlı hata), `audience: ALL`; test aracına `validate`, `item`.
- Trendyol yeni ürün onayı: 165 onaylı, 37 ret (12 yasaklı kelime, 22 hatalı marka, 19 kategori). **Ret düzeltme**: adaptör ret ayrıntılarını (tür, açıklama, başlık, açıklama, görsel, kategori) okur, ilan tablosunda `rejected` + neden; `worker/core/rejections.ts` (yasaklı kelime çıkarımı/silme, başlık sonu " -Marka" eki, plan: otomatik en fazla 2 deneme, 6 saat bekleme, kategori/görsel kullanıcıya); `unapproved-bulk-update` ile yeniden onay; `banned_words`, `listing_fixes`, `store_categories` (migration 018). Yeni ürün metinleri gönderimden önce temizlenir (XML ve panel gönderimi). Panel: Trendyol → **Reddedilenler** (düzelt: başlık/açıklama/kategori/görsel, vazgeç, sisteme bırak; yasaklı kelime listesi). Testler: birim 16 + mock 6.

## 2026-10-18 (12) — Amazon canlı bağlantı, toplu eşleştirme
- Kullanıcı SP-API geliştirici profilini (Private Solution Provider; roller: Product Listing, Pricing, Inventory and Order Tracking, Selling Partner Insights) gönderdi, onaylandı, Production uygulaması + self-authorization; GitHub Secrets girildi. `amazon-tool ping`: **✓ Amazon Türkiye hesabı bağlı** (canlı doğrulandı).
- Güvenlik formu için `docs/GUVENLIK_OLAY_PLANI.md` (roller, 6 ayda bir gözden geçirme, 24 saatte security@amazon.com).
- 299,90 sıkıştırması: `squeeze_min_net` (migration 015), canlıda 15 TL (K onayı). Maliyet ~218 TL'ye kadar 299,90'a döner; smart politika ile kademeli (%10/çalışma).
- Amazon ayarı: komisyon %15 + KDV (`commission_plus_vat`; kaynaklar: komisyon kargo dahil toplamdan, +%20 KDV). Gerçek oranlar onay sonrası Product Fees API ile alınacak.
- Toplu eşleştirme: `processMatchJobs` (jobs `match_products:amazon`, yalnızca okuma, önizleme modunda da), `/api/matches/queue` (aday bul: `products_unmatched`; gönder: `products_confirmed_unlisted` → `/api/listings/send`), panel Amazon → **Eşleştirme** sekmesi (sayılar, aday bul/şimdi ara, Bu ürün/Değil/Hiçbiri, onaylananları gönder). Migration 016.
- **Ürün veritabanı hâlâ boş (0)**: BayilikXML içe aktarması hiç çalıştırılmadı (K). Marka listesi çekildi (807.201).

## 2026-10-17 (11) — Amazon TR
- Kullanıcı: Amazon TR hesabı var, SP-API yok; marka/GTIN durumunu bilmiyor; yöntem "ikisi birden" (önce var olan ürünlere teklif, muafiyet gelince kendi ürünleri).
- `worker/marketplaces/amazon.ts`: LWA token, SP-API EU, TR `A33AVAJ2PDY3EV` (resmi dokümandan doğrulandı), `GET_MERCHANT_LISTINGS_ALL_DATA` raporu (TSV, GZIP), `JSON_LISTINGS_FEED` PATCH (stok/fiyat, 5000 mesaj/feed), teklif `UPDATE` + `LISTING_OFFER_ONLY` + `merchant_suggested_asin`, feed sonuç raporundan ürün bazlı hata, katalog araması (EAN / kelime). `isRealGtin` ("2" ile başlayan iç kodlar hariç). Bekleme süreleri `AMAZON_POLL_MS/GAP_MS` (test).
- Arayüz genelleşti: `Marketplace.requiresCategory`, `listingKeyFor`, `findCatalogMatches`; `processSendJobs` Amazon'da kategori istemez, ASIN çözer (onaylı eşleşme > EAN ile tek sonuç otomatik > başlıkla adaylar → panelde onay). `marketplace_matches` + Amazon ayar satırı (kapalı, %15, eşik 0) migration 014.
- Panel: Amazon sekmesi canlı (Özet, Fiyat, Akıllı kâr, İstisnalar), ürün detayında "Amazon eşleşmesi" (Bu ürün / Değil / elle ASIN), "Amazon'a gönder" (tekli/toplu), fiyat önizlemesinde Amazon. `/api/matches`, `/api/listings/send` Amazon'a açık (ayar kapalıysa anlaşılır hata).
- sync.yml: zamanlı pazaryerleri `vars.SYNC_MARKETPLACES` (boşsa trendyol+hepsiburada; Actions dakikası boşa gitmesin), Amazon secrets. `amazon-tool.yml` (ping, search, listings, offer, stock, price, feed). Kılavuz `docs/AMAZON_KURULUM.md`.
- Testler: Amazon mock 12/12 (giriş, rapor, PATCH, %50 güvenlik, Incomplete atlama, feed hatası, EAN teklifi, aday bekleme, yanlış token).

## 2026-10-17 (10) — Fiyat ayarları uygulandı, Faz 4
- (K onayıyla) `return_rate` 0.05, `return_cost` 180, `min_acceptable_profit_rate` 0.12; Trendyol için 5 kademeli kâr kuralı açık (az stok kuralı kapalı). Politika "smart": düşüşler çalışma başına en fazla %10.
- **Faz 4**: `worker/core/db-products.ts`: `dbInventory` (ilan tablosunda varyanta bağlı, BayilikXML dışı ilanların stok/fiyatı veritabanından; `linked`e eklenir → zero_missing sıfırlamaz), `processSendJobs` (kuyruk `send_products:<pazaryeri>`, yalnızca update/auto/create modunda; anahtar: BayilikXML ürününde `OS13-`+SKU, diğerlerinde varyant barkodu; doğrulama: aktif, barkod, görsel, kategori (eşleşme veya yüksek güvenli tahmin), aynı başlık; marka `marketplace_brands`'ta varsa ürün markası; ilan `sent`/`error`; toplu sonuçta ret → `rejected` + neden). `listings.ts`: "gone" yalnızca live/pending/closed ilanlara (sırada/gönderildi silinmesin). Panel: `/api/listings/send` (idempotent saatlik anahtar, yönetici için "hemen" senkron), ürün detayı ve toplu işlemde "Trendyol'a gönder", ilan satırında hata/ret nedeni. Mock testleri 9/9 (sıfırlanmama, fiyat, gönderim, kategorisiz hata, zaten var, önizlemede gönderim yok).
- Not: çok varyantlı ürünlerin varyantları Trendyol'da şimdilik ayrı ürün olarak açılır (productMainId = barkod); varyant gruplama Faz 4.1.

## 2026-10-17 (9) — Stok/fiyat düzeltmeleri, iade gideri, Faz 3
- Kullanıcı: Trendyol'da stok yok görünen ama BayilikXML'de olan ürünler → `min_stock` 7'ydi (1-6 stok 0 gidiyordu), 3 yapıldı. `max_price` 60.000'e çıkmıştı, kullanıcı kuralı 10.000'e geri alındı.
- Kod açığı: fiyat üst sınırını aşan / zarar eden mevcut ilanlar atlanıyordu (eski fiyat ve stokla satışta kalıyordu) → artık stok 0, fiyata dokunulmaz (test 9c).
- %8 kâr: `min_acceptable_profit_rate` 0.08 ile 299,90 sıkıştırması. Öneri (K onayı bekliyor): eşik 0.12, iade %5 × 180 TL, kademeli kâr kuralları.
- KDV zaten hesapta (ödenecek KDV = satış KDV − alış/komisyon/kargo KDV); panelde açıklama eklendi. İade gideri yeni: `returnRate × returnCost` hizmet gideri olarak (KDV indirimli) formüle girer; `settings/marketplace_settings.return_rate/return_cost` (migration 012, varsayılan 0 → canlı fiyat değişmedi). Simülasyonda "İade payı".
- **Faz 3** (migration 013): `marketplace_listings`, `jobs` + `job_claim`/`job_finish`/`listings_link`; `worker/core/listings.ts` (sync sonunda anlık görüntü, özet `listingsTable`), `worker/jobs.ts` (+ sync.yml adımı), XML içe aktarma sonrası `link_listings` işi. Panel: Ayarlar → İş kuyruğu, ürün detayında "Pazaryerlerinde", gösterge panelinde yayında/onay/kapalı. Kuyruk DB testi 7/7 (geri alındı), birim + mock testleri geçti.

## 2026-10-17 (8) — Panel v2, güncel sürümler, denetim
- **Panel v2**: `globals.css` baştan (renk değişkenleri, gece/gündüz: sistem + `html[data-theme]`, ilk boyamadan önce `layout.tsx` betiği), sol menü (masaüstü) / üst çubuk + alt menü + çekmece (telefon), hash ile gezinme (`#/urunler`, `#/pazaryeri/trendyol/kar`), bildirim (toast), `Icon.tsx` (satır içi SVG). Yeni: `Dashboard` (`/api/dashboard`: sayılar, uyarılar, son senkron/içe aktarma), `AppSettings` (tema, hesap, kullanıcılar/roller `/api/users` + Supabase davet, kur/KDV, sistem durumu + sürüm), ürünler v2 (filtre: kaynak/durum/stok, toplu durum/marka/kategori `/api/products/bulk` → `product_bulk_update` denetimli, telefonda sıkı kart), ürün detayında pazaryeri fiyat önizlemesi (`PricePreview`, akıllı kâr dahil). Menüde Ürünler/Tedarikçiler/İçe aktar/XML feed ayrı bölümler.
- Migration 011: `product_bulk_update`, `product_facets` (seçenekler 1000 satır sınırına takılıyordu), indeksler.
- **Güncel sürümler**: Next 16.4.2 (Turbopack; rota `params` Promise; `turbopack.root`), React 19.3, zod 4 (`{ error }` sözdizimi), fast-xml-parser 5, supabase-js 2.118, TypeScript 7.0, @types/node 24; Actions checkout/setup-node/upload-artifact v7, Node 24. Vercel derlemeleri READY, canlı senkron sonrası hatasız (17.106 güncellendi, hata 0). `next dev` repoya AGENTS.md yazıyor (commit edildi).
- **Denetim**: tüm API uçları yetki kontrollü (feed bilerek token'lı). Playwright ile 12 ekran × telefon/masaüstü × gece/gündüz + ürün formu/detay/menü: konsol hatası yok, yatay taşma yok. Bulunan ve düzeltilen: marka kutusu beklenmedik yanıtta ürün formunu çökertiyordu; telefonda ürün kartları çok uzundu; zaman çizelgesi rozetleri; menü arka planı; seçenek listesi satır sınırı. Supabase güvenlik: yalnızca bilgi düzeyi (RLS politika yok = bilinçli) + leaked password (K). Performans: yinelenen indeks silme onaya düştü (K).
- Not: zamanlanmış senkron GitHub yoğunluğunda ~30 dk'da bir başlıyor (15 dk hedef).

## 2026-10-17 (7) — Akıllı kâr, plan
- XML içe aktarma hiç çalışmamıştı (import_jobs boş): iş kaydı artık en başta oluşur, XML inmezse nedeni panelde görünür.
- Akıllı kâr: `worker/pricing-rules.ts` (koşullar: maliyet aralığı, tedarikçi, kategori içeren, marka, stok ≤; etkiler: hedef kâr, en az net kâr TL, kâra ekle), `pricing.ts` `minNetProfit` (analitik `priceForNet`, 299,90 sıkıştırması net kârı tutmuyorsa yapılmaz). `pricing_rules` (migration 010). Worker her XML satırına uygular, özette `pricingRules`. Panel: pazaryeri → Akıllı kâr (kurallar, sıra, önerilen kademeler, simülasyon). Kural yokken davranış aynı. Testler: kural birim testleri + mock entegrasyon.
- Türkçe küçük harf tuzağı: "BAYILIK".toLocaleLowerCase("tr") = "bayılık"; karşılaştırmada ı→i.
- docs/TODO.md baştan yazıldı: çizelge (A Panel v2 → B denetim → C Faz 3 → D Faz 4 → E Faz 5 → F Faz 6), öneriler, bekleyen (K) işler.

## 2026-10-17 (6) — Çoklu tedarikçi
- `suppliers` (migration 009, uygulandı; BayilikXML kayıtlı: adres GitHub Secret `XML_URL`, gece kapalı). Panel: Ürünler → Tedarikçiler (ekle, XML'i incele, alan eşleme, ayarlar, önizleme, içe aktar, gece işareti).
- `worker/import-xml.ts` genel: tedarikçi tablosundan okur, `lib/supplier-xml.ts` ile eşler; `import.yml` her gece `nightly` (işaretli tedarikçiler) + elle `supplier` girdisi. Toplu stok sıfırlamada %30 güvenlik sınırı.
- tsconfig `allowImportingTsExtensions` (lib ↔ Node testleri). Panele `fast-xml-parser` eklendi. Testler 16/16.
- Pazaryerine gönderim hâlâ yalnızca BayilikXML üzerinden (sync.ts XML'i doğrudan okuyor). Diğer tedarikçilerin ürünlerini pazaryerlerine göndermek Faz 3-4 (adaptörler veritabanından beslenecek).

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
