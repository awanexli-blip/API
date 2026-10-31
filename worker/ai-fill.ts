// Yapay zekâ tamamlama (K, 01.11): eksik zorunlu özellikler (fotoğraf + isteğe bağlı Google araması, güven >= 0,8) ve doğrulanmış açıklama.
// node --experimental-strip-types worker/ai-fill.ts [pazaryeri] [--job=<gönderim işi anahtarı>] [--attrs=40] [--desc=40]
//   özellik: gönderimi "zorunlu özellik doldurulamadı" ile düşen ilanlar; dolan ürün yeniden gönderim kuyruğuna girer (ai-attrs.ts)
//   açıklama: --job verilirse o gönderim işinin ürünleri (DESC_AUTO_APPROVE=1 ise doğrulanan taslak otomatik onaylı)
import { createClient } from "@supabase/supabase-js";
import { env } from "./core/util.ts";
import { aiFillAttributes } from "./core/ai-attrs.ts";
import { draftDescriptions } from "./core/descriptions.ts";

const mp = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "trendyol";
const opt = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const attrs = await aiFillAttributes(db, mp, Number(opt("attrs") ?? 40));
console.log("özellik:", JSON.stringify(attrs));
const job = opt("job");
if (job) {
  const { data } = await db.from("jobs").select("payload").eq("idempotency_key", job).maybeSingle();
  const ids: string[] = data?.payload?.product_ids ?? [];
  const desc = ids.length ? await draftDescriptions(db, { productIds: ids, max: Number(opt("desc") ?? 200) }) : { skipped: "iş bulunamadı" };
  console.log("açıklama:", JSON.stringify(desc));
}
