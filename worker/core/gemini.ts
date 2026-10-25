// Google Gemini API (ücretsiz kota: AI Studio anahtarı, GEMINI_API_KEY). ANTHROPIC_API_KEY yoksa yapay zekâ işleri bunu kullanır.
// Ücretsiz katmanda model başına dakikada ~10, günde ~1.000-1.500 istek (Google değiştirebilir): istekler arası bekleme.
// Model sırası: GEMINI_MODEL (varsa) > 2.5 Flash > 2.5 Flash-Lite. Kota (429) / yoğunluk (503) / model yok (404) -> sıradaki model;
// hepsi kotadaysa o çalışmada durulur. (25.10: "gemini-flash-latest" takma adı ücretsiz kotası olmayan modele gidiyordu.)
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
export const geminiEnabled = () => !!process.env.GEMINI_API_KEY;
export class GeminiQuotaError extends Error {}

let last = 0;
const GAP = Number(process.env.GEMINI_GAP_MS ?? 6500);
const exhausted = new Set<string>(); // bu çalışmada kotası dolan modeller

// JSON şemalı tek istek (responseSchema: OpenAPI alt kümesi). Dönen metin JSON olarak ayrıştırılır.
export async function geminiJson<T>(system: string, user: string, schema: Record<string, unknown>): Promise<T | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const models = [...new Set([process.env.GEMINI_MODEL, "gemini-2.5-flash", "gemini-2.5-flash-lite"].filter(Boolean) as string[])].filter((m) => !exhausted.has(m));
  let lastQuota = "", lastErr = "";
  for (const model of models) {
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
    const j: any = await res.json().catch(() => null);
    const msg = String(j?.error?.message ?? "").slice(0, 200);
    if (res.status === 404) { lastErr = `${model} yok`; continue; }
    if (res.status === 429) { exhausted.add(model); lastQuota = `Gemini kotası (429, ${model}): ${msg}`; continue; }
    if (res.status === 503 || res.status === 500) { lastErr = `Gemini ${res.status} (${model}): ${msg}`; continue; }
    if (!res.ok) throw new Error(`Gemini ${res.status} (${model}): ${msg}`);
    const text = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
    try { return JSON.parse(text) as T; } catch { return null; }
  }
  if (lastQuota && !models.some((m) => !exhausted.has(m))) throw new GeminiQuotaError(lastQuota);
  if (!models.length) throw new GeminiQuotaError("Gemini: tüm modellerin kotası bu çalışmada doldu");
  throw new Error(lastErr || lastQuota || "Gemini yanıt vermedi");
}
