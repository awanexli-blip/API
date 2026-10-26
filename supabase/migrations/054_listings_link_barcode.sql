-- İlan <-> varyant bağı barkodla da kurulur (26.10): veritabanı sıfırdan kurulunca (025.10 yeni proje) gönderimde yazılan variant_id kayboldu,
-- 23.775 Trendyol / 14.011 HB ilanı ürüne bağlı değildi ve stok/fiyat gitmiyordu. Her senkronda bağsız ilanlar varyant barkoduyla eşlenir.
create or replace function listings_link(mp text) returns int language plpgsql set search_path = public as $$
declare n int; m int;
begin
  update marketplace_listings ml set variant_id = v.id, product_id = v.product_id, updated_at = now()
  from product_variants v join products p on p.id = v.product_id
  where ml.marketplace = mp and ml.variant_id is null and p.source = 'xml:bayilik'
    and v.sku = regexp_replace(ml.listing_key, '^(ÖS13-|OS13-)', '');
  get diagnostics n = row_count;
  update marketplace_listings ml set variant_id = v.id, product_id = v.product_id, updated_at = now()
  from product_variants v
  where ml.marketplace = mp and ml.variant_id is null and v.barcode = ml.listing_key;
  get diagnostics m = row_count;
  return n + m;
end $$;
revoke execute on function listings_link(text) from public, anon, authenticated;
grant execute on function listings_link(text) to service_role;
