// Vitrin ortak parçaları (sunucu bileşenleri). Kart düzeni Bezos'tan ilham: beyaz kart, Stokta rozeti, görsel, ince ayırıcı, bilgi, fiyat kutusu.
import { imgUrl, tl, PRICE_BANDS } from "@/lib/store";
import type { Card, TopCat } from "@/lib/store-data";
import Icon from "./Icon";

export function ProductCard({ p, base, eager = false }: { p: Card; base: string; eager?: boolean }) {
  const src = imgUrl(p.image);
  return (
    <article className="card">
      <div className="media">
        {src ? <img src={src} alt="" width={400} height={400} loading={eager ? undefined : "lazy"} decoding="async" /> : <div className="noimg">Görsel yok</div>}
        <span className="stock">Stokta</span>
      </div>
      <div className="body">
        {p.leaf && <div className="cat">{p.leaf}</div>}
        <h3><a className="card-link" href={`${base}/urun/${p.slug}`}>{p.title}</a></h3>
        <div className="price">{tl(p.price)}</div>
      </div>
    </article>
  );
}

export function Grid({ items, base, eagerFirst = 0 }: { items: Card[]; base: string; eagerFirst?: number }) {
  return <div className="grid">{items.map((p, i) => <ProductCard key={p.product_id} p={p} base={base} eager={i < eagerFirst} />)}</div>;
}
export function Rail({ items, base }: { items: Card[]; base: string }) {
  return <div className="rail">{items.map((p) => <ProductCard key={p.product_id} p={p} base={base} />)}</div>;
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

// Filtre kartı (Bezos'tan ilham: sayılı kategori ağacı, seçili olan dolu). Fiyat: hazır aralıklar + özel aralık (form GET, JS gerekmez)
export function Filters({ cat, sub, path, cur, min, max, idp = "" }: {
  cat?: TopCat; sub?: string; path: string; cur: Record<string, string | undefined>; min?: number; max?: number; idp?: string;
}) {
  const h = hrefWith(path, cur);
  return (
    <div className="filters panel">
      {cat && cat.subs.length > 1 && (
        <section aria-labelledby={`${idp}f-sub`}>
          <h2 id={`${idp}f-sub`}>{cat.top}</h2>
          <ul>
            <li><a href={h({ alt: undefined, sayfa: undefined })} aria-current={!sub ? "page" : undefined}>Tümü <small>{cat.n.toLocaleString("tr-TR")}</small></a></li>
            {cat.subs.map((s) => <li key={s.slug}><a href={h({ alt: s.slug, sayfa: undefined })} aria-current={sub === s.slug ? "page" : undefined}>{s.sub} <small>{s.n.toLocaleString("tr-TR")}</small></a></li>)}
          </ul>
        </section>
      )}
      <section aria-labelledby={`${idp}f-price`}>
        <h2 id={`${idp}f-price`}>Fiyat</h2>
        <ul>
          {PRICE_BANDS.map(([a, b, label]) => {
            const on = a === min && b === max;
            return <li key={label}><a href={h({ min: on ? undefined : a, max: on ? undefined : b, sayfa: undefined })} aria-current={on ? "page" : undefined}>{label}</a></li>;
          })}
        </ul>
        <form className="range" action={path}>
          {Object.entries(cur).filter(([k, v]) => v && !["min", "max", "sayfa"].includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <label className="sr" htmlFor={`${idp}fmin`}>En az fiyat</label><input id={`${idp}fmin`} name="min" inputMode="numeric" placeholder="En az" defaultValue={min ?? ""} />
          <label className="sr" htmlFor={`${idp}fmax`}>En çok fiyat</label><input id={`${idp}fmax`} name="max" inputMode="numeric" placeholder="En çok" defaultValue={max ?? ""} />
          <button type="submit">Uygula</button>
        </form>
      </section>
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
