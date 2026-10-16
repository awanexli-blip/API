// Trendyol adaptörü — Product V2 servisleri (V1 15.10.2026'da kapandı).
// Uç listesi: https://developers.trendyol.com/v3.0/docs/product-v2-api-endpoint.md
import { readFileSync } from "node:fs";
import { env, sleep, chunk, san } from "../core/util.ts";
import type { BatchCheck, BatchResult, Commission, InventoryItem, Listing, Marketplace, NewProduct } from "./types.ts";

const loadJson = (f: string): Record<string, number> => {
  try { return JSON.parse(readFileSync(new URL(f, import.meta.url), "utf8")); } catch { return {}; }
};

// BAĞLANTI KURALI: mağazadaki ürünlerin barkodu "ÖS13-" + XML productCode (ASCII dışı karakterler atılmış).
// Mevcut ürünler "ÖS13-" ile açılmış; yeni ürünler ASCII-uyumlu "OS13-" ile açılır, eşleştirme ikisini de dener.
const BARCODE_PREFIXES = ["ÖS13-", "OS13-"];
const NEW_PREFIX = "OS13-";
// Mağazadaki ürünlerin %93'ü bu markayla açılmış; XML markası (BayilikXML.com) Trendyol'da yok.
const BRAND_NAME = process.env.TRENDYOL_BRAND_NAME || "Eco Lounge";
const MAX_PAGES = 2000; // sonsuz döngü koruması

