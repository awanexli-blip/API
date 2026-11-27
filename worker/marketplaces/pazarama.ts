// Pazarama (İş Ortağım) adaptörü.
// UYARI: Resmi doküman (isortagimapi.pazarama.com/docs) herkese açık değil / erişilemedi; CANLIDA HİÇBİR UÇ DOĞRULANMADI.
// Kaynaklar (ikincil): anythingmcp.com/guides/pazarama-to-mcp (kimlik doğrulama, limitler, alan adları),
// apps.odoo.com/apps/modules/18.0/pazarama_connector (uç adları), github.com/erhanyapaycicekcilik-cmd/erhan-flowers-erp PR 331/599
// (host, token ve stok/fiyat/ürün uç yolları). İKİNCİL KAYNAKTAN GELEN (canlıda doğrulanmadı): host'lar, token ucu (Basic +
// client_credentials, scope merchantgatewayapi.fullaccess, 1 saat), zarf {success,messageCode,message,data} (HTTP 200 + success=false
// olabilir), uç adları product/create, product/updateStock, product/updatePrice, product/getProductBatchResult,
// category/getCategoryTree, category/getCategoryWithAttributes. VARSAYIM: istek gövdesi anahtarları, liste/marka/sonuç uçları
// (hepsi EP içinde, tek yerde).
// Limitler: iki fiyat/stok güncellemesi arası 10 sn, iki ürün açma arası 10 sn, ürün açma en çok 500, stok/fiyat en çok 3000 kod.
// Canlı yazma varsayılan kapalı: panelde marketplace_settings (enabled/auto_*) açılana kadar sync yazmaz. Kurulum: docs/PAZARAMA_KURULUM.md
import { env, sleep, chunk, san } from "../core/util.ts";
import { defaultFor, matchOptions } from "../core/attr-infer.ts";
import { jpgUrl } from "../core/img-proxy.ts";
import { tyHardBlock } from "../core/ty-safe.ts";
import type { BatchCheck, BatchResult, Commission, InventoryItem, Listing, Marketplace, NewProduct } from "./types.ts";

const SKU_PREFIXES = ["OS13-", "ÖS13-"];
const NEW_PREFIX = "OS13-";
// Kod içi varsayılan marka yok (27.11): marka tedarikçinin panelde ayarlı pazaryeri markasından gelir (HB gibi); yoksa PAZARAMA_BRAND_NAME.
const BRAND_NAME = process.env.PAZARAMA_BRAND_NAME || "";
const API = (process.env.PAZARAMA_API_URL || "https://isortagimapi.pazarama.com").replace(/\/+$/, "");
const AUTH = (process.env.PAZARAMA_AUTH_URL || "https://isortagimgiris.pazarama.com").replace(/\/+$/, "");
const WAIT_MS = 10_000; // Pazarama: iki güncelleme/ürün açma isteği arası en az 10 sn

// Uç yolları tek yerde: canlıda farklı çıkarsa yalnızca burası değişir. "?" = canlıda doğrulanmadı, yolun kendisi tahmin.
export const EP = {
  token: "/connect/token",                              // AUTH host; CANLIDA DOĞRULANDI 27.11 (Basic + scope, cevap data.accessToken)
  create: "/product/create",                            // kaynak: Odoo + PR 331
  updateStock: "/product/updateStock",                  // kaynak: Odoo + PR 331
  updatePrice: "/product/updatePrice",                  // kaynak: Odoo + PR 331
  productBatch: "/product/getProductBatchResult",       // kaynak: Odoo (sorgu anahtarı ?)
  listingResult: "/product/getListingResult",           // ? (stok/fiyat sonucu; ad ikincil kaynaktan)
  approved: "/product/products",                        // CANLIDA 27.11: ?Approved=true&Page=1&Size=5 -> 200 success, data dizi (mağaza boş; sayfalama alanı henüz görülmedi)
  categories: "/category/getCategoryTree",              // CANLIDA DOĞRULANDI 27.11 (resmi doküman; data dizi, 4.274 kategori, leaf alanı)
  categoryAttrs: "/category/getCategoryWithAttributes", // resmi doküman: ?Id=<kategori guid>; attributes[].attributeValues
  brands: "/brand/getBrands",                           // CANLIDA DOĞRULANDI 27.11 (resmi doküman: ?Page=1&Size=100&name=...; data[{id,name,...}])
};

const ok = (r: any) => !(r && typeof r === "object" && r.success === false);
const retriable = (e: any) => /Pazarama (408|429|5\d\d) |fetch failed|ECONNRESET|ETIMEDOUT|timeout/i.test(String(e?.message ?? e));

