// Tedarikçi XML'leri -> merkezi ürün veritabanı (products). GitHub Actions: .github/workflows/import.yml
// node --experimental-strip-types worker/import-xml.ts <tedarikçi kodu | all | nightly> [--dry]
// - Tedarikçi ayarları ve alan eşlemesi "suppliers" tablosunda (panel: Ürünler -> Tedarikçiler)
// - Kaynak "xml:<kod>"; aynı model kodlu ürünler tek ürünün varyantları olur
// - İçerik aynıysa (source_hash) yalnızca stok güncellenir; fiyat/içerik değişikliği denetim kaydına yazılır
// - XML'den kalkan ürünler silinmez: stokları 0 yapılır (silme açık bir işlemdir)
// - Bir tedarikçinin birden çok linki olabilir (suppliers.feeds): hepsi birlikte indirilir ve tek liste gibi işlenir; biri inmezse
//   içe aktarma durur (yoksa o linkin ürünleri "XML'den kalktı" sanılıp stokları sıfırlanırdı)
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { env, chunk, arg, SUPPLIER_ARG } from "./core/util.ts";
import { safeFetch } from "./core/safe-fetch.ts";
import { notifyOnce } from "./core/notify.ts";
import { esc } from "./core/telegram.ts";
import { feedSupplier, findItems, itemsToGroups, supplierPayload, type Feed, type Supplier } from "../lib/supplier-xml.ts";

const stable = (v: any): string => Array.isArray(v) ? `[${v.map(stable).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}` : JSON.stringify(v);
const hashOf = (p: any) => createHash("sha1").update(stable({ ...p, variants: p.variants.map(({ stock, ...v }: any) => v) })).digest("hex");

