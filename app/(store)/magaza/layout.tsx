import "./store.css";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { basePath, STORE_NAME } from "@/lib/store";
import { categories } from "@/lib/store-data";

// Gösterme amaçlı (K 16.11): ödeme ve kargo eklenene kadar arama motorlarına kapalı
export const metadata: Metadata = {
  title: { default: `${STORE_NAME} | Ev, Elektronik, Aksesuar ve Daha Fazlası`, template: `%s | ${STORE_NAME}` },
  description: "Ev, elektronik, aksesuar, oyuncak ve daha binlerce üründe uygun fiyatlar.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#ffffff" }, { media: "(prefers-color-scheme: dark)", color: "#1c1a17" }],
};

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const base = basePath((await headers()).get("host"));
  const cats = await categories().catch(() => []);
  return (
    <html lang="tr">
      <body>
        <div className="notice">Sitemiz hazırlanıyor: online sipariş çok yakında açılacak.</div>
        <header className="top">
          <div className="wrap">
            <div className="bar">
              <a className="logo" href={base || "/"} aria-label={`${STORE_NAME} ana sayfa`}>Öz<span>saray</span></a>
              <form className="search" action={`${base}/ara`} role="search">
                <label className="sr" htmlFor="q">Ürün ara</label>
                <input id="q" name="q" type="search" placeholder="Ürün, kategori ara..." minLength={2} maxLength={80} autoComplete="off" enterKeyHint="search" />
                <button type="submit">Ara</button>
              </form>
            </div>
            <nav className="cats" aria-label="Kategoriler">
              {cats.map((c) => <a key={c.slug} href={`${base}/kategori/${c.slug}`}>{c.top}</a>)}
            </nav>
          </div>
        </header>
        <main><div className="wrap">{children}</div></main>
        <footer className="foot">
          <div className="wrap cols">
            <div><b style={{ color: "var(--ink)" }}>{STORE_NAME}</b><br />© {new Date().getFullYear()} ozsaraytr.com</div>
            <nav aria-label="Kurumsal">
              <a href={`${base}/hakkimizda`}>Hakkımızda</a>
              <a href={`${base}/iletisim`}>İletişim</a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
