import { headers } from "next/headers";
import { basePath, PRICE_BANDS, imgUrl } from "@/lib/store";
import { bestSellers, categories, list } from "@/lib/store-data";
import { Rail } from "./_ui";

// Ana sayfa (K 17.11: beyaz, Trendyol/Hepsiburada'dan ilham, iştah açan; yalnızca gerçek bilgi: satış ve yeni ürün rozetleri)
export default async function StoreHome() {
  const base = basePath((await headers()).get("host"));
  const cats = await categories();
  const top = cats.slice(0, 6);
  const [best, fresh, ...rails] = await Promise.all([
    bestSellers(15).catch(() => []),
    list({ sort: "yeni", page: 1, size: 15 }),
    ...top.slice(0, 4).map((c) => list({ top: c.top, sort: "onerilen", page: 1, size: 15 })),
  ]);
  const total = cats.reduce((t, c) => t + c.n, 0);
  const promo = cats.filter((c) => c.image).slice(0, 3);
  const rail = (i: number) => rails[i] && rails[i].items.length > 0 && (
    <section className="sec" key={top[i].slug} aria-labelledby={`h-${top[i].slug}`}>
      <div className="sec-head"><div><h2 id={`h-${top[i].slug}`}>{top[i].top}</h2><p>{top[i].n.toLocaleString("tr-TR")} ürün</p></div><a className="more" href={`${base}/kategori/${top[i].slug}`}>Tümünü gör</a></div>
      <Rail items={rails[i].items} base={base} />
    </section>
  );
  return (
    <>
      <h1 className="sr">Özsaray: evden elektroniğe {total.toLocaleString("tr-TR")} ürün</h1>
      {promo.length === 3 && (
        <section className="promos" aria-label="Öne çıkan kategoriler">
          {promo.map((c, i) => (
            <a key={c.slug} className={`promo c${i + 1}`} href={`${base}/kategori/${c.slug}`}>
              <div className="t"><b>{c.top}</b><span>{c.n.toLocaleString("tr-TR")} ürün seni bekliyor</span><i>Alışverişe başla</i></div>
              <img src={imgUrl(c.image)!} alt="" width={420} height={300} fetchPriority={i === 0 ? "high" : undefined} />
            </a>
          ))}
        </section>
      )}

      <section className="sec" aria-labelledby="h-cats">
        <h2 id="h-cats" className="sr">Kategoriler</h2>
        <div className="rounds">
          {cats.map((c) => (
            <a key={c.slug} className="round" href={`${base}/kategori/${c.slug}`}>
              <span>{c.image ? <img src={imgUrl(c.image)!} alt="" width={80} height={80} loading="lazy" /> : null}</span>
              {c.top}
            </a>
          ))}
        </div>
      </section>

      {best.length >= 5 && (
        <section className="sec tint" aria-labelledby="h-best">
          <div className="sec-head"><div><h2 id="h-best">Çok satanlar</h2><p>Müşterilerimizin son 60 günde en çok aldığı ürünler</p></div></div>
          <Rail items={best} base={base} tag="cok" />
        </section>
      )}

      <section className="sec" aria-labelledby="h-new">
        <div className="sec-head"><div><h2 id="h-new">Yeni gelenler</h2><p>Mağazaya en son eklenen ürünler</p></div><a className="more" href={`${base}/ara?sirala=yeni`}>Tümünü gör</a></div>
        <Rail items={fresh.items} base={base} tag="yeni" />
      </section>

      {rail(0)}
      {rail(1)}

      <section className="sec" aria-labelledby="h-price">
        <div className="sec-head"><div><h2 id="h-price">Bütçene göre alışveriş</h2><p>Bir fiyat aralığı seç</p></div></div>
        <div className="bands">
          {PRICE_BANDS.map(([a, b, label]) => {
            const q = new URLSearchParams(); if (a != null) q.set("min", String(a)); if (b != null) q.set("max", String(b));
            return <a key={label} href={`${base}/ara?${q}`}>{label}</a>;
          })}
        </div>
      </section>

      {rail(2)}
      {rail(3)}
    </>
  );
}
