# Gelişme günlüğü

En yeni üstte. Her oturum sonunda: ne yapıldı, ne doğrulandı, ne açık kaldı, sıradaki adım.

## 2026-10-30 (57) — Trendyol'a fatura yükleme, elle değişiklik koruması, yeni tedarikçi hazırlığı
- **Fatura yükleme** (`worker/invoice-upload.ts`, `.github/workflows/invoice-upload.yml`, `lib/invoice-verify.ts`): deneme -> yükle. Kontrol: GİB belgesinde ETTN + belge no + sipariş no + alıcı adı + ödenecek tutar, Trendyol paketi/durum/tutar canlı. İlk deneme 78/78 reddetti (GİB şablonu &Ouml; gibi adlı varlıklar), düzeltildi, ikinci deneme 78/78 uygun. İlk gerçek yükleme 1 fatura (GIB2026000000020, sipariş 11724731585) Trendyol kabul etti, K PDF'i kontrol etti ("çok güzel"). Kalan 77: K deneme + yükle yapacak. GitHub Secrets GIB_PORTAL_USER/PASS eklendi.
- **Fatura ürün adı** (`invoiceItemName`): Trendyol satır adındaki model kodu + ", beden" atılır, kayıtlı ilan başlığı öncelikli. Yalnızca yeni taslaklar (imzalı 84 değişmez).
- **Fatura PDF**: panelde "Faturayı aç / PDF" (GİB görünümü, yazdır -> PDF, dosya adı alıcı adı ASCII küçük harf), "Hepsiburada faturaları" filtresi (HB 6 faturayı K elle indirecek).
- **Elle değişiklik koruması** (migration 074, `worker/core/holds.ts`, `lib/holds.ts`, `app/api/holds`, `Holds.tsx`, Telegram `hl:a|p|s:<id>`): senkron gönderdiğini saklar (sent_price/sent_qty/pushed_at); pazaryerinde elle değişen/eklenen ilan bekletilir, Telegram'dan sorulur (hepsi kalsın / fiyat kalsın stok sistemden / eşitle). Sıfırlamalar (zero_missing/zero_unlinked) da süzülür. Testler `worker/test/holds.test.ts`. **Migration 074 K çalıştıracak**, yoksa koruma kapalı (senkron eskisi gibi). Canlıda denenmedi.
- **Yeni tedarikçi (31.10 K XML + REST API verecek)**: sunucuda `worker/supplier-probe.ts <kod> [sayfa]` (XML+API, alan/doluluk/önerilen eşleme, yazmaz; toptancim ile denendi: 20.757 ürün, 42,9 MB, 17 sn). Sunucu tedarikçi zamanlayıcısı açıldı (15 dk). Koşullar: tedarikçi `runner=vps` ("Yalnızca sunucudan oku") **ve nightly açık** olmalı (import-xml vps yalnızca nightly okur), eşleme yapılmalı; API anahtarı `/etc/trentakip/env` (SUPPLIER_SECRETS ya da auth.secret_env adı).
- **Supabase yeri RİSKİ**: 299 MB / 500; 28 bin ürün = 155 MB ürün tabloları -> 40 bin ürün ~+220 MB = sınırı aşar. Yarın: önce yalnızca inceleme; içe aktarma ya tek XML ile (ölç) ya da VPS geçişi öne alınarak.

## 2026-10-30 (56) — e-Arşiv: ilk toplu kesim tamam (84 fatura)
- 84 açık siparişin (78 Trendyol + 6 HB) faturası sistem taslağıyla kesildi, K portalda imzaladı; "İmzalananları kontrol et" 84'ü `signed` yaptı, faturasız açık sipariş 0.
- Hata: sync 60 günlük portal listesi boş döndüğü için 84 taslağı "bulunamadı/silindi" işaretlemişti (SQL ile geri alındı). Düzeltme b535edd: liste gün gün (son 14 gün + kayıt günleri), listede olmayan taslağa dokunulmaz (yalnızca portal "silinmiş" derse), elle oluşturulmuş imzasız taslak da MÜKERRER işaretlenir.
- K'nın elle açtığı 7 taslak (012-018) bizim taslaklarla aynı siparişlerdi; K indirimi hesaplamamıştı, bizimkiler (satıcı indirimi düşülmüş) kullanıldı; K kendi 7 taslağını silecek (silindiği doğrulanmadı).
- Sıradaki: imzalı faturaları Trendyol'a yükleme (PDF + seller-invoice-file, önce dry-run, K onayı).

