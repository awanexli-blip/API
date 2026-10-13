import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Trendyol Kontrol Paneli",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
