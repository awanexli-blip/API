// Sahte XML + Supabase + Trendyol V2. `node --import ./worker/test/mock.mjs worker/sync.ts ...` ile yüklenir.
// Trendyol'a giden yazma istekleri ve Supabase'e yazılan özet calls.json'a yazılır.
import { writeFileSync } from "node:fs";

const N_BULK = Number(process.env.MOCK_BULK ?? 10150); // >10.000: nextPageToken yolunu test eder

// Onaylı ürünler (V2: içerik + varyant)
const content = (barcode, title, salePrice, extra = {}, cat = { id: 555, name: "Kat" }, attributes = []) => ({
  contentId: barcode, productMainId: barcode, title, brand: { id: 9, name: "Eco Lounge" }, category: cat, attributes,
  variants: [{ barcode, stockCode: barcode, price: { salePrice, listPrice: salePrice }, stock: { quantity: 5 }, locked: false, archived: false, blacklisted: false, ...extra }],
});
const approved = [
  content("ÖS13-AAA", "Urun A", 100, { commission: 12.5 }),       // canlı komisyon
  content("ÖS13-G0et_94794", "Urun B", 900),                       // JSON komisyonu (gerçek anahtar)
  content("OS13-NEWPC1", "Urun C", 200),
  content("DIRECT-1", "Urun D", 150),
  content("ÖS13-KILITLI", "Kilitli Urun", 120, { locked: true }),
  content("ÖS13-SIFIR", "Sifir Fiyat", 0),
  content("ORPHAN-1", "Yetim Urun", 50),
  content("X-SAME", "Ayni Baslikli Urun Burada", 80),
  content("DEAD-1", "Olu Bolge Urunu", 359.9),                    // 300-410 arası: 299,90 hem ucuz hem kârlı
  content("PAHALI-1", "Pahali Urun", 1000),                       // formülün çok üstünde: kademeli düşüş
  // Kategori 3'te onaylı ilan: zorunlu "Menşei" buradan kopyalanır
  content("REF-1", "Referans Urun", 100, {}, { id: 3, name: "Kat3" }, [{ attributeId: 1192, attributeName: "Menşei", attributeValues: [{ attributeValueId: 7001, attributeValue: "CN" }] }]),
];
for (let i = 0; i < N_BULK; i++) approved.push(content(`BULK-${i}`, `Toplu ${i}`, 99));
const unapproved = [
  { barcode: "OS13-BEKLEYEN", title: "Bekleyen Urun", salePrice: 70, quantity: 3, status: "pendingApproval" },
  { barcode: "OS13-RED", title: "Reddedilen Urun", salePrice: 70, quantity: 3, status: "rejected", rejectReasonDetails: [{ rejectReason: "Görsel uygun değil", rejectReasonDetail: "Görselde logo var" }] },
];

