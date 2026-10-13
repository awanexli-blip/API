// node --experimental-strip-types worker/sync.ts <preview|update|create|auto>
//  preview : fiyatları hesaplar, preview.csv yazar, Trendyol'a yazmaz
//  update  : mevcut ürünlerin stok (+ ayara göre fiyat) güncellemesi
//  create  : Trendyol'da olmayan ürünleri açar
//  auto    : zamanlanmış çalışma -> update (+ ayar açıksa create)

import { createClient } from "@supabase/supabase-js";
import { XMLParser } from "fast-xml-parser";
import { writeFileSync } from "node:fs";
import { calcPrice } from "./pricing.ts";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Eksik ortam değişkeni: ${k}`);
  return v;
};

const mode = process.argv[2] ?? "preview";
const trigger = process.env.TRIGGER ?? "manual";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const SELLER_ID = env("TRENDYOL_SELLER_ID");
const BASE = "https://apigw.trendyol.com/integration";
const HEADERS = {
  Authorization: "Basic " + Buffer.from(`${env("TRENDYOL_API_KEY")}:${env("TRENDYOL_API_SECRET")}`).toString("base64"),
  "User-Agent": `${SELLER_ID} - SelfIntegration`,
  "Content-Type": "application/json",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const chunk = <T>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

async function tg(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: HEADERS });
  const text = await res.text();
  if (!res.ok) throw new Error(`Trendyol ${res.status} ${path}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

async function loadXml(): Promise<any[]> {
  const res = await fetch(env("XML_URL"));
  if (!res.ok) throw new Error(`XML indirilemedi: ${res.status}`);
  const parsed = new XMLParser({ ignoreAttributes: true, trimValues: true, parseTagValue: false }).parse(await res.text());
  const find = (o: any): any[] | null => {
    if (Array.isArray(o) && o.length && typeof o[0] === "object" && "barcode" in o[0]) return o;
    if (o && typeof o === "object") for (const v of Object.values(o)) { const r = find(v); if (r) return r; }
    return null;
  };
  const rows = find(parsed);
  if (!rows) throw new Error("XML içinde 'barcode' alanlı ürün listesi bulunamadı");
  return rows;
}

async function existingBarcodes(): Promise<Set<string>> {
  const set = new Set<string>();
  let page = 0, totalPages = 1;
  while (page < totalPages) {
    const r = await tg(`/product/sellers/${SELLER_ID}/products?page=${page}&size=1000`);
    totalPages = r.totalPages ?? 1;
    for (const p of r.content ?? []) if (p.barcode) set.add(String(p.barcode));
    page++;
    await sleep(150);
  }
  return set;
}

