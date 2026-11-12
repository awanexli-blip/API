-- İlan yaşam döngüsü (K 12.11, worker/core/lifecycle.ts): stok bitince arşiv, gelince arşivden çıkar, uzun süre ölü ise sil, geri gelince yeniden gönder.
alter table marketplace_listings add column if not exists out_since timestamptz;   -- ilk kez satılabilir stoksuz görüldüğü an (stok gelince null)
alter table listing_retire add column if not exists restored_at timestamptz;          -- arşivden çıkarıldığı an
alter table listing_retire add column if not exists reason text;                      -- arşiv/silme nedeni
create index if not exists marketplace_listings_out_since on marketplace_listings (marketplace, out_since) where out_since is not null;
