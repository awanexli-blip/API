import type { Metadata } from "next";
import { headers } from "next/headers";
import { basePath, parsePage, parseSort, searchTerm } from "@/lib/store";
import { list } from "@/lib/store-data";
import { Grid, Pager, SortLinks, hrefWith } from "../_ui";

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
  const { items, total, pages } = await list({ q: q || undefined, sort, page });
  const href = hrefWith(`${base}/ara`, { q: q || undefined, sirala: sort === "onerilen" ? undefined : sort, sayfa: page > 1 ? String(page) : undefined });
  return (
    <>
      <nav className="crumbs" aria-label="Konum"><a href={base || "/"}>Ana sayfa</a><span>›</span><span>{q ? "Arama" : "Tüm ürünler"}</span></nav>
      <div className="list-head">
        <div><h1>{q ? `“${q}”` : "Tüm ürünler"}</h1><span className="count">{total.toLocaleString("tr-TR")} ürün</span></div>
        <SortLinks href={href} sort={sort} />
      </div>
      {raw && !q && <p className="empty">Aramak için en az 2 harf yazın.</p>}
      {items.length ? <Grid items={items} base={base} eagerFirst={4} /> : q ? <p className="empty">“{q}” için ürün bulunamadı. Farklı bir kelimeyle deneyin.</p> : null}
      <Pager page={page} pages={pages} href={href} />
    </>
  );
}
