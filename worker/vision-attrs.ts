// Görselden pazaryeri özelliği (K 27.11: "fotoğrafları tek tek indirip incelesin, zorunlu yerlere özellikleri düzgün ve doğru koysun").
// K'NIN BİLGİSAYARINDA çalışır (ağır iş, yerel OmniRoute: http://127.0.0.1:20128/v1; anahtar %USERPROFILE%\.omniroute\claude.key).
// Kural (hafıza content-fix / no-generated-content): her ürün için fotoğraflar (en çok 4) + başlık + açıklama İKİ FARKLI görsel modele
// ayrı ayrı sorulur; değer yalnızca iki model AYNI izinli değeri seçerse kabul edilir, aksi halde boş bırakılır (çekimser). Ölçü/ağırlık/hacim
// sorulmaz. Zorunlu özellik kabul edilemezse ürün "gönderilemez" işaretlenir (pazaryeri adaptörü tahminle doldurmaz).
// Müşteri verisi gönderilmez: yalnızca ürün başlığı, açıklaması, özellik adları/izinli değerler ve ürün görselleri.
//
//   node --experimental-strip-types worker/vision-attrs.ts <girdi.json> <çıktı.json> [--mp pazarama]
// Girdi: { categories: { <id>: { name, attrs: [{ id, name, required, values: [{ id, value }] }] } }, products: [{ id, sku, title, description, images[], categoryId }] }
// Çıktı: { results: [{ id, sku, accepted, abstained, missingRequired, noBrand, brandCheck }], sql }
// Marka kontrolü (K 27.11): fotoğrafta / ambalajda / başlık-açıklamada marka var mı; iki model de "HAYIR" derse "Markasız doğrulandı"=evet.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const [inFile, outFile] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const mp = (() => { const i = process.argv.indexOf("--mp"); return i > 0 ? process.argv[i + 1] : "pazarama"; })();
if (!inFile || !outFile) { console.error("kullanım: vision-attrs.ts <girdi.json> <çıktı.json> [--mp pazarama]"); process.exit(2); }
const BASE = (process.env.OMNIROUTE_BASE_URL || "http://127.0.0.1:20128/v1").replace(/\/+$/, "");
const keyFile = join(homedir(), ".omniroute", "claude.key");
const KEY = (process.env.OMNIROUTE_API_KEY || (existsSync(keyFile) ? readFileSync(keyFile, "utf8") : "")).trim();
if (!KEY) { console.error(`OmniRoute anahtarı yok: ${keyFile}`); process.exit(2); }
const MODELS = (process.env.VISION_MODELS || "gemini/gemini-2.5-flash,ddgw/mistral-small-2603").split(",").map((s) => s.trim());
// Ölçü / ağırlık / hacim / güç gibi sayısal özellikler görselden okunmaz (yanlış ölçü = iade)
const SKIP = /(ağırlık|uzunluk|genişlik|yükseklik|derinlik|hacim|kapasite|boyut|ölçü|güç|watt|cm|mm|litre|parça sayısı|bölme sayısı|kat sayısı)/i;
const MAX_VALUES = 200;

const norm = (s: string) => String(s ?? "").toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();
async function imageData(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) return null;
    const ct = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
    if (!/^image\/(jpeg|png|webp|gif)$/.test(ct)) return null;
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length > 4_500_000) return null;
    return `data:${ct};base64,${b.toString("base64")}`;
  } catch { return null; }
}

function prompt(title: string, desc: string, attrs: { name: string; values: string[] }[]) {
  return `Bir e-ticaret ürününün fotoğraflarına, başlığına ve açıklamasına bakarak aşağıdaki özellikleri belirle.
Ürün başlığı: "${title}"
Açıklama: "${desc.slice(0, 1500)}"
KURALLAR:
- Her özellik için YALNIZCA verilen listeden BİREBİR bir değer seç (yazımı aynen kopyala).
- Değeri fotoğrafta açıkça görüyorsan ya da başlık/açıklama açıkça söylüyorsa seç. Emin değilsen, ürün birden fazla renkteyse ve listede uygun değer yoksa ya da listede tam karşılığı yoksa "BELIRSIZ" yaz.
- Tahmin etme, "en olası" değeri seçme. Yanlış değer, boş bırakmaktan çok daha kötüdür.
- Arka plan, ambalaj ve sunum aksesuarlarının rengi ürünün rengi değildir.
Özellikler ve izinli değerler:
${attrs.map((a) => `- ${a.name}: ${a.values.join(" | ")}`).join("\n")}
AYRICA MARKA KONTROLÜ: Ürünün kendisinde, ambalajında, etiketinde, kartında ya da fotoğraftaki herhangi bir yazıda marka adı, logo veya üretici/firma adı var mı?
Başlıkta ya da açıklamada bir marka/üretici adı geçiyor mu (ör. "X Kitchenware", "Y Home")? Ürün tanımı ("Çelik Rende") marka değildir.
- marka_gorunur: "EVET" (en az birinde marka/logo/firma adı var), "HAYIR" (hiçbir yerde yok, emin), "BELIRSIZ" (yazı okunamıyor / emin değilsin)
- marka_metni: gördüğün marka yazısı (yoksa boş)
Sadece JSON döndür: {"attrs": {"<özellik adı>": "<listeden değer ya da BELIRSIZ>"}, "marka_gorunur": "EVET|HAYIR|BELIRSIZ", "marka_metni": ""}`;
}

