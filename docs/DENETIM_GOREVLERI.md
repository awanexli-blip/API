# Denetim düzeltme görevleri (Claude Code buradan başlar)

Kaynak rapor: `docs/DENETIM_2026-10-21.md` (bulgular, kanıtlar, "doğrulanamayanlar"). Çalışma kuralları: `docs/CALISMA_KURALLARI.md`.
Durum: `[ ]` bekliyor · `[~]` devam · `[x]` bitti · `(K)` kullanıcı kararı/işi · `(CANLI)` canlı sistemi değiştirir, **K onayı olmadan çalıştırma**.
Son güncelleme: 22.10.2026.

## Şu an

> **Önce S0 (kritik), sonra S1, S2, S3. Faz 6'ya (`docs/FAZ6_PLAN.md`) S0 ve S1 bitmeden geçme.**
> **22.10 durum:** S0.1-S0.3, S1.1-S1.4, S2.1-S2.6 tamam; S2.3/S2.7/S3.3/S3.5/S3.6 kısmen (kalanlar K işi). **K bekleyen:** S0.4 (Auth ayarları), S0.5 (depo özel mi), S2.7 indeks silme, S2.8 tmp_* kararı, S3.7 yedek/MFA. **Sıradaki (Claude):** S3.1 ikinci tur kod okuması, sonra Faz 6 F0.
> **Güncelleme (21.10, push sırasında):** `main` denetimden sonra ilerledi: BayilikXML bırakıldı, yeni tedarikçi Toptancım (`toptacim`), migration 022-024 kullanıldı (`listing_retire`, `brand_blocklist`, tedarikçi markası). Bu yüzden güvenlik migration'ları **025** ve **026** olarak numaralandı, Faz 6 migration'ları 027-028. **Her migration'dan önce `ls supabase/migrations` ile sıradaki boş numarayı kontrol et.** Denetim bulguları (tmp_* nesneleri, workflow'lar, SSRF, başlıklar) güncel `main`'de de geçerli görünüyor ama **S0.1'de canlıda yeniden doğrula**; yeni eklenen kodu (retire, Toptancım içe aktarma) S3.1 ikinci turuna dahil et.

## Bu görev listesini başlatma istemi (kopyala-yapıştır)

```
docs/DENETIM_GOREVLERI.md ve docs/DENETIM_2026-10-21.md dosyalarını oku, ardından CLAUDE.md ve docs/CALISMA_KURALLARI.md. git pull/status yap. "Şu an" kutusundaki ilk işaretlenmemiş maddeyi yap. Görev listesi kur (TaskCreate), maddeyi bitir, doğrula, bu dosyada işaretle, docs/PROGRESS.md'ye en üste girdi yaz, sonra sıradaki maddeye geç. (CANLI) etiketli maddede önce ne yapacağını ve etkisini bana göster, onayımı bekle. Hiçbir şeyi silme (tmp_* tablolar dahil). Anahtar, secret veya müşteri verisini sohbete/commit'e yazma.
```

## Kurallar (bu liste için)

- Her madde: değişiklik + test + kanıt (komut çıktısı/HTTP kodu, **veri değil**) + işaret + PROGRESS girdisi.
- Güvenlik düzeltmesi öncesi ve sonrası aynı kontrol çalıştırılır; "öncesi başarısız, sonrası geçti" kanıtı PROGRESS'e yazılır.
- Veritabanı değişiklikleri `supabase/migrations/` altına dosya olarak da eklenir (canlıya tek seferlik uygulanır, tekrar çalıştırmak güvenli olmalı).
- Silme yok: `tmp_*`, `price_audit_before` gibi nesneler için yalnızca yetki geri alma; silme kararı K'da.
- Model/çaba önerisi her bölümün başında. Güvenlik ve veritabanı değişiklikleri en az `high`.

---

## S0 — Kritik: açık veri yetkileri
Model: `opus`, çaba `high`. (CANLI) maddeler K onayı ister.

