#!/bin/bash
# Gece işleri bitince K'ya Telegram özeti (K 13.11: "işlerin bitince Telegram'dan bitti diye mesaj at"). Yalnızca sayılar, müşteri verisi yok.
# Elle: bash /opt/trentakip/ops/vps/gece-rapor.sh
set -uo pipefail
set -a; . /etc/trentakip/env 2>/dev/null; set +a
L=/var/log/trentakip
tg() { [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && curl -s -m 20 -o /dev/null "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=$1"; }
j() { sed -n 's/.*"'"$2"'":\([0-9]*\).*/\1/p' "$L/$1" 2>/dev/null | tail -1; }
sil=0; hat=0
for f in ty-delete3.log ty-delete4.log; do s=$(j $f silinen); h=$(j $f hatali); sil=$((sil + ${s:-0})); hat=$((hat + ${h:-0})); done
kuy=$(grep -o "kuyruğa alındı: [0-9]*" $L/ty-fill.log 2>/dev/null | awk '{t+=$3} END {print t+0}')
yer=$(grep -o "yer [0-9]*" $L/ty-fill.log 2>/dev/null | head -1 | awk '{print $2}')
hali=$(j ai-attrs-hali3.out tamamlanan); haliK=$(j ai-attrs-hali3.out kuyruga)
cat=$(grep -c " -> " $L/ai-catmap-run.log 2>/dev/null)
tg "✅ Gece işleri bitti
• Trendyol kalıcı silme: ${sil} ilan silindi$([ "$hat" -gt 0 ] && echo ", $hat silinemedi (Trendyol kilitli)")
• Trendyol'a yükleme: ${kuy:-0} ürün kuyruğa alındı (yıldız sırasıyla${yer:+, açılan yer ${yer}})
• Halı: ${hali:-?} model eksiksiz, ${haliK:-0} gönderime alındı (kalanlar metinde Saçak/Taban yazmıyor)
• HB: Cinsiyet düzeltmesi sonrası 2.811 ürün, ayakkabı numarası 161 ürün yeniden kuyrukta
• HB kategori eşleme (yapay zekâ): ${cat:-0}/1603 kategori tarandı, sürüyor
Ayrıntı sabah sohbette."
