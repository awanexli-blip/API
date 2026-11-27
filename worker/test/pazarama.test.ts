// Pazarama adaptörü testi: sahte fetch, gerçek servise istek atmaz. node --experimental-strip-types worker/test/pazarama.test.ts
process.env.PAZARAMA_CLIENT_ID = "cid";
process.env.PAZARAMA_CLIENT_SECRET = "csecret";
delete process.env.PAZARAMA_ENV;
const realST = globalThis.setTimeout;
(globalThis as any).setTimeout = (fn: any, _ms: number, ...a: any[]) => realST(fn, 0, ...a); // bekleme sürelerini kısalt

let fails = 0;
const check = (name: string, cond: boolean, info: unknown = "") => { console.log(`${cond ? "OK  " : "HATA"} ${name}${cond ? "" : "  " + JSON.stringify(info)}`); if (!cond) fails++; };

const log: { path: string; method: string; body?: any }[] = [];
let tokenCalls = 0, flaky = 0;
const json = (b: unknown, st = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(b), { status: st, headers: { "content-type": "application/json", ...h } });
const all = Array.from({ length: 150 }, (_, i) => ({ code: `OS13-P${i}`, stockCode: `OS13-P${i}`, displayName: `Urun ${i}`, salePrice: 100 + i, stockCount: i % 7, vatRate: 20, categoryId: "c1" }));
globalThis.fetch = (async (url: any, init: any = {}) => {
  const u = new URL(String(url));
  const method = init.method ?? "GET";
  const hdr = new Headers(init.headers);
  if (u.host === "isortagimgiris.pazarama.com" && u.pathname === "/connect/token") {
    tokenCalls++;
    if (hdr.get("authorization") !== "Basic " + Buffer.from("cid:csecret").toString("base64")) return json({ error: "invalid_client" }, 400);
    if (!String(init.body).includes("grant_type=client_credentials") || !String(init.body).includes("merchantgatewayapi.fullaccess")) return json({ error: "invalid_request" }, 400);
    return json({ success: true, messageCode: "", message: "", data: { accessToken: "pz-token" } }); // canlı biçim (27.11)
  }
  if (u.host !== "isortagimapi.pazarama.com") throw new Error("beklenmeyen istek " + url);
  if (hdr.get("authorization") !== "Bearer pz-token") return json({ message: "yetkisiz" }, 401);
  const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
  log.push({ path: u.pathname, method, body });
  if (u.pathname === "/product/products") {
    if (++flaky === 1) return json({ message: "yavaş" }, 429, { "retry-after": "1" }); // ilk istek hız sınırı: yeniden denenmeli
    const cur = Number(u.searchParams.get("Cursor") ?? 0);
    const slice = all.slice(cur, cur + 100);
    return json({ success: true, data: { products: slice, nextCursor: cur + 100 < all.length ? String(cur + 100) : null } });
  }
  if (u.pathname === "/product/updateStock-v2" || u.pathname === "/product/updatePrice-v2") return json({ success: true, data: "res-" + log.length });
  if (u.pathname === "/product/getProductBatchResult") return json({ success: true, data: { status: 2, totalCount: 2, successfulCount: 1, failedCount: 1, failedProducts: [{ code: "OS13-BAD", failReasons: ["Zorunlu özellik eksik"] }] } });
  if (u.pathname === "/brand/getBrands") {
    const n = (u.searchParams.get("name") ?? "").toLowerCase();
    return n === "tcx" ? json({ success: true, data: [{ id: "b-tcx", name: "TCX" }] }) : json({ success: false, messageCode: "CAT_60", message: "Listelenecek veri bulunamadı!", data: null }); // canlı biçim
  }
  if (u.pathname === "/category/getCategoryTree") return json({ success: true, data: [
    { id: "p1", name: "Sofra & Mutfak", parentCategories: ["Ev, Yaşam "], leaf: false },
    { id: "k1", name: "Yağ Sıçratmaz", parentCategories: ["Ev, Yaşam ", " Sofra & Mutfak ", " Yağ Sıçratmaz"], leaf: true }] });
  if (u.pathname === "/product/create") return json({ success: false, messageCode: "E1", message: "reddedildi" });
  return json({ success: false, message: "bilinmeyen uç " + u.pathname }, 404);
}) as any;

