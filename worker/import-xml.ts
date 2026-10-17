// Tedarikçi XML'leri -> merkezi ürün veritabanı (products). GitHub Actions: .github/workflows/import.yml
// node --experimental-strip-types worker/import-xml.ts <tedarikçi kodu | all | nightly> [--dry]
// - Tedarikçi ayarları ve alan eşlemesi "suppliers" tablosunda (panel: Ürünler -> Tedarikçiler)
// - Kaynak "xml:<kod>"; aynı model kodlu ürünler tek ürünün varyantları olur
// - İçerik aynıysa (source_hash) yalnızca stok güncellenir; fiyat/içerik değişikliği denetim kaydına yazılır
// - XML'den kalkan ürünler silinmez: stokları 0 yapılır (silme açık bir işlemdir)
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { env, chunk } from "./core/util.ts";
import { findItems, itemsToGroups, supplierPayload, type Supplier } from "../lib/supplier-xml.ts";

const stable = (v: any): string => Array.isArray(v) ? `[${v.map(stable).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}` : JSON.stringify(v);
const hashOf = (p: any) => createHash("sha1").update(stable({ ...p, variants: p.variants.map(({ stock, ...v }: any) => v) })).digest("hex");

// Ayrıştırılmış XML -> içe aktarma kalemleri ve satır hataları (saf fonksiyon, test edilir)
export function buildItems(parsed: any, sup: Supplier) {
  const { items: raw, path } = findItems(parsed, sup.item_path);
  const groups = itemsToGroups(raw, sup.mapping);
  const seen = new Set<string>(), seenSku = new Set<string>();
  const items: { row: number; payload: any; hash: string }[] = [];
  const errors: { row: number; sku: string; error: string }[] = [];
  for (const g of groups) {
    const { payload, error } = supplierPayload(g, sup, seen);
    const row = g.rows[0].row;
    if (error) { errors.push({ row, sku: g.model, error }); continue; }
    if (seenSku.has(payload.sku.toLowerCase())) { errors.push({ row, sku: payload.sku, error: "SKU sadeleştirince başka ürünle aynı oldu" }); continue; }
    seenSku.add(payload.sku.toLowerCase());
    items.push({ row, payload, hash: hashOf(payload) });
  }
  return { items, errors, total: raw.length, path };
}

export function parseXml(text: string) {
  return new XMLParser({ ignoreAttributes: true, trimValues: true, parseTagValue: false }).parse(text);
}

