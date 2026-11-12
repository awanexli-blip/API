#!/bin/bash
# Gece yedeğinin sunucu dışı kopyası: Google Drive (rclone "gdrive", ops/vps/gdrive-setup.sh). backup.sh sonunda çağrılır, elle de çalışır.
# Günlük: trentakip-yedek/gunluk (30 gün) · Pazar: trentakip-yedek/haftalik (26 hafta). Dosyalar zaten gpg (AES256) ile şifreli.
# Drive bağlı değilse sessizce çıkar (yedek sunucuda kalır). Hata: Telegram uyarısı.
set -uo pipefail
DIR=/var/backups/trentakip
set -a; . /etc/trentakip/env 2>/dev/null; set +a
tg() { [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && curl -s -m 20 -o /dev/null "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=$1" || true; }
command -v rclone >/dev/null && rclone listremotes 2>/dev/null | grep -q '^gdrive:$' || { echo "Google Drive bağlı değil (ops/vps/gdrive-setup.sh): sunucu dışı kopya atlandı"; exit 0; }
F=$(ls -1t "$DIR"/*.dump.gpg 2>/dev/null | grep -v supabase- | head -1)
[ -n "$F" ] || { tg "⚠️ Yedek: Drive'a gönderilecek yedek dosyası yok ($DIR)"; exit 1; }
FS=$(ls -1t "$DIR"/supabase-*.dump.gpg 2>/dev/null | head -1)
ok=1
for f in "$F" ${FS:+"$FS"}; do
  rclone copy "$f" gdrive:trentakip-yedek/gunluk --retries 5 --low-level-retries 10 || ok=0
  [ "$(date +%u)" = 7 ] && { rclone copy "$f" gdrive:trentakip-yedek/haftalik --retries 5 || ok=0; }
done
# Drive'daki boyut sunucudakiyle aynı mı (yarım yükleme kalmasın)
L=$(stat -c %s "$F"); R=$(rclone size --json "gdrive:trentakip-yedek/gunluk/$(basename "$F")" 2>/dev/null | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')
[ "$L" = "$R" ] || ok=0
rclone delete gdrive:trentakip-yedek/gunluk --min-age 30d 2>/dev/null
rclone delete gdrive:trentakip-yedek/haftalik --min-age 182d 2>/dev/null
if [ $ok = 1 ]; then echo "Drive kopyası tamam: $(basename "$F") ($(numfmt --to=iec "$L"))${FS:+ + $(basename "$FS")}"; else tg "🚨 Yedek Drive'a gönderilemedi ($(date +%F)): $(basename "$F"). Yedek sunucuda duruyor."; exit 1; fi
