// Google Gemini API (ücretsiz kota: AI Studio anahtarı, GEMINI_API_KEY). ANTHROPIC_API_KEY yoksa yapay zekâ işleri bunu kullanır.
// Ücretsiz katmanda dakikada ~10, günde ~1.500 istek (Google değiştirebilir): istekler arası bekleme + 429'da o çalışmada durma.
// Model GEMINI_MODEL ile değiştirilebilir; varsayılan takma ad güncel Flash modeline gider, bulunamazsa 2.5 Flash denenir.
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
export const geminiEnabled = () => !!process.env.GEMINI_API_KEY;
export class GeminiQuotaError extends Error {}

let last = 0;
const GAP = Number(process.env.GEMINI_GAP_MS ?? 6500);

// JSON şemalı tek istek (responseSchema: OpenAPI alt kümesi). Dönen metin JSON olarak ayrıştırılır.
export async function geminiJson<T>(system: string, user: string, schema: Record<string, unknown>): Promise<T | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const models = [process.env.GEMINI_MODEL || "gemini-flash-latest", "gemini-2.5-flash"];
  for (const model of [...new Set(models)]) {
    const wait = last + GAP - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const res = await fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.2 },
      }),
    });
    if (res.status === 404) continue; // model adı yok: sıradakini dene
    if (res.status === 429) throw new GeminiQuotaError("Gemini kotası doldu (429)");
    const j: any = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${String(j?.error?.message ?? "").slice(0, 200)}`);
    const text = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
    try { return JSON.parse(text) as T; } catch { return null; }
  }
  throw new Error("Gemini modeli bulunamadı (GEMINI_MODEL ayarını kontrol et)");
}
