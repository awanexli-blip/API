// İki ayrı kök yerleşim var (panel ve vitrin): hiçbir rotaya uymayan adres için ortak 404 (Next 16, experimental.globalNotFound)
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sayfa bulunamadı", robots: { index: false, follow: false } };

export default function GlobalNotFound() {
  return (
    <html lang="tr">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", background: "#fbfaf7", color: "#1b1a17" }}>
        <main style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 24 }}>Sayfa bulunamadı</h1>
          <p><a href="/" style={{ color: "#8a2b1e" }}>Ana sayfaya dön</a></p>
        </main>
      </body>
    </html>
  );
}
