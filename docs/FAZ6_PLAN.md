# Faz 6 — Operasyon merkezi: sipariş, tedarikçiye iletme, müşteri iletişimi, iade ve kâr

Durum işaretleri: `[ ]` bekliyor · `[~]` devam · `[x]` bitti · `(K)` kullanıcı işi/onayı gerekir · `(D)` dış doğrulama gerekir (resmi doküman/tedarikçi cevabı).
**Önkoşul: `docs/DENETIM_GOREVLERI.md` S0 ve S1 bitmeden F2'ye (gerçek sipariş verisi) geçilmez** (açık veri yetkileri, herkese açık repo/artifact kararı, e-posta doğrulaması, bağımlılık sabitleme).
Son güncelleme: 21.10.2026. Bu dosya `docs/TODO.md` içindeki F bölümünün ayrıntısıdır. İş bittikçe **burada ve TODO.md'de** işaretle, ayrıntıyı `docs/PROGRESS.md`'ye yaz.

## Hedef (kullanıcının tarifi)

Tek panelde: tüm pazaryerlerinden gelen siparişi gör → sistem siparişi **ilgili tedarikçiye tedarikçinin kabul ettiği yöntemle** ilet (kimi API, kimi e-posta/mesaj, kimi yarı otomatik) → takip kodunu pazaryerine geri bildir → müşteri sorularına/yorumlarına yapay zeka destekli cevap önerisi üret → hangi ürün/kategori çok satıyor, hangisinden çok iade geliyor izle → gerçek kârı hesapla (tedarikçiye giden para, komisyon, kargo, KDV, iade düşülmüş).

## Başlangıç durumu (repo okundu, 21.10.2026)

- Var: Trendyol (canlı), Hepsiburada (SIT), Amazon TR (bağlı) adaptörleri, `jobs` kuyruğu (idempotent, kilitli, yeniden denemeli), `marketplace_listings`, `suppliers`, `products/product_variants` (`reserved` alanı hazır), `audit_log`, rol sistemi (viewer/editor/admin), akıllı kâr/fiyat motoru, panel v2 (telefon uyumlu), Playwright denetimi.
- Yok: sipariş tablosu, sipariş çekme (hiçbir adaptörde), tedarikçi sipariş yöntemi alanları, soru/yorum/iade verisi, gerçek satış raporları, bildirimler.
- **Dikkat:** `sales_paused` Trendyol'da açık (20.10). Açıkken senkron stok 0 gönderir; yeni sipariş gelmez ama daha önce gelmiş paketler akmaya devam eder. Faz 6 testlerinde bunu bil. Satışı açmadan önce F0–F5 çalışıyor olmalı.
- Mevcut `Marketplace` arayüzü (`worker/marketplaces/types.ts`) yalnızca ilan/stok/fiyat bilir. Sipariş için **isteğe bağlı yeni metotlar** eklenir (mevcut desen: `checkBatches?`, `updateRejected?`), mevcut adaptörler bozulmaz.

## Tasarım ilkeleri

1. **Para ve müşteri verisi dokunan her şey iki aşamalıdır:** hazırla → onayla → gönder. Tam otomatik gönderim varsayılan **kapalı**, tedarikçi bazında ve tutar eşiğiyle açılır (F4).
2. **Idempotency:** aynı siparişten tedarikçiye ikinci sipariş çıkamaz (`supplier_orders.idempotency_key` = `order_id:supplier_id:attempt_group`). Webhook iki kez gelse de, Actions iki kez çalışsa da tek kayıt.
3. **Webhook + periyodik çekme birlikte** (Trendyol da böyle öneriyor): webhook anlık, periyodik çekme kaçanı yakalar. İkisi aynı `upsert` fonksiyonunu kullanır.
4. **Kâr, sipariş anındaki maliyetle hesaplanır** (`cost_snapshot`). Sonradan XML fiyatı değişse geçmiş kâr bozulmaz.
5. **Her dış çağrı hata mesajı üretir ve kaydeder** (`last_error`, `order_events`). Sessiz başarısızlık yok; panelde "Dikkat gerektirenler" kutusu.
6. **Müşteri verisi (ad, telefon, adres)** loglara, artifact'lara, hata mesajlarına yazılmaz. Tabloda RLS açık, yalnızca sunucu `service_role`. Saklama süresi ayarı (F12). Panel API'si rol ister (viewer görmez, editor+ görür).
7. **Yapay zeka cevabı kendiliğinden gönderilmez.** Öneri üretir, insan düzenler ve onaylar. (Soru-cevapta yanlış söz verme riski.)
8. **Her görev küçük dilim:** migration + API + ekran + test birlikte, sonra işaretle (`docs/CALISMA_KURALLARI.md`).