export function pazaramaClient() {
  const ID = env("PAZARAMA_CLIENT_ID");
  const SECRET = env("PAZARAMA_CLIENT_SECRET");
  const penv = (process.env.PAZARAMA_ENV || "prod").toLowerCase();
  if (penv !== "prod") throw new Error(`PAZARAMA_ENV=${penv}: bilinen test ortamı yok, yalnızca prod`);
  let token = ""; let exp = 0;
  async function getToken(): Promise<string> {
    if (token && Date.now() < exp - 120_000) return token;
    const res = await fetch(AUTH + EP.token, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${ID}:${SECRET}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: "grant_type=client_credentials&scope=merchantgatewayapi.fullaccess",
    });
    const text = await res.text();
    let j: any = {}; try { j = JSON.parse(text); } catch { /* düz metin */ }
    // Gizli bilgi loglanmaz: gövde kısaltılır, token değeri maskelenir
    // Canlıda doğrulandı (27.11): zarf {success, data: {accessToken, expiresIn?}}; standart OAuth (access_token) da okunur
    const tok = j.data?.accessToken ?? j.access_token;
    if (!res.ok || !tok) throw new Error(`Pazarama token ${res.status}: ${text.replace(/"(access_token|accessToken)"\s*:\s*"[^"]*"/g, '"$1":"***"').slice(0, 300)}`);
    token = String(tok); exp = Date.now() + Number(j.data?.expiresIn ?? j.expires_in ?? 3600) * 1000;
    return token;
  }
  /** Tek istek; 401'de token yenilenip bir kez, 429/5xx'te artan beklemeyle (Retry-After'a uyarak) en çok 4 deneme */
  async function pz(path: string, init: { method?: string; body?: unknown } = {}): Promise<any> {
    for (let i = 0, reauth = false; ; i++) {
      try {
        const res = await fetch(API + path, {
          method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
          headers: { Authorization: "Bearer " + (await getToken()), Accept: "application/json", "Content-Type": "application/json" },
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        });
        const text = await res.text();
        if (res.status === 401 && !reauth) { reauth = true; token = ""; i--; continue; }
        if (!res.ok) {
          const ra = Number(res.headers.get("retry-after"));
          if (i < 3 && (res.status === 429 || res.status >= 500)) { await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 60) * 1000 : 5000 * (i + 1)); continue; }
          throw new Error(`Pazarama ${res.status} ${path}: ${text.slice(0, 600)}`);
        }
        let j: any = {}; try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text }; }
        // Canlı 27.11: sonuç yoksa HTTP 200 + success=false + messageCode CAT_60 "Listelenecek veri bulunamadı" (ör. olmayan marka adı): hata değil, boş liste
        if (!ok(j) && (j.messageCode === "CAT_60" || /Listelenecek veri bulunamad/i.test(String(j.message ?? "")))) return { ...j, success: true, data: [] };
        if (!ok(j)) throw new Error(`Pazarama 200 ${path}: ${[j.messageCode, j.message].filter(Boolean).join(" ").slice(0, 400) || "success=false"}`);
        return j;
      } catch (e: any) {
        // 4xx ve token hataları yeniden denenmez; ağ hatası / sunucu hatası denenir
        if (i >= 3 || !retriable(e) || /Pazarama (4\d\d|200|token)/.test(String(e?.message))) throw e;
        await sleep(5000 * (i + 1));
      }
    }
  }
  return { pz, getToken };
}

const arr = (d: any): any[] => (Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : Array.isArray(d?.products) ? d.products : Array.isArray(d?.items) ? d.items : Array.isArray(d?.data?.products) ? d.data.products : Array.isArray(d?.data?.items) ? d.data.items : []);
const lo = (s: string) => s.replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr");