export function createTrendyol(): Marketplace {
  const SELLER_ID = env("TRENDYOL_SELLER_ID");
  const BASE = "https://apigw.trendyol.com/integration";
  const HEADERS: Record<string, string> = {
    Authorization: "Basic " + Buffer.from(`${env("TRENDYOL_API_KEY")}:${env("TRENDYOL_API_SECRET")}`).toString("base64"),
    "User-Agent": `${SELLER_ID} - SelfIntegration`,
    "Content-Type": "application/json",
  };
  // Belgeye göre başlık gönderilmezse istek TR olarak işlenir, tanınmayan değer 400 döner. Bu yüzden sadece ayarlıysa gönderilir.
  if (process.env.TRENDYOL_STOREFRONT) HEADERS.storeFrontCode = process.env.TRENDYOL_STOREFRONT;

  // Yedek komisyon kaynakları ("Ürünleriniz" dışa aktarımından). Canlı oran V2 yanıtındaki variants[].commission'dan gelir.
  const commByBarcode = loadJson("../commissions_by_barcode.json");
  const commByCategory = loadJson("../commissions_by_category.json");

  async function tg(path: string, init?: RequestInit) {
    const res = await fetch(`${BASE}${path}`, { ...init, headers: HEADERS });
    const text = await res.text();
    if (!res.ok) throw new Error(`Trendyol ${res.status} ${path}: ${text.slice(0, 400)}`);
    return text ? JSON.parse(text) : {};
  }

  // Sayfalı liste: page*size 10.000'i geçemez, sonrası nextPageToken ile.
  async function fetchAll(path: string, size: number, onItem: (x: any) => void) {
    let page = 0, token = "", total = 0, requests = 0;
    for (;;) {
      if (++requests > MAX_PAGES) throw new Error(`Trendyol ${path}: sayfa sınırı aşıldı`);
      const q = token ? `size=${size}&nextPageToken=${encodeURIComponent(token)}` : `page=${page}&size=${size}`;
      const r = await tg(`${path}?${q}`);
      total = r.totalElements ?? total;
      const content: any[] = r.content ?? [];
      content.forEach(onItem);
      await sleep(300);
      if (!content.length) break;
      if (token) { token = r.nextPageToken ?? ""; if (!token) break; continue; }
      page++;
      if (page >= (r.totalPages ?? 0)) break;
      if (page * size >= 10000) { token = r.nextPageToken ?? ""; if (!token) break; }
    }
    return total;
  }

  const tgItems: any[] = [];
  const liveComm = new Map<string, number>();
  const totals: Record<string, number> = {};

  const brandCache = new Map<string, number | null>();
  async function brandId(name: string): Promise<number | null> {
    if (!name) return null;
    if (brandCache.has(name)) return brandCache.get(name)!;
    let id: number | null = null;
    try {
      const r = await tg(`/product/brands/by-name?name=${encodeURIComponent(name)}`);
      const list: any[] = Array.isArray(r) ? r : r?.brands ?? [];
      const exact = list.find((b) => String(b.name).toLocaleLowerCase("tr") === name.toLocaleLowerCase("tr"));
      id = (exact ?? list[0])?.id ?? null;
    } catch { /* marka yok */ }
    brandCache.set(name, id);
    await sleep(300);
    return id;
  }

  return {
    id: "trendyol",
    label: "Trendyol",

    async loadListings(): Promise<Listing[]> {
      const out = new Map<string, Listing>();
      // Onaylı ürünler: içerik (başlık, kategori) + varyantlar (barkod, fiyat, stok, komisyon, durum)
      totals.approved = await fetchAll(`/product/sellers/${SELLER_ID}/products/approved`, 100, (c) => {
        const title = String(c.title ?? "").slice(0, 120);
        for (const v of c.variants ?? []) {
          if (!v.barcode) continue;
          const barcode = String(v.barcode);
          const price = Number(v.price?.salePrice);
          const closed = !!(v.locked || v.archived || v.blacklisted);
          const comm = Number(v.commission);
          if (Number.isFinite(comm) && comm > 0) liveComm.set(barcode, comm > 1 ? comm / 100 : comm);
          out.set(barcode, { id: barcode, title, price, quantity: Number(v.stock?.quantity), status: closed ? "closed" : "active" });
          tgItems.push({ barcode, stockCode: v.stockCode ? String(v.stockCode) : "", productMainId: c.productMainId ? String(c.productMainId) : "", title, salePrice: price, categoryId: c.category?.id ?? null, categoryName: c.category?.name ?? "", brandId: c.brand?.id ?? null, closed });
        }
      });
      // Onay bekleyen / reddedilen: güncellenmez ama "var" sayılır, aynı ürün ikinci kez açılmasın
      totals.unapproved = await fetchAll(`/product/sellers/${SELLER_ID}/products/unapproved`, 1000, (p) => {
        if (!p.barcode || out.has(String(p.barcode))) return;
        out.set(String(p.barcode), { id: String(p.barcode), title: String(p.title ?? "").slice(0, 120), price: Number(p.salePrice), quantity: Number(p.quantity), status: "pending" });
      });
      return [...out.values()];
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

    // Komisyon önceliği: canlı ürün oranı (V2) > ürün oranı (dışa aktarım) > panel kategori oranı > kategori içindeki en yüksek oran > varsayılan
    commission(listingId, xmlCategory, panelRate, defaultRate): Commission {
      if (listingId && liveComm.has(listingId)) return { rate: liveComm.get(listingId)!, source: "urun_canli" };
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
          const r = await tg(`/inventory/sellers/${SELLER_ID}/products/price-and-inventory`, { method: "POST", body: JSON.stringify({ items: batch.map((barcode) => ({ barcode, quantity: 0 })) }) });
          res.ok += batch.length; res.batchIds.push(r.batchRequestId);
        } catch (e: any) { res.failed++; console.error(e.message); }
        await sleep(300);
      }
      return res;
    },

    async createProducts(items: NewProduct[], ctx): Promise<BatchResult> {
      const res: BatchResult = { ok: 0, failed: 0, batchIds: [] };
      // V2'de adres alanları opsiyonel; tanımlıysa gönderilir
      const opt = (k: string) => (process.env[k] ? Number(process.env[k]) : undefined);
      const shipmentAddressId = opt("TRENDYOL_SHIPMENT_ADDRESS_ID");
      const returningAddressId = opt("TRENDYOL_RETURN_ADDRESS_ID");
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
          dimensionalWeight: p.desi, description: p.detail.slice(0, 30000),
          listPrice: p.price, salePrice: p.price, vatRate: Number(p.cat.vat_rate ?? ctx.vatRate),
          ...(shipmentAddressId ? { shipmentAddressId } : {}), ...(returningAddressId ? { returningAddressId } : {}),
          images: p.images.slice(0, 8).map((url: string) => ({ url })), attributes: p.cat.attributes ?? [],
        });
      }
      for (const batch of chunk(payloads, 100)) {
        try {
          const r = await tg(`/product/sellers/${SELLER_ID}/v2/products`, { method: "POST", body: JSON.stringify({ items: batch }) });
          res.ok += batch.length; res.batchIds.push(r.batchRequestId);
        } catch (e: any) { res.failed++; console.error(e.message); }
        await sleep(500);
      }
      return res;
    },

    // Toplu isteklerin ürün bazlı sonucu: failureReasons panelde görünsün
    async checkBatches(ids: string[]): Promise<BatchCheck> {
      const out: BatchCheck = { checked: 0, pending: 0, failedItems: 0, reasons: [] };
      let todo = ids.filter(Boolean);
      for (let round = 0; round < 5 && todo.length; round++) {
        await sleep(round === 0 ? 10000 : 20000);
        const next: string[] = [];
        for (const id of todo) {
          try {
            const r = await tg(`/product/sellers/${SELLER_ID}/products/batch-requests/${id}`);
            const its: any[] = r.items ?? [];
            if (r.status === "IN_PROGRESS" || (!r.status && !its.length)) { next.push(id); continue; }
            out.checked++;
            for (const it of its) {
              if (it.status !== "FAILED") continue;
              out.failedItems++;
              if (out.reasons.length < 30) out.reasons.push(`${it.requestItem?.barcode ?? "?"}: ${(it.failureReasons ?? []).join(" | ")}`);
            }
          } catch (e: any) { next.push(id); console.error(e.message); }
          await sleep(300);
        }
        todo = next;
      }
      out.pending = todo.length;
      return out;
    },

    diagnostics(xml, linkedCount) {
      const xmlBarcodes = new Set(xml.map((r) => String(r.barcode ?? "").trim()).filter(Boolean));
      const xmlPc = new Set(xml.map((r) => String(r.productCode ?? "").trim()).filter(Boolean));
      const stat = (f: (i: any) => string, S: Set<string>) => tgItems.filter((i) => f(i) && S.has(f(i))).length;
      return {
        listingTotals: { ...totals, approvedVariantsLoaded: tgItems.length, closed: tgItems.filter((i) => i.closed).length, liveCommission: liveComm.size },
        matchStats: {
          barcode_to_barcode: linkedCount,
          stockCode_to_barcode: stat((i) => i.stockCode, xmlBarcodes),
          stockCode_to_productCode: stat((i) => i.stockCode, xmlPc),
          productMainId_to_productCode: stat((i) => i.productMainId, xmlPc),
        },
        sampleTrendyol: tgItems.slice(0, 3),
      };
    },
  };
}