// Ayrıştırılmış XML -> içe aktarma kalemleri ve satır hataları (saf fonksiyon, test edilir)
// seen/seenSku: aynı tedarikçinin linkleri arasında paylaşılır (barkod ve SKU tekrarı linkler arasında da yakalanır)
export function buildItems(parsed: any, sup: Supplier, seen = new Set<string>(), seenSku = new Set<string>()) {
  const { items: raw, path } = findItems(parsed, sup.item_path);
  const groups = itemsToGroups(raw, sup.mapping);
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
    const mainUrl = sup.xml_url || (sup.url_from_env && /^[A-Z0-9_]+$/.test(sup.url_from_env) ? process.env[sup.url_from_env] : "");
    if (!mainUrl) throw new Error(`XML adresi yok${sup.url_from_env ? ` (GitHub Secret ${sup.url_from_env} boş)` : ""}`);
    const feeds: (Feed & { url: string })[] = [{ id: "ana", label: "Ana link", url: mainUrl }, ...((Array.isArray(sup.feeds) ? sup.feeds : []) as Feed[]).map((f) => ({ ...f, url: String(f.url ?? "") }))];
    const items: { row: number; payload: any; hash: string }[] = [];
    const seen = new Set<string>(), seenSku = new Set<string>();
    const perFeed: string[] = [];
    let total = 0;
    const feedHash = createHash("sha1");
    for (const [fi, feed] of feeds.entries()) {
      const name = feed.label || `Link ${fi + 1}`;
      if (!feed.url) throw new Error(`${name}: XML adresi yok`);
      // İç ağ adresi, sonsuz yönlendirme ve 300 MB üstü gövde reddedilir (denetim S2.1)
      const res = await safeFetch(feed.url, { maxBytes: 300 * 1048576, timeoutMs: 5 * 60_000 });
      if (!res.ok) throw new Error(`${name}: XML indirilemedi (HTTP ${res.status})`);
      feedHash.update(res.body);
      const built = buildItems(parseXml(res.text()), feedSupplier(sup, feed), seen, seenSku);
      if (!built.total) throw new Error(`${name}: XML'de ürün listesi bulunamadı (alan eşlemesini / ürün listesi yolunu kontrol et)`);
      // Satır numaraları link başına ayrı aralıkta (hata listesinde hangi linkten geldiği anlaşılsın)
      const off = fi * 1_000_000;
      items.push(...built.items.map((i) => ({ ...i, row: i.row + off })));
      errors.push(...built.errors.map((e) => ({ ...e, row: e.row + off })));
      total += built.total;
      perFeed.push(`${name}: ${built.total}`);
      console.log(`${sup.name} / ${name}: ${built.total} ürün (${built.path}), ${built.items.length} geçerli, ${built.errors.length} hatalı`);
    }
    if (dry) { console.log(JSON.stringify({ sample: items.slice(0, 2), errors: errors.slice(0, 20) }, null, 1)); return; }
    // XML'ler bir önceki başarılı içe aktarmayla birebir aynıysa (ve 6 saatten yeni) hiçbir şey yazılmaz: tedarikçi bir şey değiştirmemiş
    const fh = feedHash.digest("hex");
    if (!process.env.FORCE_IMPORT && sup.last_feed_hash === fh && sup.last_feed_at && Date.now() - new Date(sup.last_feed_at).getTime() < 6 * 3600 * 1000) {
      await finish({ status: "ok", total, unchanged: items.length, message: `${perFeed.length > 1 ? perFeed.join(", ") + " · " : ""}XML değişmemiş, işlem yapılmadı` });
      console.log(`${sup.code}: XML değişmemiş, atlandı`);
      return;
    }
    rows.push(...errors.map((e) => ({ job_id: job.id, row_no: e.row, sku: e.sku, status: "error", errors: { _: e.error } })));
    await db.from("import_jobs").update({ total }).eq("id", job.id);
    // 50'lik parçalar; sorgu süre sınırına takılırsa parça bölünerek yeniden denenir (yeni tedarikçide ilk kayıt ağır: varyant + görsel)
    const saveBatch = async (part: any[]): Promise<any[]> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data, error } = await db.rpc("product_import_batch", { items: part, actor, opts: { mode: "upsert", keep_missing_variants: false, source } });
        if (!error) return data as any[];
        if (!/statement timeout|timeout/i.test(error.message)) throw new Error(`Toplu kayıt hatası: ${error.message}`);
        if (part.length > 5) { const h = Math.ceil(part.length / 2); return [...(await saveBatch(part.slice(0, h))), ...(await saveBatch(part.slice(h)))]; }
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      }
      throw new Error("Toplu kayıt hatası: veritabanı zaman aşımı (tekrar denendi)");
    };
    // Yalnızca değişen ürünler gönderilir (önceden her turda 26 bin ürünün tamamı ~80 MB gidiyordu): veritabanındaki özet (içerik özeti + varyant stokları)
    // ile aynı olan atlanır; yalnızca stoğu değişen ürün için tek satırlık stok bilgisi gider (product_import aynı özette yalnızca stok yazar).
    const known = new Map<string, { hash: string | null; stocks: Map<string, number> }>();
    for (let last = ""; ; ) {
      const { data, error } = await db.from("products").select("sku, source_hash, product_variants(sku, stock)").eq("source", source).gt("sku", last).order("sku").limit(1000);
      if (error) throw new Error(`Mevcut ürünler okunamadı: ${error.message}`);
      for (const p of data ?? []) known.set(p.sku, { hash: p.source_hash, stocks: new Map((p.product_variants ?? []).map((v: any) => [v.sku, Number(v.stock)])) });
      if (!data || data.length < 1000) break;
      last = data[data.length - 1].sku;
    }
    const toSave: typeof items = [];
    for (const it of items) {
      const k = known.get(it.payload.sku);
      if (!k || k.hash !== it.hash) { toSave.push(it); continue; }
      const vs: any[] = it.payload.variants ?? [];
      if (vs.length === k.stocks.size && vs.every((v) => k.stocks.get(v.sku) === Number(v.stock ?? 0))) { count.unchanged = (count.unchanged ?? 0) + 1; continue; }
      toSave.push({ row: it.row, hash: it.hash, payload: { sku: it.payload.sku, variants: vs.map((v) => ({ sku: v.sku, stock: v.stock })) } });
    }
    console.log(`${sup.code}: ${items.length} ürün, ${toSave.length} değişmiş (${count.unchanged ?? 0} aynı, gönderilmedi)`);
    for (const [n, part] of chunk(toSave, 50).entries()) {
      const data = await saveBatch(part);
      for (const r of data) {
        count[r.action] = (count[r.action] ?? 0) + 1;
        if (r.action === "error" || r.action === "skipped") rows.push({ job_id: job.id, row_no: r.row, sku: r.sku, status: r.action, errors: { _: r.error } });
      }
      if (n % 80 === 0) console.log(`${sup.code}: ${Math.min((n + 1) * 50, toSave.length)} / ${toSave.length}`, count);
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
      message: (feeds.length > 1 ? `${perFeed.join(", ")} · ` : "") + (safe ? `XML'den kalkan ${gone.length} ürün (${zeroed} varyantın stoğu 0 yapıldı)` : `XML'den kalkan ${gone.length} ürün çok fazla, güvenlik için stokları sıfırlanmadı (XML eksik inmiş olabilir)`),
    });
    console.log(`${sup.code} bitti`, count, { xmlErrors: errors.length, gone: gone.length, zeroed });
    await db.from("suppliers").update({ last_feed_hash: fh, last_feed_at: new Date().toISOString() }).eq("code", sup.code);
    // Satış hızı için tedarikçi stok düşüşü (ürün seçimi / fırsat puanı, migration 051)
    const snap = await db.rpc("snap_supplier_stock", { p_source: source });
    if (snap.error) console.error("stok kaydı:", snap.error.message);
    // Saklama süreleri (veritabanı ücretsiz plan sınırında kalsın): stok geçmişi 21 gün, değişiklik geçmişi 30 gün
    const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
    const rs = await db.from("supplier_stock_snap").delete().lt("day", day(21).slice(0, 10));
    if (rs.error) console.error("stok geçmişi saklama:", rs.error.message);
    const ra = await db.from("audit_log").delete().lt("at", day(30));
    if (ra.error) console.error("değişiklik geçmişi saklama:", ra.error.message);
    // Yeni ürünler girdiyse pazaryeri ilanlarını bunlara bağla (iş kuyruğu, aynı içe aktarma için bir kez)
    if (count.created) await db.from("jobs").insert({ type: "link_listings", marketplace: "trendyol", idempotency_key: `link-after-import-${job.id}`, created_by: actor });
  } catch (e: any) {
    if (dry) throw e;
    await finish({ status: "error", failed: (count.error ?? 0) + errors.length, message: String(e.message).slice(0, 500) });
    // Telegram: içe aktarma durdu (tedarikçi linki inmedi vb.); stoklar güncellenmiyor demektir. Aynı tedarikçi için 3 saatte bir
    const now = new Date();
    await notifyOnce(db, `import:${sup.code}:${now.toISOString().slice(0, 10)}T${Math.floor(now.getUTCHours() / 3)}`, `📦 <b>${esc(sup.name ?? sup.code)} içe aktarma durdu</b>
${esc(String(e.message).slice(0, 300))}
Stoklar güncellenmiyor; sorun sürerse Claude'a bildir.`).catch(() => false);
    throw e;
  }
}

async function main() {
  const which = arg(process.argv[2], "all", SUPPLIER_ARG, "tedarikçi");
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
