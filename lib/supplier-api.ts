// Tedarikçi REST API'si -> ürün listesi. XML ile aynı hat: ürünler düz alanlara açılır, alan eşlemesi (mapping) ve gruplama
// lib/supplier-xml.ts ile yapılır. Panel (Tedarikçiler > Test et) ve worker (import-xml.ts) aynı kodu kullanır.
// Ayar tedarikçinin linkinde (suppliers.feeds[].api, ya da ana link için suppliers.feeds[0] "type: api"): şema migration gerektirmez.
//
// Örnek (sayfa numaralı, Bearer anahtar GitHub Secret / VPS ortamında):
// { "type": "api", "url": "https://api.tedarikci.com/v1/products",
//   "api": { "auth": { "type": "bearer", "secret_env": "SUP_X_TOKEN" }, "items_path": "data",
//            "paging": { "type": "page", "param": "page", "size_param": "limit", "size": 100, "start": 1 } } }
//
// Anahtar iki yoldan biriyle: *_env (ortam değişkeni adı: GitHub Secret / VPS .env; panelde görünmez) ya da kayda yazılmış değer
// (token / pass / client_secret: panelde maskelenir, tarayıcıya gönderilmez).
// fast-xml-parser burada üstte içe aktarılmaz: worker (GitHub Actions) yalnızca worker/node_modules kurar, lib/ dosyasından paket çözülemez
// (28.10-29.10: içe aktarma 32 saat "Cannot find package" ile düştü). XML ayrıştırıcıyı çağıran verir (o.parseXml); verilmezse gerektiğinde yüklenir.
export type XmlParse = (text: string) => any;
let lazyXml: XmlParse | null = null;
async function defaultXml(): Promise<XmlParse> {
  if (!lazyXml) { const { XMLParser } = await import("fast-xml-parser"); const p = new XMLParser({ ignoreAttributes: true, trimValues: true, parseTagValue: false }); lazyXml = (t) => p.parse(t); }
  return lazyXml;
}
import { safeFetch } from "../worker/core/safe-fetch.ts";

export type ApiAuth = {
  type: "none" | "bearer" | "basic" | "header" | "query" | "oauth2";
  name?: string;                  // header / query anahtar adı (ör. X-Api-Key, apikey)
  secret_env?: string; token?: string;           // bearer / header / query değeri
  user_env?: string; user?: string; pass_env?: string; pass?: string; // basic
  token_url?: string; client_id_env?: string; client_id?: string; client_secret_env?: string; client_secret?: string; scope?: string; // oauth2 client_credentials
};
export type ApiPaging = {
  type: "none" | "page" | "offset" | "cursor" | "next_url";
  param?: string;                 // page / offset parametresi (varsayılan page / offset)
  size_param?: string; size?: number; start?: number; // sayfa boyutu parametresi, boyut, ilk sayfa (0 / 1)
  cursor_param?: string; cursor_path?: string;    // cursor: yanıttaki sonraki imleç yolu (ör. meta.next_cursor) -> sonraki istekte parametre
  next_path?: string;             // next_url: yanıttaki sonraki sayfa adresi (ör. links.next)
  total_path?: string;            // isteğe bağlı: toplam ürün sayısı yolu (erken bitiş)
};
export type ApiSource = {
  method?: "GET" | "POST"; headers?: Record<string, string>; query?: Record<string, string>; body?: unknown;
  auth?: ApiAuth; paging?: ApiPaging; items_path?: string; format?: "auto" | "json" | "xml";
  max_pages?: number; delay_ms?: number; timeout_ms?: number;
  runner?: "any" | "vps"; // vps: tedarikçi yalnızca kayıtlı IP'ye izin veriyor -> yalnızca sunucu (RUNNER=vps) okur, GitHub atlar
};
export type ApiFetcher = (url: string, init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string; timeoutMs: number }) =>
  Promise<{ status: number; ok: boolean; text: string; contentType: string; retryAfter?: number }>;

