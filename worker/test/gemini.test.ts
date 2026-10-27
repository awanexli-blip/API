// Gemini model seçimi: sabit model adları kapatılınca (404) hesabın model listesinden kararlı Flash modeli bulunur
// node --experimental-strip-types worker/test/gemini.test.ts
import { pickFlashModels, geminiJson } from "../core/gemini.ts";
let fails = 0;
const check = (n: string, c: boolean, i: unknown = "") => { console.log(`${c ? "OK  " : "HATA"} ${n}${c ? "" : "  " + JSON.stringify(i)}`); if (!c) fails++; };
const gen = ["generateContent"];
const list = [
  { name: "models/gemini-2.0-flash", supportedGenerationMethods: gen },
  { name: "models/gemini-3.0-flash", supportedGenerationMethods: gen },
  { name: "models/gemini-3.0-flash-lite", supportedGenerationMethods: gen },
  { name: "models/gemini-3.0-flash-preview-09-2026", supportedGenerationMethods: gen },
  { name: "models/gemini-flash-latest", supportedGenerationMethods: gen },
  { name: "models/gemini-3.0-pro", supportedGenerationMethods: gen },
  { name: "models/gemini-3.0-flash-image", supportedGenerationMethods: gen },
  { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
];
const picked = pickFlashModels(list);
check("seçim: yeni sürüm önce, Lite sonra", picked[0] === "gemini-3.0-flash" && picked[1] === "gemini-3.0-flash-lite", picked);
check("seçim: önizleme / -latest / pro / görsel alınmaz", !picked.some((m) => /preview|latest|pro|image/.test(m)), picked);

process.env.GEMINI_API_KEY = "test"; process.env.GEMINI_GAP_MS = "0";
const calls: string[] = [];
globalThis.fetch = (async (u: any) => {
  const s = String(u); calls.push(s);
  if (s.includes("?pageSize")) return new Response(JSON.stringify({ models: list }), { status: 200 });
  if (s.includes("/gemini-3.0-flash:")) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":1}' }] } }] }), { status: 200 });
  return new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404 });
}) as any;
const r = await geminiJson<{ ok: number }>("s", "u", {});
check("2.5 modelleri 404: listeden bulunan modelle yanıt", r?.ok === 1, calls);
const before = calls.length;
await geminiJson("s", "u", {});
check("sonraki istek: kapalı modeller ve liste tekrar sorulmaz", calls.length - before === 1 && calls[calls.length - 1].includes("/gemini-3.0-flash:"), calls.slice(before));

if (fails) { console.log(`\n${fails} Gemini testi başarısız`); process.exit(1); }
console.log("\nGemini testleri geçti");
