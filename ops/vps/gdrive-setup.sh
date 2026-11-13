#!/bin/bash
# Google Drive yedek bağlantısı (K 12.11: "Google Drive'ıma ekle, 1 TB var"). Tek seferlik, sunucuda root olarak:
#   bash /opt/trentakip/ops/vps/gdrive-setup.sh
# Kapsam drive.file: sunucu Drive'da YALNIZCA kendi oluşturduğu dosyaları görür (diğer dosyalarına erişemez).
# Token ekrana/geçmişe yazılmaz, /root/.config/rclone/rclone.conf (600) içinde durur. Yedekler zaten gpg ile şifreli.
set -euo pipefail
command -v rclone >/dev/null || { echo "rclone kuruluyor..."; DEBIAN_FRONTEND=noninteractive apt-get install -y -q rclone >/dev/null; }
cat <<'EOF'

1) Kendi bilgisayarında (PowerShell) rclone yoksa kur:   winget install Rclone.Rclone
   (kurulumdan sonra PowerShell'i kapatıp yeniden aç)
2) Bilgisayarında şunu çalıştır, açılan tarayıcıda Google hesabınla (yedeklerin gideceği hesap) giriş yap ve izin ver:

   rclone authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ"

3) Bilgisayardaki ekranda "Paste the following into your remote machine --->" altında { ile başlayan uzun satırı
   (<---End paste satırına kadar) kopyala ve aşağıya yapıştır (yazdığın görünmez), Enter.

EOF
read -rsp "Token: " TOKEN; echo
[[ "$TOKEN" == \{*\} ]] || { echo "Token { ile başlayıp } ile bitmeli. Yeniden çalıştır."; exit 1; }
mkdir -p /root/.config/rclone && chmod 700 /root/.config/rclone
rclone config create gdrive drive scope=drive.file token="$TOKEN" --non-interactive >/dev/null
unset TOKEN
chmod 600 /root/.config/rclone/rclone.conf
rclone mkdir gdrive:trentakip-yedek/gunluk && rclone mkdir gdrive:trentakip-yedek/haftalik
echo "deneme" | rclone rcat gdrive:trentakip-yedek/baglanti-testi.txt
rclone lsf gdrive:trentakip-yedek/ && rclone deletefile gdrive:trentakip-yedek/baglanti-testi.txt
echo
echo "TAMAM: Google Drive bağlandı. Gece yedeği (03:15) artık Drive'da 'trentakip-yedek' klasörüne de kopyalanır."
echo "Son yedeği şimdi göndermek için:  bash /opt/trentakip/ops/vps/backup-offsite.sh"
