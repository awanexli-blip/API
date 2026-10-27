// Ürün seçimi / fırsat puanı (K, 25.10): Trendyol'da 50 bin ürün sınırı var; tedarikçinin (ör. Royal) ürünlerinden satış potansiyeli yüksek,
// stoğu sağlam, iyi kâr bırakanlar puanlanır ve sıralanır. Pazaryerine hiçbir şey göndermez: panelde (Pazaryeri > Ürün seçimi) incelenip
// onaylananlar gönderim kuyruğuna girer. node --experimental-strip-types worker/opportunity.ts <tedarikçi kodu> [pazaryeri]
// Sinyaller: net kâr (fiyat motoru + kâr kuralları + tahmini kategori komisyonu), tedarikçi stoğu, satış hızı (tedarikçi stok düşüşü,
// migration 051), fiyat bandı, görsel/açıklama, kategori tahmini güveni, marka (tedarikçinin kendi markası mı). Elenenler nedeniyle yazılır.
import { createClient } from "@supabase/supabase-js";
import { calcPrice, cfgFromSettings } from "./pricing.ts";
import { applyRules, rulesFor, type PricingRule } from "./pricing-rules.ts";
import { buildClassifier, type Example } from "./core/classify.ts";
import { loadBrandMatcher } from "./core/brand-risk.ts";
import { env, chunk, normFull, arg, SUPPLIER_ARG, readAll } from "./core/util.ts";

const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));

// Puan bileşenleri (toplam ~100): saf fonksiyon, test edilir
export function scoreOf(x: { net: number; margin: number; stock: number; sold7: number; price: number; images: number; descLen: number; level: string | null; brandOk: boolean; variants: number }) {
  const parts: Record<string, number> = {
    kar: r2(clamp(x.net / 120) * 25),
    marj: r2(clamp(x.margin / 0.3) * 5),
    stok: r2(clamp(Math.log10(Math.max(1, x.stock)) / 3) * 15),
    satis: r2(clamp(Math.log10(x.sold7 + 1) / 2) * 30),
    fiyat: x.price >= 120 && x.price <= 700 ? 10 : x.price > 700 && x.price <= 1500 ? 6 : x.price < 120 ? 4 : 2,
    icerik: (x.images >= 3 ? 5 : x.images >= 2 ? 3 : 0) + (x.descLen >= 150 ? 3 : 0),
    kategori: x.level === "yuksek" ? 7 : x.level === "orta" ? 4 : x.level === "dusuk" ? 0 : -5,
    marka: x.brandOk ? 0 : -10,
    varyant: x.variants > 1 ? 2 : 0,
  };
  return { score: r2(Object.values(parts).reduce((t, v) => t + v, 0)), parts };
}