const ENV_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const at = (o: any, path?: string) => (path ? path.split(".").reduce((x, k) => (x == null ? x : x[k]), o) : o);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Gizli değer: ortam değişkeni adı (yalnızca BÜYÜK_HARF) > kayda yazılmış değer
export function secretOf(envName: string | undefined, inline: string | undefined, env: Record<string, string | undefined>, label: string): string {
  if (envName) {
    if (!ENV_RE.test(envName)) throw new Error(`${label}: ortam değişkeni adı geçersiz (${envName.slice(0, 40)})`);
    const v = env[envName];
    if (v) return v;
    if (!inline) throw new Error(`${label}: ${envName} tanımlı değil (GitHub Secret / sunucu .env)`);
  }
  if (inline) return inline;
  throw new Error(`${label} yok`);
}

// Yanıtta saklanmaması gereken alanlar (panelde gösterilmez)
export const API_SECRET_FIELDS = ["token", "pass", "client_secret"] as const;
export function maskApi(src: ApiSource | undefined | null) {
  if (!src) return src;
  const auth: any = { ...(src.auth ?? {}) };
  for (const f of API_SECRET_FIELDS) if (auth[f]) { auth[f] = undefined; auth[`has_${f}`] = true; }
  return { ...src, auth };
}

// Panelden gelen ayarı doğrula ve yalnızca bilinen alanları al. Gizli alan boş/eksikse kayıtlı değer korunur (panel onu hiç görmez).
// Hata metni döner (kaydedilmez) ya da temiz ayar.
const AUTH_TYPES = ["none", "bearer", "basic", "header", "query", "oauth2"] as const;
const PAGING_TYPES = ["none", "page", "offset", "cursor", "next_url"] as const;
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : undefined) || undefined;
const pathOk = (v?: string) => !v || /^[A-Za-z0-9_$@-]+(\.[A-Za-z0-9_$@-]+){0,7}$/.test(v);
const paramOk = (v?: string) => !v || /^[A-Za-z0-9_.[\]-]{1,60}$/.test(v);
export function sanitizeApiSource(input: any, old?: ApiSource | null): { api?: ApiSource; error?: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "API ayarı nesne olmalı" };
  const out: ApiSource = {};
  if (input.method != null) { if (!["GET", "POST"].includes(input.method)) return { error: "method GET ya da POST" }; out.method = input.method; }
  for (const k of ["headers", "query"] as const) if (input[k] != null) {
    if (typeof input[k] !== "object" || Array.isArray(input[k])) return { error: `${k} nesne olmalı` };
    const e = Object.entries(input[k]).filter(([n, v]) => paramOk(n) && typeof v === "string" && v.length <= 500).slice(0, 20);
    // Başlıkta anahtar yazılmasın: kimlik bilgisi auth alanında (maskelenir)
    if (k === "headers" && e.some(([n]) => /^(authorization|x-api-key|api-key|apikey|token)$/i.test(n))) return { error: "Anahtar başlığa değil kimlik doğrulama alanına yazılmalı (panelde maskelenir)" };
    out[k] = Object.fromEntries(e) as Record<string, string>;
  }
  if (input.body != null) { const s = JSON.stringify(input.body); if (s.length > 4000) return { error: "body çok büyük" }; out.body = JSON.parse(s); }
  if (input.items_path != null) { const p = str(input.items_path); if (!pathOk(p)) return { error: "items_path biçimi: alan.alt_alan" }; out.items_path = p; }
  if (input.runner != null) { if (!["any", "vps"].includes(input.runner)) return { error: "runner any ya da vps" }; out.runner = input.runner; }
  if (input.format != null) { if (!["auto", "json", "xml"].includes(input.format)) return { error: "format auto/json/xml" }; out.format = input.format; }
  for (const [k, lo, hi] of [["max_pages", 1, 5000], ["delay_ms", 0, 10000], ["timeout_ms", 5000, 300000]] as const)
    if (input[k] != null) { const n = Number(input[k]); if (!Number.isInteger(n) || n < lo || n > hi) return { error: `${k} ${lo}-${hi} arası tam sayı` }; out[k] = n; }
  const pg = input.paging;
  if (pg != null) {
    if (!PAGING_TYPES.includes(pg.type)) return { error: `paging.type: ${PAGING_TYPES.join("/")}` };
    const p: ApiPaging = { type: pg.type };
    for (const k of ["param", "size_param", "cursor_param"] as const) if (pg[k] != null) { if (!paramOk(pg[k])) return { error: `paging.${k} geçersiz` }; p[k] = str(pg[k], 60); }
    for (const k of ["cursor_path", "next_path", "total_path"] as const) if (pg[k] != null) { if (!pathOk(pg[k])) return { error: `paging.${k} biçimi: alan.alt_alan` }; p[k] = str(pg[k]); }
    if (pg.size != null) { const n = Number(pg.size); if (!Number.isInteger(n) || n < 1 || n > 5000) return { error: "paging.size 1-5000" }; p.size = n; }
    if (pg.start != null) { const n = Number(pg.start); if (!Number.isInteger(n) || n < 0 || n > 1000) return { error: "paging.start 0-1000" }; p.start = n; }
    out.paging = p;
  }
  const au = input.auth ?? { type: "none" };
  if (!AUTH_TYPES.includes(au.type)) return { error: `auth.type: ${AUTH_TYPES.join("/")}` };
  const a: ApiAuth = { type: au.type };
  if (au.name != null) { if (!paramOk(au.name)) return { error: "auth.name geçersiz" }; a.name = str(au.name, 60); }
  for (const k of ["secret_env", "user_env", "pass_env", "client_id_env", "client_secret_env"] as const)
    if (au[k]) { if (!ENV_RE.test(au[k])) return { error: `auth.${k}: BÜYÜK_HARF_ALT_ÇİZGİ ortam değişkeni adı` }; a[k] = au[k]; }
  for (const k of ["user", "client_id", "scope"] as const) if (au[k] != null) a[k] = str(au[k], 300);
  if (au.token_url != null) { try { const u = new URL(au.token_url); if (!/^https?:$/.test(u.protocol)) throw 0; a.token_url = u.toString(); } catch { return { error: "auth.token_url http(s) adresi olmalı" }; } }
  const oldAuth: any = old?.auth ?? {};
  for (const k of API_SECRET_FIELDS) { const v = str(au[k], 2000); if (v) (a as any)[k] = v; else if (oldAuth[k] && !au[`clear_${k}`]) (a as any)[k] = oldAuth[k]; }
  // Seçilen türün anahtarı yoksa kaydetme (sonra "yetki reddedildi" diye uğraşılmasın)
  const need: Record<string, () => boolean> = {
    bearer: () => !!(a.secret_env || a.token), header: () => !!(a.secret_env || a.token), query: () => !!(a.secret_env || a.token),
    basic: () => !!(a.user_env || a.user) && !!(a.pass_env || a.pass),
    oauth2: () => !!a.token_url && !!(a.client_id_env || a.client_id) && !!(a.client_secret_env || a.client_secret), none: () => true,
  };
  if (!need[a.type]()) return { error: `Kimlik doğrulama (${a.type}) için anahtar eksik: ortam değişkeni adı ya da değer gir` };
  out.auth = a;
  return { api: out };
}

