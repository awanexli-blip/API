#!/bin/bash
# Claude -> Telegram cevabı (K 14.11). Metin stdin'den (komut satırında görünmesin). Kişisel veri yazılmaz.
#   echo "mesaj" | bash /opt/trentakip/ops/vps/tg-say.sh
set -uo pipefail
set -a; . /etc/trentakip/env 2>/dev/null; set +a
T=$(cat); [ -n "$T" ] || exit 0
curl -s -m 20 -o /dev/null -w "%{http_code}\n" "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=🤖 ${T}"
