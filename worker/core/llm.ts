// İşçi modeller (K 12.11, hafıza ai-workers): ucuz/ücretsiz modellerle kuralla doğrulanabilir toplu işler.
// Zincir: OpenRouter ücretsiz Gemma 4 31B -> Google AI Studio doğrudan Gemma 4 31B (kendi kotamız) -> OpenRouter Nemotron 3.5 Super.
// 429 / 5xx: o sağlayıcı bir süre dinlenir, sıradakine geçilir; hepsi doluysa bekleyip yeniden denenir.
// Güvenlik: yalnızca ürün başlığı / kategori gibi herkese açık veri gönderilir; kişisel veri ve sır süzgeci istekten önce çalışır.
import { parseLooseJson } from "./gemini.ts";

type Provider = { name: string; call: (system: string, user: string) => Promise<string> };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export class LlmBusy extends Error {}

const BLOCK = [/(\+?90|0)?\s?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, /\bTR\d{2}\s?(\d{4}\s?){5}\d{2}\b/i, /(sk-or-|AIza|eyJ[A-Za-z0-9_-]{20,}\.)/];
export const unsafe = (s: string) => BLOCK.some((re) => re.test(s));

async function openrouter(model: string, system: string, user: string) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST", signal: AbortSignal.timeout(120_000),
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json", "X-Title": "trentakip" },
    body: JSON.stringify({ model, temperature: 0, max_tokens: 2000, reasoning: { enabled: false }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  });
  const j: any = await r.json().catch(() => ({}));
  const code = j?.error?.code ?? r.status;
  if (code === 429 || code >= 500 || r.status === 429) throw new LlmBusy(`${model} ${code}`);
  if (!r.ok || j.error) throw new Error(`${model} ${code}: ${String(j?.error?.message ?? "").slice(0, 120)}`);
  return String(j.choices?.[0]?.message?.content ?? "");
}

async function google(model: string, system: string, user: string) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", signal: AbortSignal.timeout(120_000),
    headers: { "x-goog-api-key": String(process.env.GEMINI_API_KEY), "Content-Type": "application/json" },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { temperature: 0, maxOutputTokens: 4096 } }), // Gemma önce düşünür (~450 belirteç); 600 sınırı cevaba yer bırakmıyordu (12.11)
  });
  const j: any = await r.json().catch(() => ({}));
  if (r.status === 429 || r.status >= 500) throw new LlmBusy(`${model} ${r.status}`);
  if (!r.ok) throw new Error(`${model} ${r.status}: ${String(j?.error?.message ?? "").slice(0, 120)}`);
  const parts = j.candidates?.[0]?.content?.parts ?? [];
  return String(parts.filter((p: any) => !p.thought).map((p: any) => p.text ?? "").join(""));
}

export function providers(): Provider[] {
  const out: Provider[] = [];
  if (process.env.OPENROUTER_API_KEY) out.push({ name: "openrouter:gemma-4-31b", call: (s, u) => openrouter("google/gemma-4-31b-it:free", s, u) });
  if (process.env.GEMINI_API_KEY) out.push({ name: "google:gemma-4-31b", call: (s, u) => google("gemma-4-31b-it", s, u) });
  if (process.env.GEMINI_API_KEY) out.push({ name: "google:gemma-4-26b", call: (s, u) => google("gemma-4-26b-a4b-it", s, u) }); // 31B sık 500/503 (12.11)
  if (process.env.OPENROUTER_API_KEY) out.push({ name: "openrouter:nemotron-3.5-super", call: (s, u) => openrouter("nvidia/nemotron-3.5-super-vl:free", s, u) });
  return out;
}

// İkinci görüş (uzlaşma): ilk cevabı veren modelden FARKLI bir Gemma (31B cevap verdiyse 26B, 26B verdiyse 31B)
export function secondOpinion(firstBy = ""): Provider[] {
  if (!process.env.GEMINI_API_KEY) return [];
  return /26b/.test(firstBy) ? [{ name: "google:gemma-4-31b", call: (s, u) => google("gemma-4-31b-it", s, u) }] : [{ name: "google:gemma-4-26b", call: (s, u) => google("gemma-4-26b-a4b-it", s, u) }];
}

// JSON isteyen tek çağrı; sağlayıcı zinciri ve bekleme. Dönüş: ayrıştırılmış JSON + hangi model.
export async function llmJson<T>(system: string, user: string, o: { maxWaitMs?: number; log?: (m: string) => void; only?: Provider[] } = {}): Promise<{ data: T | null; by: string }> {
  if (unsafe(system + user)) throw new Error("istemde kişisel veri / sır var, gönderilmedi");
  const list = o.only ?? providers();
  if (!list.length) throw new Error("OPENROUTER_API_KEY / GEMINI_API_KEY yok");
  const restUntil = (globalThis as any).__llmRest ??= new Map<string, number>();
  const deadline = Date.now() + (o.maxWaitMs ?? 15 * 60_000);
  for (let round = 0; Date.now() < deadline; round++) {
    for (const p of list) {
      if ((restUntil.get(p.name) ?? 0) > Date.now()) continue;
      try {
        const txt = await p.call(system, user);
        return { data: parseLooseJson<T>(txt), by: p.name };
      } catch (e: any) {
        const busy = e instanceof LlmBusy || /aborted|timeout|fetch failed/i.test(String(e?.message));
        restUntil.set(p.name, Date.now() + (busy ? 60_000 * Math.min(10, round + 1) : 10 * 60_000));
        o.log?.(`${p.name}: ${String(e?.message ?? e).slice(0, 120)}`);
      }
    }
    const next = Math.min(...list.map((p) => restUntil.get(p.name) ?? 0));
    await sleep(Math.max(5_000, Math.min(next - Date.now(), 120_000)));
  }
  return { data: null, by: "zaman aşımı" };
}
