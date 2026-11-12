// Tüm ürünleri gönder (K, 04.11: "Hepsiburada için puanlama yapma, hepsini gönder"): sunucu tedarikçilerinin (runner=vps) aktif ürünlerinden
// pazaryerinde HİÇ ilanı olmayanlar gönderim kuyruğuna alınır. Reddedilen (error) ürün yeniden alınmaz (düzeltilince ai-attrs kuyruğa alır);
// kaldırılmış (gone) ve deneme (DENEME) işaretli olan alınır. Gıda / iç giyim / görselsiz / zararına ürünü gönderim adımı (db-products.ts) eler.
// K 12.11: yalnızca STOKLU ürünler (en az bir varyantı stok - rezerv >= 1); stoksuz ürün ilan olarak açılmaz, stok gelince sonraki çalıştırma alır.
// node --experimental-strip-types worker/send-all.ts <pazaryeri> [--apply]   (--apply yoksa yalnızca sayar)
import { createClient } from "@supabase/supabase-js";
import { env, chunk, readAll } from "./core/util.ts";

const mp = process.argv[2] ?? "";
const apply = process.argv.includes("--apply");
if (!["hepsiburada", "trendyol"].includes(mp)) { console.log("kullanım: send-all.ts <hepsiburada|trendyol> [--apply]"); process.exit(1); }
if (mp === "trendyol") { console.log("Trendyol'da ürün sınırı var: yıldızla gönder (stars.ts send <yıldız> trendyol)"); process.exit(1); }
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const { data: sups, error: se } = await db.from("suppliers").select("code").eq("runner", "vps").eq("active", true);
if (se) throw new Error(se.message);
const sources = (sups ?? []).map((s: any) => `xml:${s.code}`);
const prods = await readAll<any>((a, b) => db.from("products").select("id").in("source", sources).eq("status", "active").order("id").range(a, b));
if (prods.error) throw new Error(prods.error.message);
// Stoklu ürünler (varyant stok - rezerv >= 1)
const vs = await readAll<any>((a, b) => db.from("product_variants").select("id, product_id, stock, reserved").gt("stock", 0).order("id").range(a, b));
if (vs.error) throw new Error(vs.error.message);
const stocked = new Set<string>(vs.data.filter((v: any) => Number(v.stock ?? 0) - Number(v.reserved ?? 0) >= 1).map((v: any) => v.product_id));
const has = new Set<string>();
const ls = await readAll<any>((a, b) => db.from("marketplace_listings").select("product_id, status, last_error").eq("marketplace", mp).not("product_id", "is", null).order("listing_key").range(a, b));
if (ls.error) throw new Error(ls.error.message);
for (const l of ls.data) if (l.status !== "gone" && !(l.status === "error" && String(l.last_error ?? "").startsWith("DENEME"))) has.add(l.product_id);
const { data: q } = await db.from("jobs").select("payload").eq("type", `send_products:${mp}`).in("status", ["queued", "running"]);
for (const j of q ?? []) for (const id of j.payload?.product_ids ?? []) has.add(id);
const missing = prods.data.map((p: any) => p.id).filter((id: string) => !has.has(id));
const ids = missing.filter((id: string) => stocked.has(id));
console.log(`${mp}: ${prods.data.length} aktif ürün (${sources.join(", ")}), ${prods.data.length - missing.length} ilanı var / reddedildi / kuyrukta, ${missing.length - ids.length} stoksuz (gönderilmez), ${ids.length} kuyruğa ${apply ? "alınıyor" : "alınacak (deneme; --apply ile)"}`);
if (apply && ids.length) {
  const day = new Date().toISOString().slice(0, 16);
  let n = 0;
  for (const [i, part] of chunk(ids, 200).entries()) {
    const { error } = await db.from("jobs").insert({ type: `send_products:${mp}`, marketplace: mp, payload: { product_ids: part }, idempotency_key: `all:${mp}:${day}:${i}`, created_by: process.env.ACTOR || "hepsini-gonder" });
    if (error) console.error(error.message); else n += part.length;
  }
  console.log(`kuyruğa alındı: ${n}`);
}