export function createPazarama(): Marketplace {
  const { pz } = pazaramaClient();
  const brandCache = new Map<string, string | null>();
  const attrCache = new Map<string, any[]>();
  let lastWrite = 0;
  // İki yazma arası 10 sn (hız sınırı)
  const paced = async () => { const w = lastWrite + WAIT_MS - Date.now(); if (lastWrite && w > 0) await sleep(w); lastWrite = Date.now(); };

  async function brandId(name: string): Promise<string | null> {
    const k = lo(name);
    if (brandCache.has(k)) return brandCache.get(k)!;
    const r = await pz(`${EP.brands}?Page=1&Size=100&name=${encodeURIComponent(name)}`); // canlıda doğrulandı 27.11
    const hit = arr(r.data ?? r).find((b: any) => lo(String(b.name ?? b.displayName ?? "")) === k);
    const id = hit ? String(hit.id ?? hit.brandId) : null;
    brandCache.set(k, id);
    return id;
  }
  // Kategori özellikleri: {id, name, required, values[{id,value}]}
  async function categoryAttrs(categoryId: string): Promise<any[]> {
    if (attrCache.has(categoryId)) return attrCache.get(categoryId)!;
    const r = await pz(`${EP.categoryAttrs}?Id=${encodeURIComponent(categoryId)}`);
    const d = r.data ?? r;
    const list = (d.attributes ?? d.categoryAttributes ?? arr(d)).map((a: any) => ({
      id: String(a.id ?? a.attributeId), name: String(a.name ?? a.displayName ?? a.id), required: !!(a.isRequired ?? a.required),
      variant: !!a.isVariantable, values: (a.attributeValues ?? a.values ?? []).map((v: any) => ({ id: String(v.id), value: String(v.value ?? v.name) })),
    }));
    attrCache.set(categoryId, list);
    return list;
  }

  return {
    id: "pazarama",
    label: "Pazarama",
    pushOnlyChanged: true,

    // Onaylı ürünler (imleç sayfalı, en çok 100). Yol/alan adları canlıda doğrulanmadı.
    async loadListings(): Promise<Listing[]> {
      const out: Listing[] = [];
      let cursor = "";
      for (let guard = 0; guard < 2000; guard++) {
        const r = await pz(`${EP.approved}?Approved=true&Page=1&Size=100${cursor ? "&Cursor=" + encodeURIComponent(cursor) : ""}`);
        const list = arr(r.data ?? r);
        for (const l of list) {
          const code = String(l.code ?? l.productCode ?? "");
          if (!code) continue;
          out.push({
            id: code, mpSku: l.stockCode ? String(l.stockCode) : undefined,
            title: String(l.displayName ?? l.name ?? "").slice(0, 120),
            price: Number(l.salePrice ?? l.listPrice), quantity: Number(l.stockCount ?? 0),
            vatRate: l.vatRate != null ? Number(l.vatRate) : undefined,
            categoryId: l.categoryId ? String(l.categoryId) : undefined,
            status: "active", // satış kapalı/durum kodları doğrulanana kadar onaylı liste açık sayılır
          });
        }
        cursor = String(r.data?.nextCursor ?? r.nextCursor ?? "");
        if (!cursor || !list.length) break;
        await sleep(300);
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

    // Komisyon tablosu yok (kategori bazlı oran satıcı panelinden girilir): panel oranı > varsayılan
    commission(_id, _xmlCategory, panelRate, defaultRate): Commission {
      return panelRate != null ? { rate: panelRate, source: "panel" } : { rate: defaultRate, source: "varsayilan" };
    },

    // Stok (en çok 3000 kod) ve fiyat ayrı uçlar, ikisi de kuyruklanır ve takip kimliği döner. Gövde anahtarları (stockList/priceList) varsayım.
    async pushInventory(list: InventoryItem[]): Promise<BatchResult> {
      const res: BatchResult = { ok: 0, failed: 0, batchIds: [] };
      const tid = (r: any) => String(r?.data?.id ?? r?.data ?? r?.id ?? "");
      for (const batch of chunk(list, 3000)) {
        try {
          await paced();
          const r = await pz(EP.updateStock, { body: { stockList: batch.map((p) => ({ code: p.id, stockCount: Math.max(0, Math.floor(p.quantity)) })) } });
          res.batchIds.push("stock:" + tid(r));
          const priced = batch.filter((p) => p.price != null && p.price > 0);
          if (priced.length) {
            await paced();
            // listPrice = satış fiyatı (liste fiyatı ayrı tutulmuyor); %70+ indirim onay ister, burada indirim yok
            const r2 = await pz(EP.updatePrice, { body: { priceList: priced.map((p) => ({ code: p.id, listPrice: p.price, salePrice: p.price })) } });
            res.batchIds.push("price:" + tid(r2));
          }
          res.ok += batch.length;
        } catch (e: any) { res.failed++; console.error(e.message); if ((res.errors ??= []).length < 3) res.errors.push(String(e.message).slice(0, 300)); }
      }
      return res;
    },

    async zeroStock(ids: string[]): Promise<BatchResult> {
      return this.pushInventory(ids.map((id) => ({ id, price: null, quantity: 0 })));
    },

    requiresCategory: true,

    // Marka Pazarama'da kayıtlı mı (gönderim kuyruğu, tedarikçinin "A|B|C" marka listesinden yalnızca kayıtlı olanı seçer)
    async brandExists(name: string): Promise<boolean> { return !!(await brandId(name)); },

    // Yaprak kategoriler (başlıktan kategori bulma, core/category-tree.ts): getCategoryTree, leaf=true; yol = parentCategories
    async categoryLeaves() {
      const r = await pz(EP.categories);
      return arr(r.data ?? r).filter((c: any) => c.leaf === true && c.id)
        .map((c: any) => ({ id: String(c.id), name: String(c.name ?? c.displayName ?? "").trim(), path: ((c.parentCategories ?? []) as string[]).map((x) => String(x).trim()).filter(Boolean) }));
    },

    // Ürün açma (en çok 500, istekler arası 10 sn). Gövde: {products:[...]} varsayım (PR 331 dizi, sonraki PR nesne diyor: çelişkili).
    async createProducts(list: NewProduct[], ctx): Promise<BatchResult> {
      const res: BatchResult = { ok: 0, failed: 0, batchIds: [] };
      const payloads: any[] = [];
      const used = new Set<string>();
      for (const p of list) {
        const no = (why: string) => { if (process.env.SEND_DRY === "1") console.error(`DENEME ATLANDI ${p.id} ${p.name.slice(0, 40)}: ${why}`); ctx.skip(why); (res.failedItems ??= []).push({ id: p.id, reason: why.slice(0, 500) }); };
        if (!p.images.length) { no("görsel yok"); continue; }
        if (!p.cat?.category_id) { no("pazaryeri kategorisi yok"); continue; }
        if (used.has(p.id)) { no("aynı stok koduna dönüşen ürün kodu"); continue; }
        // K 27.11: "marka ve barkodla şimdi uğraşamam" -> HB gibi: tedarikçinin panelde ayarlı pazaryeri markası (ctx.brandName). Başlığında
        // tanınmış marka / lisanslı karakter geçen ürün gönderim kuyruğunda zaten elenir (brandRisk) + burada +18/yasak son kapı.
        const brandName = String(ctx.brandName || BRAND_NAME || "").trim();
        if (!brandName) { no("marka yok (tedarikçinin pazaryeri markası ayarlanmadı)"); continue; }
        const hb0 = tyHardBlock({ id: "00000000", brand: brandName, title: p.name, category: `${p.xmlCategory ?? ""} ${p.catName ?? ""}` });
        if (hb0 && !/GTIN|gerçek markası/.test(hb0)) { no(hb0.replace("Güvenli liste: ", "")); continue; }
        let bid: string | null;
        try { bid = await brandId(brandName); } catch (e: any) { no(`marka sorgusu başarısız (geçici): ${String(e.message).slice(0, 160)}`); continue; }
        if (!bid) { no(`marka Pazarama'da bulunamadı: ${brandName}`); continue; }
        // Özellikler (K 27.11): panel değeri > ürün kaydı (tedarikçi verisi ya da görselden iki modelin uzlaştığı "<ad>@pazarama",
        // worker/vision-attrs.ts). Başlıktan TAHMİN YOK (pilotta "Çok Renkli" uydurulmuştu); zorunlu özellik doğrulanmamışsa ürün gönderilmez.
        const attrs: any[] = [];
        try {
          const given = new Map<string, string>((Array.isArray(p.cat.attributes) ? p.cat.attributes : []).filter((a: any) => a?.name != null).map((a: any) => [lo(String(a.name)), String(a.value)]));
          const missing: string[] = [];
          for (const a of await categoryAttrs(String(p.cat.category_id))) {
            const def = given.get(lo(a.name)) ?? defaultFor(p.defaults ?? {}, a.name, a.id);
            if (!a.required && !def) continue;
            const hit = matchOptions(def).map((o) => a.values.find((v: any) => lo(v.value) === lo(o))).find(Boolean);
            if (hit) attrs.push({ attributeId: a.id, attributeValueId: hit.id });
            else if (!a.values.length && def) attrs.push({ attributeId: a.id, attributeValue: String(def) }); // serbest metin: yalnızca kayıttaki değer
            else if (a.required) missing.push(a.name);
          }
          if (missing.length) { no(`zorunlu özellik doldurulamadı: ${missing.join(", ")}`); continue; }
        } catch (e: any) { no(`özellik listesi alınamadı (geçici, yeniden denenecek): ${String(e.message).slice(0, 160)}`); continue; }
        used.add(p.id);
        payloads.push({
          code: p.id, stockCode: p.id, groupCode: (p.groupId ?? p.id).slice(0, 40),
          name: p.name.slice(0, 200), displayName: p.name.slice(0, 200), description: p.detail.slice(0, 30000) || p.name,
          brandId: bid, categoryId: String(p.cat.category_id), desi: Math.max(1, Math.ceil(p.desi || 1)),
          listPrice: p.price, salePrice: p.price, stockCount: Math.max(0, Math.min(Math.floor(p.qty), 20000)),
          vatRate: Number(p.cat.vat_rate ?? ctx.vatRate),
          images: p.images.slice(0, 8).map((u) => ({ imageurl: jpgUrl(u) })), // WebP reddediliyor (Odoo notu): JPG dönüştürücü
          attributes: attrs,
        });
      }
      // SEND_DRY=1: hiçbir şey gönderilmez, gidecek olanın özeti yazılır
      if (process.env.SEND_DRY === "1") {
        // SEND_DRY_FILE: gidecek gövde JSON olarak dosyaya yazılır (gönderim öncesi inceleme; her çağrı dosyayı yeniler)
        if (process.env.SEND_DRY_FILE) { const fs = await import("node:fs"); const f = process.env.SEND_DRY_FILE; let prev: any[] = []; try { prev = JSON.parse(fs.readFileSync(f, "utf8")).body.products; } catch { /* yeni dosya */ } fs.writeFileSync(f, JSON.stringify({ body: { products: [...prev, ...payloads] } }, null, 1), "utf8"); }
        for (const x of payloads) { console.log(`DENEME ${x.code} | ${x.name} | kategori ${x.categoryId} | ${x.salePrice} | stok ${x.stockCount} | KDV ${x.vatRate} | görsel ${x.images.length}`); (res.failedItems ??= []).push({ id: x.code, reason: "DENEME: gönderilmedi (SEND_DRY)" }); }
        return res;
      }
      for (const batch of chunk(payloads, 500)) {
        try {
          await paced();
          const r = await pz(EP.create, { body: { products: batch } });
          res.ok += batch.length; res.batchIds.push("product:" + String(r?.data?.batchRequestId ?? r?.data?.id ?? r?.data ?? ""));
        } catch (e: any) { res.failed++; console.error(e.message); if ((res.errors ??= []).length < 3) res.errors.push(String(e.message).slice(0, 300)); }
      }
      return res;
    },

    // Toplu sonuç: product -> getProductBatchResult (status 1 sürüyor, 2 bitti, 3 hata; failedProducts[]). stock/price -> kod başına sonuç (? uç).
    async checkBatches(ids: string[], opts: { quick?: boolean } = {}): Promise<BatchCheck> {
      const out: BatchCheck = { checked: 0, pending: 0, failedItems: 0, reasons: [], states: [], done: [] };
      let todo = ids.filter((i) => /^(product|stock|price):.+/.test(i));
      for (let round = 0; round < (opts.quick ? 1 : 4) && todo.length; round++) {
        if (!opts.quick) await sleep(round === 0 ? 10000 : 20000);
        const next: string[] = [];
        for (const id of todo) {
          const kind = id.split(":")[0], tid = id.slice(id.indexOf(":") + 1);
          try {
            const r = await pz(`${kind === "product" ? EP.productBatch : EP.listingResult}?BatchRequestId=${encodeURIComponent(tid)}`);
            const d = r.data ?? r;
            const st = Number(d.status);
            if (st === 1) { next.push(id); continue; }
            out.checked++; out.done!.push(id);
            const failedList: any[] = d.failedProducts ?? d.failedItems ?? d.errors ?? [];
            for (const f of failedList) {
              const sku = String(f.code ?? f.productCode ?? f.stockCode ?? "");
              const reasons = ([] as any[]).concat(f.failReasons ?? f.reasons ?? f.message ?? f.error ?? "bilinmeyen hata").join(" · ");
              const why = `Pazarama: ${reasons}`.slice(0, 500);
              out.failedItems++;
              if (sku) { (out.failed ??= []).push({ id: sku, reason: why }); out.states!.push({ id: sku, status: "Hatalı", reasons: why, bad: true, final: true }); }
              if (out.reasons.length < 30) out.reasons.push(`${sku}: ${why}`.slice(0, 300));
            }
            if (st === 3 && !failedList.length) { out.failedItems++; out.reasons.push(`${kind}:${tid}: Pazarama toplu istek hata (status 3)`); }
          } catch (e: any) { next.push(id); console.error(e.message); }
          await sleep(300);
        }
        todo = next;
      }
      out.pending = todo.length;
      return out;
    },
  };
}
