#!/bin/bash
# Sunucu veritabanı gece yedeği (docs/SUNUCU_PLAN.md adım 1): pg_dump (tüm veritabanı) -> gpg (AES256, /etc/trentakip/backup.env BACKUP_PASSPHRASE)
# -> /var/backups/trentakip/<tarih>.dump.gpg. Son 7 gün tutulur. Her yedek şifre çözülüp içindekiler listesiyle doğrulanır.
# Yalnızca hata olursa Telegram (pazartesi özeti 03.11 kaldırıldı: K yalnızca önemli bildirim istiyor). Sunucu dışına kopya: ayrı adım (K yer seçecek).
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
# Doğrulama: şifre çözülür, pg_restore içindekiler listesini okuyabilmeli. Liste okununca kalan veri boşaltılır (yoksa gpg "Broken pipe")
count_tables() { gpg --batch --quiet --decrypt --passphrase-fd 3 "$1" 3<<<"$BACKUP_PASSPHRASE" | { docker exec -i trentakip-db-1 pg_restore -l 2>/dev/null | grep -c " TABLE DATA "; cat >/dev/null; } || true; }
N=$(count_tables "$F")
[ "$N" -gt 50 ] || { tg "🚨 Sunucu yedeği doğrulanamadı ($(date +%F)): içinde $N tablo"; exit 1; }

# Supabase (geçişe kadar canlı sistem) yedeği: GitHub backup.yml secret'ları eklenene kadar canlı veri yedeksiz kalmasın (01.11).
# Yalnızca okur (pg_dump; Supabase'e yazmaz). Doğrulama eşiği 30 tablo (Supabase public 44; sunucu tüm DB 73). public şeması + kullanıcılar (auth.users/identities verisi; mirror.sh ile aynı kapsam).
NS=0
if [ -n "${SUPABASE_DB_URL:-}" ]; then
  FS="$DIR/supabase-$(date +%F).dump.gpg"
  docker exec -i trentakip-db-1 pg_dump "$SUPABASE_DB_URL" --schema=public --no-owner --no-privileges --no-publications --no-subscriptions -Fc \
    | gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-fd 3 -o "$FS.tmp" 3<<<"$BACKUP_PASSPHRASE"
  mv "$FS.tmp" "$FS"
  NS=$(count_tables "$FS")
  [ "$NS" -gt 30 ] || { tg "🚨 Supabase (canlı) yedeği doğrulanamadı ($(date +%F)): içinde $NS tablo"; exit 1; }
fi

find "$DIR" -name '*.dump.gpg' -mtime +7 -delete
SIZE=$(du -h "$F" | cut -f1)
echo "yedek tamam: $F ($SIZE, $N tablo)${FS:+ · Supabase: $(du -h "$FS" | cut -f1), $NS tablo}"
