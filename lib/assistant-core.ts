// Telegram durum asistanı: saf kısım (veritabanına dokunmaz, test edilir). Araçlar lib/assistant-tools.ts, giriş app/api/telegram.
// Kurallar (K, 29.10): salt okunur; Gemini'ye serbest SQL / anahtar verilmez, yalnızca sabit parametreli araçlar; müşteri adı, adres,
// telefon, e-posta Gemini'ye gitmez; araç sonucunda olmayan bilgi uydurulmaz.

// Kişisel veri süzgeci (ops/ai/gemini.mjs ile aynı kalıplar): araç sonucu ve kullanıcı mesajı Gemini'ye gitmeden, cevap Telegram'a gitmeden
const PII: [RegExp, string][] = [
  [/(sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g, "[anahtar]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[e-posta]"],
  [/\bTR\d{2}\s?(\d{4}\s?){5}\d{2}\b/gi, "[IBAN]"],
  [/(\+?90[\s-]?|0)?\(?5\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g, "[telefon]"],
];
// TC kimlik no: 11 hane + kontrol haneleri tutuyorsa gizlenir (sipariş numaraları da 11 hane; onlar kalmalı)
export function isTcNo(d: string): boolean {
  if (!/^[1-9]\d{10}$/.test(d)) return false;
  const n = [...d].map(Number);
  const odd = n[0] + n[2] + n[4] + n[6] + n[8], even = n[1] + n[3] + n[5] + n[7];
  return ((odd * 7 - even) % 10 + 10) % 10 === n[9] && n.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === n[10];
}
export function scrub(s: unknown): string {
  let t = String(s ?? "");
  for (const [re, rep] of PII) t = t.replace(re, rep);
  return t.replace(/\b[1-9]\d{10}\b/g, (m) => (isTcNo(m) ? "[TC no]" : m));
}
// Nesnenin tüm metin alanlarını süz (araç sonucu)
export function scrubDeep<T>(v: T): T {
  if (typeof v === "string") return scrub(v) as T;
  if (Array.isArray(v)) return v.map(scrubDeep) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubDeep(x)])) as T;
  return v;
}

// Soru cevabının durumu: K'nın istediği üç ayrım ("iletildi" / "denendi ama hata" / "bekliyor") ve diğerleri
export const QUESTION_STATUS: Record<string, string> = {
  answered: "İletildi (cevap pazaryerine gönderildi)",
  failed: "Gönderim denendi ama hata aldı",
  approved: "Bekliyor: onaylandı, sıradaki senkronda gönderilecek",
  sending: "Bekliyor: şu an gönderiliyor",
  drafted: "Cevap bekliyor: taslak hazır, henüz onaylanmadı",
  new: "Cevap bekliyor: henüz onaylanmadı",
  answered_elsewhere: "Pazaryerinde başka yerden cevaplanmış (sistem göndermedi)",
  ignored: "Yoksayıldı",
};
export const questionStatus = (s: string) => QUESTION_STATUS[s] ?? `Bilinmeyen durum (${s})`;

