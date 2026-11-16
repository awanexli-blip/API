import { headers } from "next/headers";
import { basePath, PRICE_BANDS, imgUrl, tl } from "@/lib/store";
import { categories, list } from "@/lib/store-data";
import { Rail } from "./_ui";
import Icon from "./Icon";

export default async function StoreHome() {
  const base = basePath((await headers()).get("host"));
  const cats = await categories();
  const top = cats.slice(0, 6);
  const [fresh, ...rails] = await Promise.all([
    list({ sort: "yeni", page: 1, size: 15 }),
    ...top.slice(0, 4).map((c) => list({ top: c.top, sort: "onerilen", page: 1, size: 12 })),
  ]);
  const total = cats.reduce((t, c) => t + c.n, 0);
  const showcase = fresh.items.filter((p) => p.image).slice(0, 3);
  return (
    <>
        <section className="hero" aria-labelledby="h-hero">
          <div className="copy">
            <h1 id="h-hero">Evden elektroniğe {total.toLocaleString("tr-TR")} ürün tek adreste</h1>
            <p>Aradığınızı yazın, saniyeler içinde bulun. Tüm fiyatlara KDV dahildir.</p>
            <form className="search big" action={`${base}/ara`} role="search">
              <label className="sr" htmlFor="hq">Ürün ara</label>
              <Icon name="search" />
              <input id="hq" name="q" type="search" placeholder="Örneğin: akıllı saat, nevresim, kulaklık" minLength={2} maxLength={80} enterKeyHint="search" />
              <button type="submit">Ara</button>
            </form>
            <ul className="trust" aria-label="Mağaza bilgileri">
              <li>{cats.length} kategori</li>
              <li>Stoklar her gün güncellenir</li>
              <li>KDV dahil fiyat</li>
            </ul>
          </div>
          {showcase.length === 3 && (
            <div className="showcase" aria-label="Yeni gelen ürünlerden">
              {showcase.map((p, i) => (
                <a key={p.product_id} href={`${base}/urun/${p.slug}`} className="mini">
                  <img src={imgUrl(p.image)!} alt="" width={240} height={240} fetchPriority={i === 0 ? "high" : undefined} />
                  <span className="t">{p.title}</span>
                  <b>{tl(p.price)}</b>
                </a>
              ))}
            </div>
          )}
        </section>

        <section className="sec" aria-labelledby="h-cats">
          <div className="sec-head"><h2 id="h-cats">Kategoriler</h2><button type="button" className="more linkbtn" data-open-catmenu>Tüm kategoriler</button></div>
          <div className="cats">
            {cats.map((c) => (
              <a key={c.slug} className="catcard" href={`${base}/kategori/${c.slug}`}>
                <span>{c.image ? <img src={imgUrl(c.image)!} alt="" width={160} height={160} loading="lazy" /> : null}</span>
                {c.top}
              </a>
            ))}
          </div>
        </section>

        <section className="sec" aria-labelledby="h-new">
          <div className="sec-head"><div><h2 id="h-new">Yeni gelenler</h2><p>Mağazaya en son eklenen ürünler</p></div><a className="more" href={`${base}/ara?sirala=yeni`}>Tümünü gör</a></div>
          <Rail items={fresh.items.slice(3)} base={base} />
        </section>

        {rails.slice(0, 2).map((r, i) => r.items.length > 0 && (
          <section className="sec" key={top[i].slug} aria-labelledby={`h-${top[i].slug}`}>
            <div className="sec-head"><div><h2 id={`h-${top[i].slug}`}>{top[i].top}</h2><p>{top[i].n.toLocaleString("tr-TR")} ürün</p></div><a className="more" href={`${base}/kategori/${top[i].slug}`}>Tümünü gör</a></div>
            <Rail items={r.items} base={base} />
          </section>
        ))}

        <section className="sec" aria-labelledby="h-price">
          <div className="sec-head"><div><h2 id="h-price">Bütçenize göre alışveriş</h2><p>Bir fiyat aralığı seçin</p></div></div>
          <div className="bands">
            {PRICE_BANDS.map(([a, b, label]) => {
              const q = new URLSearchParams(); if (a != null) q.set("min", String(a)); if (b != null) q.set("max", String(b));
              return <a key={label} href={`${base}/ara?${q}`}>{label}</a>;
            })}
          </div>
        </section>

        {rails.slice(2).map((r, i) => r.items.length > 0 && (
          <section className="sec" key={top[i + 2].slug} aria-labelledby={`h-${top[i + 2].slug}`}>
            <div className="sec-head"><div><h2 id={`h-${top[i + 2].slug}`}>{top[i + 2].top}</h2><p>{top[i + 2].n.toLocaleString("tr-TR")} ürün</p></div><a className="more" href={`${base}/kategori/${top[i + 2].slug}`}>Tümünü gör</a></div>
            <Rail items={r.items} base={base} />
          </section>
        ))}
    </>
  );
}
