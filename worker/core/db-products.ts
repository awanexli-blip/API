// Faz 4: ürün veritabanından pazaryerine (tüm tedarikçiler).
//  - dbInventory: veritabanından gönderilmiş ilanların stok/fiyatı (BayilikXML ilanları XML akışında kalır)
//  - processSendJobs: paneldeki "Pazaryerine gönder" kuyruğu (jobs: send_products:<pazaryeri>) -> ürün açma
// Ürün pazaryerinde doğrulanmadan "yayında" sayılmaz: gönderilen ilan "sent" olur, durumu sonraki senkronlarda pazaryerinden okunur.
import { breakdown, calcPrice, existingPriceSafe, type PricingConfig } from "../pricing.ts";
import { applyRules, type PricingRule } from "../pricing-rules.ts";
import type { InventoryItem, Listing, Marketplace, NewProduct } from "../marketplaces/types.ts";
import { normTitle, normFull } from "./util.ts";
import { salePriceOf } from "./sale-price.ts";
import { marginFor, type DynMargin } from "./dynamic-margin.ts";
import { isRealGtin } from "../marketplaces/amazon.ts";
import { loadBrandMatcher } from "./brand-risk.ts";

export type DbCtx = {
  db: any; mp: Marketplace; marketplaceId: string; cfg: PricingConfig; rules: PricingRule[]; fx: Record<string, number>;
  minStock: number; policy: string; catMap: Map<string, any>; existing: Set<string>; lsBy: Map<string, Listing>; lsTitles: Set<string>;
  linked: Set<string>; predict: ((title: string, xmlCategory: string) => any) | null; skip: (why: string) => void; defaultVatRate: number;
  leafMatch?: ((title: string, supplierCategory: string) => { categoryId: string; categoryName: string; score: number } | null) | null; // kategori ağacından başlıkla (son çare)
  pathMatch?: ((supplierCategory: string, title: string) => { categoryId: string; categoryName: string; score: number } | null) | null; // tedarikçi kategori yolundan (HB ağacına benzer)
  clean?: (title: string, description: string) => { title: string; description: string }; // yasaklı kelime / marka eki temizliği
  shipFor?: ((desi: number | null) => number) | null; // desi tarifesi (Hepsiburada): ürünün desisine göre kargo, yoksa cfg.shippingCost
  overrides?: Map<string, any>; // product_overrides (ilan anahtarı -> elle fiyat / gizle)
  econ?: Map<string, { cost: number; comm: number; pcfg: PricingConfig; price: number }>; // ilan başına maliyet/komisyon (buybox kâr hesabı)
  // Duruma göre marj: ayar + ilan -> başka satıcı var mı (listing_buybox.multiple); active=false ise yalnızca karşılaştırma (stats.marginSim)
  dyn?: { cfg: DynMargin; active: boolean; comp: Map<string, boolean> } | null;
};

