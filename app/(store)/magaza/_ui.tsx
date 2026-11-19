// Vitrin ortak parçaları (sunucu bileşenleri). Kart düzeni Bezos'tan ilham: beyaz kart, Stokta rozeti, görsel, ince ayırıcı, bilgi, fiyat kutusu.
import { imgUrl, tl, PRICE_BANDS } from "@/lib/store";
import type { Card, Facets } from "@/lib/store-data";
import Icon from "./Icon";

// Rozet yalnızca gerçek bilgiden: "Çok satan" (pazaryerinde son 60 günde satıldı), "Yeni" (mağazaya son eklenen)
export function ProductCard({ p, base, eager = false, tag }: { p: Card & { sold?: number }; base: string; eager?: boolean; tag?: "cok" | "yeni" }) {
  const src = imgUrl(p.image);
  return (
    <article className="card">
      <div className="media">
        {src ? <img src={src} alt="" width={400} height={400} loading={eager ? undefined : "lazy"} decoding="async" /> : <div className="noimg">Görsel yok</div>}
        {tag === "cok" && <span className="tag">Çok satan</span>}
        {tag === "yeni" && <span className="tag new">Yeni</span>}
      </div>
      <div className="body">
        {p.leaf && <div className="cat">{p.leaf}</div>}
        <h3><a className="card-link" href={`${base}/urun/${p.slug}`}>{p.title}</a></h3>
        {p.sold ? <div className="sold">Son 60 günde {p.sold} adet satıldı</div> : null}
        <div className="price">{tl(p.price)}</div>
      </div>
    </article>
  );
}

export function Grid({ items, base, eagerFirst = 0 }: { items: Card[]; base: string; eagerFirst?: number }) {
  return <div className="grid">{items.map((p, i) => <ProductCard key={p.product_id} p={p} base={base} eager={i < eagerFirst} />)}</div>;
}
export function Rail({ items, base, tag }: { items: (Card & { sold?: number })[]; base: string; tag?: "cok" | "yeni" }) {
  return <div className="rail">{items.map((p) => <ProductCard key={p.product_id} p={p} base={base} tag={tag} />)}</div>;
}

