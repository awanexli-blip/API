// Yapay zekâ ile ürün açıklaması düzeltme (migration 067, panel: Ürünler > Açıklamalar). K, 28.10: "%100 düzeltebilirse yazsın".
// 1) Taslak: yalnızca tedarikçi metnindeki bilgiyle; yazım/noktalama düzeltilir, tedarikçi kodu, iletişim, fiyat/kargo/stok sözleri atılır,
//    kısa giriş + "Özellikler" maddeleri (sınırlı HTML). Model emin değilse "confident: false" -> taslak yok.
// 2) Kurallı kontrol (desc-check.ts): kaynakta olmayan sayı/kod/iddia, HTML, iletişim, marka riski, yasaklı kelime, bilgi kaybı.
// 3) Doğrulama: ikinci çağrı taslağı kaynakla karşılaştırır; desteklenmeyen tek bir ifade bile varsa taslak yok.
// Üçünden geçen "ready" olur ve panelde onay bekler; geçemeyen "skipped" + neden (ürün tedarikçi metniyle kalır). Müşteri verisi girmez.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { geminiEnabled, geminiJson, GeminiQuotaError } from "./gemini.ts";
import { checkDescription, stripTags } from "./desc-check.ts";
import { loadBrandMatcher } from "./brand-risk.ts";
import { readAll } from "./util.ts";

const Draft = z.object({ html: z.string(), confident: z.boolean(), notes: z.string() });
const Verify = z.object({ unsupported: z.array(z.string()), verdict: z.enum(["dogru", "hatali"]) });
const DRAFT_SCHEMA = { type: "object", properties: { html: { type: "string" }, confident: { type: "boolean" }, notes: { type: "string" } }, required: ["html", "confident", "notes"] };
const VERIFY_SCHEMA = { type: "object", properties: { unsupported: { type: "array", items: { type: "string" } }, verdict: { type: "string", enum: ["dogru", "hatali"] } }, required: ["unsupported", "verdict"] };

const SYSTEM_DRAFT = `Türk bir e-ticaret mağazasının ürün açıklamalarını düzenleyen dikkatli bir editörsün. Tedarikçinin yazdığı açıklamayı pazaryeri için temiz ve düzgün hâle getir.
KESİN KURALLAR:
- YALNIZCA kaynak metindeki (başlık, açıklama, özellikler) bilgileri kullan. Yeni bilgi, ölçü, sayı, malzeme, renk, uyumluluk, kullanım alanı, fayda ya da iddia EKLEME.
- Kaynakta yoksa şunları asla yazma: orijinal, garanti, %100, en iyi/kaliteli, su geçirmez, sertifika, sağlık etkisi, el yapımı, yerli üretim, kargo/teslimat, fiyat/indirim/hediye, stok.
- Yazım, noktalama ve büyük-küçük harf hatalarını düzelt; tekrarları birleştir; tedarikçi kodlarını, web adreslerini, telefon/iletişim bilgilerini, "sitemizde", "mağazamızda" gibi ifadeleri çıkar.
- Kaynaktaki her somut bilgiyi koru (ölçü, adet, malzeme, özellik). Sayıları aynen yaz.
- Biçim: 1-2 cümlelik giriş <p> içinde, sonra <ul><li> maddeleri (her madde kaynaktan bir bilgi). Gerekirse <strong> ile kısa başlık. Başka HTML etiketi ya da öznitelik kullanma. Emoji yok.
- Türkçe, sade, abartısız. 400-1500 karakter ideal; kaynak kısaysa kısa kalsın, şişirme.
- Kaynak çelişkili, anlaşılmaz ya da ürünü tarif etmiyorsa confident: false ver ve html boş kalsın. Emin değilsen confident: false.
notes: neyi düzelttiğin (kısa).`;

const SYSTEM_VERIFY = `Bir ürün açıklaması taslağını kaynak metinle karşılaştıran denetçisin. Görevin: taslakta kaynakta DAYANAĞI OLMAYAN her ifadeyi bulmak.
Dayanak: kaynakta aynı bilgi açıkça yazıyor (eşanlamlı ifade olabilir). Yorum, çıkarım, abartı, eklenmiş fayda ya da kullanım alanı, değişmiş sayı/ölçü/adet, eklenmiş malzeme/renk/uyumluluk = dayanaksız.
Biçim düzeltmeleri, yazım düzeltmeleri ve kaynaktaki bilginin yeniden ifade edilmesi dayanaksız sayılmaz.
unsupported: dayanaksız her ifade (taslaktan aynen alıntı). Hiç yoksa boş dizi ve verdict "dogru"; en az bir tane varsa verdict "hatali".`;

