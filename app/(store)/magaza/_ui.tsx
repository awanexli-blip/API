// Vitrin ortak parçaları (sunucu bileşenleri)
import { imgUrl, tl, SORTS, PRICE_BANDS, type Sort } from "@/lib/store";
import type { Card, TopCat } from "@/lib/store-data";
import Icon from "./Icon";

export function ProductCard({ p, base, eager = false }: { p: Card; base: string; eager?: boolean }) {
  const src = imgUrl(p.image);
  return (
    <article className="card">
      <div className="media">{src ? <img src={src} alt="" width={400} height={500} loading={eager ? undefined : "lazy"} decoding="async" /> : <div className="noimg">Görsel yok</div>}</div>
      {p.leaf && <div className="cat">{p.leaf}</div>}
      <h3><a className="card-link" href={`${base}/urun/${p.slug}`}>{p.title}</a></h3>
      <div className="price">{tl(p.price)}</div>
    </article>
  );
}

export function Grid({ items, base, eagerFirst = 0 }: { items: Card[]; base: string; eagerFirst?: number }) {
  return <div className="grid">{items.map((p, i) => <ProductCard key={p.product_id} p={p} base={base} eager={i < eagerFirst} />)}</div>;
}
export function Rail({ items, base }: { items: Card[]; base: string }) {
  return <div className="rail">{items.map((p) => <ProductCard key={p.product_id} p={p} base={base} />)}</div>;
}

export function SortLinks({ href, sort }: { href: (q: Record<string, string | number | undefined>) => string; sort: Sort }) {
  return (
    <nav className="sort" aria-label="Sıralama">
      {(Object.keys(SORTS) as Sort[]).map((k) => <a key={k} href={href({ sirala: k === "onerilen" ? undefined : k, sayfa: undefined })} aria-current={k === sort ? "true" : undefined}>{SORTS[k]}</a>)}
    </nav>
  );
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
      {page < pages && <a href={href({ sayfa: page + 1 })} aria-label="Sonraki sayfa"><span style={{ display: "inline-flex", transform: "scaleX(-1)" }}><Icon name="back" size={18} /></span></a>}
    </nav>
  );
}

// Filtre paneli: alt kategoriler (kategori sayfasında), fiyat bantları, özel fiyat aralığı (form GET, JS gerekmez)
export function Filters({ cat, sub, base, path, cur, min, max }: {
  cat?: TopCat; sub?: string; base: string; path: string; cur: Record<string, string | undefined>; min?: number; max?: number;
}) {
  const h = hrefWith(path, cur);
  return (
    <div className="filters">
      {cat && cat.subs.length > 1 && (
        <section aria-labelledby="f-sub">
          <h2 id="f-sub">Kategori</h2>
          <ul>
            <li><a href={h({ alt: undefined, sayfa: undefined })} aria-current={!sub ? "page" : undefined}>Tümü <small>{cat.n.toLocaleString("tr-TR")}</small></a></li>
            {cat.subs.map((s) => <li key={s.slug}><a href={h({ alt: s.slug, sayfa: undefined })} aria-current={sub === s.slug ? "page" : undefined}>{s.sub} <small>{s.n.toLocaleString("tr-TR")}</small></a></li>)}
          </ul>
        </section>
      )}
      <section aria-labelledby="f-price">
        <h2 id="f-price">Fiyat</h2>
        <ul>
          {PRICE_BANDS.map(([a, b, label]) => {
            const on = a === min && b === max;
            return <li key={label}><a href={h({ min: on ? undefined : a, max: on ? undefined : b, sayfa: undefined })} aria-current={on ? "page" : undefined}>{label}</a></li>;
          })}
        </ul>
        <form className="range" action={path} style={{ marginTop: 10 }}>
          {Object.entries(cur).filter(([k, v]) => v && !["min", "max", "sayfa"].includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <label className="sr" htmlFor="fmin">En az</label><input id="fmin" name="min" inputMode="numeric" placeholder="En az" defaultValue={min ?? ""} />
          <label className="sr" htmlFor="fmax">En çok</label><input id="fmax" name="max" inputMode="numeric" placeholder="En çok" defaultValue={max ?? ""} />
          <button type="submit">Uygula</button>
        </form>
      </section>
      <p className="muted" style={{ fontSize: 12.5, margin: 0 }}><a href={base || "/"}>Ana sayfaya dön</a></p>
    </div>
  );
}

// Mevcut sorgu parametrelerini koruyarak adres üret
export function hrefWith(path: string, cur: Record<string, string | undefined>) {
  return (q: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...cur, ...q })) if (v != null && v !== "") p.set(k, String(v));
    const s = p.toString();
    return s ? `${path}?${s}` : path;
  };
}
