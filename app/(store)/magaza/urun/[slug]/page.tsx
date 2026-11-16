import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { basePath, descriptionBlocks, imgUrl, slugify, tl } from "@/lib/store";
import { product, similar } from "@/lib/store-data";
import { Grid } from "../../_ui";
import Gallery from "./Gallery";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await product((await params).slug);
  return p ? { title: p.title, description: `${p.title} - ${tl(p.price)}` } : { title: "Ürün bulunamadı" };
}

export default async function ProductPage({ params }: Props) {
  const [{ slug }, h] = await Promise.all([params, headers()]);
  const base = basePath(h.get("host"));
  const p = await product(slug);
  if (!p) notFound();
  const more = await similar(p);
  const desc = descriptionBlocks(p.description);
  const images = (p.images.length ? p.images : [p.image]).map(imgUrl).filter((u): u is string => !!u);
  const prices = p.variants.map((v) => v.price);
  const from = prices.length && Math.min(...prices) !== Math.max(...prices);
  // Açıklama blokları: ardışık maddeler tek liste
  const blocks: React.ReactNode[] = [];
  for (let i = 0; i < desc.length; i++) {
    if (desc[i].kind === "li") {
      const lis: string[] = [];
      while (i < desc.length && desc[i].kind === "li") lis.push(desc[i++].text);
      i--;
      blocks.push(<ul key={`u${i}`}>{lis.map((t, n) => <li key={n}>{t}</li>)}</ul>);
    } else blocks.push(<p key={i}>{desc[i].text}</p>);
  }
  return (
    <>
      <nav className="crumbs" aria-label="Konum">
        <a href={base || "/"}>Ana sayfa</a><span>›</span><a href={`${base}/kategori/${slugify(p.top)}`}>{p.top}</a>
        {p.sub && <><span>›</span><a href={`${base}/kategori/${slugify(p.top)}?alt=${slugify(p.sub)}`}>{p.sub}</a></>}
      </nav>
      <div className="pd">
        <Gallery images={images} title={p.title} />
        <div>
          <h1>{p.title}</h1>
          <div className="price">{from ? `${tl(Math.min(...prices))}'den başlayan` : tl(p.price)}</div>
          <div className="stock">Stokta</div>
          {p.variants.length > 0 && (
            <>
              <h2 className="sr">Seçenekler</h2>
              <ul className="opts">
                {p.variants.map((v) => <li key={v.id} className={v.inStock ? undefined : "out"}>{v.label}{from ? ` · ${tl(v.price)}` : ""}{v.inStock ? "" : " (tükendi)"}</li>)}
              </ul>
            </>
          )}
          <div className="buy">
            <button className="btn" type="button" disabled aria-describedby="buy-note">Sepete ekle</button>
            <small id="buy-note">Online sipariş çok yakında. Ödeme ve kargo seçenekleri hazırlanıyor.</small>
          </div>
          {p.attrs.length > 0 && (
            <section className="box" aria-labelledby="h-specs">
              <h2 id="h-specs">Ürün özellikleri</h2>
              <dl className="specs">{p.attrs.map(([k, v]) => <div key={k} style={{ display: "contents" }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
            </section>
          )}
        </div>
      </div>
      {blocks.length > 0 && <section className="box" aria-labelledby="h-desc"><h2 id="h-desc">Ürün açıklaması</h2>{blocks}</section>}
      {more.length > 0 && (
        <section className="section" aria-labelledby="h-sim">
          <div className="section-head"><h2 id="h-sim">Benzer ürünler</h2></div>
          <Grid items={more} base={base} />
        </section>
      )}
    </>
  );
}
