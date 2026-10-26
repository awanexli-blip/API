// Hepsiburada adaptörü.
// UYARI: Resmi doküman (developers.hepsiburada.com) bot korumalı; uç yolları ve alan adları açık kaynak
// kütüphaneden (github.com/bagbaq/hepsiburada-api) ve ikincil kaynaklardan. Entegratör hesabı gelince
// test (SIT) ortamında doğrulanmalı. Varsayılan ortam SIT'tir; canlı için HB_ENV=prod.
import { readFileSync } from "node:fs";
import { env, sleep, chunk, san } from "../core/util.ts";
import { defaultFor, inferAttribute, inferCustom } from "../core/attr-infer.ts";
import { hbCommissionMatcher } from "./hepsiburada-commission.ts";
import { jpgUrl } from "../core/img-proxy.ts";
import { noteMissing } from "../core/attr-options.ts";

// Garanti (K, 22.10): yalnızca elektrikli/elektronik ürünlerde 24 ay (ithalatçı garantili, faturalı); diğerlerinde 0
const ELECTRONIC = /elektron|elektrik|şarj|pilli|usb|bluetooth|kulaklık|hoparlör|\bled\b|makine|makinası|cihaz|akıllı saat|powerbank|adaptör|lamba|vantilatör|\bfan\b|ısıtıcı|kamera|mikrofon|tıraş|epilatör|süpürge|terazi|tartı|baskül|radyo|drone|konsol|projeksiyon|kettle|blender|kompresör|watt|\d+\s?w\b|\d+\s?v\b|\d+\s?mah\b/i;
export const hbWarrantyMonths = (title: string, category = "") => (ELECTRONIC.test(`${title} ${category}`) ? 24 : 0);
import type { BatchCheck, BatchResult, ClaimIn, Commission, InventoryItem, Listing, Marketplace, NewProduct, OrderIn } from "./types.ts";

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
// Değer listesinde tam ad yoksa içinde geçen genel seçenek ("Unisex (Kadın/Erkek)", "Universal / Tüm Araçlar", "Diğer Markalar")
const GENERIC = [/unisex/, /universal|üniversal|evrensel|tüm araç|tüm model|tüm marka|her araç/, /^standart/, /belirtilmemi/, /^diğer/, /karışık|çok renk/];
// Değer listesi olmayan (serbest metin) zorunlu alanlar için ada göre güvenli değer
const FREE_TEXT: [RegExp, string][] = [[/cinsiyet/i, "Unisex"], [/araç (marka|model)|arac (marka|model)|uyumlu (marka|model)/i, "Universal"], [/renk|color/i, "Çok Renkli"]];
const lo = (s: string) => s.replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr");
// Sıra: panel/ürün değeri (given) > ürün kaydındaki özellik (defaults: tedarikçi varsayılanı + Trendyol gönderiminde öğrenilen, adıyla) >
// başlık/açıklamadan çıkarım (attr-infer) > başlıkta geçen değer > nötr değer
export async function hbFillAttributes(c: ReturnType<typeof hbClient>, categoryId: string | number, title: string, given: Record<string, unknown> = {}, defaults: Record<string, string> = {}, description = "", images: string[] = [], warranty: number | null = null, catName: string | null = null) {
  const out: Record<string, unknown> = { ...given };
  const missing: string[] = [];
  const learned: Record<string, string> = {};
  for (const a of await hbCategoryAttributes(c, categoryId)) {
    // Görsel alanları ("Görsel1", canlıda kimliği Image1 değil): ürünün N. görseli, kimliğiyle yazılır
    const img = /^(görsel|gorsel|image)\s*(\d+)$/i.exec(lo(a.name).trim()) ?? /^(görsel|gorsel|image)\s*(\d+)$/i.exec(lo(a.id).trim());
    if (img) {
      const url = images[Number(img[2]) - 1];
      if (url) out[a.id] = url; else if (a.mandatory) missing.push(a.name);
      continue;
    }
    // Ürün/varyant kaydındaki değer (adıyla ya da eş anlamlısıyla: "Beden: 42" -> Numara / numara_variant_property)
    const def = defaultFor(defaults, a.name, a.id);
    // Zorunlu olmayan özellik (varyant numarası/rengi) yalnızca kayıtta değeri varsa yazılır
    if ((!a.mandatory && !def) || BASE_KEYS.has(lo(a.id)) || out[a.id] != null) continue;
    if (/garanti/i.test(a.name) && /süre|ay/i.test(a.name) && warranty != null) { out[a.id] = String(warranty); continue; }
    // Garantisiz üründe garanti tipi: listede "garantisiz / yok" varsa o (tedarikçi varsayılanı "İthalatçı Garantili" yazılmasın)
    if (/garanti/i.test(a.name) && warranty === 0) {
      let gv: string[] = [];
      try { gv = await hbAttributeValues(c, categoryId, a.id); } catch { /* serbest metin */ }
      const none = gv.find((v) => /garantisiz|garanti yok|^yok$|^0/i.test(lo(v)));
      if (none) { out[a.id] = none; continue; }
    }
    let vals: string[] = [];
    try { vals = await hbAttributeValues(c, categoryId, a.id); } catch { /* serbest metin olabilir */ }
    // Ürün kaydındaki değer: "A|B|C" seçeneklerinden listede olan ilk değer, liste yoksa sonuncusu
    const opts = String(def ?? "").split("|").map((x) => x.trim()).filter(Boolean);
    const sq = (s: string) => lo(s).replace(/[\s,]+/g, "").replace(/numara$/, "");
    const fromDef = vals.length ? opts.map((o) => vals.find((v) => lo(v) === lo(o)) ?? vals.find((v) => sq(v) === sq(o))).find(Boolean) : opts[opts.length - 1];
    if (!a.mandatory) { if (fromDef) out[a.id] = fromDef; continue; }
    const inferred = fromDef ? undefined : vals.length ? inferAttribute(a.name, vals.map((v, i) => ({ id: i, name: v })), title, description)?.name : inferCustom(a.name, title, description) ?? undefined;
    const t = " " + lo(title).replace(/[^0-9a-zçğıöşü]+/g, " ") + " ";
    const hit = vals.filter((v) => v && t.includes(" " + lo(v) + " ")).sort((x, y) => y.length - x.length)[0];
    const neutral = NEUTRAL.map((n) => vals.find((v) => lo(v) === n)).find(Boolean);
    const generic = neutral ? undefined : GENERIC.map((re) => vals.find((v) => re.test(lo(v)))).find(Boolean);
    const free = vals.length ? undefined : FREE_TEXT.find(([re]) => re.test(a.name))?.[1];
    const val = fromDef ?? inferred ?? hit ?? neutral ?? generic ?? free;
    if (val) out[a.id] = val;
    else { missing.push(a.name); noteMissing("hepsiburada", categoryId, a.name, vals, vals.length === 0, catName); }
    if (!fromDef && (inferred || hit)) learned[a.name] = String(inferred ?? hit);
    await sleep(200);
  }
  return { attributes: out, missing, learned };
}

