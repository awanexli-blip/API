import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { basePath, parsePage, parseSort } from "@/lib/store";
import { categories, list } from "@/lib/store-data";
import { Grid, Pager, SortLinks, hrefWith } from "../../_ui";

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
  const altSlug = one(sp.alt);
  const sub = altSlug ? cat.subs.find((s) => s.slug === altSlug) : undefined;
  const sort = parseSort(one(sp.sirala)), page = parsePage(one(sp.sayfa));
  const { items, total, pages } = await list({ top: cat.top, sub: sub?.sub, sort, page });
  if (page > pages && total > 0) notFound();
  const path = `${base}/kategori/${cat.slug}`;
  const href = hrefWith(path, { alt: sub?.slug, sirala: sort === "onerilen" ? undefined : sort, sayfa: page > 1 ? String(page) : undefined });
  return (
    <>
      <nav className="crumbs" aria-label="Konum"><a href={base || "/"}>Ana sayfa</a><span>›</span><a href={path}>{cat.top}</a>{sub && <><span>›</span><span>{sub.sub}</span></>}</nav>
      <div className="list-head">
        <div><h1>{sub?.sub ?? cat.top}</h1><span className="count">{total.toLocaleString("tr-TR")} ürün</span></div>
        <SortLinks href={href} sort={sort} />
      </div>
      {cat.subs.length > 1 && (
        <nav className="chips" aria-label="Alt kategoriler">
          <a href={hrefWith(path, { sirala: sort === "onerilen" ? undefined : sort })({})} aria-current={!sub ? "page" : undefined}>Tümü <small>{cat.n}</small></a>
          {cat.subs.map((s) => <a key={s.slug} href={hrefWith(path, { alt: s.slug, sirala: sort === "onerilen" ? undefined : sort })({})} aria-current={sub?.slug === s.slug ? "page" : undefined}>{s.sub} <small>{s.n}</small></a>)}
        </nav>
      )}
      {items.length ? <Grid items={items} base={base} eagerFirst={4} /> : <p className="empty">Bu kategoride şu an ürün yok.</p>}
      <Pager page={page} pages={pages} href={href} />
    </>
  );
}
