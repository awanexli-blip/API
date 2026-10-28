# VPS kurulumu

Sunucu: Türkiye, 1 CPU / 2 GB RAM / 50 GB NVMe, haftalık yedek. Bağlantı K'nın bilgisayarındaki `~/.ssh/trentakip_vps` anahtarıyla.

## 1. aşama: sunucu açılınca (yaklaşık 15 dakika)

Sunucuda ilk gün çalışacaklar:

| İş | Ne zaman | Neden sunucuda |
|---|---|---|
| Senkronu başlat (`trentakip-dispatch`) | 15 dakikada bir, tam vaktinde | GitHub'ın kendi zamanlayıcısı 40 dk ile 2,5 saat arası gecikiyordu |
| IP izinli tedarikçi API'leri (`trentakip-supplier-vps`) | 15 dakikada bir | Tedarikçi yalnızca sabit IP'ye izin veriyor; GitHub'ın IP'si her çalışmada değişir |
| Kod güncelleme (`trentakip-update`) | 10 dakikada bir | `main`'e gönderilen kod sunucuya kendiliğinden gelir |

Ağır işler (XML içe aktarma, pazaryeri senkronu, yedek) GitHub Actions'ta kalır (7 GB RAM, ücretsiz).

**K yapar:**
1. Sağlayıcı panelinde Ubuntu 24.04 (ya da daha yeni) kur. Kurulumda SSH açık anahtarı soruyorsa `~/.ssh/trentakip_vps.pub` içeriğini yapıştır.
2. Sunucunun IP adresini Claude'a yaz.
3. Yeni bir GitHub token oluştur: GitHub → Settings → Developer settings → Fine-grained tokens. Yalnızca `awanexli-blip/API` deposu, Actions: Read and write. Bunu sohbete yazma; Claude sunucuda dosyayı açınca kendin yapıştırırsın (aşağıdaki 3. adım).

**Claude yapar:**
1. `ssh -i ~/.ssh/trentakip_vps root@<IP>` ile bağlanır, `ops/vps/setup.sh` dosyasını kopyalayıp çalıştırır. Betik şunları yapar: güncellemeler, otomatik güvenlik yamaları, yalnızca anahtarla SSH (önce anahtarın yüklü olduğunu kontrol eder), güvenlik duvarı (yalnızca SSH), fail2ban, 2 GB swap, Node 24, PostgreSQL 17 istemcisi, depo `/opt/trentakip`, zamanlayıcılar.
2. `/etc/trentakip/env` dosyasını hazırlar (şablon `ops/vps/trentakip.env.example`).
3. Gizli değerleri (Supabase service role, GH_TOKEN, Telegram, tedarikçi anahtarları) K kendi girer: `nano /etc/trentakip/env`. Değerler sohbete yazılmaz.
4. Dener: `systemctl start trentakip-dispatch.service && journalctl -u trentakip-dispatch -n 20`. Ardından GitHub Actions'ta yeni çalışma görünmeli; panelde otomatik senkron kapalıysa çalışma "skipped" bitmeli.
5. Açar: `systemctl start trentakip-dispatch.timer trentakip-supplier-vps.timer`.
6. Bir gün izler. Sorun yoksa `sync.yml` içindeki GitHub cron satırı kaldırılır; yedek olarak kalırsa da zararı yok, aynı pazaryerinde iş sıraya alınır, iki iş aynı anda çalışmaz.

**Denetim komutları:** `systemctl list-timers 'trentakip-*'` · `journalctl -u trentakip-dispatch -n 30` · `journalctl -u trentakip-supplier-vps -n 50`

**Sunucunun IP'si tedarikçiye bildirilir** (API IP izni isteyen tedarikçiler için).

## 2. aşama (sonra, ayrı onayla)

- **2 dakikada bir sipariş ve soru kontrolü.** Sipariş ilk kayıtta maliyetini sabitler. Hızlı kontrolün siparişi maliyetsiz kaydetmemesi için önce maliyet ürün tablosundan okunacak şekilde ayrı bir giriş yazılacak.
- **Veritabanını sunucuya taşıma** (Supabase ücretsiz sınırı 500 MB). Plan: Postgres 17 + PostgREST + GoTrue + Storage, önlerinde Caddy (HTTPS; alan adı ya da `<ip>.sslip.io`). `pg_dump` / `pg_restore` (`docs/YEDEK.md`), sonra Vercel ve GitHub'daki adres ve anahtarlar değiştirilir. Taşıma öncesi bir tam yedek, taşıma sonrası satır sayısı karşılaştırması yapılır.
- **Gece yedeğinin sunucu dışında saklanması** (şifreli, 7 gün).
