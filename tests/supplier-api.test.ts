// Tedarikçi REST API okuyucusu (lib/supplier-api.ts): sayfalama türleri, kimlik doğrulama, durma koşulları, hata. npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchApiItems, maskApi, type ApiFetcher } from "../lib/supplier-api.ts";
import { itemsToGroups, supplierPayload } from "../lib/supplier-xml.ts";

const products = Array.from({ length: 250 }, (_, i) => ({ sku: `P${i}`, name: `Ürün ${i}`, price: 10 + i, stock: i % 7, detail: { text: `Açıklama ${i}` } }));
type Call = { url: URL; method: string; headers: Record<string, string>; body?: string };
const fake = (handler: (c: Call) => { status?: number; body: any; ct?: string }) => {
  const calls: Call[] = [];
  const f: ApiFetcher = async (url, init) => {
    const c = { url: new URL(url), method: init.method, headers: init.headers, body: init.body };
    calls.push(c);
    const r = handler(c);
    const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return { status: r.status ?? 200, ok: (r.status ?? 200) < 400, text, contentType: r.ct ?? "application/json" };
  };
  return { f, calls };
};
const opts = (f: ApiFetcher, env: Record<string, string> = {}) => ({ fetcher: f, env });

test("sayfa numaralı + Bearer (ortam değişkeni): tüm sayfalar, kısa sayfada durur", async () => {
  const { f, calls } = fake((c) => { const p = Number(c.url.searchParams.get("page")), n = Number(c.url.searchParams.get("limit")); return { body: { data: products.slice((p - 1) * n, p * n) } }; });
  const r = await fetchApiItems("https://api.x.com/products", { auth: { type: "bearer", secret_env: "SUP_TOKEN" }, items_path: "data", paging: { type: "page", size_param: "limit", size: 100, start: 1 }, delay_ms: 0 }, opts(f, { SUP_TOKEN: "gizli" }));
  assert.equal(r.items.length, 250);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].headers.Authorization, "Bearer gizli");
});

test("offset + toplam sayı ile erken bitiş; query anahtarı", async () => {
  const { f, calls } = fake((c) => { const o = Number(c.url.searchParams.get("offset")); return { body: { meta: { total: 250 }, items: products.slice(o, o + 100) } }; });
  const r = await fetchApiItems("https://api.x.com/p", { auth: { type: "query", name: "key", token: "abc" }, items_path: "items", paging: { type: "offset", size_param: "count", size: 100, total_path: "meta.total" }, delay_ms: 0 }, opts(f));
  assert.equal(r.items.length, 250);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].url.searchParams.get("offset"), "100");
  assert.equal(calls[0].url.searchParams.get("key"), "abc");
});

test("imleç (cursor) ve sonraki adres (next_url)", async () => {
  const cur = fake((c) => { const i = Number(c.url.searchParams.get("cursor") || 0); return { body: { list: products.slice(i, i + 120), next: i + 120 < 250 ? String(i + 120) : null } }; });
  const a = await fetchApiItems("https://api.x.com/p", { items_path: "list", paging: { type: "cursor", cursor_path: "next" }, delay_ms: 0 }, opts(cur.f));
  assert.equal(a.items.length, 250);
  const nx = fake((c) => { const i = Number(c.url.searchParams.get("from") || 0); return { body: { results: products.slice(i, i + 100), links: { next: i + 100 < 250 ? `/p?from=${i + 100}` : "" } } }; });
  const b = await fetchApiItems("https://api.x.com/p", { items_path: "results", paging: { type: "next_url", next_path: "links.next" }, delay_ms: 0 }, opts(nx.f));
  assert.equal(b.items.length, 250);
  assert.equal(nx.calls[1].url.toString(), "https://api.x.com/p?from=100");
});

test("sayfa parametresini yok sayan API sonsuz döngüye girmez; ürün yolu kendiliğinden bulunur", async () => {
  const { f, calls } = fake(() => ({ body: { ok: true, result: { products: products.slice(0, 50) } } }));
  const r = await fetchApiItems("https://api.x.com/p", { paging: { type: "page" }, delay_ms: 0 }, opts(f));
  assert.equal(r.items.length, 50);
  assert.equal(r.path, "result.products");
  assert.equal(calls.length, 2);
});

test("Basic, POST gövdesi, XML yanıt", async () => {
  const xml = `<?xml version="1.0"?><root><urunler><urun><kod>A1</kod><ad>Bir</ad></urun><urun><kod>A2</kod><ad>İki</ad></urun></urunler></root>`;
  const { f, calls } = fake(() => ({ body: xml, ct: "application/xml" }));
  const r = await fetchApiItems("https://api.x.com/p", { method: "POST", body: { all: true }, auth: { type: "basic", user: "u", pass_env: "SUP_PASS" }, items_path: "root.urunler.urun" }, opts(f, { SUP_PASS: "p" }));
  assert.equal(r.items.length, 2);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].body, '{"all":true}');
  assert.equal(calls[0].headers.Authorization, "Basic " + Buffer.from("u:p").toString("base64"));
});