let client: Anthropic | null = null;
const claudeOn = () => !!process.env.ANTHROPIC_API_KEY;
export const descEnabled = () => claudeOn() || geminiEnabled();

async function ask<T>(schema: z.ZodType<T>, gschema: Record<string, unknown>, system: string, prompt: string): Promise<T | null> {
  if (!claudeOn()) { const g = await geminiJson<T>(system, prompt, gschema); const ok = g ? schema.safeParse(g) : null; return ok?.success ? ok.data : null; }
  client ??= new Anthropic();
  const r = await client.beta.messages.parse({
    model: "claude-opus-5-5", max_tokens: 4000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(schema as any) }, system, messages: [{ role: "user", content: prompt }],
  });
  return r.stop_reason === "refusal" ? null : ((r.parsed_output as T) ?? null);
}

type Cand = { id: string; title: string; description: string; brand: string | null; category: string | null; attributes: Record<string, unknown> | null; source_hash: string };
const sourceBlock = (c: Cand) => {
  const attrs = Object.entries(c.attributes ?? {}).filter(([k, v]) => !/kategori|satış fiyatı|@|^_/i.test(k) && v != null && typeof v !== "object").slice(0, 25).map(([k, v]) => `${k}: ${String(v).slice(0, 80)}`).join("\n");
  return `BAŞLIK: ${c.title}\n${attrs ? `ÖZELLİKLER:\n${attrs}\n` : ""}AÇIKLAMA:\n${stripTags(c.description).slice(0, 4000)}`;
};