// Yaprak kategoriler (başlıktan kategori bulmak için); yol: üst kategoriler + ad
export async function hbCategoryLeaves(c: ReturnType<typeof hbClient>) {
  const out: { id: string; name: string; path: string[] }[] = [];
  for (let page = 0; page < 100; page++) {
    const r = await c.hb(`${c.MPOP}/product/api/categories/get-all-categories?leaf=true&status=ACTIVE&available=true&version=1&page=${page}&size=1000`);
    const list = firstArray(r);
    for (const x of list) {
      const name = String(x.name ?? x.displayName ?? "");
      const path = Array.isArray(x.paths) ? x.paths.map(String) : typeof x.paths === "string" ? x.paths.split(">").map((s: string) => s.trim()) : [];
      // Kitap/dergi kategorileri atlanır: tedarikçide kitap yok, "Boyama Kitabı" gibi başlıklar yazar/yayın tarihi isteyen kategoriye düşüyordu
      if (name && !/\b(e-)?kitap(lar|ları)?\b|\bdergi/i.test([...path, name].slice(-2).join(" "))) out.push({ id: String(x.categoryId ?? x.id), name, path: path[path.length - 1] === name ? path : [...path, name] });
    }
    if (list.length < 1000 || (r?.totalPages && page + 1 >= r.totalPages)) break;
    await sleep(300);
  }
  return out;
}