async function main() {
  const code = arg(process.argv[2], "royal", SUPPLIER_ARG, "tedarikçi");
  const mp = process.argv[3] ?? "trendyol";
  if (!/^[a-z]+$/.test(mp)) throw new Error("geçersiz pazaryeri");
  const source = `xml:${code}`;
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

  // Ayarlar (Trendyol = settings; diğerleri settings + marketplace_settings) ve kâr kuralları
  const { data: base } = await db.from("settings").select("*").eq("id", 1).single();
  let s: any = base;
  if (mp !== "trendyol") { const { data: ms } = await db.from("marketplace_settings").select("*").eq("marketplace", mp).maybeSingle(); s = { ...base }; for (const [k, v] of Object.entries(ms ?? {})) if (v != null) s[k] = v; }
  const cfg = cfgFromSettings(s, Number(s.vat_rate ?? 20));
  const pr = await readAll((a, b) => db.from("pricing_rules").select("*").order("id").range(a, b));
  const rules = rulesFor((pr.data ?? []) as PricingRule[], mp);

  // Kategori/komisyon tahmini: pazaryerindeki kabul edilmiş ilanlardan; mağazadaki başlıklar (çoklama elemesi)
  const examples: Example[] = [];
  const titles = new Set<string>();
  for (let last = ""; ; ) {
    const { data, error } = await db.from("marketplace_listings").select("listing_key, title, status, category_id, category_name, commission").eq("marketplace", mp).neq("status", "gone").gt("listing_key", last).order("listing_key").limit(1000);
    if (error || !data?.length) break;
    for (const l of data as any[]) {
      if (l.title) titles.add(normFull(l.title));
      if (l.category_id && l.title && ["live", "closed", "pending_approval"].includes(l.status)) examples.push({ title: l.title, xmlCategory: l.category_name ?? "", categoryId: String(l.category_id), categoryName: l.category_name ?? "", commission: l.commission != null ? Number(l.commission) : undefined });
    }
    last = data[data.length - 1].listing_key;
    if (data.length < 1000) break;
  }
  const predict = examples.length >= 50 ? buildClassifier(examples) : null;
  const brandRisk = mp === "hepsiburada" ? null : await loadBrandMatcher(db);
  const ownBrand = (b: string) => new RegExp(process.env.OWN_BRANDS ?? "royal", "i").test(b);

  // Satış hızı (son 7 gün tedarikçi stok düşüşü)
  const sold = new Map<string, number>();
  const vel = await readAll((a, b) => db.rpc("stock_velocity", { p_source: source, p_days: 7 }).order("product_id").range(a, b));
  for (const r of (vel.data ?? []) as any[]) sold.set(r.product_id, Number(r.sold));
  const velDays = Math.max(0, ...((vel.data ?? []) as any[]).map((r) => Number(r.days)));

  const rows: any[] = [];
  const stat: Record<string, number> = {};
  for (let last = "00000000-0000-0000-0000-000000000000"; ; ) {
    const { data, error } = await db.from("products").select("id, title, description, brand, category, cost_price, status, product_variants(stock, reserved), product_images(id)")
      .eq("source", source).gt("id", last).order("id").limit(500);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const p of data as any[]) {
      const stock = (p.product_variants ?? []).reduce((t: number, v: any) => t + Math.max(0, Number(v.stock ?? 0) - Number(v.reserved ?? 0)), 0);
      const images = (p.product_images ?? []).length, variants = (p.product_variants ?? []).length;
      const cost = Number(p.cost_price);
      const pred = predict ? predict(p.title, p.category ?? "") : null;
      const comm = pred?.commission ?? cfg.commissionRate;
      const pcfg = applyRules(cfg, rules, { cost, supplier: code, category: p.category, brand: p.brand, stock }).cfg;
      const price = cost > 0 ? calcPrice(cost, pcfg, comm) : null;
      const risky = brandRisk?.(p.title, p.description ?? "");
      const brandOk = ownBrand(String(p.brand ?? ""));
      const excluded = p.status !== "active" ? "pasif ürün" : !(cost > 0) ? "maliyet yok" : stock < 10 ? "stok az (10'dan az)" : !images ? "görsel yok"
        : titles.has(normFull(p.title)) ? "mağazada aynı başlık var" : risky ? `marka riski (${risky})` : !price?.ok ? `fiyat: ${price?.reason ?? "hesaplanamadı"}` : null;
      const net = price?.ok ? price.netProfit : 0, margin = price?.ok ? price.profitRate : 0;
      const sc = scoreOf({ net, margin, stock, sold7: sold.get(p.id) ?? 0, price: price?.ok ? price.price : 0, images, descLen: String(p.description ?? "").length, level: pred?.level ?? null, brandOk, variants });
      if (excluded) stat[excluded.replace(/ \(.*$/, "")] = (stat[excluded.replace(/ \(.*$/, "")] ?? 0) + 1;
      rows.push({ marketplace: mp, product_id: p.id, source, score: excluded ? null : sc.score, price: price?.ok ? price.price : null, net: price?.ok ? r2(net) : null, margin, commission: comm,
        stock, sold7: sold.get(p.id) ?? 0, variants, images, category_id: pred?.categoryId ?? null, category_name: pred?.categoryName ?? null, confidence: pred ? r2(pred.confidence) : null,
        brand: p.brand ?? null, brand_ok: brandOk, excluded, reasons: sc.parts, computed_at: new Date().toISOString() });
    }
    last = data[data.length - 1].id;
    if (data.length < 500) break;
  }
  let errors = 0;
  for (const part of chunk(rows, 500)) { const { error } = await db.from("product_opportunity").upsert(part, { onConflict: "marketplace,product_id" }); if (error) { errors++; console.error(error.message.slice(0, 200)); } }
  const ok = rows.filter((r) => !r.excluded);
  console.log(JSON.stringify({ source, marketplace: mp, products: rows.length, candidates: ok.length, excluded: stat, velocityDays: velDays, examples: examples.length, errors,
    top: ok.sort((a, b) => b.score - a.score).slice(0, 5).map((r) => ({ score: r.score, net: r.net, price: r.price, stock: r.stock })) }, null, 1));
  if (errors) process.exitCode = 1;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("worker/opportunity.ts")) await main();
