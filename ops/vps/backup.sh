#!/bin/bash
# Sunucu veritabanı gece yedeği (docs/SUNUCU_PLAN.md adım 1): pg_dump (tüm veritabanı) -> gpg (AES256, /etc/trentakip/backup.env BACKUP_PASSPHRASE)
# -> /var/backups/trentakip/<tarih>.dump.gpg. Son 7 gün tutulur. Her yedek şifre çözülüp içindekiler listesiyle doğrulanır.
# Hata olursa (ve her pazartesi özet) Telegram. Sunucu dışına kopya: ayrı adım (K yer seçecek).
set -euo pipefail
. /etc/trentakip/env
. /etc/trentakip/backup.env
DIR=/var/backups/trentakip
mkdir -p "$DIR" && chmod 700 "$DIR"
F="$DIR/$(date +%F).dump.gpg"
tg() { [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && curl -s -m 20 -o /dev/null "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=$1" || true; }
trap 'tg "🚨 Sunucu yedeği ALINAMADI ($(date +%F)). journalctl -u trentakip-backup"' ERR

docker exec trentakip-db-1 pg_dump -U postgres -d postgres -Fc --no-owner \
  | gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-fd 3 -o "$F.tmp" 3<<<"$BACKUP_PASSPHRASE"
mv "$F.tmp" "$F"
# Doğrulama: şifre çözülür, pg_restore içindekiler listesini okuyabilmeli (tablo sayısı > 50)
N=$(gpg --batch --quiet --decrypt --passphrase-fd 3 "$F" 3<<<"$BACKUP_PASSPHRASE" | docker exec -i trentakip-db-1 pg_restore -l 2>/dev/null | grep -c " TABLE DATA " || true)
[ "$N" -gt 50 ] || { tg "🚨 Sunucu yedeği doğrulanamadı ($(date +%F)): içinde $N tablo"; exit 1; }
find "$DIR" -name '*.dump.gpg' -mtime +7 -delete
SIZE=$(du -h "$F" | cut -f1)
echo "yedek tamam: $F ($SIZE, $N tablo)"
[ "$(date +%u)" = 1 ] && tg "✅ Sunucu yedeği çalışıyor: $SIZE, $N tablo, son 7 gün saklanıyor" || true
