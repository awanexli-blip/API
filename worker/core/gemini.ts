// Google Gemini API (ücretsiz kota: AI Studio anahtarı, GEMINI_API_KEY). ANTHROPIC_API_KEY yoksa yapay zekâ işleri bunu kullanır.
// Ücretsiz katmanda model başına dakikada ~10, günde ~1.000-1.500 istek (Google değiştirebilir): istekler arası bekleme.
// Model sırası: GEMINI_MODEL (varsa) > 2.5 Flash > 2.5 Flash-Lite > (hepsi 404 ise) model listesinden en yeni kararlı Flash.
// Kota (429) / yoğunluk (503) / model yok (404) -> sıradaki model;
// hepsi kotadaysa o çalışmada durulur. (25.10: "gemini-flash-latest" takma adı ücretsiz kotası olmayan modele gidiyordu.)
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
export const geminiEnabled = () => !!process.env.GEMINI_API_KEY;
export class GeminiQuotaError extends Error {}

let last = 0;
const GAP = Number(process.env.GEMINI_GAP_MS ?? 6500);
const exhausted = new Set<string>(); // bu çalışmada kotası dolan modeller

const missing = new Set<string>(); // 404 dönen (kapatılmış) modeller
let discovered: string[] | null = null;

// Sabit adlar kapatılınca (27.10: 2.5 Flash ve Flash-Lite 404, soru taslağı ve özellik doldurma durdu) hesabın erişebildiği modeller
// listeden seçilir: generateContent destekleyen kararlı "flash" modelleri, yeni sürüm önce, Flash Lite'tan önce. Önizleme/deneysel,
// "-latest" takma adı (ücretsiz kotası olmayan modele gidebiliyor), görsel/ses/canlı modeller alınmaz.
export function pickFlashModels(list: { name: string; supportedGenerationMethods?: string[] }[]): string[] {
  const ver = (n: string) => Number(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  return list
    .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((n) => /^gemini-\d+(\.\d+)?-flash(-lite)?(-\d{3})?$/.test(n))
    .sort((a, b) => ver(b) - ver(a) || Number(a.includes("-lite")) - Number(b.includes("-lite")) || a.length - b.length)
    .slice(0, 4);
}

async function discoverModels(key: string): Promise<string[]> {
  if (discovered) return discovered;
  try {
    const r = await fetch(`${BASE}?pageSize=200`, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(30000) });
    const j: any = await r.json().catch(() => null);
    discovered = r.ok ? pickFlashModels(j?.models ?? []) : [];
    if (!r.ok) console.error(`Gemini model listesi ${r.status}: ${String(j?.error?.message ?? "").slice(0, 200)}`);
  } catch (e: any) { discovered = []; console.error("Gemini model listesi okunamadı:", String(e?.message ?? e).slice(0, 200)); }
  return discovered;
}

