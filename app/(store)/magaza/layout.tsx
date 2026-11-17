import "./store.css";
import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import { headers } from "next/headers";
import { basePath, STORE_NAME } from "@/lib/store";
import { categories } from "@/lib/store-data";
import CategoryMenu from "./CategoryMenu";
import Icon, { Star, STAR_PATTERN } from "./Icon";

// Tek yazı ailesi (frontend-design): derlemede indirilir, uygulamayla sunulur (dış istek yok); Türkçe harfler için latin-ext
const sans = Figtree({ subsets: ["latin", "latin-ext"], variable: "--font-sans", display: "swap", weight: ["400", "500", "600", "700", "800"] });

// Gösterme amaçlı (K 16.11): ödeme ve kargo eklenene kadar arama motorlarına kapalı
export const metadata: Metadata = {
  title: { default: `${STORE_NAME} | Ev, elektronik, aksesuar ve daha fazlası`, template: `%s | ${STORE_NAME}` },
  description: "Ev, elektronik, aksesuar, oyuncak ve daha binlerce üründe uygun fiyatlar.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff", // her zaman beyaz tema (K 17.11)
  colorScheme: "light",
};

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const base = basePath((await headers()).get("host"));
  const cats = await categories().catch(() => []);
  const home = base || "/";
  const logo = <><Star /><span>özsaray</span></>;
  return (
    <html lang="tr" className={sans.variable} style={{ ["--star-pattern" as string]: STAR_PATTERN }}>
      <body>
        <div className="announce">Online sipariş çok yakında açılıyor. Şimdilik ürünlerimizi inceleyebilirsiniz.</div>
        <header className="head">
          <div className="wrap">
            <div className="row">
              <a className="logo" href={home} aria-label={`${STORE_NAME} ana sayfa`}>{logo}</a>
              <button type="button" className="menu-btn" data-open-catmenu><Icon name="menu" /> Kategoriler</button>
              <form className="search" action={`${base}/ara`} role="search">
                <label className="sr" htmlFor="q">Ürün ara</label>
                <Icon name="search" />
                <input id="q" name="q" type="search" placeholder="Ürün, marka ya da kategori ara" minLength={2} maxLength={80} autoComplete="off" enterKeyHint="search" />
                <button type="submit">Ara</button>
              </form>
            </div>
          </div>
          <div className="wrap">
            <nav className="nav" aria-label="Kategoriler">
              {cats.slice(0, 11).map((c) => <a key={c.slug} href={`${base}/kategori/${c.slug}`}>{c.top}</a>)}
            </nav>
          </div>
        </header>
        <main><div className="wrap">{children}</div></main>
        <footer className="foot">
          <div className="wrap">
            <div className="cols">
              <div>
                <div className="logo" style={{ marginBottom: 12 }}>{logo}</div>
                <p style={{ maxWidth: "36ch", margin: 0 }}>Ev, elektronik, aksesuar ve binlerce ürün tek adreste. Online sipariş çok yakında.</p>
              </div>
              <nav aria-labelledby="f-cats"><h2 id="f-cats">Kategoriler</h2><ul>{cats.slice(0, 6).map((c) => <li key={c.slug}><a href={`${base}/kategori/${c.slug}`}>{c.top}</a></li>)}</ul></nav>
              <nav aria-labelledby="f-more"><h2 id="f-more">Daha fazlası</h2><ul>{cats.slice(6, 12).map((c) => <li key={c.slug}><a href={`${base}/kategori/${c.slug}`}>{c.top}</a></li>)}</ul></nav>
              <nav aria-labelledby="f-corp"><h2 id="f-corp">Kurumsal</h2><ul><li><a href={`${base}/hakkimizda`}>Hakkımızda</a></li><li><a href={`${base}/iletisim`}>İletişim</a></li></ul></nav>
            </div>
            <div className="legal"><span>© {new Date().getFullYear()} {STORE_NAME}</span><span>Tüm fiyatlara KDV dahildir.</span></div>
          </div>
        </footer>
        <nav className="tabbar" aria-label="Hızlı gezinme">
          <a href={home}><Icon name="home" />Ana sayfa</a>
          <button type="button" data-open-catmenu><Icon name="grid" />Kategoriler</button>
          <a href={`${base}/ara`}><Icon name="search" />Ara</a>
        </nav>
        <CategoryMenu cats={cats} base={base} />
      </body>
    </html>
  );
}
