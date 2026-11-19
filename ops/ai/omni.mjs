// Claude'un yönettiği yapay zekâ işçileri (K 19.11): yerel OmniRoute ağ geçidi (K'nın bilgisayarı, http://127.0.0.1:20128/v1).
// OmniRoute bağlı sağlayıcılar arasında yönlendirir ve yedeğe geçer ("auto"). Anahtar depoda ve sohbette DEĞİL:
// OMNIROUTE_API_KEY ya da %USERPROFILE%\.omniroute\claude.key. Sunucu kapalıysa: `omniroute serve --daemon --no-open --no-tray`.
// Kullanım: node ops/ai/omni.mjs [--model auto|gemini/gemini-2.5-flash|...] [--json] [--system "..."] [--temp 0.2] < istem.txt   (ya da --file yol)
//           node ops/ai/omni.mjs --models [süzgeç]    bağlı modeller
// Güvenlik: müşteri verisi (telefon, e-posta, TC no, IBAN) ve sır gibi görünen istem GÖNDERİLMEZ. Sonucu her zaman Claude doğrular;
// kod, canlıya yazan karar ve müşteri cevabı bu işçilere verilmez (bkz. hafıza ai-workers).
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const BASE = (process.env.OMNIROUTE_BASE_URL || "http://127.0.0.1:20128/v1").replace(/\/+$/, "");
const keyFile = join(homedir(), ".omniroute", "claude.key");
const key = (process.env.OMNIROUTE_API_KEY || (existsSync(keyFile) ? readFileSync(keyFile, "utf8") : "")).trim();
if (!key) { console.error(`OmniRoute anahtarı yok: ${keyFile}`); process.exit(2); }
const H = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

if (flag("--models")) {
  const r = await fetch(`${BASE}/models`, { headers: H, signal: AbortSignal.timeout(30000) }).catch((e) => ({ ok: false, status: String(e?.message ?? e) }));
  if (!r.ok) { console.error(`OmniRoute model listesi alınamadı (${r.status}): sunucu çalışıyor mu?`); process.exit(1); }
  const f = opt("--models") && !opt("--models").startsWith("--") ? opt("--models") : "";
  for (const m of (await r.json()).data ?? []) if (!f || m.id.includes(f)) console.log(m.id);
  process.exit(0);
}

const prompt = (opt("--file") ? readFileSync(opt("--file"), "utf8") : readFileSync(0, "utf8")).trim();
if (!prompt) { console.error("İstem boş"); process.exit(2); }
const BLOCK = [
  [/\b(sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/, "anahtar / belirteç"],
  [/service_role|SUPABASE_SERVICE_ROLE_KEY|BEGIN [A-Z ]*PRIVATE KEY|password\s*[:=]|parola\s*[:=]|şifre\s*[:=]/i, "sır / parola"],
  [/(\+?90|0)?\s?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/, "telefon numarası"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, "e-posta"],
  [/\b[1-9]\d{10}\b/, "TC kimlik no olabilecek 11 hane"],
  [/\bTR\d{2}[\s]?(\d{4}[\s]?){5}\d{2}\b/i, "IBAN"],
];
for (const [re, what] of BLOCK) if (re.test(prompt)) { console.error(`Gönderilmedi: istemde ${what} var. Çıkarıp yeniden dene.`); process.exit(3); }

// Model zinciri: istenen (varsayılan "auto") takılır / hata verirse sırayla bağlı Gemini modelleri (19.11: "auto" bazen anahtarsız sağlayıcıda takılıyor)
const want = opt("--model") || process.env.OMNIROUTE_MODEL || "auto";
const chain = [...new Set([want, "gemini/gemini-2.5-flash", "gemini/gemini-2.5-flash-lite"])];
let j = null, used = "";
for (const model of chain) {
  const body = {
    model,
    messages: [...(opt("--system") ? [{ role: "system", content: opt("--system") }] : []), { role: "user", content: prompt }],
    temperature: Number(opt("--temp") ?? 0.3),
    ...(flag("--json") ? { response_format: { type: "json_object" } } : {}),
  };
  const r = await fetch(`${BASE}/chat/completions`, { method: "POST", headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(model === "auto" ? 45000 : 120000) }).catch((e) => ({ ok: false, status: String(e?.name ?? e) }));
  const jj = r.ok ? await r.json().catch(() => null) : null;
  if (jj?.choices?.[0]?.message?.content != null) { j = jj; used = jj.model ?? model; break; }
  console.error(`(${model}: ${r.status ?? "yanıt yok"}, sıradaki model)`);
}
if (!j) { console.error("OmniRoute: hiçbir model yanıt vermedi (sunucu çalışıyor mu? `omniroute serve --daemon --no-open --no-tray`)"); process.exit(1); }
let text = String(j.choices[0].message.content);
if (flag("--json")) text = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim(); // bazı modeller kod bloğuna sarar
console.error(`(model: ${used})`);
process.stdout.write(text + "\n");
