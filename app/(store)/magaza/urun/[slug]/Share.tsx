"use client";
// Paylaş: telefonda sistem paylaşım menüsü (Web Share API), yoksa bağlantı panoya kopyalanır. Sonuç düğmede yazılır.
import { useState } from "react";

export default function Share({ title }: { title: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) { await navigator.share({ title, url }); return; }
      await navigator.clipboard.writeText(url);
      setMsg("Bağlantı kopyalandı");
    } catch (e: any) {
      if (e?.name !== "AbortError") setMsg("Paylaşılamadı: bağlantıyı adres çubuğundan kopyalayın");
    }
    setTimeout(() => setMsg(null), 3000);
  }
  return (
    <button type="button" className="more" onClick={share} aria-live="polite">
      <svg className="icon" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" /></svg>
      {msg ?? "Paylaş"}
    </button>
  );
}