// Görsel adının kök kısmı (tedarikçi CDN'i: "...-model-1-12345-sw1024sh1024.webp" -> "...-model")
const imageBase = (u?: string) => String(u ?? "").replace(/^.*\//, "").replace(/-\d+-\d+-sw.*$/, "").replace(/\.[a-z]+$/i, "");
const firstImage = (x: any) => [...(x.product_images ?? [])].sort((a: any, b: any) => a.position - b.position)[0]?.url;
// Başlığa model kodu: "TCX-LLM-HDY0677" -> "HDY0677" (en fazla 100 karakter)
function withModel(title: string, ref: string, barcode?: string | null) {
  const parts = String(ref ?? "").split("-").filter(Boolean);
  let code = (parts.length > 1 && parts[parts.length - 1].length >= 4 ? parts[parts.length - 1] : parts.join("-")).replace(/^TCX/i, "");
  // Kod okunur değilse (Türkçe harf, tire, 14+ karakter: "XXUCZZZ20WSİLİKONTABANCASI-4") barkod kullanılır; Trendyol tireli eki marka sanıyor
  if (!/^[A-Za-z0-9]{3,13}$/.test(code)) code = String(barcode ?? "").replace(/[^A-Za-z0-9]/g, "");
  if (!code || title.toLowerCase().includes(code.toLowerCase())) return title;
  return `${title.slice(0, 100 - code.length - 1).trim()} ${code}`;
}
// Ürüne elle girilen özellikler (panel: Gönderilemeyenler) tedarikçi varsayılanını ezer; kategori anahtarı özellik değildir
// Ürün kaydındaki özellikler -> pazaryerine giden değerler. "Ad@pazaryeri" (formda o pazaryerinin listesinden ayrıca seçilen değer) o pazaryerinde
// "Ad"ı ezer, diğerinde yok sayılır. Pazaryeri kategori anahtarları ("Trendyol kategori", "Hepsiburada kategori adı") özellik değildir.
const CAT_KEY = /^((trendyol|hepsiburada|amazon) kategori|satış fiyatı(@|$))/i;
const productAttrs = (a: any, mp?: string): Record<string, string> => {
  const src = Object.entries(a && typeof a === "object" && !Array.isArray(a) ? a : {}).filter(([k, v]) => !CAT_KEY.test(k) && typeof v === "string" && v.trim()) as [string, string][];
  const out: Record<string, string> = Object.fromEntries(src.filter(([k]) => !k.includes("@")));
  for (const [k, v] of src) { const i = k.lastIndexOf("@"); if (i > 0 && mp && k.slice(i + 1).toLowerCase() === mp) out[k.slice(0, i)] = v; }
  return out;
};
const CODE_RE = /^[A-Za-z0-9ÇĞİÖŞÜçğıöşü._-]{1,40}$/;
// Kod gövdesi: sondaki "-1".."-99" atılır (migration 056 product_code_siblings ile aynı kural)
export const codeStem = (sku: string) => String(sku ?? "").replace(/-\d{1,2}$/, "");
// Kopyalardan gönderilecek: stokta (en az minStock) olanların en ucuzu; eşitse en kısa/küçük kod (ana kod önce). Stokta yoksa en ucuzu.
export function pickCodeWinner(list: { id: string; sku: string; cost: any; stock: any }[], minStock = 1) {
  const sorted = [...list].filter((x) => Number(x.cost) > 0).sort((a, b) => Number(a.cost) - Number(b.cost) || a.sku.length - b.sku.length || a.sku.localeCompare(b.sku));
  const w = sorted.find((x) => Number(x.stock) >= Math.max(1, minStock)) ?? sorted[0];
  return w ? { id: w.id, sku: w.sku } : null;
}
const supplierOf = (source: string) => String(source ?? "").replace(/^xml:/, "");
// Pazaryerindeki anahtar: BayilikXML ürünleri mağaza kuralıyla "OS13-" + SKU, diğerleri varyant barkodu
export const listingKeyOf = (source: string, variant: { sku: string; barcode: string | null }) =>
  source === "xml:bayilik" ? `OS13-${variant.sku}` : variant.barcode ?? "";

// Fiyat: tedarikçi maliyeti (döviz çevrilir) + pazaryeri komisyonu + akıllı kâr kuralları
function priceFor(ctx: DbCtx, p: any, v: any, key: string | null, stock: number, catName?: string | null) {
  const cost = Number(v.cost_price ?? p.cost_price) * (ctx.fx[p.currency ?? "TRY"] ?? 0);
  if (!(cost > 0)) return { ok: false as const, reason: "maliyet yok", cost, comm: ctx.cfg.commissionRate, pcfg: ctx.cfg };
  const panelRate = ctx.catMap.get(p.category)?.commission_rate;
  // Kategori ipucu: pazaryeri kategori adı (gönderimde bulunan) ya da Trendyol'da öğrenilen ad; oran tablosu olan adaptör kullanır (HB EK.4)
  const hintCat = catName ?? (ctx.marketplaceId !== "trendyol" ? String(p.attributes?.["Trendyol kategori adı"] ?? "") : "");
  const comm = ctx.mp.commission(key, p.category ?? "", panelRate != null ? Number(panelRate) : null, ctx.cfg.commissionRate, { category: hintCat, title: p.title }).rate;
  const base: PricingConfig = { ...ctx.cfg, vatRate: Number(p.vat_rate ?? 20) / 100, ...(ctx.shipFor ? { shippingCost: ctx.shipFor(p.desi != null ? Number(p.desi) : null) } : {}) };
  const pcfg = ctx.rules.length ? applyRules(base, ctx.rules, { cost, supplier: supplierOf(p.source), category: p.category, brand: p.brand, stock }).cfg : base;
  // Ürün formunda girilen satış fiyatı (KDV dahil; "Satış fiyatı@hepsiburada" o pazaryerinde ezer): boşsa formül. Zarar ettiriyorsa uygulanmaz.
  const fixed = salePriceOf(p.attributes, ctx.marketplaceId);
  if (fixed > 0) {
    if (breakdown(fixed, cost, pcfg, comm).net > 0) return { ok: true as const, price: Math.round(fixed * 100) / 100, cost, comm, pcfg, fixed: true };
    ctx.skip(`girilen satış fiyatı zarar ettiriyor (${fixed} TL): formül fiyatı kullanıldı`);
  }
  const r = calcPrice(cost, pcfg, comm);
  if (!r.ok) return { ok: false as const, reason: r.reason ?? "fiyat hesaplanamadı", cost, comm, pcfg };
  // Duruma göre marj (dynamic-margin.ts): açıksa fiyat bununla; kapalıyken "alt" yalnızca önizleme karşılaştırması içindir
  if (ctx.dyn) {
    const m = marginFor(ctx.dyn.cfg, { competition: key != null ? ctx.dyn.comp.get(key) : undefined, price: r.price });
    const dcfg = { ...pcfg, netMarginMin: m };
    const r2 = calcPrice(cost, dcfg, comm);
    if (r2.ok && ctx.dyn.active) return { ok: true as const, price: r2.price, cost, comm, pcfg: dcfg, margin: m };
    if (r2.ok) return { ok: true as const, price: r.price, cost, comm, pcfg, alt: r2.price, margin: m };
  }
  return { ok: true as const, price: r.price, cost, comm, pcfg };
}

export async function dbInventory(ctx: DbCtx): Promise<{ items: InventoryItem[]; stats: Record<string, number> }> {
  const items: InventoryItem[] = [];
  const stats: Record<string, number> = { listings: 0, updated: 0, zeroed: 0, notLive: 0 };
  // Tedarikçi kod kopyaları (migration 057): grupta stokta en ucuz ilan dışındakilere stok 0 (fiyat yine güncellenir)
  const dupLosers = new Set<string>();
  { const r = await ctx.db.rpc("dup_listing_losers", { p_mp: ctx.marketplaceId, p_min_stock: ctx.minStock }); if (!r.error) for (const x of r.data ?? []) dupLosers.add(x.listing_key); else console.error("kopya ilanlar okunamadı:", r.error.message); }
  // Anahtar sıralı sayfalama (OFFSET sırasız ve derin sayfada yavaştı: ilan atlanabilir/çift gelebilirdi)
  for (let last = ""; ; ) {
    const { data, error } = await ctx.db.from("marketplace_listings")
      .select("listing_key, product_variants(stock, reserved, cost_price), products(source, status, cost_price, currency, vat_rate, category, brand, desi, title, attributes)")
      .eq("marketplace", ctx.marketplaceId).not("variant_id", "is", null).gt("listing_key", last).order("listing_key").limit(1000);
    if (error || !data?.length) break; // tablo yoksa (migration 013 öncesi) sessizce geç
    last = (data as any[])[data.length - 1].listing_key;
    for (const r of data as any[]) {
      const p = r.products, v = r.product_variants, key = r.listing_key as string;
      if (!p || !v || p.source === "xml:bayilik") continue; // BayilikXML ilanları XML akışında
      stats.listings++;
      ctx.linked.add(key); // "XML'den kalkan" sayılıp stoğu sıfırlanmasın
      const ls = ctx.lsBy.get(key);
      if (!ls || (ls.status ?? "active") !== "active") { stats.notLive++; continue; } // onay bekleyen / kapalı ilana gönderilemez
      const avail = Math.max(0, Number(v.stock ?? 0) - Number(v.reserved ?? 0));
      const ov = ctx.overrides?.get(key);
      if (ov?.hidden) { items.push({ id: key, price: null, quantity: 0 }); stats.zeroed++; continue; } // panelde gizlenen ilan
      const pr = priceFor(ctx, p, v, key, avail);
      if (!pr.ok) { items.push({ id: key, price: null, quantity: 0 }); stats.zeroed++; ctx.skip(`veritabanı ürünü: ${pr.reason} (stok 0)`); continue; }
      // Duruma göre marj karşılaştırması (kapalıyken): ilandaki bugünkü fiyat -> yeni kuralın hedef fiyatı
      if ("alt" in pr && pr.alt != null && Number(ls.price) > 0) {
        const cur = Number(ls.price), d = (pr.alt - cur) / cur;
        stats.simN = (stats.simN ?? 0) + 1;
        if (Math.abs(d) < 0.005) stats.simSame = (stats.simSame ?? 0) + 1;
        else if (d > 0) { stats.simUp = (stats.simUp ?? 0) + 1; stats.simUpPct = (stats.simUpPct ?? 0) + d; if (d > 0.1) stats.simUp10 = (stats.simUp10 ?? 0) + 1; }
        else { stats.simDown = (stats.simDown ?? 0) + 1; stats.simDownPct = (stats.simDownPct ?? 0) - d; if (d < -0.1) stats.simDown10 = (stats.simDown10 ?? 0) + 1; }
        const c = key != null ? ctx.dyn?.comp.get(key) : undefined;
        const g = c === true ? "simComp" : c === false ? "simAlone" : "simBand";
        stats[g] = (stats[g] ?? 0) + 1;
        // Bugünkü kuralın hedefi (40 TL / %10) ile yeni kuralın hedefi arasındaki fark (toplam satış fiyatı)
        stats.simSumCur = (stats.simSumCur ?? 0) + pr.price; stats.simSumAlt = (stats.simSumAlt ?? 0) + pr.alt; stats.simSumLive = (stats.simSumLive ?? 0) + cur;
      }
      // Elle fiyat (panel: Rekabet / Ürün istisnaları): zarar ettiriyorsa uygulanmaz
      const ovPrice = ov?.price_override ? Number(ov.price_override) : null;
      const ovOk = ovPrice != null && ovPrice > 0 && breakdown(ovPrice, pr.cost, pr.pcfg, pr.comm).net > 0;
      if (ovPrice != null && !ovOk) { stats.overrideLoss = (stats.overrideLoss ?? 0) + 1; ctx.skip("elle fiyat zarar ettiriyor: formül fiyatı kullanıldı"); }
      // Formda girilen satış fiyatı olduğu gibi gider (smart politikanın kademeli düşüşü uygulanmaz)
      const sendPrice = ovOk ? ovPrice : "fixed" in pr && pr.fixed ? pr.price : existingPriceSafe(ctx.policy, Number(ls.price), pr.price, pr.cost, pr.pcfg, pr.comm);
      ctx.econ?.set(key, { cost: pr.cost, comm: pr.comm, pcfg: pr.pcfg, price: sendPrice ?? Number(ls.price) });
      const dup = dupLosers.has(key);
      if (dup) stats.duplicateClosed = (stats.duplicateClosed ?? 0) + 1;
      const qty = dup || p.status !== "active" || avail < ctx.minStock ? 0 : Math.min(avail, 20000);
      // Değişmeyen ilan gönderilmez (pushOnlyChanged pazaryerleri)
      if (ctx.mp.pushOnlyChanged && Number(ls.quantity) === qty && (sendPrice == null || Math.abs(Number(ls.price) - sendPrice) < 0.01)) { stats.unchanged = (stats.unchanged ?? 0) + 1; continue; }
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
  const { data: jobs, error } = await ctx.db.rpc("job_claim", { worker, kinds: [`send_products:${ctx.marketplaceId}`], max_n: Number(process.env.SEND_JOBS_PER_RUN ?? 25) });
  if (error || !jobs?.length) return out;
  // Pazaryerinde kayıtlı markalar (yoksa ürün markası yerine pazaryeri varsayılan markası kullanılır)
  const brandRows = await ctx.db.from("marketplace_brands").select("name_norm").eq("marketplace", ctx.marketplaceId).limit(1);
  const brandListLoaded = !brandRows.error && (brandRows.data?.length ?? 0) > 0;
  const norm = (s: string) => s.toLocaleLowerCase("tr").replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u").replace(/\s+/g, " ").trim();
  const knownBrand = new Map<string, boolean>();
  async function brandOk(b: string) {
    if (!b) return false;
    // Marka listesi indirilmiyor (25.10, veritabanı hafifletme): marka pazaryerinde gönderimde doğrulanır (Trendyol by-name; bulunamazsa ilan hatası)
    if (!brandListLoaded) return true;
    if (!knownBrand.has(b)) { const r = await ctx.db.from("marketplace_brands").select("brand_id").eq("marketplace", ctx.marketplaceId).eq("name_norm", norm(b)).limit(1); knownBrand.set(b, !!r.data?.length); }
    return knownBrand.get(b)!;
  }

  // Marka riski listesi Trendyol/Amazon içindir; Hepsiburada'da marka ihlali sorunu yok (K, 22.10): "Galaxy uyumlu kılıf" gibi ürünler gönderilir
  const brandRisk = ctx.marketplaceId === "hepsiburada" ? null : await loadBrandMatcher(ctx.db);
  // Tedarikçi ürünlerinin pazaryerindeki markası: tedarikçi ayarı "Pazaryeri markası" (ör. Toptancım -> Tcx, yetki belgesiyle).
  // Boşsa tedarikçi ürünü gönderilmez (mağaza markasıyla açmak istenmiyor; XML markası başkasına kayıtlı olabilir)
  const supBrand = new Map<string, string>();
  const supDefaults = new Map<string, Record<string, string>>(); // tedarikçi varsayılan özellikleri (ör. Menşei)
  const dedupeSources = new Set<string>(); // kod sonu -N kopyalarından yalnızca en ucuzu (migration 056)
  {
    let r: any = await ctx.db.from("suppliers").select("code, marketplace_brand, default_attributes, dedupe_code_suffix");
    if (r.error) r = await ctx.db.from("suppliers").select("code, marketplace_brand"); // migration 026/056 öncesi
    for (const x of r.data ?? []) {
      if (x.dedupe_code_suffix) dedupeSources.add(`xml:${x.code}`);
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
      // Aynı başlıklı ürünler (tedarikçi XML'lerinde): aynı görsel = aynı ürün -> yalnızca en ucuzu; farklı görsel = farklı model -> başlığa model kodu
      const sameTitle = new Map<string, any[]>();
      {
        const titles = [...new Set((products ?? []).map((p: any) => p.title))];
        for (let i = 0; i < titles.length; i += 100) {
          const r = await ctx.db.from("products").select("id, title, sku, source_ref, cost_price, status, product_images(url, position)").in("title", titles.slice(i, i + 100)).eq("status", "active");
          for (const x of r.data ?? []) { const k = normTitle(x.title); sameTitle.set(k, [...(sameTitle.get(k) ?? []), x]); }
        }
      }
      // Tedarikçinin kod kopyaları (ABC, ABC-1, ABC-2...: aynı ürün, farklı başlık): kod gövdesi başına stokta olan en ucuzu gönderilir
      const codeWinner = new Map<string, { id: string; sku: string }>(); // gövde -> seçilen ürün
      for (const src of dedupeSources) {
        const stems = [...new Set((products ?? []).filter((p: any) => p.source === src).map((p: any) => codeStem(p.sku)))];
        for (let i = 0; i < stems.length; i += 200) {
          const r = await ctx.db.rpc("product_code_siblings", { p_source: src, p_stems: stems.slice(i, i + 200) });
          if (r.error) { console.error("kod kopyaları okunamadı:", r.error.message); continue; }
          const by = new Map<string, any[]>();
          for (const x of r.data ?? []) by.set(x.stem, [...(by.get(x.stem) ?? []), x]);
          for (const [stem, list] of by) { const w = pickCodeWinner(list, ctx.minStock); if (w) codeWinner.set(`${src}|${stem}`, w); }
        }
      }
      for (const p of products ?? []) {
        const images = [...(p.product_images ?? [])].sort((a: any, b: any) => a.position - b.position).map((i: any) => i.url);
        const win = dedupeSources.has(p.source) ? codeWinner.get(`${p.source}|${codeStem(p.sku)}`) : undefined;
        const sib = (sameTitle.get(normTitle(p.title)) ?? []).filter((x: any) => x.id !== p.id);
        const myImg = imageBase(images[0]);
        const cheaper = sib.find((x: any) => imageBase(firstImage(x)) === myImg && myImg && (Number(x.cost_price) < Number(p.cost_price) || (Number(x.cost_price) === Number(p.cost_price) && x.id < p.id)));
        const title = sib.some((x: any) => imageBase(firstImage(x)) !== myImg) ? withModel(p.title, p.source_ref ?? p.sku, p.product_variants?.[0]?.barcode) : p.title;
        const pred = ctx.predict ? ctx.predict(p.title, p.category ?? "") : null;
        // Panelde (Gönderilemeyenler) ürüne elle girilen kategori numarası önce gelir
        // Ürün formunda (ya da Gönderilemeyenler'de) bu pazaryeri için seçilen kategori: "Trendyol kategori" / "Hepsiburada kategori"
        const mc = String(p.attributes?.[`${ctx.mp.label} kategori`] ?? "").trim();
        const manualCat = /^[\w-]{1,40}$/.test(mc) && /\d/.test(mc) ? mc : null;
        // Sıra (K kararı 22.10: ürünlerin çoğu gitsin, Trendyol gibi ada bakılsın): elle > kategori eşlemesi > tahmin (yüksek/orta) > ağaç eşleşmesi (güçlü)
        // > tahmin (düşük, %50+) > ağaç eşleşmesi (zayıf). Yanlış kategori Trendyol'dan revize olarak döner (Reddedilenler).
        const tyName = ctx.marketplaceId !== "trendyol" ? String(p.attributes?.["Trendyol kategori adı"] ?? "") : "";
        const leaf = !ctx.leafMatch ? null : (tyName && ctx.leafMatch(`${tyName} ${p.title}`, `${p.category ?? ""} ${tyName}`)) || ctx.leafMatch(p.title, p.category ?? "");
        // Tedarikçi yolu: son adım aynı adlı yaprak (güçlü, 12+) tahminden sonra, başlık ağaç eşleşmesinden önce; zayıfı en sonda
        const path = ctx.pathMatch ? ctx.pathMatch(p.category ?? "", p.title) : null;
        const strongPath = path && path.score >= 12 ? path : null;
        const pick = manualCat || ctx.catMap.get(p.category)?.category_id ? null
          : (pred && pred.level !== "dusuk" ? pred : null) ?? strongPath ?? (leaf && leaf.score >= 10 ? leaf : null) ?? (pred && pred.confidence >= 0.5 ? pred : null) ?? path ?? leaf ?? null;
        // Elle seçilen kategorinin adı (formda saklanır): komisyon ipucu (HB EK.4) ve kayıt
        const manualName = manualCat ? String(p.attributes?.[`${ctx.mp.label} kategori adı`] ?? "").split(" > ").pop() || null : null;
        const catName = manualName ?? pick?.categoryName ?? null;
        const categoryId = manualCat ?? ctx.catMap.get(p.category)?.category_id ?? pick?.categoryId ?? null;
        // Çok varyantlı ürün (beden/renk): varyantlar pazaryerinde tek ürün grubu; "aynı başlık" koruması yalnızca ilk varyantta bakılır
        const vlist = [...(p.product_variants ?? [])].sort((a: any, b: any) => a.position - b.position);
        const multi = vlist.length > 1;
        let titleClaimed = false;
        for (const v of vlist) {
          const key = keyFor(p.source, v);
          if (!key || !CODE_RE.test(key)) { fail(key, p, v, "Barkod yok veya pazaryeri kuralına uymuyor (en fazla 40 karakter, harf/rakam/. _ -)"); continue; }
          if (ctx.existing.has(key)) { rows.push({ marketplace: ctx.marketplaceId, listing_key: key, variant_id: v.id, product_id: p.id, status: ctx.lsBy.get(key)?.status === "pending" ? "pending_approval" : "live", updated_at: now }); continue; }
          if (p.status !== "active") { fail(key, p, v, "Ürün aktif değil (taslak/arşiv)"); continue; }
          if (cheaper) { fail(key, p, v, "Aynı ürünün daha ucuz kopyası var (o gönderilir)"); continue; }
          if (win && win.id !== p.id) { fail(key, p, v, `Tedarikçide aynı ürünün kopyası (kod ${win.sku}): stokta en ucuz olan o, yalnızca o gönderilir`); continue; }
          if (!titleClaimed && ctx.lsTitles.has(normFull(title))) { fail(key, p, v, `${ctx.mp.label}'da aynı başlıklı ürün var (çoklama riski)`); continue; }
          if (!images.length) { fail(key, p, v, "Görsel yok"); continue; }
          const risky = brandRisk?.(p.title, p.description ?? "");
          if (risky) { fail(key, p, v, `Marka riski: başlık/açıklamada "${risky}" geçiyor (marka ihlali uyarısı almamak için gönderilmedi; panel → Markalar → Gönderilmeyen markalar)`); continue; }
          // Tahmin güveni düşükse otomatik seçilmez; en iyi tahmin "öneri" olarak yazılır (panel → Gönderilemeyenler tek tıkla seçer)
          if (needsCategory && !categoryId) { fail(key, p, v, `${ctx.mp.label} kategorisi yok: Kategoriler sekmesinde "${p.category || "kategorisiz"}" eşleştirilmeli${pred?.categoryId ? ` · öneri: ${String(pred.categoryName ?? "").replace(/[\[\]]/g, "")} [${pred.categoryId}] (%${Math.round((pred.confidence ?? 0) * 100)})` : ""}`); continue; }
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
          const pr = priceFor(ctx, p, v, null, avail, manualName ?? (pick && pick !== pred && String(pick.categoryId) === String(categoryId) ? pick.categoryName : null));
          if (!pr.ok) { fail(key, p, v, `Fiyat hesaplanamadı: ${pr.reason}`); continue; }
          const np: NewProduct = {
            ...(() => { const c = ctx.clean ? ctx.clean(title, p.description || p.title) : { title, description: p.description || p.title }; return { name: c.title, detail: c.description }; })(),
            id: key, brand: p.brand ?? "", productCode: p.sku, desi: Number(p.desi) || 1, images,
            cat: { ...(ctx.catMap.get(p.category) ?? {}), category_id: categoryId, vat_rate: Number(p.vat_rate ?? 20) },
            pid: p.id, known: p.attributes ?? {}, catName, xmlCategory: p.category ?? "",
            refs: pred?.refs, defaults: { ...(supDefaults.get(p.source) ?? {}), ...productAttrs(p.attributes, ctx.marketplaceId), ...productAttrs(v.attributes, ctx.marketplaceId) }, groupId: multi ? p.sku : undefined, price: pr.price, qty: avail < ctx.minStock ? 0 : Math.min(avail, 20000), asin,
          };
          // Tedarikçi ürünü: tedarikçi ayarındaki pazaryeri markası; elle girilen ürün: kendi markası (pazaryerinde kayıtlıysa) yoksa mağaza markası
          const fromSupplier = String(p.source ?? "").startsWith("xml:");
          // "*" = her ürün XML'deki kendi markasıyla (tedarikçi markalarını kullanma yetkisi var; K, 25.10 Royal Tedarik)
          const sb = fromSupplier ? supBrand.get(p.source) ?? "" : "";
          const brand = fromSupplier ? (sb === "*" ? String(p.brand ?? "").trim().slice(0, 100) : sb) : (await brandOk(p.brand)) ? p.brand : "";
          if (fromSupplier && !brand) { fail(key, p, v, "Ürünün XML'de markası yok (tedarikçi ayarı: kendi markası)"); continue; }
          if (!groups.has(brand)) groups.set(brand, []);
          groups.get(brand)!.push(np);
          ctx.lsTitles.add(normFull(title)); // aynı başlıklı ikinci ürün (başka tedarikçiden) aynı çalışmada çift ilan açmasın
          titleClaimed = true;
          rows.push({ marketplace: ctx.marketplaceId, listing_key: key, variant_id: v.id, product_id: p.id, status: "sent", title, price: pr.price, stock: np.qty, category_id: categoryId != null ? String(categoryId) : asin ?? null, last_error: null, updated_at: now });
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
        if (r.ok > 0) await rememberLearned(ctx, items, new Set((r.failedItems ?? []).map((f) => f.id)));
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

// Gönderimde başlık/açıklamadan bulunan özellikler ve tahmin edilen kategori ürün kaydına yazılır (yalnızca boş anahtarlar):
// sonraki gönderimlerde ve diğer pazaryerlerinde (Hepsiburada, N11) yeniden aranmaz, panelde (Gönderilemeyenler) düzeltilebilir.
// Kategori numarası yazılmaz (elle seçim sayılırdı); adı "Trendyol kategori adı" olarak durur, diğer pazaryerinin kategori eşleşmesine ipucu olur.
async function rememberLearned(ctx: DbCtx, items: any[], failed: Set<string>) {
  for (const np of items) {
    if (failed.has(np.id) || !np.pid) continue;
    const known = np.known && typeof np.known === "object" && !Array.isArray(np.known) ? np.known : {};
    const add: Record<string, string> = {};
    for (const [k, v] of Object.entries(np.learned ?? {})) if (v && known[k] == null) add[k] = String(v).slice(0, 200);
    if (np.catName && ctx.marketplaceId === "trendyol" && known["Trendyol kategori adı"] == null) add["Trendyol kategori adı"] = String(np.catName).slice(0, 200);
    if (!Object.keys(add).length) continue;
    const { error } = await ctx.db.from("products").update({ attributes: { ...add, ...known } }).eq("id", np.pid);
    if (error) ctx.skip(`özellik kaydı: ${error.message}`);
  }
}

// Gönderim kuyruğu boşalınca, düzeltilebilir yerel hatalar (kategori yok, zorunlu özellik, marka riski) 2 saatte bir yeniden sıraya alınır:
// bu arada öğrenilen özellikler (Trendyol), kategori örnekleri ve kod düzeltmeleri devreye girer. Pazaryerine yazmaz; yalnızca kuyruk.
// Önce "sırada" görünüp işi olmayan ilanlar (kuyruk boşken 1 saatten eski "queued" = takılı), sonra düzeltilebilir hatalar (en eskiden).
// 23.10 hatası: anahtar saate göreydi; aynı saatte ikinci çağrıda iş çakışıp oluşmuyor, ilanlar işsiz "sırada" kalıyordu (HB 8.278, Trendyol 1.360).
// Artık önce iş yazılır, yalnızca yazılan işin ilanları "sırada" yapılır.
export async function requeueFixable(ctx: DbCtx, max = 3000): Promise<{ requeued: number; stale: number; jobs: number } | { skipped: string }> {
  const type = `send_products:${ctx.marketplaceId}`;
  const { count } = await ctx.db.from("jobs").select("id", { count: "exact", head: true }).eq("type", type).in("status", ["queued", "running"]);
  if (count) return { skipped: `kuyrukta ${count} iş var` };
  const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const stale = await ctx.db.from("marketplace_listings").select("listing_key, product_id")
    .eq("marketplace", ctx.marketplaceId).eq("status", "queued").lt("updated_at", hourAgo).not("product_id", "is", null).order("updated_at").limit(max);
  if (stale.error) return { skipped: stale.error.message };
  const picked: { listing_key: string; product_id: string }[] = [...(stale.data ?? [])];
  if (picked.length < max) {
    const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    const { data, error } = await ctx.db.from("marketplace_listings").select("listing_key, product_id, last_error")
      .eq("marketplace", ctx.marketplaceId).eq("status", "error").lt("updated_at", since).not("product_id", "is", null).order("updated_at").limit(max * 2);
    if (error) return { skipped: error.message };
    for (const r of data ?? []) {
      if (picked.length >= max) break;
      if (/kategorisi yok|zorunlu özellik|Marka riski|özellik listesi|görsel hazırlanamadı|görsel yok/i.test(String(r.last_error ?? ""))) picked.push(r);
    }
  }
  if (!picked.length) return { requeued: 0, stale: 0, jobs: 0 };
  const now = new Date().toISOString();
  const byProduct = new Map<string, string[]>();
  for (const r of picked) byProduct.set(r.product_id, [...(byProduct.get(r.product_id) ?? []), r.listing_key]);
  const ids = [...byProduct.keys()];
  let jobs = 0, requeued = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100);
    const { error: je } = await ctx.db.from("jobs").insert({ type, marketplace: ctx.marketplaceId, payload: { product_ids: part }, idempotency_key: `retry:${ctx.marketplaceId}:${now}:${i / 100}`, created_by: "otomatik yeniden deneme" });
    if (je) continue;
    jobs++;
    const keys = part.flatMap((p) => byProduct.get(p) ?? []);
    requeued += keys.length;
    for (let k = 0; k < keys.length; k += 500) await ctx.db.from("marketplace_listings").update({ status: "queued", updated_at: now }).eq("marketplace", ctx.marketplaceId).in("listing_key", keys.slice(k, k + 500));
  }
  return { requeued, stale: stale.data?.length ?? 0, jobs };
}

// Onaylı Trendyol ilanlarının özellikleri ve kategori adı ürün kaydına (yalnızca boş anahtarlar; elle girilen ezilmez).
// Daha önce gönderilmiş ürünler için de geçerli: Hepsiburada/N11 gönderiminde aynı özellikler yeniden çıkarılmaz.
export async function learnFromListings(db: any, marketplace: string, listings: Listing[], max = 4000): Promise<{ checked: number; updated: number; errors: number }> {
  const out = { checked: 0, updated: 0, errors: 0 };
  if (marketplace !== "trendyol") return out;
  const byKey = new Map(listings.filter((l) => l.status !== "closed" && (l.attributes || l.categoryName)).map((l) => [l.id, l]));
  if (!byKey.size) return out;
  const todo: { id: string; attributes: Record<string, unknown> }[] = [];
  for (let last = ""; todo.length < max; ) {
    const { data, error } = await db.from("marketplace_listings").select("listing_key, product_id, products(attributes)")
      .eq("marketplace", marketplace).not("product_id", "is", null).gt("listing_key", last).order("listing_key").limit(1000);
    if (error || !data?.length) break;
    last = (data as any[])[data.length - 1].listing_key;
    for (const r of data as any[]) {
      const l = byKey.get(r.listing_key);
      if (!l || !r.product_id) continue;
      out.checked++;
      const known = r.products?.attributes && typeof r.products.attributes === "object" && !Array.isArray(r.products.attributes) ? r.products.attributes : {};
      const add: Record<string, string> = {};
      for (const [k, v] of Object.entries(l.attributes ?? {})) if (known[k] == null && v) add[k] = String(v).slice(0, 200);
      if (l.categoryName && known["Trendyol kategori adı"] == null) add["Trendyol kategori adı"] = String(l.categoryName).slice(0, 200);
      if (Object.keys(add).length && !todo.some((t) => t.id === r.product_id)) todo.push({ id: r.product_id, attributes: { ...add, ...known } });
      if (todo.length >= max) break;
    }
    if (data.length < 1000) break;
  }
  for (let i = 0; i < todo.length; i += 10) {
    const res = await Promise.all(todo.slice(i, i + 10).map((t) => db.from("products").update({ attributes: t.attributes }).eq("id", t.id)));
    for (const r of res) if (r.error) out.errors++; else out.updated++;
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
