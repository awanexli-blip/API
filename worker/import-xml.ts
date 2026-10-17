// BayilikXML -> merkezi ürün veritabanı (products). GitHub Actions: .github/workflows/import.yml
// node --experimental-strip-types worker/import-xml.ts [--dry]
// - SKU = productCode (ASCII'ye sadeleştirilmiş), tek varyant; barkod = XML barcode (geçerliyse ve tekrarsızsa)
// - İçerik aynıysa (source_hash) yalnızca stok güncellenir; fiyat/içerik değişikliği denetim kaydına yazılır
// - XML'den kalkan ürünler silinmez: stokları 0 yapılır (silme açık bir işlemdir)
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { env, chunk, num, san } from "./core/util.ts";
import { loadXml } from "./core/xml.ts";

const SOURCE = "xml:bayilik";
const BRAND = process.env.TRENDYOL_BRAND_NAME || "Eco Lounge"; // XML markası "BayilikXML.com" pazaryerlerinde yok
const SKU_RE = /^[A-Za-z0-9ÇĞİÖŞÜçğıöşü._-]{2,64}$/;
const CODE_RE = /^[A-Za-z0-9ÇĞİÖŞÜçğıöşü._-]{1,40}$/;
const CUR: Record<string, string> = { TL: "TRY", TRY: "TRY", USD: "USD", EUR: "EUR" };
const dry = process.argv.includes("--dry");
const actor = process.env.ACTOR || "xml-import";

const stable = (v: any): string => Array.isArray(v) ? `[${v.map(stable).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}` : JSON.stringify(v);
const hashOf = (p: any) => createHash("sha1").update(stable({ ...p, variants: p.variants.map(({ stock, ...v }: any) => v) })).digest("hex");

