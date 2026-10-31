// Eksik zorunlu özellikleri yapay zekâ ile doldurma: ürün başlığı + açıklamasından, pazaryerinin kabul ettiği değer listesinden seçer
// (attr_options; serbest metin yalnızca pazaryeri izin veriyorsa). Emin olmadığı özelliği boş bırakır (uydurma yok); boş kalan özellik
// panelde Özellik tamamla'ya düşer. Yazılan değer ürün kaydına gider (diğer pazaryerleri de kullanır); eksiği kalmayan ilan yeniden gönderilir.
// Sağlayıcı: ANTHROPIC_API_KEY varsa Claude, yoksa GEMINI_API_KEY ile Gemini (ücretsiz kota: çalışma başına az ürün, sırayla); ikisi de yoksa çalışmaz. Ürün başına 7 günde bir deneme (ai_attr_runs, migration 045). Müşteri verisi prompt'a girmez.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { geminiCall, geminiEnabled, geminiJson, GeminiQuotaError, parseLooseJson, type GeminiPart } from "./gemini.ts";
import { safeFetch } from "./safe-fetch.ts";

const Out = z.object({
  values: z.array(z.object({
    name: z.string(),                 // özellik adı (sorulduğu gibi)
    value: z.string().nullable(),     // listeden birebir değer; bilinmiyorsa null
    basis: z.enum(["baslik", "aciklama", "cikarim", "fotograf", "arama"]),
    confidence: z.number().optional(), // 0-1; AI_ATTR_MIN_CONF (varsayılan 0,8) altı yazılmaz (K, 01.11: "%80 doğruluk")
  })),
});

const SYSTEM = `Bir Türk e-ticaret mağazasının ürünleri için pazaryerinin zorunlu tuttuğu özellikleri dolduruyorsun.
Her özellik için verilen değer listesinden BİREBİR bir değer seç (yazımı aynen kopyala). Liste "serbest" ise kısa bir değer yaz (en fazla 40 karakter, birim dahil).
Kurallar:
- Değer başlıkta ya da açıklamada geçiyorsa onu seç (basis: baslik / aciklama).
- Açıkça yazmıyorsa ürün türünden makul ve doğru bir çıkarım yapabiliyorsan seç (basis: cikarim). Örnek: peluş oyuncak -> Malzeme: Peluş; kablosuz kulaklık -> Bağlantı: Bluetooth; çocuk oyuncağı -> Yaş Grubu: Çocuk.
- Emin değilsen value: null. Ölçü, sayı, süre, model uyumluluğu gibi kesin bilgileri asla uydurma; yalnızca metinde varsa yaz.
- Cinsiyet: metinde kadın/erkek/kız/oğlan geçmiyorsa ve listede Unisex yoksa null.
- Ürün listedeki hiçbir değere uymuyorsa (yanlış kategori) null.
- Ürün fotoğrafı verildiyse ona da bak (renk, malzeme, tip, kanat/parça sayısı gibi görünen özellikler; basis: fotograf).
- Google araması açıksa ürün adıyla aynı ürünün teknik bilgisini arayabilirsin (basis: arama); YALNIZCA aynı ürün olduğundan eminsen kullan.
- Her değer için confidence ver (0-1): bu değerin doğru olma olasılığı. 0,8'den az eminsen value: null.`;

let client: Anthropic | null = null;
const claudeOn = () => !!process.env.ANTHROPIC_API_KEY;
export const aiAttrsEnabled = () => claudeOn() || geminiEnabled();
// Gemini yanıt şeması (Claude'daki zod şemasının aynısı)
const GEMINI_SCHEMA = { type: "object", properties: { values: { type: "array", items: { type: "object", properties: {
  name: { type: "string" }, value: { type: "string", nullable: true }, basis: { type: "string", enum: ["baslik", "aciklama", "cikarim", "fotograf", "arama"] }, confidence: { type: "number" } }, required: ["name", "value", "basis", "confidence"] } } }, required: ["values"] };
const lo = (s: string) => s.replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr").trim();
const clean = (s: string) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

type Opt = { values: string[]; custom: boolean };
export type AiAttrInput = { title: string; description: string; known: Record<string, unknown>; ask: { name: string; opt: Opt }[]; image?: { mime: string; data: string } | null };
const minConf = () => Number(process.env.AI_ATTR_MIN_CONF ?? 0.8);

