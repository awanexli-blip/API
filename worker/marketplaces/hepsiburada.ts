// Hepsiburada adaptörü.
// UYARI: Resmi doküman (developers.hepsiburada.com) bot korumalı; uç yolları ve alan adları açık kaynak
// kütüphaneden (github.com/bagbaq/hepsiburada-api) ve ikincil kaynaklardan. Entegratör hesabı gelince
// test (SIT) ortamında doğrulanmalı. Varsayılan ortam SIT'tir; canlı için HB_ENV=prod.
import { readFileSync } from "node:fs";
import { env, sleep, chunk, san } from "../core/util.ts";
import type { BatchCheck, BatchResult, Commission, InventoryItem, Listing, Marketplace, NewProduct } from "./types.ts";

// Trendyol ile aynı kural: yeni ürünler "OS13-" + XML productCode (ASCII). Eşleştirme ÖS13- de dener.
const SKU_PREFIXES = ["OS13-", "ÖS13-"];
const NEW_PREFIX = "OS13-";
const BRAND_NAME = process.env.HB_BRAND_NAME || process.env.TRENDYOL_BRAND_NAME || "Eco Lounge";

const cargo = JSON.parse(readFileSync(new URL("../data/hepsiburada/cargo.json", import.meta.url), "utf8")) as { carriers: string[]; byDesi: Record<string, number[]> };

// Bağlantı (adaptör ve test aracı ortak kullanır)
export function hbClient() {
  const MERCHANT = env("HB_MERCHANT_ID");
  const USER = env("HB_USERNAME");
  const PASS = env("HB_PASSWORD");
  const prod = process.env.HB_ENV === "prod";
  const sit = prod ? "" : "-sit";
  const MPOP = `https://mpop${sit}.hepsiburada.com`;
  const LISTING = `https://listing-external${sit}.hepsiburada.com`;
  const OMS = `https://oms-external${sit}.hepsiburada.com`;
  const HEADERS: Record<string, string> = {
    Authorization: "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64"),
    "User-Agent": process.env.HB_USER_AGENT || USER,
    Accept: "application/json",
  };
  async function hb(url: string, init?: RequestInit) {
    const isForm = init?.body instanceof FormData;
    const res = await fetch(url, { ...init, headers: { ...HEADERS, ...(isForm ? {} : { "Content-Type": "application/json" }) } });
    const text = await res.text();
    if (!res.ok) throw new Error(`Hepsiburada ${res.status} ${url.replace(/^https:\/\/[^/]+/, "")}: ${text.slice(0, 600)}`);
    try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
  }
  const trackingId = (r: any): string => String(r?.id ?? r?.trackingId ?? r?.data?.trackingId ?? r?.data?.id ?? "");
  return { MERCHANT, USER, prod, MPOP, LISTING, OMS, hb, trackingId };
}

// Yanıt biçimi kesin bilinmediği için içindeki ilk nesne dizisini bul
export function firstArray(r: any): any[] {
  if (Array.isArray(r)) return r;
  for (const k of ["data", "content", "items", "listings", "categories", "attributes", "values"]) if (Array.isArray(r?.[k])) return r[k];
  if (r && typeof r === "object") for (const v of Object.values(r)) { if (Array.isArray(v) && v.length && typeof v[0] === "object") return v as any[]; }
  if (r?.data && typeof r.data === "object") return firstArray(r.data);
  return [];
}

