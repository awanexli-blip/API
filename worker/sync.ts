// node --experimental-strip-types worker/sync.ts <preview|update|create|auto> [pazaryeri]
//  preview : fiyatları hesaplar, preview.csv yazar, pazaryerine yazmaz
//  update  : mevcut ürünlerin stok (+ ayara göre fiyat) güncellemesi
//  create  : pazaryerinde olmayan ürünleri açar
//  auto    : zamanlanmış çalışma -> update (+ ayar açıksa create)
// Pazaryeri: 2. argüman veya MARKETPLACE ortam değişkeni (varsayılan trendyol).
// Pazaryerine özgü her şey worker/marketplaces/<ad>.ts içindedir.

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { calcPrice } from "./pricing.ts";
import { env, chunk, num, normTitle } from "./core/util.ts";
import { loadXml } from "./core/xml.ts";
import { getMarketplace } from "./marketplaces/index.ts";
import type { InventoryItem, NewProduct } from "./marketplaces/types.ts";

const mode = process.argv[2] ?? "preview";
const marketplaceId = process.argv[3] ?? process.env.MARKETPLACE ?? "trendyol";
const trigger = process.env.TRIGGER ?? "manual";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const mp = getMarketplace(marketplaceId);
// Trendyol dosya adı eskisi gibi kalır (panel/CLAUDE.md buna atıfta bulunuyor)
const previewFile = mp.id === "trendyol" ? "preview.csv" : `preview_${mp.id}.csv`;