export function Pager({ page, pages, href }: { page: number; pages: number; href: (q: Record<string, string | number | undefined>) => string }) {
  if (pages <= 1) return null;
  const nums = [...new Set([1, page - 1, page, page + 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: React.ReactNode[] = [];
  nums.forEach((n, i) => {
    if (i && n - nums[i - 1] > 1) out.push(<span key={`g${n}`} aria-hidden="true">…</span>);
    out.push(n === page ? <span key={n} aria-current="page">{n}</span> : <a key={n} href={href({ sayfa: n === 1 ? undefined : n })}>{n}</a>);
  });
  return (
    <nav className="pager" aria-label="Sayfalar">
      {page > 1 && <a href={href({ sayfa: page - 1 === 1 ? undefined : page - 1 })} aria-label="Önceki sayfa"><Icon name="back" size={18} /></a>}
      {out}
      {page < pages && <a href={href({ sayfa: page + 1 })} aria-label="Sonraki sayfa"><Icon name="next" size={18} /></a>}
    </nav>
  );
}

// Filtre kartı (K 19.11 ayrıntılı arama): sayılı kategori ağacı (üst > alt > tür, yukarı dönüş bağlantılı), sayılı fiyat aralıkları,
// ücretsiz kargo, özel aralık (form GET, JS gerekmez). Sayılar arama/filtre sonucuna göre (store_search yüzeyi).
export type Crumb = { label: string; href: string };
export function Filters({ path, cur, facets, min, max, catTitle, trail, pick, idp = "" }: {
  path: string; cur: Record<string, string | undefined>; facets: Facets | null; min?: number; max?: number;
  catTitle: string; trail: Crumb[]; pick: (name: string) => { href: string; on: boolean }; idp?: string;
}) {
  const h = hrefWith(path, cur);
  const cats = facets?.cats ?? [];
  const head = cats.slice(0, 8), rest = cats.slice(8);
  const item = (c: { name: string; n: number }) => { const p = pick(c.name); return <li key={c.name}><a href={p.href} aria-current={p.on ? "page" : undefined}>{c.name} <small>{c.n.toLocaleString("tr-TR")}</small></a></li>; };
  const freeOn = min === 500 && max == null;
  const active = Object.entries(cur).some(([k, v]) => v && !["sirala", "sayfa", "q"].includes(k));
  return (
    <div className="filters panel">
      {(trail.length > 0 || cats.length > 0) && (
        <section aria-labelledby={`${idp}f-cat`}>
          <h2 id={`${idp}f-cat`}>{catTitle}</h2>
          {trail.map((t) => <a key={t.href} className="up" href={t.href}><Icon name="back" size={14} /> {t.label}</a>)}
          {cats.length > 0 && <ul>{head.map(item)}</ul>}
          {rest.length > 0 && <details className="more-cats"><summary>{rest.length} kategori daha</summary><ul>{rest.map(item)}</ul></details>}
        </section>
      )}
      <section aria-labelledby={`${idp}f-price`}>
        <h2 id={`${idp}f-price`}>Fiyat</h2>
        <ul>
          {PRICE_BANDS.map(([a, b, label], i) => {
            const on = a === min && b === max;
            const n = facets?.bands?.[i];
            if (!on && n === 0) return null;
            return <li key={label}><a href={h({ min: on ? undefined : a, max: on ? undefined : b, sayfa: undefined })} aria-current={on ? "page" : undefined}>{label} {n != null && <small>{n.toLocaleString("tr-TR")}</small>}</a></li>;
          })}
          {(freeOn || (facets?.free ?? 0) > 0) && (
            <li><a href={h({ min: freeOn ? undefined : 500, max: undefined, sayfa: undefined })} aria-current={freeOn ? "page" : undefined}><span><Icon name="truck" size={16} /> Ücretsiz kargo</span> {facets && <small>{facets.free.toLocaleString("tr-TR")}</small>}</a></li>
          )}
        </ul>
        <form className="range" action={path}>
          {Object.entries(cur).filter(([k, v]) => v && !["min", "max", "sayfa"].includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <label className="sr" htmlFor={`${idp}fmin`}>En az fiyat</label><input id={`${idp}fmin`} name="min" inputMode="numeric" placeholder={facets?.pmin != null ? `En az ${facets.pmin}` : "En az"} defaultValue={min ?? ""} />
          <label className="sr" htmlFor={`${idp}fmax`}>En çok fiyat</label><input id={`${idp}fmax`} name="max" inputMode="numeric" placeholder={facets?.pmax != null ? `En çok ${facets.pmax}` : "En çok"} defaultValue={max ?? ""} />
          <button type="submit">Uygula</button>
        </form>
      </section>
      {active && <section><a className="btn quiet clear-all" href={h({ kat: undefined, alt: undefined, tur: undefined, min: undefined, max: undefined, sayfa: undefined })}>Tüm filtreleri temizle</a></section>}
    </div>
  );
}

// Seçili filtre çipleri (her biri tek tıkla kaldırılır) + sonuç sayısı
export function ListMeta({ total, chips, note }: { total: number; chips: Crumb[]; note?: string | null }) {
  return (
    <div className="listmeta">
      <span><b>{total.toLocaleString("tr-TR")}</b> ürün</span>
      {chips.map((c) => <a key={c.href + c.label} className="chip" href={c.href} aria-label={`${c.label} filtresini kaldır`}>{c.label} <Icon name="close" size={14} /></a>)}
      {note && <span className="note">{note}</span>}
    </div>
  );
}

export const priceChip = (min?: number, max?: number) =>
  min === 500 && max == null ? "Ücretsiz kargo (500 TL+)" : min != null || max != null ? `${min != null ? tl(min) : "0 TL"} - ${max != null ? tl(max) : "üstü"}` : null;

// Mevcut sorgu parametrelerini koruyarak adres üret
export function hrefWith(path: string, cur: Record<string, string | undefined>) {
  return (q: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...cur, ...q })) if (v != null && v !== "") p.set(k, String(v));
    const s = p.toString();
    return s ? `${path}?${s}` : path;
  };
}
