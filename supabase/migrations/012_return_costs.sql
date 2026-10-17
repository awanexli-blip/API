-- İade gideri fiyat formülüne girer: sipariş başı beklenen gider = iade oranı × iade başına maliyet (worker/pricing.ts returnsOf)
-- Varsayılan 0: mevcut fiyatlar kendiliğinden değişmez; değerler panelden (Fiyat ayarları) girilir.
alter table settings add column if not exists return_rate numeric not null default 0 check (return_rate >= 0 and return_rate <= 0.5);
alter table settings add column if not exists return_cost numeric not null default 0 check (return_cost >= 0 and return_cost <= 2000);
alter table marketplace_settings add column if not exists return_rate numeric check (return_rate is null or (return_rate >= 0 and return_rate <= 0.5));
alter table marketplace_settings add column if not exists return_cost numeric check (return_cost is null or (return_cost >= 0 and return_cost <= 2000));
