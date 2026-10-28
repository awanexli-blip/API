# Supabase'den sunucuya (VPS) taşıma

Karar (K, 28.10.2026): veritabanı, giriş ve görseller sunucuya taşınır; panel Vercel'de kalır. 7 gün deneme, sorun çıkmazsa yalnızca sunucu. Supabase verisi silinmez, yedek kalır.

## Neden kod değişmiyor

Sunucuda Supabase'in kullandığı parçaların **aynı sürümleri** çalışır (28.10'da Supabase'den okundu):

| Parça | Supabase | Sunucu |
|---|---|---|
| Veritabanı | Postgres 17.11 | `postgres:17.11-bookworm` |
| Veri katmanı (`/rest/v1`) | PostgREST 14.18 | `postgrest/postgrest:v14.18` |
| Giriş (`/auth/v1`) | GoTrue v2.197.0 | `supabase/gotrue:v2.197.0` |
| Görsel (`/storage/v1`) | Storage | `ops/vps/db/storage.mjs` (yalnızca yükleme; okuma Caddy'den diskten) |
| HTTPS | Supabase | Caddy, Let's Encrypt, `trentakip.duckdns.org` |

Panel ve worker `@supabase/supabase-js` kullanmaya devam eder; geçişte yalnızca **adres ve anahtarlar** değişir.

Şemada Supabase'e özel bağımlılık yok (RLS politikası yok, `auth.uid()` yok, yalnızca `service_role` yetkisi ve `extensions.pg_trgm`). Giriş: 1 kullanıcı; parola özeti aynen taşınır, aynı parolayla girilir (oturum yeniden açılır). Görsel: 43 dosya (~1 MB).

## Dosyalar

| Yol | Görev |
|---|---|
| `ops/vps/db/docker-compose.yml` | Servisler; portlar yalnızca 127.0.0.1, dışarı yalnızca Caddy 80/443 |
| `ops/vps/db/init/00-roles.sh` | İlk açılış: `anon` (yetkisiz), `authenticated`, `service_role` (RLS'i aşar), `authenticator`, `supabase_auth_admin`, `auth`/`extensions` şemaları, `search_path` |
| `ops/vps/db/Caddyfile` | Supabase adres düzeni; giriş için CORS yalnızca panel (ve `trentakip-*.vercel.app` önizlemeleri) |
| `ops/vps/db/install.sh` | Docker, parolalar (`/etc/trentakip/db.env`), anahtarlar (`/etc/trentakip/keys.env`), güvenlik duvarı 80/443, servisler |
| `ops/vps/db/jwt.mjs` | `anon` / `service_role` anahtarı (JWT_SECRET ile imzalı) |
| `ops/vps/db/mirror.sh` | Supabase'den tam kopya: public şema, giriş kullanıcıları, görseller, görsel adresleri, satır sayısı karşılaştırması |
| `ops/vps/systemd/trentakip-mirror.*` | Deneme süresince günde 4 kopya (03/09/15/21:40) |

Parolalar ve anahtarlar yalnızca sunucuda (`/etc/trentakip/*.env`, root, 600). Depoya, sohbete, loga girmez.

## Aşamalar

**1. Kurulum (geri dönüşlü, canlıya dokunmaz).**
`/etc/trentakip/env` içine `SUPABASE_DB_URL` (Session pooler adresi, parolalı) eklenir, sonra:
```
bash /opt/trentakip/ops/vps/db/install.sh https://trentakip.vercel.app
bash /opt/trentakip/ops/vps/db/mirror.sh
systemctl enable --now trentakip-mirror.timer
```

**2. Deneme (7 gün).** Supabase ana sistem; sunucu günde 4 kez kopyalanır. Kontroller:
- `mirror.sh` çıktısında "TAMAM: satır sayıları aynı"
- Worker önizlemesi sunucu veritabanıyla (`preview`, pazaryerine yazmaz) aynı sonucu veriyor
- Vercel **önizleme** dağıtımı sunucu adresi ve anahtarlarıyla: giriş, ürün listesi, görsel yükleme, ayarlar
- Sunucu kaynakları: bellek, disk, yanıt süresi

Deneme sırasında sunucu veritabanına yazılanlar bir sonraki kopyada silinir (kopya baştan kurulur).

**3. Geçiş (K onayıyla, ~15 dakika).**
1. Panelden otomatik senkronu duraklat; çalışan iş akışlarının bitmesini bekle.
2. Son kopya: `mirror.sh` → "TAMAM".
3. Kopya zamanlayıcısını kapat: `systemctl disable --now trentakip-mirror.timer` (yoksa sunucu verisini ezer).
4. GitHub Secrets: `SUPABASE_URL2` = `https://trentakip.duckdns.org`, `SUPABASE_SERVICE_ROLE_KEY2` = sunucunun `VPS_SERVICE_ROLE_KEY`.
5. Vercel: `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` = sunucu adresi; `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` = sunucu anahtarları; yeniden dağıt.
6. Sunucu `/etc/trentakip/env`: `SUPABASE_URL` ve `SUPABASE_SERVICE_ROLE_KEY` sunucu değerleri.
7. Panelde giriş, ürünler, bir önizleme; sonra senkronu aç.

**Geri dönüş:** 4-6. adımlardaki eski değerler geri yazılır; Supabase olduğu gibi durur. Geçişten sonra sunucuya yazılan veri (senkron sonuçları, yeni ürünler) Supabase'de olmaz.

**4. Geçişten sonra.**
- Yedek: gece `pg_dump` + gpg şifreleme sunucuda, kopyası sunucu dışına (GitHub `backup.yml` artık sunucuya bağlanamaz: veritabanı portu dışarı kapalı). Geçişten önce hazırlanır.
- 4 GB'a geçince `/etc/trentakip/db.env`: `PG_SHARED_BUFFERS=1GB`, `PG_CACHE=3GB`, `docker compose up -d`.
- Davet e-postası için SMTP (isteğe bağlı): `db.env` içine `SMTP_HOST/PORT/USER/PASS/FROM`.
- 7 gün sorunsuzsa GitHub `sync.yml` cron'u kapatılır (sunucu `trentakip-dispatch.timer` tetikler).
