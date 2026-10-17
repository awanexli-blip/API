// Faz 4: ürün veritabanından pazaryerine (tüm tedarikçiler).
//  - dbInventory: veritabanından gönderilmiş ilanların stok/fiyatı (BayilikXML ilanları XML akışında kalır)
//  - processSendJobs: paneldeki "Pazaryerine gönder" kuyruğu (jobs: send_products:<pazaryeri>) -> ürün açma
// Ürün pazaryerinde doğrulanmadan "yayında" sayılmaz: gönderilen ilan "sent" olur, durumu sonraki senkronlarda pazaryerinden okunur.
import { calcPrice, existingPrice, type PricingConfig } from "../pricing.ts";
import { applyRules, type PricingRule } from "../pricing-rules.ts";
import type { InventoryItem, Listing, Marketplace, NewProduct } from "../marketplaces/types.ts";
import { normTitle } from "./util.ts";

export type DbCtx = {
  db: any; mp: Marketplace; marketplaceId: string; cfg: PricingConfig; rules: PricingRule[]; fx: Record<string, number>;
  minStock: number; policy: string; catMap: Map<string, any>; existing: Set<string>; lsBy: Map<string, Listing>; lsTitles: Set<string>;
  linked: Set<string>; predict: ((title: string, xmlCategory: string) => any) | null; skip: (why: string) => void; defaultVatRate: number;
};

const CODE_RE = /^[A-Za-z0-9ÇĞİÖŞÜçğıöşü._-]{1,40}$/;
const supplierOf = (source: string) => String(source ?? "").replace(/^xml:/, "");
// Pazaryerindeki anahtar: BayilikXML ürünleri mağaza kuralıyla "OS13-" + SKU, diğerleri varyant barkodu
export const listingKeyOf = (source: string, variant: { sku: string; barcode: string | null }) =>
  source === "xml:bayilik" ? `OS13-${variant.sku}` : variant.barcode ?? "";

// Fiyat: tedarikçi maliyeti (döviz çevrilir) + pazaryeri komisyonu + akıllı kâr kuralları
function priceFor(ctx: DbCtx, p: any, v: any, key: string | null, stock: number) {
  const cost = Number(v.cost_price ?? p.cost_price) * (ctx.fx[p.currency ?? "TRY"] ?? 0);
  if (!(cost > 0)) return { ok: false as const, reason: "maliyet yok", cost, comm: ctx.cfg.commissionRate, pcfg: ctx.cfg };
  const panelRate = ctx.catMap.get(p.category)?.commission_rate;
  const comm = ctx.mp.commission(key, p.category ?? "", panelRate != null ? Number(panelRate) : null, ctx.cfg.commissionRate).rate;
  const base: PricingConfig = { ...ctx.cfg, vatRate: Number(p.vat_rate ?? 20) / 100 };
  const pcfg = ctx.rules.length ? applyRules(base, ctx.rules, { cost, supplier: supplierOf(p.source), category: p.category, brand: p.brand, stock }).cfg : base;
  const r = calcPrice(cost, pcfg, comm);
  return r.ok ? { ok: true as const, price: r.price, cost, comm, pcfg } : { ok: false as const, reason: r.reason ?? "fiyat hesaplanamadı", cost, comm, pcfg };
}