const row = (o) => ({ brand: "BayilikXML.com", currency: "TL", quantity: "10", ...o });
const xmlRows = [
  row({ barcode: "BX1", productCode: "AAA", category: "Cat1", price: "50", name: "Urun A" }),
  row({ barcode: "BX2", productCode: "G0et_94794", category: "Cat1", price: "400", name: "Urun B" }),
  row({ barcode: "BX3", productCode: "NEWPC1", category: "Cat2", price: "120", name: "Urun C" }),
  row({ barcode: "DIRECT-1", productCode: "ZZ", category: "Cat2", price: "3", currency: "USD", name: "Urun D" }),
  row({ barcode: "BX5", productCode: "KILITLI", category: "Cat1", price: "60", name: "Kilitli Urun" }),
  row({ barcode: "BX6", productCode: "SIFIR", category: "Cat1", price: "60", name: "Sifir Fiyat" }),
  row({ barcode: "BX7", productCode: "BEKLEYEN", category: "Cat3", price: "40", name: "Bekleyen Urun", image1: "https://i/b.jpg" }),
  row({ barcode: "BX8", productCode: "YENİ-1", category: "Cat3", price: "80", name: "Yeni Urun 1", image1: "https://i/1.jpg", detail: "d", desi: "2" }),
  row({ barcode: "BX13", productCode: "IMKANSIZ", category: "Cat4", price: "80", name: "Imkansiz Ozellik", image1: "https://i/9.jpg" }),
  row({ barcode: "BX14", productCode: "FAILED1", category: "Cat3", price: "80", name: "Dun Reddedilen", image1: "https://i/8.jpg" }),
  row({ barcode: "BX9", productCode: "YENI-2", category: "Cat3", price: "250", name: "Yeni Urun 2 Siyah", ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`image${i + 1}`, `https://i/2-${i}.jpg`])) }),
  row({ barcode: "BX10", productCode: "YENI-3", category: "Cat3", price: "80", name: "Resimsiz" }),
  row({ barcode: "BX11", productCode: "YENI-4", category: "CatX", price: "80", name: "Kategorisiz", image1: "https://i/4.jpg" }),
  row({ barcode: "DEAD-1", productCode: "DD", category: "Cat1", price: "150", name: "Olu Bolge Urunu" }),
  row({ barcode: "PAHALI-1", productCode: "PP", category: "Cat1", price: "300", name: "Pahali Urun" }),
  row({ barcode: "BX12", productCode: "SAME", category: "Cat3", price: "80", name: "Ayni Baslikli Urun Burada", image1: "https://i/6.jpg" }),
];
for (let i = 0; i < N_BULK; i++) xmlRows.push(row({ barcode: `B${i}`, productCode: `BULK-${i}`.replace(/^BULK-/, "BULK-"), category: "Cat1", price: "30", name: `Toplu ${i}` }));
// BULK ürünleri doğrudan barkodla eşleşsin
for (let i = 0; i < N_BULK; i++) xmlRows[xmlRows.length - N_BULK + i].barcode = `BULK-${i}`;

const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const xml = "<?xml version='1.0'?><products>" + xmlRows.map((r) => "<product>" + Object.entries(r).map(([k, v]) => `<${k}>${esc(v)}</${k}>`).join("") + "</product>").join("") + "</products>";

const settings = { id: 1, commission_rate: 0.18, target_profit_rate: 0.15, shipping_cost: 90, free_shipping_threshold: 300, min_markup: 1.3, fixed_cost: 0, min_acceptable_profit_rate: 0.08, max_price: Number(process.env.MOCK_MAX_PRICE ?? 10000), min_stock: 3, vat_rate: 20, fx_usd: 35, fx_eur: 40, auto_sync: true, auto_create: true, update_prices: true, zero_missing: process.env.MOCK_ZERO === "1", existing_price_policy: process.env.MOCK_POLICY ?? "floor" };
const catMap = [
  { xml_category: "Cat1", category_id: 1, commission_rate: 0.2, vat_rate: null, attributes: [] },
  { xml_category: "Cat3", category_id: 3, commission_rate: null, vat_rate: 10, attributes: [] },
  { xml_category: "Cat4", category_id: 4, commission_rate: null, vat_rate: 20, attributes: [] },
];