## 2026-10-30 (55) — e-Arşiv fatura taslakları (GİB portalı)
- K ~50 faturayı GİB e-Arşiv portalından tek tek kesiyordu (e-imza yok, SMS onaylı). Yeni: panel Siparişler → "Faturalar (e-Arşiv)" (yalnızca admin): son 60 gün açık siparişler, seçilenlere portalda TASLAK (25'erli, sırayla), K portalda taslakları seçip tek SMS ile toplu imzalar, "İmzalananları kontrol et" durumu okur. **Sistem imzalamaz** (SMS/HSM komutu yok, testte doğrulanır).
- `lib/invoice-build.ts` (saf: tutar = satış geliri = müşteri + Trendyol indirimi, KDV ürün oranıyla içinden, alıcı TC 11111111111 (K onayı), ad/soyad, adres, sipariş no/tarih, yazıyla tutar), `lib/earsiv.ts` (giriş anologin, dispatch, EARSIV_PORTAL_FATURA_OLUSTUR / RG_BASITFATURA, ETTN önce/sonra listesi farkından, liste, çıkış; biçimler açık kaynak f/fatura MIT Ağustos 2026'dan), `app/api/invoices` (kilit: order_invoices birincil anahtarı, çift taslak yok), `app/_components/Invoices.tsx`. **Migration 072** `order_invoices` (K çalıştıracak). Vercel: `GIB_PORTAL_USER`, `GIB_PORTAL_PASS` (K ekledi, doğrulandı; isteğe bağlı `GIB_PORTAL_ENV=TEST`).
- Test `tests/invoice.test.ts` (4; sahte portal). **Canlıda denenmedi**: ilk deneme 1 siparişle, taslak portalda kontrol edilecek (imzalanmamış taslak yasal fatura değil, silinebilir). 30 günden eski siparişte alıcı bilgisi silinmiş (KVKK) → elle. Trendyol'a fatura yükleme sonraki adım.

## 2026-10-30 (54) — Zararına satış: Trendyol "Komisyon Tarifeleri" fiyatı
- K'nın ekranı: TCXBY230070 (Duplo plaka) Trendyol fiyat geçmişinde 30.10 15:39 "Ürün Komisyon Tarifeleri sayfasından ... zamanlanmış fiyat 405,37 (01.11 08:00'e kadar)", komisyon %2,70, Buybox 1. Sistemimizin fiyatı 1.279,90 (dokunmadı; kodda tarife/kampanya ucu yok). Maliyet 903,60. Siparişlerde: 405,37 ve 380,37 (Duplo) + TCXBY100960 1.191,60 (maliyet 2.236,80), toplam ~2.200 TL zarar, hepsi "ready".
- Trendyol herkese açık API'sinde komisyon tarifesi / zamanlanmış fiyatı listeleyen ya da kaldıran uç yok (developers.trendyol.com, llms.txt dahil tarandı). K panelden kaldıracak; elle kim girdi K'ya soruldu (aracı kişi riski: kullanıcı yönetimi / entegrasyonlar kontrol).
- Koruma: sipariş net kârı eksiyse `attention_reason` "ZARARINA SATIŞ ..." ve Telegram'da "🚨 ZARARINA SİPARİŞ" başlığı (önceden sıradan "Yeni sipariş" içinde tahmini net yazıyordu). Test orders.test.ts (+3).
- Buybox verisinden etkilenen ürün çıkarılamadı: listing_buybox 27-28.10 (kargo güncellemesinden önce), güncel değil.
- Sunucu: 30.10 19:37 hâlâ eski kurulum, SSH cevap yok; Cenuta 23:00 yeni node sözünü tutmadı.

## 2026-10-29 (53) — Tedarikçi taslak kaydı + "yalnızca sunucudan oku"; sunucu yenileme izlemesi
- K: yeni tedarikçi kaydedilemiyor, tedarikçi bağlantıyı reddediyor (büyük olasılıkla IP izni; Vercel/GitHub IP'leri değişken). Panel kaydı eşleme (model kodu + ürün adı) istiyordu, XML incelenemeyince kayıt olmuyordu.
- Eşlemesiz kayıt = taslak (pasif, otomatik içe aktarma kapalı); içe aktarma eşlemesi olmayan tedarikçiyi atlar. Yeni ayar "Yalnızca sunucudan oku" (`suppliers.runner = 'vps'`, **migration 071**, K çalıştıracak; yokken kayıt bozulmaz): GitHub atlar, sunucu (sabit IP 89.252.153.145) okur. Panel incelemesi IP izinli XML'i okuyamaz; eşleme sunucu çalışınca.
- Cenuta 23:00 yeni node sözü: 23:03'te hâlâ eski node (yük 28). `vps-watch.yml` artık SSH ana anahtarı değişince (yeni kurulum) Telegram'a yazar (eski node yavaş ama açık olduğundan "açık mı" yetmiyordu).

## 2026-10-29 (52) — Trendyol kargo: firma + barem + desi tarifesi (resmî tablolar)
- K'nın verdiği Trendyol anlaşmalı kargo tarifesi (05.10.2026, KDV hariç, desi 0-500) ve Akademi "Kargo Barem Destek" ekranları (10.08.2026): `kaynaklar/trendyol/kargo/` (git dışı, özet `kaynaklar/OKU.md`). Ekim kesintilerinin hepsi tablolarla kuruşu kuruşuna açıklandı (çoğu Sürat + Tablo 2 = geç / termin 1 günden uzun).
- `worker/data/trendyol/cargo.ts` (desi 0-50 × 7 firma, barem Tablo 1/2), `worker/core/trendyol-cargo.ts` (`tyShipCfg`: 350 altı barem, üstü ve 10 desi üstü paket desi; firma tanımsızsa null = sabit ayar). Sync (XML yolu + veritabanı ürünleri `shipCfg`) ve panel simülasyonu aynı hesap; her tedarikçi için geçerli (pazaryeri ayarı, ürün desisi tedarikçiden, yoksa varsayılan desi). Panel Trendyol fiyat ayarları: kargo firması + "zamanında kargolama". Migration 070 (`settings.cargo_carrier`, `cargo_fast`, `default_desi`; K çalıştıracak; yokken kayıt bozulmaz).
- Test `trendyol-cargo.test.ts` (17): Ekim'deki 57,99 / 65,49 / 102,49 / 104,49 / 110,99 / 112,49 / 106,76 / 114,66 / 213,52 tablodan birebir. Etki önizlemesi firma senaryolarıyla (`ops/price-impact.json`).
- Bulgu: tedarikçi desi verisi güvenilmez (18.576 ilanda desi=1); büyük ürünlerde gerçek kargo daha yüksek olabilir. Öneri: gerçek desiyi siparişlerin kargo kesintisinden öğrenmek (yapılmadı).

## 2026-10-29 (51) — XML içe aktarma 32 saat duruyordu (benim hatam), yedek secret'ları eksik
- Genel kontrolde: "XML içe aktarma" son 24 saatte 17/17 hata; Toptancım son başarılı 28.10 12:29 (TR). Neden: 28.10 tedarikçi REST API değişikliğinde `lib/supplier-api.ts` üstte `fast-xml-parser` içe aktarıyordu; Actions yalnızca `worker/node_modules` kurar, lib/ dosyasından paket çözülemez → `ERR_MODULE_NOT_FOUND`, betik başlamadan düşüyordu (yerelde kök node_modules olduğu için testler geçmişti). Aynı düzende yeniden üretildi.
- Düzeltme: ayrıştırıcı çağırandan (`parseXml`) ya da gerektiğinde dinamik yükleme; worker kendi XMLParser'ını verir. Koruma: `worker/test/deps.test.ts` (worker betiklerinin içe aktarma ağacında worker dışı dosyada üstte paket ya da worker'da olmayan paket = hata; düzeltmeden önceki hali yakalıyor).
- Etkisi: 32 saat Toptancım stok/fiyat güncellenmedi (pazaryerine giden stok/fiyat veritabanındaki son değerle devam etti). İlk içe aktarmadan sonra kontrol edilecek.
- Yedek: `backup.yml` her gece "SUPABASE_DB_URL2 / BACKUP_PASSPHRASE yok" ile düşüyor (K secret'ları eklemedi).

## 2026-10-29 (50) — Hepsiburada görsel "erişim problemi"; VPS yeni node
- HB 29.10 20:07: 16 ilan "İncelenecek" (aynı elle eklenen ürünün varyantları): indirilemeyen görsellerin hepsi WebP (Supabase Storage), JPG'ler sorunsuz. Dönüştürücü (wsrv.nl) şimdi aynı görselleri 0,3 sn'de çeviriyor → geçici: yalnızca ilk görsel önceden ısıtılıyordu, diğerlerini HB ilk kez çekince yetişmedi. `createProducts`: gönderilecek 5 görselin hepsi önceden ısıtılır (en fazla 1.500), hazırlanamayan ek görsel çıkarılır.
- VPS: Cenuta yükseltme sonrası node aşırı yüklü (2 vCPU'da yük 9, steal %13-31, containerd açılışta zaman aşımı); disk 50 GB (80 değil). Cenuta 29.10 23:00'te yeni node'da sıfırdan açacak. Taşıma (Supabase -> VPS) sağlıklı node doğrulanana dek bekliyor.

## 2026-10-29 (49) — Trendyol kargo modeli düzeltildi; Telegram durum asistanı
- **Kargo (K: "kargo formülünü tamamen değiştiriyoruz, daha da zarar etmeyelim"):** Ekim kesinti dökümü (18 dosya, 81 sipariş, `kesintiler/`, depo dışı): Trendyol 300 TL altı 25 siparişin hepsinde kargo kesmiş (139-199 TL: 58-65 / 104 TL; 200-300 TL: 102-112 TL; üstü 107-115 TL). Eski kural "300 altı alıcı öder" yanlıştı: maliyeti bilinen 40 siparişin 8'i KDV sonrası zararda; ceza 450 TL (2 tedarik edememe iptali, 2 büyük olasılıkla geç kargo), satıcı indirimi 899 TL. Web kaynakları çelişkili (barem 200/350, Mart 2026); değerler kendi dökümümüzden.
  Migration 069 (`settings.shipping_bands`), panel Trendyol fiyat ayarlarında "Kargo basamakları" alanı, `worker/price-impact.ts` + `price-impact.yml` (salt okunur etki önizlemesi; ilan maliyeti ürün kaydından). Önizleme: 21.765 yayındaki ilanın 2.063'ü bugünkü fiyatla gerçek kargoda zararda; yeni modelde 7.493 artış (medyan %5, 2.063'ünde %20+), sonrasında zararda 0. **K onayıyla canlıda:** `shipping_cost=115`, basamaklar 200 altı 105, 200-350 113 (SQL Editor). İlk senkron sonucu kontrol edilecek.
- **Telegram durum asistanı (K'nın GOREV_TELEGRAM_ASISTAN.md):** `lib/assistant-core.ts` (saf: kişisel veri süzgeci, TC no kontrol haneli; soru durumu üç ayrım; Gemini araç döngüsü), `lib/assistant-tools.ts` (6 salt okunur araç: genel_ozet, soru_durumu, senkron_durumu, ilan_sorunlari, siparis_durumu, is_kuyrugu; müşteri kolonları seçilmez), `lib/assistant.ts` (model sırası GEMINI_ASSISTANT_MODEL > GEMINI_MODEL > gemini-2.5-flash, 503'te yeniden deneme, 404/429'da sıradaki, gerekirse model listesi). `app/api/telegram`: soru bildirimine yanıt = cevap (eskisi gibi); diğer mesajlar asistana (`after`, Telegram'a hemen 200), `/start` yardım. Doğrulama: mevcut gizli başlık + yalnızca TELEGRAM_CHAT_ID.
  Doğrulanan: gemini-2.5-flash araç çağırma K'nın anahtarıyla (sahte araç verisiyle 4 soru: cevap durumu + neden, senkron, sipariş no, fiyat değiştir isteği reddi); testler `tests/assistant.test.ts` (6). **Canlıda doğrulanmadı:** Vercel'de `GEMINI_API_KEY` yok (K ekleyecek), gerçek veritabanı araçları canlıda denenmedi. Yazma işlemleri (onay düğmeli) sonraki aşama.
- Telegram cevap hatası: Trendyol hata gövdesindeki açıklama artık mesajın başında, 1000 karaktere kadar saklanıyor (29.10 sorusu "400 BusinessRuleException" ama neden kesilmişti).

## 2026-10-29 (48) — Telegram'dan yazılan cevaplar sisteme ulaşmıyordu
- K: "Telegram'dan cevaplıyorum, sisteme gitmiyor". Kanıt: 27.10 09:51'den sonra hiçbir soru Telegram onayıyla kaydedilmemiş (7 soru sonradan "başka yerden cevaplandı", 29.10 sorusu "taslak"). Telegram getWebhookInfo (yeni salt okunur iş akışı `telegram-check.yml`): adres doğru, 3 mesaj bekliyor, son hata "Wrong response from the webhook: 404". Rota 404'ü yalnızca gizli başlık uyuşmayınca verir; Vercel'deki üç Telegram değişkeni 22.10'dan beri aynı → kanca Telegram'da gizli değer olmadan/farklı değerle yeniden kaydedilmiş (depoda bunu yapan başka kod yok; kim/ne yaptı bilinmiyor).
- Çözüm K'da: panel → Sorular → **Telegram'ı bağla** (kancayı doğru gizli değerle yeniden kaydeder; bekleyen 3 mesaj Telegram tarafından yeniden iletilir). Eklendi: `GET /api/telegram` (admin, getWebhookInfo özeti, jeton döndürmez) + Sorular ekranında "Telegram bağlantısı bozuk" uyarısı. Canlıda doğrulanmadı (K bağlayınca `telegram-check` yeniden çalıştırılacak: bekleyen 0, hata yok olmalı).
- Telegram durum asistanı (Gemini) görevi alındı (K'nın GOREV_TELEGRAM_ASISTAN.md), sırada.

## 2026-10-28 (47) — Yayındaki ürünü yeniden gönderme = güncelleme; aynı ürünü eklerken sor
- K: "neyi değiştirirsem onu güncellesin"; "aynı ürün varsa sor, onaylarsam güncellensin".
- Gönderim (`lib/listings-send.ts`): yayındaki ilan artık "zaten yayında" diye reddedilmez, iş kuyruğuna güncelleme olarak girer (ilan "yayında" kalır). Çift tıklama koruması ürünün düzenlenme zamanını da içerir (düzenleyip yeniden gönderim yeni iş).
- Worker (`processSendJobs`): yayındaki onaylı ilanda değişen alanlar `worker/core/content-diff.ts` ile bulunur, yalnızca onlar Trendyol `content-bulk-update` ile gider (`updateContent`: başlık / açıklama / görsel; doküman 28.10). Karşılaştırma son gönderilen içeriğin iziyle (`marketplace_listings.content_sent`, **migration 068**, K SQL Editor'de çalıştıracak); iz yoksa canlı ilanla (başlık metni, açıklama özeti, görsel sayısı). Emin olunamayan alan gönderilmez. Fiyat/stok aynı çalışmadaki senkronla. Hepsiburada'da içerik güncelleme yok (yalnızca fiyat/stok; panel mesajı söyler). Başarısızsa ilan yayında kalır, hata ilan satırında.
- Toplu ilan upsert'i kolon kümesine göre bölündü: önceden yeni ilan satırlarıyla aynı istekteki yayındaki ilanların başlık/fiyat kolonları NULL yazılıyordu (PostgREST kolon birleşimi).
- Ürün ekleme (`POST /api/products`): aynı model kodu / varyant SKU / barkod varsa 409 + mevcut ürün; panel sorar, Tamam'da mevcut ürün formdaki bilgilerle güncellenir (`update_existing`): varyantlar SKU/barkodla eşlenir, eşleşenin ve ürünün SKU'su korunur (ilan anahtarı değişmesin), formda olmayan eski varyantlar silinmez.
- Testler: `content-diff.test.ts` (12) + tüm worker testleri, birim testleri, `next build` temiz. Canlıda henüz denenmedi: ilk yeniden gönderimde Trendyol toplu sonuç (`batchCheck`) kontrol edilecek.

## 2026-10-28 (46) — Elle girilen satış fiyatı her zaman gider
- K: "fiyatı yazarsam o fiyat girsin, yazmazsam formül; ekledikten sonra zarar etse bile karışma". Önceden zarar ettiren elle fiyat yok sayılıp formül kullanılıyordu. Artık `priceFor` (worker/core/db-products.ts) formdaki "Satış fiyatı" (ve "Satış fiyatı@pazaryeri") varsa onu olduğu gibi gönderir: zararda ya da maliyet boş olsa bile. Smart politika / kademeli zam zaten uygulanmıyordu. Zarardakiler senkron özetinde `fixedLoss` sayılır (bilgi). Maliyetsiz ürün rekabet önerisine girmez.
- Ürün formundaki fiyat önizlemesi girilen fiyatı gösterir, zarardaysa kırmızı "ZARARDA, yine de bu fiyat gider". Test `worker/test/sale-price.test.ts` (7).
- Panel "Ürün istisnaları / Rekabet" elle fiyatı (product_overrides) eskisi gibi: zarar ettiriyorsa formül (değiştirilmedi).

## 2026-10-28 (45) — VPS kuruldu; Supabase'den sunucuya taşıma kiti
- Sunucu (Cenuta, 89.252.153.145, `trentakip.duckdns.org`, Ubuntu 24.04): `ops/vps/setup.sh` çalıştı (anahtarla giriş, şifreli giriş kapalı, ufw, fail2ban, swap, Node 24, pg 17 istemcisi). `/etc/trentakip/env` K doldurdu, değer yazdırmadan doğrulandı (Supabase 26.056 ürün, GitHub 200, Telegram ok). `trentakip-dispatch.timer` açık, ilk tetikleme Trendyol + HB'yi başlattı. GitHub cron 1 gün daha açık (çift tetikleme sıraya girer), sonra kapanır. `supplier-vps.timer` sunucudan okunacak tedarikçi gelince.
- SSH "banner timeout" nedeni: 1 CPU'da ilk açılış güncellemeleri işlemciyi dolduruyordu (load 4-5, %60 nice). K 2 CPU / 4 GB yükseltmesini istedi (disk 48 GB kalır); 28.10 akşamı henüz yansımadı.
- K kararı: 150 bin ürün hedefi, Supabase ücretsiz 500 MB'a sığmaz (26 bin = 218 MB) → tamamen sunucuya, 7 gün deneme. Kit `ops/vps/db/` + `docs/VPS_TASIMA.md`: Supabase ile aynı sürümler (Postgres 17.11, PostgREST 14.18, GoTrue v2.197.0) + küçük görsel deposu + Caddy HTTPS; kod değişmez, geçişte yalnızca adres/anahtar. `mirror.sh` Supabase'den okuyarak kopyalar, satır sayılarını karşılaştırır. Görsel deposu yerelde denendi (yetki, üzerine yazma, yol kaçışı, tür, supabase-js yükleme). Sunucuda henüz kurulmadı: `SUPABASE_DB_URL` bekleniyor.

## 2026-10-28 (44) — Ürün araştırması (deneme, varsayılan kapalı)
- K: aynı ürünü bul, oradaki bilgiyi (ör. soru-cevaptaki ölçü) al, kendi cümlemizle ekle. Toptancım'da gerçek barkod yok (26.104 varyantın 0'ı), eşleşme fotoğraf + başlık + görsel dosya adı ipucuyla.
- `worker/core/research.ts`: arama (gemini-2.5-flash + google_search + url_context) → aynı ürün mü (fotoğraf karşılaştırma; ilan fotoğrafı inmezse sayfa okuyarak) → alıntı sayfada mı → kabul kuralları (`acceptFacts`: yalnızca ölçülebilir bilgi türleri, sayı alıntıda, iki ilan çelişirse atılır, garanti/fiyat/kargo/stok/kod alınmaz). Başka ilanın markası açıklamaya giremez (desc-check `forbidden`). Migration 067'ye `facts`, `research` kolonları (067 henüz uygulanmamıştı). Deneme aracı `worker/desc-try.ts` (veritabanına yazmaz).
- Canlı deneme (K'nın anahtarı): google_search yalnızca 2.5-flash'ta açık (3.5/3.6: 429). İlk denemede Trendyol'da aynı görünen ürün ve soru-cevap bilgileri bulundu; ama Trendyol ürün sayfaları Google sayfa okuyucusuna kapalı (URL_RETRIEVAL_STATUS_ERROR), doğrudan indirme 403 → bilgiler bağımsız doğrulanamadı, sistem hiçbirini kullanmadı (doğru davranış). Ürün başına 2-5 dk, araçlı ücretsiz kota birkaç denemede doldu. **Varsayılan kapalı (RESEARCH=1 açar); nasıl devam edileceği K kararı.**

## 2026-10-28 (43) — Yapay zekâ ile açıklama düzeltme (onaylı)
- K: "yapay zekâ %100 düzeltebilirse açıklamaları düzgün yazsın". Akış: taslak (yalnızca tedarikçi metnindeki bilgi; yazım, düzen, madde listesi; kod/iletişim/fiyat/kargo sözleri çıkar) → kurallı kontrol `worker/core/desc-check.ts` (kaynakta olmayan sayı, model kodu, iddia: orijinal/garanti/%100/su geçirmez/sağlık/kargo/indirim..., iletişim, izinsiz HTML, marka riski, yasaklı kelime, bilgi kaybı) → ikinci çağrı doğrulama (dayanaksız tek ifade = taslak yok). Geçemeyen "Yazılamayan" + neden; ürün tedarikçi metniyle kalır.
- Migration 067 `product_descriptions` + `desc_candidates` (sunucu tarafında aday seçimi, Trendyol'da satıştakiler önce) + `desc_counts`. **K SQL Editor'de çalıştıracak**; yokken her şey sessizce eski davranışta.
- Saatlik `.github/workflows/descriptions.yml` (10 ürün/çalışma, ürün başına 2 Gemini isteği; soru taslaklarıyla aynı kota). Panel: Katalog → **Açıklamalar** (tedarikçi metni / düzeltilmiş yan yana, seç-onayla, hepsini onayla (sayı değiştiyse reddeder), reddet, geri al, düzenle: elle düzenleme de aynı kurallardan geçer). Onaylanan: yeni gönderimlerde kullanılır; canlı Trendyol ilanına senkronda `content-bulk-update` (contentId + description; dokümanla doğrulandı), ilk turlarda en fazla 20 (`DESC_PUSH_LIMIT`): Trendyol'un içerik güncellemesini onaya alıp almadığı canlıda görülecek. products.description değişmez. HB canlı ilan açıklaması güncellenmez (yalnızca yeni gönderim).
- Testler: desc-check (17). Ön koşul: Toptancım eşlemesi (`ops/fix-toptancim-mapping.sql`); şu an açıklamaların %99'u başlığın kopyası, aday yok.

## 2026-10-28 (42) — Tedarikçi REST API, VPS kurulum kiti, Toptancım açıklama/kategori eşlemesi
- **Toptancım eşlemesi gerilemiş** (veritabanı yeniden kurulunca 22.10 öncesine döndü): açıklama XML `description` (26.040/26.052 üründe başlığın kopyası), kategori `main_category` (yalnızca ana kategori). XML'de `detail` %100 dolu, ort. ~480 karakter; `category` tam yol (salt okunur XML alan denetimi `worker/xml-fields.ts`, sonuç GitHub annotation). Düzeltme SQL'i `ops/fix-toptancim-mapping.sql` (MCP izni reddedildi, **K SQL Editor'de çalıştıracak**). Satıştaki ilanların pazaryeri açıklaması bundan etkilenmez.
- **REST API tedarikçi** (`lib/supplier-api.ts`): sayfalama none/page/offset/cursor/next_url, kimlik none/bearer/header/query/basic/oauth2, XML ya da JSON yanıt, 429/5xx yeniden deneme, aynı sayfa tekrarında durma, sayfa sınırında hata (eksik okuma stok sıfırlatmaz). Ayar `suppliers.feeds[]` içinde (`type: "api"`, migration gerekmez); panelden doğrulama (`sanitizeApiSource`, anahtar başlığa yazılamaz, boş gizli alan kayıtlıyı korur), gizli alanlar panele gönderilmez. Panel: Tedarikçiler → Ek link → REST API (JSON ayar, maskeli anahtar, "Test et (ilk 3 sayfa)"), yalnızca API'li tedarikçi (ana XML boş). Anahtarlar ortam değişkeninden: tek GitHub Secret `SUPPLIER_SECRETS` (AD=değer satırları) / VPS `/etc/trentakip/env`. IP izinli API: `runner: "vps"` → GitHub atlar, yalnızca sunucu okur (`import-xml.ts vps`). `safeFetch` POST desteği. Testler `tests/supplier-api.test.ts` (12). Kılavuz `docs/TEDARIKCI_API.md`.
- **VPS kiti** (`ops/vps/`): `setup.sh` (güncelleme, otomatik yama, yalnızca anahtarla SSH — anahtar yoksa kapatmaz, ufw, fail2ban, 2 GB swap, Node 24, pg 17 istemcisi, `/opt/trentakip`, systemd), `dispatch.mjs` (senkronu tam 15 dakikada `trigger=schedule` ile başlatır: duraklatılmış otomatik senkrona uyar; `sync.yml` yeni girdi `trigger`), zamanlayıcılar: dispatch, supplier-vps, update (10 dk'da git pull). Kılavuz `docs/VPS_KURULUM.md`. 2 dakikalık sipariş kontrolü bilerek 2. aşamada (sipariş ilk kayıtta maliyetini sabitliyor).
- Doğrulandı: 33 birim + worker testleri, tsc, next build, betik sözdizimi. Canlıda denenmedi: API tedarikçisi yok (yarın), VPS kurulmadı.

## 2026-10-28 (41) — Unutulanlar denetimi: 1000 satır sınırı, HB kalıcı kapanma, Gemini, yedek, kurtarma
- **Kopya kapatma eksik çalışıyordu:** `dup_listing_losers` Trendyol'da 4.576 ilan döndürüyor, worker Supabase'in 1000 satır sınırı yüzünden 1.000'ini okuyordu (`duplicateClosed` hep 1000): **3.538 kopya stoklu satışta kaldı.** Ortak `readAll` (worker/core/util.ts) ile sayfalı okuma; aynı sınır: kod kardeşleri, satış hızı, ürün istisnaları, kategori eşlemeleri, yasaklı kelime / marka riski listeleri (worker); kategoriler ekranı (1.505 satırın 505'i görünmüyordu), satış raporu CSV (`.limit(20000)` 1000'de kalıyordu), gösterge paneli, ret düzeltmeleri (panel). Okuma hatası özete (`duplicateError`).
- **HB kalıcı kapanma:** HB stoğu 0 olan ilanı `isSalable=false` döndürüyor, adaptör bunu "kapalı" sayıyordu; kapalıya stok gönderilmediği için bir kez stoğu biten ilan tedarikçide stok gelse de açılmıyordu (2.512 kapalının 2.502'si stok 0; 29'u kopya değil ve stoklu). Artık yalnızca kilit/askı/dondurma ya da stoklu iken satılamaz kapalı. **Migration 066** (kopyalar kapalı ilanları da sayar, en sona koyar) bununla birlikte gerekli: yoksa 2.358 HB kopyası bir tur stok alır. Kuru hesap: TY kapanacak açık ilan kümesi aynı (4.576), HB 2.358 kopya kapalı kalır. **066 uygulanmadı (MCP izni reddedildi), K SQL Editor'de çalıştıracak; kod ondan sonra gönderilecek.**
- **Yapay zekâ durmuştu:** Gemini 2.5 Flash / Flash-Lite 404 (soru taslağı ve özellik doldurma "gemini-2.5-flash-lite yok"). Sabit adlar 404 verirse hesabın model listesinden en yeni kararlı Flash seçilir (`pickFlashModels`, test gemini.test.ts).
- **Senkron sağlamlığı:** Trendyol okuma isteklerinde ağ hatası / 5xx / 429'da 3 deneme (27.10 tek "fetch failed" bütün senkronu düşürdü); yazmada yalnızca 429. Başarısız toplu isteklerin hata metni özete (`pushErrors`, TY'de "partial" nedeni hiç yazılmıyordu). 60 dk'dan eski "running" kayıtları sonraki çalışma hata olarak kapatır.
- **Marka listesi:** indirilmiyor (200 MB, 500 MB sınırı; K 25.10). Panel marka araması liste boşken canlı Trendyol ucundan (kimliksiz, önek araması; "var" kontrolü worker ile aynı birebir ad). Markalar sekmesi artık "iş akışını çalıştır" demiyor; iş akışı tahmini boyut 400 MB'ı aşarsa reddeder.
- **Kaybolan veriler (çöküş):** marka riski listesine 22.10'da eklenen kelimeler yoktu; bilinenler geri eklendi (chevrolet, hızlı ve öfkeli, fast and furious, dodge, nissan, jeep, mustang, yamaha, sahte, banknot, kabza; lotus/lincoln yanlış eşleşme riskiyle eklenmedi). Kalan ~20 kelime + kategori eşleşmeleri + istisnalar + kâr kuralları eski veritabanında: `worker/recover-old.ts` + "Eski veritabanından kurtarma" iş akışı (check/apply; yalnızca eksik satır, kurallar kapalı, elle fiyat ve komisyon boş). Eski proje ACTIVE_HEALTHY görünüyor ama bağlantı kabul etmiyor (57P03).
- **Yedek:** `.github/workflows/backup.yml` (günlük kritik tablolar, pazar tam; boş Postgres'e geri yükleyip satır sayısıyla doğrular, AES-256, Telegram uyarısı), kılavuz `docs/YEDEK.md`. **K: `SUPABASE_DB_URL2` ve `BACKUP_PASSPHRASE` secret'ları.** İlk gerçek çalışma secret'lardan sonra.
- Doğrulandı: worker + birim testleri (yeni: readAll, Gemini, HB stoksuz ilan), panel tsc, next build. Worker tip hataları değişiklik öncesiyle aynı (16, önceden var).
- Gözlem: audit_log 27.10 gecesi tek seferde 26 bin satır / 29 MB (toplu fiyat değişikliği); 30 günlük temizlik var (import-xml). Veritabanı 217 MB.

## 2026-10-28 (40) — DEVİR NOTU (yeni sohbet buradan başlar)
- **Veritabanı:** Supabase `utuwjqfcaiqlqdzzagmm` (trentakip-v2, ücretsiz, ~215 MB). Eski `xovqsjiddoituaayyhae` çöktü (disk dolu), destek talebi SU-524672; kullanılmıyor. Şema tek dosya: `supabase/full_schema.sql` (migration 002–065). GitHub Secrets: `SUPABASE_URL2` / `SUPABASE_SERVICE_ROLE_KEY2`.
- **Silme kuralı:** MCP ile DELETE/TRUNCATE ve kullanıcı onaysız toplu fiyat değişikliği otomatik reddedilir; silme içeren SQL'i kullanıcı SQL Editor'de çalıştırır.
- **VPS (beklemede, K aldı 28.10):** Türkiye, 1 CPU / 2 GB / 50 GB NVMe, haftalık yedek eklendi; aktif edilmesi bekleniyor. Plan: Ubuntu; sunucuda yalnızca Postgres + PostgREST + GoTrue (Supabase'in hafif kısmı, studio yok), zamanlayıcı (GitHub iş akışlarını tam 15 dk'da tetikler), 2 dk'da bir sipariş/soru/Telegram kontrolü, gece şifreli pg_dump (sunucu dışı, 7 gün), 2 GB swap, güvenlik duvarı, şifreyle SSH kapalı. XML/içe aktarma/senkron GitHub Actions'ta kalır (7 GB RAM). Bağlantı: K'nın bilgisayarında SSH anahtarı `~/.ssh/trentakip_vps` (açık anahtar K'ya verildi; sunucuya eklenince K IP'yi yazacak). Sonra veri taşıma, Vercel + GitHub adres/anahtar değişimi. Kâr kuralları/istisnalar/kategori eşleşmeleri VPS'ten sonra (K: 11).
- **Açık/çalışan:** duruma göre marj açık, günde en fazla %5 kademeli (settings.dynamic_margin); Toptancım kod kopyaları kapatılıyor (TY 4.576 / HB 2.356); HB bağsız ilanlara stok 0; Telegram uyarıları (iptal yalnızca gerçek durum değişikliğinde); rekabet önerileri panelde onaylı; ürün formu TY+HB zorunlu özellikleri (HB katalog iş akışıyla), satış fiyatı, renk görselleri; XML içe aktarma yalnızca değişeni yazar.
- **Bekleyen K kararları:** Royal yeniden eklenmeyecek (şimdilik; 9 bekliyor). TY'de bağsız 84 ilan (K'nın kendi ürünleri olabilir) dokunulmadı. "gezmatan" markası Trendyol'da yok (5 ilan).
- **Doğrulanacak:** kopya kapatma ve kademeli zamın ilk gerçek senkron sonuçları (sync_runs.summary.dbProducts: duplicateClosed, rampCapped, rampBaseSet); HB pushErrors.

## 2026-10-27 (39) — Telegram uyarıları, duruma göre marj açıldı, rekabet önerileri, renk görselleri
- Telegram (K: "önemli her şey"): iade talebi, müşteri iptali, kargo süresi yaklaşan/geçen, senkron sorunu, içe aktarma durdu, veritabanı 400 MB, günlük özet, günlük rekabet önerileri (worker/core/notify.ts, her olay bir kez; migration 060).
- Hatalı uyarı düzeltildi (K: "iptal dedi ama teslim edilmiş"): ilk sürüm "son 2 günde güncellenen iptalleri" bildiriyordu; veritabanı yeniden kurulunca eski iptaller yeni sanıldı (8 bildirim) ve Trendyol'un böldüğü/yeniden oluşturduğu paketler iptal sayıldı. Artık yalnızca gerçek durum değişikliği (order_events: iptal olmayan -> iptal) ve aynı siparişin başka açık paketi yoksa. Kargo uyarısı yalnızca son 6 saatte pazaryerinden okunan siparişlerde. Mevcut veriyle doğrulandı (0 yanlış iptal; 4 kargo uyarısı gerçek).
- Duruma göre marj AÇILDI, günde en fazla %5 kademeli (K onayı 27.10; migration 064 gün başı fiyatı, maliyet artışında eski kural hemen): rakip varsa %10, tek satıcı %20, veri yoksa 500 altı %20 / 500-1500 %15 / üstü %10; en az 40 TL. Önizleme: TY 14.249 ilan artar (ort. +%15), 7.497 aynı; HB 10.297 artar (ort. +%9). Geri almak: settings.dynamic_margin_active = false; kademe: dynamic_margin.ramp.
- Rekabet (K: 7): öneriler (in / artır / formüle dön) her kontrolde güncel veriyle; panelde karşılaştır-seç-onayla, onay anında güncellik kontrolü (migration 062).
- Reddedilenler (K: 8): 726 TY retten 580'i geçici görsel linki hatası; ret düzeltici artık veritabanı ilanlarını da kapsıyor, görseller yeniden gönderilir. 114 kopya (yeni kuralla gönderilmiyor), 27 marka riski, 5 marka Trendyol'da yok.
- Renk görselleri (migration 063): formda renk başına fotoğraf, o rengin tüm numaraları onunla gider.
- HB'de bağsız 873 ilana stok 0 (Royal satışta değil; migration 059 zero_unlinked).

## 2026-10-27 (38) — Kopyalar kapatıldı, HB stok takılması, değişiklik geçmişi büyümesi
- K onayı: satıştaki Toptancım kod kopyaları kapatılır (migration 057 `dup_listing_losers`): grupta stokta en ucuz ilan açık, diğerlerine her senkronda stok 0 (TY 4.576, HB 2.356 ilan). Silme yok; en ucuzun stoğu biterse sıradaki açılır.
- HB: her turda 14 bin ilanın tamamı gönderiliyordu, 5 paketten sonra hata (muhtemelen hız sınırı): ~11 bin ilanın stoğu güncellenmiyordu. Artık yalnızca değişen ilanlar (`pushOnlyChanged`), 429/5xx'te bekleyip 3 deneme, ilk hata mesajları özete (`pushErrors`).
- Değişiklik geçmişi 1,5 günde 47 MB (içe aktarma her maliyet değişikliğinde tüm varyant listesini yazıyordu; 30 günde ~900 MB, sınır 500). Otomatik işlemlerde varyant listesi/updated_* tutulmaz (migration 058); elle değişiklikler tam.
- Açık: HB'de 873, TY'de 351 ilan ürüne bağlı değil (çoğu Royal; Royal yeniden eklenmedi): stokları güncellenmiyor. Kâr marjı %10-20 seçeneği K'nın seçimini bekliyor.

## 2026-10-27 (37) — Ürün formu: tüm zorunlular (HB dahil), Gönderime hazırlık, belge
- K: "HB ayakkabıda cinsiyet istiyor ama formda yok; her pazaryerinin zorunlusu bizde de zorunlu olsun, eksiksiz panel". Neden: HB özellikleri panele hiç gelmiyordu (HB anahtarı yalnızca GitHub'da). Çözüm: "Pazaryeri kataloğu" iş akışı (`.github/workflows/catalog.yml`, `worker/catalog.ts`): kategori ağaçları (TY 3.361, HB 4.785 yaprak) günlük; panelin istediği kategori özellikleri iş kuyruğundan (`mp_attrs:<pazaryeri>`), panel iş akışını kendisi başlatır ve bekleme gösterir (~1-2 dk, sonra önbellekten anında). Vercel'de HB anahtarı varsa doğrudan.
- Doğrulandı (canlı): HB Erkek Sneakers (204249) zorunlu: Cinsiyet, Ayakkabı Numarası (varyant), Renk (varyant); TY Sneaker (975) zorunlu 7. HB değer listeleri sayfalı (renk 1000+; önce ilk 1000'de kalıyordu, panel ve gönderim).
- "Gönderime hazırlık" = temel alanlar (TY başlık ≤100, HB ≤200; görsel TY ≤8 / HB ≤5 gider; açıklama ≥30; barkod geçerli ve tekil; desi; KDV; alış fiyatı) + kategorinin zorunlu özellikleri + varyant numarası/rengi pazaryeri listesinde mi. Eksik pazaryerine gönderim yok. Hazırlık listesinden N11/ÇiçekSepeti/Amazon çıkarıldı (gönderim yok). İç kategori alanı yalnızca düzen için.
- Belge: `docs/PAZARYERI_ZORUNLU_ALANLAR.md`. Testler: hazırlık (TY/HB başlık sınırı, kategori, aynı barkod).

## 2026-10-26 (36) — Ürün formu: pazaryeri kategorisi + zorunlu özellikler, satış fiyatı, Toptancım kod kopyaları
- K: "her pazaryerinin zorunlu özellikleri formda zorunlu alan olsun". Formda Trendyol ve Hepsiburada kategorisi aranır/başlıktan önerilir; seçilen kategorinin özellikleri pazaryerinin kendi API'sinden gelir (zorunlu / varyant / değer listesi), birleşik tek alan; diğer pazaryerinin listesinde olmayan değer için o pazaryerine özel seçim ("Ad@hepsiburada"). Eksik zorunlu varsa gönderim yapılmaz (eksik olan pazaryeri atlanır, onayla). "Boşları akıllı doldur": başlıkta geçen değer / Belirtilmemiş. `lib/mp-catalog.ts`, `app/api/mp-catalog`, `MarketplaceFields.tsx`, migration 055 (önbellek). Trendyol uçları herkese açık; HB için Vercel'e HB_MERCHANT_ID / HB_USERNAME / HB_PASSWORD / HB_ENV=prod gerekir.
- Worker: formda seçilen kategori ("Trendyol kategori" / "Hepsiburada kategori") doğrudan kullanılır; "@pazaryeri" değerleri o pazaryerinde ezer.
- K: isteğe bağlı satış fiyatı ("Satış fiyatı" özelliği; boşsa formül). Hem ilk gönderimde hem stok/fiyat güncellemesinde olduğu gibi gider; zarar ettiriyorsa uygulanmaz (`worker/core/sale-price.ts`).
- K: Toptancım aynı ürünü kod sonuna -1, -2... ekleyip farklı başlıkla tekrar yayınlıyor (1.452 grup, 7.264 ürün). Tedarikçi ayarı "kod kopyaları" (migration 056, Toptancım'da açık): yeni gönderimde gövde başına yalnızca stokta olan en ucuzu. Satışta olan kopyalar (TY 5.965 ilan / 1.384 grup, HB 3.408 / 1.081) için karar K'da.
- Testler: satış fiyatı ayrıştırma (5), kod kopyası seçimi (4).

## 2026-10-26 (35) — İlan bağı, ayakkabı/varyant, tek tık iki pazaryeri
- Yeni veritabanında ilanlar ürünlere bağlı değildi (gönderimde yazılan variant_id kayboldu): stok/fiyat hiç gitmiyordu. Barkodla bağlandı (TY 23.775, HB 14.011); `listings_link` artık her senkronda barkodla da bağlar (migration 054). Sonraki çalışma: TY 21.776 ilan güncellendi, hata 0; HB ilk turda 2.500 (23 paket hız sınırı, sonraki turlarda tamamlanır).
- GitHub zamanlanmış çalışmaları atlıyor (15 dk yerine 40 dk–2,5 saat). VPS'e taşınınca zamanlı işler orada çalışacak (K: şimdilik bekliyor).
- Ürün formu: beden grupları (Giyim / Ayakkabı 35–46 / Çocuk ayakkabı 20–35), listede olmayan beden/numara ve renk serbest girilir.
- Varyant değeri pazaryeri özelliğine eş anlamlıyla yazılır (`defaultFor`: Beden = Numara = Ayakkabı Numarası = numara_variant_property; Renk = Web Color); zorunlu olmayan varyant özellikleri de (değer varsa) gönderilir; Trendyol'da renk artık önce varyanttan (başlıktan değil). Trendyol varyantları aynı productMainId (tek ürün sayfası).
- Elle girilen ürünün markası: marka listesi indirilmediği için hep mağaza markasına düşüyordu; artık ürünün markası gönderilir, Trendyol'da birebir ad yoksa ilan hatası (benzer adlı markaya düşmez).
- Tek tık: ürün detayında "(Kaydet ve) Trendyol + Hepsiburada'ya gönder", ürün listesinde toplu aynı düğme. Testler: eş anlamlı özellik (6).

## 2026-10-25 (34) — Veritabanı çöktü, yeni Supabase projesi
- Eski proje (`xovqsjiddoituaayyhae`, ücretsiz 0,5 GB) 1 GB'ı aştı; `vacuum full audit_log` disk dolu hatası verdi, Postgres kurtarma döngüsünde kaldı (pg_wal yazılamıyor). Restart işe yaramadı; destek talebi SU-524672 (ücretsiz plan, garanti yok).
- K kararı: ödeme yok, sıfırdan. Yeni ücretsiz proje **trentakip-v2** (`utuwjqfcaiqlqdzzagmm`, eu-central-1). Şema: `supabase/full_schema.sql` (schema.sql + tüm migration'lar; K SQL Editor'de çalıştırdı, 37 tablo).
- Ayarlar geri yazıldı: TY %10 / en az 40 TL net, sabit gider 14,19, iade 0,05×180, smart, max 50.000, squeeze 15, çoklu adet 40; HB sabit 17,19, kargo basamakları 43,99/75,99. auto_sync ikisinde de kapalı (ürünler yüklenince açılacak). BayilikXML kaydı pasif.
- GitHub Secrets yeni adlarla: `SUPABASE_URL2`, `SUPABASE_SERVICE_ROLE_KEY2` (iş akışları güncellendi). Vercel, Supabase entegrasyonuyla bağlandı.
- Açık: K panel kullanıcısını yeni projede açacak, tedarikçileri (Royal 4 link, Toptancım 2 link...) yeniden girecek; sonra içe aktarma, ilan senkronu, auto_sync açma. Kaybolanlar: kategori eşleşmeleri, ürün istisnaları, kâr kuralları, sipariş geçmişi.

## 2026-10-25 (33) — Royal -> HB, yeni fiyat kuralı
- K: Royal markalarını kullanma izni var; tüm ürünler Hepsiburada'ya. Tedarikçi pazaryeri markası `*` = ürünün kendi XML markası (64 marka: Royaleks 30 bin, Mudanis 7,5 bin...).
- Varyantlı ürünler: HB'de tek grup (VaryantGroupID = ürün kodu), varyantın beden/renk değeri özellik varsayılanına; "aynı başlık" koruması yalnızca ilk varyantta (önceden 2. bedenden sonrası "kopya" sayılıyordu).
- Royal içe aktarma: 200'lük toplu kayıt sorgu süresini aşıyordu -> 50'lik + zaman aşımında bölerek tekrar. 42.795 ürün yazıldı (42.649 aktif). HB'ye 427 gönderim işi (100'erli; çalışma başına ~2.500 ürün). Tek seferlik içe aktarma iş akışı: ops/import-once.txt.
- Tedarikçi içe aktarma günde bir yerine **saatte bir** (her saat :45; değişmeyen turlar Toptancım ~2 dk): stok tedarikçiyle saatlik eşit, pazaryerine 15 dakikada bir gider. Toptancım birleşik içe aktarma doğrulandı (iki link, 26.060 ürün).
- **Fiyat kuralı (K, 25.10):** net 60 TL üst sınırı kaldırıldı; satış fiyatının (KDV hariç) **en az %10'u ve en az 40 TL** net (net_margin_min, migration 050), Trendyol ve HB. Simülasyon (Trendyol 22.330): 4.296 aynı, 18.034 artar (9.059'u %5-10, 3.542'si %10-20). Sabit gider (TY 14,19 / HB 17,19) ve iade payı dahil.

## 2026-10-25 (32) — Çok linkli tedarikçi, Royal Tedarik, Gemini model sırası
- **Tedarikçide birden çok XML linki** (suppliers.feeds, migration 048): ek link başına ad, adres, isteğe bağlı SKU öneki ve alan eşlemesi; içe aktarma tüm linkleri birlikte işler (biri inmezse durur, stok sıfırlanmaz). Panel: Tedarikçiler > Düzenle > Ek XML linkleri (+ İncele). Toptancım'ın iki kaydı birleştirildi (5.678 ürün xml:toptancim2 -> xml:toptacim; eski kayıt pasif).
- **Royal Tedarik** (K, 25.10): 4 link, 42.795 ürün / 46.700 varyant (yerelde kuru çalıştırma), fiyat listPrice (KDV dahil), KDV kesirli (0.1 = %10). Kaydedildi (`royal`), gece içe aktarma açık, **pazaryeri markası boş** (marka belirlenene kadar hiçbir ürün gönderilmez). Sunucusu Cloudflare arkasında: Vercel'den (panel İncele) 403, GitHub Actions'tan iniyor (XML erişim testi iş akışı, kuru, başarılı).
- İçe aktarıcı: iç içe varyant listesi (variants.variant) her varyant ayrı satır (stok/barkod varyanttan; önceden yalnızca ilk eleman okunuyordu), name/value çiftleri renk/beden, kesirli KDV, XML pasif ürün taslak.
- Gemini teşhisi: "gemini-flash-latest" takma adı ücretsiz kotası olmayan modele gidiyordu (429 "check your plan"), bir kez 503. Model sırası: GEMINI_MODEL > 2.5 Flash > 2.5 Flash-Lite; kota/yoğunlukta sıradakine geçer. HB aday sorgusu zaman aşımı -> kısmi indeks + önce sınırla (80 ms, migration 049).
- Rekabet ilk tur: 1.971 ilan kontrol edildi, buybox 17'sinde başkasında, 3'ü kârla alınabilir.

## 2026-10-25 (31) — Gemini, Rekabet (buybox), birikmiş özellikler
- **Gemini** (`worker/core/gemini.ts`): ANTHROPIC_API_KEY yoksa yapay zekâ işleri (eksik özellik, soru taslağı) GEMINI_API_KEY ile; ücretsiz kota için istekler arası 6,5 sn, 429'da o çalışmada durur, çalışma başına 20 ürün. K: GEMINI_API_KEY Secrets'a eklendi (25.10).
- **Rekabet** (Pazaryeri > Trendyol > Rekabet, migration 046): Trendyol Ürün Buybox Kontrol (POST products/buybox-information, 10 barkod/istek) ile sıra, buybox ve 2./3. fiyat; şimdiki net ve "1 TL altına inersek" net. Çalışma başına 2.000 ilan (en eski bakılan önce). "Bu fiyata in" = elle fiyat (product_overrides); zarar ettiren elle fiyat uygulanmaz. Veritabanı ürünleri artık elle fiyat/gizle istisnalarını okuyor (önceden yalnızca eski XML akışı okuyordu).
- Birikmiş özellikler (Claude, oturumda, başlıktan kesin olanlar): HB peluş tipi 357, tıraş başlık modeli 124, kulaklık modeli 7 -> 488 ürüne yazıldı, eksiği kalmayan 376 ürün sıraya. Belirsizler Gemini'ye.
- Yanlış kategori temizliği: HB'de hâlâ kitap kategorisinde bekleyen 844 ürün ve "Metal" (karyola) kategorisine düşen 131 ürün yeniden gönderim sırasına alındı. Kategori ağacı: tek kelimelik genel yaprak adları (Metal, Çocuk, Dekorasyon...) yalnızca tedarikçi yolunda da geçerse seçilir.
- attr_fix_apply iş anahtarı özellik+değer içerir (aynı işlemde birden çok değer çakışıyordu, migration 047).

## 2026-10-25 (30) — HB kategori yolu, yapay zekâ ile özellik
- Dünkü düzeltmenin etkisi: HB canlı 10.772 -> 13.371, özellik hatası 11.144 -> 5.579; kitaptan çıkan ürünlerin bir kısmı "kategori yok"a düştü (947 -> 3.836).
- **Tedarikçi kategori yolu eşleştirici** (`buildPathMatcher`): Toptancım yolları HB ağacına benzer ("... >>> Oyuncak >>> Eğitici Oyuncak"); son adımla aynı adlı yaprak, ara kategoride başlıkla alt yaprak, yoksa "Diğer ...". Sıra: elle > eşleme > tahmin (yüksek/orta) > yol (güçlü) > başlık ağacı > ...
- **Yapay zekâ ile özellik** (`worker/core/ai-attrs.ts`, migration 045): eksik zorunlu özellik, başlık + açıklamadan, pazaryerinin değer listesinden (yalnızca listedeki değer kabul; ölçü/sayı uydurma yok; emin değilse boş -> Özellik tamamla). Ürün kaydına yazılır, eksiği kalmayan yeniden gönderilir. Çalışma başına 120 ürün, ürün başına 7 günde bir. K: GitHub Secrets'a ANTHROPIC_API_KEY (soru taslakları da bunu bekliyor; şu an 0 taslak).

## 2026-10-24 (29) — Hizmet bedeli, eksik ürün analizi, HB yanlış kategori döngüsü
- K onayı: Trendyol sabit gideri 4 -> **14,19 TL** (4 tedarikçi kargosu + 10,19 hizmet bedeli). Simülasyon (22.330 canlı ürün): ortalama +13,1 TL; 17.169 ürün +1-15, 4.954 ürün +16-30, 207 ürün +90-100 (299,90'da net 40 TL altına düştüğü için eşik üstüne çıkıyor, K kuralı net ≥ 40).
- **Gerçek komisyon doğrulandı** (24 hakediş): komisyon = oran × fiyat (KDV eklenmez, formül doğru). Fark yalnız indirimli satışta (komisyon indirim öncesi fiyattan): toplam 2.379 tahmin / 2.424 gerçek (%1,9).
- Eksik ürünler (26.409 aktif): Trendyol 22.330 canlı; kalan özellik 1.121, kopya 676 (bilerek), marka riski 461 (bilerek), Trendyol marka uyuşmazlığı reddi 437 (görsel/başlıkta başka marka, gönderilemez), kategori 416, sırada 305. HB 10.772 canlı + 1.878 HB onayında; hata 12.761 (özellik 11.144, kategori 947, kopya 645).
- **HB yanlış kategori döngüsü:** HB'deki onaylı ilanlarda kategori kaydı yok; sınıflandırıcı yalnızca hatalı ilanların tahmini kategorisinden öğreniyordu -> futbol topu/kostüm "Yazar, Basım Dili" isteyen kategoriye (60003466: 1.175 ürün, hiçbiri onaylı değil; toplam ~2.050). Örnekler artık yalnızca canlı/kapalı/onaydaki ilanlardan; HB kitapları dışlayan ağaç eşleşmesi + Trendyol kategori adı ile seçer. Hatalı ilanlar yeniden deneme ile (3.000/çalışma) yeniden kategorilenir.
- Cinsiyet çıkarımı: HB listesinde Unisex yok (Erkek/Kadın/Erkek Çocuk/Kız Çocuk); başlıkta açıkça geçene göre, cinsiyetsiz üründe keyfi seçim yok (Özellik tamamla).
- HB sipariş uçları canlıda yanıt veriyor (hepsi 200, items boş): henüz HB siparişi yok. HB claims ucu da hatasız.

## 2026-10-23 (28) — Satış raporu, iadeler, gerçek komisyon, HB siparişleri, panel hızı
- **Satış raporu** (yeni menü, migration 042 `sales_report`/`sales_kpi`): dönem (bugün, dün, 7/30 gün, bu ay, geçen ay, 3 ay, 1 yıl, özel), önceki eşit dönemle karşılaştırma, KPI (ciro, net kâr + marj, ortalama sepet, iade/iptal oranı, stopaj), kâr dökümü (satış geliri − komisyon − kargo − sabit gider − maliyet − ödenecek KDV = satış kârı − iade masrafı = net kâr), ciro/net grafiği + tablo görünümü, pazaryeri dağılımı, en çok satanlar (brüt marj), iade nedenleri, en çok iade edilenler, zarar eden siparişler, CSV (müşteri bilgisi yok). İstanbul saati.
- Sipariş başına kâr kalemleri `orders.fin` (worker): komisyon önceliği pazaryerinin siparişte bildirdiği oran > ilan oranı; beklenen iade payı düşülmez (gerçek iade ayrı); iade = −(iade maliyeti/1,2); stopaj %1 KDV hariç satıştan, kârdan düşülmez (gelir vergisinden mahsup). Maliyet sipariş anında sabit (önceki çalışmada güncel maliyet kullanılıyordu, düzeltildi). Kargo süresi geçen açık sipariş "dikkat".
- **Gerçek komisyon:** Trendyol hakediş (settlements, saatte bir 30 gün) `act_commission`; raporda tahminin yerine geçer, fark gösterilir. Not: dokümandaki örnekte commissionAmount = oran × fiyat × 1,2 — Trendyol oranı "+KDV" çıkarsa fiyat formülündeki komisyon %20 düşük kalıyor demektir; ilk hakedişlerle doğrulanacak.
- **Trendyol v2 sipariş ucu** (`/v2/orders`, 15.10'dan zorunlu; v2 hata verirse eskisi). Canlı: satır tutarları birim başına, yeni durum `ReadyToShip` (eklendi).
- **İadeler (F8):** Trendyol claims -> `claims` tablosu, siparişe bağlanır, iade nedeni siparişte. Canlı: 2 talep geldi (Beğenmedim, Vazgeçtim).
- **Hepsiburada siparişleri (F11):** OMS uçları (resmi doküman bot korumalı; açık kaynak istemcilerden) her biri ayrı denenir, sonuç `summary.orders.diag`'a (HTTP durumu, alan adları; kişisel veri yok). Sipariş kimliği = sipariş no. HB claims ucu da denenir.
- **Takip kodu (F5):** tedarikçinin takip no'su ayrı kolonda (`supplier_tracking`; pazaryeri kargo kodu her senkronda eziyordu), pazaryeri kargo kodu tedarikçi metnine eklendi, "Trendyol'a bildir" (onaylı kuyruk pending->sending->done/failed, providerCode seçimi).
- **Stok rezervasyonu (F6):** tedarikçiye verilmemiş açık siparişlerin adedi (48 saat) tüm pazaryerlerinde stoktan düşülür.
- **Panel hızı:** gösterge paneli 10 tam sayım (807 bin satırlık marka tablosu 2,5-8 sn) -> tek `dashboard_counts` (0,4 sn, migration 043); ürün listesi `updated_at desc nulls last` indeksi (4,9 sn -> 2 ms) + başlık/SKU/kategori trigram (044); marka aramasında tahmini sayı; ürün filtre özeti 10 dk önbellek. Worker ilan sayfalaması OFFSET -> anahtar sıralı (sırasız OFFSET ilan atlayabiliyordu; sayfa 0,8-5,8 sn -> 70 ms).
- Açık: HB sipariş uçlarının canlı teşhisi; ilk hakedişlerle komisyon doğrulaması; Trendyol hizmet bedeli (8,49 + KDV = 10,19 TL/sipariş, ikincil kaynak) sabit gidere eklenmeli mi (K).

## 2026-10-23 (27) — Vercel kotası, takılı kuyruk, Özellik tamamla, Telegram canlı
- Vercel Hobby işlemci kotası 3s50dk/4s: görsel dönüştürme wsrv.nl'e taşındı (denendi: percdn WebP -> 1200x1800/1200x1200 JPEG; IMAGE_CDN=self ile geri alınır). Görsel onarımı çalışma başına 300 ürün.
- Takılı kuyruk hatası: yeniden deneme iş anahtarı saate göreydi; aynı saatte ikinci çağrıda iş oluşmuyor, ilanlar işsiz "sırada" kalıyordu (HB 8.278, Trendyol 1.360). Artık önce iş, sonra ilan; Trendyol'da da açık.
- **Özellik tamamla** (Pazaryeri > Özellik tamamla, migration 041): eksik zorunlu özellik + kategori grupları (ör. Akıllı Saat > Kasa Çapı 586), pazaryerinin değer listesi (Trendyol herkese açık uçtan, HB attr_options), başlıktan öneri, seçili ürünlere tek tıkla uygula -> eksiği kalmayan hemen sıraya. Not: kategori 474'te tıraş makinesi ve oyuncak araba birlikte (yanlış kategori tahmini) — seçimle ayrılır.
- Telegram bağlandı (K). Panelde "Deneme sorusu gönder" (TEST- kimlikli, pazaryerine gitmez).

## 2026-10-23 (26) — Tedarikçiye elle sipariş (F4), Trendyol görsel onarımı, kargo/sabit gider
- K kararları: alıcı ad-soyad + adres tedarikçi siparişi için saklanır (telefon yok, biten siparişte 30 gün sonra silinir, migration 039, DB testi); Toptancım sipariş yöntemi = kendi sitesinden elle; fiyatlar KDV hariç + KDV + sipariş başı 4 TL kargo.
- Siparişler > detay: "Tedarikçiye ilet" (alıcı/adres/ürün + tedarikçi kodu, Kopyala, "Tedarikçiye sipariş verdim", takip no, not). İndirim alanları (list/discount/tyDiscount; alanlar doğrulanmadı): pazaryerinin karşıladığı indirim gelire eklenir.
- K sorusu: 446 TL'lik satışta 23 TL net neden? Hesapta komisyon ve kargonun KDV'si düşülmemişti (gerçek ~53 TL); ayrıca 23,50 TL indirim ve kargo 100 TL (sistem 90 varsayıyordu).
- Ayar (K onayı): Trendyol kargo 90 -> 100 TL, sabit gider 0 -> 4 TL (tedarikçi kargosu), HB 13,19 -> 17,19. Örnek: maliyet 238,80 -> 469,90 yerine 489,90; net kâr 40+ korunur.
- ~800 görselsiz ürün Trendyol'daymış (HB değil): Toptancım görselleri WebP, Trendyol'a doğrudan gidiyordu. Yeni ürün ve ret düzeltmesinde görseller 1200x1800 JPG dönüştürücüden (`.p.jpg`); görseli olmayan/WebP kalan onaylı ilanlara JPG görseller content-bulk-update ile gönderilir (uç dokümanla doğrulandı; 3 günde bir, migration 040). HB'den kalkan ilanlar Gönderim durumu ekranından yeniden gönderilebilir.
- QnA uçları çalışıyor (4 soru geldi, Trendyol'dan cevaplanmış). Açık (K): Telegram jetonu (sohbete yazıldı, yenilenmeli) + chat id, ANTHROPIC_API_KEY isteğe bağlı.

## 2026-10-23 (25) — Gönderim durumu ekranı, siparişler (F1-F3), müşteri soruları + Telegram (F7/F10)
- Görsel: dönüştürücü 1200x1200 kare beyaz zemin, kaynak 3 deneme, HB gönderiminde ilk görsel önceden hazırlanır (a758010). HB'de görselsiz açılmış ~800 ürün için API ile görsel güncelleme yolu bulunamadı (K: sil + yeniden gönder ya da elle).
- **Gönderim durumu** (Pazaryeri > Gönderim durumu, migration 035-036): ilan durum sayıları, HB inceleme durumu (mp_status), neden grupları (kategori/özellik/görsel/marka/kopya/pazaryeri reddi), en çok eksik özellikler, arama, sayfalama, seçilen ya da listenin tamamını yeniden gönder. HB toplu sonuçları `mp_batches`'e yazılır, her senkronda beklemeden yeniden sorulur. **Canlı (21:30 UTC):** 25 grup, 1.440 ürün: 1.430 Satışa Hazır, 4 Ürün Bilgileri Eksik, 5 FAILED. PROCESSING ürünler artık hata sayılmıyor.
- Kayıp ters eğik çizgi düzeltmeleri: garanti regex'inde backspace karakterleri (\bled\b, \bfan\b, \d+ w/v/mah), gönderilemeyenlerde kategori önerisi okuma, köşeli parantez temizliği.
- **Siparişler F1-F3** (migration 037): orders/order_lines/order_events + `order_upsert` (tekrarda kopya yok, iç durum geri gitmez, maliyet sipariş anında sabit; geri alınan transaction'da test edildi). Trendyol `fetchOrders` (salt okunur, müşteri adı/telefon/adres OKUNMAZ, yalnızca il), her senkronda 3 gün, saatte bir 14 gün. Tahmini net kâr fiyat motoruyla. Durum haritası `worker/core/order-status.ts` (bilinmeyen = Sorunlu + neden). Panel **Siparişler** (filtre, arama, detay, zaman çizelgesi, kargo süresi uyarısı). **Canlı (22:03 UTC):** 33 sipariş geldi (22 teslim, 3 kargoda, 6 iptal), 10'unda ürün XML'de yok -> "dikkat" (düzeltildi). sales_daily de ilk kez doldu (14 gün, 28 sipariş).
- **Müşteri soruları F7 + Telegram F10** (migration 038): Trendyol QnA çekme (doğrulanmadı), Claude ile cevap taslağı (`ANTHROPIC_API_KEY` varsa; "emin değil" bayrağı + not), panel **Müşteri soruları** (düzenle, onayla, yoksay, ton ayarı). Cevap YALNIZCA insan onayıyla gider: panel ya da Telegram'da "Onayla" düğmesi / bildirimi yanıtlayarak yazılan cevap; approved->sending kilidi çift gönderimi önler; telefon/e-posta/bağlantı içeren cevap reddedilir. Telegram: yeni sipariş + soru bildirimi (müşteri bilgisi yok), `/api/telegram` web kancası (gizli başlık + tek sohbet), panelden "Telegram'ı bağla".
- Advisors (security): yalnızca beklenen INFO (RLS politikasız, erişim service_role) + leaked password WARN (S0.4, K).
- Açık (K): Telegram botu + secret'lar, ANTHROPIC_API_KEY, S0.4/S0.5, KVKK (müşteri adres saklama -> F4), tedarikçi sipariş yöntemi (Toptancım) -> F4. Sıradaki (Claude): QnA ve sipariş alanlarını canlı sonuçla doğrula, F4 tedarikçiye iletme (manual/semi) K bilgisi gelince.

## 2026-10-22 (24) — Hepsiburada canlı gönderim, net kâr TL aralığı
- HB canlı: katalog yetkisi var (4.785 yaprak kategori). 5 ürün denemesi: zorunlu "Görsel1" alanı düzeltildi; WebP görseller HB'de görünmüyordu -> panel `/api/img` imzalı JPG dönüştürücü (sharp), gönderim öncesi dönüştürücü denetimi. Garanti yalnızca başlığı elektrikli/elektronik olanlarda 24 ay, diğerleri 0.
- K: sildiği 5 ürün + 1 yeni yeniden gönderildi; HB'de yalnızca 1'i (yeni barkod) eklendi. Sonuç okuma (checkBatches) HB cevap biçimini kaçırıyordu: ürün bazlı nedenler + ham cevap örneği özete yazılıyor.
- K kararı: net kâr 40-60 TL (yüzde hedefi çok pahalı yapıyordu). `netProfitMin/Max` (migration 032, Ayarlar'da alan): doluysa yüzde hedefi, kâr kuralları ve 1,3x taban yok; fiyat en az 40 TL net bırakan en ucuz x9,90. HB'de açık (40/60), mevcut ilan politikası formula. Trendyol: HB başarılı olunca aynısı (K).
- İlk toplu çalışma: 1.445 gönderildi, 1.055 yerel hata (kategori yok 520, Cinsiyet/Araç Markası/Işık Yönü, kitap kategorisi, marka riski). Düzeltmeler: HB'de marka riski listesi yok (K), kitap/dergi kategorisi eşleşmez, zorunlu özellikte genel seçenek (Unisex, Universal, Diğer), serbest metin varsayılanı.
- Özellik hafızası: Trendyol onaylı ilanlarının özellikleri ve "Trendyol kategori adı" her senkronda ürün kaydına (learnFromListings, en fazla 4.000/çalışma; 20:38'de 4.769 ürün). K: "önce bilgileri al, sonra HB'ye" -> HB işleri 75 dk ertelendi (run_after).
- Otomatik yeniden deneme: HB kuyruğu boşalınca 2 saatten eski düzeltilebilir hatalar yeniden sıraya (requeueFixable).
- HB sonuç biçimi doğrulandı: importStatus SUCCESS, productStatus "Satışa Hazır"/"Incelenecek", rejectReasonsMessages; tüm sayfalar okunur, ret ilan "rejected" + neden. HB barkodla mevcut katalog kartına eşliyor (ör. marka TCX).
- K onayı (22.10 ~20:45): Trendyol da net kâr 40-60 TL (settings.net_profit_min/max). Mevcut ilanlar smart politikayla her çalışmada en fazla %10 iner. Örnek: maliyet 500 -> 889,90 yerine 789,90; ucuz ürünlerde çoklu adet koruması (40 TL) fiyatı korur.
- Toplu: 26.403 ürün HB sırasında (265 iş, senkron başına 25 iş); HB auto_sync açık (auto_create kapalı).

## 2026-10-22 (23) — Hepsiburada kargo baremi, öğrenilen özellikler ürün kaydında, HB gönderim hazırlığı
- Araştırma (Kargonomi/EZV, 21.09.2026'dan geçerli): HB'de kargoyu **her siparişte satıcı öder**; 0–199,99 TL 43,99 + KDV, 200–399,99 TL 75,99 + KDV, 400 TL ve üstü desi tarifesi (hepsiJET 0–2 desi 81,99 + KDV), ayrıca teslimat başına hizmet bedeli 10,99 + KDV. Barem şartı: hepsiJET/Sürat, 0–1 gün kargolama, zamanında teslim ≥ %90. "300 altı müşteri 60 öder" bilgisi güncel değil.
- `worker/pricing.ts`: `shippingBands` (basamaklı kargo): her basamakta hedef fiyat, sığmazsa sınırın altı (199,90 / 399,90) "299,90 kuralı" ile denenir; basamaksız yapılandırma eskisiyle aynı. Migration 031 `marketplace_settings.shipping_bands`; panel Ayarlar'da "Kargo basamakları" alanı; API doğrulaması; testler.
- HB ayarı (UPDATE): shipping_bands 200=43,99 / 400=75,99 (KDV hariç), fixed_cost 13,19 (hizmet bedeli KDV dahil). HB hâlâ kapalı (enabled=false).
- Veritabanı ürünlerinde desi kargosu (HB): ürün desisi yoksa varsayılan desi.
- Öğrenilen bilgiler ürün kaydına: Trendyol gönderiminde başlık/açıklama/benzer ilandan bulunan özellikler `products.attributes`'a yazılır (yalnızca boş anahtarlar, elle girilen ezilmez) + "Trendyol kategori adı". Sonraki gönderimlerde ve HB'de tekrar aranmaz (ürün değeri olarak kullanılır).
- HB gönderim: kategori ağacı (get-all-categories) ile başlıktan kategori, Trendyol kategori adı ipucu; özellikler: ürün kaydı > başlık/açıklama çıkarımı > nötr; marka tedarikçi ayarından.
- Örnek HB fiyatları (komisyon %18 varsayılan): maliyet 30 → 169,90 (Trendyol 89,90), 100 → 339,90 (219,90), 300 → 669,90 (599,90). Ucuz ürünlerde HB pahalı kalır (kargo her siparişte satıcıda).
- HB komisyonu sabit değil (K, EK.4 PDF): `worker/marketplaces/hepsiburada-commission.ts` 156 satırı ana kategori / kategori / ürün grubu olarak ayırır; oran HB kategori adından (gönderimde bulunan ya da Trendyol'da öğrenilen ad), olmazsa başlıktan (yalnızca güçlü eşleşme) bulunur; ikisi farklıysa yüksek oran. Sıra: panel kategori oranı > EK.4 > varsayılan %18. Oranlar +KDV. Test: hepsiburada-commission.test.ts.
- Açık: K canlıda `hb-tool categories` ve `listings` çalıştırıp katalog yetkisini doğrulasın; sonra 20 ürünle deneme (K onayı), sonra toplu.

## 2026-10-22 (22) — Toptancım: gönderilemeyenler (16.509) için akıllı özellik ve kategori
- Durum (16:50 UTC): 8.320 Trendyol'da, 116 ret, 16.509 hiç gönderilmemiş (yerel hata): ~9.000 zorunlu özellik, ~5.000 kategori yok, ~1.200 kopya/aynı başlık.
- K kararları: garanti zorunlu kategorilerde İthalatçı Garantili + 2 Yıl (ürünler garantili ve faturalı); kategori "Trendyol gibi ada bakarak, çoğu gitsin".
- `worker/core/attr-infer.ts`: zorunlu özellik başlık/açıklamadan (var/yok anahtar kelime, mm/mAh/W/L sayı+aralık, değer adı metinde, ada göre tercih: Dil Türkçe, Yaş Grubu, Yaş, 50 Hz, 220 V, Kutu, adet/Paket İçeriği). Gerçek Trendyol değer listeleriyle 29 test. Tedarikçi varsayılanı: garanti İthalatçı/2 Yıl, "Paket İçeriği = 1 Adet" kaldırıldı (metinden).
- `worker/core/category-tree.ts`: Trendyol kategori ağacı (herkese açık uç) ile başlık eşleşmesi; sıra: elle > eşleme > tahmin yüksek/orta > ağaç (güçlü) > tahmin düşük %50+ > ağaç (zayıf). Örnek 30 başlıkta 17 eşleşme, belirgin yanlış yok.
- Çoklama koruması ilk 50 harf yerine tam başlık ve yalnızca açık ilanlar (silinmekte olan Bayilik ilanları sayılmıyordu: 522 ürün yanlış engelleniyordu).
- Trendyol retleri: başlık sonundaki tedarikçi kodu ("-XXUCZZZ...-4", marka sanılıyordu) temizlenir; model eki okunur kod ya da barkod. Yasaklı kelime listesine toplu alım/toplu alımlarda/fm/star master; "sahte", "banknot", "kabza" geçen ürün hiç gönderilmez (silmek ürünü yanıltıcı yapardı).
- Yeniden sıraya: 76 iş (~15.000 ürün, job 236-311).
- Açık: sonuç ölçümü (özellik/kategori kalan hatalar), Trendyol "kategori yanlış" revizeleri (Reddedilenler'den), görsel boyutu retleri (tedarikçi webp).

## 2026-10-22 (21) — Denetim S1/S2 düzeltmeleri, ürün vitrini, toplu gönderim takibi (K uyurken, onaysız yapılabilenler)
- Güvenlik: S1.1 workflow enjeksiyonu (girdiler env, argüman doğrulama), S1.2 maliyetli CSV artifact kaldırıldı + maskeleme yardımcıları, S1.3 doğrulanmamış e-posta reddi + tek admin istemcisi, S1.4 kilit dosyaları + npm ci + actions SHA + Dependabot, S2.1 SSRF korumalı safeFetch (DNS + iç ağ + yönlendirme + boyut), S2.2 güvenlik başlıkları + CSP rapor modu, S2.3 feed (atomik sayaç 030, CDN önbellek, alış fiyatı uyarısı), S2.4 dahili HTTP çağrısı kaldırıldı, S2.5 genel hata mesajları, S2.6 CSV formül koruması. CI (tsc + build + test) eklendi, Linux'ta yeşil. Testler: worker tümü + 21 birim testi geçti; next build temiz.
- Panel: **Ürünler → Vitrin** (varsayılan): büyük görsel, büyük satış fiyatı (Trendyol ilan fiyatı; yoksa ayarlar + akıllı kârla "tahmini"), net kâr rozeti (40 TL altı turuncu), alış, stok, tükendi/son N, ilan durumu; sıralama (yeni, fiyat yüksek/düşük, ad); Liste görünümü korunur. Tarayıcı testi: masaüstü/telefon/gece, yatay taşma ve konsol hatası yok. Migration 029 (indeksler).
- Gönderilemeyenler: kategori bulunamayanlarda sistemin tahmini "öneri" olarak yazılır ve formda önceden seçilir (otomatik gönderilmez; düşük güven). 1.560 kategori hatası öneri üretmek için yeniden sıraya alındı (job 159).
- Toptancım varsayılan özellik: "Paket İçeriği = 1 Adet", Menşei alternatifleri genişletildi; bu iki hatayla kalan 105 ürün yeniden sırada (job 158).
- Marka riski listesine 30 kelime (chevrolet, hızlı ve öfkeli/fast and furious, dodge, nissan, jeep, mustang, yamaha...). Bunlardan hiçbiri gönderilmemişti. Not: "lotus", "lincoln" yanlış pozitif verebilir (panel → Markalar'dan çıkarılabilir).
- Toplu gönderim (23:35 UTC): 2.099 gönderildi, 1.285 hata, 22.919 sırada (109 iş, senkron başına 25 iş, ~5 senkron). Hata dağılımı: kategori yok ~1.000 (geniş tedarikçi kategorileri), zorunlu özellik (Boyut/Ebat, Çalışma Tipi, Model, Araç Marka/Model...), ucuz kopya 87, aynı başlık 36.
- BayilikXML: Trendyol'da 18.090 arşivde (25 saat dolunca 22.10 ~19:15 UTC otomatik silinir), 2.654 silindi. Amazon 17 ilan (Amazon kapalı, bekliyor).
- BayilikXML ürünleri (17.000) veritabanında arşive alındı (silme değil, geri alınabilir: status=active); tedarikçi kaydı ve adresi duruyor. Ürünler ekranı varsayılan filtre "Aktif".
- Açık: S0.4/S0.5/S2.7 silme/S2.8 (K), S3.1 ikinci tur, toplu gönderimin sonucu ve Tcx onay/ret oranı, Faz 6.

## 2026-10-22 (20) — Toptancım toplu gönderim
- Deneme: 39 ürünün yalnız 2'si gitti; 37'si Trendyol zorunlu özelliği (Menşei, garanti, Tip...) yüzünden adaptörde atlanmış ama tabloda "sent" kalmıştı (hata düzeltildi: atlananlar ürün bazında error + neden). Kategori eşlemesinde `attributes` nesne yazılmıştı ("object is not iterable"), düzeltildi.
- K kararları: Menşei = TR (uyarı verildi), garanti yok -> "Garanti Yok|0"; aynı ürünün (aynı başlık + aynı görsel kökü) yalnızca en ucuzu (603 grup, 647 elenir); aynı başlıklı farklı modellere başlık sonuna model kodu. Açıklama: XML `detail` eşlendi (önceden kısa `description`). Toptancım 352 alt kategorisi ad eşleşmesiyle `category_map`'e (komisyon: kategorideki en yüksek); geniş 188 kategori eşlenmedi (ürün başına tahmin).
- `suppliers.default_attributes` (migration 026; denetim hijyeni 029'a kaydı), `marketplace_brand` = Tcx. HB ve Amazon panelde kapatıldı (K: yalnız Trendyol). Toplu gönderim: 26.254 ürün, 132 iş (200'lük), senkron başına 25 iş (`SEND_JOBS_PER_RUN`).
- Panel: Trendyol → **Gönderilemeyenler** (eksik özellik/kategori elle, "Kaydet ve gönder" = ürün özelliklerine yazar + iş + senkron başlatır). Ürün özelliği "Trendyol kategori" = elle kategori.
- Açık: toplu gönderim sonuçları, Tcx onay/ret, 39 ürünün kısa açıklamalarını güncelleme, denetim S0.3-S0.5 ve S1.

## 2026-10-22 (19) — Güvenlik S0, Toptancım ilk gönderim denemesi
- S0.1 kanıt: anon anahtarla `tmp_profit` 200 + veri (maliyet/kâr sızıntısı, 19.10 analiz görünümü). S0.2 (K onayı): migration 025, `security_invoker` + anon/authenticated yetkileri ve varsayılan yetkiler geri alındı. Sonrası: 7 tablo/görünüm anon ile 401 (42501).
- Toptancım: pazaryeri markası `Tcx` (K kararı, yetki belgesi henüz yok, deneme), 50 ürün kuyruğa (job 22) + 1 eski (job 18), Trendyol `sales_paused` kapatıldı (K: önce Toptancım ürünleri, sonra TODO). İlk deneme: 0 gönderim, 48 hata: 47 "kategori yok" (tedarikçi eşlemesi XML `main_category` -> yalnızca "Elektronik" gibi ana kategori), 3 zorunlu özellik (Garanti Süresi, Menşei, Frekans). Düzeltme: eşleme `category` (tam yol); sınıflandırıcı örnekleri ilan tablosunda Trendyol kategori adıyla. 15 dk tedarikçi içe aktarma adımı canlıda çalışıyor (import_jobs 8-10, "zamanlı-senkron").

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