test("OAuth2 client_credentials: önce belirteç, sonra Bearer", async () => {
  const { f, calls } = fake((c) => c.url.pathname === "/token" ? { body: { access_token: "T1" } } : { body: [{ sku: "x", name: "y" }] });
  const r = await fetchApiItems("https://api.x.com/p", { auth: { type: "oauth2", token_url: "https://api.x.com/token", client_id: "id", client_secret_env: "SUP_SECRET" } }, opts(f, { SUP_SECRET: "s" }));
  assert.equal(r.items.length, 1);
  assert.match(calls[0].body ?? "", /grant_type=client_credentials/);
  assert.equal(calls[1].headers.Authorization, "Bearer T1");
});

test("hatalar: eksik anahtar, 401, sürekli 500, sayfa sınırı", async () => {
  const ok = fake(() => ({ body: [] }));
  await assert.rejects(fetchApiItems("https://api.x.com/p", { auth: { type: "bearer", secret_env: "YOK_TOKEN" } }, opts(ok.f)), /YOK_TOKEN tanımlı değil/);
  await assert.rejects(fetchApiItems("https://api.x.com/p", { auth: { type: "bearer", secret_env: "kucuk" } }, opts(ok.f)), /adı geçersiz/);
  const deny = fake(() => ({ status: 401, body: "no" }));
  await assert.rejects(fetchApiItems("https://api.x.com/p", {}, opts(deny.f)), /yetki reddedildi/);
  const many = fake((c) => ({ body: { data: [{ i: c.url.searchParams.get("page") }] } }));
  await assert.rejects(fetchApiItems("https://api.x.com/p", { items_path: "data", paging: { type: "page" }, delay_ms: 0 }, { ...opts(many.f), maxPages: 5 }), /sayfa sınırı/);
});

test("JSON ürünleri XML ile aynı eşleme hattından geçer (iç içe alan)", async () => {
  const groups = itemsToGroups(products.slice(0, 3), { sku: "model", name: "title", price: "cost_price", stock: "stock", "detail.text": "description" } as any);
  const p = supplierPayload(groups[1], { code: "x", mapping: {} } as any, new Set()).payload;
  assert.equal(p.title, "Ürün 1");
  assert.equal(p.description, "Açıklama 1");
});

test("panelde gizli alanlar maskelenir", () => {
  const m: any = maskApi({ auth: { type: "basic", user: "u", pass: "çokgizli" } });
  assert.equal(m.auth.pass, undefined);
  assert.equal(m.auth.has_pass, true);
});

test("kısmi okuma (panel denemesi): sayfa sınırında hata yerine okunanlar", async () => {
  const { f } = fake((c) => ({ body: { data: [{ i: c.url.searchParams.get("page") }] } }));
  const r = await fetchApiItems("https://api.x.com/p", { items_path: "data", paging: { type: "page" }, delay_ms: 0 }, { fetcher: f, env: {}, maxPages: 3, partial: true });
  assert.equal(r.items.length, 3);
  assert.equal(r.more, true);
});

test("ayar doğrulama: bilinmeyen alan atılır, anahtar başlığa yazılamaz, boş gizli alan eskisini korur", async () => {
  const { sanitizeApiSource } = await import("../lib/supplier-api.ts");
  const a = sanitizeApiSource({ items_path: "data.items", paging: { type: "page", size: 100, size_param: "limit" }, auth: { type: "bearer", token: "T" }, evil: 1 });
  assert.equal(a.error, undefined);
  assert.equal((a.api as any).evil, undefined);
  assert.equal(sanitizeApiSource({ headers: { Authorization: "Bearer x" } }).error?.includes("kimlik doğrulama"), true);
  assert.match(sanitizeApiSource({ auth: { type: "bearer" } }).error ?? "", /anahtar eksik/);
  assert.match(sanitizeApiSource({ auth: { type: "bearer", secret_env: "kucuk" } }).error ?? "", /ortam değişkeni/);
  assert.match(sanitizeApiSource({ items_path: "a;drop" }).error ?? "", /items_path/);
  const keep = sanitizeApiSource({ auth: { type: "basic", user: "u", pass: "" } }, { auth: { type: "basic", user: "u", pass: "eski" } });
  assert.equal(keep.api?.auth?.pass, "eski");
  const cleared = sanitizeApiSource({ auth: { type: "basic", user: "u", pass: "", clear_pass: true, pass_env: "SUP_P" } }, { auth: { type: "basic", user: "u", pass: "eski" } });
  assert.equal(cleared.api?.auth?.pass, undefined);
  assert.equal(cleared.api?.auth?.pass_env, "SUP_P");
});

test("SUPPLIER_SECRETS satırları ortama yüklenir (yorum, tırnak, var olanı ezmez)", async () => {
  const { loadSupplierSecrets } = await import("../lib/supplier-api.ts");
  const env: Record<string, string | undefined> = { VAR_OLAN: "eski" };
  const n = loadSupplierSecrets('# yorum\nSUP_A_TOKEN="abc=1"\r\nSUP_B=xyz\nkucuk=no\nVAR_OLAN=yeni\nBOS=\n', env);
  assert.equal(n, 2);
  assert.equal(env.SUP_A_TOKEN, "abc=1");
  assert.equal(env.SUP_B, "xyz");
  assert.equal(env.VAR_OLAN, "eski");
  assert.equal(env.kucuk, undefined);
});
