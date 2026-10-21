-- Denetim S2.7 (silmesiz kısım) + vitrin sıralaması. Tekrar çalıştırmak güvenli.
-- Yinelenen products_status_idx'in kaldırılması ve price_audit_before kararı kullanıcı onayı bekliyor (silme yok).
create index if not exists marketplace_matches_variant_idx on public.marketplace_matches (variant_id);
create index if not exists products_cost_idx on public.products (cost_price desc nulls last);
create index if not exists products_title_idx on public.products (title);