// Pazaryeri hata gövdesinden okunur neden: "Trendyol 400: <açıklama> (/yol) {json}" -> açıklama; yoksa ilk 160 karakter
export function shortReason(err: unknown): string | null {
  const e = String(err ?? "").trim();
  if (!e) return null;
  const m = e.match(/^(\w+ \d{3}): ([^({]+?)\s*\(/);
  if (m) return scrub(`${m[1]}: ${m[2]}`).slice(0, 200);
  return scrub(e.replace(/\{.*$/s, "").trim() || e).slice(0, 160);
}

// Kullanıcının aradığı kelime: PostgREST filtresini bozacak karakterler atılır
export const searchTerm = (s: unknown) => String(s ?? "").replace(/[,()%*\\:"'.]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

export const trTime = (x: unknown) => {
  if (!x) return null;
  const d = new Date(String(x));
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

export const SYSTEM = `Sen K'nın e-ticaret otomasyon sisteminin (Trendyol, Hepsiburada) durum asistanısın. Telegram'da Türkçe, kısa ve net cevap ver.
KURALLAR:
- Bilgiyi YALNIZCA araç sonuçlarından al. Araç sonucunda olmayan bir şeyi asla uydurma; bilmiyorsan "bu bilgiye erişimim yok" de.
- Gerekirse birden fazla araç çağır. Soru belirsizse en ilgili aracı çağır, gerekirse genel_ozet ile başla.
- Müşteri sorusu cevaplarının durumunu araçtaki ifadeyle aynen söyle: "İletildi", "Gönderim denendi ama hata aldı" (nedenini de yaz), "Bekliyor". Bu ifadeleri YALNIZCA müşteri sorusu cevapları için kullan; senkron, sipariş, ilan durumlarını araçtaki kendi kelimeleriyle söyle.
- Sen salt okunursun: hiçbir şeyi gönderemez, değiştiremez, silemezsin. Bir işlem istenirse panelden (ya da soru bildirimindeki Onayla düğmesiyle) yapılması gerektiğini söyle.
- Müşteri adı, adres, telefon, e-posta yazma (araçlar zaten vermez).
- Tarih/saatleri araçtaki gibi (Türkiye saati) yaz. Sayıları yuvarlama, araçta ne varsa onu ver.
- Biçim: düz metin, gerekiyorsa kısa madde işaretleri (•). Markdown başlık, tablo, kalın yazı kullanma. En fazla 12 satır.`;

export type ToolDef = { name: string; description: string; parameters: Record<string, unknown>; run: (args: Record<string, unknown>) => Promise<unknown> };
type Part = { text?: string; functionCall?: { name: string; args?: Record<string, unknown> }; functionResponse?: { name: string; response: unknown } };
type Content = { role: "user" | "model"; parts: Part[] };
// Gemini generateContent (model + gövde -> yanıt JSON; durum kodu ile). Testte sahte verilir.
export type Generate = (body: Record<string, unknown>) => Promise<{ status: number; json: any }>;

// Araç çağırma döngüsü: model araç isterse çalıştırılır (sonuç süzülür), en fazla `rounds` tur; son metin döner
export async function runAssistant(question: string, tools: ToolDef[], generate: Generate, rounds = 4): Promise<{ text: string; used: string[] }> {
  const contents: Content[] = [{ role: "user", parts: [{ text: scrub(question).slice(0, 1500) }] }];
  const decl = [{ functionDeclarations: tools.map(({ name, description, parameters }) => ({ name, description, parameters })) }];
  const used: string[] = [];
  for (let i = 0; i <= rounds; i++) {
    const last = i === rounds; // son turda araç yok: eldeki sonuçla cevap
    const { status, json } = await generate({
      systemInstruction: { parts: [{ text: SYSTEM }] }, contents,
      ...(last ? {} : { tools: decl, toolConfig: { functionCallingConfig: { mode: "AUTO" } } }),
      generationConfig: { temperature: 0.1 },
    });
    if (status === 429) throw new Error("kota");
    if (status !== 200) throw new Error(`Gemini ${status}: ${String(json?.error?.message ?? "").slice(0, 150)}`);
    const parts: Part[] = json?.candidates?.[0]?.content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length || last) {
      const text = parts.map((p) => p.text ?? "").join("").trim();
      return { text: scrub(text || "Cevap üretilemedi.").slice(0, 3500), used };
    }
    contents.push({ role: "model", parts });
    const responses: Part[] = [];
    for (const c of calls) {
      const name = c.functionCall!.name, tool = tools.find((t) => t.name === name);
      used.push(name);
      let response: unknown;
      try { response = tool ? scrubDeep(await tool.run(c.functionCall!.args ?? {})) : { hata: `bilinmeyen araç ${name}` }; }
      catch (e: any) { response = { hata: `araç çalışmadı: ${String(e?.message ?? e).slice(0, 150)}` }; }
      responses.push({ functionResponse: { name, response: { sonuc: response } } });
    }
    contents.push({ role: "user", parts: responses });
  }
  return { text: "Cevap üretilemedi.", used };
}