// Tedarikçi anahtarları tek yerde: GitHub Secret SUPPLIER_SECRETS (ya da sunucu .env) içinde "AD=değer" satırları.
// Her yeni tedarikçide iş akışı değiştirilmesin diye; yalnızca BÜYÜK_HARF adlar alınır, var olan ortam değişkeni ezilmez.
export function loadSupplierSecrets(text: string | undefined, env: Record<string, string | undefined> = process.env): number {
  let n = 0;
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = /^\s*([A-Z][A-Z0-9_]{1,63})\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (v && env[m[1]] == null) { env[m[1]] = v; n++; }
  }
  return n;
}

export const defaultFetcher: ApiFetcher = async (url, init) => {
  const r = await safeFetch(url, { maxBytes: 100 * 1048576, timeoutMs: init.timeoutMs, headers: init.headers, method: init.method, body: init.body });
  return { status: r.status, ok: r.ok, text: r.text(), contentType: r.contentType };
};

async function request(fetcher: ApiFetcher, url: string, init: Parameters<ApiFetcher>[1], label: string) {
  for (let t = 0; ; t++) {
    const r = await fetcher(url, init);
    // Hız sınırı / geçici hata: Retry-After (en fazla 60 sn) ya da artan bekleme, 4 deneme
    if ((r.status === 429 || r.status >= 500) && t < 3) { await sleep(Math.min(60_000, (r.retryAfter ?? 2 * (t + 1)) * 1000)); continue; }
    if (r.status === 401 || r.status === 403) throw new Error(`${label}: yetki reddedildi (HTTP ${r.status}); anahtarı / IP iznini kontrol et`);
    if (!r.ok) throw new Error(`${label}: HTTP ${r.status} ${r.text.replace(/\s+/g, " ").slice(0, 200)}`);
    return r;
  }
}

