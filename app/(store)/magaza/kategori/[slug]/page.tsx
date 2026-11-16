import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { basePath, parsePage, parsePrice, parseSort, tl } from "@/lib/store";
import { categories, list } from "@/lib/store-data";
import { Filters, Grid, Pager, SortLinks, hrefWith } from "../../_ui";
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
  const sort = parseSort(one(sp.sirala)), page = parsePage(one(sp.sayfa));
  let min = parsePrice(one(sp.min)), max = parsePrice(one(sp.max));
  if (min != null && max != null && min > max) [min, max] = [max, min];
  const { items, total, pages } = await list({ top: cat.top, sub: sub?.sub, min, max, sort, page });
  const path = `${base}/kategori/${cat.slug}`;
  const cur = { alt: sub?.slug, min: min?.toString(), max: max?.toString(), sirala: sort === "onerilen" ? undefined : sort, sayfa: page > 1 ? String(page) : undefined };
  const href = hrefWith(path, cur);
  const filters = <Filters cat={cat} sub={sub?.slug} base={base} path={path} cur={cur} min={min} max={max} />;
  const priceLabel = min != null || max != null ? `${min != null ? tl(min) : "0"} - ${max != null ? tl(max) : "üstü"}` : null;
  return (
    <>
      <nav className="crumbs" aria-label="Konum"><a href={base || "/"}>Ana sayfa</a><span aria-hidden="true">/</span><a href={path}>{cat.top}</a>{sub && <><span aria-hidden="true">/</span><span>{sub.sub}</span></>}</nav>
      <div className="page-head">
        <div><h1 className="serif">{sub?.sub ?? cat.top}</h1><div className="count">{total.toLocaleString("tr-TR")} ürün</div></div>
      </div>
      <div className="layout">
        <aside aria-label="Filtreler">{filters}</aside>
        <div>
          <details className="mfilter" style={{ marginBottom: 14 }}><summary>Filtrele <Icon name="filter" /></summary>{filters}</details>
          <div className="toolbar">
            <div className="chips">
              {sub && <a className="chip" href={href({ alt: undefined, sayfa: undefined })} aria-label={`${sub.sub} filtresini kaldır`}>{sub.sub} <Icon name="close" size={14} /></a>}
              {priceLabel && <a className="chip" href={href({ min: undefined, max: undefined, sayfa: undefined })} aria-label="Fiyat filtresini kaldır">{priceLabel} <Icon name="close" size={14} /></a>}
            </div>
            <SortLinks href={href} sort={sort} />
          </div>
          {items.length ? <Grid items={items} base={base} eagerFirst={4} /> : <div className="empty"><h2>Ürün bulunamadı</h2><p>Filtreleri değiştirerek tekrar deneyin.</p><a className="btn ghost" href={path}>Filtreleri temizle</a></div>}
          <Pager page={Math.min(page, pages)} pages={pages} href={href} />
        </div>
      </div>
    </>
  );
}