const { createPazarama } = await import("../marketplaces/pazarama.ts");
const { getMarketplace, marketplaceIds } = await import("../marketplaces/index.ts");
const mp = createPazarama();

check("kayıt defterinde pazarama var", marketplaceIds.includes("pazarama") && getMarketplace("pazarama").id === "pazarama");
const listings = await mp.loadListings();
check("loadListings: imleç sayfalı 150 ilan, 429 sonrası yeniden denendi", listings.length === 150 && flaky >= 3, { n: listings.length, flaky });
check("loadListings: alanlar eşlendi", listings[5].id === "OS13-P5" && listings[5].price === 105 && listings[5].quantity === 5 && listings[5].status === "active", listings[5]);
check("token önbelleğe alındı (tek istek)", tokenCalls === 1, tokenCalls);

await mp.pushInventory([{ id: "OS13-P1", price: 199.9, quantity: 7 }, { id: "OS13-P2", price: null, quantity: 0 }]);
const st = log.find((l) => l.path === "/product/updateStock-v2")!, pr = log.find((l) => l.path === "/product/updatePrice-v2")!;
check("pushInventory: stok gövdesi", JSON.stringify(st.body) === JSON.stringify({ items: [{ code: "OS13-P1", stockCount: 7 }, { code: "OS13-P2", stockCount: 0 }] }), st.body);
check("pushInventory: fiyat yalnızca fiyatlı ürüne", JSON.stringify(pr.body) === JSON.stringify({ items: [{ code: "OS13-P1", listPrice: 199.9, salePrice: 199.9 }] }), pr.body);

log.length = 0;
const z = await mp.zeroStock(["OS13-P3"]);
check("zeroStock: stok 0, fiyat uçu çağrılmaz", z.ok === 1 && log.length === 1 && log[0].body.items[0].stockCount === 0, log);

const cb = await mp.checkBatches!(["product:B1"], { quick: true });
check("checkBatches: başarısız ürün nedeniyle", cb.checked === 1 && cb.failedItems === 1 && cb.failed?.[0].id === "OS13-BAD" && /Zorunlu özellik/.test(cb.failed[0].reason), cb);

const c = mp.commission(null, "X", null, 0.18);
check("commission: varsayılan / panel", c.rate === 0.18 && mp.commission(null, "X", 0.12, 0.18).source === "panel", c);
check("findListing/newListingId: OS13- kuralı", mp.findListing({ productCode: "ABC-1" }, new Set(["ÖS13-ABC-1"])) === "ÖS13-ABC-1" && mp.newListingId({ productCode: "ÖZ-1" }) === "OS13-Z-1");

check("brandExists: kayıtlı (büyük/küçük harf farkı yok) / kayıtsız (CAT_60 hata değil)", (await mp.brandExists!("Tcx")) === true && (await mp.brandExists!("Genel Markalar")) === false);
const leaves = await mp.categoryLeaves!();
check("categoryLeaves: yalnızca yaprak, yol temiz", leaves.length === 1 && leaves[0].id === "k1" && leaves[0].path.join(">") === "Ev, Yaşam>Sofra & Mutfak>Yağ Sıçratmaz", leaves);

// Yanlış kimlik anlaşılır hatayla durur ve gizli bilgi sızmaz
process.env.PAZARAMA_CLIENT_SECRET = "yanlis";
let msg = "";
try { await createPazarama().loadListings(); } catch (e: any) { msg = String(e.message); }
check("yanlış kimlik: token hatası, secret sızmaz", /Pazarama token 400/.test(msg) && !/yanlis|csecret/.test(msg), msg);

if (fails) { console.log(`\n${fails} Pazarama testi başarısız`); process.exit(1); }
console.log("\nPazarama testleri geçti");
