import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { basePath, descriptionBlocks, imgUrl, slugify, tl } from "@/lib/store";
import { product, similar } from "@/lib/store-data";
import { Grid } from "../../_ui";
import Icon from "../../Icon";
import Gallery from "./Gallery";
import Share from "./Share";

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
  const more = await similar(p, 10);
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
  const specs: [string, string][] = [...(p.leaf ? [["Kategori", p.leaf] as [string, string]] : []), ...p.attrs, ...(p.vat != null ? [["KDV oranı", `%${p.vat}`] as [string, string]] : []), ["Stok durumu", "Stokta var"]];
  return (
    <>
      <nav className="crumbs" aria-label="Konum">
        <a href={base || "/"}>Ana sayfa</a><span aria-hidden="true">›</span><a href={`${base}/kategori/${topSlug}`}>{p.top}</a>
        {p.sub && <><span aria-hidden="true">›</span><a href={`${base}/kategori/${topSlug}?alt=${slugify(p.sub)}`}>{p.sub}</a></>}
        {p.leaf && p.leaf !== p.sub && <><span aria-hidden="true">›</span><span>{p.leaf}</span></>}
      </nav>
      <div className="pd">
        <Gallery images={images} title={p.title} />
        <div className="info">
          <span className="badge-ok"><Icon name="check" size={16} />Stokta</span>
          <h1>{p.title}</h1>
          <div className="meta">{p.leaf && <span>Kategori: <b>{p.leaf}</b></span>}<span>Fiyatlara KDV dahildir</span></div>
          <div><Share title={p.title} /></div>
          <section className="panel pricebox" aria-label="Fiyat">
            <span className="lbl">Satış fiyatı</span>
            <div className="price">{ranged ? <>{tl(Math.min(...prices))}<small>başlayan fiyatlarla</small></> : tl(p.price)}</div>
            {p.variants.length > 0 && (
              <div className="opts">
                <h2>Seçenekler</h2>
                <ul>{p.variants.map((v) => <li key={v.id} className={v.inStock ? undefined : "out"}>{v.label}{ranged ? ` (${tl(v.price)})` : ""}<span className="sr">{v.inStock ? "" : ", tükendi"}</span></li>)}</ul>
              </div>
            )}
            <button className="btn" type="button" disabled aria-describedby="buy-note">Sepete ekle</button>
            <div className="note" id="buy-note"><Icon name="info" /><span>Online siparişe çok yakında başlıyoruz. Ödeme ve kargo seçenekleri hazırlanıyor.</span></div>
          </section>
          <section className="panel specs-card" aria-labelledby="h-specs">
            <h2 id="h-specs">Ürün özellikleri</h2>
            <dl className="specs">{specs.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          </section>
        </div>
      </div>
      {blocks.length > 0 && <section className="desc" aria-labelledby="h-desc"><h2 id="h-desc">Ürün açıklaması</h2><div className="panel">{blocks}</div></section>}
      {more.length > 0 && (
        <section className="sec" aria-labelledby="h-sim">
          <div className="sec-head"><h2 id="h-sim">Benzer ürünler</h2><a className="more" href={`${base}/kategori/${topSlug}${p.sub ? `?alt=${slugify(p.sub)}` : ""}`}>Tümünü gör</a></div>
          <Grid items={more} base={base} />
        </section>
      )}
    </>
  );
}
