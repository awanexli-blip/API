import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { basePath, descriptionBlocks, imgUrl, slugify, tl } from "@/lib/store";
import { product, similar } from "@/lib/store-data";
import { Rail } from "../../_ui";
import Icon from "../../Icon";
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
  const more = await similar(p, 12);
  const desc = descriptionBlocks(p.description);
  const images = (p.images.length ? p.images : [p.image]).map(imgUrl).filter((u): u is string => !!u);
  const prices = p.variants.map((v) => v.price);
  const ranged = prices.length > 0 && Math.min(...prices) !== Math.max(...prices);
  // Açıklama: ardışık maddeler tek liste
  const blocks: React.ReactNode[] = [];
  for (let i = 0; i < desc.length; i++) {
    if (desc[i].kind === "li") {
      const lis: string[] = [];
      while (i < desc.length && desc[i].kind === "li") lis.push(desc[i++].text);
      i--;
      blocks.push(<ul key={`u${i}`}>{lis.map((t, n) => <li key={n}>{t}</li>)}</ul>);
    } else blocks.push(<p key={i}>{desc[i].text}</p>);
  }
  const topSlug = slugify(p.top);
  return (
    <>
      <nav className="crumbs" aria-label="Konum">
        <a href={base || "/"}>Ana sayfa</a><span aria-hidden="true">/</span><a href={`${base}/kategori/${topSlug}`}>{p.top}</a>
        {p.sub && <><span aria-hidden="true">/</span><a href={`${base}/kategori/${topSlug}?alt=${slugify(p.sub)}`}>{p.sub}</a></>}
      </nav>
      <div className="pd">
        <Gallery images={images} title={p.title} />
        <div className="info">
          {p.leaf && <div className="cat">{p.leaf}</div>}
          <h1 className="serif">{p.title}</h1>
          <div className="price">{ranged ? <>{tl(Math.min(...prices))}<small>başlayan fiyatlarla</small></> : tl(p.price)}</div>
          <div className="badge">Stokta</div>
          {p.variants.length > 0 && (
            <div className="opts">
              <h2>Seçenekler</h2>
              <ul>{p.variants.map((v) => <li key={v.id} className={v.inStock ? undefined : "out"}>{v.label}{ranged ? ` · ${tl(v.price)}` : ""}<span className="sr">{v.inStock ? "" : " (tükendi)"}</span></li>)}</ul>
            </div>
          )}
          <div className="buy">
            <button className="btn" type="button" disabled aria-describedby="buy-note">Sepete ekle</button>
            <div className="note" id="buy-note"><Icon name="info" /><span>Online siparişe çok yakında başlıyoruz. Ödeme ve kargo seçenekleri hazırlanıyor.</span></div>
          </div>
          <div className="acc">
            {blocks.length > 0 && <details open><summary>Ürün açıklaması <Icon name="plus" /></summary><div className="body">{blocks}</div></details>}
            {p.attrs.length > 0 && (
              <details open={!blocks.length}><summary>Ürün özellikleri <Icon name="plus" /></summary>
                <div className="body"><dl className="specs">{p.attrs.map(([k, v]) => <div key={k} style={{ display: "contents" }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></div>
              </details>
            )}
          </div>
        </div>
      </div>
      {more.length > 0 && (
        <section className="sec" style={{ marginTop: 64 }} aria-labelledby="h-sim">
          <div className="sec-head"><div><h2 id="h-sim" className="serif">Benzer ürünler</h2></div><a className="link-arrow" href={`${base}/kategori/${topSlug}`}>Tümü <Icon name="arrow" size={16} /></a></div>
          <Rail items={more} base={base} />
        </section>
      )}
    </>
  );
}
