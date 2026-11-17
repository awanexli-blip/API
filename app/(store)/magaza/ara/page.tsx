import type { Metadata } from "next";
import { headers } from "next/headers";
import { basePath, parsePage, parsePrice, parseSort, searchTerm, imgUrl, tl } from "@/lib/store";
import { categories, list } from "@/lib/store-data";
import { Filters, Grid, Pager, hrefWith } from "../_ui";
import ListTools from "../ListTools";
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
  const priceLabel = min != null || max != null ? `${min != null ? tl(min) : "0 TL"} - ${max != null ? tl(max) : "üstü"}` : null;
  return (
    <>
      <nav className="crumbs" aria-label="Konum"><a href={base || "/"}>Ana sayfa</a><span aria-hidden="true">›</span><span>{q ? "Arama" : "Tüm ürünler"}</span></nav>
      <div className="page-head">
        <h1>{q ? `“${q}” için sonuçlar` : "Tüm ürünler"}</h1>
        <details className="mfilter"><summary><Icon name="filter" /> Filtrele</summary><Filters path={path} cur={cur} min={min} max={max} idp="m-" /></details>
      </div>
      {!q && cats.length > 0 && (
        <div className="cats" style={{ marginBottom: 24 }}>
          {cats.slice(0, 7).map((c) => <a key={c.slug} className="catcard" href={`${base}/kategori/${c.slug}`}><span>{c.image ? <img src={imgUrl(c.image)!} alt="" width={140} height={140} loading="lazy" /> : null}</span>{c.top}</a>)}
        </div>
      )}
      <div className="layout">
        <aside className="side" aria-label="Filtreler"><Filters path={path} cur={cur} min={min} max={max} /></aside>
        <div>
          <ListTools action={path} keep={{ min: min?.toString(), max: max?.toString() }} q={q} sort={sort} placeholder="Ürün ara" />
          <div className="listmeta">
            <span><b>{total.toLocaleString("tr-TR")}</b> ürün</span>
            {raw && !q && <span>Aramak için en az 2 harf yazın.</span>}
            {priceLabel && <a className="chip" href={href({ min: undefined, max: undefined, sayfa: undefined })} aria-label="Fiyat filtresini kaldır">{priceLabel} <Icon name="close" size={14} /></a>}
          </div>
          {items.length ? <Grid items={items} base={base} eagerFirst={4} /> : <div className="empty panel"><h2>Sonuç bulunamadı</h2><p>{q ? `“${q}” için ürün bulunamadı. Daha kısa ya da farklı bir kelime deneyin.` : "Filtreleri değiştirerek tekrar deneyin."}</p></div>}
          <Pager page={Math.min(page, pages)} pages={pages} href={href} />
        </div>
      </div>
    </>
  );
}
