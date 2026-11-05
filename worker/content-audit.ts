// İçerik denetimi (K, 05.11: "kablosuz ürüne kablolu yazmış; açıklaması yanlış olan, %80 altı doğruluktakileri araştır").
// Satıştaki ilanların ürünleri için yapay zekâ başlık + kategori + özellikler + açıklamayı karşılaştırır: kesin çelişkiler ve doğruluk puanı
// (0-100). Sonuç sunucu veritabanında content_audit (migration 078). İçerik YAZMAZ, ilanı DEĞİŞTİRMEZ: puanı 80 altı olanlar inceleme listesi.
// Önce metin (ucuz). Kota biterse durur (sonraki çalışmada kaldığı yerden). Ürün 30 günde bir yeniden denetlenir.
//   node --experimental-strip-types worker/content-audit.ts [adet=100]     denetle
//   node --experimental-strip-types worker/content-audit.ts report          80 altı özet
import { createClient } from "@supabase/supabase-js";
import { env, readAll } from "./core/util.ts";
import { geminiJson, geminiEnabled, GeminiQuotaError } from "./core/gemini.ts";

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const arg = process.argv[2] ?? "100";

const SYSTEM = `Sen bir e-ticaret içerik denetçisisin. Sana bir ürünün başlığı, kategorisi, özellikleri ve açıklaması verilecek.
Görevin: açıklamada başlıkla, kategoriyle ya da özelliklerle ÇELİŞEN veya ürün için açıkça YANLIŞ olan bilgileri bulmak.
Örnekler: başlık "kablosuz" iken açıklama ürünü "kablolu" anlatıyor; başlık "2'li set" iken açıklama "1 adet"; renk, beden, ölçü, malzeme, cinsiyet,
tuş düzeni, uyumluluk farklı; oyuncak bir ürün gerçek ürün (müzik aleti, elektrikli alet) gibi anlatılıyor; açıklama başka bir ürünü anlatıyor.
Çelişki DEĞİL: genel pazarlama cümleleri, eksik bilgi, bir setin parçalarının ayrı ayrı anlatılması (ör. "Bluetooth kulaklık + USB kablolu klavye seti"),
bir ürünün hem kablolu hem kablosuz kullanılabilmesi, kulaklık telleri. Emin olmadığın şeyi çelişki sayma.
score: açıklamanın bu ürünü doğru anlatma derecesi (100 = tamamen doğru, 80 altı = müşteriyi yanıltabilir). issues: her çelişki kısa bir Türkçe cümle.
toy: ürün aslında oyuncak/çocuk oyun ürünü mü (başlık veya açıklama öyle gösteriyorsa true).`;
const SCHEMA = { type: "OBJECT", properties: { score: { type: "INTEGER" }, issues: { type: "ARRAY", items: { type: "STRING" } }, toy: { type: "BOOLEAN" } }, required: ["score", "issues", "toy"] };
const clean = (s: unknown) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

async function report() {
  const r = await readAll<any>((a, b) => db.from("content_audit").select("product_id, score, issues, toy, checked_at, products(sku, title, source)").lt("score", 80).order("score").range(a, b));
  if (r.error) throw new Error(r.error.message);
  const { count } = await db.from("content_audit").select("product_id", { count: "exact", head: true });
  console.log(`denetlenen: ${count ?? 0} · 80 altı: ${r.data.length}`);
  for (const x of r.data.slice(0, 50)) console.log(`${x.score}\t${x.products?.source}\t${x.products?.sku}\t${String(x.products?.title ?? "").slice(0, 60)}\t${(x.issues ?? []).join(" | ").slice(0, 200)}`);
}

async function audit(max: number) {
  if (!geminiEnabled()) { console.log(JSON.stringify({ skipped: "GEMINI_API_KEY yok" })); return; }
  // Aday: satıştaki ilanı olan aktif ürünler (ürüne bağlı ilan ya da varyant barkodu = ilan anahtarı: toptancim kopyası), 30 günde denetlenmemiş
  const { data, error } = await db.rpc("content_audit_candidates", { p_limit: max });
  if (error) throw new Error(`aday listesi: ${error.message}`);
  const out = { candidates: (data ?? []).length, audited: 0, below80: 0, toy: 0, errors: 0, quota: false as boolean | string };
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  for (const p of (data ?? []) as any[]) {
    const attrs = Object.entries(p.attributes ?? {}).filter(([k, v]) => v != null && v !== "" && !/kategori|^_/i.test(k)).slice(0, 25).map(([k, v]) => `${k}: ${String(v).slice(0, 80)}`).join("\n");
    const user = `Başlık: ${clean(p.title).slice(0, 300)}\nKategori: ${clean(p.category).slice(0, 200)}${p.mp_category ? ` / pazaryeri: ${p.mp_category}` : ""}\n${attrs ? `Özellikler:\n${attrs}\n` : ""}Açıklama: ${clean(p.description).slice(0, 4000) || "(yok)"}`;
    try {
      const r = await geminiJson<{ score: number; issues: string[]; toy: boolean }>(SYSTEM, user, SCHEMA);
      if (!r) { out.errors++; continue; }
      const score = Math.max(0, Math.min(100, Math.round(Number(r.score))));
      const { error: ue } = await db.from("content_audit").upsert({ product_id: p.id, checked_at: new Date().toISOString(), score, issues: (r.issues ?? []).slice(0, 10), toy: !!r.toy, model, status: "new" }, { onConflict: "product_id" });
      if (ue) { out.errors++; continue; }
      out.audited++; if (score < 80) out.below80++; if (r.toy) out.toy++;
    } catch (e: any) {
      if (e instanceof GeminiQuotaError) { out.quota = String(e.message).slice(0, 150); break; }
      out.errors++; if (out.errors <= 2) console.error("denetim:", String(e?.message ?? e).slice(0, 200));
    }
  }
  console.log(JSON.stringify(out));
}

if (arg === "report") await report(); else await audit(Math.max(1, Math.min(2000, Number(arg) || 100)));