// Modelin cevabını doğrula: listedeki değer (büyük/küçük harf farkı tolere edilir, listedeki yazım kullanılır) ya da izinliyse kısa serbest metin
export function acceptValues(ask: AiAttrInput["ask"], out: z.infer<typeof Out>): Record<string, string> {
  const res: Record<string, string> = {};
  for (const a of ask) {
    const hit = out.values.find((x) => lo(x.name) === lo(a.name));
    const v = hit?.value;
    if (!v || !v.trim()) continue;
    if (hit.confidence != null && hit.confidence < minConf()) continue; // emin değil: boş kalır
    const exact = a.opt.values.find((x) => lo(x) === lo(v));
    if (exact) res[a.name] = exact;
    else if (a.opt.custom && !a.opt.values.length && v.trim().length <= 40) res[a.name] = v.trim();
  }
  return res;
}

export async function suggestAttributes(inp: AiAttrInput): Promise<Record<string, string>> {
  if (!aiAttrsEnabled() || !inp.ask.length) return {};
  const known = Object.entries(inp.known).filter(([k, v]) => v != null && v !== "" && !/kategori|^_/i.test(k)).slice(0, 25).map(([k, v]) => `${k}: ${String(v).slice(0, 80)}`).join("\n");
  const asks = inp.ask.map((a) => `- ${a.name}: ${a.opt.values.length ? a.opt.values.slice(0, 300).join(" | ") : "serbest"}`).join("\n");
  const prompt = `Ürün başlığı: ${clean(inp.title).slice(0, 300)}\n${known ? `Bilinen özellikler:\n${known}\n` : ""}Açıklama: ${clean(inp.description).slice(0, 3000) || "(yok)"}\n\nDoldurulacak özellikler ve değer listeleri:\n${asks}`;
  if (!claudeOn()) {
    // Fotoğraf ve/veya Google araması (AI_ATTR_SEARCH=1): araç kullanılan çağrıda şema verilemez, JSON metinden ayrıştırılır
    if (inp.image || process.env.AI_ATTR_SEARCH === "1") {
      const parts: GeminiPart[] = [{ text: `${prompt}

Yanıtı YALNIZCA şu JSON biçiminde ver: {"values":[{"name":"...","value":"... ya da null","basis":"baslik|aciklama|cikarim|fotograf|arama","confidence":0.0}]}` }];
      if (inp.image) parts.push({ inline_data: { mime_type: inp.image.mime, data: inp.image.data } });
      const r = await geminiCall({ system: SYSTEM, parts, tools: process.env.AI_ATTR_SEARCH === "1" ? ["google_search"] : undefined, timeoutMs: 120_000 });
      const ok = Out.safeParse(parseLooseJson(r.text));
      return ok.success ? acceptValues(inp.ask, ok.data) : {};
    }
    const g = await geminiJson<z.infer<typeof Out>>(SYSTEM, prompt, GEMINI_SCHEMA);
    const ok = g ? Out.safeParse(g) : null;
    return ok?.success ? acceptValues(inp.ask, ok.data) : {};
  }
  client ??= new Anthropic();
  const r = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(Out) },
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });
  if (r.stop_reason === "refusal" || !r.parsed_output) return {};
  return acceptValues(inp.ask, r.parsed_output);
}

