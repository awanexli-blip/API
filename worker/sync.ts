// node --experimental-strip-types worker/sync.ts <preview|update|create|auto> [pazaryeri]
//  preview : fiyatları hesaplar, preview.csv yazar, pazaryerine yazmaz
//  update  : mevcut ürünlerin stok (+ ayara göre fiyat) güncellemesi
//  create  : pazaryerinde olmayan ürünleri açar
//  auto    : zamanlanmış çalışma -> update (+ ayar açıksa create)
// Pazaryeri: 2. argüman veya MARKETPLACE ortam değişkeni (varsayılan trendyol).
// Pazaryerine özgü her şey worker/marketplaces/<ad>.ts içindedir.

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { calcPrice, existingPrice, breakdown, type PricingConfig } from "./pricing.ts";
import { env, chunk, num, normTitle } from "./core/util.ts";
import { loadXml } from "./core/xml.ts";
import { buildClassifier, type Example } from "./core/classify.ts";
import { getMarketplace } from "./marketplaces/index.ts";
import type { InventoryItem, NewProduct } from "./marketplaces/types.ts";

const mode = process.argv[2] ?? "preview";
const marketplaceId = process.argv[3] ?? process.env.MARKETPLACE ?? "trendyol";
const trigger = process.env.TRIGGER ?? "manual";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
// Trendyol dosya adı eskisi gibi kalır (panel/CLAUDE.md buna atıfta bulunuyor)
const previewFile = marketplaceId === "trendyol" ? "preview.csv" : `preview_${marketplaceId}.csv`;
// Migration 002 (marketplace kolonları) çalıştırıldı mı? Çalıştırılmadıysa Trendyol eskisi gibi filtresiz okur/yazar.
let mpColumns = true;

// Pazaryerine ait satırlar (category_map, product_overrides)
async function mpRows(table: string): Promise<any[]> {
  const r = await db.from(table).select("*").eq("marketplace", marketplaceId);
  if (!r.error) return r.data ?? [];
  if (marketplaceId !== "trendyol") throw new Error(`${table} okunamadı. Supabase migration 002 çalıştırıldı mı? (${r.error.message})`);
  mpColumns = false;
  return (await db.from(table).select("*")).data ?? [];
}

// Ortak ayarlar (settings) + pazaryerine özel ayarlar (marketplace_settings, dolu alanlar ezer)
async function loadSettings(): Promise<any> {
  const { data: base, error } = await db.from("settings").select("*").eq("id", 1).single();
  if (error || !base) throw new Error("Ayarlar okunamadı: " + error?.message);
  if (marketplaceId === "trendyol") return base;
  const { data: ms, error: me } = await db.from("marketplace_settings").select("*").eq("marketplace", marketplaceId).maybeSingle();
  if (me) {
    if (trigger === "schedule") return { ...base, enabled: false }; // migration öncesi zamanlı çalışma sessizce atlanır
    throw new Error(`marketplace_settings okunamadı. Supabase migration 002 çalıştırıldı mı? (${me.message})`);
  }
  if (!ms) return { ...base, enabled: false };
  const merged: any = { ...base };
  for (const [k, v] of Object.entries(ms)) if (v != null) merged[k] = v;
  return merged;
}

