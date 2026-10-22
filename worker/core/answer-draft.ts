// Müşteri sorusuna cevap TASLAĞI (Faz 6 F7). Hiçbir zaman kendiliğinden gönderilmez: panelden ya da Telegram'dan insan onaylar.
// ANTHROPIC_API_KEY yoksa taslak üretilmez (soru yine gelen kutusuna düşer). Prompt'a müşteri kişisel verisi girmez.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

const Draft = z.object({
  answer: z.string(),        // müşteriye gidecek metin (10-2000 karakter)
  unsure: z.boolean(),       // bilgi eksik / tahmin içeriyor: onaylayan dikkatle okusun
  note: z.string(),          // onaylayana not (ör. "garanti süresi ürün bilgisinde yok, kontrol et")
});
export type AnswerDraft = z.infer<typeof Draft>;

const SYSTEM = `Bir Türk e-ticaret mağazasının müşteri sorularına cevap TASLAĞI yazıyorsun. Taslağı mağaza sahibi okuyup onaylayacak.
Kurallar:
- Türkçe, kibar, kısa (1-4 cümle). "Merhaba," ile başla, "İyi alışverişler dileriz." ile bitir.
- Yalnızca verilen ürün bilgisine dayan. Bilgide olmayan şeyi (ölçü, malzeme, uyumluluk, garanti, teslim süresi, stok tarihi) uydurma:
  böyle bir durumda unsure=true yap, note alanına neyin kontrol edilmesi gerektiğini yaz, cevapta genel ve doğru bir ifade kullan.
- Söz verme (kesin teslim tarihi, indirim, hediye, değişim garantisi). İade/değişim için "pazaryerinin iade süreci" de.
- Telefon, e-posta, web sitesi, sosyal medya veya pazaryeri dışı iletişim yazma; müşteriden kişisel bilgi isteme.
- Rakip mağaza veya marka karşılaştırması yapma.`;

let client: Anthropic | null = null;
export const draftsEnabled = () => !!process.env.ANTHROPIC_API_KEY;

export async function draftAnswer(q: { question: string; title: string; description?: string; attributes?: Record<string, unknown>; tone?: string }): Promise<AnswerDraft | null> {
  if (!draftsEnabled()) return null;
  client ??= new Anthropic();
  const attrs = Object.entries(q.attributes ?? {}).filter(([k, v]) => v != null && v !== "" && !/kategori/i.test(k)).slice(0, 30).map(([k, v]) => `${k}: ${v}`).join("\n");
  const desc = String(q.description ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 3000);
  const r = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(Draft) },
    system: SYSTEM + (q.tone ? `\nMağazanın ton tercihi: ${q.tone.slice(0, 500)}` : ""),
    messages: [{ role: "user", content: `Ürün: ${q.title}\n${attrs ? `Özellikler:\n${attrs}\n` : ""}${desc ? `Açıklama: ${desc}\n` : ""}\nMüşteri sorusu: ${q.question.slice(0, 1500)}` }],
  });
  if (r.stop_reason === "refusal" || !r.parsed_output) return null;
  const d = r.parsed_output;
  return { answer: d.answer.trim().slice(0, 2000), unsure: d.unsure, note: d.note.trim().slice(0, 500) };
}
