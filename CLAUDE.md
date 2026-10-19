# Trendyol Dropshipping Otomasyonu: Proje Devir Notu

Bu dosya projenin amacını, şimdiye kadar yapılanları, kuralları ve sıradaki işleri anlatır. Claude Code bu dosyayı repo kökünden otomatik okur (`CLAUDE.md`). Kullanıcı Türkçe konuşur, kısa ve doğrudan cevap ister, parça parça onay yerine tam teslimat tercih eder.

Güvenlik kuralı: API anahtarlarını, secret'ları, `service_role` anahtarını koda, commit'e veya sohbete yazma. Yalnızca GitHub Secrets ve Vercel Environment Variables içinde dururlar.

---

## 1. Amaç

Kullanıcı (Ewan) dropshipping yapıyor. Tedarikçi BayilikXML'in XML akışından (yaklaşık 25.290 ürün) Trendyol mağazasına ürün satıyor. İstenen:

1. Trendyol'daki ürünlerin **stok ve fiyatı otomatik** güncellensin (XML günlük değişiyor).
2. Fiyat, **zarar etmeyecek biçimde formülle** hesaplansın (komisyon + kargo kuralı dahil).
3. XML'de olup mağazada olmayan yaklaşık 7.400 ürün **kopya açmadan** Trendyol'a eklensin.
4. Kâr marjı, komisyon, kargo gibi ayarlar **web panelinden** değiştirilebilsin.
5. İleride diğer pazaryerleri (Hepsiburada, N11, Amazon TR) eklenecek. Şimdilik sadece Trendyol.

## 2. Mimari

```
BayilikXML (XML)  ->  GitHub Actions (worker/sync.ts)  ->  Trendyol API
                              ^
                              |  ayarlar, kategori eşleşmeleri, çalıştırma geçmişi
                          Supabase  <-  Vercel'deki Next.js kontrol paneli (app/)
```

- **GitHub Actions** (`.github/workflows/sync.yml`): 15 dakikada bir (UTC :07/:22/:37/:52) `auto` modunda, tüm pazaryerleri ayrı job (matris) çalışır, elle de tetiklenebilir (`workflow_dispatch`, mod: `preview | update | create | auto`). Artifact olarak `preview.csv` ve `xml_dump.csv` yükler (7 gün saklanır). Vercel fonksiyonları 48 MB XML ve 25 bin ürün için uygun olmadığından işi Actions yapar.
- **Supabase** (proje `xovqsjiddoituaayyhae`, Claude MCP ile erişebilir): `settings`, `marketplace_settings`, `category_map`, `product_overrides`, `unmapped_categories`, `sync_runs`, `create_failures` tabloları. Şema: `supabase/schema.sql`. RLS açık, erişim sadece sunucu tarafında `service_role` ile.
- **Vercel + Next.js 16 paneli** (`app/`, React 19, panel v2: sol menü/alt menü, gece/gündüz, hash ile gezinme): sadece `ADMIN_EMAIL` ile giriş yapan kullanıcı. Sekmeler: Özet (otomatik modu duraklat, Önizleme / Stok ve fiyatı güncelle / Yeni ürünleri aç düğmeleri, son çalıştırmalar), Fiyat ve stok ayarları (simülasyon dahil), Kategoriler, Ürün istisnaları. Düğmeler GitHub API ile `sync.yml` workflow'unu tetikler (`GH_TOKEN` gerekir).

### Dosya haritası

