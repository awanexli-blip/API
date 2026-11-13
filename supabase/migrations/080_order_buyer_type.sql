-- Kurumsal fatura (K 13.11, Trendyol "Kurumsal Faturalı Siparişler" rehberi).
-- buyer_type: bireysel | kurumsal | kurumsal_efatura (alıcı e-Fatura mükellefi: e-Arşiv değil e-Fatura kesilir).
-- Ünvan / VKN / vergi dairesi orders.address->'invoice' içinde; adresle birlikte orders_purge_pii ile silinir.
alter table public.orders add column if not exists buyer_type text not null default 'bireysel'
  check (buyer_type in ('bireysel', 'kurumsal', 'kurumsal_efatura'));
create index if not exists orders_buyer_type_idx on public.orders (buyer_type) where buyer_type <> 'bireysel';
