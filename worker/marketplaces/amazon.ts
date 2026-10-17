// Amazon TR adaptörü — Selling Partner API (SP-API), Avrupa bölgesi.
// Kaynaklar: https://developer-docs.amazon/sp-api/docs/submit-listings-data , .../marketplace-ids (TR = A33AVAJ2PDY3EV)
// Kimlik: LWA (Login with Amazon) refresh token -> access token (x-amz-access-token). AWS imzası (SigV4) artık gerekmiyor.
// Ürün açma: GTIN muafiyeti/Marka Kaydı yokken yalnızca VAR OLAN Amazon ürününe teklif (LISTING_OFFER_ONLY + merchant_suggested_asin).
// Stok/fiyat: JSON_LISTINGS_FEED (toplu PATCH). İlanlar: GET_MERCHANT_LISTINGS_ALL_DATA raporu.
// Canlıda henüz doğrulanmadı: kimlik bilgileri girilince docs/AMAZON_KURULUM.md'deki test aracıyla doğrulanacak.
import { gunzipSync } from "node:zlib";
import { env, sleep, chunk, san, num } from "../core/util.ts";
import type { BatchCheck, BatchResult, CatalogMatch, Commission, InventoryItem, Listing, Marketplace, NewProduct } from "./types.ts";

export const AMAZON_TR = "A33AVAJ2PDY3EV";
// Bekleme süreleri (testte kısaltılır)
const POLL_MS = Number(process.env.AMAZON_POLL_MS ?? 15000);
const GAP_MS = Number(process.env.AMAZON_GAP_MS ?? 2000);

export function amazonClient() {
  const CLIENT_ID = env("AMAZON_LWA_CLIENT_ID");
  const CLIENT_SECRET = env("AMAZON_LWA_CLIENT_SECRET");
  const REFRESH = env("AMAZON_REFRESH_TOKEN");
  const SELLER = env("AMAZON_SELLER_ID");
  const BASE = process.env.AMAZON_ENDPOINT || "https://sellingpartnerapi-eu.amazon.com";
  const TOKEN_URL = process.env.AMAZON_TOKEN_URL || "https://api.amazon.com/auth/o2/token";
  const MKT = process.env.AMAZON_MARKETPLACE_ID || AMAZON_TR;
  let token = "", tokenUntil = 0;

  async function accessToken() {
    if (token && Date.now() < tokenUntil) return token;
    const res = await fetch(TOKEN_URL, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: REFRESH, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) throw new Error(`Amazon giriş (LWA) hatası ${res.status}: ${j.error_description ?? j.error ?? ""}`);
    token = j.access_token; tokenUntil = Date.now() + (Number(j.expires_in ?? 3600) - 120) * 1000;
    return token;
  }

  // 429 (hız sınırı) ve 5xx: artan beklemeyle 5 deneme
  async function sp(path: string, init?: RequestInit): Promise<any> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${BASE}${path}`, { ...init, headers: { "x-amz-access-token": await accessToken(), "Content-Type": "application/json", Accept: "application/json", ...(init?.headers ?? {}) } });
      const text = await res.text();
      if ((res.status === 429 || res.status >= 500) && attempt < 5) { await sleep(GAP_MS * (attempt + 1) ** 2); continue; }
      if (!res.ok) throw new Error(`Amazon ${res.status} ${path.split("?")[0]}: ${text.slice(0, 500)}`);
      return text ? JSON.parse(text) : {};
    }
  }

  // Rapor dokümanı / feed sonucu: imzalı adresten indir (GZIP olabilir)
  async function download(doc: { url: string; compressionAlgorithm?: string }) {
    const res = await fetch(doc.url);
    if (!res.ok) throw new Error(`Amazon doküman indirilemedi (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    return (doc.compressionAlgorithm === "GZIP" ? gunzipSync(buf) : buf).toString("utf8");
  }

  // JSON_LISTINGS_FEED gönder: doküman oluştur -> yükle -> feed başlat. Dönüş: feedId
  async function submitFeed(messages: any[]) {
    const doc = await sp("/feeds/2021-06-30/documents", { method: "POST", body: JSON.stringify({ contentType: "application/json; charset=UTF-8" }) });
    const body = JSON.stringify({ header: { sellerId: SELLER, version: "2.0", issueLocale: "tr_TR" }, messages });
    const up = await fetch(doc.url, { method: "PUT", headers: { "Content-Type": "application/json; charset=UTF-8" }, body });
    if (!up.ok) throw new Error(`Amazon feed yüklenemedi (${up.status})`);
    const f = await sp("/feeds/2021-06-30/feeds", { method: "POST", body: JSON.stringify({ feedType: "JSON_LISTINGS_FEED", marketplaceIds: [MKT], inputFeedDocumentId: doc.feedDocumentId }) });
    return String(f.feedId);
  }

  async function searchCatalog(q: { ean?: string | null; title?: string }): Promise<CatalogMatch[]> {
    const params = new URLSearchParams({ marketplaceIds: MKT, includedData: "summaries,images" });
    let by: CatalogMatch["by"] = "keyword";
    if (q.ean) { params.set("identifiers", q.ean); params.set("identifiersType", q.ean.length === 12 ? "UPC" : "EAN"); by = "ean"; }
    else if (q.title) { params.set("keywords", q.title.split(/\s+/).slice(0, 8).join(",")); params.set("pageSize", "5"); }
    else return [];
    const r = await sp(`/catalog/2022-04-01/items?${params}`);
    return (r.items ?? []).slice(0, 5).map((it: any) => {
      const s = (it.summaries ?? []).find((x: any) => x.marketplaceId === MKT) ?? it.summaries?.[0] ?? {};
      const img = (it.images ?? []).find((x: any) => x.marketplaceId === MKT)?.images?.[0]?.link ?? it.images?.[0]?.images?.[0]?.link;
      return { asin: String(it.asin), title: String(s.itemName ?? ""), brand: s.brand ?? s.brandName, image: img, by };
    });
  }

  return { SELLER, MKT, sp, download, submitFeed, searchCatalog, accessToken };
}