const brandCache = new Map<string, number | null>();
async function brandId(name: string): Promise<number | null> {
  if (!name) return null;
  if (brandCache.has(name)) return brandCache.get(name)!;
  let id: number | null = null;
  try { id = (await tg(`/product/brands/by-name?name=${encodeURIComponent(name)}`))?.brands?.[0]?.id ?? null; } catch { /* marka yok */ }
  brandCache.set(name, id);
  await sleep(100);
  return id;
}

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
  const existing = await existingBarcodes();
  console.log(`XML: ${raw.length} ürün | Trendyol'da: ${existing.size}`);

  const num = (v: any) => Number(String(v ?? "0").replace(",", "."));
  const skipped: Record<string, number> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  const csv: string[] = ["barcode;name;category;maliyet;satis;kargoSende;netKar;kar%;durum"];
  const q = (v: any) => String(v ?? "").replace(/;/g, ",").replace(/\r?\n/g, " ");

  const toUpdate: any[] = [];
  const toCreate: any[] = [];
  const xmlBarcodes = new Set<string>();
  const unmapped = new Map<string, number>();

  for (const r of raw) {
    const barcode = String(r.barcode ?? "").trim();
    const name = String(r.name ?? "");
    const category = String(r.category ?? "");
    const currency = String(r.currency ?? "TL").toUpperCase();
    if (!barcode) { skip("barkod yok"); continue; }
    xmlBarcodes.add(barcode);

    const rate = fx[currency];
    const cost = num(r.price) * (rate || 0);
    const cat = catMap.get(category);
    const ov = ovMap.get(barcode);
    const isExisting = existing.has(barcode);

    if (!rate) { skip(`kur yok: ${currency}`); csv.push(`${barcode};${q(name)};${q(category)};${r.price};;;;;ATLANDI: kur yok`); continue; }
    const calc = calcPrice(cost, cfg as any, cat?.commission_rate != null ? Number(cat.commission_rate) : cfg.commissionRate);

    let price: number, sellerPays = false, net = 0, rateOut = 0;
    if (ov?.price_override) {
      price = Number(ov.price_override);
      const ship = price >= cfg.freeShippingThreshold ? cfg.shippingCost : 0;
      net = price * (1 - cfg.commissionRate) - cost - cfg.fixedCost - ship;
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
      toUpdate.push({ barcode, price, quantity: hidden || qty < minStock ? 0 : Math.min(Math.floor(qty), 20000) });
      csv.push(`${barcode};${q(name)};${q(category)};${r.price};${price};${sellerPays ? "evet" : "hayir"};${net.toFixed(2)};${(rateOut * 100).toFixed(1)};MEVCUT`);
      continue;
    }

    // Yeni ürün: kategori eşleşmesi, resim ve stok şart
    if (!cat?.category_id) { unmapped.set(category, (unmapped.get(category) ?? 0) + 1); skip("kategori eşleşmemiş"); csv.push(`${barcode};${q(name)};${q(category)};${r.price};${price};;;;ATLANDI: kategori eşleşmemiş`); continue; }
    if (!images.length) { skip("resim yok"); csv.push(`${barcode};${q(name)};${q(category)};${r.price};${price};;;;ATLANDI: resim yok`); continue; }
    if (hidden || qty < minStock) { skip("stok yok / gizli"); csv.push(`${barcode};${q(name)};${q(category)};${r.price};${price};;;;ATLANDI: stok yok`); continue; }
    toCreate.push({ barcode, name, detail: String(r.detail ?? ""), brand: String(r.brand ?? ""), productCode: String(r.productCode ?? barcode), desi: num(r.desi) || 1, images, cat, price, qty });
    csv.push(`${barcode};${q(name)};${q(category)};${r.price};${price};${sellerPays ? "evet" : "hayir"};${net.toFixed(2)};${(rateOut * 100).toFixed(1)};YENI`);
  }

  // BOM'lu UTF-8: Excel'de Türkçe karakterler bozulmasın
  writeFileSync("preview.csv", "\uFEFF" + csv.join("\n"), "utf8");

  const matched = [...existing].filter((b) => xmlBarcodes.has(b)).length;
  const summary: any = {
    xml: raw.length, trendyol: existing.size, matched,
    update: toUpdate.length, create: toCreate.length, skipped,
    updated: 0, created: 0, zeroed: 0, failedBatches: 0, batchIds: [] as string[],
  };

  // Eşleşmeyen kategoriler panelde görünsün
  await db.from("unmapped_categories").delete().neq("xml_category", "");
  const um = [...unmapped].map(([xml_category, product_count]) => ({ xml_category, product_count }));
  for (const part of chunk(um, 500)) await db.from("unmapped_categories").insert(part);

  if (doUpdate) {
    for (const batch of chunk(toUpdate, 500)) {
      try {
        const items = batch.map((p) => s.update_prices
          ? { barcode: p.barcode, quantity: p.quantity, salePrice: p.price, listPrice: p.price }
          : { barcode: p.barcode, quantity: p.quantity });
        const r = await tg(`/inventory/sellers/${SELLER_ID}/products/price-and-inventory`, { method: "POST", body: JSON.stringify({ items }) });
        summary.updated += batch.length; summary.batchIds.push(r.batchRequestId);
      } catch (e: any) { summary.failedBatches++; console.error(e.message); }
      await sleep(300);
    }

    // XML'den kalkan ürünler: yalnızca eşleşme güvenilirse stoğu sıfırla
    if (s.zero_missing) {
      if (existing.size && matched / existing.size >= 0.5) {
        const gone = [...existing].filter((b) => !xmlBarcodes.has(b));
        for (const batch of chunk(gone, 500)) {
          try {
            await tg(`/inventory/sellers/${SELLER_ID}/products/price-and-inventory`, { method: "POST", body: JSON.stringify({ items: batch.map((barcode) => ({ barcode, quantity: 0 })) }) });
            summary.zeroed += batch.length;
          } catch (e: any) { summary.failedBatches++; console.error(e.message); }
          await sleep(300);
        }
      } else {
        summary.zeroMissingSkipped = "Trendyol barkodlarının yarısından azı XML ile eşleşti, güvenlik için çalıştırılmadı";
      }
    }
  }

  if (doCreate && toCreate.length) {
    const cargoCompanyId = Number(env("TRENDYOL_CARGO_COMPANY_ID"));
    const shipmentAddressId = Number(env("TRENDYOL_SHIPMENT_ADDRESS_ID"));
    const returningAddressId = Number(env("TRENDYOL_RETURN_ADDRESS_ID"));
    const payloads: any[] = [];
    for (const p of toCreate) {
      const bId = await brandId(p.brand);
      if (!bId) { skip("marka bulunamadı"); continue; }
      payloads.push({
        barcode: p.barcode, title: p.name.slice(0, 100), productMainId: p.productCode, brandId: bId,
        categoryId: Number(p.cat.category_id), quantity: Math.min(Math.floor(p.qty), 20000), stockCode: p.productCode,
        dimensionalWeight: p.desi, description: p.detail.slice(0, 30000), currencyType: "TRY",
        listPrice: p.price, salePrice: p.price, vatRate: Number(p.cat.vat_rate ?? s.vat_rate),
        cargoCompanyId, shipmentAddressId, returningAddressId,
        images: p.images.map((url: string) => ({ url })), attributes: p.cat.attributes ?? [],
      });
    }
    for (const batch of chunk(payloads, 100)) {
      try {
        const r = await tg(`/product/sellers/${SELLER_ID}/products`, { method: "POST", body: JSON.stringify({ items: batch }) });
        summary.created += batch.length; summary.batchIds.push(r.batchRequestId);
      } catch (e: any) { summary.failedBatches++; console.error(e.message); }
      await sleep(500);
    }
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