- [x] **S0.1 Kanıt (salt okunur).** _22.10: anon anahtarla `tmp_profit` HTTP 200 + satır döndü (K1 doğrulandı); diğer tablolar 200 + 0 satır._ Supabase MCP `get_publishable_keys` ile anon anahtarı al, **anahtarı sohbete/commit'e yazma**. `GET {SUPABASE_URL}/rest/v1/tmp_profit?select=listing_key&limit=1` isteğini anon anahtarla at. Yalnızca **HTTP kodunu ve dönen satır sayısını** raporla (içeriği yazdırma). Aynısını `tmp_xml_costs`, `tmp_xml_raw`, `price_audit_before` ve `products` için dene (tablolar RLS ile boş dönmeli). Sonucu PROGRESS'e yaz. `K1` doğrulanmış olur (200 + satır) ya da çürütülür.
- [x] **S0.2 (CANLI) Migration `025_security_hardening.sql`.** _22.10 K onayıyla uygulandı (tmp_send_pick dahil tüm public nesneler)._ Önce `pg_default_acl` ve mevcut yetkileri sorgula, sonucu K'ya göster, onay al. İçerik (tekrar çalıştırılabilir):
  ```sql
  -- Görünüm çağıranın yetkisiyle çalışsın (RLS atlanmasın)
  alter view public.tmp_profit set (security_invoker = true);

  -- Panel veriyi yalnızca sunucudan (service_role) okur; tarayıcı yalnızca supabase.auth kullanır.
  -- anon/authenticated'a public şemada hiçbir yetki gerekmez.
  revoke all on all tables    in schema public from anon, authenticated;
  revoke all on all sequences in schema public from anon, authenticated;
  revoke execute on all functions in schema public from anon, authenticated;

  -- Yeni nesneler de açık doğmasın (postgres rolü; supabase_admin için pg_default_acl'e bak)
  alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
  alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
  alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
  ```
  Dikkat: `service_role` etkilenmez. Storage ve auth şemaları etkilenmez. Panelin hiçbir ekranı `supabase.from/rpc/storage` kullanmıyor (denetimde grep ile doğrulandı); yine de uygulamadan önce tekrar grep et.
- [x] **S0.3 Doğrulama.** _22.10: advisors security: security_definer_view ERROR kalktı; kalan yalnızca INFO (RLS politikasız, beklenen: erişim service_role) + leaked password WARN (S0.4, K). Panel ekranları sahte API ile tarayıcıda açıldı (Ürünler vitrin/liste, konsol hatası yok); service_role yolu senkronlarda çalışıyor._ _22.10: anon ile tmp_profit, tmp_xml_costs, tmp_send_pick, price_audit_before, products, settings, suppliers hepsi HTTP 401 (42501). Senkron service_role ile çalışmaya devam ediyor. Kalan: panel ekran kontrolü, advisors._ S0.1'deki istekler artık 401/403 ya da yetki hatası dönmeli (öncesi/sonrası kanıtı). Panelde Özet, Ürünler, Tedarikçiler, Kategoriler ekranları açılıyor mu (service_role yolu bozulmadı). Bir `sync preview` çalıştır (yazmaz). `get_advisors(security)` yeniden: `security_definer_view` ERROR kalkmalı.
- [ ] **S0.4 (K) Supabase Auth ayarları (panelden):** (a) herkese açık kayıt **kapalı** (yalnızca davet), (b) e-posta onayı **açık**, (c) *Leaked password protection* **aç**, (d) yönetici hesabı için MFA kaydet. Yapıldığını K bildirir; Claude Code PROGRESS'e "K onayladı" yazar.
- [ ] **S0.5 (K) Karar: depo özel mi olsun?** (bkz. rapor Y2). Seçenekler: (a) özel yap + Actions dakikasını yönet (30 dk senkron, gece işlerini azalt, gerekirse ücretli plan) · (b) açık kalsın, ama artifact yüklemeyi kaldır, CSV'ler özel Storage bucket'ına, günlüklerde maliyet/müşteri verisi yok. **Karar çıkmadan Faz 6 F2'ye geçilmez.** Karar `CLAUDE.md` iş kurallarına yazılır.

## S1 — Yüksek
Model: `opus`, çaba `high` (S1.4 `sonnet` `high` olabilir).

