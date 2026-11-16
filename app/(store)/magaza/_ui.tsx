// Vitrin ortak parçaları (sunucu bileşenleri)
import { imgUrl, tl, SORTS, type Sort } from "@/lib/store";
import type { Card } from "@/lib/store-data";

export function ProductCard({ p, base, eager = false }: { p: Card; base: string; eager?: boolean }) {
  const src = imgUrl(p.image);
  return (
    <article className="card">
      {src ? <img src={src} alt="" width={300} height={300} loading={eager ? undefined : "lazy"} decoding="async" /> : <div className="noimg">Görsel yok</div>}
      <h3><a className="card-link" href={`${base}/urun/${p.slug}`}>{p.title}</a></h3>
      <p>{tl(p.price)}</p>
    </article>
  );
}

export function Grid({ items, base, eagerFirst = 0 }: { items: Card[]; base: string; eagerFirst?: number }) {
  return <div className="grid">{items.map((p, i) => <ProductCard key={p.product_id} p={p} base={base} eager={i < eagerFirst} />)}</div>;
}

// Sıralama bağlantıları ve sayfalama: form yerine düz bağlantı (JS gerekmez, geri tuşu çalışır)
export function SortLinks({ href, sort }: { href: (q: Record<string, string | number | undefined>) => string; sort: Sort }) {
  return (
    <nav className="sort" aria-label="Sıralama">
      {(Object.keys(SORTS) as Sort[]).map((k) => <a key={k} href={href({ sirala: k === "onerilen" ? undefined : k, sayfa: undefined })} aria-current={k === sort ? "true" : undefined}>{SORTS[k]}</a>)}
    </nav>
  );
}

export function Pager({ page, pages, href }: { page: number; pages: number; href: (q: Record<string, string | number | undefined>) => string }) {
  if (pages <= 1) return null;
  const nums = [...new Set([1, page - 2, page - 1, page, page + 1, page + 2, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: React.ReactNode[] = [];
  nums.forEach((n, i) => {
    if (i && n - nums[i - 1] > 1) out.push(<span key={`g${n}`}>…</span>);
    out.push(n === page ? <span key={n} aria-current="page" style={{ fontWeight: 700, color: "var(--ink)" }}>{n}</span> : <a key={n} href={href({ sayfa: n === 1 ? undefined : n })}>{n}</a>);
  });
  return (
    <nav className="pager" aria-label="Sayfalar">
      {page > 1 && <a href={href({ sayfa: page - 1 === 1 ? undefined : page - 1 })} aria-label="Önceki sayfa">‹</a>}
      {out}
      {page < pages && <a href={href({ sayfa: page + 1 })} aria-label="Sonraki sayfa">›</a>}
    </nav>
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