async function main() {
  const s = await loadSettings();
  if (s.enabled === false) return { skippedRun: `${marketplaceId} panelde kapalı` };
  if (mode === "auto" && trigger === "schedule" && !s.auto_sync) {
    return { skippedRun: "otomatik senkronizasyon kapalı" };
  }
  // Kimlik bilgileri tanımlı değilse zamanlanmış çalışma sessizce atlanır, elle çalıştırmada hata verir
  let mp;
  try { mp = getMarketplace(marketplaceId); }
  catch (e: any) { if (trigger === "schedule") return { skippedRun: e.message }; throw e; }
  const doUpdate = mode === "update" || mode === "auto";
  const doCreate = mode === "create" || (mode === "auto" && s.auto_create);

  const cfg = {
    commissionRate: Number(s.commission_rate), targetProfitRate: Number(s.target_profit_rate),
    shippingCost: Number(s.shipping_cost), freeShippingThreshold: Number(s.free_shipping_threshold),
    minMarkup: Number(s.min_markup), fixedCost: Number(s.fixed_cost),
    minAcceptableProfitRate: Number(s.min_acceptable_profit_rate), maxPrice: Number(s.max_price),
    commissionPlusVat: s.commission_plus_vat === true, shippingVatIncluded: s.shipping_vat_included !== false,
  };
  // Kargo: sabit tutar veya desi tarifesi (pazaryeri adaptörü sağlar)
  const byDesi = s.shipping_mode === "desi" && !!mp.shippingCost;
  const defaultDesi = Number(s.default_desi ?? 2);
  const defaultVat = Number(s.vat_rate ?? 20) / 100;
  const vatCount: Record<string, number> = {};
  const fx: Record<string, number> = { TL: 1, TRY: 1, USD: Number(s.fx_usd), EUR: Number(s.fx_eur) };
  const minStock = Number(s.min_stock);

  const catMap = new Map<string, any>((await mpRows("category_map")).map((c: any) => [c.xml_category, c]));
  const ovMap = new Map<string, any>((await mpRows("product_overrides")).map((o: any) => [o.barcode, o]));

  const raw = await loadXml();
  {
    const c = (v: any) => String(v ?? "").replace(/;/g, ",").replace(/\r?\n/g, " ");
    const dump = ["barcode;productCode;brand;category;quantity;price;currency;name"];
    for (const r of raw) dump.push([r.barcode, r.productCode, r.brand, r.category, r.quantity, r.price, r.currency, String(r.name ?? "").slice(0, 120)].map(c).join(";"));
    writeFileSync("xml_dump.csv", "﻿" + dump.join("\n"), "utf8");
  }
  const listings = await mp.loadListings();
  const existing = new Set<string>(listings.map((l) => l.id));
  const lsBy = new Map(listings.map((l) => [l.id, l]));
  const lsTitles = new Set<string>(listings.map((l) => normTitle(l.title)).filter(Boolean));
  const linked = new Set<string>();

  // Yeni ürün kategori/komisyon tahmini: mağazadaki eşleşmiş ilanlar örnek (başlık + XML kategorisi -> pazaryeri kategorisi)
  const examples: Example[] = [];
  for (const r of raw) {
    const l = lsBy.get(mp.findListing(r, existing) ?? "");
    if (l?.categoryId && l.status !== "pending") examples.push({ title: l.title || String(r.name ?? ""), xmlCategory: String(r.category ?? ""), categoryId: l.categoryId, categoryName: l.categoryName ?? "", commission: l.commission });
  }
  const predict = examples.length >= 50 ? buildClassifier(examples) : null;
  const predCount: Record<string, number> = {};
  // Mevcut ürünlerde fiyat politikası: keep = fiyata dokunma, floor = sadece formülün altındaysa yükselt, formula = formüle eşitle
  const policy: string = s.update_prices === false ? "keep" : String(s.existing_price_policy ?? "floor");
  console.log(`XML: ${raw.length} ürün | ${mp.label}'da: ${existing.size}`);

  const skipped: Record<string, number> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  const csv: string[] = ["barcode;name;category;maliyet;satis;kargoSende;netKar;kar%;durum"];
  const q = (v: any) => String(v ?? "").replace(/;/g, ",").replace(/\r?\n/g, " ");

  const toUpdate: InventoryItem[] = [];
  const toCreate: NewProduct[] = [];
  const unmapped = new Map<string, number>();
  // XML kategorisi -> tahmin edilen pazaryeri kategorileri (panelde öneri)
  const suggest = new Map<string, Map<string, { name: string; n: number; comm: number }>>();
  const commCount: Record<string, number> = {};
  const priceMoves: Record<string, number> = {};

  for (const r of raw) {
    const barcode = String(r.barcode ?? "").trim();
    const name = String(r.name ?? "");
    const category = String(r.category ?? "");
    const currency = String(r.currency ?? "TL").toUpperCase();
    if (!barcode) { skip("barkod yok"); continue; }

    const rate = fx[currency];
    const cost = num(r.price) * (rate || 0);
    const cat = catMap.get(category);
    const listingId = mp.findListing(r, existing);
    const ov = ovMap.get(barcode) ?? (listingId ? ovMap.get(listingId) : undefined);
    const isExisting = !!listingId;

    if (!rate) { skip(`kur yok: ${currency}`); csv.push(`${barcode};${q(name)};${q(category)};${r.price};;;;;ATLANDI: kur yok`); continue; }
    let { rate: comm, source: commSource } = mp.commission(listingId, category, cat?.commission_rate != null ? Number(cat.commission_rate) : null, cfg.commissionRate);
    // Yeni ürün: panelde kategori oranı yoksa benzer ilanların komisyonu (aynı tahmini kategorideki en yüksek oran)
    const pred = !listingId && predict ? predict(name, category) : null;
    if (pred) predCount[pred.level] = (predCount[pred.level] ?? 0) + 1;
    if (pred?.commission != null && pred.level !== "dusuk" && commSource !== "panel") { comm = pred.commission; commSource = "tahmin"; }
    commCount[commSource] = (commCount[commSource] ?? 0) + 1;
    // KDV: pazaryerindeki ilanın oranı > panel kategori oranı > varsayılan
    const lsVat = listingId ? Number(lsBy.get(listingId)?.vatRate) : NaN;
    const vatRate = lsVat > 0 ? lsVat / 100 : cat?.vat_rate != null ? Number(cat.vat_rate) / 100 : defaultVat;
    vatCount[String(Math.round(vatRate * 100))] = (vatCount[String(Math.round(vatRate * 100))] ?? 0) + 1;
    const desi = Math.max(1, Math.ceil(num(r.desi) || defaultDesi));
    const pcfg: PricingConfig = { ...cfg, vatRate, ...(byDesi ? { shippingCost: mp.shippingCost!(desi, s.cargo_carrier) } : {}) };
    const calc = calcPrice(cost, pcfg, comm);

    let price: number, sellerPays = false, net = 0, rateOut = 0;
    if (ov?.price_override) {
      price = Number(ov.price_override);
      const b = breakdown(price, cost, pcfg, comm);
      net = b.net; rateOut = b.rate; sellerPays = b.shipping > 0;
    } else if (!calc.ok) {
      skip(calc.reason ?? "fiyat hesaplanamadı");
      csv.push(`${barcode};${q(name)};${q(category)};${r.price};;;;;ATLANDI: ${calc.reason}`);
      continue;
    } else { price = calc.price; sellerPays = calc.sellerPaysShipping; net = calc.netProfit; rateOut = calc.profitRate; }

    const qty = num(r.quantity);
    const hidden = !!ov?.hidden;
    const images: string[] = Array.from({ length: 12 }, (_, i) => r[`image${i + 1}`]).filter(Boolean).map(String);

    if (isExisting) {
      const lid = listingId as string;
      if (linked.has(lid)) { skip("XML'de tekrar eden ürün kodu"); continue; }
      linked.add(lid);
      const ls = lsBy.get(lid);
      const curPrice = Number(ls?.price);
      const known = Number.isFinite(curPrice);
      if (ls?.status === "pending") {
        skip(`${mp.label}'da onay bekliyor/reddedildi`);
        csv.push(`${lid};${q(name)};${q(category)};${r.price};;;;;ATLANDI: ${mp.label}'da onay bekliyor/reddedildi`);
        continue;
      }
      if ((ls?.status === "closed" || (known && curPrice <= 0)) && !ov?.price_override) {
        skip(`${mp.label}'da kapalı/fiyatsız ürün`);
        csv.push(`${lid};${q(name)};${q(category)};${r.price};;;;;ATLANDI: ${mp.label}'da kapalı/fiyatsız`);
        continue;
      }
      const sendPrice: number | null = ov?.price_override ? price : existingPrice(policy, curPrice, price, pcfg, comm);
      const change = sendPrice == null ? "fiyat korunur" : !known ? "yeni fiyat" : sendPrice > curPrice + 0.005 ? "artacak" : sendPrice < curPrice - 0.005 ? "düşecek" : "aynı";
      priceMoves[change] = (priceMoves[change] ?? 0) + 1;
      toUpdate.push({ id: lid, price: sendPrice, quantity: hidden || qty < minStock ? 0 : Math.min(Math.floor(qty), 20000) });
      // Kâr sütunları satışta geçerli olacak fiyata göre (formül fiyatına göre değil)
      const eff = sendPrice ?? curPrice;
      const eb = breakdown(eff, cost, pcfg, comm);
      csv.push(`${lid};${q(name)};${q(category)};${r.price};${known || sendPrice != null ? eff : ""};${eb.shipping ? "evet" : "hayir"};${eb.net.toFixed(2)};${(eb.rate * 100).toFixed(1)};MEVCUT (${change}; formül ${price}; eski ${known ? curPrice : "-"})`);
      continue;
    }

    // Yeni ürün: önce aynı başlıklı ürün mağazada var mı (çoklama riski)
    if (lsTitles.has(normTitle(name))) { skip(`${mp.label}'da aynı başlık var (çoklama riski)`); csv.push(`${barcode};${q(name)};${q(category)};${r.price};${price};;;;ATLANDI: aynı başlık ${mp.label}'da var`); continue; }
    // kategori eşleşmesi, resim ve stok şart
    // Kategori: panel eşleşmesi > yüksek güvenli tahmin. Orta/düşük güvenli tahmin elle onay bekler.
    const guess = pred ? ` (tahmin: ${pred.categoryName} #${pred.categoryId}, ${pred.level}, en benzer: ${q(pred.nearest).slice(0, 60)})` : "";
    const categoryId = cat?.category_id ?? (pred?.level === "yuksek" ? pred.categoryId : null);
    if (pred && pred.level !== "dusuk") {
      let m = suggest.get(category); if (!m) suggest.set(category, (m = new Map()));
      const e = m.get(pred.categoryId) ?? { name: pred.categoryName, n: 0, comm: 0 };
      e.n++; e.comm = Math.max(e.comm, pred.commission ?? 0); m.set(pred.categoryId, e);
    }
    if (!categoryId) { unmapped.set(category, (unmapped.get(category) ?? 0) + 1); skip(pred ? `kategori belirsiz (${pred.level} güven)` : "kategori eşleşmemiş"); csv.push(`${barcode};${q(name)};${q(category)};${r.price};${price};;;;ATLANDI: kategori${guess || " eşleşmemiş"}`); continue; }
    if (!images.length) { skip("resim yok"); csv.push(`${barcode};${q(name)};${q(category)};${r.price};${price};;;;ATLANDI: resim yok`); continue; }
    if (hidden || qty < minStock) { skip("stok yok / gizli"); csv.push(`${barcode};${q(name)};${q(category)};${r.price};${price};;;;ATLANDI: stok yok`); continue; }
    const newId = mp.newListingId(r);
    toCreate.push({ id: newId, name, detail: String(r.detail ?? ""), brand: String(r.brand ?? ""), productCode: String(r.productCode ?? barcode), desi: num(r.desi) || 1, images, cat: { ...(cat ?? {}), category_id: categoryId }, price, qty });
    csv.push(`${newId};${q(name)};${q(category)};${r.price};${price};${sellerPays ? "evet" : "hayir"};${net.toFixed(2)};${(rateOut * 100).toFixed(1)};YENI${cat?.category_id ? "" : guess}`);
  }

  // BOM'lu UTF-8: Excel'de Türkçe karakterler bozulmasın
  writeFileSync(previewFile, "﻿" + csv.join("\n"), "utf8");

  const matched = linked.size;
  const summary: any = {
    marketplace: mp.id,
    xml: raw.length, listings: existing.size, [mp.id]: existing.size, matched, policy, priceMoves, commissionSource: commCount, vatRates: vatCount, categoryPrediction: { examples: examples.length, ...predCount },
    update: toUpdate.length, create: toCreate.length, skipped,
    updated: 0, created: 0, zeroed: 0, failedBatches: 0, batchIds: [] as string[],
  };
  Object.assign(summary, mp.diagnostics?.(raw, matched));
  summary.sampleXml = raw.slice(0, 3).map((r) => ({ barcode: r.barcode, productCode: r.productCode, name: String(r.name ?? "").slice(0, 60) }));

  // Eşleşmeyen kategoriler panelde görünsün
  if (mpColumns) await db.from("unmapped_categories").delete().eq("marketplace", marketplaceId);
  else await db.from("unmapped_categories").delete().neq("xml_category", "");
  const um = [...unmapped].map(([xml_category, product_count]) => {
    const base: any = mpColumns ? { marketplace: marketplaceId, xml_category, product_count } : { xml_category, product_count };
    const votes = [...(suggest.get(xml_category) ?? new Map())].sort((a, b) => b[1].n - a[1].n);
    const total = votes.reduce((t, [, v]) => t + v.n, 0);
    if (mpColumns && votes.length) Object.assign(base, { suggested_category_id: Number(votes[0][0]), suggested_category_name: votes[0][1].name, suggested_share: Math.round((votes[0][1].n / total) * 100) / 100, suggested_commission: votes[0][1].comm || null });
    return base;
  });
  for (const part of chunk(um, 500)) {
    const { error } = await db.from("unmapped_categories").insert(part);
    // öneri kolonları yoksa (eski şema) önerisiz yaz
    if (error) await db.from("unmapped_categories").insert(part.map(({ suggested_category_id, suggested_category_name, suggested_share, suggested_commission, ...rest }: any) => rest));
  }

  if (doUpdate) {
    const r = await mp.pushInventory(toUpdate);
    summary.updated += r.ok; summary.failedBatches += r.failed; summary.batchIds.push(...r.batchIds);

    // XML'den kalkan ürünler: yalnızca eşleşme güvenilirse stoğu sıfırla
    if (s.zero_missing) {
      if (existing.size && matched / existing.size >= 0.5) {
        // Yalnızca satıştaki ilanlar: kapalı/onay bekleyen ilana stok gönderilemez (Trendyol hata verir)
        const gone = listings.filter((l) => !linked.has(l.id) && (l.status ?? "active") === "active" && !(l.quantity === 0)).map((l) => l.id);
        const z = await mp.zeroStock(gone);
        summary.zeroed += z.ok; summary.failedBatches += z.failed; summary.batchIds.push(...z.batchIds);
      } else {
        summary.zeroMissingSkipped = `${mp.label} ilanlarının yarısından azı XML ile eşleşti, güvenlik için çalıştırılmadı`;
      }
    }
  }

  const weakMatch = existing.size > 1000 && matched / existing.size < 0.5;
  if (doCreate && weakMatch) {
    summary.createBlocked = `${mp.label} ürünlerinin yarısından azı XML ile eşleşti. Aynı ürünleri ikinci kez açmamak için yeni ürün açma durduruldu.`;
  }
  if (doCreate && !weakMatch && toCreate.length) {
    // Deneme için adet sınırı (workflow girdisi "limit", elle tetiklemede varsayılan 50)
    const limit = Number(process.env.CREATE_LIMIT || 0);
    const batch = limit > 0 ? toCreate.slice(0, limit) : toCreate;
    if (batch.length < toCreate.length) summary.createLimited = `${toCreate.length} üründen ilk ${batch.length} tanesi açıldı (limit)`;
    const r = await mp.createProducts(batch, { vatRate: Number(s.vat_rate), skip });
    summary.created += r.ok; summary.failedBatches += r.failed; summary.batchIds.push(...r.batchIds);
  }

  if (summary.batchIds.length && mp.checkBatches) {
    summary.batchCheck = await mp.checkBatches(summary.batchIds);
  }
  summary.batchIds = summary.batchIds.slice(0, 20);
  return summary;
}

(async () => {
  let { data: run, error } = await db.from("sync_runs").insert({ mode, trigger, status: "running", marketplace: marketplaceId }).select("id").single();
  if (error) ({ data: run } = await db.from("sync_runs").insert({ mode, trigger, status: "running" }).select("id").single()); // migration 002 öncesi
  const id = run?.id as number;
  try {
    const summary: any = await main();
    const status = summary.skippedRun ? "skipped" : summary.failedBatches > 0 || summary.batchCheck?.failedItems > 0 ? "partial" : "ok";
    await db.from("sync_runs").update({ status, finished_at: new Date().toISOString(), summary }).eq("id", id);
    console.log(JSON.stringify(summary, null, 1));
  } catch (e: any) {
    console.error(e);
    await db.from("sync_runs").update({ status: "error", finished_at: new Date().toISOString(), error: String(e.message ?? e).slice(0, 1000) }).eq("id", id);
    process.exit(1);
  }
})();