// Kategori özellikleri: {id, name, mandatory, type, values?}. HB yanıtı baseAttributes/attributes/variantAttributes olabilir.
const attrCache = new Map<string, any[]>();
const valCache = new Map<string, string[]>();
export async function hbCategoryAttributes(c: ReturnType<typeof hbClient>, categoryId: string | number) {
  const key = String(categoryId);
  if (attrCache.has(key)) return attrCache.get(key)!;
  const list = await fetchCategoryAttributes(c, categoryId);
  attrCache.set(key, list);
  return list;
}
async function fetchCategoryAttributes(c: ReturnType<typeof hbClient>, categoryId: string | number) {
  const r = await c.hb(`${c.MPOP}/product/api/categories/${categoryId}/attributes`);
  const d = r?.data ?? r;
  const groups: [string, any[]][] = [["base", d?.baseAttributes ?? []], ["category", d?.attributes ?? []], ["variant", d?.variantAttributes ?? []]];
  if (!groups.some(([, l]) => l.length)) groups.push(["category", firstArray(d)]);
  return groups.flatMap(([group, list]) => list.map((a: any) => ({
    group, id: String(a.id ?? a.attributeId ?? a.name), name: String(a.name ?? a.displayName ?? a.id),
    mandatory: !!(a.mandatory ?? a.required), type: String(a.type ?? ""), multiValue: !!a.multiValue,
  })));
}
export async function hbAttributeValues(c: ReturnType<typeof hbClient>, categoryId: string | number, attrId: string) {
  const key = categoryId + ":" + attrId;
  if (valCache.has(key)) return valCache.get(key)!;
  const vals = await fetchAttributeValues(c, categoryId, attrId);
  valCache.set(key, vals);
  return vals;
}
async function fetchAttributeValues(c: ReturnType<typeof hbClient>, categoryId: string | number, attrId: string) {
  const r = await c.hb(`${c.MPOP}/product/api/categories/${categoryId}/attribute/${encodeURIComponent(attrId)}/values?version=4&page=0&size=1000`);
  return firstArray(r).map((v: any) => String(v.value ?? v.name ?? v));
}

// Zorunlu kategori özelliklerini doldur (base alanları: merchantSku, UrunAdi vb. ayrıca doldurulur)
const BASE_KEYS = new Set(["merchantsku", "varyantgroupid", "barcode", "urunadi", "urunaciklamasi", "marka", "garantisuresi", "kg", "tax_vat_rate", "price", "stock", "image1", "image2", "image3", "image4", "image5", "video1"]);
const NEUTRAL = ["çok renkli", "karışık", "renkli", "standart", "tek ebat", "unisex", "yetişkin", "belirtilmemiş", "diğer"];
const lo = (s: string) => s.replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr");
export async function hbFillAttributes(c: ReturnType<typeof hbClient>, categoryId: string | number, title: string, given: Record<string, unknown> = {}) {
  const out: Record<string, unknown> = { ...given };
  const missing: string[] = [];
  for (const a of await hbCategoryAttributes(c, categoryId)) {
    if (!a.mandatory || BASE_KEYS.has(lo(a.id)) || out[a.id] != null) continue;
    let vals: string[] = [];
    try { vals = await hbAttributeValues(c, categoryId, a.id); } catch { /* serbest metin olabilir */ }
    const t = " " + lo(title).replace(/[^0-9a-zçğıöşü]+/g, " ") + " ";
    const hit = vals.filter((v) => v && t.includes(" " + lo(v) + " ")).sort((x, y) => y.length - x.length)[0];
    const neutral = NEUTRAL.map((n) => vals.find((v) => lo(v) === n)).find(Boolean);
    const val = hit ?? neutral ?? (!vals.length && /renk|color/i.test(a.name) ? "Çok Renkli" : undefined);
    if (val) out[a.id] = val; else missing.push(a.name);
    await sleep(200);
  }
  return { attributes: out, missing };
}

