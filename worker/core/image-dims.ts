// Görseldeki YAZILI ölçüyü iki FARKLI görsel modeliyle okuma (K 19.11 karar A): iki model aynı ölçüyü okursa kullanılır, okuyamaz ya da
// anlaşamazsa ölçü yazılmaz (worker/core/contradictions.ts resolveDimensions). Model tahmin etmez: yalnızca görselde yazan sayılar.
// Çağıranlar takılabilir: sunucuda Gemini (worker/core/gemini.ts) / OpenRouter, yerelde OmniRoute (ops/ai/omni.mjs ile aynı ağ geçidi).
// Model ayarı: DIMS_MODELS="gemini:gemini-2.5-flash,openrouter:nvidia/nemotron-3.5-super-vl:free" ya da "omni:gemini/gemini-3.7-flash,omni:dva/gpt-5-6-luna-low".
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { geminiCall, parseLooseJson } from "./gemini.ts";
import { safeFetch } from "./safe-fetch.ts";
import type { Dims, DimReads } from "./contradictions.ts";

export type Img = { mime: string; b64: string };
export type VisionCaller = { name: string; call: (prompt: string, img: Img) => Promise<string> };

export const DIMS_PROMPT = `Bu bir ürün fotoğrafı. Görevin: fotoğrafın ÜZERİNDE YAZI olarak yazılmış ürün ÖLÇÜLERİNİ okumak (ör. "13 cm", "15x20 cm", ok/çizgiyle gösterilen boyut etiketleri).
KURALLAR:
- Yalnızca görselde açıkça YAZAN sayıları oku. Ürünün boyutunu tahmin etme, cetvel/oran çıkarımı yapma, genel bilgi kullanma.
- Aynı ürünün ok/çizgiyle ayrı ayrı gösterilen ölçülerini (genişlik, derinlik, yükseklik) TEK kayıtta birleştir.
- Birim görselde yazıyorsa onu yaz (cm, mm, m). Yazmıyorsa unit boş kalsın.
- Kapasite (ml, L), ağırlık (g, kg), güç (W), ekran (inç) ölçü DEĞİLDİR, yazma.
- Görselde ölçü yazısı yoksa dims boş dizi.
Sadece JSON: {"dims":[{"values":[13,15,20],"unit":"cm","text":"görseldeki yazı aynen"}]}`;

/** Model yanıtı -> ölçüler (cm). Geçersiz yanıt: null (okunamadı). Birimsiz değer cm sayılır yalnızca 3 haneden küçükse. */
export function parseDimsReply(text: string): Dims[] | null {
  const j = parseLooseJson<{ dims?: { values?: unknown[]; unit?: string; text?: string }[] }>(text);
  if (!j || !Array.isArray(j.dims)) return null;
  const out: Dims[] = [];
  for (const d of j.dims) {
    const raw = Array.isArray(d?.values) ? d.values.map((v) => Number(String(v).replace(",", "."))) : [];
    if (raw.length < 1 || raw.length > 3 || raw.some((v) => !(v > 0) || v > 100000)) continue;
    const u = String(d.unit ?? "").trim().toLowerCase();
    const mul = u === "mm" ? 0.1 : u === "m" || u === "metre" ? 100 : u === "cm" || u === "" ? 1 : NaN;
    if (!Number.isFinite(mul)) continue; // ml, kg vb.
    if (u === "" && raw.some((v) => v >= 1000)) continue;
    const values = raw.map((v) => Math.round(v * mul * 100) / 100);
    if (/kutu|paket|koli|ambalaj|box|package/i.test(String(d.text ?? ""))) continue; // ambalaj ölçüsü ürün ölçüsü değil
    if (values.length < 2) continue; // tek sayı (yalnızca yükseklik) açıklamadaki NNxNN ile karşılaştırılamaz
    out.push({ values, raw: String(d.text ?? `${raw.join("x")} ${u}`).slice(0, 60) });
  }
  return out;
}