export function createHepsiburada(): Marketplace {
  const client = hbClient();
  const { MERCHANT, prod, MPOP, LISTING, hb, trackingId } = client;

  const items: any[] = [];
  let imgCheck: string | null = null;

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

    // Komisyon: panel kategori oranı > EK.4 kategori tablosu (HB kategori adı, yoksa başlık) > varsayılan. Oranlar +KDV (commission_plus_vat).
    commission(_listingId, xmlCategory, panelRate, defaultRate, hint): Commission {
      if (panelRate != null) return { rate: panelRate, source: "panel" };
      const m = hbCommissionMatcher()(hint?.category ?? "", hint?.title ?? "", xmlCategory);
      if (m) return { rate: m.rate, source: "kategori" };
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
      // Görselsiz ilan açılmasın: JPG dönüştürücü (panel /api/img) bu çalışmada bir kez denenir; çalışmıyorsa hiçbir ürün gönderilmez
      const probe = list.flatMap((p) => p.images).find((u) => jpgUrl(u) !== u);
      if (probe && imgCheck === null) {
        try {
          const r = await fetch(jpgUrl(probe), { signal: AbortSignal.timeout(60000) });
          imgCheck = r.ok && /image\/jpeg/.test(r.headers.get("content-type") ?? "") ? "ok" : `HTTP ${r.status}`;
          await r.body?.cancel().catch(() => {});
        } catch (e: any) { imgCheck = String(e?.message ?? e).slice(0, 100); }
      }
      if (probe && imgCheck !== "ok") {
        for (const p of list) { ctx.skip("görsel dönüştürücü çalışmıyor"); (res.failedItems ??= []).push({ id: p.id, reason: `Görsel JPG dönüştürücü çalışmıyor (${imgCheck}); panel adresi (PANEL_URL) ve anahtar Vercel ile aynı olmalı` }); }
        return res;
      }
      const used = new Set<string>();
      const payloads: any[] = [];
      // Her ürünün ilk görseli gönderimden önce dönüştürücüden geçirilir (önbelleğe alınır, hata varsa ürün bu turda gönderilmez)
      const imgOk = new Map<string, boolean>();
      const firstImgs = [...new Set(list.map((p) => p.images[0]).filter((u): u is string => !!u && jpgUrl(u) !== u))];
      for (let i = 0; i < firstImgs.length; i += 8) {
        await Promise.all(firstImgs.slice(i, i + 8).map(async (u) => {
          for (let t = 0; t < 2 && !imgOk.get(u); t++) {
            try { const r = await fetch(jpgUrl(u), { signal: AbortSignal.timeout(45000) }); imgOk.set(u, r.ok); await r.body?.cancel().catch(() => {}); } catch { imgOk.set(u, false); }
          }
        }));
      }
      for (const p of list) {
        const no = (why: string) => { ctx.skip(why); (res.failedItems ??= []).push({ id: p.id, reason: why.slice(0, 500) }); };
        if (!p.images.length) { no("görsel yok"); continue; }
        if (imgOk.get(p.images[0]) === false) { no("görsel hazırlanamadı (JPG dönüştürücü)"); continue; }
        if (used.has(p.id)) { no("aynı stok koduna dönüşen ürün kodu"); continue; }
        used.add(p.id);
        const imgs = p.images.map((u) => jpgUrl(u)); // WebP -> JPG (HB WebP göstermiyor)
        let extra: Record<string, unknown> = {};
        for (const a of Array.isArray(p.cat.attributes) ? p.cat.attributes : []) if (a?.name != null) extra[a.name] = a.value; // panelden: [{name, value}]
        // Zorunlu kategori özellikleri: başlıktaki değer / nötr değer; doldurulamazsa gönderme
        try {
          const f = await hbFillAttributes(client, p.cat.category_id, p.name, extra, p.defaults ?? {}, p.detail ?? "", imgs, hbWarrantyMonths(p.name), p.catName ?? null);
          if (f.missing.length) { no(`zorunlu özellik doldurulamadı: ${f.missing.join(", ")}`); continue; }
          extra = f.attributes;
          p.learned = f.learned;
        } catch (e: any) { console.error("özellik listesi alınamadı:", e.message); }
        payloads.push({
          categoryId: Number(p.cat.category_id),
          merchant: MERCHANT,
          attributes: {
            merchantSku: p.id, VaryantGroupID: (p.groupId ?? p.id).slice(0, 40), Barcode: p.id,
            UrunAdi: p.name.slice(0, 200), UrunAciklamasi: p.detail.slice(0, 30000) || p.name,
            Marka: ctx.brandName || BRAND_NAME, GarantiSuresi: hbWarrantyMonths(p.name), kg: String(p.desi), tax_vat_rate: String(Number(p.cat.vat_rate ?? ctx.vatRate)),
            price: String(p.price).replace(".", ","), stock: String(Math.min(Math.floor(p.qty), 20000)),
            ...Object.fromEntries(imgs.slice(0, 5).map((u, i) => [`Image${i + 1}`, u])),
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

    categoryLeaves: () => hbCategoryLeaves(client),

    // quick: sonradan yenileme (worker/core/mp-status.ts) için beklemeden tek tur
    async checkBatches(ids: string[], opts: { quick?: boolean } = {}): Promise<BatchCheck> {
      const out: BatchCheck = { checked: 0, pending: 0, failedItems: 0, reasons: [], states: [], done: [] };
      const url = (id: string) => {
        const [kind, tid] = id.split(":");
        if (!tid) return null;
        if (kind === "stock") return `${LISTING}/listings/merchantid/${MERCHANT}/stock-uploads/id/${tid}`;
        if (kind === "price") return `${LISTING}/listings/merchantid/${MERCHANT}/price-uploads/id/${tid}`;
        return `${MPOP}/product/api/products/status/${tid}`;
      };
      let todo = ids.filter((i) => url(i));
      for (let round = 0; round < (opts.quick ? 1 : 5) && todo.length; round++) {
        if (!opts.quick) await sleep(round === 0 ? 10000 : 20000);
        const next: string[] = [];
        for (const id of todo) {
          try {
            const r = await hb(url(id)!);
            const status = String(r.status ?? r.data?.status ?? "").toUpperCase();
            if (["PENDING", "IN_PROGRESS", "PROCESSING", "WAITING"].includes(status)) { next.push(id); continue; }
            out.checked++;
            // Ürün sonucu (canlıda doğrulandı 22.10): data[] { merchantSku, importStatus: SUCCESS|..., productStatus: "Satışa Hazır"|"Incelenecek"|...,
            // validationResults[], rejectReasonsMessages[], importMessages[] }, sayfalı (totalPages). Stok/fiyat yüklemesinde errors[].
            let list: any[] = Array.isArray(r.errors) ? r.errors : firstArray(r);
            if (id.startsWith("product:") && Number(r.totalPages) > 1) {
              for (let page = 1; page < Math.min(Number(r.totalPages), 50); page++) {
                await sleep(300);
                const rp = await hb(`${url(id)}?page=${page}&size=20`).catch(() => null);
                const more = rp ? firstArray(rp) : [];
                if (!more.length) break;
                list = list.concat(more);
              }
            }
            const msgs = (x: any) => [...(x?.validationResults ?? []), ...(x?.rejectReasonsMessages ?? []), ...(x?.importMessages ?? []), ...(x?.errors ?? [])]
              .map((m: any) => (typeof m === "string" ? m : m?.message ? [m.attributeName, m.message].filter(Boolean).join(": ") : m?.description ?? JSON.stringify(m))).filter(Boolean);
            // importStatus PROCESSING: HB henüz işliyor (hata değil, sonra yeniden sorulur)
            const busy = (x: any) => /^(PROCESSING|PENDING|IN_PROGRESS|WAITING)$/i.test(String(x?.importStatus ?? ""));
            const bad = (x: any) => !busy(x) && ((x?.importStatus && String(x.importStatus).toUpperCase() !== "SUCCESS") || /red|reject|hata|fail|error|invalid|başarısız/i.test(String(x?.productStatus ?? x?.status ?? ""))
              || (Array.isArray(x?.validationResults) && x.validationResults.length) || (Array.isArray(x?.rejectReasonsMessages) && x.rejectReasonsMessages.length) || (Array.isArray(x?.errors) && x.errors.length));
            for (const x of list) if (x?.productStatus) { const k = String(x.productStatus); (out.statuses ??= {})[k] = (out.statuses[k] ?? 0) + 1; }
            if (id.startsWith("product:")) {
              let open = 0;
              for (const x of list) {
                const sku = String(x?.merchantSku ?? "");
                if (!sku) continue;
                const b = !!bad(x), status = String(x.productStatus ?? (busy(x) ? "HB işliyor" : x.importStatus ?? ""));
                // Kesin sonuç: satışa hazır ya da hatalı; "İncelenecek" ve işleniyor sonra yeniden sorulur
                const final = b || /satışa hazır|satista|aktif/i.test(status);
                if (!final) open++;
                out.states!.push({ id: sku, status, reasons: msgs(x).join(" · ").slice(0, 500), bad: b, final });
              }
              if (!open && list.length) out.done!.push(id);
            } else out.done!.push(id);
            const errs = list.filter(bad);
            out.failedItems += errs.length;
            for (const e of errs) {
              const sku = String(e.merchantSku ?? e.sku ?? e.barcode ?? "");
              const why = `Hepsiburada: ${[e.productStatus, e.importStatus !== "SUCCESS" ? e.importStatus : null, ...msgs(e)].filter(Boolean).join(" · ")}`.slice(0, 500);
              if (sku) (out.failed ??= []).push({ id: sku, reason: why });
              if (out.reasons.length < 30) out.reasons.push(`${sku}: ${why}`.slice(0, 300));
            }
          } catch (e: any) { next.push(id); console.error(e.message); }
          await sleep(300);
        }
        todo = next;
      }
      out.pending = todo.length;
      return out;
    },

    // Siparişler (OMS, salt okunur). Resmi doküman bot korumalı: uçlar açık kaynak istemcilerden, her biri ayrı denenir ve
    // sonuç (HTTP durumu, kayıt sayısı, alan adları; kişisel veri yok) orderDiag'a yazılır. Sipariş kimliği = sipariş no
    // (paketlenince paket no değişse de kopya olmaz). Alıcı ad + adres yalnızca tedarikçiye sipariş için (K kararı 23.10).
    async fetchOrders(fromMs: number, toMs: number): Promise<OrderIn[]> {
      const sources: [string, string, boolean][] = [
        [`/orders/merchantid/${MERCHANT}`, "Open", false],              // ödemesi tamamlanmış, paketlenmemiş
        [`/packages/merchantid/${MERCHANT}`, "Packaged", false],        // paketlenmiş, kargoya verilmemiş
        [`/packages/merchantid/${MERCHANT}/shipped`, "Shipped", true],
        [`/packages/merchantid/${MERCHANT}/delivered`, "Delivered", true],
        [`/packages/merchantid/${MERCHANT}/undelivered`, "Undelivered", true],
        [`/orders/merchantid/${MERCHANT}/cancelled`, "Cancelled", true],
      ];
      const fmt = (ms: number) => new Date(ms + 3 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
      const diag: Record<string, unknown> = {};
      const byOrder = new Map<string, OrderIn>();
      for (const [path, tag, dated] of sources) {
        const d: Record<string, unknown> = {};
        diag[tag] = d;
        let n = 0;
        try {
          let useDates = dated;
          for (let offset = 0, page = 0; page < 30; page++, offset += 100) {
            const q = `?offset=${offset}&limit=100${useDates ? `&begindate=${encodeURIComponent(fmt(fromMs))}&enddate=${encodeURIComponent(fmt(toMs))}` : ""}`;
            let r: any;
            try { r = await hb(`${client.OMS}${path}${q}`); }
            catch (e: any) {
              if (!useDates || !/ 400 /.test(String(e?.message))) throw e;
              useDates = false; d.noDates = true;
              r = await hb(`${client.OMS}${path}?offset=${offset}&limit=100`);
            }
            const list = Array.isArray(r) ? r : firstArray(r);
            if (page === 0) { d.keys = Object.keys(r ?? {}).slice(0, 12).join(","); if (list[0]) d.itemKeys = Object.keys(list[0]).sort().join(",").slice(0, 600); }
            for (const x of list) { const o = hbOrder(x, tag); if (!o) continue; n++; mergeOrder(byOrder, o); }
            await sleep(300);
            const total = Number(r?.totalCount ?? r?.total ?? NaN);
            if (list.length < 100 || (Number.isFinite(total) && offset + 100 >= total)) break;
          }
          d.ok = n;
        } catch (e: any) { d.error = String(e?.message ?? e).slice(0, 160); }
      }
      this.orderDiag = diag;
      return [...byOrder.values()].filter((o) => !o.orderedAt || (o.orderedAt >= fromMs - 86400000));
    },

    // İade talepleri (claims; uç doğrulanmadı, hata olursa boş döner ve teşhise yazılır)
    async fetchClaims(fromMs: number): Promise<ClaimIn[]> {
      const out: ClaimIn[] = [];
      for (let offset = 0, page = 0; page < 20; page++, offset += 100) {
        const r = await hb(`${client.OMS}/claims/merchantid/${MERCHANT}?offset=${offset}&limit=100`);
        const list = Array.isArray(r) ? r : firstArray(r);
        for (const c of list) {
          const id = String(c.claimNumber ?? c.claimId ?? c.id ?? "");
          if (!id) continue;
          const at = Date.parse(c.createdDate ?? c.claimDate ?? c.requestDate ?? "") || null;
          if (at && at < fromMs) continue;
          const its: any[] = c.items ?? c.claimItems ?? c.lineItems ?? [c];
          const lines = its.map((it) => ({ key: String(it.merchantSku ?? it.sku ?? ""), title: String(it.productName ?? it.name ?? "").slice(0, 200), qty: Number(it.quantity ?? 1) || 1,
            price: money(it.price ?? it.unitPrice ?? it.totalPrice) ?? 0, status: String(it.status ?? c.status ?? ""), reason: it.reason ?? it.claimReason ?? c.reason ?? c.claimReason ?? null }));
          out.push({ id, orderNo: c.orderNumber ? String(c.orderNumber) : null, packageId: null, status: String(c.status ?? ""), reason: lines[0]?.reason ?? null, reasonCode: c.reasonCode ?? null,
            claimedAt: at, amount: Math.round(lines.reduce((t, l) => t + l.price * l.qty, 0) * 100) / 100, cargo: c.cargoCompany ?? null, tracking: c.trackingNumber ?? null, lines });
        }
        await sleep(300);
        if (list.length < 100) break;
      }
      return out;
    },

    diagnostics() {
      return { hbEnv: prod ? "prod" : "sit", listingTotals: { loaded: items.length, closed: items.filter((i) => i.closed).length }, sampleHepsiburada: items.slice(0, 3) };
    },
  };
}

// Tutar alanı sayı ya da { amount, currency } olabilir
const money = (x: any): number | null => { const v = x != null && typeof x === "object" ? x.amount ?? x.value : x; return v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null; };
const msOf = (x: any): number | null => (x == null ? null : typeof x === "number" ? x : Date.parse(String(x)) || null);

// OMS kaydı (satır ya da paket) -> sipariş. Ad/adres yalnızca tedarikçiye iletmek için; loglanmaz.
export function hbOrder(x: any, tag: string): OrderIn | null {
  const its: any[] = x.items ?? x.lineItems ?? x.orderLines ?? x.lines ?? [x];
  const first = its[0] ?? {};
  const orderNo = String(x.orderNumber ?? first.orderNumber ?? x.packageNumber ?? "");
  if (!orderNo) return null;
  const lines = its.map((it, i) => {
    const qty = Number(it.quantity ?? 1) || 1;
    const unit = money(it.unitPrice) ?? money(it.price) ?? ((money(it.totalPrice) ?? 0) / qty);
    return { lineNo: i + 1, lineId: String(it.id ?? it.lineItemId ?? it.orderLineId ?? i), key: String(it.merchantSku ?? it.sku ?? ""), title: String(it.productName ?? it.name ?? "").slice(0, 200), qty, unitPrice: unit,
      tyDiscount: money(it.hbDiscount?.totalPrice ?? it.hbDiscount), discount: money(it.totalDiscount ?? it.merchantDiscount?.totalPrice), commissionAmt: money(it.commission),
      commissionRate: Number(it.commissionRate) > 0 && Number(it.commissionRate) < 100 ? Number(it.commissionRate) / 100 : null } as any;
  });
  const a = x.shippingAddress ?? first.shippingAddress ?? x.deliveryAddress ?? null;
  const total = lines.reduce((t, l) => t + l.unitPrice * l.qty, 0);
  return {
    packageId: orderNo, orderNo, status: String(x.status ?? first.status ?? tag), orderedAt: msOf(x.orderDate ?? first.orderDate), total: Math.round(total * 100) / 100, currency: "TRY",
    deadline: msOf(x.dueDate ?? first.dueDate ?? x.deliveryDueDate), cargo: x.cargoCompany ?? first.cargoCompany ?? x.cargoCompanyModel?.name ?? null,
    tracking: x.trackingNumber ?? x.barcode ?? first.trackingNumber ?? null, city: a?.city ?? null,
    customer: { name: String(x.customerName ?? first.customerName ?? a?.name ?? x.recipientName ?? "").trim() || null,
      address: a ? { fullAddress: a.address ?? a.fullAddress ?? undefined, district: a.district ?? a.town ?? undefined, city: a.city ?? undefined, postalCode: a.postalCode ?? undefined } : null },
    lines,
  };
}

// Aynı sipariş birden çok listede (açık, paketli, kargoda) görünebilir: sonraki listenin durumu geçerli, satırlar satır kimliğiyle birleşir
export function mergeOrder(map: Map<string, OrderIn>, o: OrderIn) {
  const cur = map.get(o.packageId);
  if (!cur) { map.set(o.packageId, o); return; }
  const seen = new Set(cur.lines.map((l: any) => l.lineId));
  const extra = o.lines.filter((l: any) => !seen.has(l.lineId));
  const lines = [...cur.lines, ...extra].map((l, i) => ({ ...l, lineNo: i + 1 }));
  map.set(o.packageId, { ...cur, ...o, customer: o.customer?.name ? o.customer : cur.customer, tracking: o.tracking ?? cur.tracking, cargo: o.cargo ?? cur.cargo,
    orderedAt: o.orderedAt ?? cur.orderedAt, deadline: o.deadline ?? cur.deadline, lines, total: Math.round(lines.reduce((t, l) => t + l.unitPrice * l.qty, 0) * 100) / 100 });
}
