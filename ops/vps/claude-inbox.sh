#!/bin/bash
# Telegram -> Claude köprüsü (K 14.11). Claude Code oturumu bunu yoklar: okunmamış mesajları yazar, okundu işaretler, nabız bırakır
# (bot "Claude açık mı" bilgisini bu nabızdan verir; 3 dk yoklama yoksa "kuyrukta" der). Mesaj içeriği günlüğe yazılmaz.
set -euo pipefail
q() { docker exec -i trentakip-db-1 psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 -c "$1"; }
q "insert into app_state(key, value, updated_at) values ('claude:heartbeat', to_char(now() at time zone 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), now()) on conflict (key) do update set value = excluded.value, updated_at = now()" >/dev/null
q "with u as (update claude_inbox set seen_at = now() where seen_at is null returning id, created_at, text) select '📩 #' || id || ' ' || to_char(created_at at time zone 'Europe/Istanbul', 'HH24:MI') || ' ' || replace(text, E'\n', ' ⏎ ') from u order by id"