export async function fetchImage(url: string): Promise<Img | null> {
  try {
    const r = await safeFetch(url, { maxBytes: 8 * 1048576, timeoutMs: 30_000, accept: /^image\// });
    if (!r.ok || r.body.length < 500) return null;
    return { mime: r.contentType || "image/jpeg", b64: r.body.toString("base64") };
  } catch { return null; }
}

// --- çağıranlar ---
export function geminiVision(model: string): VisionCaller {
  return { name: `gemini:${model}`, call: async (prompt, img) => (await geminiCall({ model, parts: [{ inline_data: { mime_type: img.mime, data: img.b64 } }, { text: prompt }], timeoutMs: 90_000 })).text };
}
async function openaiCompat(base: string, key: string, model: string, prompt: string, img: Img, headers: Record<string, string> = {}) {
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST", signal: AbortSignal.timeout(120_000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ model, temperature: 0, max_tokens: 800, messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:${img.mime};base64,${img.b64}` } }] }] }),
  });
  const j: any = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${model} ${r.status}: ${String(j?.error?.message ?? "").slice(0, 120)}`);
  return String(j?.choices?.[0]?.message?.content ?? "");
}
export function openrouterVision(model: string): VisionCaller {
  return { name: `openrouter:${model}`, call: (p, img) => openaiCompat("https://openrouter.ai/api/v1", String(process.env.OPENROUTER_API_KEY), model, p, img, { "X-Title": "trentakip" }) };
}
/** Yerel OmniRoute (yalnızca K'nın bilgisayarında; sunucudan erişilmez). Anahtar: OMNIROUTE_API_KEY ya da ~/.omniroute/claude.key */
export function omniVision(model: string): VisionCaller {
  const base = (process.env.OMNIROUTE_BASE_URL || "http://127.0.0.1:20128/v1").replace(/\/+$/, "");
  const f = join(homedir(), ".omniroute", "claude.key");
  const key = (process.env.OMNIROUTE_API_KEY || (existsSync(f) ? readFileSync(f, "utf8") : "")).trim();
  return { name: `omni:${model}`, call: (p, img) => openaiCompat(base, key, model, p, img) };
}
export function visionCallers(spec = process.env.DIMS_MODELS ?? ""): VisionCaller[] {
  const list = spec.split(",").map((s) => s.trim()).filter(Boolean);
  const def = list.length ? list : [
    ...(process.env.GEMINI_API_KEY ? ["gemini:gemini-2.5-flash"] : []),
    ...(process.env.OPENROUTER_API_KEY ? ["openrouter:nvidia/nemotron-3.5-super-vl:free"] : process.env.GEMINI_API_KEY ? ["gemini:gemma-4-31b-it"] : []),
  ];
  return def.map((s) => {
    const [kind, ...rest] = s.split(":"); const m = rest.join(":");
    return kind === "omni" ? omniVision(m) : kind === "openrouter" ? openrouterVision(m) : geminiVision(m);
  });
}

/** İki farklı modelle oku. Model aynıysa (yanlış ayar) okuma yapılmaz: uzlaşma anlamsız olur. */
export async function readDimsTwoModels(img: Img, callers: VisionCaller[], log: (m: string) => void = () => {}): Promise<DimReads | null> {
  if (callers.length < 2 || callers[0].name === callers[1].name) return null;
  const one = async (c: VisionCaller) => {
    try { return parseDimsReply(await c.call(DIMS_PROMPT, img)); }
    catch (e: any) { if (/kota|429|quota/i.test(String(e?.message))) throw e; log(`görsel ölçü ${c.name}: ${String(e?.message ?? e).slice(0, 120)}`); return null; }
  };
  const a = await one(callers[0]);
  const b = await one(callers[1]);
  return { a, b, models: [callers[0].name, callers[1].name] };
}

/** Birden çok görsel (ölçü çoğu zaman 2.-4. görselde): birinci model sırayla okur, ölçü bulduğu İLK görseli ikinci model de okur.
 *  Birinci model hiçbirinde bulamazsa ikinci model ilk görseli okur (çelişki kanıtı için). Çağrı sayısı en fazla görsel sayısı + 1. */
export async function readDimsImages(imgs: Img[], callers: VisionCaller[], log: (m: string) => void = () => {}): Promise<(DimReads & { image: number }) | null> {
  if (!imgs.length || callers.length < 2 || callers[0].name === callers[1].name) return null;
  const one = async (c: VisionCaller, img: Img) => {
    try { return parseDimsReply(await c.call(DIMS_PROMPT, img)); }
    catch (e: any) { if (/kota|429|quota/i.test(String(e?.message))) throw e; log(`görsel ölçü ${c.name}: ${String(e?.message ?? e).slice(0, 120)}`); return null; }
  };
  let firstA: Dims[] | null = null, anyRead = false;
  for (let i = 0; i < imgs.length; i++) {
    const a = await one(callers[0], imgs[i]);
    if (a) anyRead = true;
    if (i === 0) firstA = a;
    if (a?.length) return { a, b: await one(callers[1], imgs[i]), models: [callers[0].name, callers[1].name], image: i };
  }
  return { a: anyRead ? (firstA ?? []) : null, b: await one(callers[1], imgs[0]), models: [callers[0].name, callers[1].name], image: 0 };
}