export async function draftDescriptions(db: any, opts: { max?: number } = {}) {
  const out: Record<string, any> = { provider: claudeOn() ? "claude" : geminiEnabled() ? "gemini" : null, candidates: 0, ready: 0, skipped: 0, errors: 0, reasons: {} as Record<string, number> };
  if (!descEnabled()) return { ...out, skippedRun: "yapay zekâ anahtarı yok (ANTHROPIC_API_KEY / GEMINI_API_KEY)" };
  const { data: cands, error } = await db.rpc("desc_candidates", { p_limit: opts.max ?? 20 });
  if (error) return { ...out, skippedRun: /desc_candidates/.test(error.message) ? "migration 067 uygulanmamış" : error.message };
  out.candidates = cands?.length ?? 0;
  if (!out.candidates) return out;
  const brandMatch = await loadBrandMatcher(db);
  const bw = await readAll((a: number, b: number) => db.from("banned_words").select("word").eq("marketplace", "trendyol").order("word").range(a, b));
  const banned = (bw.data ?? []).map((r: any) => r.word as string);
  const prev = new Map<string, number>();
  { const { data } = await db.from("product_descriptions").select("product_id, attempts").in("product_id", cands.map((c: Cand) => c.id)); for (const r of data ?? []) prev.set(r.product_id, r.attempts); }
  for (const c of cands as Cand[]) {
    const now = new Date().toISOString();
    const base = { product_id: c.id, source_hash: c.source_hash, original: c.description, updated_at: now, attempts: (prev.get(c.id) ?? 0) + 1, model: out.provider };
    const skip = async (reason: string, checks: any = {}) => {
      out.skipped++; const key = reason.replace(/[:(].*$/, "").trim(); out.reasons[key] = (out.reasons[key] ?? 0) + 1;
      await db.from("product_descriptions").upsert({ ...base, status: "skipped", draft: null, reason: reason.slice(0, 500), checks });
    };
    try {
      const src = sourceBlock(c);
      const d = await ask(Draft, DRAFT_SCHEMA, SYSTEM_DRAFT, `KAYNAK:\n${src}\n\nBu ürünün açıklamasını kurallara göre düzenle.`);
      if (!d) { await skip("model yanıt vermedi"); continue; }
      if (!d.confident || !d.html.trim()) { await skip(`model emin değil${d.notes ? `: ${d.notes.slice(0, 200)}` : ""}`); continue; }
      const chk = checkDescription(d.html, { title: c.title, description: c.description, attributes: c.attributes, brand: c.brand }, { brandMatch, banned });
      if (!chk.ok) { await skip(`kontrol: ${chk.reasons.join("; ")}`, { rules: chk.reasons }); continue; }
      const v = await ask(Verify, VERIFY_SCHEMA, SYSTEM_VERIFY, `KAYNAK:\n${src}\n\nTASLAK:\n${chk.text}`);
      if (!v) { await skip("doğrulama yanıt vermedi"); continue; }
      if (v.verdict !== "dogru" || v.unsupported.length) { await skip(`doğrulama: dayanaksız ifade: ${v.unsupported.slice(0, 3).join(" | ").slice(0, 300)}`, { unsupported: v.unsupported.slice(0, 10) }); continue; }
      const { error: we } = await db.from("product_descriptions").upsert({ ...base, status: "ready", draft: chk.html, reason: null, checks: { rules: [], unsupported: [], notes: d.notes.slice(0, 300) } });
      if (we) { out.errors++; out.lastError = we.message.slice(0, 200); continue; }
      out.ready++;
    } catch (e: any) {
      if (e instanceof GeminiQuotaError) { out.quota = true; out.lastError = String(e.message).slice(0, 200); break; } // kota: bu çalışmada dur, sonra devam
      out.errors++; out.lastError = String(e?.message ?? e).slice(0, 200);
    }
  }
  return out;
}

// Onaylı açıklamalar -> canlı Trendyol ilanı (content-bulk-update, contentId + description). Varyantlar aynı içerik: tek kez.
// İlk denemede az sayıda (DESC_PUSH_LIMIT, varsayılan 20): Trendyol içerik güncellemesini onaya alıp almadığı canlıda görülecek.
export async function pushDescriptions(db: any, mp: { id: string; updateDescriptions?: (items: { contentId: string; description: string }[]) => Promise<{ ok: number; failed: number; batchIds: string[]; errors?: string[] }> },
  listings: { id: string; status?: string; contentId?: string }[], limit = Number(process.env.DESC_PUSH_LIMIT ?? 20)) {
  if (!mp.updateDescriptions) return { skipped: "pazaryerinde açıklama güncelleme yok" };
  const { data: appr, error } = await db.from("product_descriptions").select("product_id, draft, pushed").eq("status", "approved").not("draft", "is", null).order("decided_at").limit(500);
  if (error) return { skipped: /product_descriptions/.test(error.message) ? "migration 067 uygulanmamış" : error.message };
  const todo = (appr ?? []).filter((r: any) => !r.pushed?.[mp.id]).slice(0, Math.max(0, limit));
  if (!todo.length) return { sent: 0 };
  const content = new Map(listings.filter((l) => l.status === "active" && l.contentId).map((l) => [l.id, l.contentId!]));
  const { data: ls } = await db.from("marketplace_listings").select("listing_key, product_id").eq("marketplace", mp.id).in("product_id", todo.map((t: any) => t.product_id));
  const items: { contentId: string; description: string }[] = [], byProduct = new Map<string, number>(), seen = new Set<string>();
  for (const t of todo) for (const l of (ls ?? []).filter((x: any) => x.product_id === t.product_id)) {
    const cid = content.get(l.listing_key);
    if (!cid || seen.has(cid)) continue;
    seen.add(cid); items.push({ contentId: cid, description: t.draft }); byProduct.set(t.product_id, (byProduct.get(t.product_id) ?? 0) + 1);
  }
  if (!items.length) return { sent: 0, noLiveListing: todo.length };
  const r = await mp.updateDescriptions(items);
  if (r.failed) return { sent: 0, failed: r.failed, errors: r.errors };
  const at = new Date().toISOString();
  for (const [pid, n] of byProduct) {
    const row = todo.find((t: any) => t.product_id === pid);
    await db.from("product_descriptions").update({ pushed: { ...(row?.pushed ?? {}), [mp.id]: { at, batch: r.batchIds[0] ?? null, listings: n } }, updated_at: at }).eq("product_id", pid);
  }
  return { sent: items.length, products: byProduct.size, batchIds: r.batchIds };
}