// Gerçek GTIN mi? (rakam, 8/12/13/14 hane, sağlama toplamı; "2" ile başlayan mağaza içi kodlar hariç)
export function isRealGtin(code: string | null | undefined): boolean {
  if (!code || !/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
  if (code.length === 13 && code.startsWith("2")) return false;
  const d = code.split("").map(Number), check = d.pop()!;
  const sum = d.reverse().reduce((t, x, i) => t + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

// Rapor (TSV) -> ilanlar
export function parseListingsReport(tsv: string): Listing[] {
  const lines = tsv.replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const head = lines[0].split("\t").map((h) => h.trim().toLowerCase());
  const col = (name: string) => head.indexOf(name);
  const iSku = col("seller-sku"), iName = col("item-name"), iPrice = col("price"), iQty = col("quantity"), iAsin = col("asin1"), iStatus = col("status");
  return lines.slice(1).map((l) => l.split("\t")).filter((c) => c[iSku]).map((c) => {
    const st = String(c[iStatus] ?? "").toLowerCase();
    return {
      id: c[iSku], title: c[iName] ?? "", price: num(c[iPrice]), quantity: num(c[iQty]), asin: iAsin >= 0 ? c[iAsin] : undefined,
      // Inactive genelde stok 0 demektir, güncellenebilir; Incomplete = eksik ilan (dokunma)
      status: st.includes("incomplete") ? "pending" : "active",
    } as Listing;
  });
}

const price = (MKT: string, value: number) => [{ marketplace_id: MKT, currency: "TRY", our_price: [{ schedule: [{ value_with_tax: Math.round(value * 100) / 100 }] }] }];
const qty = (n: number) => [{ fulfillment_channel_code: "DEFAULT", quantity: Math.max(0, Math.floor(n)) }];

export function createAmazon(): Marketplace {
  const c = amazonClient();
  const feedSkus = new Map<string, string[]>(); // feedId -> messageId sırasıyla SKU'lar (sonuç raporunu ürüne bağlamak için)

  async function sendMessages(messages: any[]): Promise<BatchResult> {
    const res: BatchResult = { ok: 0, failed: 0, batchIds: [] };
    for (const part of chunk(messages, 5000)) {
      const numbered = part.map((m, i) => ({ ...m, messageId: i + 1 }));
      try {
        const id = await c.submitFeed(numbered);
        feedSkus.set(id, numbered.map((m) => m.sku));
        res.ok += part.length; res.batchIds.push(id);
      } catch (e: any) { res.failed++; console.error(e.message); }
      await sleep(GAP_MS);
    }
    return res;
  }

  return {
    id: "amazon",
    label: "Amazon TR",
    requiresCategory: false,
    // Amazon'da SKU = ürün veritabanındaki varyant SKU'su (BayilikXML'de ürün kodu)
    listingKeyFor: (_source, v) => v.sku,
    findCatalogMatches: (q) => c.searchCatalog(q),

    async loadListings(): Promise<Listing[]> {
      const rep = await c.sp("/reports/2021-06-30/reports", { method: "POST", body: JSON.stringify({ reportType: "GET_MERCHANT_LISTINGS_ALL_DATA", marketplaceIds: [c.MKT] }) });
      for (let i = 0; i < 60; i++) {           // en fazla ~15 dk
        await sleep(POLL_MS);
        const st = await c.sp(`/reports/2021-06-30/reports/${rep.reportId}`);
        if (st.processingStatus === "DONE") {
          const doc = await c.sp(`/reports/2021-06-30/documents/${st.reportDocumentId}`);
          return parseListingsReport(await c.download(doc));
        }
        if (st.processingStatus === "CANCELLED") return []; // ilan yoksa Amazon raporu iptal eder
        if (st.processingStatus === "FATAL") throw new Error("Amazon ilan raporu oluşturulamadı (FATAL)");
      }
      throw new Error("Amazon ilan raporu 15 dakikada hazırlanmadı");
    },

    findListing(xml, existing) {
      const sku = san(String(xml.productCode ?? "").trim());
      return sku && existing.has(sku) ? sku : null;
    },
    newListingId: (xml) => san(String(xml.productCode ?? xml.barcode ?? "").trim()),

    // Amazon satış komisyonu (referral fee) kategoriye göre değişir; panel kategori oranı > ayarlardaki varsayılan
    commission(_id, _cat, panelRate, defaultRate): Commission {
      return panelRate != null ? { rate: panelRate, source: "panel" } : { rate: defaultRate, source: "varsayilan" };
    },

    async pushInventory(items: InventoryItem[]): Promise<BatchResult> {
      return sendMessages(items.map((p) => ({
        sku: p.id, operationType: "PATCH", productType: "PRODUCT",
        patches: [
          { op: "replace", path: "/attributes/fulfillment_availability", value: qty(p.quantity) },
          ...(p.price != null ? [{ op: "replace", path: "/attributes/purchasable_offer", value: price(c.MKT, p.price) }] : []),
        ],
      })));
    },

    async zeroStock(ids: string[]): Promise<BatchResult> {
      return sendMessages(ids.map((sku) => ({ sku, operationType: "PATCH", productType: "PRODUCT", patches: [{ op: "replace", path: "/attributes/fulfillment_availability", value: qty(0) }] })));
    },

    // Yalnızca var olan Amazon ürününe teklif (ASIN gerekli). GTIN muafiyeti gelince yeni ürün açma eklenecek.
    async createProducts(items: NewProduct[], ctx): Promise<BatchResult> {
      const ok = items.filter((p) => p.asin);
      for (const p of items) if (!p.asin) ctx.skip("Amazon: ASIN eşleşmesi yok (GTIN muafiyeti olmadan yeni ürün açılamaz)");
      return sendMessages(ok.map((p) => ({
        sku: p.id, operationType: "UPDATE", productType: "PRODUCT", requirements: "LISTING_OFFER_ONLY",
        attributes: {
          condition_type: [{ value: "new_new", marketplace_id: c.MKT }],
          merchant_suggested_asin: [{ value: p.asin, marketplace_id: c.MKT }],
          purchasable_offer: price(c.MKT, p.price),
          fulfillment_availability: qty(p.qty),
        },
      })));
    },

    // Feed sonuçları: işlenince sonuç dokümanındaki ERROR kayıtları ürün bazında
    async checkBatches(ids: string[]): Promise<BatchCheck> {
      const out: BatchCheck = { checked: 0, pending: 0, failedItems: 0, reasons: [] };
      let todo = ids.filter(Boolean);
      for (let round = 0; round < 8 && todo.length; round++) {
        await sleep(round === 0 ? POLL_MS * 2 : POLL_MS * 3);
        const next: string[] = [];
        for (const id of todo) {
          try {
            const f = await c.sp(`/feeds/2021-06-30/feeds/${id}`);
            if (f.processingStatus !== "DONE") { if (["CANCELLED", "FATAL"].includes(f.processingStatus)) out.reasons.push(`feed ${id}: ${f.processingStatus}`); else next.push(id); continue; }
            out.checked++;
            if (!f.resultFeedDocumentId) continue;
            const doc = await c.sp(`/feeds/2021-06-30/documents/${f.resultFeedDocumentId}`);
            const report = JSON.parse(await c.download(doc));
            const skus = feedSkus.get(id) ?? [];
            const bySku = new Map<string, string[]>();
            for (const is of report.issues ?? []) {
              if (is.severity !== "ERROR") continue;
              const sku = skus[Number(is.messageId) - 1] ?? `#${is.messageId}`;
              bySku.set(sku, [...(bySku.get(sku) ?? []), `${is.code ?? ""} ${is.message ?? ""}`.trim()]);
            }
            for (const [sku, msgs] of bySku) {
              out.failedItems++;
              (out.failed ??= []).push({ id: sku, reason: msgs.join(" | ").slice(0, 500) });
              if (out.reasons.length < 30) out.reasons.push(`${sku}: ${msgs.join(" | ")}`);
            }
          } catch (e: any) { next.push(id); console.error(e.message); }
        }
        todo = next;
      }
      out.pending = todo.length;
      return out;
    },
  };
}