- [x] **S1.1 Workflow komut enjeksiyonu.** _22.10: tüm workflow girdileri env ile; sync/import/brands argümanları sabit liste/regex ile doğrulanır (util.ts arg), util.test.ts. grep: run: altında doğrudan github.event.inputs kalmadı._ `import.yml`, `sync.yml` (ve varsa diğer workflow'lar): tüm `${{ github.event.inputs.* }}` ve `${{ matrix.* }}` değerlerini `env:` ile geçir, `run:` içinde `"$DEGISKEN"` kullan (`hb-tool.yml` doğru örnek). `worker/import-xml.ts` ve `worker/sync.ts` başında argümanı regex ile doğrula (`^(all|nightly|[a-z0-9-]{2,30})$`, mod ve pazaryeri sabit liste), geçersizse hata ile çık. Test: geçersiz argüman süreci hata kodu ile durdurur (birim test). `grep -rn "\${{ github.event.inputs" .github/workflows` çıktısında `run:` altında doğrudan kullanım **kalmamalı**; çıktıyı PROGRESS'e yaz.
- [x] **S1.2 Artifact ve günlük hijyeni.** _22.10: preview.csv/xml_dump.csv artifact yüklemesi kaldırıldı (maliyet içeriyor, depo açık); araç çıktıları retention 1 gün. maskPhone/maskEmail/maskName/maskAddress (util.ts) + test._ S0.5 kararına göre: `sync.yml` içinde `preview*.csv`/`xml_dump.csv` yüklemesini kaldır veya yalnızca maliyet sütunsuz özet yükle; `retention-days: 1`. Worker günlüklerinde maliyet, kâr, müşteri verisi basılmadığını `grep` ile doğrula. Maskeleme yardımcı fonksiyonu ekle (`worker/core/util.ts`: telefon/adres/e-posta maskele), Faz 6'da kullanılacak.
- [x] **S1.3 `getActor` e-posta doğrulaması.** _22.10: lib/auth-rules.ts resolveRole: email_confirmed_at yoksa yetki yok; tek modül düzeyi admin() istemcisi; tests/auth.test.ts (5 test). Mevcut 1 kullanıcının e-postası doğrulanmış (kilitlenme yok)._ `lib/server.ts`: `data.user.email_confirmed_at` yoksa `null` dön. Tek `admin()` istemcisi (her çağrıda yeniden oluşturma yerine modül düzeyinde). Birim testler: doğrulanmamış e-posta → 401, doğrulanmış + rol yok → 401, `ADMIN_EMAIL` → admin, `user_roles` → rol. Mevcut kullanıcıların `email_confirmed_at` değeri dolu mu kontrol et (kimse kilitlenmesin; önce admin ile test).
- [x] **S1.4 Bağımlılık sabitleme.** _22.10: package-lock.json + worker/package-lock.json commit (xlsx integrity hash ile), workflow'larda npm ci, actions tam SHA, .github/dependabot.yml. CI Linux'ta yeşil._ `.gitignore`'dan `package-lock.json` ve `worker/package-lock.json` çıkar, kilit dosyalarını üret ve commit et. `xlsx` için `integrity` hash'li kilit; mümkünse SheetJS'in npm'de yayınlanan sürümüne ya da kendi depomuza taşınmış dosyaya geç (CDN bağımlılığını kaldır). Workflow'larda `npm install` → `npm ci`. Vercel derlemesinin kilit dosyasıyla yeşil çıktığını doğrula (Vercel bağlayıcısı). `actions/*` sürümlerini tam commit SHA'ya sabitle. Haftalık `npm audit` / Dependabot yapılandırması ekle. (Eski gerekçe "Vercel çözümü değişmesin" kilit dosyasıyla daha iyi sağlanır; tersini yapmıyor.)

## S2 — Orta
Model: `opus` `high` (S2.1, S2.3), diğerleri `sonnet` `high`.

- [x] **S2.1 Güvenli dış istek yardımcısı.** _22.10: worker/core/safe-fetch.ts (DNS çözümü + iç ağ/IPv6/mapped/NAT64 engeli, elle en fazla 3 yönlendirme her adımda doğrulama, akışla bayt sınırı, süre). Tedarikçi içe aktarma (300 MB), XML inceleme (120 MB), görsel (10 MB). safe-fetch.test.ts. Kalan risk: DNS rebinding bu katmanda tam kapanmaz._ `lib/safe-fetch.ts` (panel) ve aynısı `worker/core/safe-fetch.ts` (ortak mantık tek dosyadan import edilebiliyorsa tek): (1) yalnızca http/https; (2) ana makine adını **DNS ile çöz**, çözülen **her** IP'yi reddet: loopback, özel, link-local, CGNAT `100.64.0.0/10`, çok noktaya yayın, ayrılmış, IPv6 `::1`, `fc00::/7`, `fe80::/10`, `::ffff:` eşlemeli IPv4, meta veri adresleri (`169.254.169.254`, `metadata.google.internal`); (3) `redirect: "manual"`, en fazla 3 yönlendirme, her adımda yeniden doğrula; (4) süre sınırı; (5) **akışla bayt say** ve sınırı aşınca iptal et (görsel 10 MB, XML 120 MB); (6) `content-type` beklenenle uyumlu. `app/api/products/images` ve `app/api/suppliers/inspect` ile `worker/import-xml.ts` bunu kullansın. Testler: `127.0.0.1.nip.io` tarzı ad, iç IP'ye yönlendirme, yönlendirme zinciri, IPv6, gövde sınırı (başlıksız büyük yanıt).
- [x] **S2.2 Güvenlik başlıkları.** _22.10: next.config.mjs başlıklar + CSP Report-Only; sahte API ile tarayıcı testinde CSP ihlali yok. Zorunlu moda geçiş S3.4._ `next.config.mjs` `headers()`: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (gereksizleri kapat), `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`. CSP'yi önce **`Content-Security-Policy-Report-Only`** ile ekle (`default-src 'self'`; `connect-src` Supabase URL'si; `img-src` Supabase Storage + `data:`; tema betiği için hash/nonce). Panelde gece/gündüz, giriş ve ürün formu çalışıyor mu tarayıcıda test et (konsolda CSP raporu). Rapor temiz olunca zorunlu moda geçiş maddesi aç (S3).
- [~] **S2.3 Feed sertleştirme.** _22.10: alış fiyatı modunda panel uyarısı; CDN s-maxage=300; erişim sayacı atomik RPC feed_hit (migration 030). IP başına hız sınırı (Vercel Firewall) açık._ (a) `price_mode=cost` seçeneğine panelde açık uyarı ("tedarikçi maliyetini token'ı bilen herkese açar"), varsayılan `none`/`formula`; (b) Vercel Firewall veya basit uç hız sınırı (IP başına/dk) ve token başına; (c) `Cache-Control: private, max-age=300` ya da `s-maxage` bilinçli seçim; (d) erişim sayacını `await` et ve atomik artır (`access_count = access_count + 1` RPC/SQL); (e) tarama pahalıysa sonucu kısa süre önbelleğe al. Test: geçersiz token 404, hız sınırı 429.
- [x] **S2.4 Dahili çağrı.** _22.10: lib/listings-send.ts queueSend ortak fonksiyon; matches/queue doğrudan çağırır, Bearer iletilmez._ `app/api/matches/queue/route.ts`: `fetch(origin + /api/listings/send)` yerine ortak fonksiyonu doğrudan çağır; Bearer'ı kendi origin'ine iletme.
- [x] **S2.5 Hata mesajları.** _22.10: dbError 500 genel mesaj + sunucu günlüğü; unauthorized() env adlarını söylemez; 4 rota req.json korumalı._ `dbError` varsayılan 500'de genel mesaj dön, ayrıntıyı yalnızca sunucu günlüğüne (müşteri verisi içermeden) yaz. `unauthorized()` eksik env adlarını kimliksiz isteğe söylemesin (yalnızca `/api/health` yönetici yanıtında). `app/api/run` ve benzeri `await req.json()` çağrıları `.catch(() => ({}))` ile 400 dönsün. Tüm `route.ts` dosyalarında `grep -n "req.json()"` ile tara.
- [x] **S2.6 CSV formül enjeksiyonu.** _22.10: csvCell (util.ts) sync preview/xml_dump ve panel Import CSV indirmede; = + - @ sekme CR başına '. Test util.test.ts._ `worker/sync.ts q()` ve diğer dışa aktarmaları (xml_dump, preview, panel CSV/XLSX dışa aktarımı) oku. `=`, `+`, `-`, `@`, sekme ve CR ile başlayan hücrelerin başına `'` ekle. Birim test: `=HYPERLINK(...)` içeren başlık etkisizleşir. (Rapor O7: önce doğrula, sorun yoksa test ekleyip kapat.)
- [~] **S2.7 Veritabanı düzeltmeleri.** _22.10: migration 029 (marketplace_matches_variant_idx + vitrin sıralama indeksleri). Kalan (K onayı): products_status_idx silme, price_audit_before kararı._ Migration `029_db_hygiene.sql`: `create index if not exists marketplace_matches_variant_idx on marketplace_matches (variant_id)`. (K onayıyla) `drop index if exists products_status_idx` (yinelenen; `products_status_updated_idx` kalır). `price_audit_before` için birincil anahtar ya da (K) arşivleme/silme kararı. Sonra `get_advisors(performance, security)` yeniden: WARN kalmamalı.
- [ ] **S2.8 Tek seferlik kalıntılar (K kararı).** `tmp_xml_raw`, `tmp_xml_costs`, `tmp_profit`, `price_audit_before`: S0 sonrası zararsız. İhtiyaç bitince **K onayıyla** önce özetini (satır sayısı, amacı) göster, sonra yedekle/sil. Claude Code kendi başına silmez.

## S3 — Düşük ve ikinci tur
Model: `sonnet` `medium` (S3.1 `opus` `xhigh`).

- [ ] **S3.1 Okunmayan kodun denetimi (ikinci tur).** Denetimde okunmayanlar: `app/api/{jobs,overrides,me,matches,matches/queue,categories,rejections,settings(PUT gövdesi),pricing-rules,brands,brands/search,products,products/[id],products/bulk,products/options,import/csv,suppliers,listings/send,runs,dashboard}`, `worker/{sync,jobs,brands,hb-tool,amazon-tool,pricing,pricing-rules,import-xml}.ts`, `worker/core/*`, `worker/marketplaces/*`, `lib/{import,supplier-xml,validation/product,marketplace-readiness}.ts`. Her dosyada: yetki, girdi doğrulama, hata yutma (`catch {}`), idempotency, para/stok hesabı, log'a sır/müşteri verisi. Bulguları `docs/DENETIM_2026-10-21.md` sonuna "İkinci tur" olarak ekle; düzeltmeleri bu dosyaya yeni maddeler olarak aç.
- [ ] **S3.2 Panel derleme ve testleri.** `npm ci && npx tsc --noEmit && npm run build && npm test`; çıktıyı PROGRESS'e yaz. (Denetim ortamında CDN 403 yüzünden yapılamamıştı.)
- [~] **S3.3 CI kapısı.** _22.10: .github/workflows/ci.yml (npm ci, tsc, build, test, npm audit uyarı). Dal koruması K (GitHub ayarı)._ `.github/workflows/ci.yml`: her push/PR'da `npm ci`, `tsc --noEmit`, `npm run build`, `npm test`. `main` için dal koruması (K, GitHub ayarı) ve riskli worker değişikliklerinde önce `preview` ile doğrulama kuralı `CLAUDE.md`'ye.
- [ ] **S3.4 CSP zorunlu moda al** (S2.2 raporu temizse).
- [~] **S3.5 Doküman uyumu.** _22.10: .env.example güncel adlar, ARCHITECTURE Next 16. CLAUDE.md §5/§6 tarihsel; güncel durum PROGRESS/TODO._ `docs/ARCHITECTURE.md` (Next 14 → 16), `.env.example` (kullanılmayan `TRENDYOL_CARGO_COMPANY_ID` çıkar; `HB_*`, `AMAZON_*`, `SYNC_MARKETPLACES`, `TRENDYOL_STOREFRONT`, `TRENDYOL_BRAND_NAME` ekle; **yalnızca adlar**), `CLAUDE.md` §5 ve §6 (eski "denenmedi/sıradaki" bilgileri güncel duruma çek, TODO ile çelişme kalmasın), `sync.yml` cron yorumu (gerçek aralık).
- [~] **S3.6 Sır envanteri** _22.10: docs/SIRLAR.md (yalnızca adlar). GH_TOKEN süre sonu ve son yenileme tarihleri K'dan._ `docs/SIRLAR.md`: hangi anahtar nerede (GitHub Secrets/Vercel), amacı, süre sonu, son yenileme, rotasyon takvimi (**değerler yok, yalnızca adlar ve tarihler**). `GH_TOKEN` fine-grained ve süreli olsun (K).
- [ ] **S3.7 (K) Yedek ve MFA.** Supabase yedek/PITR durumunu doğrula; yönetici MFA (S0.4 ile birlikte). Sipariş verisi (Faz 6) gelmeden önce tamamlanmış olsun.
- [ ] **S3.8 Saklama ve maskeleme (Faz 6 ön hazırlık).** Müşteri verisi saklama süresi kararı (K, KVKK), temizleme işi tasarımı, günlük maskeleme testi. Ayrıntı: `docs/FAZ6_PLAN.md` F0/F12.

## Bitiş ölçütleri

- S0 ve S1 tamam, `get_advisors(security)` ERROR/WARN yok (Auth ayarları dışında K'ya bağlı olanlar işaretli).
- `grep -rn "github.event.inputs" .github/workflows` çıktısında `run:` satırı yok.
- Anon anahtarla `public` şemasındaki hiçbir nesne okunamıyor (kanıt PROGRESS'te).
- Kilit dosyaları commit'te, derlemeler `npm ci` ile yeşil.
- Sonra: `docs/FAZ6_PLAN.md` F0'a geç.