async function importSupplier(db: any, sup: any, dry: boolean, actor: string) {
  const source = `xml:${sup.code}`;
  // İş kaydı en başta: XML inmezse de panelde "hata" ve nedeni görünür
  const job = dry ? { id: 0 } : (await db.from("import_jobs").insert({ kind: "xml", source, supplier: sup.code, mode: "upsert", created_by: actor }).select("id").single()).data;
  if (!job) throw new Error(`${sup.name}: iş kaydı oluşturulamadı`);
  if (!dry) await db.from("suppliers").update({ last_run_at: new Date().toISOString(), last_status: "running" }).eq("code", sup.code);
  const count: Record<string, number> = {};
  const rows: any[] = [];
  let errors: { row: number; sku: string; error: string }[] = [];
  const finish = async (patch: any) => {
    for (const part of chunk(rows, 1000)) await db.from("import_rows").upsert(part);
    await db.from("import_jobs").update({ finished_at: new Date().toISOString(), created: count.created ?? 0, updated: count.updated ?? 0, stock_only: count.stock ?? 0, unchanged: count.unchanged ?? 0, skipped: count.skipped ?? 0, ...patch }).eq("id", job.id);
    await db.from("suppliers").update({ last_run_at: new Date().toISOString(), last_status: patch.status }).eq("code", sup.code);
  };
  try {
    const url = sup.xml_url || (sup.url_from_env && /^[A-Z0-9_]+$/.test(sup.url_from_env) ? process.env[sup.url_from_env] : "");
    if (!url) throw new Error(`XML adresi yok${sup.url_from_env ? ` (GitHub Secret ${sup.url_from_env} boş)` : ""}`);
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (urun-paneli)" } });
    if (!res.ok) throw new Error(`XML indirilemedi (HTTP ${res.status})`);
    const built = buildItems(parseXml(await res.text()), sup);
    const { items, total, path } = built;
    errors = built.errors;
    console.log(`${sup.name}: ${total} ürün (${path}), ${items.length} geçerli, ${errors.length} hatalı`);
    if (!total) throw new Error("XML'de ürün listesi bulunamadı (alan eşlemesini / ürün listesi yolunu kontrol et)");
    if (dry) { console.log(JSON.stringify({ sample: items.slice(0, 2), errors: errors.slice(0, 20) }, null, 1)); return; }
    rows.push(...errors.map((e) => ({ job_id: job.id, row_no: e.row, sku: e.sku, status: "error", errors: { _: e.error } })));
    await db.from("import_jobs").update({ total }).eq("id", job.id);
    for (const [n, part] of chunk(items, 200).entries()) {
      const { data, error } = await db.rpc("product_import_batch", { items: part, actor, opts: { mode: "upsert", keep_missing_variants: false, source } });
      if (error) throw new Error(`Toplu kayıt hatası: ${error.message}`);
      for (const r of data as any[]) {
        count[r.action] = (count[r.action] ?? 0) + 1;
        if (r.action === "error" || r.action === "skipped") rows.push({ job_id: job.id, row_no: r.row, sku: r.sku, status: r.action, errors: { _: r.error } });
      }
      if (n % 20 === 0) console.log(`${sup.code}: ${Math.min((n + 1) * 200, items.length)} / ${items.length}`, count);
    }
    // XML'den kalkan ürünler: stok 0 (rezerve stok korunur)
    const inXml = new Set(items.map((i) => i.payload.sku));
    const gone: string[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("products").select("id, sku").eq("source", source).neq("status", "archived").range(from, from + 999);
      if (error) throw new Error(error.message);
      for (const p of data ?? []) if (!inXml.has(p.sku)) gone.push(p.id);
      if (!data || data.length < 1000) break;
    }
    let zeroed = 0;
    // Güvenlik: XML bir anda çok küçüldüyse (bozuk/eksik indirme) stok sıfırlama yapılmaz
    const safe = gone.length <= Math.max(50, inXml.size * 0.3);
    if (safe) for (const ids of chunk(gone, 200)) {
      const { data, error } = await db.from("product_variants").update({ stock: 0 }).in("product_id", ids).gt("stock", 0).eq("reserved", 0).select("id");
      if (error) throw new Error(error.message);
      zeroed += data?.length ?? 0;
    }
    const failed = (count.error ?? 0) + errors.length;
    await finish({
      status: failed ? "partial" : "ok", failed,
      message: safe ? `XML'den kalkan ${gone.length} ürün (${zeroed} varyantın stoğu 0 yapıldı)` : `XML'den kalkan ${gone.length} ürün çok fazla, güvenlik için stokları sıfırlanmadı (XML eksik inmiş olabilir)`,
    });
    console.log(`${sup.code} bitti`, count, { xmlErrors: errors.length, gone: gone.length, zeroed });
    // Yeni ürünler girdiyse pazaryeri ilanlarını bunlara bağla (iş kuyruğu, aynı içe aktarma için bir kez)
    if (count.created) await db.from("jobs").insert({ type: "link_listings", marketplace: "trendyol", idempotency_key: `link-after-import-${job.id}`, created_by: actor });
  } catch (e: any) {
    if (dry) throw e;
    await finish({ status: "error", failed: (count.error ?? 0) + errors.length, message: String(e.message).slice(0, 500) });
    throw e;
  }
}

async function main() {
  const which = process.argv[2] ?? "all";
  const dry = process.argv.includes("--dry");
  const actor = process.env.ACTOR || "xml-import";
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  let q = db.from("suppliers").select("*").eq("active", true);
  if (which === "nightly") q = q.eq("nightly", true);
  else if (which !== "all") q = q.eq("code", which);
  const { data: sups, error } = await q;
  if (error) throw new Error(error.message);
  if (!sups?.length) { console.log(`İçe aktarılacak tedarikçi yok (${which})`); return; }
  let failed = 0;
  for (const sup of sups) {
    try { await importSupplier(db, sup, dry, actor); }
    catch (e: any) { failed++; console.error(e.message); }
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("worker/import-xml.ts")) await main();
