import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { basePath, parsePage, parsePrice, parseSort, searchTerm, slugify } from "@/lib/store";
import { categories, list } from "@/lib/store-data";
import { Filters, Grid, ListMeta, Pager, hrefWith, priceChip, type Crumb } from "../../_ui";
import ListTools from "../../ListTools";
import Icon from "../../Icon";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const c = (await categories()).find((x) => x.slug === slug);
  return { title: c ? c.top : "Kategori" };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const [{ slug }, sp, h] = await Promise.all([params, searchParams, headers()]);
  const base = basePath(h.get("host"));
  const cat = (await categories()).find((x) => x.slug === slug);
  if (!cat) notFound();
  const sub = cat.subs.find((s) => s.slug === one(sp.alt));
  const turRaw = String(one(sp.tur) ?? "").trim();
  const tur = sub && turRaw && turRaw.length <= 120 ? turRaw : undefined;
  const q = searchTerm(one(sp.q));
  const sort = parseSort(one(sp.sirala)), page = parsePage(one(sp.sayfa));
  let min = parsePrice(one(sp.min)), max = parsePrice(one(sp.max));
  if (min != null && max != null && min > max) [min, max] = [max, min];
  const { items, total, pages, fuzzy, facets } = await list({ top: cat.top, sub: sub?.sub, leaf: tur, q: q || undefined, min, max, sort, page });
  const path = `${base}/kategori/${cat.slug}`;
  const cur = { alt: sub?.slug, tur, q: q || undefined, min: min?.toString(), max: max?.toString(), sirala: sort === "onerilen" ? undefined : sort, sayfa: page > 1 ? String(page) : undefined };
  const href = hrefWith(path, cur);
  const pick = (n: string) => facets?.level === "leaf"
    ? { href: href({ tur: tur === n ? undefined : n, sayfa: undefined }), on: tur === n }
    : { href: href({ alt: slugify(n), tur: undefined, sayfa: undefined }), on: false };
  const trail: Crumb[] = sub ? [{ label: `${cat.top} (tümü)`, href: href({ alt: undefined, tur: undefined, sayfa: undefined }) }] : [];
  const chips: Crumb[] = [];
  if (q) chips.push({ label: `“${q}”`, href: href({ q: undefined, sayfa: undefined }) });
  if (sub) chips.push({ label: sub.sub, href: href({ alt: undefined, tur: undefined, sayfa: undefined }) });
  if (tur) chips.push({ label: tur, href: href({ tur: undefined, sayfa: undefined }) });
  const pc = priceChip(min, max);
  if (pc) chips.push({ label: pc, href: href({ min: undefined, max: undefined, sayfa: undefined }) });
  const filters = (idp = "") => <Filters path={path} cur={cur} facets={facets} min={min} max={max} catTitle={sub?.sub ?? cat.top} trail={trail} pick={pick} idp={idp} />;
  return (
    <>
      <nav className="crumbs" aria-label="Konum"><a href={base || "/"}>Ana sayfa</a><span aria-hidden="true">›</span><a href={path}>{cat.top}</a>{sub && <><span aria-hidden="true">›</span><a href={href({ tur: undefined, q: undefined, sayfa: undefined })}>{sub.sub}</a></>}{tur && <><span aria-hidden="true">›</span><span>{tur}</span></>}</nav>
      <div className="page-head">
        <h1>{tur ?? sub?.sub ?? cat.top}</h1>
        <details className="mfilter"><summary><Icon name="filter" /> Filtrele{chips.length ? ` (${chips.length})` : ""}</summary>{filters("m-")}</details>
      </div>
      <div className="layout">
        <aside className="side" aria-label="Filtreler">{filters()}</aside>
        <div>
          <ListTools action={path} keep={{ alt: sub?.slug, tur, min: min?.toString(), max: max?.toString() }} q={q} sort={sort} placeholder={`${tur ?? sub?.sub ?? cat.top} içinde ara`} />
          <ListMeta total={total} chips={chips} note={fuzzy && total ? `“${q}” için tam eşleşme yok, benzer ürünler gösteriliyor.` : null} />
          {items.length ? <Grid items={items} base={base} eagerFirst={4} /> : <div className="empty panel"><h2>Ürün bulunamadı</h2><p>Filtreleri değiştirerek tekrar deneyin.</p><a className="btn quiet" href={path}>Filtreleri temizle</a></div>}
          <Pager page={Math.min(page, pages)} pages={pages} href={href} />
        </div>
      </div>
    </>
  );
}
