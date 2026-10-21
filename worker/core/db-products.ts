// Faz 4: ürün veritabanından pazaryerine (tüm tedarikçiler).
//  - dbInventory: veritabanından gönderilmiş ilanların stok/fiyatı (BayilikXML ilanları XML akışında kalır)
//  - processSendJobs: paneldeki "Pazaryerine gönder" kuyruğu (jobs: send_products:<pazaryeri>) -> ürün açma
// Ürün pazaryerinde doğrulanmadan "yayında" sayılmaz: gönderilen ilan "sent" olur, durumu sonraki senkronlarda pazaryerinden okunur.
import { calcPrice, existingPriceSafe, type PricingConfig } from "../pricing.ts";
import { applyRules, type PricingRule } from "../pricing-rules.ts";
import type { InventoryItem, Listing, Marketplace, NewProduct } from "../marketplaces/types.ts";
import { normTitle } from "./util.ts";
import { isRealGtin } from "../marketplaces/amazon.ts";
import { loadBrandMatcher } from "./brand-risk.ts";

export type DbCtx = {
  db: any; mp: Marketplace; marketplaceId: string; cfg: PricingConfig; rules: PricingRule[]; fx: Record<string, number>;
  minStock: number; policy: string; catMap: Map<string, any>; existing: Set<string>; lsBy: Map<string, Listing>; lsTitles: Set<string>;
  linked: Set<string>; predict: ((title: string, xmlCategory: string) => any) | null; skip: (why: string) => void; defaultVatRate: number;
  clean?: (title: string, description: string) => { title: string; description: string }; // yasaklı kelime / marka eki temizliği
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
      const sendPrice = existingPriceSafe(ctx.policy, Number(ls.price), pr.price, pr.cost, pr.pcfg, pr.comm);
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

  const brandRisk = await loadBrandMatcher(ctx.db);
  // Tedarikçi ürünlerinin pazaryerindeki markası: tedarikçi ayarı "Pazaryeri markası" (ör. Toptancım -> Tcx, yetki belgesiyle).
  // Boşsa tedarikçi ürünü gönderilmez (mağaza markasıyla açmak istenmiyor; XML markası başkasına kayıtlı olabilir)
  const supBrand = new Map<string, string>();
  const supDefaults = new Map<string, Record<string, string>>(); // tedarikçi varsayılan özellikleri (ör. Menşei)
  {
    let r = await ctx.db.from("suppliers").select("code, marketplace_brand, default_attributes");
    if (r.error) r = await ctx.db.from("suppliers").select("code, marketplace_brand"); // migration 026 öncesi
    for (const x of r.data ?? []) {
      if (x.marketplace_brand) supBrand.set(`xml:${x.code}`, String(x.marketplace_brand));
      if (x.default_attributes && typeof x.default_attributes === "object" && !Array.isArray(x.default_attributes)) supDefaults.set(`xml:${x.code}`, x.default_attributes);
    }
  }

  const keyFor = (source: string, v: any) => (ctx.mp.listingKeyFor ? ctx.mp.listingKeyFor(source, v) : listingKeyOf(source, v));
  const needsCategory = ctx.mp.requiresCategory !== false;

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
      // Katalog eşleşmesi gereken pazaryeri (Amazon): onaylı eşleşmeler
      const confirmed = new Map<string, string>();
      if (ctx.mp.findCatalogMatches) {
        const vids = (products ?? []).flatMap((p: any) => (p.product_variants ?? []).map((v: any) => v.id));
        const m = vids.length ? await ctx.db.from("marketplace_matches").select("variant_id, external_id").eq("marketplace", ctx.marketplaceId).eq("status", "confirmed").in("variant_id", vids) : { data: [] };
        for (const r of m.data ?? []) confirmed.set(r.variant_id, r.external_id);
      }
      for (const p of products ?? []) {
        const images = [...(p.product_images ?? [])].sort((a: any, b: any) => a.position - b.position).map((i: any) => i.url);
        const pred = ctx.predict ? ctx.predict(p.title, p.category ?? "") : null;
        const categoryId = ctx.catMap.get(p.category)?.category_id ?? (pred?.level === "yuksek" ? pred.categoryId : null);
        for (const v of [...(p.product_variants ?? [])].sort((a: any, b: any) => a.position - b.position)) {
          const key = keyFor(p.source, v);
          if (!key || !CODE_RE.test(key)) { fail(key, p, v, "Barkod yok veya pazaryeri kuralına uymuyor (en fazla 40 karakter, harf/rakam/. _ -)"); continue; }
          if (ctx.existing.has(key)) { rows.push({ marketplace: ctx.marketplaceId, listing_key: key, variant_id: v.id, product_id: p.id, status: ctx.lsBy.get(key)?.status === "pending" ? "pending_approval" : "live", updated_at: now }); continue; }
          if (p.status !== "active") { fail(key, p, v, "Ürün aktif değil (taslak/arşiv)"); continue; }
          if (ctx.lsTitles.has(normTitle(p.title))) { fail(key, p, v, `${ctx.mp.label}'da aynı başlıklı ürün var (çoklama riski)`); continue; }
          if (!images.length) { fail(key, p, v, "Görsel yok"); continue; }
          const risky = brandRisk?.(p.title, p.description ?? "");
          if (risky) { fail(key, p, v, `Marka riski: başlık/açıklamada "${risky}" geçiyor (marka ihlali uyarısı almamak için gönderilmedi; panel → Markalar → Gönderilmeyen markalar)`); continue; }
          if (needsCategory && !categoryId) { fail(key, p, v, `${ctx.mp.label} kategorisi yok: Kategoriler sekmesinde "${p.category || "kategorisiz"}" eşleştirilmeli`); continue; }
          // Amazon: var olan ürüne teklif için ASIN (onaylı eşleşme > EAN ile tek sonuç > başlıkla adaylar -> panelde onay)
          let asin: string | undefined;
          if (ctx.mp.findCatalogMatches) {
            asin = confirmed.get(v.id);
            if (!asin) {
              const byEan = isRealGtin(v.barcode) ? await ctx.mp.findCatalogMatches({ ean: v.barcode }).catch(() => []) : [];
              const cands = byEan.length ? byEan : await ctx.mp.findCatalogMatches({ title: p.title }).catch(() => []);
              const auto = byEan.length === 1;
              if (cands.length) await ctx.db.from("marketplace_matches").upsert(cands.map((c) => ({ marketplace: ctx.marketplaceId, variant_id: v.id, product_id: p.id, external_id: c.asin, title: c.title?.slice(0, 300), brand: c.brand ?? null, image: c.image ?? null, matched_by: c.by, status: auto ? "confirmed" : "suggested", decided_by: auto ? "otomatik (EAN)" : null, updated_at: now })), { onConflict: "marketplace,variant_id,external_id", ignoreDuplicates: false });
              if (auto) asin = byEan[0].asin;
              else { fail(key, p, v, cands.length ? `${ctx.mp.label} eşleşmesi onay bekliyor: ürün detayında doğru ürünü seç (${cands.length} aday)` : `${ctx.mp.label}'da eşleşen ürün bulunamadı (gerçek EAN yok; yeni ürün açmak için GTIN muafiyeti gerekir)`); continue; }
            }
          }
          if (String(p.source ?? "").startsWith("xml:") && !supBrand.has(p.source)) { fail(key, p, v, `Tedarikçinin pazaryeri markası ayarlanmadı (Ürünler → Tedarikçiler → "${String(p.source).slice(4)}" → Pazaryeri markası)`); continue; }
          const avail = Math.max(0, Number(v.stock ?? 0) - Number(v.reserved ?? 0));
          const pr = priceFor(ctx, p, v, null, avail);
          if (!pr.ok) { fail(key, p, v, `Fiyat hesaplanamadı: ${pr.reason}`); continue; }
          const np: NewProduct = {
            ...(() => { const c = ctx.clean ? ctx.clean(p.title, p.description || p.title) : { title: p.title, description: p.description || p.title }; return { name: c.title, detail: c.description }; })(),
            id: key, brand: p.brand ?? "", productCode: p.sku, desi: Number(p.desi) || 1, images,
            cat: { ...(ctx.catMap.get(p.category) ?? {}), category_id: categoryId, vat_rate: Number(p.vat_rate ?? 20) },
            refs: pred?.refs, defaults: supDefaults.get(p.source), price: pr.price, qty: avail < ctx.minStock ? 0 : Math.min(avail, 20000), asin,
          };
          // Tedarikçi ürünü: tedarikçi ayarındaki pazaryeri markası; elle girilen ürün: kendi markası (pazaryerinde kayıtlıysa) yoksa mağaza markası
          const fromSupplier = String(p.source ?? "").startsWith("xml:");
          const brand = fromSupplier ? supBrand.get(p.source) ?? "" : (await brandOk(p.brand)) ? p.brand : "";
          if (!groups.has(brand)) groups.set(brand, []);
          groups.get(brand)!.push(np);
          ctx.lsTitles.add(normTitle(p.title)); // aynı başlıklı ikinci ürün (başka tedarikçiden) aynı çalışmada çift ilan açmasın
          rows.push({ marketplace: ctx.marketplaceId, listing_key: key, variant_id: v.id, product_id: p.id, status: "sent", title: p.title, price: pr.price, stock: np.qty, category_id: categoryId != null ? String(categoryId) : asin ?? null, last_error: null, updated_at: now });
          out.keys.set(key, job.id);
        }
      }
      let sentInJob = 0, failedBatches = 0;
      for (const [brand, items] of groups) {
        const skipped: string[] = [];
        const r = await ctx.mp.createProducts(items, { vatRate: ctx.defaultVatRate, skip: (why) => skipped.push(why), brandName: brand || undefined });
        sentInJob += r.ok; failedBatches += r.failed; out.batchIds.push(...r.batchIds);
        for (const f of r.failedItems ?? []) { const row = rows.find((x) => x.listing_key === f.id && x.status === "sent"); if (row) { row.status = "error"; row.last_error = f.reason; out.errors++; } }
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

// Toplu katalog eşleştirme (Amazon): jobs "match_products:<pazaryeri>" { product_ids }.
// Pazaryerine yazmaz (yalnızca katalog araması): önizleme modunda da çalışır. EAN ile tek sonuç otomatik onaylanır, diğerleri aday.
export async function processMatchJobs(ctx: DbCtx, worker: string): Promise<{ jobs: number; searched: number; auto: number; suggested: number; none: number }> {
  const out = { jobs: 0, searched: 0, auto: 0, suggested: 0, none: 0 };
  if (!ctx.mp.findCatalogMatches) return out;
  const { data: jobs, error } = await ctx.db.rpc("job_claim", { worker, kinds: [`match_products:${ctx.marketplaceId}`], max_n: 3 });
  if (error || !jobs?.length) return out;
  for (const job of jobs as any[]) {
    out.jobs++;
    try {
      const ids: string[] = (job.payload?.product_ids ?? []).slice(0, 300);
      const { data: products, error: pe } = await ctx.db.from("products").select("id, title, product_variants(id, barcode)").in("id", ids);
      if (pe) throw new Error(pe.message);
      const vids = (products ?? []).flatMap((p: any) => (p.product_variants ?? []).map((v: any) => v.id));
      // Zaten onaylı / aday bulunmuş varyantlar tekrar aranmaz
      const known = new Set<string>();
      if (vids.length) {
        const { data } = await ctx.db.from("marketplace_matches").select("variant_id").eq("marketplace", ctx.marketplaceId).in("variant_id", vids).neq("status", "rejected");
        for (const r of data ?? []) known.add(r.variant_id);
      }
      const now = new Date().toISOString();
      for (const p of products ?? []) for (const v of p.product_variants ?? []) {
        if (known.has(v.id)) continue;
        out.searched++;
        const byEan = isRealGtin(v.barcode) ? await ctx.mp.findCatalogMatches!({ ean: v.barcode }).catch(() => []) : [];
        const cands = byEan.length ? byEan : await ctx.mp.findCatalogMatches!({ title: p.title }).catch(() => []);
        if (!cands.length) { out.none++; continue; }
        const auto = byEan.length === 1;
        auto ? out.auto++ : out.suggested++;
        await ctx.db.from("marketplace_matches").upsert(cands.map((c) => ({ marketplace: ctx.marketplaceId, variant_id: v.id, product_id: p.id, external_id: c.asin, title: c.title?.slice(0, 300), brand: c.brand ?? null, image: c.image ?? null, matched_by: c.by, status: auto ? "confirmed" : "suggested", decided_by: auto ? "otomatik (EAN)" : null, updated_at: now })), { onConflict: "marketplace,variant_id,external_id" });
      }
      await ctx.db.rpc("job_finish", { job_id: job.id, ok: true, res: { ...out }, err: null });
    } catch (e: any) {
      await ctx.db.rpc("job_finish", { job_id: job.id, ok: false, res: null, err: String(e?.message ?? e) });
    }
  }
  return out;
}