// Senkron adımı: aday ilanlar (ai_attr_candidates) -> öneri -> ürün kaydına yaz -> eksiği kalmayanı yeniden gönderim kuyruğuna al
export async function aiFillAttributes(db: any, marketplace: string, max = claudeOn() ? 120 : 20) {
  if (!aiAttrsEnabled()) return { skipped: "ANTHROPIC_API_KEY / GEMINI_API_KEY yok" };
  const { data: cands, error } = await db.rpc("ai_attr_candidates", { p_mp: marketplace, p_limit: max });
  if (error) return { error: error.message.slice(0, 200) };
  const list = (cands ?? []) as any[];
  if (!list.length) return { candidates: 0 };
  // Değer listeleri (kategori + özellik)
  const cats = [...new Set(list.map((c) => String(c.category_id)))];
  const opts = new Map<string, Opt>();
  for (let i = 0; i < cats.length; i += 200) {
    const { data } = await db.from("attr_options").select("category_id, name, values, allow_custom").eq("marketplace", marketplace).in("category_id", cats.slice(i, i + 200));
    for (const o of data ?? []) opts.set(`${o.category_id}|${lo(o.name)}`, { values: Array.isArray(o.values) ? o.values.map(String) : [], custom: !!o.allow_custom });
  }
  const out = { provider: claudeOn() ? "claude" : "gemini", candidates: list.length, asked: 0, filled: 0, products: 0, requeued: 0, errors: 0, quota: false };
  const ready: string[] = [];
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const work = list.filter((c) => !seen.has(c.product_id) && seen.add(c.product_id));
  const par = claudeOn() ? 4 : 1; // Gemini ücretsiz kota: sırayla
  // Ürünün ilk görseli (Gemini fotoğrafa da bakar; AI_ATTR_IMAGE=0 kapatır). İndirilemezse görselsiz devam
  const imgUrl = new Map<string, string>();
  if (!claudeOn() && process.env.AI_ATTR_IMAGE !== "0") {
    const ids = [...new Set(list.map((c) => c.product_id))];
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await db.from("product_images").select("product_id, url, position").in("product_id", ids.slice(i, i + 200)).order("position");
      for (const r of data ?? []) if (!imgUrl.has(r.product_id)) imgUrl.set(r.product_id, r.url);
    }
  }
  const imageOf = async (pid: string) => {
    const u = imgUrl.get(pid);
    if (!u) return null;
    const r = await safeFetch(u, { maxBytes: 5 * 1048576, timeoutMs: 30_000 }).catch(() => null);
    const mime = String(r?.contentType ?? "").split(";")[0];
    return r?.ok && /^image\/(jpeg|png|webp)$/.test(mime) ? { mime, data: r.body.toString("base64") } : null;
  };
  for (let i = 0; i < work.length && !out.quota; i += par) {
    await Promise.all(work.slice(i, i + par).map(async (c) => {
      const known = (c.attributes ?? {}) as Record<string, unknown>;
      const missing = (c.missing as string[]).filter((n) => known[n] == null || known[n] === "");
      const ask = missing.map((name) => ({ name, opt: opts.get(`${c.category_id}|${lo(name)}`) })).filter((a): a is { name: string; opt: Opt } => !!a.opt && (a.opt.values.length > 0 || a.opt.custom));
      let filled: Record<string, string> = {};
      try { filled = await suggestAttributes({ title: c.title, description: c.description ?? "", known, ask, image: await imageOf(c.product_id) }); }
      catch (e: any) {
        if (e instanceof GeminiQuotaError) { out.quota = true; (out as any).quotaMessage ??= e.message; return; } // kota: bu çalışmada dur, ürün sonra yeniden denenir
        out.errors++; (out as any).lastError ??= String(e?.message ?? e).slice(0, 300); // özet: neden (anahtar mesajda yok)
        if (out.errors <= 2) console.error("yapay zekâ özellik:", String(e?.message ?? e).slice(0, 200)); return;
      }
      out.asked += ask.length;
      await db.from("ai_attr_runs").upsert({ product_id: c.product_id, marketplace, at: now, asked: ask.map((a) => a.name), filled }, { onConflict: "product_id,marketplace" });
      if (!Object.keys(filled).length) return;
      // Yalnızca boş anahtarlar yazılır (elle girilen ezilmez); güncel kayıt üzerine birleştirilir
      const { data: cur } = await db.from("products").select("attributes").eq("id", c.product_id).maybeSingle();
      const attrs = { ...(cur?.attributes ?? {}) } as Record<string, unknown>;
      for (const [k, v] of Object.entries(filled)) if (attrs[k] == null || attrs[k] === "") attrs[k] = v;
      const { error: ue } = await db.from("products").update({ attributes: attrs, updated_at: now }).eq("id", c.product_id);
      if (ue) { out.errors++; return; }
      out.filled += Object.keys(filled).length; out.products++;
      if ((c.missing as string[]).every((n) => attrs[n] != null && attrs[n] !== "")) ready.push(c.product_id);
    }));
  }
  // Eksiği kalmayanlar: ilan "sırada" + gönderim işi (100'erli)
  for (let i = 0; i < ready.length; i += 100) {
    const part = ready.slice(i, i + 100);
    const { error: je } = await db.from("jobs").insert({ type: `send_products:${marketplace}`, marketplace, payload: { product_ids: part }, idempotency_key: `aiattr:${marketplace}:${now}:${i / 100}`, created_by: "yapay zekâ özellik" });
    if (je) continue;
    await db.from("marketplace_listings").update({ status: "queued", last_error: null, updated_at: now }).eq("marketplace", marketplace).eq("status", "error").in("product_id", part);
    out.requeued += part.length;
  }
  return out;
}
