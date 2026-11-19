import type { Metadata } from "next";
import { headers } from "next/headers";
import { basePath, parsePage, parsePrice, parseSort, searchTerm, imgUrl } from "@/lib/store";
import { categories, list } from "@/lib/store-data";
import { Filters, Grid, ListMeta, Pager, hrefWith, priceChip, type Crumb } from "../_ui";
import ListTools from "../ListTools";
import Icon from "../Icon";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const name = (v: string | string[] | undefined) => { const t = String(one(v) ?? "").trim(); return t && t.length <= 120 ? t : undefined; };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = searchTerm(one((await searchParams).q));
  return { title: q ? `"${q}" araması` : "Tüm ürünler" };
}

// Arama sayfası (K 19.11): kelimeler herhangi sırada, Türkçe harfe duyarsız; kategori (üst > alt > tür) ve fiyat yüzeyi sayılı
export default async function SearchPage({ searchParams }: Props) {
  const [sp, h] = await Promise.all([searchParams, headers()]);
  const base = basePath(h.get("host"));
  const raw = String(one(sp.q) ?? "").trim();
  const q = searchTerm(raw);
  const kat = name(sp.kat), alt = kat ? name(sp.alt) : undefined, tur = alt ? name(sp.tur) : undefined;
  const sort = parseSort(one(sp.sirala)), page = parsePage(one(sp.sayfa));
  let min = parsePrice(one(sp.min)), max = parsePrice(one(sp.max));
  if (min != null && max != null && min > max) [min, max] = [max, min];
  const [res, cats] = await Promise.all([list({ q: q || undefined, top: kat, sub: alt, leaf: tur, min, max, sort, page }), categories().catch(() => [])]);
  const { items, total, pages, fuzzy, facets } = res;
  const path = `${base}/ara`;
  const cur = { q: q || undefined, kat, alt, tur, min: min?.toString(), max: max?.toString(), sirala: sort === "onerilen" ? undefined : sort, sayfa: page > 1 ? String(page) : undefined };
  const href = hrefWith(path, cur);
  const pick = (n: string) => {
    if (facets?.level === "top") return { href: href({ kat: n, alt: undefined, tur: undefined, sayfa: undefined }), on: false };
    if (facets?.level === "sub") return { href: href({ alt: n, tur: undefined, sayfa: undefined }), on: false };
    return { href: href({ tur: tur === n ? undefined : n, sayfa: undefined }), on: tur === n };
  };
  const trail: Crumb[] = [];
  if (kat) trail.push({ label: "Tüm kategoriler", href: href({ kat: undefined, alt: undefined, tur: undefined, sayfa: undefined }) });
  if (alt) trail.push({ label: kat!, href: href({ alt: undefined, tur: undefined, sayfa: undefined }) });
  const chips: Crumb[] = [];
  if (q) chips.push({ label: `“${q}”`, href: href({ q: undefined, sayfa: undefined }) });
  if (kat) chips.push({ label: kat, href: href({ kat: undefined, alt: undefined, tur: undefined, sayfa: undefined }) });
  if (alt) chips.push({ label: alt, href: href({ alt: undefined, tur: undefined, sayfa: undefined }) });
  if (tur) chips.push({ label: tur, href: href({ tur: undefined, sayfa: undefined }) });
  const pc = priceChip(min, max);
  if (pc) chips.push({ label: pc, href: href({ min: undefined, max: undefined, sayfa: undefined }) });
  const note = raw && !q ? "Aramak için en az 2 harf yazın." : fuzzy && total ? `“${q}” için tam eşleşme yok, benzer ürünler gösteriliyor.` : null;
  const filters = (idp = "") => <Filters path={path} cur={cur} facets={facets} min={min} max={max} catTitle={alt ?? kat ?? "Kategoriler"} trail={trail} pick={pick} idp={idp} />;
  const title = q ? `“${q}” için sonuçlar` : tur ?? alt ?? kat ?? "Tüm ürünler";
  return (
    <>
      <nav className="crumbs" aria-label="Konum"><a href={base || "/"}>Ana sayfa</a><span aria-hidden="true">›</span><span>{q ? "Arama" : "Tüm ürünler"}</span></nav>
      <div className="page-head">
        <h1>{title}</h1>
        <details className="mfilter"><summary><Icon name="filter" /> Filtrele{chips.length > (q ? 1 : 0) ? ` (${chips.length - (q ? 1 : 0)})` : ""}</summary>{filters("m-")}</details>
      </div>
      {!q && !kat && cats.length > 0 && (
        <div className="cats" style={{ marginBottom: 24 }}>
          {cats.slice(0, 7).map((c) => <a key={c.slug} className="catcard" href={`${base}/kategori/${c.slug}`}><span>{c.image ? <img src={imgUrl(c.image)!} alt="" width={140} height={140} loading="lazy" /> : null}</span>{c.top}</a>)}
        </div>
      )}
      <div className="layout">
        <aside className="side" aria-label="Filtreler">{filters()}</aside>
        <div>
          <ListTools action={path} keep={{ kat, alt, tur, min: min?.toString(), max: max?.toString() }} q={q} sort={sort} placeholder="Ürün ara" />
          <ListMeta total={total} chips={chips} note={note} />
          {items.length ? <Grid items={items} base={base} eagerFirst={4} /> : (
            <div className="empty panel">
              <h2>Sonuç bulunamadı</h2>
              <p>{q ? `“${q}” için ürün bulunamadı. Yazımı kontrol edin, daha kısa ya da genel bir kelime deneyin (örneğin “dolap kilidi” yerine “kilit”).` : "Filtreleri değiştirerek tekrar deneyin."}</p>
              {chips.length > 1 && <p><a className="btn quiet" href={hrefWith(path, {})({ q: q || undefined })}>Filtreleri temizle</a></p>}
              {cats.length > 0 && <div className="sugg"><span>Kategorilere göz atın:</span>{cats.slice(0, 8).map((c) => <a key={c.slug} className="chip" href={`${base}/kategori/${c.slug}`}>{c.top}</a>)}</div>}
            </div>
          )}
          <Pager page={Math.min(page, pages)} pages={pages} href={href} />
        </div>
      </div>
    </>
  );
}
