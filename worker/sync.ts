// node --experimental-strip-types worker/sync.ts <preview|update|create|auto> [pazaryeri]
//  preview : fiyatları hesaplar, preview.csv yazar, pazaryerine yazmaz
//  update  : mevcut ürünlerin stok (+ ayara göre fiyat) güncellemesi
//  create  : pazaryerinde olmayan ürünleri açar
//  auto    : zamanlanmış çalışma -> update (+ ayar açıksa create)
// Pazaryeri: 2. argüman veya MARKETPLACE ortam değişkeni (varsayılan trendyol).
// Pazaryerine özgü her şey worker/marketplaces/<ad>.ts içindedir.

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { bandsFrom, calcPrice, existingPriceSafe, breakdown, type PricingConfig } from "./pricing.ts";
import { applyRules, rulesFor, type PricingRule } from "./pricing-rules.ts";
import { snapshotListings, type ListingCalc } from "./core/listings.ts";
import { dbInventory, learnFromListings, requeueFixable, processMatchJobs, processSendJobs, type DbCtx } from "./core/db-products.ts";
import { cleanForMarketplace, planFix, type FixRow } from "./core/rejections.ts";
import { recordBatches, applyStates, refreshBatches } from "./core/mp-status.ts";
import { syncOrders } from "./core/orders.ts";
import { syncInbox, notifyOrders } from "./core/inbox.ts";
import { fixImages } from "./core/image-fix.ts";
import { env, chunk, num, normTitle, normFull, csvCell, arg, MODES, MARKETPLACES } from "./core/util.ts";
import { loadXml } from "./core/xml.ts";
import { retireLegacy } from "./core/retire.ts";
import { buildClassifier, type Example } from "./core/classify.ts";
import { buildLeafMatcher } from "./core/category-tree.ts";
import { getMarketplace } from "./marketplaces/index.ts";
import type { InventoryItem, NewProduct } from "./marketplaces/types.ts";

const mode = arg(process.argv[2], "preview", MODES, "mod");
const marketplaceId = arg(process.argv[3] ?? process.env.MARKETPLACE, "trendyol", MARKETPLACES, "pazaryeri");
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
  // Pazaryerine özel anahtarlar ortak ayardan miras alınmaz (Trendyol'da satışı durdurmak Hepsiburada'yı durdurmamalı)
  merged.sales_paused = ms.sales_paused === true;
  // retire_legacy ortaktır: eski tedarikçi (BayilikXML) XML'i hiçbir pazaryerinde okunmaz; kaldırma, adaptör destekliyorsa yapılır
  return merged;
}