export function createHepsiburada(): Marketplace {
  const client = hbClient();
  const { MERCHANT, prod, MPOP, LISTING, hb, trackingId } = client;

  const items: any[] = [];

  return {
    id: "hepsiburada",
    label: "Hepsiburada",

    // Mağazadaki listing\'ler (satıcı stok kodu = merchantSku)
    async loadListings(): Promise<Listing[]> {
      const out: Listing[] = [];
      const limit = 1000;
      for (let offset = 0, guard = 0; guard < 500; guard++, offset += limit) {
        const r = await hb(`${LISTING}/listings/merchantid/${MERCHANT}?offset=${offset}&limit=${limit}`);
        const list: any[] = r.listings ?? r.data ?? [];
        for (const l of list) {
          const sku = String(l.merchantSku ?? "");
          if (!sku) continue;
          const closed = l.isSalable === false || l.isSuspended === true || l.isLocked === true || l.isFrozen === true;
          out.push({ id: sku, title: String(l.productName ?? l.title ?? "").slice(0, 120), price: Number(l.price), quantity: Number(l.availableStock), status: closed ? "closed" : "active" });
          items.push({ sku, hbSku: l.hepsiburadaSku, price: l.price, stock: l.availableStock, closed });
        }
        await sleep(300);
        const total = Number(r.totalCount ?? r.total ?? NaN);
        if (list.length < limit || (Number.isFinite(total) && offset + limit >= total)) break;
      }
      return out;
    },

    findListing(xml, existing) {
      const barcode = String(xml.barcode ?? "").trim();
      const pc = String(xml.productCode ?? "").trim();
      const cands = [...(pc ? SKU_PREFIXES.map((p) => p + san(pc)) : []), pc, barcode].filter(Boolean);
      return cands.find((c) => existing.has(c)) ?? null;
    },

    newListingId(xml) {
      const pc = String(xml.productCode ?? "").trim();
      return NEW_PREFIX + san(pc || String(xml.barcode ?? "").trim());
    },

    // Hepsiburada\'da ürün bazlı canlı komisyon kaynağı yok (doğrulanacak): panel kategori oranı > varsayılan
    commission(_listingId, _xmlCategory, panelRate, defaultRate): Commission {
      if (panelRate != null) return { rate: panelRate, source: "panel" };
      return { rate: defaultRate, source: "varsayilan" };
    },

    // Desi tarifesi (KDV hariç). 60 desi üstü tabloda yok -> en yüksek satır + desi başı artış
    shippingCost(desi: number, carrier = "hepsiJET") {
      const ci = Math.max(0, cargo.carriers.indexOf(carrier));
      const keys = Object.keys(cargo.byDesi).map(Number).sort((a, b) => a - b);
      const max = keys[keys.length - 1];
      const d = Math.max(0, Math.ceil(desi));
      if (d <= max) return cargo.byDesi[String(d)][ci];
      const last = cargo.byDesi[String(max)][ci], prev = cargo.byDesi[String(max - 1)][ci];
      return last + (d - max) * Math.max(0, last - prev);
    },

    // Stok ve fiyat ayrı uçlar; her biri takip numarası döner
    async pushInventory(list: InventoryItem[]): Promise<BatchResult> {
      const res: BatchResult = { ok: 0, failed: 0, batchIds: [] };
      for (const batch of chunk(list, 500)) {
        try {
          const r = await hb(`${LISTING}/listings/merchantid/${MERCHANT}/stock-uploads`, { method: "POST", body: JSON.stringify(batch.map((p) => ({ merchantSku: p.id, availableStock: p.quantity }))) });
          res.batchIds.push("stock:" + trackingId(r));
          const priced = batch.filter((p) => p.price != null);
          if (priced.length) {
            await sleep(300);
            const r2 = await hb(`${LISTING}/listings/merchantid/${MERCHANT}/price-uploads`, { method: "POST", body: JSON.stringify(priced.map((p) => ({ merchantSku: p.id, price: p.price }))) });
            res.batchIds.push("price:" + trackingId(r2));
          }
          res.ok += batch.length;
        } catch (e: any) { res.failed++; console.error(e.message); }
        await sleep(300);
      }
      return res;
    },

    async zeroStock(ids: string[]): Promise<BatchResult> {
      return this.pushInventory(ids.map((id) => ({ id, price: null, quantity: 0 })));
    },

    // Ürün açma: JSON dosyası multipart olarak gönderilir (en fazla 100 ürün)
    async createProducts(list: NewProduct[], ctx): Promise<BatchResult> {
      const res: BatchResult = { ok: 0, failed: 0, batchIds: [] };
      const used = new Set<string>();
      const payloads: any[] = [];
      for (const p of list) {
        if (used.has(p.id)) { ctx.skip("aynı stok koduna dönüşen ürün kodu"); continue; }
        used.add(p.id);
        let extra: Record<string, unknown> = {};
        for (const a of p.cat.attributes ?? []) if (a?.name != null) extra[a.name] = a.value; // panelden: [{name, value}]
        // Zorunlu kategori özellikleri: başlıktaki değer / nötr değer; doldurulamazsa gönderme
        try {
          const f = await hbFillAttributes(client, p.cat.category_id, p.name, extra);
          if (f.missing.length) { ctx.skip(`zorunlu özellik doldurulamadı: ${f.missing.join(", ")}`); continue; }
          extra = f.attributes;
        } catch (e: any) { console.error("özellik listesi alınamadı:", e.message); }
        payloads.push({
          categoryId: Number(p.cat.category_id),
          merchant: MERCHANT,
          attributes: {
            merchantSku: p.id, VaryantGroupID: p.id, Barcode: p.id,
            UrunAdi: p.name.slice(0, 200), UrunAciklamasi: p.detail.slice(0, 30000) || p.name,
            Marka: BRAND_NAME, GarantiSuresi: 24, kg: String(p.desi), tax_vat_rate: String(Number(p.cat.vat_rate ?? ctx.vatRate)),
            price: String(p.price).replace(".", ","), stock: String(Math.min(Math.floor(p.qty), 20000)),
            ...Object.fromEntries(p.images.slice(0, 5).map((u, i) => [`Image${i + 1}`, u])),
            ...extra,
          },
        });
      }
      for (const batch of chunk(payloads, 100)) {
        try {
          const form = new FormData();
          form.append("file", new Blob([JSON.stringify(batch)], { type: "application/json" }), "integrator.json");
          const r = await hb(`${MPOP}/product/api/products/import`, { method: "POST", body: form });
          res.ok += batch.length; res.batchIds.push("product:" + trackingId(r));
        } catch (e: any) { res.failed++; console.error(e.message); }
        await sleep(500);
      }
      return res;
    },

    async checkBatches(ids: string[]): Promise<BatchCheck> {
      const out: BatchCheck = { checked: 0, pending: 0, failedItems: 0, reasons: [] };
      const url = (id: string) => {
        const [kind, tid] = id.split(":");
        if (!tid) return null;
        if (kind === "stock") return `${LISTING}/listings/merchantid/${MERCHANT}/stock-uploads/id/${tid}`;
        if (kind === "price") return `${LISTING}/listings/merchantid/${MERCHANT}/price-uploads/id/${tid}`;
        return `${MPOP}/product/api/products/status/${tid}`;
      };
      let todo = ids.filter((i) => url(i));
      for (let round = 0; round < 5 && todo.length; round++) {
        await sleep(round === 0 ? 10000 : 20000);
        const next: string[] = [];
        for (const id of todo) {
          try {
            const r = await hb(url(id)!);
            const status = String(r.status ?? r.data?.status ?? "").toUpperCase();
            if (["PENDING", "IN_PROGRESS", "PROCESSING", "WAITING"].includes(status)) { next.push(id); continue; }
            out.checked++;
            const errs: any[] = r.errors ?? r.data?.errors ?? (r.data ?? r.items ?? []).filter?.((x: any) => x?.status === "FAILED" || x?.errors?.length) ?? [];
            out.failedItems += errs.length;
            for (const e of errs) if (out.reasons.length < 30) out.reasons.push(`${id.split(":")[0]} ${e.merchantSku ?? e.sku ?? ""}: ${JSON.stringify(e.errors ?? e.message ?? e).slice(0, 200)}`);
          } catch (e: any) { next.push(id); console.error(e.message); }
          await sleep(300);
        }
        todo = next;
      }
      out.pending = todo.length;
      return out;
    },

    diagnostics() {
      return { hbEnv: prod ? "prod" : "sit", listingTotals: { loaded: items.length, closed: items.filter((i) => i.closed).length }, sampleHepsiburada: items.slice(0, 3) };
    },
  };
}
