"use client";

import { useCallback } from "react";

export type Row = Record<string, any>;
export type Api = (path: string, init?: RequestInit) => Promise<any>;
export type Notify = (t: "err" | "good", m: string) => void;
export type Props = { api: Api; notify: Notify; marketplace: string };

export const tl = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " TL";
export const when = (s?: string) => (s ? new Date(s).toLocaleString("tr-TR") : "-");
export const statusTr: Record<string, string> = { ok: "Tamam", error: "Hata", partial: "Kısmen", running: "Çalışıyor", skipped: "Atlandı" };

// İstek süre içinde dönmezse hata verir: askıda kalan istek düğmeleri sessizce kilitlemesin.
// Okuma (GET) isteği bağlantı kesintisinde ya da zaman aşımında bir kez yeniden denenir (K, 10.11: veritabanı zaman zaman 13-30 sn takılıyor). Yazma istekleri ASLA yeniden denenmez: işlem iki kez yapılmasın.
const GET_TIMEOUT = 40000, WRITE_TIMEOUT = 25000;
export function useApi(token: string): Api {
  return useCallback(
    async (path: string, init?: RequestInit) => {
      const isRead = !init?.method || init.method === "GET";
      const once = async () => {
        const ctrl = new AbortController();
        // Uzun süren işlem (ör. e-Arşiv taslakları) kendi süresini verebilir: init.timeoutMs
        const timer = setTimeout(() => ctrl.abort(), Number((init as any)?.timeoutMs) || (isRead ? GET_TIMEOUT : WRITE_TIMEOUT));
        try {
          const res = await fetch(path, {
            ...init,
            signal: ctrl.signal,
            // FormData (görsel yükleme) için tarayıcı kendi Content-Type'ını koyar
            headers: init?.body instanceof FormData ? { Authorization: `Bearer ${token}` } : { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          });
          const data = await res.json().catch(() => ({}));
          // Hata nesnesinde durum kodu ve gövde de taşınır (ör. 409 + existing: "ürün zaten var, güncellensin mi?")
          if (!res.ok) throw Object.assign(new Error(data.error ?? `Sunucu hatası ${res.status}`), { status: res.status, data });
          return data;
        } catch (e: any) {
          if (e?.name === "AbortError") throw Object.assign(new Error("Sunucu zamanında yanıt vermedi, biraz sonra yeniden dene"), { retry: true });
          if (e instanceof TypeError) throw Object.assign(new Error("Sunucuya bağlanılamadı, bağlantını kontrol edip yeniden dene"), { retry: true });
          throw e;
        } finally {
          clearTimeout(timer);
        }
      };
      try { return await once(); }
      catch (e: any) { if (isRead && e?.retry) return once(); throw e; }
    },
    [token]
  );
}

// Sonraki zamanlanmış çalışma: workflow cron "7,22,37,52 * * * *" (UTC, 15 dakikada bir)
export function nextScheduledRun(now = new Date()): Date {
  const d = new Date(now);
  d.setUTCSeconds(0, 0);
  const next = [7, 22, 37, 52].find((m) => m > now.getUTCMinutes());
  if (next == null) { d.setUTCHours(d.getUTCHours() + 1); d.setUTCMinutes(7); } else d.setUTCMinutes(next);
  return d;
}