// JSON şemalı tek istek (responseSchema: OpenAPI alt kümesi). Dönen metin JSON olarak ayrıştırılır.
export async function geminiJson<T>(system: string, user: string, schema: Record<string, unknown>): Promise<T | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const fixed = [process.env.GEMINI_MODEL, "gemini-2.5-flash", "gemini-2.5-flash-lite"].filter(Boolean) as string[];
  // Sabit adların hepsi bu çalışmada 404 verdiyse listeden bulunanlar denenir
  const extra = fixed.every((m) => missing.has(m)) ? await discoverModels(key) : [];
  const models = [...new Set([...fixed, ...extra])].filter((m) => !exhausted.has(m) && !missing.has(m));
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
    if (res.status === 404) {
      missing.add(model); lastErr = `${[...missing].join(", ")} yok`;
      // Son sabit ad da yoksa: listeden bulunan modellerle aynı istek yeniden denenir (bir kez)
      if (!extra.length && fixed.every((m) => missing.has(m)) && (await discoverModels(key)).length) return geminiJson<T>(system, user, schema);
      continue;
    }
    if (res.status === 429) { exhausted.add(model); lastQuota = `Gemini kotası (429, ${model}): ${msg}`; continue; }
    if (res.status === 503 || res.status === 500) { lastErr = `Gemini ${res.status} (${model}): ${msg}`; continue; }
    if (!res.ok) throw new Error(`Gemini ${res.status} (${model}): ${msg}`);
    const text = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
    try { return JSON.parse(text) as T; } catch { return null; }
  }
  if (lastQuota && !models.some((m) => !exhausted.has(m))) throw new GeminiQuotaError(lastQuota);
  if (!models.length && !exhausted.size) throw new Error(`Gemini: kullanılabilir model yok (${[...missing].join(", ") || "-"} 404; hesabın model listesinde uygun Flash modeli bulunamadı, GEMINI_MODEL ile belirtin)`);
  if (!models.length) throw new GeminiQuotaError("Gemini: tüm modellerin kotası bu çalışmada doldu");
  throw new Error(lastErr || lastQuota || "Gemini yanıt vermedi");
}

// Araçlı / görselli serbest çağrı (ürün araştırması: worker/core/research.ts). Google araması (google_search) bu hesapta yalnızca
// gemini-2.5-flash'ta açık (28.10 denendi; 3.5/3.6'da 429), sayfa okuma (url_context) hepsinde. JSON modu araçlarla birlikte
// kullanılamadığı için JSON metinden ayrıştırılır (parseLooseJson). Kota (429): GeminiQuotaError.
export type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };
export async function geminiCall(o: { parts: GeminiPart[]; system?: string; tools?: ("google_search" | "url_context")[]; model?: string; temperature?: number; timeoutMs?: number }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY yok");
  const model = o.model ?? process.env.GEMINI_RESEARCH_MODEL ?? "gemini-2.5-flash";
  for (let t = 0; ; t++) {
    const wait = last + GAP - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const res = await fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, signal: AbortSignal.timeout(o.timeoutMs ?? 240_000),
      body: JSON.stringify({
        ...(o.system ? { systemInstruction: { parts: [{ text: o.system }] } } : {}),
        contents: [{ role: "user", parts: o.parts }],
        ...(o.tools?.length ? { tools: o.tools.map((x) => ({ [x]: {} })) } : {}),
        generationConfig: { temperature: o.temperature ?? 0 },
      }),
    });
    const j: any = await res.json().catch(() => null);
    const msg = String(j?.error?.message ?? "").slice(0, 200);
    if (res.status === 429) throw new GeminiQuotaError(`Gemini kotası (429, ${model}): ${msg}`);
    if ((res.status === 503 || res.status === 500) && t < 2) { await new Promise((r) => setTimeout(r, 5000 * (t + 1))); continue; }
    if (!res.ok) throw new Error(`Gemini ${res.status} (${model}): ${msg}`);
    const c = j?.candidates?.[0] ?? {};
    return {
      text: (c.content?.parts ?? []).map((p: any) => p.text ?? "").join(""),
      queries: (c.groundingMetadata?.webSearchQueries ?? []) as string[],
      sources: ((c.groundingMetadata?.groundingChunks ?? []) as any[]).map((g) => ({ uri: String(g.web?.uri ?? ""), title: String(g.web?.title ?? "") })),
      urls: ((c.urlContextMetadata?.urlMetadata ?? []) as any[]).map((u) => ({ url: String(u.retrievedUrl ?? ""), ok: u.urlRetrievalStatus === "URL_RETRIEVAL_STATUS_SUCCESS" })),
      model,
    };
  }
}

// Model metnindeki ilk JSON nesnesi (```json blokları, öncesi/sonrası açıklama olabilir)
export function parseLooseJson<T = any>(text: string): T | null {
  const s = String(text ?? "").replace(/```(?:json)?/gi, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)) as T; } catch { return null; }
}
