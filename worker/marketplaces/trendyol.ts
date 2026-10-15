import { readFileSync } from "node:fs";
import { env, sleep, chunk, san } from "../core/util.ts";
import type { BatchResult, Commission, InventoryItem, Listing, Marketplace, NewProduct } from "./types.ts";

const loadJson = (f: string): Record<string, number> => {
  try { return JSON.parse(readFileSync(new URL(f, import.meta.url), "utf8")); } catch { return {}; }
};

// BAĞLANTI KURALI: mağazadaki ürünlerin barkodu "ÖS13-" + XML productCode (ASCII dışı karakterler atılmış).
// Mevcut ürünler "ÖS13-" ile açılmış; yeni ürünler ASCII-uyumlu "OS13-" ile açılır, eşleştirme ikisini de dener.
const BARCODE_PREFIXES = ["ÖS13-", "OS13-"];
const NEW_PREFIX = "OS13-";
// Mağazadaki ürünlerin %93'ü bu markayla açılmış; XML markası (BayilikXML.com) Trendyol'da yok.
const BRAND_NAME = process.env.TRENDYOL_BRAND_NAME || "Eco Lounge";

export function createTrendyol(): Marketplace {
  const SELLER_ID = env("TRENDYOL_SELLER_ID");
  const BASE = "https://apigw.trendyol.com/integration";
  const HEADERS = {
    Authorization: "Basic " + Buffer.from(`${env("TRENDYOL_API_KEY")}:${env("TRENDYOL_API_SECRET")}`).toString("base64"),
    "User-Agent": `${SELLER_ID} - SelfIntegration`,
    "Content-Type": "application/json",
  };

  // Trendyol'un ürün/kategori bazlı gerçek komisyonları (Trendyol'dan indirilen "Ürünleriniz" dosyasından üretildi)
  const commByBarcode = loadJson("../commissions_by_barcode.json");
  const commByCategory = loadJson("../commissions_by_category.json");

  async function tg(path: string, init?: RequestInit) {
    const res = await fetch(`${BASE}${path}`, { ...init, headers: HEADERS });
    const text = await res.text();
    if (!res.ok) throw new Error(`Trendyol ${res.status} ${path}: ${text.slice(0, 400)}`);
    return text ? JSON.parse(text) : {};
  }

  const tgItems: any[] = [];

  const brandCache = new Map<string, number | null>();
  async function brandId(name: string): Promise<number | null> {
    if (!name) return null;
    if (brandCache.has(name)) return brandCache.get(name)!;
    let id: number | null = null;
    try { id = (await tg(`/product/brands/by-name?name=${encodeURIComponent(name)}`))?.brands?.[0]?.id ?? null; } catch { /* marka yok */ }
    brandCache.set(name, id);
    await sleep(300);
    return id;
  }

  return {
    id: "trendyol",
    label: "Trendyol",

    async loadListings(): Promise<Listing[]> {
      const out: Listing[] = [];
      let page = 0, totalPages = 1;
      while (page < totalPages) {
        const r = await tg(`/product/sellers/${SELLER_ID}/products?page=${page}&size=1000`);
        totalPages = r.totalPages ?? 1;
        for (const p of r.content ?? []) {
          if (!p.barcode) continue;
          const title = String(p.title ?? "").slice(0, 120);
          out.push({ id: String(p.barcode), title, price: Number(p.salePrice), quantity: Number(p.quantity) });
          tgItems.push({ barcode: String(p.barcode), stockCode: p.stockCode ? String(p.stockCode) : "", productMainId: p.productMainId ? String(p.productMainId) : "", title, salePrice: Number(p.salePrice), quantity: Number(p.quantity) });
        }
        page++;
        await sleep(300);
      }
      return out;
    },

    findListing(xml, existing) {
      const barcode = String(xml.barcode ?? "").trim();
      if (existing.has(barcode)) return barcode;
      const productCode = String(xml.productCode ?? "").trim();
      if (!productCode) return null;
      return BARCODE_PREFIXES.map((pf) => pf + san(productCode)).find((k) => existing.has(k)) ?? null;
    },

    newListingId(xml) {
      const productCode = String(xml.productCode ?? "").trim();
      return NEW_PREFIX + san(productCode || String(xml.barcode ?? "").trim());
    },

    // Komisyon önceliği: ürünün kendi oranı > panelde girilen kategori oranı > kategori içindeki en yüksek oran > varsayılan
    commission(listingId, xmlCategory, panelRate, defaultRate): Commission {
      if (listingId && commByBarcode[listingId] != null) return { rate: commByBarcode[listingId], source: "urun" };
      if (panelRate != null) return { rate: panelRate, source: "panel" };
      if (commByCategory[xmlCategory] != null) return { rate: commByCategory[xmlCategory], source: "kategori" };
      return { rate: defaultRate, source: "varsayilan" };
    },

    async pushInventory(items: InventoryItem[]): Promise<BatchResult> {
      const res: BatchResult = { ok: 0, failed: 0, batchIds: [] };
      for (const batch of chunk(items, 500)) {
        try {
          const body = batch.map((p) => p.price != null
            ? { barcode: p.id, quantity: p.quantity, salePrice: p.price, listPrice: p.price }
            : { barcode: p.id, quantity: p.quantity });
          const r = await tg(`/inventory/sellers/${SELLER_ID}/products/price-and-inventory`, { method: "POST", body: JSON.stringify({ items: body }) });
          res.ok += batch.length; res.batchIds.push(r.batchRequestId);
        } catch (e: any) { res.failed++; console.error(e.message); }
        await sleep(300);
      }
      return res;
    },

    async zeroStock(ids: string[]): Promise<BatchResult> {
      const res: BatchResult = { ok: 0, failed: 0, batchIds: [] };
      for (const batch of chunk(ids, 500)) {
        try {
          await tg(`/inventory/sellers/${SELLER_ID}/products/price-and-inventory`, { method: "POST", body: JSON.stringify({ items: batch.map((barcode) => ({ barcode, quantity: 0 })) }) });
          res.ok += batch.length;
        } catch (e: any) { res.failed++; console.error(e.message); }
        await sleep(300);
      }
      return res;
    },

    async createProducts(items: NewProduct[], ctx): Promise<BatchResult> {
      const res: BatchResult = { ok: 0, failed: 0, batchIds: [] };
      const cargoCompanyId = Number(env("TRENDYOL_CARGO_COMPANY_ID"));
      const shipmentAddressId = Number(env("TRENDYOL_SHIPMENT_ADDRESS_ID"));
      const returningAddressId = Number(env("TRENDYOL_RETURN_ADDRESS_ID"));
      const payloads: any[] = [];
      const used = new Set<string>();
      for (const p of items) {
        if (used.has(p.id)) { ctx.skip("aynı barkoda dönüşen ürün kodu"); continue; }
        used.add(p.id);
        const bId = await brandId(BRAND_NAME);
        if (!bId) { ctx.skip(`marka bulunamadı: ${BRAND_NAME}`); continue; }
        payloads.push({
          barcode: p.id, title: p.name.slice(0, 100), productMainId: p.id, brandId: bId,
          categoryId: Number(p.cat.category_id), quantity: Math.min(Math.floor(p.qty), 20000), stockCode: p.id,
          dimensionalWeight: p.desi, description: p.detail.slice(0, 30000), currencyType: "TRY",
          listPrice: p.price, salePrice: p.price, vatRate: Number(p.cat.vat_rate ?? ctx.vatRate),
          cargoCompanyId, shipmentAddressId, returningAddressId,
          images: p.images.map((url: string) => ({ url })), attributes: p.cat.attributes ?? [],
        });
      }
      for (const batch of chunk(payloads, 100)) {
        try {
          const r = await tg(`/product/sellers/${SELLER_ID}/products`, { method: "POST", body: JSON.stringify({ items: batch }) });
          res.ok += batch.length; res.batchIds.push(r.batchRequestId);
        } catch (e: any) { res.failed++; console.error(e.message); }
        await sleep(500);
      }
      return res;
    },

    // Eşleşme teşhisi: Trendyol ürünleri XML ile hangi alan üzerinden eşleşiyor?
    diagnostics(xml, linkedCount) {
      const xmlBarcodes = new Set(xml.map((r) => String(r.barcode ?? "").trim()).filter(Boolean));
      const xmlPc = new Set(xml.map((r) => String(r.productCode ?? "").trim()).filter(Boolean));
      const stat = (f: (i: any) => string, S: Set<string>) => tgItems.filter((i) => f(i) && S.has(f(i))).length;
      return {
        matchStats: {
          barcode_to_barcode: linkedCount,
          stockCode_to_barcode: stat((i) => i.stockCode, xmlBarcodes),
          stockCode_to_productCode: stat((i) => i.stockCode, xmlPc),
          productMainId_to_productCode: stat((i) => i.productMainId, xmlPc),
          productMainId_to_barcode: stat((i) => i.productMainId, xmlBarcodes),
          suffix_to_productCode: stat((i) => (i.stockCode.split(/[._]/).pop() ?? ""), xmlPc),
          suffix_to_barcode: stat((i) => (i.stockCode.split(/[._]/).pop() ?? ""), xmlBarcodes),
        },
        sampleTrendyol: tgItems.slice(0, 3),
      };
    },
  };
}
