"use client";

import { useCallback } from "react";

export type Row = Record<string, any>;
export type Api = (path: string, init?: RequestInit) => Promise<any>;
export type Notify = (t: "err" | "good", m: string) => void;
export type Props = { api: Api; notify: Notify; marketplace: string };

export const tl = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " TL";
export const when = (s?: string) => (s ? new Date(s).toLocaleString("tr-TR") : "-");
export const statusTr: Record<string, string> = { ok: "Tamam", error: "Hata", partial: "Kısmen", running: "Çalışıyor", skipped: "Atlandı" };

// İstek 25 sn içinde dönmezse hata verir: askıda kalan istek düğmeleri sessizce kilitlemesin
export function useApi(token: string): Api {
  return useCallback(
    async (path: string, init?: RequestInit) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      try {
        const res = await fetch(path, {
          ...init,
          signal: ctrl.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `Sunucu hatası ${res.status}`);
        return data;
      } catch (e: any) {
        if (e?.name === "AbortError") throw new Error("Sunucu 25 saniyede yanıt vermedi (Vercel ortam değişkenlerini kontrol et)");
        throw e;
      } finally {
        clearTimeout(timer);
      }
    },
    [token]
  );
}

// Sonraki zamanlanmış çalışma: workflow cron "0 */4 * * *" (UTC)
export function nextScheduledRun(now = new Date()): Date {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  d.setUTCHours(Math.floor(d.getUTCHours() / 4) * 4 + 4);
  return d;
}