const log = { trendyolWrites: [], trendyolReads: [], hbWrites: [], summary: null, run: null };
const hbSettings = { marketplace: "hepsiburada", enabled: true, auto_sync: false, auto_create: true, zero_missing: process.env.MOCK_ZERO === "1", existing_price_policy: "smart", commission_rate: 0.18, free_shipping_threshold: 0, shipping_mode: "desi", cargo_carrier: "hepsiJET", default_desi: 2, shipping_vat_included: false, commission_plus_vat: true, min_stock: 5, target_profit_rate: null };
const hbListings = [
  { merchantSku: "OS13-AAA", hepsiburadaSku: "HBV1", price: 100, availableStock: 5, isSalable: true },
  { merchantSku: "ÖS13-G0et_94794", hepsiburadaSku: "HBV2", price: 2000, availableStock: 5, isSalable: true },
  { merchantSku: "OS13-KILITLI", hepsiburadaSku: "HBV3", price: 150, availableStock: 0, isSalable: false },
  { merchantSku: "OS13-HBYETIM", hepsiburadaSku: "HBV4", price: 50, availableStock: 3, isSalable: true },
  ...Array.from({ length: 1500 }, (_, i) => ({ merchantSku: `BULK-${i}`, hepsiburadaSku: `HB${i}`, price: 99, availableStock: 4, isSalable: true })),
];
const json = (b, st = 200) => new Response(JSON.stringify(b), { status: st, headers: { "content-type": "application/json" } });
const pageOf = (arr, u, max) => {
  const size = Number(u.searchParams.get("size"));
  if (size > max) return json({ errors: [{ message: "size too big" }] }, 400);
  const token = u.searchParams.get("nextPageToken");
  const page = token ? Number(Buffer.from(token, "base64").toString()) : Number(u.searchParams.get("page"));
  if (!token && page * size >= 10000) return json({ errors: [{ message: "page*size > 10000" }] }, 400);
  const slice = arr.slice(page * size, page * size + size);
  const more = (page + 1) * size < arr.length;
  return json({ totalElements: arr.length, totalPages: Math.ceil(arr.length / size), page, size, nextPageToken: more ? Buffer.from(String(page + 1)).toString("base64") : null, content: slice });
};

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = init.method ?? "GET";
  const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body instanceof FormData ? JSON.parse(await init.body.get("file").text()) : undefined;
  const noMig = process.env.MOCK_NOMIG === "1"; // migration 002 çalıştırılmamış veritabanı
  if (u.host === "mock-xml") return new Response(xml, { status: 200 });
  if (u.host === "mock-supa") {
    const t = u.pathname.split("/").pop();
    const single = String(new Headers(init.headers).get("accept") ?? "").includes("vnd.pgrst.object");
    if (method === "GET") {
      if (noMig && u.search.includes("marketplace=")) return json({ message: "column marketplace does not exist" }, 400);
      if (t === "settings") return json(single ? settings : [settings]);
      if (t === "marketplace_settings") return json(single ? hbSettings : [hbSettings]);
      if (t === "category_map") return json(catMap);
      if (t === "product_overrides") return json([]);
      // Faz 4: veritabanından gönderilmiş ilan (XML'de yok) ve gönderilecek ürünler
      if (t === "marketplace_listings" && process.env.MOCK_DB === "1") return json(Number(u.searchParams.get("offset") ?? 0) > 0 ? [] : [{ listing_key: "ORPHAN-1", product_variants: { stock: 20, reserved: 0, cost_price: null }, products: { source: "xml:toptanci", status: "active", cost_price: 30, currency: "TRY", vat_rate: 20, category: "Cat1", brand: "X" } }]);
      if (t === "products" && process.env.MOCK_SEND === "1") return json([
        { id: "p1", sku: "TD-1", title: "Gonderilecek Urun Yepyeni", description: "aciklama", brand: "Eco Lounge", category: "Cat3", vat_rate: 20, desi: 2, cost_price: 100, currency: "TRY", status: "active", source: "xml:toptanci",
          product_variants: [{ id: "v1", sku: "TD-1", barcode: "8690000000012", stock: 9, reserved: 0, position: 0, attributes: {} }], product_images: [{ url: "https://i/x.jpg", position: 0 }] },
        { id: "p2", sku: "TD-2", title: "Kategorisi Olmayan Urun", description: "", brand: "", category: "Yok", vat_rate: 20, desi: 1, cost_price: 50, currency: "TRY", status: "active", source: "manual",
          product_variants: [{ id: "v2", sku: "TD-2", barcode: "2000000000017", stock: 5, reserved: 0, position: 0, attributes: {} }], product_images: [{ url: "https://i/y.jpg", position: 0 }] },
        { id: "p3", sku: "AAA", title: "Urun A Kopya", description: "", brand: "", category: "Cat1", vat_rate: 20, desi: 1, cost_price: 50, currency: "TRY", status: "active", source: "xml:bayilik",
          product_variants: [{ id: "v3", sku: "NEWPC1", barcode: "BX3", stock: 5, reserved: 0, position: 0, attributes: {} }], product_images: [{ url: "https://i/z.jpg", position: 0 }] },
      ]);
      if (t === "pricing_rules") return json(process.env.MOCK_RULES === "1" ? [{ name: "Test kuralı", enabled: true, position: 1, marketplace: "all", cond: { cost_max: 1000000 }, min_net_profit: 400 }, { name: "Başka pazaryeri", enabled: true, position: 2, marketplace: "hepsiburada", cond: {}, target_profit_rate: 0.5 }] : []);
      if (t === "create_failures") return json([{ barcode: "OS13-FAILED1" }]);
    }
    if (t === "sync_runs" && method === "POST") { if (noMig && body?.marketplace) return json({ message: "column marketplace does not exist" }, 400); log.runInsert = body; return json(single ? { id: 1 } : [{ id: 1 }], 201); }
    if (t === "unmapped_categories" && method === "POST") log.unmapped = body;
    if (t === "create_failures" && method === "POST") log.createFailures = body;
    if (t === "marketplace_listings" && method === "POST") { log.listings = (log.listings ?? 0) + body.length; log.listingRows = [...(log.listingRows ?? []), ...body.filter((r) => r.variant_id)]; }
    if (t === "job_claim" && method === "POST") { const wantsSend = (body?.kinds ?? []).some((k) => k.startsWith("send_products")); const first = wantsSend && !log.claimed; if (wantsSend) log.claimed = true; return json(process.env.MOCK_SEND === "1" && first ? [{ id: 77, type: "send_products:trendyol", marketplace: "trendyol", payload: { product_ids: ["p1", "p2", "p3"] }, attempts: 1 }] : []); }
    if (t === "job_finish" && method === "POST") { log.jobFinish = [...(log.jobFinish ?? []), body]; return json(null); }
    if (t === "sync_runs" && method === "PATCH") log.run = body;
    return new Response(null, { status: 204 });
  }
  // ---- Amazon SP-API (sahte) ----
  if (u.host === "api.amazon.com" && u.pathname === "/auth/o2/token") {
    const b = new URLSearchParams(String(init.body ?? ""));
    if (b.get("refresh_token") !== "amz-refresh") return json({ error: "invalid_grant", error_description: "bad token" }, 400);
    return json({ access_token: "amz-access", expires_in: 3600 });
  }
  if (u.host === "sellingpartnerapi-eu.amazon.com") {
    if (new Headers(init.headers).get("x-amz-access-token") !== "amz-access") return json({ errors: [{ message: "Unauthorized" }] }, 403);
    const pth = u.pathname;
    if (pth === "/reports/2021-06-30/reports" && method === "POST") return json({ reportId: "R1" });
    if (pth === "/reports/2021-06-30/reports/R1") return json({ processingStatus: "DONE", reportDocumentId: "RD1" });
    if (pth === "/reports/2021-06-30/documents/RD1") return json({ url: "https://amz-docs.local/RD1" });
    if (pth === "/feeds/2021-06-30/documents" && method === "POST") { const id = "D" + ((log.amzDocs = (log.amzDocs ?? 0) + 1)); return json({ feedDocumentId: id, url: "https://amz-docs.local/upload/" + id }); }
    if (pth === "/feeds/2021-06-30/feeds" && method === "POST") { const id = "F" + ((log.amzFeedN = (log.amzFeedN ?? 0) + 1)); log.amzFeedCreate = [...(log.amzFeedCreate ?? []), { id, ...body }]; return json({ feedId: id }); }
    if (/^\/feeds\/2021-06-30\/feeds\/F\d+$/.test(pth)) return json({ processingStatus: "DONE", resultFeedDocumentId: "RES-" + pth.split("/").pop() });
    if (/^\/feeds\/2021-06-30\/documents\/RES-F\d+$/.test(pth)) return json({ url: "https://amz-docs.local/" + pth.split("/").pop() });
    if (pth === "/catalog/2022-04-01/items") {
      log.amzCatalog = [...(log.amzCatalog ?? []), Object.fromEntries(u.searchParams)];
      if (u.searchParams.get("identifiers") === "8690000000012") return json({ items: [{ asin: "B0EANMATCH", summaries: [{ marketplaceId: "A33AVAJ2PDY3EV", itemName: "Eslesen Urun", brand: "Marka" }], images: [] }] });
      if (u.searchParams.get("keywords")) return json({ items: [{ asin: "B0CAND1", summaries: [{ marketplaceId: "A33AVAJ2PDY3EV", itemName: "Aday 1" }] }, { asin: "B0CAND2", summaries: [{ marketplaceId: "A33AVAJ2PDY3EV", itemName: "Aday 2" }] }] });
      return json({ items: [] });
    }
    return json({ errors: [{ message: "bilinmeyen uç " + pth }] }, 404);
  }
  if (u.host === "amz-docs.local") {
    if (u.pathname.startsWith("/upload/") && method === "PUT") { log.amzFeeds = [...(log.amzFeeds ?? []), JSON.parse(String(init.body))]; return new Response(null, { status: 200 }); }
    if (u.pathname === "/RD1") return new Response(["item-name\tlisting-id\tseller-sku\tprice\tquantity\tasin1\tstatus", "Urun A\tL1\tAAA\t120.00\t3\tB0AAA\tActive", "Yetim Amz\tL2\tORPHAN-AMZ\t50\t4\tB0ORPH\tActive", "Eksik\tL3\tEKSIK\t\t0\t\tIncomplete"].join("\n"), { status: 200 });
    if (u.pathname.startsWith("/RES-")) return json({ header: {}, issues: [{ messageId: 1, code: "90220", message: "Fiyat hatalı", severity: "ERROR" }], summary: { errors: 1 } });
    return new Response("yok", { status: 404 });
  }
  if (u.host === "oms-external-sit.hepsiburada.com") return json({ items: [], totalCount: 0 });
  if (u.host === "listing-external-sit.hepsiburada.com" || u.host === "mpop-sit.hepsiburada.com") {
    const p = u.pathname;
    if (!String(new Headers(init.headers).get("authorization") ?? "").startsWith("Basic ")) return json({ message: "auth" }, 401);
    if (method === "GET" && /\/listings\/merchantid\/[^/]+$/.test(p)) {
      const off = Number(u.searchParams.get("offset")), lim = Number(u.searchParams.get("limit"));
      return json({ totalCount: hbListings.length, listings: hbListings.slice(off, off + lim) });
    }
    if (method === "GET" && p.endsWith("/get-all-categories")) return json({ totalPages: 1, data: [
      { categoryId: 18021982, name: "Kirli Sepeti", paths: ["Ev & Yaşam", "Banyo", "Kirli Sepeti"] },
      { categoryId: 5000, name: "Benzinli Çakmak", paths: ["Hobi", "Çakmak", "Benzinli Çakmak"] },
      { categoryId: 6000, name: "Eğitici Oyuncaklar", paths: ["Oyuncak", "Eğitici Oyuncaklar"] },
    ] });
    if (method === "GET" && /\/product\/api\/categories\/\d+\/attributes$/.test(p)) return json({ data: {
      baseAttributes: [{ id: "merchantSku", name: "Satıcı Stok Kodu", mandatory: true }, { id: "UrunAdi", name: "Ürün Adı", mandatory: true }],
      attributes: [{ id: "renk_variant_property", name: "Renk", mandatory: true, type: "enum" }, { id: "garanti", name: "Garanti", mandatory: false }],
      variantAttributes: [] } });
    if (method === "GET" && p.includes("/attribute/renk_variant_property/values")) return json({ data: [{ value: "Siyah" }, { value: "Çok Renkli" }] });
    if (method === "POST") { log.hbWrites.push({ path: p, body }); return json({ id: "trk-" + log.hbWrites.length }); }
    if (method === "GET" && /(stock-uploads|price-uploads)\/id\//.test(p)) return json({ status: "DONE", errors: [] });
    if (method === "GET" && p.includes("/products/status/")) return json({ status: "DONE", data: [{ merchantSku: "OS13-YENI-2", status: "FAILED", errors: ["Marka bulunamadı"] }] });
  }
  if (u.host === "apigw.trendyol.com") {
    const p = u.pathname;
    if (/\/products(\?|$)/.test(p) && method === "GET") return json({ errors: [{ message: "V1 kapalı" }] }, 410);
    if (p.endsWith("/products/approved")) { log.trendyolReads.push("approved"); return pageOf(approved, u, 100); }
    if (p.endsWith("/products/unapproved")) { log.trendyolReads.push("unapproved"); return pageOf(unapproved, u, 1000); }
    // Kategori özellikleri: 3 -> Renk (başlıktan / nötr) + Menşei (benzer ilandan); 4 -> doldurulamayan zorunlu özellik
    const ca = p.match(/\/product\/categories\/(\d+)\/attributes$/);
    if (ca) return json({ categoryAttributes: ca[1] === "4"
      ? [{ attribute: { id: 500, name: "Garanti Süresi" }, required: true, allowCustom: false }]
      : [{ attribute: { id: 47, name: "Renk" }, required: true, allowCustom: false }, { attribute: { id: 1192, name: "Menşei" }, required: true, allowCustom: false }, { attribute: { id: 999, name: "Opsiyonel" }, required: false }] });
    const av = p.match(/\/product\/categories\/(\d+)\/attributes\/(\d+)\/values$/);
    if (av) return json({ totalPages: 1, content: av[2] === "47" ? [{ attributeValueId: 1, attributeValue: "Siyah" }, { attributeValueId: 2, attributeValue: "Çok Renkli" }] : av[2] === "1192" ? [{ attributeValueId: 3, attributeValue: "TR" }] : [] });
    if (p.includes("/brands/by-name")) return json([{ id: 66, name: "Eco Lounge Home" }, { id: 77, name: "Eco Lounge" }]);
    if (p.includes("/batch-requests/")) {
      const id = p.split("/").pop();
      const w = log.trendyolWrites[Number(id.split("-")[1]) - 1];
      const its = (w?.body?.items ?? []).map((it, i) => ({ requestItem: { barcode: it.barcode }, status: i === 0 && w.path.includes("/v2/") ? "FAILED" : "SUCCESS", failureReasons: i === 0 && w.path.includes("/v2/") ? ["Zorunlu özellik eksik: Renk"] : [] }));
      return json({ batchRequestId: id, status: "COMPLETED", items: its });
    }
    if (method === "POST") {
      if (p.endsWith("/sellers/1/products")) return json({ errors: [{ message: "V1 create kapalı" }] }, 410);
      log.trendyolWrites.push({ method, path: p, body });
      return json({ batchRequestId: "batch-" + log.trendyolWrites.length });
    }
  }
  throw new Error("beklenmeyen istek " + method + " " + url);
};

// Testte bekleme sürelerini kısalt
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, 0, ...a);

process.on("exit", () => writeFileSync("calls.json", JSON.stringify({ ...log, trendyolReads: log.trendyolReads.length }, null, 1)));
