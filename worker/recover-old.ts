// Eski veritabanından (xovqsjiddoituaayyhae, 25.10'da disk dolup çöktü; destek talebi SU-524672) kaybolan elle girilmiş verileri kurtarır.
// node --experimental-strip-types worker/recover-old.ts [check|apply]
//   check (varsayılan): eski veritabanına bağlanabiliyor mu, hangi tabloda kaç satır kurtarılabilir (yeni veritabanına yazmaz)
//   apply: yalnızca yeni veritabanında OLMAYAN satırlar eklenir (var olan hiçbir satır ezilmez, hiçbir şey silinmez)
// Fiyatı değiştirebilecek alanlar canlıya geçmez, panelde gözden geçirilip elle açılır:
//   kâr kuralları kapalı (enabled=false) eklenir · kategori komisyon oranı boş, eski oran ekranda listelenir
//   ürün istisnalarında "gizle" olduğu gibi (satışı durdurur, güvenli yön), elle fiyat boş + nota "eski elle fiyat: X" yazılır
// Kurtarılanlar: category_map, product_overrides, pricing_rules, brand_blocklist, banned_words. Sipariş geçmişi yeni veritabanına
// pazaryerinden yeniden çekildi (14 gün); müşteri verisi bu araçla taşınmaz.
// Ortam: OLD_SUPABASE_URL, OLD_SUPABASE_SERVICE_ROLE_KEY (eski secret adları), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (yeni)
import { createClient } from "@supabase/supabase-js";
import { env, arg, chunk, readAll } from "./core/util.ts";

const mode = arg(process.argv[2], "check", ["check", "apply"], "mod");
const oldDb = createClient(env("OLD_SUPABASE_URL"), env("OLD_SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const newDb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
if (env("OLD_SUPABASE_URL") === env("SUPABASE_URL")) throw new Error("Eski ve yeni veritabanı adresi aynı: secret'ları kontrol edin");

type Spec = { table: string; key: string[]; order: string; prepare: (r: any) => any; note?: (r: any) => string | null };
const SPECS: Spec[] = [
  { table: "category_map", key: ["marketplace", "xml_category"], order: "xml_category",
    prepare: (r) => ({ marketplace: r.marketplace ?? "trendyol", xml_category: r.xml_category, category_id: r.category_id, category_name: r.category_name ?? null, vat_rate: r.vat_rate ?? null, attributes: r.attributes ?? [], commission_rate: null }),
    note: (r) => (r.commission_rate != null ? `${r.marketplace ?? "trendyol"} · ${r.xml_category}: eski komisyon ${r.commission_rate}` : null) },
  { table: "product_overrides", key: ["marketplace", "barcode"], order: "barcode",
    prepare: (r) => ({ marketplace: r.marketplace ?? "trendyol", barcode: r.barcode, hidden: !!r.hidden, price_override: null,
      note: [r.note, r.price_override != null ? `eski elle fiyat: ${r.price_override} (kurtarma 28.10, onaylanmadı)` : null].filter(Boolean).join(" · ") || null }),
    note: (r) => (r.price_override != null ? `${r.marketplace ?? "trendyol"} · ${r.barcode}: eski elle fiyat ${r.price_override}` : null) },
  { table: "pricing_rules", key: ["id"], order: "id",
    prepare: (r) => { const { created_at, updated_at, ...x } = r; return { ...x, enabled: false, name: `${r.name ?? "kural"} (kurtarıldı, kapalı)` }; },
    note: (r) => `${r.marketplace} · ${r.name}: ${r.enabled ? "eskiden AÇIK" : "eskiden kapalı"} -> kapalı eklenir` },
  { table: "brand_blocklist", key: ["word"], order: "word", prepare: (r) => ({ word: r.word, source: r.source ?? "kurtarma" }) },
  { table: "banned_words", key: ["marketplace", "word"], order: "word", prepare: (r) => ({ marketplace: r.marketplace, word: r.word, source: r.source ?? "kurtarma" }) },
];

const k = (r: any, key: string[]) => key.map((c) => String(r[c] ?? "")).join("|");

// Eski veritabanı açık mı (Postgres "not accepting connections" iken REST de yanıt vermez)
{
  const { error } = await oldDb.from("settings").select("id").limit(1);
  if (error) {
    console.log(`::error::Eski veritabanına bağlanılamadı: ${error.message.slice(0, 200)}. Supabase desteği projeyi açınca yeniden çalıştırın.`);
    process.exit(1);
  }
}

const report: string[] = [`# Eski veritabanından kurtarma (${mode})`, "", "| Tablo | Eski | Yeni | Eklenecek |", "|---|---:|---:|---:|"];
const notes: string[] = [];
let failed = false;
for (const s of SPECS) {
  const o = await readAll((a, b) => oldDb.from(s.table).select("*").order(s.order).range(a, b));
  if (o.error) { report.push(`| ${s.table} | okunamadı: ${o.error.message.slice(0, 80)} | | |`); continue; }
  const n = await readAll((a, b) => newDb.from(s.table).select(s.key.join(",")).order(s.order).range(a, b));
  if (n.error) { report.push(`| ${s.table} | ${o.data.length} | okunamadı: ${n.error.message.slice(0, 80)} | |`); failed = true; continue; }
  const have = new Set(n.data.map((r: any) => k(r, s.key)));
  const add = o.data.filter((r: any) => !have.has(k(r, s.key)));
  report.push(`| ${s.table} | ${o.data.length} | ${n.data.length} | ${add.length} |`);
  for (const r of add) { const t = s.note?.(r); if (t) notes.push(t); }
  if (mode === "apply" && add.length) {
    for (const part of chunk(add.map(s.prepare), 500)) {
      // ignoreDuplicates: bu arada panelden eklenmiş satır varsa ona dokunulmaz
      const { error } = await newDb.from(s.table).upsert(part, { onConflict: s.key.join(","), ignoreDuplicates: true });
      if (error) { report.push(`| ${s.table} | yazılamadı: ${error.message.slice(0, 120)} | | |`); failed = true; break; }
    }
  }
}
if (notes.length) report.push("", "## Gözden geçirilecek (canlıya geçmedi)", "", ...notes.slice(0, 300).map((x) => `- ${x}`), notes.length > 300 ? `- ... ${notes.length - 300} satır daha` : "");
report.push("", mode === "apply" ? "Eklendi. Kâr kuralları kapalı; panelde inceleyip açın." : "Yalnızca rapor. Eklemek için mod: apply.");
const text = report.join("\n");
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) { const { appendFileSync } = await import("node:fs"); appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + "\n"); }
if (failed) process.exit(1);
