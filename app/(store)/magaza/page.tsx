import { headers } from "next/headers";
import { basePath } from "@/lib/store";
import { categories, list } from "@/lib/store-data";
import { Grid } from "./_ui";

export default async function StoreHome() {
  const base = basePath((await headers()).get("host"));
  const cats = await categories();
  const [fresh, ...strips] = await Promise.all([
    list({ sort: "yeni", page: 1, size: 12 }),
    ...cats.slice(0, 5).map((c) => list({ top: c.top, sort: "onerilen", page: 1, size: 6 })),
  ]);
  const total = cats.reduce((t, c) => t + c.n, 0);
  return (
    <>
      <section className="hero">
        <h1>Evinize ve size dair her şey, tek adreste</h1>
        <p>{total.toLocaleString("tr-TR")} üründe uygun fiyatlar. Elektronikten aksesuara, oyuncaktan ev dekorasyonuna binlerce ürün.</p>
        <a className="btn" href={`${base}/kategori/${cats[0]?.slug ?? ""}`}>Alışverişe başla</a>
      </section>

      <section className="section" aria-labelledby="h-cats">
        <div className="section-head"><h2 id="h-cats">Kategoriler</h2></div>
        <div className="tiles">
          {cats.map((c) => <a key={c.slug} className="tile" href={`${base}/kategori/${c.slug}`}><b>{c.top}</b><small>{c.n.toLocaleString("tr-TR")} ürün</small></a>)}
        </div>
      </section>

      <section className="section" aria-labelledby="h-new">
        <div className="section-head"><h2 id="h-new">Yeni gelenler</h2><a href={`${base}/ara?sirala=yeni`}>Tümü</a></div>
        <Grid items={fresh.items} base={base} eagerFirst={4} />
      </section>

      {strips.map((s, i) => s.items.length > 0 && (
        <section className="section" key={cats[i].slug} aria-labelledby={`h-${cats[i].slug}`}>
          <div className="section-head"><h2 id={`h-${cats[i].slug}`}>{cats[i].top}</h2><a href={`${base}/kategori/${cats[i].slug}`}>Tümünü gör</a></div>
          <Grid items={s.items} base={base} />
        </section>
      ))}
    </>
  );
}