| Yol | Görev |
|---|---|
| `worker/sync.ts` | Pazaryerinden bağımsız orkestratör: XML çek, ilanları çek, eşleştir, fiyat hesapla, güncelle/oluştur, CSV yaz, Supabase'e sonuç yaz. Kullanım: `sync.ts <mod> [pazaryeri]` |
| `worker/marketplaces/` | `types.ts` (Marketplace arayüzü), `index.ts` (kayıt defteri), `trendyol.ts` (API, barkod kuralı, komisyon kaynağı, ürün açma). Yeni pazaryeri = yeni adaptör dosyası + kayıt defterine ekleme |
| `worker/marketplaces/hepsiburada.ts` | Hepsiburada adaptörü (SIT varsayılan, `HB_ENV=prod`), uçlar canlıda doğrulanmadı |
| `worker/marketplaces/amazon.ts`, `worker/amazon-tool.ts`, `.github/workflows/amazon-tool.yml`, `app/api/matches` | Amazon TR (SP-API): LWA, ilan raporu, JSON_LISTINGS_FEED stok/fiyat, var olan ASIN'e teklif (LISTING_OFFER_ONLY), ASIN eşleştirme (`marketplace_matches`, migration 014). Kurulum `docs/AMAZON_KURULUM.md` |
| `worker/hb-tool.ts`, `.github/workflows/hb-tool.yml` | Hepsiburada test aracı (Actions'tan: ping, categories, suggest, attributes, send, status, stock, price, orders, raw). Kılavuz: `docs/HEPSIBURADA_TEST.md` |
| `worker/data/hepsiburada/` | `commissions.json` (kategori komisyonu, +KDV), `cargo.json` (desi kargo tarifesi, KDV hariç) |
| `supabase/migrations/002_marketplaces.sql` | Pazaryeri bazlı ayarlar ve `marketplace` kolonları |
| `kaynaklar/` | Git dışı: PDF/Excel/ekran görüntüleri (repo herkese açık) |
| `worker/core/classify.ts` | Yeni ürün kategori + komisyon tahmini (benzer başlıklı mevcut ilanlardan, yüksek güvende %95 isabet) |
| `worker/core/` | Ortak yardımcılar (`util.ts`), XML okuma (`xml.ts`) |
| `docs/ARCHITECTURE.md` | Merkezi ürün platformu mimarisi, fazlar, Faz 1 kurulum/API |
| `supabase/migrations/003_products.sql` | Merkezi ürün DB: `products`, `product_variants`, `product_images`, `user_roles`, `audit_log`, `product_save`/`product_delete` (transaction) |
| `lib/validation/product.ts`, `tests/` | Ürün doğrulama şeması (zod, GTIN), birim testleri (`npm test`) |
| `app/api/products/`, `app/_components/Products.tsx` | Ürün CRUD API (rol bazlı), görsel yükleme (`products/images`, Storage `product-images`), form seçenekleri; panel ekranı (otomatik SKU/barkod, pazaryeri hazırlık listesi `lib/marketplace-readiness.ts`) |
| `lib/import.ts`, `app/api/import/`, `worker/import-xml.ts`, `.github/workflows/import.yml`, `app/_components/Import.tsx` | Faz 2: CSV/Excel ve tedarikçi XML içe aktarma (`product_import_batch`, migration 008) |
| `lib/supplier-xml.ts`, `app/api/suppliers/`, `app/_components/Suppliers.tsx` | Çoklu tedarikçi: XML adresi + alan eşlemesi (`suppliers`, migration 009), XML inceleme/önizleme |
| `worker/core/db-products.ts`, `worker/core/listings.ts`, `worker/jobs.ts`, `app/api/listings/send`, `app/api/jobs` | Faz 3-4: ilan tablosu (`marketplace_listings`), iş kuyruğu (`jobs`), veritabanından pazaryerine gönderim ve stok/fiyat (migration 013) |
| `app/api/feed/[token]`, `app/api/feeds`, `app/_components/Feeds.tsx` | Faz 2: XML feed dışa aktarma (gizli token adresi) |
| `app/_components/Brands.tsx`, `BrandInput.tsx`, `app/api/brands/`, `worker/brands.ts`, `.github/workflows/brands.yml` | Markalar sekmesi (yeni ürün markası + geri al, marka dağılımı), marka arama (Trendyol marka listesi haftalık `marketplace_brands`) |
| `docs/TODO.md` | Yapılacaklar (öncelik sırasıyla) ve pazaryeri zorunlu alanları |
| `docs/PROGRESS.md` | Gelişme günlüğü. **Her oturumda önce bunu oku, sonunda güncelle** |
| `worker/pricing.ts` | `calcPrice()` fiyat formülü. Panel de simülasyon için aynı dosyayı import eder (`@/worker/pricing`) |
| `worker/commissions_by_barcode.json` | Trendyol'daki 18.027 ürünün kendi komisyon oranı (barkod -> oran) |
| `worker/commissions_by_category.json` | XML kategorisi -> kategorideki en yüksek komisyon (yeni ürünler için güvenli taraf) |
| `app/page.tsx` | Panel kabuğu (v2): giriş, menü, hash yönlendirme (`#/urunler`, `#/pazaryeri/<pazaryeri>/<alt>`), bildirimler, tema |
| `app/_components/Dashboard.tsx`, `AppSettings.tsx`, `PricePreview.tsx`, `ProfitRules.tsx`, `Icon.tsx`, `theme.ts` | Gösterge paneli (`/api/dashboard`), ayarlar (kullanıcılar `/api/users`), ürün fiyat önizlemesi, akıllı kâr (`/api/pricing-rules`, `worker/pricing-rules.ts`) |
| `app/_components/` | `Overview`, `Settings`, `Categories`, `Overrides` (Trendyol alt sekmeleri), `Upcoming` (bağlanmamış pazaryerleri), `shared` (api, zaman aşımı) |
| `app/api/{settings,categories,overrides,runs,run,health}/route.ts` | Panel API'leri, hepsi `guard()` ile korumalı |
| `lib/server.ts`, `lib/supabase-browser.ts` | Supabase istemcileri ve yetki kontrolü |
| `supabase/schema.sql` | Tablolar (ayrıca `existing_price_policy` kolonu) |

## 3. İş kuralları (değiştirme, kullanıcı belirledi)

**Fiyat formülü** (KDV dahil, TL):
```
satış = (maliyet + sabit gider [+ kargo]) / (1 - komisyon - hedef_kâr)
```
- Hedef net kâr: **%15** (satış fiyatı üzerinden).
- Varsayılan komisyon %18. Gerçek komisyon ürün/kategori bazında değişir (%7 ile %25,7).
- **Kargo kuralı:** kargo ücreti **90 TL**. Satış fiyatı **300 TL ve üstündeyse kargoyu satıcı öder**, 300 TL altındaysa alıcı öder. Hesaplanan fiyat 300'ü aşıyorsa önce **299,90** denenir (kargo alıcıda kalır, net kâr en az %8 ise kabul). Olmazsa kargo maliyete eklenerek yeniden hesaplanır.
- Alt sınır: fiyat >= maliyet x 1,3. Psikolojik yuvarlama: x9,90. Zarar eden ürünler ve fiyat üst sınırını (`max_price`, 19.10 kullanıcı isteğiyle 50.000 TL) aşanlar atlanır. Stok < 3 ise Trendyol'a stok 0 gönderilir.
- Kullanıcı sabit %18 komisyon istedi, "kategoriye göre düşebilir" dedi. Şu an ürün bazlı gerçek oran kullanılıyor.

**Komisyon ve KDV:** Trendyol komisyon oranları KDV dahil (panel bilgi kutusu, 16.10). Hepsiburada komisyonları +KDV (sözleşme EK.4). Fiyat formülü KDV'yi açıkça hesaplar, net kâr KDV sonrası, oran KDV hariç satışa göre.

**Komisyon önceliği** (`worker/sync.ts` döngüsü): ürünün kendi oranı (barkod JSON) > panelde girilen kategori oranı (`category_map.commission_rate`) > kategori içindeki en yüksek oran (kategori JSON) > varsayılan (%18).

**Mevcut ürünlerde fiyat politikası** (`settings.existing_price_policy`, panelden seçilir, varsayılan `floor`):
- `floor`: sadece formül fiyatı mevcuttan yüksekse yükselt, mevcut fiyatı asla düşürme.
- `keep`: fiyata dokunma, sadece stok güncelle.
- `formula`: her ürünü formül fiyatına eşitle (fiyatlar düşer).
- `smart` (16.10, önerilen): formülün altındakini yükselt, üstündekini her çalışmada en fazla %10 düşür; 300 TL eşiğinin hemen üstündeki (300–~410) ürünleri doğrudan 299,90'a indir (hem ucuz hem kârlı).
- Nedeni: ürünleri yükleyen kişinin fiyatları zaten hedef kârın üstünde. `formula` modu 14 bin ürünün fiyatını gereksiz düşürürdü.

**Barkod/eşleştirme kuralı (kritik):**
- Mağazadaki ürünlerin barkodu = `"ÖS13-" + XML productCode`, ASCII dışı karakterler atılmış (`replace(/[^A-Za-z0-9._\-]/g, "")`). Örn. `SFKXUCZZZBENZİNLİZİPPOOOOO-2-1` -> `ÖS13-SFKXUCZZZBENZNLZPPOOOOO-2-1`.
- XML'deki `barcode` alanı (`BX5XM...`) mağazadakilerle eşleşmez. Sadece 3 üründe aynıdır.
- **Yeni ürünler `OS13-` + productCode (ASCII, Ö'süz)** ile açılır, kullanıcı Ö harfinin başka sistemlerde sorun çıkarmasından çekindi. Eşleştirme hem `ÖS13-` hem `OS13-` dener. Trendyol barkodu sonradan değiştirtmez, bu yüzden eski ürünler `ÖS13-` kalır.
- Yeni ürünlerde marka: mağazadaki ürünlerin %93'ü **"Eco Lounge"** markasıyla açılmış (XML'deki marka "BayilikXML.com", Trendyol'da yok). Kullanıcı yeni ürünlerde de aynı markayı kabul etti. Worker yeni ürünlerde markayı `TRENDYOL_BRAND_NAME` ortam değişkeninden alır (varsayılan `Eco Lounge`), XML markası kullanılmaz.

## 4. Veri bulguları (14 Ekim 2026 dosyalarından)

- XML: 25.290 ürün. Trendyol API: 20.644 barkod. Trendyol "Ürünleriniz" dışa aktarımı: 18.027 ürün.
- Kural ile XML'den **19.718 ürün** mağazadaki ürüne bağlanıyor. XML'de olup mağazada olmayan: ~7.490, bunların ~7.380'i gerçekten yeni, 114'ünün başlığı mağazada var (çoklama riski).
- Mağazadaki ürünlerin başlıkları XML ile birebir aynı (16.741 ürün). Yani ürünler bu XML'den yüklenmiş.
- Önceki yükleyici (aracı bir kişi) kullanıcının seller ID / API anahtarıyla 17 bin ürünü yükledi. Kullanıcı onu durdurttu ve API secret'ı yeniledi.
- Mevcut ürünlerin net kâr oranı (gerçek komisyonla) medyan %17. Zarar eden aktif ürün yok. Ürün bazlı komisyonla `floor` politikasıyla yaklaşık **3.310 ürünün fiyatı artar** (medyan +15 TL), 5 üründe artış >%20 (biri 1.487 TL). İlk güncellemeden önce bu 5'i kontrol et.
- Mağazadaki durum uyarıları: 172 Hatalı Marka (yeniden açılamaz), ~120 Marka Hakkı İhlali, 95 Orijinallik Belgesi, 30 Çoklanan Ürün Satışı, 158 stok girilmemiş. Bunlar mağaza hesabını etkileyebilir. Yaklaşık 420 ürün Trendyol tarafından kapatılmış (fiyat ve stok 0), worker bunları atlar.
- XML'de 760 kategori var. Mağazadaki aynı XML kategorisi birçok farklı Trendyol kategorisine dağılmış (örn. "Pratik Ev Aletleri" halı yıkama makinesi vb.), bu yüzden **XML kategorisinden Trendyol kategori ID'si otomatik çıkarılamaz**.

## 5. Durum

**Yapıldı ve çalıştı:**
- Supabase, Vercel (Supabase ile entegre), GitHub Actions kuruldu. Secrets girildi, Trendyol kimlik doğrulaması çalışıyor (yeni API bilgileriyle).
- `preview` modu çalışıyor: XML + Trendyol ürünleri çekilir, bağlanır, `preview.csv` üretilir (BOM'lu UTF-8, Excel'de Türkçe düzgün).
- Daha önce kazara `auto` modunda **3 ürünün** stok/fiyat güncellemesi gerçek çalıştı, hatasız (failedBatches 0).
- Panel yazıldı ve Vercel'e dağıtıldı. `next build` ve `tsc` temiz.

**Henüz denenmedi (canlı doğrulama yok):**
- 17 binlik toplu `update` (stok + fiyat).
- `create` (yeni ürün açma) hiç çalışmadı.
- Trendyol **Product V2** uçları (V1 15.10.2026'da kapandı), resmi dokümana göre yazıldı, canlıda doğrulanmadı: `GET /product/sellers/{id}/products/approved` (size ≤100, 10.000 sonrası `nextPageToken`), `GET .../products/unapproved`, `POST /inventory/sellers/{id}/products/price-and-inventory`, `POST /product/sellers/{id}/v2/products`, `GET /product/brands/by-name` (dizi döner), `GET .../products/batch-requests/{id}` (sonuç özetin `batchCheck` alanına yazılır). `storeFrontCode` başlığı yalnızca `TRENDYOL_STOREFRONT` (GitHub Variable) ayarlıysa gönderilir, gönderilmezse TR sayılır.
- Test: `node worker/test/run.mjs` (sahte servisler, canlıya yazmaz). Workflow her çalışmadan önce koşar.

**Kullanıcı tarafında:** son `API.zip` içeriği en güncel kod. GitHub'daki repo (`awanexli-blip/API`) ile yerel kopya aynı olmayabilir (kullanıcı bazı değişiklikleri GitHub web arayüzünden yaptı). İlk iş: `git pull`, `git status` ve fark kontrolü. `auto_sync` panelden duraklatılmış olabilir, durumu `settings` tablosundan kontrol et.

## 6. Sıradaki işler (sırayla)

1. **Repo senkronu:** yerel dosyalar ile GitHub aynı olsun. `worker/commissions_*.json` dosyaları repoda olmalı.
2. **Yeni önizleme:** panelden / Actions'tan `preview` çalıştır. Çıktıdaki `commissionSource.urun` yaklaşık 19.000 olmalı. `preview.csv` içindeki fiyat artışlarını kontrol et (özellikle >%20 artanlar).
3. **İlk gerçek güncelleme:** önizleme onaylanırsa `update` çalıştır, panelde `failedBatches` 0 olmalı, Trendyol panelinden birkaç ürünü elle doğrula. Sonra `auto_sync` aç.
4. **Yeni ürünler (~7.380):**
   - ~~Marka `Eco Lounge` sabitleme~~ yapıldı (`marketplaces/trendyol.ts`, `brandId` önbellekli).
   - Her yeni ürün için Trendyol `categoryId`: aynı XML kategorisindeki mevcut ürünlerin API'deki `pimCategoryId` değerlerinden, başlık benzerliği (en benzer mevcut ürün) ile seçmeyi öner. XML kategorisi tek başına yetmez. API'de `pimCategoryId`, `brandId`, `categoryName` alanlarının dönüp dönmediğini canlıda doğrula (hafızadan, kesin değil).
   - Kategoriye göre zorunlu özellikler (renk, beden vb., `attributes`) hata verebilir. Önce **50 ürünle deneme**, hataları gör, sonra hepsini aç. `auto_create` varsayılan kapalı kalsın.
   - Yeni ürün barkodu `OS13-` + productCode. Mevcut korumalar: aynı başlık mağazada varsa atla, eşleşme zayıfsa (<%50) `create` kendiliğinden durur.
5. **Kapalı ürünler (~420):** karar kullanıcıda (bırak / arşivle). Benzer başlıklı yeni ürünlerde aynı hataya düşmemek için filtre düşün (marka ihlali ve orijinallik uyarısı olanlara benzeyenler).
6. **Kategori komisyonu:** panelin Kategoriler sekmesi kategori başına komisyon girmeye izin verir. Yeni kategoriler için `commissions_by_category.json` kapsamayanlar (XML'de 760 kategorinin 91'i) %18 varsayılana düşer.
7. **Küçük iyileştirmeler:** workflow'daki action sürümlerini güncelle (Node 20 uyarısı zararsız), `preview.csv` yerine panelde önizleme tablosu göster, Trendyol'daki ürünlerde XML'den kalkanları (`zero_missing`) dikkatle aç.
8. **Diğer pazaryerleri (en son):** Hepsiburada, N11, Amazon TR için ayrı modüller. Her pazaryerinin marka listesi, kategori ağacı ve komisyonu farklı. Marka ("Eco Lounge") orada kabul görmeyebilir, her birinin kendi API'sinden marka sorgusu yapılmalı.

## 7. Bilinen tuzaklar

- **GitHub Secret maskeleme:** bir Secret'ın değeri kısaysa (örn. tek hane `7`) GitHub log'larda o rakamı her yerde `***` yapar. Artifact indirme linki bu yüzden bozuk görünebilir, gerçek numarayı tahmin et veya run özet sayfasından indir.
- **Secret formatı:** `SUPABASE_URL` yalnızca `https://<proje-id>.supabase.co`. Sonunda `/` veya `/rest/v1` olmamalı (yoksa "Invalid path" hatası).
- **Trendyol hız sınırı:** aynı uç noktaya 10 saniyede en fazla 50 istek (429). Worker istekler arasında 300 ms bekler.
- **Trendyol 401:** seller ID, API key, API secret karışmış veya boşluk içeriyor demektir. `User-Agent: "<sellerId> - SelfIntegration"` zorunlu.
- **CSV tuzağı:** `preview.csv` ayracı `;`. Mevcut ürün satırlarının son sütununda (`MEVCUT (artacak; formül 479.9)`) ek bir `;` var. Analiz yaparken satırı ilk 8 `;` ile böl, kalanı durum sütunu say. `satis` sütunu **gönderilecek** fiyattır, mevcut fiyat değil (mevcut fiyatla karşılaştırma için Trendyol dışa aktarımı gerekir).
- **Zamanlı çalışma:** cron UTC'dir. `auto_sync` açıksa 15 dakikada bir gerçekten güncelleme yapar. Önizleme istiyorsan `auto_sync`'i duraklat veya mod olarak `preview` yaz (varsayılan mod `auto`).
- **Aracı yükleyici:** önceki yükleyici hâlâ senkronize ediyorsa fiyat/stokları ezer. Kullanıcı durdurdu ve secret'ı yeniledi, ama devam ettiğinden şüphelenirsen Trendyol panelindeki son güncelleme tarihlerine bak.
- **Node:** worker `node --experimental-strip-types` ile TypeScript'i doğrudan çalıştırır (Node 22+). `worker/` kendi `package.json`'una sahip (`@supabase/supabase-js`, `fast-xml-parser`).

## 8. Ortam değişkenleri (sadece adlar)

**Amazon TR (GitHub Secrets):** `AMAZON_LWA_CLIENT_ID`, `AMAZON_LWA_CLIENT_SECRET`, `AMAZON_REFRESH_TOKEN`, `AMAZON_SELLER_ID`; Variable: `SYNC_MARKETPLACES` (zamanlı senkrondaki pazaryerleri, JSON dizi). Kurulum: `docs/AMAZON_KURULUM.md`.

**Hepsiburada (GitHub Secrets):** `HB_MERCHANT_ID`, `HB_USERNAME`, `HB_PASSWORD`; Variables: `HB_ENV` (boş=SIT, `prod`), `HB_USER_AGENT`.

**GitHub Secrets (worker):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `XML_URL`, `TRENDYOL_SELLER_ID`, `TRENDYOL_API_KEY`, `TRENDYOL_API_SECRET`, `TRENDYOL_SHIPMENT_ADDRESS_ID`, `TRENDYOL_RETURN_ADDRESS_ID` (opsiyonel, `create` için; V2'de `TRENDYOL_CARGO_COMPANY_ID` kullanılmıyor). **GitHub Variables (opsiyonel):** `TRENDYOL_STOREFRONT`, `TRENDYOL_BRAND_NAME`.

**Vercel (panel):** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAIL`, `GH_TOKEN` (fine-grained, bu repo, Actions: Read and write), `GH_REPO` (`awanexli-blip/API`).

## 9. Yerel çalıştırma

```bash
npm install                      # panel
npm install --prefix worker      # worker
npm run dev                      # panel (.env.local gerekir)
# worker (ortam değişkenleri tanımlı olmalı):
node --experimental-strip-types worker/sync.ts preview
```
`preview` Trendyol'a yazmaz. `update` ve `create` canlı yazar, dikkatli çalıştır.
