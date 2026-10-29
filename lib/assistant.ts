// Telegram durum asistanı: Gemini (araç çağırma) + salt okunur araçlar. Çağıran: app/api/telegram (yalnızca K'nın sohbeti, gizli başlıklı).
// Model (29.10 K'nın anahtarıyla doğrulandı: gemini-2.5-flash araç çağırıyor): GEMINI_ASSISTANT_MODEL > GEMINI_MODEL > gemini-2.5-flash;
// 404 (kapatılmış) / 429 (kota) / 5xx -> sıradaki; sabitlerin hepsi 404 ise hesabın model listesinden kararlı Flash (devir notu: Gemini 404).
import { pickFlashModels } from "@/worker/core/gemini";
import { runAssistant, type Generate } from "./assistant-core.ts";
import { TOOLS } from "./assistant-tools.ts";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

async function listModels(key: string): Promise<string[]> {
  const r = await fetch(`${BASE}?pageSize=200`, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  const j: any = await r?.json().catch(() => null);
  return r?.ok ? pickFlashModels(j?.models ?? []) : [];
}

export async function askAssistant(question: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return "Asistan kapalı: Vercel'de GEMINI_API_KEY tanımlı değil.";
  const fixed = [...new Set([process.env.GEMINI_ASSISTANT_MODEL, process.env.GEMINI_MODEL, "gemini-2.5-flash"].filter(Boolean) as string[])];
  const gone = new Set<string>();
  let models = fixed, discovered = false, quota = false;
  const busy = new Map<string, number>(); // 503 "yoğun": aynı model 2 kez daha denenir (geçici), sonra sıradaki
  const generate: Generate = async (body) => {
    for (;;) {
      const model = models.find((m) => !gone.has(m));
      if (!model) {
        if (!discovered) { discovered = true; models = [...models, ...(await listModels(key))]; continue; }
        return { status: quota ? 429 : 404, json: { error: { message: "kullanılabilir model yok" } } };
      }
      const r = await fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000),
      }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: { message: String(e?.message ?? e) } }) }) as unknown as Response);
      const json: any = await r.json().catch(() => null);
      if ((r.status === 503 || r.status === 500) && (busy.get(model) ?? 0) < 2) { busy.set(model, (busy.get(model) ?? 0) + 1); await new Promise((ok) => setTimeout(ok, 2500)); continue; }
      if (r.status === 404 || r.status === 429 || r.status >= 500 || r.status === 0) { if (r.status === 429) quota = true; gone.add(model); continue; }
      return { status: r.status, json };
    }
  };
  try {
    return (await runAssistant(question, TOOLS, generate)).text;
  } catch (e: any) {
    if (String(e?.message) === "kota") return "Gemini kotası doldu; biraz sonra tekrar dene. (Panelde Gösterge sayfası güncel durumu gösterir.)";
    console.error("asistan:", String(e?.message ?? e).slice(0, 200));
    return "Şu an cevap veremiyorum (yapay zekâ hatası). Biraz sonra tekrar dene.";
  }
}

export const HELP = `Merhaba! Ben durum asistanıyım (yalnızca okurum, hiçbir şeyi değiştirmem). Örnek sorular:
• Son soruya verdiğim cevap Trendyol'a gitti mi?
• Senkronda hata var mı?
• Reddedilen ürünler neden reddedildi?
• Kargolanması gereken sipariş var mı?
• 11760100317 numaralı sipariş ne durumda?
Müşteri sorusuna cevap vermek için soru bildirimini "yanıtla" ile cevapla (bu sohbette serbest yazılan mesajlar asistana gider).`;
