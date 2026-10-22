// Trendyol adaptörü — Product V2 servisleri (V1 15.10.2026'da kapandı).
// Uç listesi: https://developers.trendyol.com/v3.0/docs/product-v2-api-endpoint.md
import { readFileSync } from "node:fs";
import { inferAttribute, inferCustom } from "../core/attr-infer.ts";
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
  // Onaylı ilanların özellikleri (yeni ürünün zorunlu özelliklerini benzer üründen doldurmak için)
  type Attr = { attributeId: number; attributeValueId?: number; customAttributeValue?: string; name?: string; value?: string };
  const attrsByBarcode = new Map<string, Attr[]>();
  const catOfBarcode = new Map<string, string>();
  const barcodesByCat = new Map<string, string[]>();
  const toAttrs = (list: any[]): Attr[] => {
    const out: Attr[] = [];
    for (const a of list ?? []) {
      const vals: any[] = a.attributeValues ?? [{ attributeValueId: a.attributeValueId, attributeValue: a.attributeValue }];
      const v = vals[0];
      if (!a.attributeId || !v) continue;
      if (v.attributeValueId) out.push({ attributeId: Number(a.attributeId), attributeValueId: Number(v.attributeValueId), name: a.attributeName, value: v.attributeValue });
      else if (v.attributeValue) out.push({ attributeId: Number(a.attributeId), customAttributeValue: String(v.attributeValue), name: a.attributeName, value: v.attributeValue });
    }
    return out;
  };
  const totals: Record<string, number> = {};
  // Mağazadaki marka dağılımı (panel Markalar sekmesi): varyant sayısı ve Trendyol'un kapattıkları
  const brandStats = new Map<string, { n: number; closed: number }>();
  // Onay süreci: sistemin açtığı (OS13-) ürünlerin durumu ve ret nedenleri
  const approval = { pendingApproval: 0, rejected: 0, docNeeded: 0, reasons: new Map<string, number>(), samples: [] as string[] };

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

  // Kategori özellikleri ve değerleri (çalışma boyunca önbellek)
  const catAttrCache = new Map<string, any[]>();
  async function categoryAttributes(cid: string): Promise<any[]> {
    if (!catAttrCache.has(cid)) {
      let list: any[] = [];
      try { list = (await tg(`/product/categories/${cid}/attributes`)).categoryAttributes ?? []; } catch (e: any) { console.error(e.message); }
      catAttrCache.set(cid, list);
      await sleep(300);
    }
    return catAttrCache.get(cid)!;
  }
  const valueCache = new Map<string, { id: number; name: string }[]>();
  async function attributeValues(cid: string, aid: number) {
    const key = cid + ":" + aid;
    if (!valueCache.has(key)) {
      const out: { id: number; name: string }[] = [];
      try {
        for (let page = 0; page < 5; page++) {
          const r = await tg(`/product/categories/${cid}/attributes/${aid}/values?page=${page}&size=1000`);
          const list: any[] = r.content ?? r.attributeValues ?? (Array.isArray(r) ? r : []);
          for (const v of list) out.push({ id: Number(v.attributeValueId ?? v.id), name: String(v.attributeValue ?? v.name ?? "") });
          await sleep(300);
          if (!r.totalPages || page + 1 >= r.totalPages) break;
        }
      } catch (e: any) { console.error(e.message); }
      valueCache.set(key, out);
    }
    return valueCache.get(key)!;
  }
  const lo = (s: string) => s.replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr");
  // Belirsiz durumlarda seçilecek nötr değerler (sırayla)
  const NEUTRAL = ["çok renkli", "karışık", "renkli", "tek ebat", "standart", "unisex", "yetişkin", "belirtilmemiş", "diğer"];
  const isColor = (name: string) => /renk|color/i.test(name);

  // Zorunlu özellikleri doldur: panel değeri > (renk ise) başlıktaki renk / nötr renk > benzer onaylı ilan > nötr değer
  async function fillAttributes(p: NewProduct, cid: string): Promise<{ attributes: any[]; missing: string[] }> {
    const out = new Map<number, Attr>();
    for (const a of Array.isArray(p.cat.attributes) ? p.cat.attributes : []) if (a?.attributeId) out.set(Number(a.attributeId), a);
    const refs = [...(p.refs ?? []).filter((b) => catOfBarcode.get(b) === cid), ...(barcodesByCat.get(cid) ?? [])];
    const missing: string[] = [];
    for (const ca of await categoryAttributes(cid)) {
      if (!ca.required) continue;
      const id = Number(ca.attribute?.id), name = String(ca.attribute?.name ?? id);
      if (out.has(id)) continue;
      let val: Attr | undefined;
      if (isColor(name)) {
        const vals = await attributeValues(cid, id);
        const title = " " + lo(p.name).replace(/[^0-9a-zçğıöşü]+/g, " ") + " ";
        const hit = vals.filter((v) => v.name && title.includes(" " + lo(v.name) + " ")).sort((a, b) => b.name.length - a.name.length)[0];
        if (hit) val = { attributeId: id, attributeValueId: hit.id };
        else {
          const neutral = NEUTRAL.map((n) => vals.find((v) => lo(v.name) === n)).find(Boolean);
          if (neutral) val = { attributeId: id, attributeValueId: neutral.id };
          else if (ca.allowCustom) val = { attributeId: id, customAttributeValue: "Çok Renkli" };
        }
      }
      // Tedarikçi varsayılanı (ör. Menşei -> Çin): değer listesinde adıyla aranır, yoksa serbest metin kabul ediliyorsa yazılır
      const def = Object.entries(p.defaults ?? {}).find(([k]) => lo(k) === lo(name))?.[1];
      // Birden çok seçenek "|" ile: "Garanti Yok|0 Ay|0" -> listedeki ilk eşleşen, yoksa (serbest metne izin varsa) sonuncusu
      if (!val && def) {
        const vals = await attributeValues(cid, id);
        const opts = def.split("|").map((x) => x.trim()).filter(Boolean);
        const hit = opts.map((o) => vals.find((v) => lo(v.name) === lo(o))).find(Boolean);
        if (hit) val = { attributeId: id, attributeValueId: hit.id };
        else if (ca.allowCustom && opts.length) val = { attributeId: id, customAttributeValue: opts[opts.length - 1] };
      }
      // Ürünün kendi başlık/açıklamasından (Şarjlı, 44 mm, 10000 mAh, Mikrofon var/yok, 50 Hz...); benzer ilanın değerinden önce gelir
      if (!val) {
        const hit = inferAttribute(name, await attributeValues(cid, id), p.name, p.detail ?? "");
        if (hit) val = { attributeId: id, attributeValueId: hit.id };
        else if (ca.allowCustom) { const c = inferCustom(name, p.name, p.detail ?? ""); if (c) val = { attributeId: id, customAttributeValue: c }; }
      }
      if (!val) for (const b of refs) {
        const a = attrsByBarcode.get(b)?.find((x) => x.attributeId === id);
        if (a) { val = a.attributeValueId ? { attributeId: id, attributeValueId: a.attributeValueId } : { attributeId: id, customAttributeValue: a.customAttributeValue }; break; }
      }
      if (!val) {
        const vals = await attributeValues(cid, id);
        const neutral = NEUTRAL.map((n) => vals.find((v) => lo(v.name) === n)).find(Boolean);
        if (neutral) val = { attributeId: id, attributeValueId: neutral.id };
      }
      if (val) out.set(id, val); else missing.push(name);
    }
    const attributes = [...out.values()].map(({ attributeId, attributeValueId, customAttributeValue }) => (attributeValueId ? { attributeId, attributeValueId } : { attributeId, customAttributeValue }));
    return { attributes, missing };
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
          const bn = String(c.brand?.name ?? (c.brand?.id != null ? `#${c.brand.id}` : "(markasız)"));
          const bs = brandStats.get(bn) ?? { n: 0, closed: 0 }; bs.n++; if (closed) bs.closed++; brandStats.set(bn, bs);
          const comm = Number(v.commission);
          if (Number.isFinite(comm) && comm > 0) liveComm.set(barcode, comm > 1 ? comm / 100 : comm);
          out.set(barcode, { id: barcode, title, price, quantity: Number(v.stock?.quantity), vatRate: Number(v.vatRate), status: closed ? "closed" : "active",
            categoryId: c.category?.id != null ? String(c.category.id) : undefined, categoryName: c.category?.name ?? "", commission: liveComm.get(barcode) });
          if (!closed && c.category?.id != null) {
            const cid = String(c.category.id);
            attrsByBarcode.set(barcode, [...toAttrs(c.attributes), ...toAttrs(v.attributes)]);
            catOfBarcode.set(barcode, cid);
            const l = barcodesByCat.get(cid); if (l) { if (l.length < 50) l.push(barcode); } else barcodesByCat.set(cid, [barcode]);
          }
          tgItems.push({ barcode, stockCode: v.stockCode ? String(v.stockCode) : "", productMainId: c.productMainId ? String(c.productMainId) : "", title, salePrice: price, categoryId: c.category?.id ?? null, categoryName: c.category?.name ?? "", brandId: c.brand?.id ?? null, closed });
        }
      });
      // Onay bekleyen / reddedilen: güncellenmez ama "var" sayılır, aynı ürün ikinci kez açılmasın
      totals.unapproved = await fetchAll(`/product/sellers/${SELLER_ID}/products/unapproved`, 1000, (p) => {
        if (!p.barcode || out.has(String(p.barcode))) return;
        if (String(p.barcode).startsWith(NEW_PREFIX)) {
          if (p.status === "rejected") {
            approval.rejected++;
            for (const r of p.rejectReasonDetails ?? []) {
              const k = String(r.rejectReason ?? r.rejectReasonDetail ?? "?").slice(0, 120);
              approval.reasons.set(k, (approval.reasons.get(k) ?? 0) + 1);
            }
            if (approval.samples.length < 10) approval.samples.push(`${p.barcode}: ${(p.rejectReasonDetails ?? []).map((r: any) => r.rejectReasonDetail ?? r.rejectReason).join(" | ").slice(0, 300)}`);
          } else approval.pendingApproval++;
          if (p.docNeeded) approval.docNeeded++;
        }
        const rejected = p.status === "rejected" ? {
          types: (p.rejectReasonDetails ?? []).map((r: any) => String(r.rejectReason ?? "")).filter(Boolean),
          details: (p.rejectReasonDetails ?? []).map((r: any) => String(r.rejectReasonDetail ?? r.rejectReason ?? "")).filter(Boolean),
          title: p.title != null ? String(p.title) : undefined, description: p.description != null ? String(p.description) : undefined,
          images: Array.isArray(p.images) ? p.images.map((i: any) => String(i?.url ?? i)).filter(Boolean) : undefined,
          categoryId: p.categoryId != null ? String(p.categoryId) : p.category?.id != null ? String(p.category.id) : p.pimCategoryId != null ? String(p.pimCategoryId) : undefined,
          categoryName: p.categoryName ?? p.category?.name,
        } : undefined;
        out.set(String(p.barcode), { id: String(p.barcode), title: String(p.title ?? "").slice(0, 120), price: Number(p.salePrice), quantity: Number(p.quantity), status: "pending", reject: rejected });
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

    async archiveProducts(ids: string[], archived = true): Promise<BatchResult> {
      const res: BatchResult = { ok: 0, failed: 0, batchIds: [] };
      for (const batch of chunk(ids, 1000)) {
        try {
          const r = await tg(`/product/sellers/${SELLER_ID}/products/archive-state`, { method: "PUT", body: JSON.stringify({ items: batch.map((barcode) => ({ barcode, archived })) }) });
          res.ok += batch.length; res.batchIds.push(r.batchRequestId);
        } catch (e: any) { res.failed++; (res.failedItems ??= []).push(...batch.map((id) => ({ id, reason: String(e.message).slice(0, 300) }))); console.error(e.message); }
        await sleep(500);
      }
      return res;
    },

    async deleteProducts(ids: string[]): Promise<BatchResult> {
      const res: BatchResult = { ok: 0, failed: 0, batchIds: [] };
      for (const batch of chunk(ids, 500)) {
        try {
          const r = await tg(`/product/sellers/${SELLER_ID}/products`, { method: "DELETE", body: JSON.stringify({ items: batch.map((barcode) => ({ barcode })) }) });
          res.ok += batch.length; res.batchIds.push(r.batchRequestId);
        } catch (e: any) { res.failed++; (res.failedItems ??= []).push(...batch.map((id) => ({ id, reason: String(e.message).slice(0, 300) }))); console.error(e.message); }
        await sleep(500);
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
        // Gönderilemeyen ürün ürün bazında bildirilir (ilan "error" + neden; "sent" kalmaz)
        const no = (why: string) => { ctx.skip(why); (res.failedItems ??= []).push({ id: p.id, reason: why.slice(0, 500) }); };
        if (used.has(p.id)) { no("aynı barkoda dönüşen ürün kodu"); continue; }
        used.add(p.id);
        const brand = ctx.brandName || BRAND_NAME; // panel (Markalar) > ortam değişkeni > Eco Lounge
        const bId = await brandId(brand);
        if (!bId) { no(`marka Trendyol'da bulunamadı: ${brand}`); continue; }
        const cid = String(p.cat.category_id);
        const { attributes, missing } = await fillAttributes(p, cid);
        if (missing.length) { no(`zorunlu özellik doldurulamadı: ${missing.join(", ")}`); continue; }
        payloads.push({
          barcode: p.id, title: p.name.slice(0, 100), productMainId: p.id, brandId: bId,
          categoryId: Number(p.cat.category_id), quantity: Math.min(Math.floor(p.qty), 20000), stockCode: p.id,
          dimensionalWeight: p.desi, description: p.detail.slice(0, 30000),
          listPrice: p.price, salePrice: p.price, vatRate: Number(p.cat.vat_rate ?? ctx.vatRate),
          ...(shipmentAddressId ? { shipmentAddressId } : {}), ...(returningAddressId ? { returningAddressId } : {}),
          images: p.images.slice(0, 8).map((url: string) => ({ url })), attributes,
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

    // Reddedilen ürünü düzeltip yeniden onaya gönder: yalnızca değişen alanlar (gönderilmeyen alan korunur)
    async updateRejected(items) {
      const res: BatchResult = { ok: 0, failed: 0, batchIds: [] };
      const body = items.map((p) => ({
        barcode: p.id,
        ...(p.title ? { title: p.title.slice(0, 100) } : {}),
        ...(p.description ? { description: p.description.slice(0, 30000) } : {}),
        ...(p.categoryId ? { categoryId: p.categoryId } : {}),
        ...(p.images?.length ? { images: p.images.slice(0, 8).map((url) => ({ url })) } : {}),
      }));
      for (const batch of chunk(body, 500)) {
        try {
          const r = await tg(`/product/sellers/${SELLER_ID}/products/unapproved-bulk-update`, { method: "POST", body: JSON.stringify({ items: batch }) });
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
              (out.failed ??= []).push({ id: String(it.requestItem?.barcode ?? it.requestItem?.product?.barcode ?? ""), reason: (it.failureReasons ?? []).join(" | ").slice(0, 500) });
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
        brands: Object.fromEntries([...brandStats].sort((a, b) => b[1].n - a[1].n).slice(0, 40)),
        listingTotals: { ...totals, approvedVariantsLoaded: tgItems.length, closed: tgItems.filter((i) => i.closed).length, liveCommission: liveComm.size },
        // Sistemin açtığı ürünler: onaylanan (approved listesinde OS13-), bekleyen, reddedilen + ret nedenleri
        newProductApproval: {
          approved: tgItems.filter((i) => i.barcode.startsWith(NEW_PREFIX)).length,
          pendingApproval: approval.pendingApproval, rejected: approval.rejected, docNeeded: approval.docNeeded,
          topReasons: Object.fromEntries([...approval.reasons].sort((a, b) => b[1] - a[1]).slice(0, 10)),
          samples: approval.samples,
        },
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
