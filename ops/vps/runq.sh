#!/bin/bash
# Panel iş kuyruğu (tam taşıma 12.11, panel.env RUN_SITE=sunucu): panel /var/lib/trentakip/runq/*.json yazar (lib/github.ts),
# trentakip-runq.path bunu görüp bu betiği root olarak çalıştırır. Yalnızca aşağıdaki izinli işler başlar; parametreler
# kalıpla doğrulanır, dosya her durumda silinir (kuyruk tıkanmaz, path birimi döngüye girmez).
#   sync.yml       update/auto -> trentakip-orders + trentakip-sync-vps@<mp> (zaten çalışıyorsa dokunulmaz)
#                  preview     -> tek seferlik sync.ts preview (pazaryerine yazmaz)
#                  create      -> tek seferlik sync.ts create, süren ilan turu bitince (After=)
#   import.yml     -> trentakip-supplier-vps (sunucu tedarikçileri) ya da tek tedarikçi import-xml.ts <kod>
#   invoice-upload.yml dry/apply/audit -> worker/invoice-upload.ts | invoice-audit.ts (GİB bilgileri panel.env)
#   catalog.yml    -> worker/catalog.ts
set -u
Q=/var/lib/trentakip/runq
LOG=/var/log/trentakip/runq.log
log() { echo "$(date -Is) $*" >> "$LOG"; }

# Tek seferlik iş (systemd-run, kalıcı birim bırakmaz). $1 birim adı, $2 ek özellikler (boşlukla ayrılmış -p ...), $3 komut
run1() {
  local name=$1 props=$2 cmd=$3
  if systemctl is-active --quiet "$name.service"; then log "$name zaten çalışıyor, atlandı"; return 0; fi
  systemctl reset-failed "$name.service" 2>/dev/null
  # shellcheck disable=SC2086
  systemd-run --no-block --unit="$name" --uid=trentakip --gid=trentakip --working-directory=/opt/trentakip \
    -p EnvironmentFile=/etc/trentakip/env -p EnvironmentFile=/etc/trentakip/keys.env -p Nice=5 -p NoNewPrivileges=yes -p PrivateTmp=yes \
    -p RuntimeMaxSec=7200 -E HOME=/tmp $props \
    /bin/sh -c "SUPABASE_URL=\$VPS_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY=\$VPS_SERVICE_ROLE_KEY exec $cmd" >> "$LOG" 2>&1 \
    && log "başladı: $name ($cmd)" || log "BAŞLAMADI: $name"
}

NODE="/usr/bin/node --experimental-strip-types"
QUIET="-E TELEGRAM_BOT_TOKEN= -E TELEGRAM_CHAT_ID="

for f in "$Q"/*.json; do
  [ -e "$f" ] || break
  # Alanlar node ile okunur ve kalıpla doğrulanır; uymayan alan "-" olur
  line=$(/usr/bin/node -e '
    const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const i = j.inputs || {};
    const ok = (v, re) => (typeof v === "string" && re.test(v) ? v : "-");
    console.log([ok(j.file, /^[a-z-]+\.yml$/), ok(i.mode, /^[a-z]{2,10}$/), ok(i.marketplace, /^[a-z]{2,15}$/), ok(i.supplier, /^[a-z0-9-]{2,30}$/), ok(i.count, /^\d{1,3}$/)].join(" "));
  ' "$f" 2>/dev/null)
  rm -f "$f"
  read -r file mode mp sup cnt <<< "${line:-- - - - -}"
  log "istek: $file mode=$mode mp=$mp supplier=$sup count=$cnt"
  case "$file" in
    sync.yml)
      case "$mp" in trendyol|hepsiburada) ;; *) log "desteklenmeyen pazaryeri: $mp"; continue ;; esac
      case "$mode" in
        update|auto)
          systemctl start --no-block trentakip-orders.service
          systemctl start --no-block "trentakip-sync-vps@$mp.service"
          log "başlatıldı: trentakip-orders + trentakip-sync-vps@$mp" ;;
        preview) run1 "trentakip-run-preview-$mp" "$QUIET" "$NODE worker/sync.ts preview $mp" ;;
        create)  run1 "trentakip-run-create-$mp" "$QUIET -E SYNC_PART=listings -p After=trentakip-sync-vps@$mp.service" "$NODE worker/sync.ts create $mp" ;;
        *) log "geçersiz mod: $mode" ;;
      esac ;;
    import.yml)
      if [ "$sup" = "all" ] || [ "$sup" = "-" ]; then systemctl start --no-block trentakip-supplier-vps.service; log "başlatıldı: trentakip-supplier-vps"
      else run1 "trentakip-run-import-$sup" "$QUIET -E NODE_OPTIONS=--max-old-space-size=2500 -E ACTOR=panel" "$NODE worker/import-xml.ts $sup"; fi ;;
    invoice-upload.yml)
      case "$mode" in
        audit) run1 "trentakip-run-invoice" "-p EnvironmentFile=/etc/trentakip/panel.env" "$NODE worker/invoice-audit.ts" ;;
        dry|apply) run1 "trentakip-run-invoice" "-p EnvironmentFile=/etc/trentakip/panel.env -E CHROME_BIN=/usr/bin/google-chrome" "$NODE worker/invoice-upload.ts $mode ${cnt/-/200}" ;;
        *) log "geçersiz fatura modu: $mode" ;;
      esac ;;
    catalog.yml) run1 "trentakip-run-catalog" "$QUIET" "$NODE worker/catalog.ts" ;;
    *) log "izinli olmayan iş: $file" ;;
  esac
done
exit 0
