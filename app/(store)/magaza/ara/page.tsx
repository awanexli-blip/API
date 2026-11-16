import type { Metadata } from "next";
import { headers } from "next/headers";
import { basePath, parsePage, parsePrice, parseSort, searchTerm, imgUrl, tl } from "@/lib/store";
import { categories, list } from "@/lib/store-data";
import { Filters, Grid, Pager, SortLinks, hrefWith } from "../_ui";
import Icon from "../Icon";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = searchTerm(one((await searchParams).q));
  return { title: q ? `"${q}" araması` : "Tüm ürünler" };
}

export default async function SearchPage({ searchParams }: Props) {
  const [sp, h] = await Promise.all([searchParams, headers()]);
  const base = basePath(h.get("host"));
  const raw = String(one(sp.q) ?? "").trim();
  const q = searchTerm(raw);
  const sort = parseSort(one(sp.sirala)), page = parsePage(one(sp.sayfa));
  let min = parsePrice(one(sp.min)), max = parsePrice(one(sp.max));
  if (min != null && max != null && min > max) [min, max] = [max, min];
  const [{ items, total, pages }, cats] = await Promise.all([list({ q: q || undefined, min, max, sort, page }), q ? Promise.resolve([]) : categories()]);
  const path = `${base}/ara`;
  const cur = { q: q || undefined, min: min?.toString(), max: max?.toString(), sirala: sort === "onerilen" ? undefined : sort, sayfa: page > 1 ? String(page) : undefined };
  const href = hrefWith(path, cur);
  const filters = <Filters base={base} path={path} cur={cur} min={min} max={max} />;
  const priceLabel = min != null || max != null ? `${min != null ? tl(min) : "0"} - ${max != null ? tl(max) : "üstü"}` : null;
  return (
    <>
      <nav className="crumbs" aria-label="Konum"><a href={base || "/"}>Ana sayfa</a><span aria-hidden="true">/</span><span>{q ? "Arama" : "Tüm ürünler"}</span></nav>
      <div className="page-head">
        <div><h1 className="serif">{q ? `“${q}”` : "Tüm ürünler"}</h1><div className="count">{total.toLocaleString("tr-TR")} ürün</div></div>
        <form className="search" action={path} role="search" style={{ maxWidth: 420, flexBasis: 320 }}>
          <label className="sr" htmlFor="q2">Ürün ara</label><Icon name="search" />
          <input id="q2" name="q" type="search" defaultValue={q} placeholder="Ürün ara" minLength={2} maxLength={80} enterKeyHint="search" />
          <button type="submit">Ara</button>
        </form>
      </div>
      {raw && !q && <p className="muted">Aramak için en az 2 harf yazın.</p>}
      {!q && cats.length > 0 && (
        <div className="circles" style={{ marginBottom: 32 }}>
          {cats.map((c) => <a key={c.slug} className="circle" href={`${base}/kategori/${c.slug}`}><span className="ph">{c.image ? <img src={imgUrl(c.image)!} alt="" width={90} height={90} loading="lazy" /> : null}</span>{c.top}</a>)}
        </div>
      )}
      <div className="layout">
        <aside aria-label="Filtreler">{filters}</aside>
        <div>
          <details className="mfilter" style={{ marginBottom: 14 }}><summary>Filtrele <Icon name="filter" /></summary>{filters}</details>
          <div className="toolbar">
            <div className="chips">{priceLabel && <a className="chip" href={href({ min: undefined, max: undefined, sayfa: undefined })} aria-label="Fiyat filtresini kaldır">{priceLabel} <Icon name="close" size={14} /></a>}</div>
            <SortLinks href={href} sort={sort} />
          </div>
          {items.length ? <Grid items={items} base={base} eagerFirst={4} /> : <div className="empty"><h2>Sonuç bulunamadı</h2><p>{q ? `“${q}” için ürün bulunamadı. Farklı bir kelime deneyin.` : "Filtreleri değiştirerek tekrar deneyin."}</p></div>}
          <Pager page={Math.min(page, pages)} pages={pages} href={href} />
        </div>
      </div>
    </>
  );
}
