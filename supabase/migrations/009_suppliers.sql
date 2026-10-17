-- Çoklu tedarikçi: her tedarikçinin XML adresi ve alan eşlemesi. Ürünler "xml:<code>" kaynağıyla products'a girer.
-- xml_url yalnızca sunucuda okunur (RLS, service_role); tarayıcıya maskelenmiş gider.
-- url_from_env: adres ortam değişkeninden (BayilikXML için GitHub Secret XML_URL).
create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9-]{2,30}$'),
  name text not null check (char_length(name) between 1 and 80),
  xml_url text,
  url_from_env text,
  active boolean not null default true,
  nightly boolean not null default false,          -- gece içe aktarmaya dahil
  item_path text,                                  -- ürün listesinin yolu (boş = otomatik bul)
  mapping jsonb not null default '{}'::jsonb,      -- { "xml.alan.yolu": "model" | "title" | ... } (lib/import.ts Field)
  sku_prefix text not null default '' check (sku_prefix ~ '^[A-Za-z0-9._-]{0,12}$'),
  sku_ascii boolean not null default true,         -- SKU'dan Türkçe/özel karakterleri at
  price_includes_vat boolean not null default true,
  default_vat int not null default 20 check (default_vat in (0, 1, 10, 20)),
  default_brand text not null default '',          -- XML'de marka yoksa / kullanılmayacaksa
  currency text not null default 'TRY' check (currency in ('TRY', 'USD', 'EUR')),
  last_run_at timestamptz,
  last_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table suppliers enable row level security;
alter table import_jobs add column if not exists supplier text;

insert into suppliers (code, name, url_from_env, nightly, mapping, sku_prefix, sku_ascii, default_brand)
values ('bayilik', 'BayilikXML', 'XML_URL', false,
  '{"productCode":"model","name":"title","detail":"description","category":"category","price":"cost_price","currency":"currency","quantity":"stock","barcode":"barcode","desi":"desi","image1":"images","image2":"images","image3":"images","image4":"images","image5":"images","image6":"images","image7":"images","image8":"images","image9":"images","image10":"images","image11":"images","image12":"images"}',
  '', true, 'Eco Lounge')
on conflict (code) do nothing;