export function mapXml(raw: any[]) {
  const items: { row: number; payload: any; hash: string }[] = [];
  const errors: { row: number; sku: string; error: string }[] = [];
  const seenSku = new Set<string>(), seenBarcode = new Set<string>();
  raw.forEach((r, i) => {
    const row = i + 1;
    const sku = san(String(r.productCode ?? "").trim()) || san(String(r.barcode ?? "").trim());
    if (!SKU_RE.test(sku)) return errors.push({ row, sku, error: "ürün kodu yok veya geçersiz" });
    if (seenSku.has(sku.toLowerCase())) return errors.push({ row, sku, error: "aynı ürün kodu XML'de tekrar ediyor" });
    seenSku.add(sku.toLowerCase());
    const title = String(r.name ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (title.length < 2) return errors.push({ row, sku, error: "ürün adı yok" });
    const currency = CUR[String(r.currency ?? "TL").toUpperCase()];
    if (!currency) return errors.push({ row, sku, error: `desteklenmeyen para birimi: ${r.currency}` });
    let barcode: string | null = String(r.barcode ?? "").replace(/\s/g, "");
    if (!CODE_RE.test(barcode) || /^\d+$/.test(barcode) && ![8, 12, 13, 14].includes(barcode.length) || seenBarcode.has(barcode.toLowerCase())) barcode = null;
    if (barcode) seenBarcode.add(barcode.toLowerCase());
    const cost = num(r.price);
    const desi = num(r.desi);
    const images = Array.from({ length: 12 }, (_, k) => String(r[`image${k + 1}`] ?? "").trim())
      .filter(Boolean).map((u) => u.replace(/^http:\/\//i, "https://")).filter((u) => /^https:\/\/\S+$/.test(u));
    const payload = {
      sku, title, description: String(r.detail ?? "").slice(0, 30000), brand: BRAND, category: String(r.category ?? "").slice(0, 200),
      vat_rate: 20, desi: desi > 0 ? desi : null, cost_price: cost > 0 ? cost : null, currency, status: "active",
      attributes: {}, source: SOURCE, source_ref: String(r.productCode ?? "").slice(0, 200), images: [...new Set(images)].slice(0, 20),
      variants: [{ sku, barcode, attributes: {}, stock: Math.max(0, Math.min(1_000_000, Math.floor(num(r.quantity) || 0))), cost_price: null }],
    };
    items.push({ row, payload, hash: hashOf(payload) });
  });
  return { items, errors };
}

async function main() {
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const raw = await loadXml();
  const { items, errors } = mapXml(raw);
  console.log(`XML: ${raw.length} satır, ${items.length} geçerli, ${errors.length} hatalı`);
  if (dry) { console.log(JSON.stringify({ sample: items.slice(0, 2), errors: errors.slice(0, 20) }, null, 1)); return; }

  const { data: job, error: je } = await db.from("import_jobs").insert({ kind: "xml", source: SOURCE, mode: "upsert", created_by: actor, total: raw.length }).select("id").single();
  if (je) throw new Error(je.message);
  const count: Record<string, number> = {};
  const rows: any[] = errors.map((e) => ({ job_id: job.id, row_no: e.row, sku: e.sku, status: "error", errors: { _: e.error } }));
  try {
    for (const [n, part] of chunk(items, 200).entries()) {
      const { data, error } = await db.rpc("product_import_batch", { items: part, actor, opts: { mode: "upsert", keep_missing_variants: false, source: SOURCE } });
      if (error) throw new Error(`Toplu kayıt hatası: ${error.message}`);
      for (const r of data as any[]) {
        count[r.action] = (count[r.action] ?? 0) + 1;
        if (r.action === "error" || r.action === "skipped") rows.push({ job_id: job.id, row_no: r.row, sku: r.sku, status: r.action, errors: { _: r.error } });
      }
      if (n % 20 === 0) console.log(`${(n + 1) * 200} / ${items.length}`, count);
    }

    // XML'den kalkan ürünler: stok 0 (rezerve edilmiş stok korunur)
    const inXml = new Set(items.map((i) => i.payload.sku));
    const gone: string[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("products").select("id, sku").eq("source", SOURCE).neq("status", "archived").range(from, from + 999);
      if (error) throw new Error(error.message);
      for (const p of data ?? []) if (!inXml.has(p.sku)) gone.push(p.id);
      if (!data || data.length < 1000) break;
    }
    let zeroed = 0;
    for (const ids of chunk(gone, 200)) {
      const { data, error } = await db.from("product_variants").update({ stock: 0 }).in("product_id", ids).gt("stock", 0).eq("reserved", 0).select("id");
      if (error) throw new Error(error.message);
      zeroed += data?.length ?? 0;
    }

    for (const part of chunk(rows, 1000)) await db.from("import_rows").upsert(part);
    const failed = (count.error ?? 0) + errors.length;
    await db.from("import_jobs").update({
      status: failed ? "partial" : "ok", finished_at: new Date().toISOString(),
      created: count.created ?? 0, updated: count.updated ?? 0, stock_only: count.stock ?? 0, unchanged: count.unchanged ?? 0,
      skipped: count.skipped ?? 0, failed, message: `XML'den kalkan ${gone.length} ürün (${zeroed} varyantın stoğu 0 yapıldı)`,
    }).eq("id", job.id);
    console.log("Bitti", count, { xmlErrors: errors.length, gone: gone.length, zeroed });
  } catch (e: any) {
    for (const part of chunk(rows, 1000)) await db.from("import_rows").upsert(part);
    await db.from("import_jobs").update({ status: "error", finished_at: new Date().toISOString(), message: String(e.message).slice(0, 500), ...countCols(count) }).eq("id", job.id);
    throw e;
  }
}
const countCols = (c: Record<string, number>) => ({ created: c.created ?? 0, updated: c.updated ?? 0, stock_only: c.stock ?? 0, unchanged: c.unchanged ?? 0, skipped: c.skipped ?? 0, failed: c.error ?? 0 });

if (process.argv[1]?.replace(/\\/g, "/").endsWith("worker/import-xml.ts")) await main();