async function parseBody(text: string, contentType: string, format: ApiSource["format"], parseXml?: XmlParse) {
  const xml = format === "xml" || (format !== "json" && (/xml/.test(contentType) || /^\s*</.test(text.slice(0, 100))));
  if (xml) return (parseXml ?? (await defaultXml()))(text);
  try { return JSON.parse(text); } catch { throw new Error(`Yanıt JSON değil: ${text.replace(/\s+/g, " ").slice(0, 120)}`); }
}

async function authHeaders(src: ApiSource, env: Record<string, string | undefined>, fetcher: ApiFetcher): Promise<{ headers: Record<string, string>; query: Record<string, string> }> {
  const a = src.auth ?? { type: "none" as const };
  const headers: Record<string, string> = {}, query: Record<string, string> = {};
  if (a.type === "bearer") headers.Authorization = `Bearer ${secretOf(a.secret_env, a.token, env, "API anahtarı")}`;
  else if (a.type === "header") headers[a.name || "X-Api-Key"] = secretOf(a.secret_env, a.token, env, "API anahtarı");
  else if (a.type === "query") query[a.name || "apikey"] = secretOf(a.secret_env, a.token, env, "API anahtarı");
  else if (a.type === "basic") headers.Authorization = "Basic " + Buffer.from(`${secretOf(a.user_env, a.user, env, "Kullanıcı adı")}:${secretOf(a.pass_env, a.pass, env, "Parola")}`).toString("base64");
  else if (a.type === "oauth2") {
    if (!a.token_url) throw new Error("OAuth2: token_url yok");
    const form = new URLSearchParams({ grant_type: "client_credentials", client_id: secretOf(a.client_id_env, a.client_id, env, "client_id"), client_secret: secretOf(a.client_secret_env, a.client_secret, env, "client_secret") });
    if (a.scope) form.set("scope", a.scope);
    const r = await request(fetcher, a.token_url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: form.toString(), timeoutMs: 30_000 }, "OAuth2 belirteci");
    const tok = (() => { try { return JSON.parse(r.text)?.access_token; } catch { return null; } })();
    if (!tok) throw new Error("OAuth2: yanıtta access_token yok");
    headers.Authorization = `Bearer ${tok}`;
  }
  return { headers, query };
}

