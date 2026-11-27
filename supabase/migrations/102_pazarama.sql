-- Pazarama: pazaryeri ayar satırı, HEPSİ KAPALI (canlı yazma yok). Panelden/SQL'den bilinçli açılana kadar sync hiçbir şey yazmaz.
-- Kargo/komisyon oranları Pazarama satıcı panelinden doğrulanınca güncellenir. Tekrar çalıştırmak güvenlidir.
insert into marketplace_settings (marketplace, enabled, auto_sync, auto_create, zero_missing, existing_price_policy, commission_rate, shipping_mode, min_stock)
values ('pazarama', false, false, false, false, 'smart', 0.18, 'fixed', 3)
on conflict (marketplace) do nothing;