export async function dbInventory(ctx: DbCtx): Promise<{ items: InventoryItem[]; stats: Record<string, number> }> {
  const items: InventoryItem[] = [];
  const stats: Record<string, number> = { listings: 0, updated: 0, zeroed: 0, notLive: 0 };
  for (let from = 0; ; from += 1000) {
    const { data, error } = await ctx.db.from("marketplace_listings")
      .select("listing_key, product_variants(stock, reserved, cost_price), products(source, status, cost_price, currency, vat_rate, category, brand)")
      .eq("marketplace", ctx.marketplaceId).not("variant_id", "is", null).range(from, from + 999);
    if (error || !data) break; // tablo yoksa (migration 013 öncesi) sessizce geç
    for (const r of data as any[]) {
      const p = r.products, v = r.product_variants, key = r.listing_key as string;
      if (!p || !v || p.source === "xml:bayilik") continue; // BayilikXML ilanları XML akışında
      stats.listings++;
      ctx.linked.add(key); // "XML'den kalkan" sayılıp stoğu sıfırlanmasın
      const ls = ctx.lsBy.get(key);
      if (!ls || (ls.status ?? "active") !== "active") { stats.notLive++; continue; } // onay bekleyen / kapalı ilana gönderilemez
      const avail = Math.max(0, Number(v.stock ?? 0) - Number(v.reserved ?? 0));
      const pr = priceFor(ctx, p, v, key, avail);
      if (!pr.ok) { items.push({ id: key, price: null, quantity: 0 }); stats.zeroed++; ctx.skip(`veritabanı ürünü: ${pr.reason} (stok 0)`); continue; }
      const sendPrice = existingPrice(ctx.policy, Number(ls.price), pr.price, pr.pcfg, pr.comm);
      const qty = p.status !== "active" || avail < ctx.minStock ? 0 : Math.min(avail, 20000);
      items.push({ id: key, price: sendPrice, quantity: qty });
      stats.updated++;
    }
    if (data.length < 1000) break;
  }
  return { items, stats };
}

export type SendResult = { jobs: number; sent: number; errors: number; batchIds: string[]; keys: Map<string, number> };

