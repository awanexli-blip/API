-- Ürüne bağlı olmayan satıştaki ilanlara stok 0 (K, 27.10: "Royal'in ürünleri şu an satışta yok"): HB'de 846 Royal + 27 eski Toptancım
-- ilanı ~1000'er stokla duruyordu, stok güncellenemediği için satılırsa karşılanamazdı. worker/sync.ts; pazaryeri satırında boş = ortak.
alter table public.settings add column if not exists zero_unlinked boolean not null default false;
alter table public.marketplace_settings add column if not exists zero_unlinked boolean;
update public.marketplace_settings set zero_unlinked = true where marketplace = 'hepsiburada';