// Tüm sayfaları okur. Durma: boş sayfa, boyuttan kısa sayfa, imleç/sonraki adres yok, toplam sayıya ulaşıldı,
// aynı sayfa tekrar geldi (API sayfa parametresini yok sayıyorsa sonsuz döngü olmasın), sayfa sınırı.
// partial: sayfa sınırında hata yerine okunanı döndür (panel denemesi; içe aktarma her zaman tamamını ister)
export async function fetchApiItems(url: string, src: ApiSource, o: { env?: Record<string, string | undefined>; fetcher?: ApiFetcher; maxPages?: number; label?: string; partial?: boolean; parseXml?: XmlParse } = {}) {
  const env = o.env ?? process.env, fetcher = o.fetcher ?? defaultFetcher, label = o.label ?? "API";
  const base = new URL(url);
  if (base.protocol !== "https:" && base.protocol !== "http:") throw new Error(`${label}: adres http(s) olmalı`);
  const auth = await authHeaders(src, env, fetcher);
  const paging = src.paging ?? { type: "none" as const };
  const size = Math.max(1, Math.min(5000, Number(paging.size ?? 100)));
  const maxPages = Math.max(1, Math.min(o.maxPages ?? src.max_pages ?? 2000, 5000));
  const method = src.method ?? "GET";
  const items: any[] = [];
  let page = Number(paging.start ?? (paging.type === "offset" ? 0 : 1)), cursor = "", nextUrl = "", prevSig = "", pages = 0, path = src.items_path ?? "";
  for (; pages < maxPages; pages++) {
    const u = nextUrl ? new URL(nextUrl, base) : new URL(base);
    if (!nextUrl) {
      for (const [k, v] of Object.entries({ ...(src.query ?? {}), ...auth.query })) u.searchParams.set(k, String(v));
      if (paging.type === "page" || paging.type === "offset") {
        u.searchParams.set(paging.param || (paging.type === "page" ? "page" : "offset"), String(page));
        if (paging.size_param) u.searchParams.set(paging.size_param, String(size));
      } else if (paging.type === "cursor" && cursor) u.searchParams.set(paging.cursor_param || "cursor", cursor);
    } else for (const [k, v] of Object.entries(auth.query)) u.searchParams.set(k, v); // sonraki adres anahtarı taşımayabilir
    const r = await request(fetcher, u.toString(), {
      method, headers: { Accept: "application/json, application/xml;q=0.9", ...(src.headers ?? {}), ...auth.headers, ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
      body: method === "POST" ? JSON.stringify(src.body ?? {}) : undefined, timeoutMs: src.timeout_ms ?? 120_000,
    }, `${label} sayfa ${pages + 1}`);
    const parsed = await parseBody(r.text, r.contentType, src.format, o.parseXml);
    let list: any[];
    if (path) { const v = at(parsed, path); list = Array.isArray(v) ? v : v && typeof v === "object" ? [v] : []; }
    else if (Array.isArray(parsed)) list = parsed;
    else { // yol verilmediyse ilk sayfada en büyük nesne dizisi aranır ve sonraki sayfalarda aynı yol kullanılır
      let best = { p: "", n: -1 };
      const walk = (x: any, p: string, d: number) => { if (d > 5 || !x || typeof x !== "object") return; if (Array.isArray(x)) { if (x.length > best.n && x.some((e) => e && typeof e === "object")) best = { p, n: x.length }; return; } for (const [k, v] of Object.entries(x)) walk(v, p ? `${p}.${k}` : k, d + 1); };
      walk(parsed, "", 0); path = best.p; list = best.n >= 0 ? at(parsed, path) : [];
    }
    list = list.filter((e) => e && typeof e === "object");
    const sig = list.length ? JSON.stringify(list[0]).slice(0, 500) + "|" + list.length : "";
    if (!list.length || sig === prevSig) break;
    prevSig = sig;
    items.push(...list);
    const total = Number(at(parsed, paging.total_path));
    if (paging.total_path && Number.isFinite(total) && items.length >= total) break;
    if (paging.type === "none") break;
    if (paging.type === "page" || paging.type === "offset") { if (paging.size_param && list.length < size) break; page += paging.type === "page" ? 1 : list.length; }
    else if (paging.type === "cursor") { cursor = String(at(parsed, paging.cursor_path || "next_cursor") ?? ""); if (!cursor) break; }
    else if (paging.type === "next_url") { nextUrl = String(at(parsed, paging.next_path || "next") ?? ""); if (!nextUrl) break; }
    if (src.delay_ms ?? 300) await sleep(src.delay_ms ?? 300);
  }
  if (pages >= maxPages) {
    if (o.partial) return { items, pages, path, more: true };
    throw new Error(`${label}: sayfa sınırı (${maxPages}) aşıldı; sayfalama ayarını kontrol et (eksik okuma stokları sıfırlatmasın diye durdu)`);
  }
  return { items, pages: pages + 1, path, more: false };
}
