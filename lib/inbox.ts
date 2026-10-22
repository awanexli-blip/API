import { admin } from "@/lib/server";

// Senkronu hemen başlat (GitHub Actions sync.yml, mod "update"): onaylı cevap 15 dk beklemeden gider
export async function dispatchSync(marketplace: string): Promise<boolean> {
  if (!process.env.GH_TOKEN || !process.env.GH_REPO) return false;
  const r = await fetch(`https://api.github.com/repos/${process.env.GH_REPO}/actions/workflows/sync.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ ref: "main", inputs: { mode: "update", marketplace } }),
  }).catch(() => null);
  return r?.status === 204;
}

// İnsan onayı: yalnızca new/drafted/failed durumundaki soru approved olur (gönderilmiş/gönderiliyor olan değişmez).
// Gönderimi worker yapar (worker/core/inbox.ts, approved -> sending kilidi ile tek sefer).
export async function approveAnswer(id: string, text: string, by: string) {
  const t = text.trim();
  if (t.length < 10 || t.length > 2000) return { error: "Cevap 10-2000 karakter olmalı" };
  if (/(\+?90|0)?\s*5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}|@[a-z0-9-]+\.[a-z]{2,}|https?:\/\/|www\./i.test(t)) return { error: "Cevapta telefon, e-posta veya bağlantı olamaz (pazaryeri kuralı)" };
  const now = new Date().toISOString();
  const { data, error } = await admin().from("inbox_items").update({ status: "approved", final_answer: t, approved_by: by, approved_at: now, last_error: null, updated_at: now })
    .eq("id", id).in("status", ["new", "drafted", "failed"]).select("marketplace");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Soru bulunamadı ya da zaten cevaplandı/gönderiliyor" };
  return { ok: true, marketplace: data[0].marketplace as string, started: await dispatchSync(data[0].marketplace) };
}
