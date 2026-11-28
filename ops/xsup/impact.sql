-- Tedarikçiler arası en ucuz kaynak: etki raporu (K 28.11). YALNIZCA OKUR; bayrak kapalıyken de çalışır (p_force = true).
--   docker exec -i trentakip-db-1 psql -U postgres < ops/xsup/impact.sql
\echo '== Eşleşme grupları'
select method, count(distinct group_key) groups, count(*) members from product_xgroups group by 1 order by 1;
select split_part(p.source, ':', 2) supplier, count(*) members from product_xgroups g join products p on p.id = g.product_id group by 1 order by 2 desc;

\echo '== Sıfırlanacak canlı ilanlar (kaybedenler) ve ortalama maliyet/fiyat düşüşü, kazanç eşiğine göre'
select m.mp, g.gain_pct, count(*) losers,
  count(*) filter (where x.stock > 0) losers_with_stock,
  round(avg(100 * (x.loser_cost - x.winner_cost) / x.loser_cost), 1) avg_drop_pct,
  round(avg(x.loser_cost - x.winner_cost), 1) avg_drop_try,
  round(sum(x.loser_cost - x.winner_cost)) total_try
from (values ('hepsiburada'), ('pazarama')) m(mp)
cross join (values (0::numeric), (3), (5), (10)) g(gain_pct)
cross join lateral (
  select l.loser_cost, l.winner_cost, ls.stock
  from public.xsup_losers(m.mp, 3, g.gain_pct, true) l
  join marketplace_listings ls on ls.marketplace = m.mp and ls.listing_key = l.listing_key) x
group by 1, 2 order by 1, 2;

\echo '== Kazanan tedarikçi dağılımı (HB, eşik 3)'
select split_part(pw.source, ':', 2) winner_supplier, split_part(pl.source, ':', 2) loser_supplier, count(*) n,
  round(avg(100 * (l.loser_cost - l.winner_cost) / l.loser_cost), 1) avg_drop_pct
from public.xsup_losers('hepsiburada', 3, 3, true) l
join marketplace_listings a on a.marketplace = 'hepsiburada' and a.listing_key = l.listing_key join products pl on pl.id = a.product_id
join marketplace_listings b on b.marketplace = 'hepsiburada' and b.listing_key = l.winner_key join products pw on pw.id = b.product_id
group by 1, 2 order by 3 desc limit 25;

\echo '== Yeni ilan gerekecek kazananlar (gönderim adayı), eşiğe göre'
select mp, gain_pct, count(*) winners_need_listing, round(avg(100 * (c.ref_cost - c.cost) / c.ref_cost), 1) avg_drop_pct,
  round(avg(c.ref_cost - c.cost), 1) avg_drop_try,
  count(*) filter (where c.source = 'xml:akillibayi') from_akillibayi
from (values ('hepsiburada'), ('pazarama')) m(mp),
     (values (0::numeric), (3), (5), (10)) g(gain_pct),
     lateral public.xsup_send_candidates(m.mp, 3, g.gain_pct, true) c
group by 1, 2 order by 1, 2;
