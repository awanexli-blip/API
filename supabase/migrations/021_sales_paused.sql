-- Satışı durdur (panel, pazaryeri bazında): açıkken senkron satıştaki bütün ilanlara stok 0 gönderir, başka işlem yapmaz.
alter table settings add column if not exists sales_paused boolean not null default false;
alter table marketplace_settings add column if not exists sales_paused boolean;