async function main() {
  const { data: s, error: se } = await db.from("settings").select("*").eq("id", 1).single();
  if (se || !s) throw new Error("Ayarlar okunamadı: " + se?.message);

  if (mode === "auto" && trigger === "schedule" && !s.auto_sync) {
    return { skippedRun: "otomatik senkronizasyon kapalı" };
  }
  const doUpdate = mode === "update" || mode === "auto";
  const doCreate = mode === "create" || (mode === "auto" && s.auto_create);

  const cfg = {
    commissionRate: Number(s.commission_rate), targetProfitRate: Number(s.target_profit_rate),
    shippingCost: Number(s.shipping_cost), freeShippingThreshold: Number(s.free_shipping_threshold),
    minMarkup: Number(s.min_markup), fixedCost: Number(s.fixed_cost),
    minAcceptableProfitRate: Number(s.min_acceptable_profit_rate), maxPrice: Number(s.max_price),
  };
  const fx: Record<string, number> = { TL: 1, TRY: 1, USD: Number(s.fx_usd), EUR: Number(s.fx_eur) };
  const minStock = Number(s.min_stock);

  const { data: cats } = await db.from("category_map").select("*");
  const catMap = new Map<string, any>((cats ?? []).map((c: any) => [c.xml_category, c]));
  const { data: ovs } = await db.from("product_overrides").select("*");
  const ovMap = new Map<string, any>((ovs ?? []).map((o: any) => [o.barcode, o]));

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
  const commCount: Record<string, number> = {};

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
    const { rate: comm, source: commSource } = mp.commission(listingId, category, cat?.commission_rate != null ? Number(cat.commission_rate) : null, cfg.commissionRate);
    commCount[commSource] = (commCount[commSource] ?? 0) + 1;
    const calc = calcPrice(cost, cfg as any, comm);

    let price: number, sellerPays = false, net = 0, rateOut = 0;
    if (ov?.price_override) {
      price = Number(ov.price_override);
      const ship = price >= cfg.freeShippingThreshold ? cfg.shippingCost : 0;
      net = price * (1 - comm) - cost - cfg.fixedCost - ship;
      rateOut = net / price; sellerPays = ship > 0;
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
      const curPrice = Number(lsBy.get(lid)?.price);
      const known = Number.isFinite(curPrice);
      if (known && curPrice <= 0 && !ov?.price_override) {
        skip(`${mp.label}'da kapalı/fiyatsız ürün`);
        csv.push(`${lid};${q(name)};${q(category)};${r.price};;;;;ATLANDI: ${mp.label}'da kapalı/fiyatsız`);
        continue;
      }
      let sendPrice: number | null = price;
      if (!ov?.price_override) {
        if (policy === "keep" || (policy === "floor" && !known)) sendPrice = null;
        else if (policy === "floor") sendPrice = Math.max(curPrice, price);
      }
      const change = sendPrice == null ? "fiyat korunur" : !known ? "yeni fiyat" : sendPrice > curPrice + 0.005 ? "artacak" : sendPrice < curPrice - 0.005 ? "düşecek" : "aynı";
      toUpdate.push({ id: lid, price: sendPrice, quantity: hidden || qty < minStock ? 0 : Math.min(Math.floor(qty), 20000) });
      csv.push(`${lid};${q(name)};${q(category)};${r.price};${sendPrice ?? (known ? curPrice : "")};${sellerPays ? "evet" : "hayir"};${net.toFixed(2)};${(rateOut * 100).toFixed(1)};MEVCUT (${change}; formül ${price})`);
      continue;
    }

    // Yeni ürün: önce aynı başlıklı ürün mağazada var mı (çoklama riski)
    if (lsTitles.has(normTitle(name))) { skip(`${mp.label}'da aynı başlık var (çoklama riski)`); csv.push(`${barcode};${q(name)};${q(category)};${r.price};${price};;;;ATLANDI: aynı başlık ${mp.label}'da var`); continue; }
    // kategori eşleşmesi, resim ve stok şart
    if (!cat?.category_id) { unmapped.set(category, (unmapped.get(category) ?? 0) + 1); skip("kategori eşleşmemiş"); csv.push(`${barcode};${q(name)};${q(category)};${r.price};${price};;;;ATLANDI: kategori eşleşmemiş`); continue; }
    if (!images.length) { skip("resim yok"); csv.push(`${barcode};${q(name)};${q(category)};${r.price};${price};;;;ATLANDI: resim yok`); continue; }
    if (hidden || qty < minStock) { skip("stok yok / gizli"); csv.push(`${barcode};${q(name)};${q(category)};${r.price};${price};;;;ATLANDI: stok yok`); continue; }
    const newId = mp.newListingId(r);
    toCreate.push({ id: newId, name, detail: String(r.detail ?? ""), brand: String(r.brand ?? ""), productCode: String(r.productCode ?? barcode), desi: num(r.desi) || 1, images, cat, price, qty });
    csv.push(`${newId};${q(name)};${q(category)};${r.price};${price};${sellerPays ? "evet" : "hayir"};${net.toFixed(2)};${(rateOut * 100).toFixed(1)};YENI`);
  }

  // BOM'lu UTF-8: Excel'de Türkçe karakterler bozulmasın
  writeFileSync(previewFile, "﻿" + csv.join("\n"), "utf8");

  const matched = linked.size;
  const summary: any = {
    marketplace: mp.id,
    xml: raw.length, listings: existing.size, [mp.id]: existing.size, matched, policy, commissionSource: commCount,
    update: toUpdate.length, create: toCreate.length, skipped,
    updated: 0, created: 0, zeroed: 0, failedBatches: 0, batchIds: [] as string[],
  };
  Object.assign(summary, mp.diagnostics?.(raw, matched));
  summary.sampleXml = raw.slice(0, 3).map((r) => ({ barcode: r.barcode, productCode: r.productCode, name: String(r.name ?? "").slice(0, 60) }));

  // Eşleşmeyen kategoriler panelde görünsün
  await db.from("unmapped_categories").delete().neq("xml_category", "");
  const um = [...unmapped].map(([xml_category, product_count]) => ({ xml_category, product_count }));
  for (const part of chunk(um, 500)) await db.from("unmapped_categories").insert(part);

  if (doUpdate) {
    const r = await mp.pushInventory(toUpdate);
    summary.updated += r.ok; summary.failedBatches += r.failed; summary.batchIds.push(...r.batchIds);

    // XML'den kalkan ürünler: yalnızca eşleşme güvenilirse stoğu sıfırla
    if (s.zero_missing) {
      if (existing.size && matched / existing.size >= 0.5) {
        const gone = [...existing].filter((b) => !linked.has(b));
        const z = await mp.zeroStock(gone);
        summary.zeroed += z.ok; summary.failedBatches += z.failed;
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
    const r = await mp.createProducts(toCreate, { vatRate: Number(s.vat_rate), skip });
    summary.created += r.ok; summary.failedBatches += r.failed; summary.batchIds.push(...r.batchIds);
  }

  summary.batchIds = summary.batchIds.slice(0, 20);
  return summary;
}

(async () => {
  const { data: run } = await db.from("sync_runs").insert({ mode, trigger, status: "running" }).select("id").single();
  const id = run?.id as number;
  try {
    const summary: any = await main();
    const status = summary.skippedRun ? "skipped" : summary.failedBatches > 0 ? "partial" : "ok";
    await db.from("sync_runs").update({ status, finished_at: new Date().toISOString(), summary }).eq("id", id);
    console.log(JSON.stringify(summary, null, 1));
  } catch (e: any) {
    console.error(e);
    await db.from("sync_runs").update({ status: "error", finished_at: new Date().toISOString(), error: String(e.message ?? e).slice(0, 1000) }).eq("id", id);
    process.exit(1);
  }
})();