export async function processSendJobs(ctx: DbCtx, worker: string): Promise<SendResult> {
  const out: SendResult = { jobs: 0, sent: 0, errors: 0, batchIds: [], keys: new Map() };
  const { data: jobs, error } = await ctx.db.rpc("job_claim", { worker, kinds: [`send_products:${ctx.marketplaceId}`], max_n: 5 });
  if (error || !jobs?.length) return out;
  // Pazaryerinde kayıtlı markalar (yoksa ürün markası yerine pazaryeri varsayılan markası kullanılır)
  const brandRows = await ctx.db.from("marketplace_brands").select("name_norm").eq("marketplace", ctx.marketplaceId).limit(1);
  const brandListLoaded = !brandRows.error && (brandRows.data?.length ?? 0) > 0;
  const norm = (s: string) => s.toLocaleLowerCase("tr").replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u").replace(/\s+/g, " ").trim();
  const knownBrand = new Map<string, boolean>();
  async function brandOk(b: string) {
    if (!b || !brandListLoaded) return false;
    if (!knownBrand.has(b)) { const r = await ctx.db.from("marketplace_brands").select("brand_id").eq("marketplace", ctx.marketplaceId).eq("name_norm", norm(b)).limit(1); knownBrand.set(b, !!r.data?.length); }
    return knownBrand.get(b)!;
  }

  for (const job of jobs as any[]) {
    out.jobs++;
    const now = new Date().toISOString();
    const rows: any[] = [];
    const fail = (key: string, p: any, v: any, msg: string) => { out.errors++; rows.push({ marketplace: ctx.marketplaceId, listing_key: key || `?${v.id}`, variant_id: v.id, product_id: p.id, status: "error", title: p.title, last_error: msg.slice(0, 500), updated_at: now }); };
    try {
      const ids: string[] = (job.payload?.product_ids ?? []).slice(0, 200);
      const { data: products, error: pe } = await ctx.db.from("products").select("*, product_variants(*), product_images(url, position)").in("id", ids);
      if (pe) throw new Error(pe.message);
      const groups = new Map<string, NewProduct[]>(); // marka -> ürünler (adaptör çağrısı başına tek marka)
      for (const p of products ?? []) {
        const images = [...(p.product_images ?? [])].sort((a: any, b: any) => a.position - b.position).map((i: any) => i.url);
        const pred = ctx.predict ? ctx.predict(p.title, p.category ?? "") : null;
        const categoryId = ctx.catMap.get(p.category)?.category_id ?? (pred?.level === "yuksek" ? pred.categoryId : null);
        for (const v of [...(p.product_variants ?? [])].sort((a: any, b: any) => a.position - b.position)) {
          const key = listingKeyOf(p.source, v);
          if (!key || !CODE_RE.test(key)) { fail(key, p, v, "Barkod yok veya pazaryeri kuralına uymuyor (en fazla 40 karakter, harf/rakam/. _ -)"); continue; }
          if (ctx.existing.has(key)) { rows.push({ marketplace: ctx.marketplaceId, listing_key: key, variant_id: v.id, product_id: p.id, status: ctx.lsBy.get(key)?.status === "pending" ? "pending_approval" : "live", updated_at: now }); continue; }
          if (p.status !== "active") { fail(key, p, v, "Ürün aktif değil (taslak/arşiv)"); continue; }
          if (ctx.lsTitles.has(normTitle(p.title))) { fail(key, p, v, `${ctx.mp.label}'da aynı başlıklı ürün var (çoklama riski)`); continue; }
          if (!images.length) { fail(key, p, v, "Görsel yok"); continue; }
          if (!categoryId) { fail(key, p, v, `${ctx.mp.label} kategorisi yok: Kategoriler sekmesinde "${p.category || "kategorisiz"}" eşleştirilmeli`); continue; }
          const avail = Math.max(0, Number(v.stock ?? 0) - Number(v.reserved ?? 0));
          const pr = priceFor(ctx, p, v, null, avail);
          if (!pr.ok) { fail(key, p, v, `Fiyat hesaplanamadı: ${pr.reason}`); continue; }
          const np: NewProduct = {
            id: key, name: p.title, detail: p.description || p.title, brand: p.brand ?? "", productCode: p.sku, desi: Number(p.desi) || 1, images,
            cat: { ...(ctx.catMap.get(p.category) ?? {}), category_id: categoryId, vat_rate: Number(p.vat_rate ?? 20) },
            refs: pred?.refs, price: pr.price, qty: avail < ctx.minStock ? 0 : Math.min(avail, 20000),
          };
          const brand = (await brandOk(p.brand)) ? p.brand : "";
          if (!groups.has(brand)) groups.set(brand, []);
          groups.get(brand)!.push(np);
          rows.push({ marketplace: ctx.marketplaceId, listing_key: key, variant_id: v.id, product_id: p.id, status: "sent", title: p.title, price: pr.price, stock: np.qty, category_id: String(categoryId), last_error: null, updated_at: now });
          out.keys.set(key, job.id);
        }
      }
      let sentInJob = 0, failedBatches = 0;
      for (const [brand, items] of groups) {
        const skipped: string[] = [];
        const r = await ctx.mp.createProducts(items, { vatRate: ctx.defaultVatRate, skip: (why) => skipped.push(why), brandName: brand || undefined });
        sentInJob += r.ok; failedBatches += r.failed; out.batchIds.push(...r.batchIds);
        // Adaptörün gönderemediği ürünler (ör. zorunlu özellik doldurulamadı): ilan "error"
        // Hiçbiri gönderilemediyse grubun ilanları "error"; kısmi hatalar toplu sonuç kontrolünde ürün bazında işaretlenir
        if (r.ok === 0) { const ids = new Set(items.map((i) => i.id)); for (const row of rows) if (row.status === "sent" && ids.has(row.listing_key)) { row.status = "error"; row.last_error = (skipped[0] ?? "Pazaryeri isteği başarısız").slice(0, 500); } }
        if (skipped.length && r.ok > 0) for (const why of skipped) ctx.skip(`gönderim: ${why}`);
      }
      out.sent += sentInJob;
      if (rows.length) await ctx.db.from("marketplace_listings").upsert(rows, { onConflict: "marketplace,listing_key" });
      const result = { sent: sentInJob, errors: rows.filter((r) => r.status === "error").length, already: rows.filter((r) => r.status === "live" || r.status === "pending_approval").length };
      if (failedBatches && !sentInJob) throw new Error(`${ctx.mp.label} isteği başarısız (${failedBatches} paket)`);
      await ctx.db.rpc("job_finish", { job_id: job.id, ok: true, res: result, err: null });
    } catch (e: any) {
      if (rows.length) await ctx.db.from("marketplace_listings").upsert(rows.map((r) => (r.status === "sent" ? { ...r, status: "queued" } : r)), { onConflict: "marketplace,listing_key" });
      await ctx.db.rpc("job_finish", { job_id: job.id, ok: false, res: null, err: String(e?.message ?? e) });
    }
  }
  return out;
}