async function main() {
  const s = await loadSettings();
  if (s.enabled === false) return { skippedRun: `${marketplaceId} panelde kapalı` };
  // Satış durduruldu (panel): otomatik senkron kapalı olsa da çalışır; satıştaki her ilana stok 0, başka hiçbir şey yapılmaz
  const paused = s.sales_paused === true && mode !== "preview";
  if (!paused && mode === "auto" && trigger === "schedule" && !s.auto_sync) {
    return { skippedRun: "otomatik senkronizasyon kapalı" };
  }
  // Kimlik bilgileri tanımlı değilse zamanlanmış çalışma sessizce atlanır, elle çalıştırmada hata verir
  let mp;
  try { mp = getMarketplace(marketplaceId); }
  catch (e: any) { if (trigger === "schedule") return { skippedRun: e.message }; throw e; }
  if (paused) {
    const listings = await mp.loadListings();
    const ids = listings.filter((l) => (l.status ?? "active") === "active" && l.quantity !== 0).map((l) => l.id);
    const z = ids.length ? await mp.zeroStock(ids) : { ok: 0, failed: 0, batchIds: [] as string[] };
    const summary: any = { marketplace: mp.id, salesPaused: true, listings: listings.length, zeroed: z.ok, failedBatches: z.failed, batchIds: z.batchIds, updated: 0, created: 0 };
    if (s.retire_legacy) summary.retire = await retireLegacy(db, mp, marketplaceId, listings).catch((e: any) => ({ error: String(e?.message ?? e) }));
    if (z.batchIds.length && mp.checkBatches) summary.batchCheck = await mp.checkBatches(z.batchIds.slice(0, 40)).catch((e: any) => ({ error: String(e?.message ?? e) }));
    summary.listingsTable = await snapshotListings(db, marketplaceId, listings).catch((e: any) => ({ error: String(e?.message ?? e) }));
    return summary;
  }
  const doUpdate = mode === "update" || mode === "auto";
  const doCreate = mode === "create" || (mode === "auto" && s.auto_create);

  const cfg = {
    commissionRate: Number(s.commission_rate), targetProfitRate: Number(s.target_profit_rate),
    shippingCost: Number(s.shipping_cost), freeShippingThreshold: Number(s.free_shipping_threshold),
    minMarkup: Number(s.min_markup), fixedCost: Number(s.fixed_cost),
    returnRate: Number(s.return_rate ?? 0), returnCost: Number(s.return_cost ?? 0), squeezeMinNet: s.squeeze_min_net != null ? Number(s.squeeze_min_net) : null, multiUnitMinNet: s.multi_unit_min_net != null ? Number(s.multi_unit_min_net) : null, netProfitMin: s.net_profit_min != null ? Number(s.net_profit_min) : null, netProfitMax: s.net_profit_max != null ? Number(s.net_profit_max) : null, 
    minAcceptableProfitRate: Number(s.min_acceptable_profit_rate), maxPrice: Number(s.max_price),
    commissionPlusVat: s.commission_plus_vat === true, shippingVatIncluded: s.shipping_vat_included !== false,
    shippingBands: bandsFrom(s.shipping_bands),
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
  // Akıllı kâr kuralları (panel: Kâr kuralları). Tablo yoksa (migration 010 öncesi) kuralsız devam
  const pr = await db.from("pricing_rules").select("*");
  const rules = rulesFor((pr.error ? [] : pr.data ?? []) as PricingRule[], marketplaceId);
  const ruleCount: Record<string, number> = {};

  // Yasaklı kelimeler (Trendyol ret nedenlerinden öğrenilir + elle eklenenler); yeni ürün metinleri gönderimden önce temizlenir
  const bw = await db.from("banned_words").select("word").eq("marketplace", marketplaceId);
  const banned: string[] = (bw.error ? [] : bw.data ?? []).map((r: any) => r.word);
  const clean = (title: string, description: string) => (marketplaceId === "trendyol" ? cleanForMarketplace(title, description, banned) : { title, description });

  // Eski tedarikçi (BayilikXML) kaldırıldıysa XML okunmaz; ilanları arşivlenip silinir (aşağıda)
  const raw = s.retire_legacy ? [] : await loadXml();
  {
    const c = csvCell;
    const dump = ["barcode;productCode;brand;category;quantity;price;currency;name"];
    for (const r of raw) dump.push([r.barcode, r.productCode, r.brand, r.category, r.quantity, r.price, r.currency, String(r.name ?? "").slice(0, 120)].map(c).join(";"));
    writeFileSync("xml_dump.csv", "﻿" + dump.join("\n"), "utf8");
  }
  const listings = await mp.loadListings();
  const retireRes = s.retire_legacy && (doUpdate || mode === "create") ? await retireLegacy(db, mp, marketplaceId, listings).catch((e: any) => ({ error: String(e?.message ?? e) })) : null;
  const existing = new Set<string>(listings.map((l) => l.id));
  const lsBy = new Map(listings.map((l) => [l.id, l]));
  // Çoklama koruması: yalnızca açık ilanlar (kapalı/arşiv ve kaldırılan eski tedarikçi ilanları sayılmaz), tam başlık
  const lsTitles = new Set<string>(listings.filter((l) => l.status !== "closed" && !(s.retire_legacy && /^(ÖS13|OS13)-/.test(l.id))).map((l) => normFull(l.title)).filter(Boolean));
  const linked = new Set<string>();

  // Yeni ürün kategori/komisyon tahmini: mağazadaki eşleşmiş ilanlar örnek (başlık + XML kategorisi -> pazaryeri kategorisi)
  const examples: Example[] = [];
  for (const r of raw) {
    const l = lsBy.get(mp.findListing(r, existing) ?? "");
    if (l?.categoryId && l.status !== "pending") examples.push({ title: l.title || String(r.name ?? ""), xmlCategory: String(r.category ?? ""), categoryId: l.categoryId, categoryName: l.categoryName ?? "", commission: l.commission, ref: l.id });
  }
  // XML yoksa (eski tedarikçi kaldırıldı): örnekler ilan tablosundan (arşivlenip silinen ilanların kategorileri de öğrenme verisi olarak kalır).
  // Kategori adı örneğin "XML kategorisi" yerine geçer: tedarikçi alt kategorisi ("Eğitici Oyuncak") Trendyol kategori adıyla eşleşsin
  if (!raw.length) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("marketplace_listings").select("listing_key, title, category_id, category_name, commission").eq("marketplace", marketplaceId).not("category_id", "is", null).range(from, from + 999);
      if (error || !data) break;
      for (const l of data as any[]) if (l.title) examples.push({ title: l.title, xmlCategory: l.category_name ?? "", categoryId: String(l.category_id), categoryName: l.category_name ?? "", commission: l.commission ?? undefined, ref: l.listing_key });
      if (data.length < 1000) break;
    }
  }
  const predict = examples.length >= 50 ? buildClassifier(examples) : null;
  // Trendyol kategori ağacı (herkese açık uç): başlıktan kategori, sınıflandırıcı emin değilse son çare
  let leafMatch: DbCtx["leafMatch"] = null, leafInfo: number | string | null = null;
  if (mp.categoryLeaves && process.env.CATEGORY_TREE_URL !== "off") {
    try {
      const leaves = await mp.categoryLeaves();
      if (leaves.length) leafMatch = buildLeafMatcher(leaves, new Set(examples.map((e) => e.categoryId)));
      leafInfo = leaves.length;
    } catch (e: any) { console.error("kategori ağacı alınamadı:", e.message); leafInfo = "hata: " + String(e.message).slice(0, 300); }
  }

  // Panelde ID yerine ad görünsün: adı boş eşleşmelere ilanlardaki kategori adını yaz (migration 004 yoksa sessizce geç)
  const catNames = new Map<string, string>();
  for (const l of listings) if (l.categoryId && l.categoryName) catNames.set(String(l.categoryId), l.categoryName);
  const named = [...catMap.values()].filter((c) => !c.category_name && catNames.has(String(c.category_id)));
  for (const c of named) {
    let u = db.from("category_map").update({ category_name: catNames.get(String(c.category_id)) }).eq("xml_category", c.xml_category);
    if (mpColumns) u = u.eq("marketplace", marketplaceId);
    if ((await u).error) break;
  }
  const predCount: Record<string, number> = {};
  // Mevcut ürünlerde fiyat politikası: keep = fiyata dokunma, floor = sadece formülün altındaysa yükselt, formula = formüle eşitle
  const policy: string = s.update_prices === false ? "keep" : String(s.existing_price_policy ?? "floor");
  console.log(`XML: ${raw.length} ürün | ${mp.label}'da: ${existing.size}`);

  const skipped: Record<string, number> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  const csv: string[] = ["barcode;name;category;maliyet;satis;kargoSende;netKar;kar%;durum"];
  const q = csvCell;

  const toUpdate: InventoryItem[] = [];
  const toCreate: NewProduct[] = [];
  const unmapped = new Map<string, number>();
  // XML kategorisi -> tahmin edilen pazaryeri kategorileri (panelde öneri)
  const suggest = new Map<string, Map<string, { name: string; n: number; comm: number }>>();
  const commCount: Record<string, number> = {};
  const priceMoves: Record<string, number> = {};
  const calcBy = new Map<string, ListingCalc>(); // ilan tablosuna: maliyet, gönderilen fiyat, net kâr

  for (const r of raw) {
    const barcode = String(r.barcode ?? "").trim();
    const name = String(r.name ?? "");
    const category = String(r.category ?? "");
    const currency = String(r.currency ?? "TL").toUpperCase();
    if (!barcode) { skip("barkod yok"); continue; }

    const rate = fx[currency];
    let cost = num(r.price) * (rate || 0); // tedarikçi fiyatı (KDV durumu aşağıda, ürünün KDV oranı belli olunca)
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
    // Tedarikçi (XML) fiyatı KDV hariçse: gerçek alış maliyeti = fiyat × (1 + KDV). Formül maliyeti KDV dahil bekler.
    if (s.xml_price_includes_vat === false) cost = cost * (1 + vatRate);
    const desi = Math.max(1, Math.ceil(num(r.desi) || defaultDesi));
    const base: PricingConfig = { ...cfg, vatRate, ...(byDesi ? { shippingCost: mp.shippingCost!(desi, s.cargo_carrier) } : {}) };
    const { cfg: pcfg, applied } = rules.length ? applyRules(base, rules, { cost, supplier: "bayilik", category, brand: String(r.brand ?? ""), stock: num(r.quantity) }) : { cfg: base, applied: [] as string[] };
    for (const a of applied) ruleCount[a] = (ruleCount[a] ?? 0) + 1;
    const calc = calcPrice(cost, pcfg, comm);

    let price: number, sellerPays = false, net = 0, rateOut = 0;
    if (ov?.price_override) {
      price = Number(ov.price_override);
      const b = breakdown(price, cost, pcfg, comm);
      net = b.net; rateOut = b.rate; sellerPays = b.shipping > 0;
    } else if (!calc.ok) {
      // Mevcut ilan (ör. fiyat üst sınırı aştı / zarar): eski fiyattan satılmasın diye stok 0, fiyata dokunulmaz
      const ls = listingId ? lsBy.get(listingId) : undefined;
      if (listingId && ls && ls.status !== "pending" && ls.status !== "closed" && !linked.has(listingId)) {
        linked.add(listingId);
        toUpdate.push({ id: listingId, price: null, quantity: 0 });
        calcBy.set(listingId, { cost, price: null, net: null, note: `stok 0: ${calc.reason ?? "fiyat hesaplanamadı"}`, xmlStock: num(r.quantity), sentStock: 0 });
        skip(`${calc.reason ?? "fiyat hesaplanamadı"} (mevcut ilan: stok 0)`);
        csv.push(`${listingId};${q(name)};${q(category)};${r.price};;;;;STOK 0: ${calc.reason}`);
        continue;
      }
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
        calcBy.set(lid, { cost, price: null, net: null, note: "onay bekliyor/reddedildi: fiyat gönderilmez", xmlStock: num(r.quantity), sentStock: null });
        skip(`${mp.label}'da onay bekliyor/reddedildi`);
        csv.push(`${lid};${q(name)};${q(category)};${r.price};;;;;ATLANDI: ${mp.label}'da onay bekliyor/reddedildi`);
        continue;
      }
      if ((ls?.status === "closed" || (known && curPrice <= 0)) && !ov?.price_override) {
        calcBy.set(lid, { cost, price: null, net: null, note: "kapalı/fiyatsız (Trendyol kapatmış): stok gönderilmez", xmlStock: num(r.quantity), sentStock: null });
        skip(`${mp.label}'da kapalı/fiyatsız ürün`);
        csv.push(`${lid};${q(name)};${q(category)};${r.price};;;;;ATLANDI: ${mp.label}'da kapalı/fiyatsız`);
        continue;
      }
      const sendPrice: number | null = ov?.price_override ? price : existingPriceSafe(policy, curPrice, price, cost, pcfg, comm);
      const change = sendPrice == null ? "fiyat korunur" : !known ? "yeni fiyat" : sendPrice > curPrice + 0.005 ? "artacak" : sendPrice < curPrice - 0.005 ? "düşecek" : "aynı";
      priceMoves[change] = (priceMoves[change] ?? 0) + 1;
      const sentQty = hidden || qty < minStock ? 0 : Math.min(Math.floor(qty), 20000);
      toUpdate.push({ id: lid, price: sendPrice, quantity: sentQty });
      // Kâr sütunları satışta geçerli olacak fiyata göre (formül fiyatına göre değil)
      const eff = sendPrice ?? curPrice;
      const eb = breakdown(eff, cost, pcfg, comm);
      calcBy.set(lid, { cost: Math.round(cost * 100) / 100, price: Number.isFinite(eff) ? eff : null, net: Number.isFinite(eff) ? eb.net : null, note: `${change}; formül ${price}${calc.note ? `; ${calc.note}` : ""}${ov?.price_override ? "; elle fiyat" : ""}${hidden ? "; gizli (istisna)" : qty < minStock ? `; stok ${qty} < ${minStock}: 0 gönderildi` : ""}`, xmlStock: qty, sentStock: sentQty });
      csv.push(`${lid};${q(name)};${q(category)};${r.price};${known || sendPrice != null ? eff : ""};${eb.shipping ? "evet" : "hayir"};${eb.net.toFixed(2)};${(eb.rate * 100).toFixed(1)};MEVCUT (${change}; formül ${price}; eski ${known ? curPrice : "-"})`);
      continue;
    }

    // Kategori gerektirmeyen pazaryeri (Amazon): yeni ürün XML'den açılmaz, panelde eşleştirme + gönderim ile
    if (mp.requiresCategory === false) { skip(`yeni ürün: ${mp.label}'a eşleştirme ekranından gönderilir`); continue; }
    // Yeni ürün: önce aynı başlıklı ürün mağazada var mı (çoklama riski)
    if (lsTitles.has(normFull(name))) { skip(`${mp.label}'da aynı başlık var (çoklama riski)`); csv.push(`${barcode};${q(name)};${q(category)};${r.price};${price};;;;ATLANDI: aynı başlık ${mp.label}'da var`); continue; }
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
    const cl = clean(name, String(r.detail ?? ""));
    toCreate.push({ id: newId, name: cl.title, detail: cl.description, brand: String(r.brand ?? ""), productCode: String(r.productCode ?? barcode), desi: num(r.desi) || 1, images, cat: { ...(cat ?? {}), category_id: categoryId }, price, qty, refs: pred?.refs });
    csv.push(`${newId};${q(name)};${q(category)};${r.price};${price};${sellerPays ? "evet" : "hayir"};${net.toFixed(2)};${(rateOut * 100).toFixed(1)};YENI${cat?.category_id ? "" : guess}`);
  }

  // BOM'lu UTF-8: Excel'de Türkçe karakterler bozulmasın
  writeFileSync(previewFile, "﻿" + csv.join("\n"), "utf8");

  const matched = linked.size;
  const summary: any = {
    marketplace: mp.id,
    xml: raw.length, listings: existing.size, [mp.id]: existing.size, matched, policy, priceMoves, commissionSource: commCount, vatRates: vatCount, categoryPrediction: { examples: examples.length, ...predCount }, categoryLeaves: leafInfo,
    update: toUpdate.length, create: toCreate.length, skipped, pricingRules: ruleCount,
    updated: 0, created: 0, zeroed: 0, failedBatches: 0, batchIds: [] as string[],
  };
  Object.assign(summary, mp.diagnostics?.(raw, matched));
  if (retireRes) summary.retire = retireRes;
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

  // Faz 4: veritabanından gönderilen ilanlar (diğer tedarikçiler). Stok sıfırlamadan ÖNCE: "linked"e eklenir, XML'den kalkmış sayılmaz.
  const dbCtx: DbCtx = { db, mp, marketplaceId, cfg: cfg as PricingConfig, rules, fx, minStock, policy, catMap, existing, lsBy, lsTitles, linked, predict, leafMatch, skip, defaultVatRate: Number(s.vat_rate ?? 20), clean,
    shipFor: byDesi ? (d) => mp.shippingCost!(Math.max(1, Math.ceil(Number(d) || defaultDesi)), s.cargo_carrier) : null };

  // Reddedilen ürünleri düzelt ve yeniden onaya gönder (yalnızca yazma modlarında; sistemin açtığı OS13- ürünler)
  if ((doUpdate || mode === "create") && mp.updateRejected) {
    const rejected = listings.filter((l) => l.reject && l.id.startsWith("OS13-"));
    if (rejected.length) {
      const fx2 = await db.from("listing_fixes").select("*").eq("marketplace", marketplaceId).in("listing_key", rejected.map((l) => l.id));
      const rows = new Map<string, FixRow>((fx2.error ? [] : fx2.data ?? []).map((r: any) => [r.listing_key, r]));
      const xmlBy = new Map<string, any>(raw.map((r) => [mp.newListingId(r), r]));
      const updates: any[] = [], upserts: any[] = [], newWords = new Set<string>();
      const stat: Record<string, number> = {};
      const nowIso = new Date().toISOString();
      for (const l of rejected) {
        const row = rows.get(l.id);
        const x = xmlBy.get(l.id);
        const plan = planFix(l, row, { banned, xmlTitle: x ? String(x.name ?? "") : undefined, xmlDetail: x ? String(x.detail ?? "") : undefined });
        stat[plan.action] = (stat[plan.action] ?? 0) + 1;
        if ("banned" in plan) for (const w of plan.banned) newWords.add(w);
        const base = { marketplace: marketplaceId, listing_key: l.id, types: l.reject!.types, details: l.reject!.details.join(" | ").slice(0, 2000), updated_at: nowIso };
        if (plan.action === "resubmit") {
          updates.push(plan.update);
          upserts.push({ ...base, status: "resubmitted", attempts: (row?.attempts ?? 0) + (plan.fromUser ? 0 : 1), note: plan.note, last_attempt_at: nowIso, proposed: row?.proposed ?? {} });
        } else if (plan.action === "needs_user") {
          upserts.push({ ...base, status: "needs_user", attempts: row?.attempts ?? 0, note: plan.note, last_attempt_at: row?.last_attempt_at ?? null, proposed: row?.proposed ?? {} });
        }
      }
      if (newWords.size) await db.from("banned_words").upsert([...newWords].map((word) => ({ marketplace: marketplaceId, word, source: "ret" })), { onConflict: "marketplace,word", ignoreDuplicates: true });
      let sent = 0;
      if (updates.length) { const r = await mp.updateRejected(updates); sent = r.ok; summary.batchIds.push(...r.batchIds); if (r.failed) summary.failedBatches += r.failed; }
      if (upserts.length) for (const part of chunk(upserts, 500)) await db.from("listing_fixes").upsert(part, { onConflict: "marketplace,listing_key" });
      summary.rejectFixes = { rejected: rejected.length, ...stat, resubmitted: sent, newBannedWords: [...newWords] };
    }
  }
  // Günlük satış özeti (saatte bir, son 35 gün; salt okunur): fiyat değişikliğinin satışa etkisi panelde ölçülür
  if (mp.salesDaily && (new Date().getUTCMinutes() < 15 || process.env.SALES_FULL === "1")) {
    try {
      const rows = await mp.salesDaily(Date.now() - 35 * 86400000, Date.now());
      const now = new Date().toISOString();
      if (rows.length) await db.from("sales_daily").upsert(rows.map((r) => ({ marketplace: marketplaceId, ...r, updated_at: now })), { onConflict: "marketplace,day" });
      summary.sales = { days: rows.length, orders: rows.reduce((t, r) => t + r.orders, 0) };
    } catch (e: any) { summary.sales = { error: String(e?.message ?? e).slice(0, 300) }; }
  }
  // Siparişler (Faz 6 F2, salt okunur): her çalışmada son 3 gün, saatte bir son 14 gün; kişisel veri yok
  if (mp.fetchOrders && mode !== "preview") {
    const full = new Date().getUTCMinutes() < 15 || process.env.SALES_FULL === "1";
    const since = new Date().toISOString();
    summary.orders = await syncOrders(db, mp, cfg, (k) => calcBy.get(k)?.cost ?? null, full ? 14 : 3).catch((e: any) => ({ error: String(e?.message ?? e).slice(0, 300) }));
    if (summary.orders?.inserted) summary.orders.notified = await notifyOrders(db, mp, since).catch(() => 0);
  }
  // Görseli görünmeyen onaylı ilanlar (tedarikçi WebP): JPG görseller yeniden gönderilir, sonuç toplu kontrolde okunur
  if (doUpdate && mp.updateImages) {
    summary.imageFix = await fixImages(db, mp, listings).catch((e: any) => ({ error: String(e?.message ?? e).slice(0, 300) }));
    if (Array.isArray(summary.imageFix?.batchIds)) summary.batchIds.push(...summary.imageFix.batchIds);
  }
  // Müşteri soruları (F7): çek, taslak, Telegram; yalnızca onaylı cevaplar gönderilir
  if (mp.fetchQuestions && mode !== "preview") summary.inbox = await syncInbox(db, mp, s.answer_tone).catch((e: any) => ({ error: String(e?.message ?? e).slice(0, 300) }));
  // Onaylı ilanlardan öğrenilen özellikler ürün kaydına (her modda; yalnızca veritabanına yazar)
  summary.learnedAttributes = await learnFromListings(db, marketplaceId, listings).catch((e: any) => ({ error: String(e?.message ?? e) }));
  const dbInv = await dbInventory(dbCtx).catch((e: any) => ({ items: [] as InventoryItem[], stats: { error: String(e?.message ?? e) } as any }));
  summary.dbProducts = dbInv.stats;
  if (doUpdate) toUpdate.push(...dbInv.items);
  for (const it of dbInv.items) if (!calcBy.has(it.id)) calcBy.set(it.id, { cost: null, price: it.price, net: null, note: "ürün veritabanından yönetiliyor" });
  summary.update = toUpdate.length;
  // Katalog eşleştirme kuyruğu (Amazon; yalnızca okuma, her modda)
  if (mp.findCatalogMatches) summary.matchJobs = await processMatchJobs(dbCtx, `sync-${process.env.GITHUB_RUN_ID ?? "yerel"}`).catch((e: any) => ({ error: String(e?.message ?? e) }));
  // Paneldeki "Pazaryerine gönder" kuyruğu (yalnızca yazma modlarında)
  let sendRes: Awaited<ReturnType<typeof processSendJobs>> | null = null;
  if (doUpdate || mode === "create") {
    sendRes = await processSendJobs(dbCtx, `sync-${process.env.GITHUB_RUN_ID ?? "yerel"}`).catch((e: any) => { summary.sendJobsError = String(e?.message ?? e); return null; });
    if (sendRes) { summary.sendJobs = { jobs: sendRes.jobs, sent: sendRes.sent, errors: sendRes.errors }; summary.created += sendRes.sent; summary.batchIds.push(...sendRes.batchIds); }
    if (s.auto_sync && marketplaceId === "hepsiburada") summary.retryQueue = await requeueFixable(dbCtx).catch((e: any) => ({ skipped: String(e?.message ?? e) }));
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
  // Son 24 saatte pazaryerinin reddettiği ürünler tekrar gönderilmez (her çalışmada aynı hatayı tekrarlamasın)
  let recentFails = new Set<string>();
  if (doCreate && toCreate.length) {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data, error } = await db.from("create_failures").select("barcode").eq("marketplace", marketplaceId).gt("last_at", since);
    if (!error) recentFails = new Set((data ?? []).map((x: any) => x.barcode));
    const before = toCreate.length;
    toCreate.splice(0, toCreate.length, ...toCreate.filter((p) => !recentFails.has(p.id)));
    if (before > toCreate.length) skipped["son 24 saatte reddedildi, beklemede"] = before - toCreate.length;
  }
  if (doCreate && !weakMatch && toCreate.length) {
    // Deneme için adet sınırı (workflow girdisi "limit", elle tetiklemede varsayılan 50)
    const limit = Number(process.env.CREATE_LIMIT || 0);
    const batch = limit > 0 ? toCreate.slice(0, limit) : toCreate;
    if (batch.length < toCreate.length) summary.createLimited = `${toCreate.length} üründen ilk ${batch.length} tanesi açıldı (limit)`;
    // Yeni ürün markası panelden (marketplace_settings.brand_name); boşsa adaptörün varsayılanı
    const br = await db.from("marketplace_settings").select("brand_name").eq("marketplace", marketplaceId).maybeSingle();
    const brandName = br.error ? undefined : br.data?.brand_name || undefined;
    if (brandName) summary.brandUsed = brandName;
    const r = await mp.createProducts(batch, { vatRate: Number(s.vat_rate), skip, brandName });
    summary.created += r.ok; summary.failedBatches += r.failed; summary.batchIds.push(...r.batchIds);
  }

  if (summary.batchIds.length && mp.checkBatches) {
    summary.batchCheck = await mp.checkBatches(summary.batchIds);
    // Reddedilen yeni ürünleri kaydet (mevcut ilanların stok/fiyat hataları değil)
    const created = new Set(toCreate.map((p) => p.id));
    const rows = (summary.batchCheck.failed ?? []).filter((f: any) => created.has(f.id)).map((f: any) => ({ marketplace: marketplaceId, barcode: f.id, reason: f.reason, last_at: new Date().toISOString() }));
    for (const part of chunk(rows, 500)) await db.from("create_failures").upsert(part);
    summary.createRejected = rows.length;
    // Panelden gönderilen ürünlerin reddi: ilan "rejected" + neden (ürün detayında görünür)
    const sentFails = (summary.batchCheck.failed ?? []).filter((f: any) => sendRes?.keys.has(f.id));
    for (const f of sentFails) await db.from("marketplace_listings").update({ status: "rejected", last_error: String(f.reason ?? "").slice(0, 500), updated_at: new Date().toISOString() }).eq("marketplace", marketplaceId).eq("listing_key", f.id);
    if (sentFails.length) summary.sendRejected = sentFails.length;
    // Ürün başına inceleme durumu; sonucu çıkmayan gruplar sonraki çalışmalarda yeniden sorulur
    if (marketplaceId === "hepsiburada") {
      await recordBatches(db, marketplaceId, summary.batchIds).catch(() => {});
      summary.batchCheck.statesApplied = await applyStates(db, marketplaceId, summary.batchCheck.states, summary.batchCheck.done).catch((e: any) => String(e?.message ?? e));
    }
    delete summary.batchCheck.failed; delete summary.batchCheck.states; delete summary.batchCheck.done; // özet şişmesin
  }
  if (marketplaceId === "hepsiburada" && mode !== "preview") summary.statusRefresh = await refreshBatches(db, mp).catch((e: any) => ({ error: String(e?.message ?? e) }));
  summary.batchIds = summary.batchIds.slice(0, 20);
  // Faz 3: ilan tablosu (pazaryerinin gördüğü durum, ürün veritabanına bağlantı)
  if (listings.length) summary.listingsTable = await snapshotListings(db, marketplaceId, listings, calcBy).catch((e: any) => ({ error: String(e?.message ?? e) }));
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
