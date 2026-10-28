// Claude'un yardımcısı olarak Gemini (yerel, K'nın bilgisayarında): metin özetleme, sınıflandırma, Türkçe metin taslağı, ikinci görüş.
// Anahtar depoda ve sohbette DEĞİL: GEMINI_API_KEY ortam değişkeni ya da %USERPROFILE%\.config\trentakip\gemini.key (yalnızca anahtar).
// Kullanım: node ops/ai/gemini.mjs [--pro] [--json] [--system "..."] < istem.txt     (istem stdin'den ya da --file yol)
// Güvenlik: ücretsiz katmanda Google istemleri ürün geliştirmede kullanabilir. Müşteri verisi (telefon, e-posta, TC no, IBAN)
// ya da anahtar/şifre gibi görünen metin içeren istem GÖNDERİLMEZ (hata verir). Yanıt yalnızca ekrana yazılır.
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const keyFile = join(homedir(), ".config", "trentakip", "gemini.key");
const key = (process.env.GEMINI_API_KEY || (existsSync(keyFile) ? readFileSync(keyFile, "utf8") : "")).trim();
if (!key) { console.error(`Gemini anahtarı yok: ${keyFile} dosyasına yalnızca anahtarı yaz (ya da GEMINI_API_KEY)`); process.exit(2); }

const prompt = (opt("--file") ? readFileSync(opt("--file"), "utf8") : readFileSync(0, "utf8")).trim();
if (!prompt) { console.error("İstem boş"); process.exit(2); }
// Gönderim öncesi süzgeç: kişisel veri ve sır gibi görünenler
const BLOCK = [
  [/\b(sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/, "anahtar / belirteç"],
  [/service_role|SUPABASE_SERVICE_ROLE_KEY|BEGIN [A-Z ]*PRIVATE KEY|password\s*[:=]|parola\s*[:=]|şifre\s*[:=]/i, "sır / parola"],
  [/(\+?90|0)?\s?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/, "telefon numarası"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, "e-posta"],
  [/\b[1-9]\d{10}\b/, "TC kimlik no olabilecek 11 hane"],
  [/\bTR\d{2}[\s]?(\d{4}[\s]?){5}\d{2}\b/i, "IBAN"],
];
for (const [re, what] of BLOCK) if (re.test(prompt)) { console.error(`Gönderilmedi: istemde ${what} var (ücretsiz Gemini'ye kişisel veri / sır gitmez). Çıkarıp yeniden dene.`); process.exit(3); }

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
async function models() {
  const r = await fetch(`${BASE}?pageSize=200`, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`model listesi ${r.status}: ${j?.error?.message ?? ""}`.slice(0, 200));
  const ver = (n) => Number(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  const names = (j.models ?? []).filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent")).map((m) => m.name.replace(/^models\//, ""));
  const pick = (re) => names.filter((n) => re.test(n)).sort((a, b) => ver(b) - ver(a) || a.length - b.length);
  return flag("--pro") ? [...pick(/^gemini-\d+(\.\d+)?-pro(-\d{3})?$/), ...pick(/^gemini-\d+(\.\d+)?-flash(-\d{3})?$/)] : [...pick(/^gemini-\d+(\.\d+)?-flash(-\d{3})?$/), ...pick(/^gemini-\d+(\.\d+)?-flash-lite(-\d{3})?$/)];
}

const list = process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : await models();
if (!list.length) { console.error("Uygun Gemini modeli bulunamadı"); process.exit(1); }
const body = {
  ...(opt("--system") ? { systemInstruction: { parts: [{ text: opt("--system") }] } } : {}),
  contents: [{ role: "user", parts: [{ text: prompt }] }],
  generationConfig: { temperature: Number(opt("--temp") ?? 0.3), ...(flag("--json") ? { responseMimeType: "application/json" } : {}) },
};
for (const model of list.slice(0, 4)) {
  const r = await fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 429 || r.status === 404 || r.status >= 500) { console.error(`(${model}: ${r.status}, sıradaki model)`); continue; }
  if (!r.ok) { console.error(`Gemini ${r.status} (${model}): ${String(j?.error?.message ?? "").slice(0, 300)}`); process.exit(1); }
  const text = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  console.error(`(model: ${model})`);
  process.stdout.write(text + "\n");
  process.exit(0);
}
console.error("Gemini: tüm modeller kota / hata verdi");
process.exit(1);
