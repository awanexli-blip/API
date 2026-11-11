#!/bin/bash
# Sunucu iç izleme (docs/SUNUCU_PLAN.md §3): 5 dakikada bir. Sorun -> Telegram (aynı sorun 3 saatte bir). "Düzeldi" mesajı yok (K, 03.11: yalnızca önemli).
# Dış izleme (sunucu tamamen kapanırsa) GitHub Actions'tadır; bu betik sunucu ayaktayken bozulan parçaları yakalar.
set -uo pipefail
. /etc/trentakip/env
. /etc/trentakip/keys.env 2>/dev/null || true
S=/var/lib/trentakip/monitor; mkdir -p "$S"
tg() { [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && curl -s -m 20 -o /dev/null "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=$1" || true; }
problem() { # $1 anahtar, $2 mesaj
  local f="$S/$1"
  if [ ! -f "$f" ] || [ $(( $(date +%s) - $(stat -c %Y "$f") )) -gt 10800 ]; then tg "⚠️ Sunucu: $2"; touch "$f"; fi
}
ok() { rm -f "$S/$1"; return 0; }

# Disk
D=$(df --output=pcent / | tail -1 | tr -dc 0-9)
[ "$D" -ge 85 ] && problem disk "disk %$D dolu" || ok disk "disk"
# Bellek (kullanılabilir)
M=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
[ "$M" -lt 250 ] && problem mem "kullanılabilir bellek ${M} MB" || ok mem "bellek"
# Veritabanı servisleri (db, rest, auth, storage, caddy)
DOWN=$(cd /opt/trentakip/ops/vps/db && docker compose ps --format '{{.Service}} {{.State}}' 2>/dev/null | awk '$2!="running"{print $1}' | tr '\n' ' ')
UP=$(cd /opt/trentakip/ops/vps/db && docker compose ps --format '{{.Service}}' 2>/dev/null | wc -l)
{ [ -n "$DOWN" ] || [ "$UP" -lt 5 ]; } && problem docker "veritabanı servisi çalışmıyor: ${DOWN:-eksik ($UP/5)}" || ok docker "veritabanı servisleri"
# Dışarıdan görünen API (HTTPS + PostgREST)
C=$(curl -s -m 15 -o /dev/null -w '%{http_code}' "${VPS_SUPABASE_URL:-https://trentakip.duckdns.org}/rest/v1/settings?select=id&limit=1" -H "apikey: ${VPS_SERVICE_ROLE_KEY:-}" -H "Authorization: Bearer ${VPS_SERVICE_ROLE_KEY:-}")
[ "$C" != 200 ] && problem api "veritabanı API'si yanıt vermiyor (HTTP $C)" || ok api "veritabanı API'si"
# Panel (kuruluysa)
if systemctl is-enabled trentakip-panel.service >/dev/null 2>&1; then
  P=$(curl -s -m 15 -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/)
  [ "$P" != 200 ] && problem panel "panel yanıt vermiyor (HTTP $P)" || ok panel "panel"
fi
# Başarısız zamanlanmış iş (izleme ve yedek hariç: onların kendi uyarısı var)
F=$(systemctl list-units --state=failed --no-legend --plain 'trentakip-*' 2>/dev/null | awk '{print $1}' | grep -v -e monitor -e backup | tr '\n' ' ')
[ -n "$F" ] && problem failed "başarısız iş: $F" || ok failed "zamanlanmış işler"
exit 0
