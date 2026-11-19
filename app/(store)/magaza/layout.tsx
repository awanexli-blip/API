import "./store.css";
import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import { headers } from "next/headers";
import { basePath, STORE_NAME } from "@/lib/store";
import { categories } from "@/lib/store-data";
import CategoryMenu from "./CategoryMenu";
import SearchBox from "./SearchBox";
import { AssuranceBar } from "./Assurances";
import Icon, { STAR_PATTERN } from "./Icon";

// Tek yazı ailesi (frontend-design): derlemede indirilir, uygulamayla sunulur (dış istek yok); Türkçe harfler için latin-ext
const sans = Figtree({ subsets: ["latin", "latin-ext"], variable: "--font-sans", display: "swap", weight: ["400", "500", "600", "700", "800"] });

// Gösterme amaçlı (K 16.11): ödeme ve kargo eklenene kadar arama motorlarına kapalı
export const metadata: Metadata = {
  title: { default: `${STORE_NAME} | Ev, elektronik, aksesuar ve daha fazlası`, template: `%s | ${STORE_NAME}` },
  description: "Ev, elektronik, aksesuar, oyuncak ve daha binlerce üründe uygun fiyatlar.",
  robots: { index: false, follow: false },
  icons: { icon: [{ url: "/brand/icon-32.png", sizes: "32x32", type: "image/png" }, { url: "/brand/icon-48.png", sizes: "48x48", type: "image/png" }, { url: "/brand/icon-192.png", sizes: "192x192", type: "image/png" }], apple: "/brand/icon-192.png" },
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
  // Logo: K 17.11 fotoğrafı olduğu gibi (public/brand/logo-*.jpg); sekme simgesi ÖS kısmı, saydam (icon-*.png)
  const logo = <img className="mark" src="/brand/logo-120.jpg" srcSet="/brand/logo-120.jpg 1x, /brand/logo-240.jpg 2x" width={177} height={120} alt={STORE_NAME} />;
  return (
    <html lang="tr" className={sans.variable} style={{ ["--star-pattern" as string]: STAR_PATTERN }}>
      <body>
        <div className="announce">Online sipariş çok yakında açılıyor. Şimdilik ürünlerimizi inceleyebilirsiniz.</div>
        <header className="head">
          <div className="wrap">
            <div className="row">
              <a className="logo" href={home} aria-label={`${STORE_NAME} ana sayfa`}>{logo}</a>
              <button type="button" className="menu-btn" data-open-catmenu><Icon name="menu" /> Kategoriler</button>
              <SearchBox base={base} />
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
          <div className="wrap foot-assure"><AssuranceBar /></div>
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