## Veri modeli (migration 027 ve sonrası; her biri `if not exists`, RLS açık)

| Tablo | Alanlar (özet) |
|---|---|
| `orders` | `id`, `marketplace`, `order_no`, `package_id` (benzersiz: `marketplace,package_id`), `status` (iç: `new, ready, sent_to_supplier, shipped, delivered, cancelled, returned, problem`), `marketplace_status`, `customer_name`, `customer_phone`, `address` (jsonb), `total`, `currency`, `ordered_at`, `ship_deadline`, `cargo_provider`, `tracking_no`, `raw` (jsonb, kişisel veri maskeli), `needs_attention` (bool), `attention_reason`, `created_at`, `updated_at` |
| `order_lines` | `order_id`, `listing_key`, `variant_id`, `product_id`, `supplier_id`, `qty`, `sale_price` (KDV dahil), `commission_rate`, `commission_amount`, `vat_rate`, `cost_snapshot` (tedarikçi birim maliyeti, sipariş anı), `shipping_cost_snapshot` |
| `supplier_orders` | `id`, `order_id`, `supplier_id`, `method` (`api, email, manual, semi`), `status` (`draft, ready, awaiting_approval, sent, confirmed, shipped, delivered, failed, cancelled`), `payload` (jsonb), `response` (jsonb), `tracking_no`, `carrier`, `sent_at`, `confirmed_at`, `idempotency_key` (unique), `attempts`, `last_error`, `approved_by` |
| `order_events` | `order_id`, `at`, `kind`, `actor` (`system, webhook, sync, <email>`), `detail` (jsonb). Zaman çizelgesi ve denetim |
| `suppliers` (genişler) | `order_method`, `order_email`, `order_email_template`, `order_api` (jsonb: uç adres, başlık adı; **anahtarlar Secrets'ta, burada yalnızca env adı**), `auto_send` (bool, varsayılan false), `auto_send_max_total` (TL), `min_margin_for_auto` (TL), `order_notes` |
| `inbox_items` | `marketplace`, `kind` (`question, review, return_message`), `external_id` (benzersiz), `product_ref`, `customer_ref`, `text`, `asked_at`, `status` (`new, drafted, answered, ignored`), `ai_draft`, `final_answer`, `answered_by`, `answered_at`, `tone_flags` |
| `returns` | `marketplace`, `claim_id` (benzersiz), `order_id`, `line_id`, `reason_code`, `reason_text`, `status`, `return_shipping_cost`, `refund_amount`, `supplier_accepted` (bool/null), `supplier_credit` (TL), `created_at` |
| `daily_stats` (view/materialized) | gün × pazaryeri × ürün/kategori/tedarikçi: adet, ciro, komisyon, kargo, maliyet, iade adedi, net kâr |
| `notification_rules`, `notifications` | olay türü, kanal (`telegram, email, panel`), eşik, son gönderim |

Zorunlu fonksiyonlar (transaction): `order_upsert(payload)` (idempotent, çizgileri ve olayı birlikte yazar), `supplier_order_prepare(order_id)`, `supplier_order_mark(id, status, ...)`, `stock_reserve(order_id)` / `stock_release(order_id)`.

## Aşamalar

### F0 — Önkoşullar ve doğrulamalar (kod yazmadan önce)
- [ ] (K) Trendyol API anahtarında **sipariş** yetkisi var mı? Test: `getShipmentPackages` ile boş/gerçek liste. Test siparişi servisi (`createTestOrder`) satıcı için açık mı? (D)
- [ ] (K) Tedarikçi başına sipariş yöntemini öğren ve `docs/TEDARIKCILER.md` tablosuna yaz: **Toptancım** (güncel tedarikçi; BayilikXML bırakıldı) ve diğerleri — API var mı (uç adres, kimlik, örnek istek), e-posta mı, panel mi, toplu dosya yükleme mi, onay/kargo bildirimi nasıl geliyor, minimum tutar, iptal kuralı. **Bu tablo F4 tasarımını belirler.** (Tedarikçi değiştiği için önce Toptancım'ın sipariş yöntemi sorulmalı; BayilikXML için de araştırmada açık sipariş API bilgisi bulunamamıştı.)
- [ ] (D) Trendyol dokümanından: sipariş paketleri statü listesi, `getShipmentPackagesStream`, webhook statü seti, `updateTrackingNumber`, `updatePackage`, iade (claims) servisi, müşteri soruları servisi. Yorum (ürün değerlendirmesi) için servis var mı? Yoksa kapsam dışı bırak, sadece soru + iade mesajı.
- [ ] (K) KVKK: müşteri adres/telefon saklama ve tedarikçiye iletme için aydınlatma metni/sözleşme durumu. Saklama süresi kararı.
- [ ] (K) Telegram bot veya bildirim e-postası seçimi (F10).
- [ ] Çıktı: `docs/TEDARIKCILER.md` ve F0 sonuçları `PROGRESS.md`'de.

### F1 — Veri modeli
- [ ] Migration 027: `orders`, `order_lines`, `order_events`, `supplier_orders` + indeksler (`orders(marketplace, ordered_at desc)`, `orders(status)`, `supplier_orders(status)`), RLS açık.
- [ ] Migration 028: `suppliers` genişletme, `order_upsert` ve diğer fonksiyonlar. Geri alınan transaction içinde test (oluştur, tekrar gönder = tek kayıt, hatalı satır).
- [ ] Supabase güvenlik/performans advisors çalıştır, sonucu PROGRESS'e yaz.
- Bitti sayılır: `npm test` + DB fonksiyon testleri geçti, advisors temiz.

### F2 — Trendyol siparişlerini çekme
- [ ] `Marketplace` arayüzüne isteğe bağlı: `fetchOrders?(since)`, `updateTracking?(packageId, carrier, trackingNo)`, `updateOrderStatus?`. Trendyol adaptörü uygular (`worker/marketplaces/trendyol.ts`); `getShipmentPackagesStream` ile tarama.
- [ ] `worker/orders.ts`: periyodik çekme (sync.yml'de ürün senkronundan sonra, 15 dk) → `order_upsert`. Son çekim zamanı `settings`'te. Önizleme modunda yazmaz.
- [ ] `app/api/webhooks/trendyol/route.ts`: Basic veya API key doğrulama (sabit zamanlı karşılaştırma), kısa yanıt, işi `jobs`'a at (`ingest_order`), hemen 200 dön. Uç adres "Trendyol/Dolap/Localhost" kelimesi içermemeli. Satıcı başına en fazla 15 webhook. (D) Webhook kaydı `(K)`.
- [ ] Statü haritası tek dosyada: `worker/core/order-status.ts` (pazaryeri statüsü → iç statü). Bilinmeyen statü `problem` + uyarı, asla yutulmaz.
- [ ] Test: sahte pazaryeri (`worker/test/mock.mjs` desenini genişlet): aynı paket iki kez, statü ilerlemesi, iptal, çok satırlı sipariş.
- Bitti sayılır: test siparişi (Trendyol test ortamı veya `createTestOrder`) panelde görünüyor, tekrar çekmede çoğalmıyor.

### F3 — Siparişler ekranı (panel)
- [ ] `Pazaryerleri` yanında üst menüde **Siparişler** (hash: `#/siparisler`, `#/siparisler/<id>`).
- [ ] Liste: pazaryeri/statü/tedarikçi/tarih filtreleri, arama (sipariş no, ürün), "Dikkat gerektirenler" üstte, sayfalama. Telefonda kart.
- [ ] Detay: ürün satırları, müşteri bilgisi (rol kontrollü), zaman çizelgesi (`order_events`), tedarikçi sipariş durumu, kâr özeti (sipariş anı maliyetiyle), kargo son tarihi geri sayımı.
- [ ] Her düğme: yükleniyor/başarı/hata durumu; kapalıysa nedeni yazar. Playwright ile her düğme tıklanıp beklenen API isteği doğrulanır.
- Bitti sayılır: 390 px ve masaüstü, gece/gündüz, konsol hatası yok, yatay taşma yok.

### F4 — Tedarikçi sipariş motoru (çekirdek)
Yöntem adaptörleri (`worker/suppliers/`): ortak arayüz `SupplierOrderMethod { prepare(order): Payload; send(payload): Result; parseReply?(raw): Update }`.
- [ ] **manual (tek tık, ilk teslim):** sipariş kartında "Tedarikçiye ilet": tedarikçinin istediği formatta metin/CSV hazırlanır, **kopyala** ve **indir** düğmeleri; kullanıcı tedarikçi paneline yapıştırır, "Verildi" der → `sent`, zaman damgası + kim.
- [ ] **email:** şablonlu e-posta (Resend/SMTP; anahtar Secrets'ta), gönderim `jobs` ile (yeniden deneme, idempotent). Gönderilen metin `supplier_orders.payload`'a yazılır. İlk sürümde **onay şart**.
- [ ] **semi:** sistem hazırlar + ön kontrolleri yapar, kullanıcı "Onayla" der, sistem gönderir (email/api). Varsayılan mod.
- [ ] **api:** tedarikçi API'si belirlenince (F0 çıktısı) adaptör yaz; kimlik env'den, istek/yanıt kaydı, zaman aşımı, hata sınıfları (geçici → yeniden dene, kalıcı → `failed` + uyarı).
- [ ] **Ön kontroller (her yöntemde, gönderimden önce):** (1) tedarikçide stok var mı (güncel XML/içe aktarma), (2) güncel maliyet sipariş anı maliyetinden yüksek mi (kâr eşiği altına düşer mi), (3) adres/telefon tam mı, (4) aynı siparişe zaten tedarikçi siparişi var mı, (5) pazaryeri siparişi hâlâ geçerli mi (iptal edilmemiş), (6) kargo son tarihi yakın mı (öncelik). Biri başarısız → `awaiting_approval` + neden, otomatik gitmez.
- [ ] **Otomatik gönderim (en son açılır):** `suppliers.auto_send`, `auto_send_max_total`, `min_margin_for_auto`. Genel kapı: `settings.orders_auto_send` varsayılan **false**. İlk iki hafta yalnızca manuel/semi.
- [ ] Çok tedarikçili siparişi tedarikçiye göre böl (bir pazaryeri paketi, birden çok `supplier_orders`).
- [ ] Test: sahte e-posta gönderici ve sahte tedarikçi API'si; çift tetikleme, ön kontrol hataları, kısmi başarı, yeniden deneme.
- Bitti sayılır: test siparişi baştan sona (pazaryeri → hazırlama → onay → gönderim kaydı) çalışıyor; çift gönderim denemesi engelleniyor.

### F5 — Takip kodu ve kargo
- [ ] Tedarikçiden takip kodu girişi: panelden elle (ilk), e-posta cevabını ayrıştırma (kırılgan, ikinci aşama), API varsa otomatik.
- [ ] Takip kodunu pazaryerine bildir (`updateTracking`), sonucu `order_events`'e yaz; başarısızsa `needs_attention`.
- [ ] Kargo firması eşleme tablosu (tedarikçi kargosu → pazaryerinin tanıdığı firma). Tanınmayan firma uyarı verir.
- [ ] Gecikme uyarıları: kargo son tarihine X saat kala tedarikçi siparişi `sent` değilse veya takip yoksa panel + bildirim.
- Bitti sayılır: test siparişine takip kodu girilince pazaryerinde statü ilerliyor.

### F6 — Stok rezervasyonu ve çok pazaryeri stoğu
- [ ] Sipariş gelince `stock_reserve` (varyant `reserved` artar), iptal/iade/teslimde `stock_release`/düşüm. Pazaryerine giden stok = `stock - reserved`.
- [ ] Aynı varyant birden çok pazaryerinde satılıyorsa biri satınca diğerlerinde stok anında düşer (senkron beklemeden iş kuyruğuyla).
- [ ] Test: iki pazaryerinde son 1 stok, eşzamanlı iki sipariş → biri `problem` ve uyarı.

### F7 — Müşteri soruları ve mesajlar (yapay zeka destekli)
- [ ] (D) Trendyol müşteri soruları servisi: çekme + cevaplama. Ürün yorumu servisi var mı kontrol et; yoksa yorumları kapsam dışı bırak, bunu TODO'ya yaz.
- [ ] `worker/inbox.ts`: periyodik çekme → `inbox_items` (idempotent `external_id`).
- [ ] Panel **Gelen kutusu**: tek liste (pazaryeri, tür, durum filtresi), soru + ürün + (varsa) sipariş bağlamı yan yana.
- [ ] Cevap önerisi: Claude API'si (anahtar Secrets'ta, panel sunucusundan çağrı). Girdi: soru, ürün başlığı/açıklaması/özellikleri, mağaza ton kuralları. Çıktı: taslak + "emin değilim" bayrağı. **Kurallar:** teslimat süresi/garanti/iade gibi bilmediği konuda söz vermez, bilgi eksikse "kullanıcıya sor" der; kişisel veri istemez; pazaryeri kural dışı kelimeleri (iletişim bilgisi, dış site) içermez.
- [ ] Düzenle → onayla → gönder; gönderilen metin kaydedilir. Hazır cevap şablonları (sık sorulanlar).
- [ ] Maliyet koruması: günlük öneri sınırı, aynı soruya tekrar üretmez.
- Bitti sayılır: gerçek/test sorusu için taslak üretiliyor, düzenlenip pazaryerine gidiyor, otomatik gönderim yok.

### F8 — İadeler
- [ ] (D) Trendyol iade (claims) servisi: çekme, neden kodları, statü. `returns` tablosuna idempotent yaz.
- [ ] İade nedeni sınıfı (müşteri vazgeçti / ürün hatalı / yanlış ürün / geç teslim / açıklama farkı): ürün, kategori, tedarikçi bazında oran.
- [ ] Tedarikçiye iade akışı: tedarikçi kabul etti mi, kredi/geri ödeme geldi mi (`supplier_credit`), gelmediyse "tedarikçiden alacak" listesi.
- [ ] Gerçek iade maliyetiyle `return_rate` ve `return_cost` ayarlarını kalibre et (şu an 0.05 × 180 TL tahmini).

### F9 — Analitik ve kâr
- [ ] **Net kâr (sipariş başına):** `sale_price(KDV dahil) − KDV − komisyon (+KDV) − kargo (satıcı ödüyorsa) − tedarikçi maliyeti (cost_snapshot) − iade payı`. Formül `worker/pricing.ts` ile tutarlı, tek kaynak olarak ortak modül.
- [ ] Gösterge paneli: bugün/hafta/ay ciro, net kâr, sipariş sayısı, ortalama kâr/sipariş, bekleyen tedarikçi siparişi, geciken kargo.
- [ ] Ürün/kategori/tedarikçi sıralaması: en çok satan, en çok kâr getiren, en çok iade gelen. **İlk 2 hafta yalnızca veri topla;** sonra "araştırma" raporu çıkar (hangi kategoriye yatırım, hangi ürünleri kaldır).
- [ ] Hedef/gerçek karşılaştırma: tahmini kâr (fiyat motoru) ile gerçek kâr farkı → fiyat kurallarını ayarlama önerisi.
- [ ] Dışa aktar (CSV) ve haftalık özet e-postası.

### F10 — Bildirimler ve hata merkezi
- [ ] Olaylar: yeni sipariş, tedarikçi siparişi başarısız, kargo son tarihi yaklaşıyor, stok bitti (sipariş var), senkron/webhook hatası, yeni müşteri sorusu, iade geldi.
- [ ] Kanallar: Telegram/e-posta/panel zili. Sessiz saatler ve tekrar bastırma (aynı olay saatte bir).
- [ ] **Hata merkezi** (Ayarlar): son hatalar, hangi sipariş/iş, tek tıkla yeniden dene (kuyruk zaten var).

### F11 — Diğer pazaryerlerinin siparişleri
- [ ] Hepsiburada: sipariş çekme + takip bildirme (canlıya geçince; `docs/HEPSIBURADA_TEST.md`).
- [ ] Amazon TR: SP-API Orders (yetki rolü "Inventory and Order Tracking" zaten alındı), takip bildirimi.
- [ ] N11 / ÇiçekSepeti: hesap + anahtar (K).
- [ ] Her biri `fetchOrders`/`updateTracking` uygular, `order-status.ts` haritasına satır ekler, F2–F5 testlerini aynı şekilde geçer.

### F12 — Sertleştirme
- [ ] Uçtan uca senaryo testi (sahte pazaryeri + sahte tedarikçi): sipariş → onay → gönderim → takip → teslim → iade, otomatik çalışır (`npm test`).
- [ ] Mobil/tablet denetimi (390/768/1280, gece/gündüz), Playwright, her düğme tıklama testi.
- [ ] Güvenlik: yeni uçlar `guard()`, webhook doğrulama, SSRF (tedarikçi API adresleri), RLS, müşteri verisi maskeleme, saklama süresi temizleme işi.
- [ ] Yük: 15 dk senkron + sipariş çekme Actions dakika kotası (repo herkese açık olduğu sürece sorun yok).
- [ ] Yedekleme/geri alma notu, runbook (`docs/RUNBOOK.md`): sipariş çift gitti, webhook durdu, tedarikçi API'si düştü.
- [ ] Güncel sürüm denetimi (Next 16, React 19 vb.) ve `npm audit`.

## Sipariş durum diyagramı (iç statüler)

```
new ──> ready ──> awaiting_approval ──> sent_to_supplier ──> shipped ──> delivered
  │        │               │                    │               │           │
  └────────┴───────────────┴──> cancelled        └──> problem    └──> returned
```
`problem` = elle bakılması gereken her şey (bilinmeyen statü, gönderim hatası, stok yok, adres eksik). Panelde en üstte.

## Riskler ve önlemler

| Risk | Önlem |
|---|---|
| Aynı sipariş tedarikçiye iki kez gider | `idempotency_key` unique + gönderimden önce durum kontrolü + DB fonksiyonu |
| Yanlış/eksik adresle gönderim | Ön kontrol 3; eksikse `awaiting_approval` |
| Tedarikçi fiyatı artmış, zararına satış | Ön kontrol 2: güncel maliyetle kâr hesapla, eşik altı → onay |
| Stokta olmayan ürün siparişi | Ön kontrol 1 + F6 rezervasyon; müşteri iptali için kısa yol |
| Webhook düşer, sipariş kaçar | Periyodik çekme her zaman çalışır (F2) |
| Pazaryeri statüsü tanınmaz | `problem` + uyarı, yutma yok |
| Yapay zeka yanlış söz verir | Otomatik gönderim yok, "emin değilim" bayrağı, kural listesi |
| Müşteri verisi sızar | RLS, loglarda maskeleme, rol kontrolü, saklama süresi |
| Claude Code bağlamı/yeri unutur | `docs/CALISMA_KURALLARI.md` protokolü, tek "Şu an" göstergesi, her dilimde işaretleme |

## Sıra önerisi

F0 → F1 → F2 → F3 (görünür ilk değer: siparişleri tek yerde gör) → F4 manual+semi → F5 → F9'un veri toplama kısmı (F2'den itibaren zaten veri birikir) → F6 → F7 → F8 → F10 → F11 → F12. Tam otomatik gönderim ve satışı yeniden açma, F4–F5 canlı testten sonra.