async function ask(model: string, text: string, images: string[]): Promise<Record<string, string> | null> {
  const body = { model, temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "user", content: [{ type: "text", text }, ...images.map((u) => ({ type: "image_url", image_url: { url: u } }))] }] };
  for (let t = 1; t <= 3; t++) {
    try {
      const r = await fetch(`${BASE}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) { if (t < 3 && (r.status === 429 || r.status >= 500)) { await new Promise((s) => setTimeout(s, 5000 * t)); continue; } console.error(`  ${model}: HTTP ${r.status} ${String(j?.error?.message ?? "").slice(0, 120)}`); return null; }
      const txt = String(j.choices?.[0]?.message?.content ?? "");
      const m = txt.match(/\{[\s\S]*\}/);
      const o = m ? JSON.parse(m[0]) : null;
      return o?.attrs && typeof o.attrs === "object" ? { ...o.attrs, __marka: String(o.marka_gorunur ?? "BELIRSIZ"), __markaMetni: String(o.marka_metni ?? "") } : null;
    } catch (e: any) { if (t === 3) { console.error(`  ${model}: ${String(e?.message ?? e).slice(0, 120)}`); return null; } await new Promise((s) => setTimeout(s, 4000 * t)); }
  }
  return null;
}

const input = JSON.parse(readFileSync(inFile, "utf8"));
const results: any[] = [];
for (const p of input.products) {
  const cat = input.categories[p.categoryId];
  if (!cat) { results.push({ id: p.id, sku: p.sku, error: "kategori özellikleri yok" }); continue; }
  const want = cat.attrs.filter((a: any) => !SKIP.test(a.name) && a.values.length > 0 && a.values.length <= MAX_VALUES)
    .map((a: any) => ({ name: a.name, required: a.required, values: a.values.map((v: any) => String(v.value)) }));
  const required = cat.attrs.filter((a: any) => a.required).map((a: any) => a.name);
  const imgs = (await Promise.all((p.images ?? []).slice(0, 4).map(imageData))).filter(Boolean) as string[];
  const r: any = { id: p.id, sku: p.sku, title: p.title, category: cat.name, images: imgs.length, accepted: {}, abstained: {}, missingRequired: [] };
  if (!imgs.length) { r.error = "görsel indirilemedi"; r.missingRequired = required; results.push(r); continue; }
  const text = prompt(p.title, p.description ?? "", want);
  const answers = await Promise.all(MODELS.map((m) => ask(m, text, imgs)));
  for (const a of want) {
    const vals = answers.map((ans) => (ans ? String(ans[a.name] ?? "BELIRSIZ") : "HATA"));
    const pick = a.values.find((v: string) => norm(v) === norm(vals[0]));
    const agree = vals.length >= 2 && answers.every(Boolean) && vals.every((v) => norm(v) === norm(vals[0])) && pick && norm(vals[0]) !== "belirsiz";
    if (agree) r.accepted[a.name] = pick; else if (vals.some((v) => norm(v) !== "belirsiz")) r.abstained[a.name] = vals;
  }
  // Markasız doğrulaması: iki model de "HAYIR" derse (biri bile EVET/BELIRSIZ derse marka var sayılır, ürün markasız olarak gönderilmez)
  const mk = answers.map((ans) => (ans ? norm(ans.__marka) : "hata"));
  r.brandCheck = { answers: mk, texts: answers.map((ans) => ans?.__markaMetni ?? "").filter(Boolean) };
  r.noBrand = answers.every(Boolean) && mk.every((x) => x === "hayır" || x === "hayir");
  r.missingRequired = required.filter((n: string) => !r.accepted[n] && !(p.known ?? {})[`${n}@${mp}`]);
  console.log(`${p.sku} | ${String(p.title).slice(0, 45)} | ${r.noBrand ? "MARKASIZ" : "marka:" + (r.brandCheck.texts.join("/") || r.brandCheck.answers.join("/"))} | kabul ${JSON.stringify(r.accepted)} | çekimser ${Object.keys(r.abstained).join(",") || "-"}${r.missingRequired.length ? " | ZORUNLU EKSİK: " + r.missingRequired.join(",") : ""}`);
  results.push(r);
}
// Sunucu veritabanına uygulanacak SQL: kabul edilen değerler ürün kaydına "<özellik>@<pazaryeri>" anahtarıyla (adaptör bunları kullanır)
const esc = (s: string) => s.replace(/'/g, "''");
const sql = results.filter((r) => r.accepted && (Object.keys(r.accepted).length || r.brandCheck)).map((r) => {
  const obj: Record<string, string> = Object.fromEntries(Object.entries(r.accepted).map(([k, v]) => [`${k}@${mp}`, String(v)]));
  // Pazaryerinden bağımsız: iki model de fotoğrafta/metinde marka görmedi (Trendyol "Ürünümün Markası Yok" yalnızca bununla)
  obj["Markasız doğrulandı"] = r.noBrand ? "evet" : "hayır";
  return `update products set attributes = coalesce(attributes, '{}'::jsonb) || '${esc(JSON.stringify(obj))}'::jsonb where id = '${r.id}';`;
}).join("\n");
writeFileSync(outFile, JSON.stringify({ models: MODELS, at: new Date().toISOString(), results, sql }, null, 1), "utf8");
const ok = results.filter((r) => !r.error && !r.missingRequired?.length).length;
console.log(`\nToplam ${results.length}: gönderilebilir (zorunlular doğrulandı) ${ok}, zorunlu eksik ${results.length - ok}`);
