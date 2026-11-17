import { headers } from "next/headers";
import { basePath } from "@/lib/store";

export default async function StoreNotFound() {
  const base = basePath((await headers()).get("host"));
  return (
    <div className="empty panel">
      <h1 style={{ fontSize: 24, color: "var(--ink)", marginBottom: 8 }}>Aradığınız sayfa bulunamadı</h1>
      <p>Ürün satıştan kalkmış ya da adres değişmiş olabilir.</p>
      <p><a className="btn" href={base || "/"}>Ana sayfaya dön</a></p>
    </div>
  );
}
